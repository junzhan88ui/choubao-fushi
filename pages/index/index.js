const age = require('../../utils/age')
const storage = require('../../utils/storage')
const plan = require('../../utils/plan')
const share = require('../../utils/share')
// 测量面板（v3.2 从档案页搬来）：字段标签与单位取自 growth.METRICS，
// 取值区间取自 storage.GROWTH_METRICS —— 两处都是既有单一来源，页面不另写数字。
const growth = require('../../utils/growth')
// <6 月龄的「开始之前」说明（tooYoung 分支铺开渲染）
const guides = require('../../data/guides')
// v2.25：「有反应」打卡移到档案页「已经吃过」卡 —— 菜谱表反查主料的依赖一并删除
// （原 reactionMeal 用 RECIPES 反查这道菜里哪个食材出了反应）

// 标记「今天」，供列表做视觉锚点。
// 只在渲染前算，不写回 storage —— 它是派生状态，存下来会过期。
// v2.1 顺手在这里装饰打卡状态（meal.log）与可打卡标记（day.checkable）：
// 同样是派生态 —— setPlan 的序列化发生在 markToday 之前（wx 写入即快照），
// 这里的改动不会污染 storage 里的计划对象。
// v2.7 加一组派生态：折叠摘要用的 done/total。
// v2.25 · 方案A：观察进度点（dots/progText）与 plan.attachNewFood 一并移除 ——
// 引入和观察都搬进档案页，计划里不再有 day.newFood 可挂、可算。
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
    const markLog = function (m) {
      const e = logMap[d.date + '|' + m.recipeId]
      m.log = e
        ? { status: e.status, label: LABEL[e.status] || e.status, reaction: e.reaction || '' }
        : null
      if (m.log) done++
      // 步骤展开态（v2.10 · 用户需求）：今天的餐默认展开详情，其余日子默认收起。
      // 与 meal.log 同款派生态 —— setPlan 的快照发生在 markToday 之前，不写回缓存。
      // 一餐一个开关（meal.open）而不是共用一个 expanded 字符串：今天有几餐就都展着，
      // 点其中一餐不会把其它餐顶掉（字符串方案一次只能开一餐）。
      m.open = d.isToday
    }
    ;(d.meals || []).forEach(markLog)
    // v2.9 加餐行与正餐行同构，一并挂打卡态（奶参考行不打卡）
    if (d.snack) markLog(d.snack)
    // 折叠摘要用：这一天打了几餐 / 共几餐（v2.7 · ①「待打卡 N」现算；v2.9 含加餐）
    d.total = (d.meals || []).length + (d.snack ? 1 : 0)
    d.done = done
    // v2.9 时段锚点（方案A · 用户看模拟页确认）：plan.slots 模板 × 当天正餐/加餐
    // → 渲染行 timeline。派生态（同 isToday/checkable）：每次渲染现算，不写回缓存。
    // 冻结日可能来自旧版计划：模板里多余的正餐槽不填（缺行跳过），
    // 餐数多于模板时把多出的正餐补在末尾，别让升级过渡期丢餐。
    const slots = p.slots || age.slotsForMonth(p.months)
    const rows = []
    let mi = 0
    for (let s = 0; s < slots.length; s++) {
      const sl = slots[s]
      if (sl.kind === 'milk') {
        rows.push({ key: sl.time + '|milk', time: sl.time, kind: 'milk' })
      } else if (sl.kind === 'main') {
        const meal = (d.meals || [])[mi++]
        if (meal) {
          rows.push({
            key: sl.time + '|main|' + meal.key, time: sl.time, kind: 'main',
            label: sl.label, withMilk: !!sl.withMilk, meal: meal
          })
        }
      } else if (d.snack) { // kind === 'snack'
        rows.push({
          key: sl.time + '|snack', time: sl.time, kind: 'snack',
          label: sl.label, meal: d.snack
        })
      }
    }
    while (d.meals && mi < d.meals.length) {
      const meal = d.meals[mi++]
      rows.push({ key: 'x|main|' + meal.key, time: '', kind: 'main', label: '', meal: meal })
    }
    d.timeline = rows
  })
  return p
}

// 缓存的计划是否覆盖今天（日期窗口内）
function coversToday(p) {
  if (!p || !p.days || p.days.length === 0) return false
  const todayKey = plan.dateKey(new Date())
  return p.days[0].date <= todayKey && todayKey <= p.days[p.days.length - 1].date
}

/* v3.0 批⑨ · 首页头卡文案（用户 2026-10-15 拍板对标参考图）。全是渲染前现算的
   派生态，不写回 storage —— 出生时间/个性描述/生长记录/打卡都不因渲染被改动。 */

// 英文小标：1–12 月用序数词（first … twelfth，对标参考图 "my first month"），
// 再往上退 13th 式。
const MONTH_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']

function enMonthWord(n) {
  if (n >= 1 && n <= 12) return MONTH_WORDS[n]
  const r = n % 100
  const suffix = (r % 10 === 1 && r !== 11) ? 'st'
    : (r % 10 === 2 && r !== 12) ? 'nd'
      : (r % 10 === 3 && r !== 13) ? 'rd' : 'th'
  return n + suffix
}

/** 指标格（批⑨，用户拍板：下两格换**现有**数据，不新建睡/奶记录）：
 *  体重/身长取最近一条生长测量，增量 = 与出生值之差；没记录显示「—」。
 *  本周打卡 = 计划里打完的餐 / 总餐；已引入 = 已确认没问题的食材种数。
 *  格子只做展示，不接曲线页入口（决策④「先不加入口」，§6x-13 反向钉）。 */
const STAT_EMPTY6x = { value: '—', unit: '', sub: '' }

function metricCell6x(last, key, unit, birthValue) {
  const v = (last && last[key] !== '' && last[key] !== null && last[key] !== undefined)
    ? Number(last[key]) : null
  const b = (birthValue !== '' && birthValue !== null && birthValue !== undefined)
    ? Number(birthValue) : null
  if (v === null || !isFinite(v)) return STAT_EMPTY6x
  let sub = ''
  if (b !== null && isFinite(b)) {
    const d = Math.round((v - b) * 10) / 10
    if (d !== 0) sub = (d > 0 ? '+' : '') + d + unit
  }
  return { value: String(v), unit: unit, sub: sub }
}

function buildStats6x(baby, planData) {
  const g = storage.getGrowth()
  const last = g.length ? g[g.length - 1] : null
  let check = STAT_EMPTY6x
  if (planData && planData.days && planData.days.length) {
    let done = 0
    let total = 0
    planData.days.forEach(function (d) { done += d.done || 0; total += d.total || 0 })
    check = { value: done + '/' + total, unit: '', sub: '' }
  }
  return {
    statWeight: metricCell6x(last, 'weight', 'kg', baby.birthWeight),
    statLength: metricCell6x(last, 'length', 'cm', baby.birthLength),
    statCheck: check,
    statFood: { value: String(storage.safeFoodIds().length), unit: '种', sub: '' }
  }
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
    // v2.32 双时钟：months = 辅食月龄（节奏类闸门：6 月卡等）；生理月龄只
    // 用于年龄文案（ageText）与「1 岁以上」分流，不进 data（§6w 分流表）
    months: 0,
    ageText: '',
    // 批⑬（用户 2026-10-16 拍板）：辅食月龄副文案（foodAgeText）、阶段说明
    // （stageDesc）、状态汇总（issueLabel / issueNone）三处文案连同装配一并删掉 ——
    // 首页不再渲染，它们的数据源（foodStart / stage / getStatuses）原样留着，
    // 别当死数据加回来（反向钉 _validate §6t / §6w / §6x-22）
    ageStatus: '',
    tooYoung: false,
    outOfRange: false,
    tab: 'plan',
    planData: null,
    // 观察期到期提醒（dueObs）已随 3 天观察期规则整体删除（v2.30 用户决策，§6u 反向钉）
    // 当前展开的非今天日期（'' = 全折起）；今天恒展开，不进这个状态（v2.7 · ①）
    // 餐级步骤展开态不在这儿 —— 是行上的 meal.open（markToday 按 isToday 现算）
    openDay: '',
    // v3.0 批⑦ · 宝宝照片路径（'' = 没传，渲染占位空框）—— 只有一张，
    // 换图靠再点一次覆盖，长按移除回占位
    photo: '',
    // v3.0 批⑨ · 头卡两行标题 + 个性行 + 2×2 指标格（全是渲染前现算的派生态，
    // 见模块顶部 buildStats6x；不写回 storage）。批⑬ 起不再装配 headDateText；
    // noteText（个性行）批⑬ 删掉、批⑮ 用户 2026-10-16 恢复
    monthNo: 1,
    monthWord: 'first',
    noteText: '',
    statWeight: STAT_EMPTY6x,
    statLength: STAT_EMPTY6x,
    statCheck: STAT_EMPTY6x,
    statFood: STAT_EMPTY6x,
    // ── v3.1 首次进入弹窗（用户 2026-10-19 拍板）────────────────────────────
    // 只在「还没建档」时出现，判定走 storage.isConfigured()，**不新增**
    // 「首次启动」标志位：老用户升级后只缺名字、填到一半杀进程，这两种情况
    // 用标志位都会漏判，用 isConfigured 天然覆盖。会话内只弹一次（实例属性
    // _obShown，不进 data —— 它不影响渲染）。
    obOpen: false,
    obName: '',
    obNameMax: storage.BABY_NAME_MAX,
    obBirthday: '',
    obFoodStart: '',
    obToday: '',
    obMinDate: '',
    obFoodMinDate: '',
    // 辅食日期这一行只在「出生 + 4 个月 ≤ 今天」时渲染：不满 4 个月时
    // 选择器没有任何合法值，摆出来只会让用户白滚一趟（档案页同一口径）
    obFoodReady: false,

    // ── 身高体重记录面板（v3.2 从档案页搬来，用户 2026-10-19）─────────────
    // 档案页第 5 步「都记好了」整屏已删，录入入口落到首页头卡胶囊：
    // 点「＋ 记录身高体重」就地弹面板，不跳页。数据仍是曲线页那份 bb_growth
    // （storage.getGrowth / upsertGrowthRecord），不另存一份、不进计划指纹。
    // metricHasRecord = 当前面板日期已有一条记录（出「删除这条记录」）
    metricOpen: false,
    metricHasRecord: false,
    ph: {}, // 输入占位，区间来自 storage.GROWTH_METRICS（单一来源）
    mForm: { date: '', minDate: '', maxDate: '', weight: '', length: '', head: '' }
  },

  onLoad() {
    // 测量面板的输入占位：区间来自 storage.GROWTH_METRICS，页面不写死数字
    const ph = {}
    Object.keys(storage.GROWTH_METRICS).forEach(function (k) {
      const m = storage.GROWTH_METRICS[k]
      ph[k] = '选填 ' + m.min + '–' + m.max
    })
    this.setData({ ph: ph })
  },

  onShow() {
    this.refresh()
  },

  /** 面板开着时被切走（来电 / 切 tab / 回桌面）：tabBar 处于 hide 状态，
   *  回来会是一屏没有底栏的页面 —— 关掉面板并恢复，比留个残局强。 */
  onHide() {
    if (this.data.metricOpen) {
      this.setData({ metricOpen: false })
      wx.showTabBar({ animation: false })
    }
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  /* ── v3.1 首次进入弹窗（用户 2026-10-19 拍板）─────────────────────────────
   *  只问两件事：名字（已预填「宝贝+4位编号」，可直接改）+ 出生日期（必填），
   *  外加一个选填的首次辅食日期。性别、出生体重这些**不进弹窗** —— 它们不影响
   *  排菜，放进来只会把首屏摩擦加回去，留给档案页第 2 步。
   *
   *  编号必须**落库**（见 storage.defaultBabyName 的注释）：只在没名字时生成一次，
   *  之后永远读回。跳过弹窗也照样写进去 —— 否则下次冷启动会换一个号，露馅。
   *  会话内只弹一次：_obShown 是页面实例属性，切 tab 不重置、冷启动才重置。 */

  /** 辅食日期下限 = 出生 + 4 个月（公开指南「最早不早于 4 月龄」，
   *  与档案页 profile.foodMinOf 同一口径 —— 两处都要改时记得一起改） */
  obFoodMinOf(birthday) {
    if (!birthday) return ''
    const b = new Date(birthday)
    if (isNaN(b.getTime())) return ''
    return storage.todayStr(new Date(b.getFullYear(), b.getMonth() + 4, b.getDate()))
  },

  maybeOpenOnboard() {
    if (this._obShown) return
    this._obShown = true

    const now = new Date()
    const min = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())
    const today = storage.todayStr(now)
    const baby = storage.getBaby() || {}

    let name = baby.name || ''
    if (!name) {
      name = storage.defaultBabyName()
      storage.setBaby({ name: name }) // 立刻落库，这个编号从此不再变
    }

    const birthday = baby.birthday || ''
    const foodMin = this.obFoodMinOf(birthday)
    this.setData({
      obOpen: true,
      obName: name,
      obBirthday: birthday,
      obFoodStart: baby.foodStart || '',
      obToday: today,
      obMinDate: storage.todayStr(min),
      obFoodMinDate: foodMin,
      obFoodReady: !!foodMin && foodMin <= today
    })
  },

  /** 名字边打边存（与档案页 onNameInput 同款）：中途杀进程不丢，
   *  也不会出现「弹窗里能存 12 字、档案页截到别的数」这种两套清洗。 */
  onObName(e) {
    const v = storage.sanitizeBabyName(e.detail.value)
    storage.setBaby({ name: v })
    this.setData({ obName: v })
  },

  onObBirthday(e) {
    const v = e.detail.value
    storage.setBaby({ birthday: v })
    const foodMin = this.obFoodMinOf(v)
    this.setData({
      obBirthday: v,
      obFoodMinDate: foodMin,
      obFoodReady: !!foodMin && foodMin <= this.data.obToday
    })
  },

  /** 首次辅食日期（选填）：只有填了生日才渲染这一行 —— 下限算不出来时
   *  给个没有合法值的选择器只会让用户白滚一趟（档案页同一条规矩）。 */
  onObFoodStart(e) {
    const v = e.detail.value
    storage.setBaby({ foodStart: v })
    this.setData({ obFoodStart: v })
  },

  /** 开始用：唯一硬闸门是出生日期。名字被清空就回填一个默认名 ——
   *  name 是 isConfigured 的一半，空着会把用户顶回「还没建档」。 */
  confirmOnboard() {
    if (!this.data.obBirthday) {
      wx.showToast({ title: '先选一下出生日期', icon: 'none' })
      return
    }
    let name = storage.sanitizeBabyName(this.data.obName)
    if (!name) {
      name = storage.defaultBabyName()
      storage.setBaby({ name: name })
    }
    storage.setBaby({
      name: name,
      birthday: this.data.obBirthday,
      foodStart: this.data.obFoodStart || ''
    })
    storage.setPlan(null) // 月龄/辅食锚可能刚变，旧计划作废
    this.setData({ obOpen: false })
    this.refresh()
  },

  /** 先随便看看：只关弹窗，不写任何「已看过」的持久标记 ——
   *  下次冷启动若仍未建档，再弹一次是合理的（他确实还没填）。 */
  skipOnboard() {
    this.setData({ obOpen: false })
  },

  /** 弹窗遮罩的 catchtouchmove 落点：只为挡住背景页跟着滚，不做任何事 */
  noop() {},

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
      this.maybeOpenOnboard()
      return
    }

    const baby = storage.getBaby()
    const phys = age.monthsBetween(baby.birthday) // 生理月龄：年龄文案、「1 岁+」分流
    // 辅食月龄（v2.32 双时钟，age.foodMonthsOf 唯一分流入口）：没填辅食
    // 日期时 = 生理月龄 —— 存量用户行为与指纹完全不变，零打扰
    const fm = age.foodMonthsOf(baby)
    // 阶段/超范围判断走辅食月龄；填了辅食日期 = 家长已决定开始，
    // 不会再判 too_young（辅食钟恒 ≥6，§6w）
    const st = age.getAgeStatus(fm)

    // 7–12 月龄的分月知识卡（v2.8 · 公开月龄资料融入）：按**辅食月龄**挑一组
    // （v2.32 双时钟），与 6 月龄卡互斥；展开态共用 sixOpen/toggleGuide6。
    // 「1 岁以上」统一卡（v2.31）：进卡看**生理月龄 ≥13** —— 幼儿期（1–3 岁）
    // 的盐控/奶量口径都是生理的，晚开始辅食的宝宝不能滞后（§6w 分流表）
    const guideLater = phys >= 13 ? guides.onePlus
      : (fm >= 7 && fm < 8 ? guides.sevenMonth
        : (fm >= 8 && fm < 9 ? guides.eightMonth
          : (fm >= 9 && fm < 10 ? guides.nineMonth
            : (fm >= 10 && fm < 11 ? guides.tenMonth
              : (fm >= 11 && fm < 12 ? guides.elevenMonth
                : (fm === 12 ? guides.twelveMonth : []))))))

    // v3.0 批⑨ · 头卡派生（对标参考图）
    const ageTxt6x = age.describeAge(baby.birthday)
    // 第 N 个月：与 ageText 同源 ——「5 个月 9 天」→ 第 5 个月；不满 1 个月
    // 也归第 1 个月（参考图里的 1 月龄宝宝正是写作「第 1 个月」）
    const monthNo6x = Math.max(1, phys || 0)
    const stats6x = buildStats6x(baby, null)

    const base = {
      ready: true,
      configured: true,
      name: baby.name || '',
      photo: storage.getBabyPhoto(),
      months: fm,
      ageText: ageTxt6x,
      // 批⑨：英文小标 + 两行大标题。批⑬（2026-10-16）删掉了出生日期行、出生指标行、
      // 状态汇总、阶段说明、辅食月龄副文案（数据源没动，只是首页不显示，§6x-22）；
      // 个性行（noteText）批⑮ 恢复
      monthNo: monthNo6x,
      monthWord: enMonthWord(monthNo6x),
      noteText: baby.note || '',
      // 批⑨ 指标格先按「没计划」装配（tooYoung / 超范围走这条），
      // 有计划的落到下面覆盖 statCheck（体重/身长/已引入与计划无关）
      statWeight: stats6x.statWeight,
      statLength: stats6x.statLength,
      statCheck: stats6x.statCheck,
      statFood: stats6x.statFood,
      ageStatus: st.status,
      guideLater: guideLater,
      tooYoung: false,
      outOfRange: false
    }

    // 还没到 6 月龄 —— 不给任何辅食建议
    if (st.status === 'too_young' || st.status === 'unknown') {
      base.tooYoung = true
      base.planData = null
      this.setData(base)
      return
    }

    // 超过 24 月龄 —— 超出当前版本内容覆盖范围，别硬生成一份空计划
    if (st.status === 'out_of_range') {
      base.outOfRange = true
      base.planData = null
      this.setData(base)
      return
    }

    // 缓存计划在四种情况下失效，任一命中就重算：
    //   1. 月龄变了
    //   2. 日期窗口已经不包含今天（旧计划会显得「过期」，今天标记也会落空）
    //   3. 生成输入变了 —— issue / 生病状态 / 已引入食材（指纹比对）
    //      ⚠️ 第 3 条不能省：用户把某食材标成「有反应」后，旧计划里那道菜
    //      还在，下次打开照样推荐。「有反应」的语义是永久排除。
    //   4. 计划结构/内容版本变了（sv：v2.7 加 meal.cats 标签与步骤占位符填数，
    //      v2.8 刷新步骤文案与菜池，v2.9 分槽/时段锚点，v2.10 冻结语义收窄）
    //      —— 旧缓存里没有新字段/新菜，不 bump 就一直渲染旧的。
    //      重算走 replanOpts：只冻结「≤今天且有打卡」的整天（打卡行不丢），
    //      没打卡的已过日子按当前规则重排 —— 旧计划里的非菜单行才能自愈。
    let p = storage.getPlan()
    const sig = plan.planSignature(storage)
    // months 比的是**辅食月龄**（v2.32）：p.months 是引擎按 foodMonthsOf 算的
    if (!p || p.months !== fm || !coversToday(p) || p.signature !== sig || p.sv !== plan.STRUCT_V) {
      // 隐式重算（输入变了 / 窗口过期）：旧计划还盖住今天时，沿用它的起始日
      // （窗口不前移），并冻结「≤今天 且有打卡」的整天 —— 整段从今天重排
      // 会把窗口前移（周一生成、周三重排变成周三~下周二），已打卡的行也会
      // 因为 recipeId 不在新计划里从页面凭空消失（P2，见 plan.replanOpts）。
      // 明确点「重新生成」走 regenerate()，不冻结：用户已确认「原来的会被替换」。
      p = plan.generateFromStorage(storage, plan.replanOpts(p, storage.getMealLogs()))
      storage.setPlan(p)
    }
    markToday(p)

    // 批⑨：有计划了，打卡格换成真实进度（其余三格与计划无关，沿用 base）
    const stats6xp = buildStats6x(baby, p)
    base.statWeight = stats6xp.statWeight
    base.statLength = stats6xp.statLength
    base.statCheck = stats6xp.statCheck
    base.statFood = stats6xp.statFood

    base.planData = p
    // 餐级展开态由 markToday 按「是不是今天」重算（今天的餐默认展开），这里只复位日期级折叠
    base.openDay = ''
    this.setData(base)
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  // 步骤展开/收起（v2.10 · 改成每餐独立开关 meal.open）：时段头与餐次卡都进这里。
  // 默认值在 markToday 里给（今天 true、其余 false），所以只翻命中的那一餐 ——
  // 今天多餐时点 A 不会连带收起 B。打卡按钮是 catchtap，冒不上来（§6k 钉死）。
  //
  // ⚠ 回写必须整包（setData 整个 planData），不能用路径式 setData：
  //   setData({'planData.days.0.meals.0.open': v}) 会把 planData.days 写坏 ——
  //   整周计划只剩一张天卡、摘要数字全空（v2.10 实测崩坏；storage 里没坏，
  //   onShow/下拉 refresh 会重建）。本页 refresh/regenerate 走的就是整包通道。
  toggleMeal(e) {
    const key = e.currentTarget.dataset.key
    const p = this.data.planData
    if (!p || !p.days) return
    let hit = null
    for (let i = 0; i < p.days.length && !hit; i++) {
      const d = p.days[i]
      const meals = d.meals || []
      for (let j = 0; j < meals.length; j++) {
        if (meals[j].key === key) { hit = meals[j]; break }
      }
      if (!hit && d.snack && d.snack.key === key) hit = d.snack
    }
    if (!hit) return
    hit.open = !hit.open
    this.setData({ planData: p })
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

  // v2.25：「有反应」打卡从首页餐卡移除；v2.30 档案页的「标记有反应」入口
  // 也已删除 —— 标记 bad 的按钮只剩食材详情页「食物过敏」（markBad 正路）。
  // 首页餐卡只有三态打卡。历史记录里的 reaction 状态仍由 LABEL 正常显示。

  // 指南卡（6 月龄 + 7–12 月龄 v2.8）：点卡头切换该卡的展开态
  // 默认全收起，sixOpen 里没有 key = 收起；卡 key 跨组唯一，展开态互不影响
  toggleGuide6(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ ['sixOpen.' + k]: !this.data.sixOpen[k] })
  },

  // v2.31 · 提案A：入口是状态行下方的右对齐胶囊按钮（.head-more）→ 月龄指南页
  goMonths() {
    wx.navigateTo({ url: '/pages/months/months' })
  },

  /* ── 身高体重记录面板（v3.2 · 从档案页搬来，用户 2026-10-19 拍板）────────
   *  档案页第 5 步删除后，这里是**唯一**的录入入口（「我的」页只管看历史）。
   *  数据就是曲线页那份 bb_growth，不另存一份、也不进计划指纹。
   *  红线不变：只记录、不评价 —— 面板里只有「数值 + 区间占位」，没有评价词。 */

  /** 打开面板：默认载入「今天」（无记录 = 空表单新建；有记录 = 带出旧值可改可删）。
   *  必须 hideTabBar：首页是 tabBar 页，原生 tabBar 的层级高于任何页面内 fixed 元素，
   *  不隐藏的话面板底栏会被 tabBar 盖住（档案页没有 tabBar，所以那边不用管）。 */
  openMetricSheet() {
    this.setData({ metricOpen: true })
    wx.hideTabBar({ animation: false })
    this.loadMetric(storage.todayStr())
  },

  closeMetricSheet() {
    this.setData({ metricOpen: false })
    wx.showTabBar({ animation: false })
  },

  /** 把某一天的已有记录灌进表单（没有就清空）。metricHasRecord 决定
   *  「删除这条记录」出不出现 —— 换日期时会跟着重算。 */
  loadMetric(date) {
    const baby = storage.getBaby() || {}
    const rec = storage.getGrowth().filter(function (r) { return r.date === date })[0] || null
    this.setData({
      metricHasRecord: !!rec,
      mForm: {
        date: date,
        minDate: baby.birthday || '',
        maxDate: storage.todayStr(),
        weight: rec && rec.weight !== undefined ? String(rec.weight) : '',
        length: rec && rec.length !== undefined ? String(rec.length) : '',
        head: rec && rec.head !== undefined ? String(rec.head) : ''
      }
    })
  },

  onMetricInput(e) {
    const patch = {}
    patch['mForm.' + e.currentTarget.dataset.k] = e.detail.value
    this.setData(patch)
  },

  onMetricDate(e) {
    this.loadMetric(e.detail.value)
  },

  /** 保存（同日期覆盖；日期闸门在 storage.upsertGrowthRecord 里）。
   *  校验口径与曲线页录入卡一致：至少一项、区间内、1 位小数。 */
  onMetricSave() {
    const f = this.data.mForm
    const rec = { date: f.date }
    const keys = Object.keys(growth.METRICS) // weight / length / head
    let any = false
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const raw = String(f[k] === undefined || f[k] === null ? '' : f[k]).trim()
      if (raw === '') continue
      const n = Number(raw)
      const m = storage.GROWTH_METRICS[k]
      if (!isFinite(n) || n < m.min || n > m.max) {
        wx.showToast({
          title: growth.METRICS[k].label + ' ' + m.min + '–' + m.max + ' ' + m.unit,
          icon: 'none'
        })
        return
      }
      rec[k] = Math.round(n * 10) / 10 // 归一到 1 位小数，与 cleanGrowthEntry 同口径
      any = true
    }
    if (!any) {
      wx.showToast({ title: '至少填一项测量值', icon: 'none' })
      return
    }
    if (!storage.upsertGrowthRecord(rec)) {
      wx.showToast({ title: '日期要在出生到今天之间', icon: 'none' })
      return
    }
    wx.showToast({ title: '已记录', icon: 'success' })
    this.setData({ metricOpen: false })
    wx.showTabBar({ animation: false })
    // 头卡「体重 / 身长」要立刻跟上，所以整页 refresh 一次 —— 只更新两个
    // 指标格需要把 refresh 里的派生计算复制一份，不值当。
    this.refresh()
  },

  /** 删除当前这条（按钮只在 metricHasRecord 时渲染，这里再挡一道） */
  onMetricDelete() {
    const date = this.data.mForm.date
    if (!this.data.metricHasRecord || !date) return
    const that = this
    wx.showModal({
      title: '删除记录',
      content: '删除 ' + date + ' 这条测量记录？',
      success(res) {
        if (!res.confirm) return
        storage.removeGrowthRecord(date)
        that.setData({ metricOpen: false })
        wx.showTabBar({ animation: false })
        that.refresh()
      }
    })
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
        that.setData({ planData: markToday(p), tab: 'plan', openDay: '' })
        wx.showToast({ title: '已重新生成', icon: 'success' })
      }
    })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  // v3.0 批⑦ · 宝宝照片（用户 2026-10-15 拍板：占位贴纸升级为可传一张）
  // chooseMedia 只给临时文件 → storage.saveBabyPhoto 落到固定路径覆盖写
  // （「只一张」在存储层保证）。压缩图 + 纯本机落盘：不上传、不联网；
  // 失败保留旧照/占位，不留死图。
  chooseBabyPhoto() {
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success(res) {
        const f = res.tempFiles && res.tempFiles[0]
        const p = f && storage.saveBabyPhoto(f.tempFilePath)
        if (!p) {
          wx.showToast({ title: '照片保存失败，再试一次', icon: 'none' })
          return
        }
        that.setData({ photo: p })
        wx.showToast({ title: '照片已更新', icon: 'success' })
      }
    })
  },

  // 长按贴纸移除照片（回到占位空框）：换图靠再点一次，移除是唯一的回退通道
  removeBabyPhoto() {
    if (!this.data.photo) return
    const that = this
    wx.showModal({
      title: '移除照片',
      content: '贴纸会回到「贴上宝宝的照片」的空框。',
      confirmText: '移除',
      success(res) {
        if (!res.confirm) return
        storage.clearBabyPhoto()
        that.setData({ photo: '' })
      }
    })
  },

  // 分享（批⑧）：好友卡片与朋友圈同一套 —— 内容型标题、不传 imageUrl
  // （微信自动截当前页）、显式 path 落回本页
  onShareAppMessage() {
    return share.card(share.TITLES.plan, '/pages/index/index')
  },

  onShareTimeline() {
    return share.card(share.TITLES.plan, '/pages/index/index')
  }
})
