const age = require('../../utils/age')
const storage = require('../../utils/storage')
const plan = require('../../utils/plan')
// <6 月龄的「开始之前」说明（tooYoung 分支铺开渲染）
const guides = require('../../data/guides')
// 打卡「有反应」时要点选这道菜里的哪个食材 —— 需要菜谱表反查主料/配料
const RECIPES = require('../../data/recipes')

// 标记「今天」，供列表做视觉锚点。
// 只在渲染前算，不写回 storage —— 它是派生状态，存下来会过期。
// v2.1 顺手在这里装饰打卡状态（meal.log）与可打卡标记（day.checkable）：
// 同样是派生态 —— setPlan 的序列化发生在 markToday 之前（wx 写入即快照），
// 这里的改动不会污染 storage 里的计划对象。
// v2.7 再加两组派生态：折叠摘要用的 done/total、观察进度点 dots/progText。
function markToday(p) {
  if (!p || !p.days) return p
  const todayKey = plan.dateKey(new Date())
  const LABEL = { full: '吃完了', some: '吃一些', refused: '没吃', reaction: '有反应' }
  const logMap = {}
  storage.getMealLogs().forEach(function (e) {
    logMap[e.date + '|' + e.recipeId] = e
  })
  p.days.forEach(function (d) {
    d.isToday = d.date === todayKey
    // 只有 ≤ 今天的日期能打卡（未来餐还没发生）
    d.checkable = d.date <= todayKey
    let done = 0
    ;(d.meals || []).forEach(function (m) {
      const e = logMap[d.date + '|' + m.recipeId]
      m.log = e
        ? { status: e.status, label: LABEL[e.status] || e.status, reaction: e.reaction || '' }
        : null
      if (m.log) done++
    })
    // 折叠摘要用：这一天打了几餐 / 共几餐（v2.7 · ①「待打卡 N」现算）
    d.total = (d.meals || []).length
    d.done = done
    // 观察进度点（v2.7 · ④）：引入日 = day.date，观察窗 = observeDays（3 天）。
    // 还没到的日子 → ○○○ +「周几开始」；已发生的 → ● 按天数填充，封顶 3/3。
    if (d.newFood) {
      const obs = d.newFood.observeDays || 3
      const diff = dayDiff(d.date, todayKey)
      const n = diff < 0 ? 0 : Math.min(diff + 1, obs)
      d.newFood.dots = '●'.repeat(n) + '○'.repeat(obs - n)
      d.newFood.progText = diff < 0 ? d.weekday + '开始' : '已观察 ' + n + '/' + obs + ' 天'
    }
  })
  return p
}

// 'YYYY-MM-DD' 日历差（to - from，单位天）—— 用 UTC 零点算，避开时区/夏令时
function dayDiff(from, to) {
  const f = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const t = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((t - f) / 86400000)
}

// 缓存的计划是否覆盖今天（日期窗口内）
function coversToday(p) {
  if (!p || !p.days || p.days.length === 0) return false
  const todayKey = plan.dateKey(new Date())
  return p.days[0].date <= todayKey && todayKey <= p.days[p.days.length - 1].date
}

Page({
  data: {
    ready: false,
    configured: false,
    // <6 月龄说明（data/guides.js）：tooYoung 分支铺开渲染
    guide: guides.tooYoung,
    // 6 月龄说明：两张卡默认收起。sixOpen 记录各卡展开态（key → bool），
    // 7–12 月龄知识卡（v2.8）复用它：卡 key 跨组唯一，默认全收起
    guide6: guides.sixMonth,
    // 7–12 月龄分月知识卡：refresh 里按月龄挑一组（互斥，其他月龄为空数组）
    guideLater: [],
    sixOpen: {},
    name: '',
    emptyHint: '',
    months: 0,
    ageText: '',
    stageLabel: '',
    stageDesc: '',
    issueLabel: '',
    issueNone: false,
    ageStatus: '',
    tooYoung: false,
    outOfRange: false,
    tab: 'plan',
    planData: null,
    dueObs: [],
    expanded: '',
    // 当前展开的非今天日期（'' = 全折起）；今天恒展开，不进这个状态（v2.7 · ①）
    openDay: ''
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh() {
    if (!storage.isConfigured()) {
      // 名称和出生日期都是必填。老用户升级后往往**只缺名称**，
      // 必须说清楚缺的是哪个，否则看起来像档案被清空了要重填。
      const miss = storage.missingFields()
      this.setData({
        ready: true,
        configured: false,
        name: '',
        emptyHint: miss.length ? `还差${miss.join('和')}，填一下就能生成计划` : ''
      })
      return
    }

    const baby = storage.getBaby()
    const months = age.monthsBetween(baby.birthday)
    const st = age.getAgeStatus(months)

    const dueObs = storage.dueObservations().map(function (it) {
      const f = plan.getFood(it.foodId)
      return { foodId: it.foodId, name: f ? f.name : it.foodId, date: it.date }
    })

    // 状态是多选，这里取全部；一项都没勾 → statusLabels 兜底成「正常」
    const statuses = storage.getStatuses()

    // 7–12 月龄的分月知识卡（v2.8 · 公开月龄资料融入）：每月龄挑一组，
    // 与 6 月龄卡互斥（不同月龄只挂一组）；展开态共用 sixOpen/toggleGuide6
    const guideLater = months >= 7 && months < 8 ? guides.sevenMonth
      : (months >= 8 && months < 9 ? guides.eightMonth
        : (months >= 9 && months < 10 ? guides.nineMonth
          : (months >= 10 && months < 11 ? guides.tenMonth
            : (months >= 11 && months < 12 ? guides.elevenMonth
              : (months === 12 ? guides.twelveMonth : [])))))

    const base = {
      ready: true,
      configured: true,
      name: baby.name || '',
      months: months,
      ageText: age.describeAge(baby.birthday),
      ageStatus: st.status,
      issueLabel: storage.statusLabels(statuses),
      // 全空 = 没有任何待改善项 → 用灰色，别让「正常」看起来像告警
      issueNone: statuses.length === 0,
      dueObs: dueObs,
      guideLater: guideLater,
      tooYoung: false,
      outOfRange: false
    }

    // 还没到 6 月龄 —— 不给任何辅食建议
    if (st.status === 'too_young' || st.status === 'unknown') {
      base.tooYoung = true
      base.stageLabel = ''
      base.stageDesc = ''
      base.planData = null
      this.setData(base)
      return
    }

    // 超过 24 月龄 —— 超出当前版本内容覆盖范围，别硬生成一份空计划
    if (st.status === 'out_of_range') {
      base.outOfRange = true
      base.stageLabel = ''
      base.stageDesc = ''
      base.planData = null
      this.setData(base)
      return
    }

    const stage = st.stage

    // 缓存计划在四种情况下失效，任一命中就重算：
    //   1. 月龄变了
    //   2. 日期窗口已经不包含今天（旧计划会显得「过期」，今天标记也会落空）
    //   3. 生成输入变了 —— issue / 生病状态 / 已引入食材（指纹比对）
    //      ⚠️ 第 3 条不能省：用户把某食材标成「有反应」后，旧计划里那道菜
    //      还在，下次打开照样推荐。「有反应」的语义是永久排除。
    //   4. 计划结构/内容版本变了（sv：v2.7 加 meal.cats 标签与步骤占位符填数，
    //      v2.8 刷新步骤文案与菜池）—— 旧缓存里没有新字段/新菜，不 bump 就一直渲染旧的。
    //      重算走 replanOpts 冻结已发生的日子，不会重排已打卡的行。
    let p = storage.getPlan()
    const sig = plan.planSignature(storage)
    if (!p || p.months !== months || !coversToday(p) || p.signature !== sig || p.sv !== plan.STRUCT_V) {
      // 隐式重算（输入变了 / 窗口过期）：旧计划还盖住今天时，沿用它的起始日
      // 并冻结「日期 ≤ 今天」的整天，只重排明天之后的餐 —— 整段从今天重排
      // 会把窗口前移（周一生成、周三重排变成周三~下周二），已打卡的行也会
      // 因为 recipeId 不在新计划里从页面凭空消失（P2，见 plan.replanOpts）。
      // 明确点「重新生成」走 regenerate()，不冻结：用户已确认「原来的会被替换」。
      p = plan.generateFromStorage(storage, plan.replanOpts(p))
      storage.setPlan(p)
    }
    markToday(p)

    base.stageLabel = stage.label
    base.stageDesc = stage.desc
    base.planData = p
    base.expanded = ''
    base.openDay = ''
    this.setData(base)
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  toggleMeal(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ expanded: this.data.expanded === key ? '' : key })
  },

  // 折叠天展开/收起（v2.7 · ①）：今天恒展开 —— 点它不进这里（guard），
  // 否则 openDay 被设成今天的日期，看起来没反应但状态脏了
  toggleDay(e) {
    const date = e.currentTarget.dataset.date
    if (date === plan.dateKey(new Date())) return
    this.setData({ openDay: this.data.openDay === date ? '' : date })
  },

  // 每餐打卡：写入（同日同菜覆写），refresh 后按钮态与指纹同步重排
  logMeal(e) {
    const d = e.currentTarget.dataset
    storage.logMeal(d.date, d.rid, d.status)
    this.refresh()
    wx.showToast({ title: '已记录', icon: 'success' })
  },

  undoMealLog(e) {
    const d = e.currentTarget.dataset
    storage.logMeal(d.date, d.rid, null)
    this.refresh()
  },

  // 「有反应」：点选这道菜里的哪个食材 → 直接标 bad（走 §6j 守卫的正路：
  // markIntroduced → setIntroStatus('bad')，反应当天日期随记录写入），
  // 同时把本餐记为 reaction。ActionSheet 最多 6 项，菜谱食材不会超。
  reactionMeal(e) {
    const d = e.currentTarget.dataset
    let recipe = null
    for (let i = 0; i < RECIPES.length; i++) {
      if (RECIPES[i].id === d.rid) { recipe = RECIPES[i]; break }
    }
    if (!recipe) return
    const fids = []
    recipe.mainFoods.concat(recipe.sideFoods || []).forEach(function (f) {
      if (fids.indexOf(f) < 0) fids.push(f)
    })
    const names = fids.map(function (f) {
      const o = plan.getFood(f)
      return o ? o.name : f
    })
    const that = this
    wx.showActionSheet({
      itemList: names.slice(0, 6),
      success(res) {
        const fid = fids[res.tapIndex]
        storage.markIntroduced(fid)
        storage.setIntroStatus(fid, 'bad')
        storage.logMeal(d.date, d.rid, 'reaction', fid)
        storage.setPlan(null)
        that.refresh()
        wx.showToast({ title: '已标为有反应，不再排进菜单', icon: 'none' })
      }
    })
  },

  // 指南卡（6 月龄 + 7–12 月龄 v2.8）：点卡头切换该卡的展开态
  // 默认全收起，sixOpen 里没有 key = 收起；卡 key 跨组唯一，展开态互不影响
  toggleGuide6(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ ['sixOpen.' + k]: !this.data.sixOpen[k] })
  },

  regenerate() {
    const that = this
    wx.showModal({
      title: '重新生成',
      content: '会按当前月龄和食材记录重排一份 7 天计划，原来的会被替换。',
      confirmText: '重新生成',
      success(res) {
        if (!res.confirm) return
        const p = plan.generateFromStorage(storage)
        if (!p) {
          wx.showToast({ title: '生成失败，请检查宝宝档案', icon: 'none' })
          return
        }
        storage.setPlan(p)
        that.setData({ planData: markToday(p), tab: 'plan', expanded: '', openDay: '' })
        wx.showToast({ title: '已重新生成', icon: 'success' })
      }
    })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
