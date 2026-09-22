/**
 * 本地存储封装
 *
 * MVP 阶段不依赖云开发，所有数据存在本机。
 * 后续要接虚拟支付时，只需要把这里的实现换成云函数调用，页面层不用改。
 */

const KEYS = {
  BABY: 'bb_baby',        // { birthday }
  INTRO: 'bb_introduced', // [{ foodId, date, status }]  status: observing | safe | bad
  ISSUE: 'bb_issue',      // 'none' | 'refuse' | ...
  SICK: 'bb_sick',        // bool —— 宝宝生病中，期间暂停引入新辅食
  PLAN: 'bb_plan'         // { generatedAt, months, stageKey, days, shopping }
}

// 新食材观察天数
const OBSERVE_DAYS = 3

// 当前最烦的问题（单选）
const ISSUES = [
  { key: 'none', label: '没什么问题' },
  { key: 'refuse', label: '不肯吃' },
  { key: 'constipation', label: '便秘' },
  { key: 'loose', label: '大便稀' },
  { key: 'iron', label: '缺铁 / 贫血' },
  { key: 'allergy', label: '疑似过敏' }
]

function issueLabel(key) {
  for (let i = 0; i < ISSUES.length; i++) {
    if (ISSUES[i].key === key) return ISSUES[i].label
  }
  return '没什么问题'
}

/** 启动时初始化，避免各页面重复判空 */
function ensureInit() {
  if (!wx.getStorageSync(KEYS.INTRO)) wx.setStorageSync(KEYS.INTRO, [])
  if (!wx.getStorageSync(KEYS.ISSUE)) wx.setStorageSync(KEYS.ISSUE, 'none')
  if (wx.getStorageSync(KEYS.SICK) === '') wx.setStorageSync(KEYS.SICK, false)
}

/* ---------- 生病中 ---------- */

/**
 * 宝宝是否生病中。
 *
 * 依据 WS/T 678—2020《婴幼儿辅食添加营养指南》3.8：
 *   「患病期间暂停添加新的辅食。除特殊情况外，鼓励进食易消化且营养丰富的辅食。
 *     病愈后，及时恢复正常饮食。」
 *
 * 所以生病期间：不排新食材引入，但常规菜谱照排（且应偏向易消化的）。
 */
function getSick() {
  return !!wx.getStorageSync(KEYS.SICK)
}

function setSick(v) {
  wx.setStorageSync(KEYS.SICK, !!v)
}

/* ---------- 宝宝档案 ---------- */

function getBaby() {
  return wx.getStorageSync(KEYS.BABY) || null
}

function setBaby(baby) {
  wx.setStorageSync(KEYS.BABY, baby || null)
}

function isConfigured() {
  const b = getBaby()
  return !!(b && b.birthday)
}

/* ---------- 已引入食材 ---------- */

function getIntroduced() {
  const list = wx.getStorageSync(KEYS.INTRO)
  return Array.isArray(list) ? list : []
}

function setIntroduced(list) {
  wx.setStorageSync(KEYS.INTRO, Array.isArray(list) ? list : [])
}

function findIntro(foodId) {
  const list = getIntroduced()
  for (let i = 0; i < list.length; i++) {
    if (list[i].foodId === foodId) return list[i]
  }
  return null
}

/** 标记「今天给宝宝吃了这个」→ 进入观察期 */
function markIntroduced(foodId, dateStr) {
  const list = getIntroduced()
  const exist = findIntro(foodId)
  const today = dateStr || todayStr()
  if (exist) {
    exist.date = today
    exist.status = 'observing'
  } else {
    list.push({ foodId: foodId, date: today, status: 'observing' })
  }
  setIntroduced(list)
}

/** 观察期结束后由用户确认结果 */
function setIntroStatus(foodId, status) {
  const list = getIntroduced()
  for (let i = 0; i < list.length; i++) {
    if (list[i].foodId === foodId) list[i].status = status
  }
  setIntroduced(list)
}

function removeIntroduced(foodId) {
  const list = getIntroduced().filter(function (it) {
    return it.foodId !== foodId
  })
  setIntroduced(list)
}

/** 已确认安全（可以放心组合进菜单） */
function safeFoodIds() {
  return getIntroduced()
    .filter(function (it) { return it.status === 'safe' })
    .map(function (it) { return it.foodId })
}

/** 正在观察中 */
function observingFoodIds() {
  return getIntroduced()
    .filter(function (it) { return it.status === 'observing' })
    .map(function (it) { return it.foodId })
}

/**
 * 已确认「有反应」的食材 —— 永久排除，不再进任何计划。
 * 这是唯一一种应该被系统性回避的食材。
 */
function badFoodIds() {
  return getIntroduced()
    .filter(function (it) { return it.status === 'bad' })
    .map(function (it) { return it.foodId })
}

/** 所有记录过的食材（含观察中和异常） */
function recordedFoodIds() {
  return getIntroduced().map(function (it) { return it.foodId })
}

/** 观察期已满、等用户确认结果的记录 */
function dueObservations(now) {
  const n = now || new Date()
  return getIntroduced().filter(function (it) {
    if (it.status !== 'observing') return false
    const d = new Date(it.date)
    if (isNaN(d.getTime())) return false
    return (n - d) / 86400000 >= OBSERVE_DAYS
  })
}

/* ---------- 当前问题 ---------- */

function getIssue() {
  return wx.getStorageSync(KEYS.ISSUE) || 'none'
}

function setIssue(key) {
  wx.setStorageSync(KEYS.ISSUE, key || 'none')
}

/* ---------- 当前计划 ---------- */

function getPlan() {
  return wx.getStorageSync(KEYS.PLAN) || null
}

function setPlan(plan) {
  wx.setStorageSync(KEYS.PLAN, plan || null)
}

/* ---------- 其他 ---------- */

function todayStr(d) {
  const n = d || new Date()
  const mm = n.getMonth() + 1
  const dd = n.getDate()
  return n.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd)
}

function resetAll() {
  wx.removeStorageSync(KEYS.BABY)
  wx.removeStorageSync(KEYS.INTRO)
  wx.removeStorageSync(KEYS.ISSUE)
  wx.removeStorageSync(KEYS.PLAN)
}

module.exports = {
  KEYS: KEYS,
  OBSERVE_DAYS: OBSERVE_DAYS,
  ISSUES: ISSUES,
  issueLabel: issueLabel,
  ensureInit: ensureInit,
  getBaby: getBaby,
  setBaby: setBaby,
  isConfigured: isConfigured,
  getIntroduced: getIntroduced,
  setIntroduced: setIntroduced,
  findIntro: findIntro,
  markIntroduced: markIntroduced,
  setIntroStatus: setIntroStatus,
  removeIntroduced: removeIntroduced,
  safeFoodIds: safeFoodIds,
  observingFoodIds: observingFoodIds,
  badFoodIds: badFoodIds,
  recordedFoodIds: recordedFoodIds,
  dueObservations: dueObservations,
  getIssue: getIssue,
  setIssue: setIssue,
  getSick: getSick,
  setSick: setSick,
  getPlan: getPlan,
  setPlan: setPlan,
  todayStr: todayStr,
  resetAll: resetAll
}
