/**
 * 本地存储封装
 *
 * MVP 阶段不依赖云开发，所有数据存在本机。
 * 后续要接虚拟支付时，只需要把这里的实现换成云函数调用，页面层不用改。
 */

const KEYS = {
  BABY: 'bb_baby',        // { birthday }
  INTRO: 'bb_introduced', // [{ foodId, date, status }]  status: observing | safe | bad
  STATUS: 'bb_status',    // [keys] 当前状态，可多选（合法 key 见 STATUSES）
  PLAN: 'bb_plan',        // { generatedAt, months, stageKey, days, shopping }

  // 旧版单选字段，只用于把老用户的设置迁移进 bb_status（见 ensureInit）
  LEGACY_ISSUE: 'bb_issue',
  LEGACY_SICK: 'bb_sick'
}

// 新食材观察天数
const OBSERVE_DAYS = 3

// 宝宝当前状态（**多选**）
//
// 这里只放「真状态」，不放空值选项（没什么问题 / ok / normal）。
// 空值一旦进了这个数组，就能和「便秘」同时勾上，自相矛盾，
// STATUS_TAG 加权表也得跟着分叉 —— _validate.js §6 守的就是这条。
//
// 「状态正常」因此单独走排它通道（见下方 OK_KEY）：它的 key 不进
// STATUSES、不进 bb_status、也进不了 STATUS_TAG，只是 UI 上摆在第一位、
// 点了清空全部的选项，表达的仍是「一项都没勾」。
//
// 'sick' 与其他项性质不同：它不是加权偏好，而是硬开关（暂停引入新食材），
// 由 getSick() 单独取出来交给引擎，见 plan.planInputs。
const STATUSES = [
  { key: 'refuse', label: '不肯吃' },
  { key: 'constipation', label: '便秘' },
  { key: 'loose', label: '大便稀' },
  { key: 'iron', label: '缺铁 / 贫血' },
  { key: 'allergy', label: '疑似过敏' },
  { key: 'sick', label: '生病中' }
]

const SICK_KEY = 'sick'

function isStatusKey(k) {
  for (let i = 0; i < STATUSES.length; i++) {
    if (STATUSES[i].key === k) return true
  }
  return false
}

function statusLabel(key) {
  for (let i = 0; i < STATUSES.length; i++) {
    if (STATUSES[i].key === key) return STATUSES[i].label
  }
  return ''
}

/** 多选状态 → 展示文案；没勾任何项就是「正常」 */
function statusLabels(keys) {
  if (!keys || !keys.length) return '正常'
  const out = []
  for (let i = 0; i < keys.length; i++) {
    const l = statusLabel(keys[i])
    if (l && out.indexOf(l) < 0) out.push(l)
  }
  return out.length ? out.join('、') : '正常'
}

/* ---------- 排它选项：状态正常 ---------- */

// key 故意用一个 STATUSES 里永远不会有的形式 —— 即便误传进 setStatuses，
// isStatusKey() 也会把它滤掉，不会污染 bb_status。
const OK_KEY = '__normal__'
const OK_LABEL = '状态正常'

/**
 * 「宝宝状态怎么样」卡的选项列表，「状态正常」恒在第一位。
 *
 * @param {string[]} sel 不传则读本地存储；传了就不碰 wx（自检脚本在裸 node 下调用）
 *
 * 「状态正常」的 on = (sel.length === 0)，所以它和所有真状态**天然互斥**：
 * 勾它 → 空数组 → 它亮；勾任意真状态 → 非空 → 它灭。不需要额外的互斥逻辑。
 */
function statusOptions(sel) {
  const s = Array.isArray(sel) ? sel : getStatuses()
  const out = [{ key: OK_KEY, label: OK_LABEL, on: s.length === 0 }]
  for (let i = 0; i < STATUSES.length; i++) {
    out.push({
      key: STATUSES[i].key,
      label: STATUSES[i].label,
      on: s.indexOf(STATUSES[i].key) >= 0
    })
  }
  return out
}

/**
 * 点一下某项之后应当写入的新状态集合（纯逻辑，页面只负责调用 + 刷新）。
 *
 * @param {string} key
 * @param {string[]} sel 不传则读本地存储
 */
function toggleStatus(key, sel) {
  const cur = (Array.isArray(sel) ? sel : getStatuses()).slice()
  if (key === OK_KEY) return []          // 状态正常 = 清空全部
  const at = cur.indexOf(key)
  if (at >= 0) cur.splice(at, 1)         // 已勾 → 取消
  else cur.push(key)                     // 未勾 → 勾上
  return cur
}

/** 启动时初始化，避免各页面重复判空 */
function ensureInit() {
  if (!Array.isArray(wx.getStorageSync(KEYS.INTRO))) wx.setStorageSync(KEYS.INTRO, [])

  // 状态从旧版单选迁过来：老用户勾过的问题 / 生病状态不能被静默丢掉。
  // 判据是「是不是数组」而不是「是不是空」—— 用户主动清空成 [] 也算迁移完成，
  // 否则每次启动都会拿旧字段把它填回去。
  if (!Array.isArray(wx.getStorageSync(KEYS.STATUS))) {
    const migrated = []
    const oldIssue = wx.getStorageSync(KEYS.LEGACY_ISSUE)
    if (oldIssue && oldIssue !== 'none') migrated.push(oldIssue)
    if (wx.getStorageSync(KEYS.LEGACY_SICK)) migrated.push(SICK_KEY)
    wx.setStorageSync(KEYS.STATUS, migrated.filter(isStatusKey))
  }
}

/* ---------- 当前状态（多选） ---------- */

/** 选中的全部状态 key，永远是合法 key 组成的数组 */
function getStatuses() {
  const list = wx.getStorageSync(KEYS.STATUS)
  if (!Array.isArray(list)) return []
  return list.filter(isStatusKey)
}

function setStatuses(list) {
  wx.setStorageSync(KEYS.STATUS, (Array.isArray(list) ? list : []).filter(isStatusKey))
}

/** 参与「加权随机」的问题状态（不含生病 —— 生病是硬开关，见下） */
function getIssues() {
  return getStatuses().filter(function (k) { return k !== SICK_KEY })
}

/**
 * 宝宝是否生病中。
 *
 * 依据 WS/T 678—2020《婴幼儿辅食添加营养指南》3.8：
 *   「患病期间暂停添加新的辅食。除特殊情况外，鼓励进食易消化且营养丰富的辅食。
 *     病愈后，及时恢复正常饮食。」
 *
 * 所以生病期间：不排新食材引入，但常规菜谱照排（且应偏向易消化的）。
 * 它在界面上只是状态多选里的一项，但语义是硬开关 —— planInputs 会把它
 * 单独拆出来，别当成普通问题丢给加权。
 */
function getSick() {
  return getStatuses().indexOf(SICK_KEY) >= 0
}

/* ---------- 宝宝档案 ---------- */

/* 名称上限。档案摘要、状态行都要跟生日挤在同一行，太长会把布局撑破 */
const BABY_NAME_MAX = 12

function getBaby() {
  return wx.getStorageSync(KEYS.BABY) || null
}

/** 名称清洗：压掉换行/连续空格、去首尾、截断到上限 */
function sanitizeBabyName(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return s.replace(/\s+/g, ' ').trim().slice(0, BABY_NAME_MAX)
}

/**
 * 更新宝宝档案。
 *
 * 必须是**字段级合并**，不能整体覆盖：档案页有两个独立控件
 * （名称输入框、生日选择器），各自只写自己那个字段。若这里直接
 * setStorageSync(整个对象)，用户先填名称、再改生日，先前的名字
 * 就被 setBaby({ birthday }) 整个抹掉了。
 *
 * 只有传 null 才表示清空整个档案（resetAll 走 removeStorageSync）。
 */
function setBaby(patch) {
  if (patch === null || patch === undefined) {
    wx.setStorageSync(KEYS.BABY, null)
    return
  }
  const cur = wx.getStorageSync(KEYS.BABY) || {}
  const next = { name: cur.name, birthday: cur.birthday }
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    next.name = sanitizeBabyName(patch.name)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'birthday')) {
    next.birthday = patch.birthday
  }
  wx.setStorageSync(KEYS.BABY, next)
}

/** 还差哪些必填项（返回空数组 = 已配置）。
 *  名称和出生日期都是必填。首页空状态、我的页文案都读这一处 ——
 *  别在页面里各判各的，否则两页会对「填没填完」给出不同答案。 */
function missingFields() {
  const b = getBaby() || {}
  const miss = []
  if (!b.name) miss.push('宝宝名称')
  if (!b.birthday) miss.push('出生日期')
  return miss
}

function isConfigured() {
  return missingFields().length === 0
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
  wx.removeStorageSync(KEYS.STATUS)
  wx.removeStorageSync(KEYS.PLAN)
  // 旧版字段一起清：否则清完之后 ensureInit 会拿它们把状态原样迁回来。
  // （此前这里漏了 bb_sick —— 「清除全部数据」后生病状态仍残留）
  wx.removeStorageSync(KEYS.LEGACY_ISSUE)
  wx.removeStorageSync(KEYS.LEGACY_SICK)
}

module.exports = {
  KEYS: KEYS,
  OBSERVE_DAYS: OBSERVE_DAYS,
  STATUSES: STATUSES,
  OK_KEY: OK_KEY,
  OK_LABEL: OK_LABEL,
  statusLabel: statusLabel,
  statusLabels: statusLabels,
  statusOptions: statusOptions,
  toggleStatus: toggleStatus,
  ensureInit: ensureInit,
  BABY_NAME_MAX: BABY_NAME_MAX,
  sanitizeBabyName: sanitizeBabyName,
  getBaby: getBaby,
  setBaby: setBaby,
  isConfigured: isConfigured,
  missingFields: missingFields,
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
  getStatuses: getStatuses,
  setStatuses: setStatuses,
  getIssues: getIssues,
  getSick: getSick,
  getPlan: getPlan,
  setPlan: setPlan,
  todayStr: todayStr,
  resetAll: resetAll
}
