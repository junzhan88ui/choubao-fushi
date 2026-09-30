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
    ;(d.meals || []).forEach(function (m) {
      const e = logMap[d.date + '|' + m.recipeId]
      m.log = e
        ? { status: e.status, label: LABEL[e.status] || e.status, reaction: e.reaction || '' }
        : null
    })
  })
  return p
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
    // 6 月龄说明：两张卡默认收起，sixOpen 记录各卡展开态（key → bool）
    guide6: guides.sixMonth,
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
    expanded: ''
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

    // 缓存计划在三种情况下失效，任一命中就重算：
    //   1. 月龄变了
    //   2. 日期窗口已经不包含今天（旧计划会显得「过期」，今天标记也会落空）
    //   3. 生成输入变了 —— issue / 生病状态 / 已引入食材（指纹比对）
    //      ⚠️ 第 3 条不能省：用户把某食材标成「有反应」后，旧计划里那道菜
    //      还在，下次打开照样推荐。「有反应」的语义是永久排除。
    let p = storage.getPlan()
    const sig = plan.planSignature(storage)
    if (!p || p.months !== months || !coversToday(p) || p.signature !== sig) {
      p = plan.generateFromStorage(storage)
      storage.setPlan(p)
    }
    markToday(p)

    base.stageLabel = stage.label
    base.stageDesc = stage.desc
    base.planData = p
    base.expanded = ''
    this.setData(base)
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  toggleMeal(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ expanded: this.data.expanded === key ? '' : key })
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

  // 6 月龄说明卡：点卡头切换该卡的展开态（默认全收起，sixOpen 里没有 key = 收起）
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
        that.setData({ planData: markToday(p), tab: 'plan', expanded: '' })
        wx.showToast({ title: '已重新生成', icon: 'success' })
      }
    })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
