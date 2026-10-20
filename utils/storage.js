/**
 * 本地存储封装
 *
 * MVP 阶段不依赖云开发，所有数据存在本机。
 * 后续要接虚拟支付时，只需要把这里的实现换成云函数调用，页面层不用改。
 *
 * 换机不丢数据（v2.31）：不做云同步，靠「导出/导入」手动备份 ——
 * 备份文本经用户自己的手转存（微信聊天/收藏），本模块只负责打包与校验，
 * 不联网（隐私口径「未采集」不变，见文件末尾 数据备份 一节）。
 */

const KEYS = {
  BABY: 'bb_baby',        // { name, birthday, foodStart?, sex?, birthWeight?, birthLength?, note? }
                          //   date 之外全选填：foodStart = 首次辅食日期（v2.32 双时钟）；
                          //   sex/birthWeight/birthLength = 成长曲线前置（v3.0 批①）；
                          //   note = 一句话描述（v3.0 批⑨，首页头卡个性行）
  INTRO: 'bb_introduced', // [{ foodId, date, status }]  status: safe | bad（v2.30 起 observing 绝版，读取时迁移为 safe）
  STATUS: 'bb_status',    // [keys] 当前状态，可多选（合法 key 见 STATUSES）
  PLAN: 'bb_plan',        // { generatedAt, months, stageKey, days, shopping }
  MEALS: 'bb_meals',      // [{ date, recipeId, status, reaction, at }] 每餐打卡（v2.1）
  GROWTH: 'bb_growth',    // [{ date, weight, length, head? }] 生长测量记录（v3.0 成长曲线）
  PHOTO: 'bb_photo',      // 照片文件路径（v3.0 批⑦，选填）—— 只记路径，图是本机文件

  // 旧版单选字段，只用于把老用户的设置迁移进 bb_status（见 ensureInit）
  LEGACY_ISSUE: 'bb_issue',
  LEGACY_SICK: 'bb_sick'
}

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

/** 默认名「宝贝 + 4 位编号」（v3.1 · 用户 2026-10-19 拍板）：
 *  首次进入弹窗用它预填，用户可以直接改，也可以不改。
 *
 *  ⚠️ 只生成一次、必须落库 —— 调用方拿到就 setBaby({ name })。
 *  每次启动重算会让「宝贝8943」变成「宝贝1207」，用户一眼看出是假的。
 *
 *  1000 + rand*9000 = 四位且无前导零（「宝贝0007」读起来像 bug）。
 *  本地单用户场景不查重：同一台设备只有一份档案，撞号没有语义。 */
function defaultBabyName() {
  return '宝贝' + (1000 + Math.floor(Math.random() * 9000))
}

/** 性别（v3.0 成长曲线前置字段，选填）：'m' | 'f' | ''（空 = 没填）。
 *  WHO 百分位表分男女两套 —— 没填时曲线页只出记录、不出百分位，
 *  空值是合法状态，不拦建档、不进计划指纹。 */
function sanitizeSex(v) {
  return v === 'm' || v === 'f' ? v : ''
}

/* 出生指标（v3.0，选填）：区间外一律当「没填」—— 手滑打错（170cm 身长、
   3.2g 体重）宁可空着，也不让脏值进库画出假曲线。归一到 1 位小数。
   区间按用户 2026-10-16 拍板放宽：出生体重**大于 2 kg 且小于 15 kg**（端点不算，
   2.0 与 15.0 都按越界拒收）、出生身长 20–70 cm（含端点，用户没让动）。
   下限从 3 放到 2，是为了让低出生体重宝宝（2.0–3.0 那一段）也能建档；
   配合档案页「打字期不归一、blur 再校验」一起，修掉「身长 50 打到 5 就被清空、
   永远填不进」的受控输入 bug（§6x-16 钉）。 */
const BIRTH_WEIGHT_MIN = 2     // kg，严格大于（端点拒收）
const BIRTH_WEIGHT_MAX = 15    // kg，严格小于（端点拒收）
const BIRTH_LENGTH_MIN = 20    // cm，含
const BIRTH_LENGTH_MAX = 70    // cm，含

function sanitizeBirthMetric(v, min, max, strict) {
  if (v === '' || v === null || v === undefined) return ''
  const n = Number(v)
  if (!isFinite(n)) return ''
  // strict 只给出生体重用：用户口径是「大于 2 且小于 15」，端点不算；
  // 出生身长沿用含端点的 20–70
  if (strict ? (n <= min || n >= max) : (n < min || n > max)) return ''
  return Math.round(n * 10) / 10
}

/* 一句话描述（v3.0 批⑨，选填）：首页头卡「是个爱笑的小家伙。」那种个性行。
   压掉换行/连续空格、去首尾、截断上限 —— 用户自己的话，不拦建档、不进指纹。 */
const BABY_NOTE_MAX = 24

function sanitizeBabyNote(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return s.replace(/\s+/g, ' ').trim().slice(0, BABY_NOTE_MAX)
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
  const next = {
    name: cur.name, birthday: cur.birthday, foodStart: cur.foodStart,
    sex: cur.sex, birthWeight: cur.birthWeight, birthLength: cur.birthLength,
    note: cur.note
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    next.name = sanitizeBabyName(patch.name)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'birthday')) {
    next.birthday = patch.birthday
  }
  // 首次辅食日期（v2.32 双时钟）：选填；空串 = 没填/清除，
  // foodMonthsOf 对空值自动回退生理月龄（= 现状）
  if (Object.prototype.hasOwnProperty.call(patch, 'foodStart')) {
    next.foodStart = patch.foodStart || ''
  }
  // 性别与出生指标（v3.0 成长曲线前置字段，全选填）：性别是 WHO 百分位表的
  // 取表条件，出生指标兼作曲线的第一条锚点。三项都不进计划指纹 ——
  // 改它们绝不触发计划重算（§6x 钉）。
  if (Object.prototype.hasOwnProperty.call(patch, 'sex')) {
    next.sex = sanitizeSex(patch.sex)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'birthWeight')) {
    next.birthWeight = sanitizeBirthMetric(patch.birthWeight, BIRTH_WEIGHT_MIN, BIRTH_WEIGHT_MAX, true)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'birthLength')) {
    next.birthLength = sanitizeBirthMetric(patch.birthLength, BIRTH_LENGTH_MIN, BIRTH_LENGTH_MAX)
  }
  // 一句话描述（v3.0 批⑨，选填，首页头卡个性行）：不进计划指纹
  if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
    next.note = sanitizeBabyNote(patch.note)
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
  const arr = Array.isArray(list) ? list : []
  // v2.30 · 3 天观察期规则整体删除（用户决策）：存量 observing 记录读到时
  // 一次性升为 safe（＝已经吃过、确认没问题）。此后 markIntroduced 只写
  // safe，observing 从这里开始绝版（_validate §6u 反向钉 + 迁移实跑）。
  let changed = false
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].status === 'observing') {
      arr[i].status = 'safe'
      changed = true
    }
  }
  if (changed) setIntroduced(arr)
  return arr
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

/** 标记「今天给宝宝吃了这个」→ 已吃过、确认没问题（safe）。
 *  v2.30：3 天观察期已删 —— 致敏食材同样勾选即 safe（用户决策），观察分支绝版。 */
function markIntroduced(foodId, dateStr) {
  const list = getIntroduced()
  const exist = findIntro(foodId)
  // ⚠️ 「有反应」(bad) 是唯一的永久排除机制，任何路径都不得覆写它（H-2）。
  // 详情页已藏掉 bad 状态下的按钮，这里是最后一道防线：bad 记录只能经
  // removeIntroduced（用户显式「清除记录」）解除，否则一次点按就能把
  // 过敏食材洗白成「已吃过」，连反应日期都会被覆写丢失。
  if (exist && exist.status === 'bad') return false
  const today = dateStr || todayStr()
  if (exist) {
    exist.date = today
    exist.status = 'safe'
  } else {
    list.push({ foodId: foodId, date: today, status: 'safe' })
  }
  setIntroduced(list)
  return true
}

/** 由用户确认结果（bad 只进不出：解除只能走 removeIntroduced） */
function setIntroStatus(foodId, status) {
  const list = getIntroduced()
  for (let i = 0; i < list.length; i++) {
    if (list[i].foodId !== foodId) continue
    // bad 只进不出：safe→bad（标记过敏）放行；bad→safe 拒绝，
    // 解除只走 removeIntroduced（见 _validate.js §6j）
    if (list[i].status === 'bad' && status !== 'bad') return false
    list[i].status = status
  }
  setIntroduced(list)
  return true
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

/**
 * 「观察中」名单 —— v2.30 观察期规则删除后恒为空（observing 绝版）。
 * 保留只为 planInputs 的指纹契约：planSignature 对它必须敏感（_validate §6b 钉），
 * 引擎侧 observingCount 的「一次只引入一种」暂停语义也照旧（§6s G）。
 */
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

/** 所有记录过的食材（含已吃过和有反应） */
function recordedFoodIds() {
  return getIntroduced().map(function (it) { return it.foodId })
}

// dueObservations（观察期到期名单）已随 3 天观察期规则整体删除（v2.30 用户决策）：
// 观察卡、首页到期提醒一并移除，这个函数没有调用方了 —— 别加回来（§6u 反向钉）。

/* ---------- 当前计划 ---------- */

function getPlan() {
  return wx.getStorageSync(KEYS.PLAN) || null
}

function setPlan(plan) {
  wx.setStorageSync(KEYS.PLAN, plan || null)
}

/* ---------- 每餐打卡记录（v2.1） ---------- */

/**
 * [{ date, recipeId, status, reaction, at }]
 *   status: 'full'(吃完了) | 'some'(吃一些) | 'refused'(没吃) | 'reaction'(有反应)
 *   reaction: 引发反应的食材 id（仅 status==='reaction' 时有值）
 * 同 (date, recipeId) 只保留一条；status 传 null = 撤销这条打卡。
 * 引擎回写输入：连续拒吃的菜降权（refusedRecipeIds → plan.pickWeighted）。
 */
function getMealLogs() {
  const raw = wx.getStorageSync(KEYS.MEALS)
  return Array.isArray(raw) ? raw : []
}

function logMeal(date, recipeId, status, reactionFoodId) {
  const list = getMealLogs().filter(function (it) {
    return !(it.date === date && it.recipeId === recipeId)
  })
  if (status) {
    list.push({
      date: date,
      recipeId: recipeId,
      status: status,
      reaction: reactionFoodId || '',
      at: Date.now()
    })
  }
  wx.setStorageSync(KEYS.MEALS, list)
}

/**
 * 「连续拒吃」名单（软降权，不是禁排）：近 7 天同一道菜累计 2 次「没吃」，
 * 且最后一次「没吃」之后没再吃过（full/some 都算吃过）→ 进名单；
 * 吃一次自动解除。日期是 YYYY-MM-DD，字符串比较即时间比较。
 */
function refusedRecipeIds(now) {
  const n = now || new Date()
  const fromKey = todayStr(new Date(n.getTime() - 7 * 86400000))
  const byId = {}
  getMealLogs().forEach(function (e) {
    if (e.date < fromKey) return
    ;(byId[e.recipeId] = byId[e.recipeId] || []).push(e)
  })
  const out = []
  Object.keys(byId).forEach(function (rid) {
    const arr = byId[rid].slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return (a.at || 0) - (b.at || 0)
    })
    let lastRef = -1
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].status === 'refused') lastRef = i
    }
    if (lastRef < 1) return
    let refusals = 0
    for (let i = 0; i <= lastRef; i++) if (arr[i].status === 'refused') refusals++
    if (refusals < 2) return
    for (let i = lastRef + 1; i < arr.length; i++) {
      if (arr[i].status === 'full' || arr[i].status === 'some') return
    }
    out.push(rid)
  })
  return out
}

/* ---------- 其他 ---------- */

/* ---------- 生长测量记录（v3.0 · 成长曲线批①） ---------- */

/* 三条指标的区间与单位。越界一律整条拒收 —— 手滑打错单位（把 170cm 身长
   当体重录进来）宁可不存，也不让脏值在曲线上画出一根假线。 */
const GROWTH_METRICS = {
  weight: { min: 0.3, max: 40, unit: 'kg' }, // 0–60 月龄 WHO 体重上限 <25kg，40 留足余量
  length: { min: 30, max: 130, unit: 'cm' }, // 新生儿 ~50cm，24 月 ~90cm，130 封顶
  head: { min: 25, max: 60, unit: 'cm' }     // 新生儿 ~34cm，头围只做选填项
}

/** 清洗单条记录：日期格式对、至少一项指标有值且都在区间内才返回归一化条目，
 *  否则返回 null（整条丢弃）。数值归一到 1 位小数，同日覆写交由调用方处理。 */
function cleanGrowthEntry(it) {
  if (!it || typeof it !== 'object') return null
  const date = String(it.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const out = { date: date }
  let any = false
  Object.keys(GROWTH_METRICS).forEach(function (k) {
    if (it[k] === undefined || it[k] === null || it[k] === '') return
    const n = Number(it[k])
    const m = GROWTH_METRICS[k]
    if (!isFinite(n) || n < m.min || n > m.max) return // 单项越界：丢这一项，不影响其它项
    out[k] = Math.round(n * 10) / 10
    any = true
  })
  return any ? out : null
}

/** 全部生长记录，恒按 date 升序。读到脏条目会清洗并回写（一次性自愈），
 *  与 getIntroduced 的 observing→safe 迁移同思路。 */
function getGrowth() {
  const raw = wx.getStorageSync(KEYS.GROWTH)
  if (!Array.isArray(raw)) return []
  const byDate = {}
  let changed = false
  raw.forEach(function (it) {
    const c = cleanGrowthEntry(it)
    if (!c) { changed = true; return }
    if (byDate[c.date]) changed = true // 同日重复：留后一条
    byDate[c.date] = c
  })
  const out = Object.keys(byDate).sort().map(function (d) { return byDate[d] })
  if (changed || out.length !== raw.length) setGrowth(out) // 自愈回写
  return out
}

function setGrowth(list) {
  const byDate = {}
  ;(Array.isArray(list) ? list : []).forEach(function (it) {
    const c = cleanGrowthEntry(it)
    if (c) byDate[c.date] = c
  })
  const out = Object.keys(byDate).sort().map(function (d) { return byDate[d] })
  wx.setStorageSync(KEYS.GROWTH, out)
}

/** 记一条测量（同日覆写）。日期闸门：不晚于今天、不早于出生日期 ——
 *  曲线横轴是日龄，未来点/出生前点画不进 0–60 月的图。
 *  注意不挡「没性别」：记录先攒着，补填性别后照样能算百分位。
 *  @returns {boolean} false = 被拒，没写库 */
function upsertGrowthRecord(rec) {
  const c = cleanGrowthEntry(rec)
  if (!c) return false
  const today = todayStr()
  if (c.date > today) return false
  const baby = getBaby()
  if (baby && baby.birthday && c.date < baby.birthday) return false
  const list = getGrowth().filter(function (it) { return it.date !== c.date })
  list.push(c)
  setGrowth(list)
  return true
}

function removeGrowthRecord(date) {
  setGrowth(getGrowth().filter(function (it) { return it.date !== date }))
}

function todayStr(d) {
  const n = d || new Date()
  const mm = n.getMonth() + 1
  const dd = n.getDate()
  return n.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd)
}

/* ---------- 宝宝照片（v3.0 批⑦ · 用户 2026-10-15 拍板：头卡贴纸可传一张真照片）----------
 * chooseMedia 给的是临时文件（会话结束即失效），必须落盘才跨启动存活：
 *   固定路径 USER_DATA_PATH/baby-photo.jpg ——「只存一张」由固定文件名保证，
 *   新照片先删旧文件再覆盖，storage 里只记路径。
 * 纯本机：文件不上传、不联网（隐私口径不变）；**不进备份信封** —— 图是二进制，
 * 文本信封装不下，换机后让用户重选一张即可（resetAll 连文件一起删）。 */
const PHOTO_NAME = 'baby-photo.jpg'

function photoPath() {
  const base = (wx.env && wx.env.USER_DATA_PATH) || ''
  return base + '/' + PHOTO_NAME
}

function getBabyPhoto() {
  const p = wx.getStorageSync(KEYS.PHOTO)
  return typeof p === 'string' ? p : ''
}

/** 选中的临时照片 → 本机固定路径。同步落盘，返回落盘路径；失败返回 ''
 *  （调用方保留旧照/占位，不留死图）。 */
function saveBabyPhoto(tempFilePath) {
  if (!tempFilePath) return ''
  try {
    const fs = wx.getFileSystemManager()
    const dest = photoPath()
    try { fs.unlinkSync(dest) } catch (e) { /* 还没有旧图，忽略 */ }
    fs.copyFileSync(tempFilePath, dest)
    wx.setStorageSync(KEYS.PHOTO, dest)
    return dest
  } catch (e) {
    return ''
  }
}

/** 移除照片：文件与路径一起清（文件不在时只清路径）。 */
function clearBabyPhoto() {
  try {
    const dest = wx.getStorageSync(KEYS.PHOTO)
    if (dest) wx.getFileSystemManager().unlinkSync(dest)
  } catch (e) { /* 文件已不在，只清路径 */ }
  wx.removeStorageSync(KEYS.PHOTO)
}

function resetAll() {
  wx.removeStorageSync(KEYS.BABY)
  wx.removeStorageSync(KEYS.INTRO)
  wx.removeStorageSync(KEYS.STATUS)
  wx.removeStorageSync(KEYS.PLAN)
  wx.removeStorageSync(KEYS.MEALS)
  wx.removeStorageSync(KEYS.GROWTH)
  clearBabyPhoto() // 照片连本机文件一起删（v3.0 批⑦）—— 只删 key 会留孤儿文件
  // 旧版字段一起清：否则清完之后 ensureInit 会拿它们把状态原样迁回来。
  // （此前这里漏了 bb_sick —— 「清除全部数据」后生病状态仍残留）
  wx.removeStorageSync(KEYS.LEGACY_ISSUE)
  wx.removeStorageSync(KEYS.LEGACY_SICK)
}

/* ---------- 数据备份：导出 / 导入（v2.31 · 方案A 零后端） ----------
 * 换机/换账号/重装微信都不丢数据 —— 平台层救不了（微信官方换机迁移
 * 不带小程序数据），所以让备份文本跟着人走：
 *   换机流程：老手机导出（复制到剪贴板）→ 自己粘到微信聊天/收藏存好
 *             → 新手机打开小程序 → 粘贴导入。
 *
 * 隐私口径不变（问卷仍填「未采集」）：程序只提供复制/粘贴两个动作，
 * 不上传、不联网 —— 备份文本经用户自己的手转存（§6v 钉无网络调用）。
 *
 * 导出 = 5 个用户数据 key 打成一段带信封的 JSON 文本：
 *   baby / statuses / introduced / mealLogs / growth（v3.0 成长曲线）
 * bb_plan 是派生缓存，**不进备份**：导入后清空强制重算（§6v 钉）。
 * bb_photo（v3.0 批⑦ 照片路径）也**不进备份**：图是本机二进制、路径换机
 * 必失效，文本信封装不下 —— 换机后在头卡重选一张即可（§6x-16 实跑钉）。
 *
 * 导入 = 粘贴文本 → 信封校验（app 标记 + fmt 版本，防误粘贴别的 JSON）
 *   → 逐字段清洗（脏条目丢弃）→ 整包覆盖写入。导入前页面必须弹确认框
 *   （导入 = 整包替换，§6v 钉 showModal）。
 */
const BACKUP_MARK = 'choubao-fushi'
const BACKUP_FMT = 2          // v3.0：新增 growth 段，fmt 从 1 升到 2
const BACKUP_FMT_MIN = 1      // 允许导入的最低 fmt —— 老备份（fmt 1）要能照常导，不逼老用户重录

/** 是不是本小程序的备份文本（导入前的预检，页面拿它决定弹不弹确认框） */
function isBackupText(text) {
  try {
    const pack = JSON.parse(String(text || ''))
    return !!(pack && pack.app === BACKUP_MARK &&
      pack.fmt >= BACKUP_FMT_MIN && pack.fmt <= BACKUP_FMT)
  } catch (e) { return false }
}

function exportUserData() {
  ensureInit()
  return JSON.stringify({
    app: BACKUP_MARK,
    fmt: BACKUP_FMT,
    at: Date.now(),
    baby: getBaby(),
    // getStatuses 自带合法 key 过滤，导出侧就干净
    statuses: getStatuses(),
    introduced: getIntroduced(),
    mealLogs: getMealLogs(),
    growth: getGrowth() // v3.0 成长曲线记录
  })
}

function importUserData(text) {
  if (!isBackupText(text)) return false
  const pack = JSON.parse(String(text))

  // 逐字段清洗：档案只认 name/birthday/foodStart/sex/birthWeight/birthLength/note
  // （与 setBaby 同一套白名单）；状态只认合法 key；引入记录只认
  // {foodId, date, status∈safe|bad}（observing 一并升 safe —— 与 v2.30 读取
  // 迁移同口径，observing 绝版）；打卡只认 {date, recipeId, status, reaction, at}。
  // 生长记录（v3.0）走 cleanGrowthEntry：日期格式对 + 至少一项指标在区间内。
  // 脏条目直接丢弃。
  const baby = (pack.baby && typeof pack.baby === 'object')
    ? {
        name: sanitizeBabyName(pack.baby.name),
        birthday: typeof pack.baby.birthday === 'string' ? pack.baby.birthday : '',
        foodStart: typeof pack.baby.foodStart === 'string' ? pack.baby.foodStart : '',
        sex: sanitizeSex(pack.baby.sex),
        birthWeight: sanitizeBirthMetric(pack.baby.birthWeight, BIRTH_WEIGHT_MIN, BIRTH_WEIGHT_MAX, true),
        birthLength: sanitizeBirthMetric(pack.baby.birthLength, BIRTH_LENGTH_MIN, BIRTH_LENGTH_MAX),
        note: sanitizeBabyNote(pack.baby.note)
      }
    : null
  const statuses = (Array.isArray(pack.statuses) ? pack.statuses : []).filter(isStatusKey)
  const introduced = (Array.isArray(pack.introduced) ? pack.introduced : [])
    .filter(function (it) { return it && it.foodId && it.date })
    .map(function (it) {
      return {
        foodId: String(it.foodId),
        date: String(it.date),
        status: it.status === 'bad' ? 'bad' : 'safe'
      }
    })
  const meals = (Array.isArray(pack.mealLogs) ? pack.mealLogs : [])
    .filter(function (it) { return it && it.date && it.recipeId })
    .map(function (it) {
      return {
        date: String(it.date),
        recipeId: String(it.recipeId),
        status: it.status || 'full',
        reaction: it.reaction || '',
        at: typeof it.at === 'number' ? it.at : 0
      }
    })

  // 整包覆盖（导入语义 = 替换，不是合并）；派生缓存一并清掉，
  // 旧计划是按旧数据生成的，必须重算。
  // v3.0 fmt 1 老备份没有 growth 字段 → 落成空数组（页面判空口径统一，
  // 也别把老备份当成「有生长数据但全空」的歧义状态）。
  const growth = (Array.isArray(pack.growth) ? pack.growth : [])
    .map(cleanGrowthEntry)
    .filter(function (c) { return !!c })

  wx.setStorageSync(KEYS.BABY, baby)
  wx.setStorageSync(KEYS.STATUS, statuses)
  wx.setStorageSync(KEYS.INTRO, introduced)
  wx.setStorageSync(KEYS.MEALS, meals)
  wx.setStorageSync(KEYS.GROWTH, growth)
  wx.setStorageSync(KEYS.PLAN, null)
  return true
}

module.exports = {
  KEYS: KEYS,
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
  defaultBabyName: defaultBabyName,
  getBaby: getBaby,
  setBaby: setBaby,
  sanitizeSex: sanitizeSex,
  sanitizeBirthMetric: sanitizeBirthMetric,
  BABY_NOTE_MAX: BABY_NOTE_MAX,
  sanitizeBabyNote: sanitizeBabyNote,
  BIRTH_WEIGHT_MIN: BIRTH_WEIGHT_MIN,
  BIRTH_WEIGHT_MAX: BIRTH_WEIGHT_MAX,
  BIRTH_LENGTH_MIN: BIRTH_LENGTH_MIN,
  BIRTH_LENGTH_MAX: BIRTH_LENGTH_MAX,
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
  getStatuses: getStatuses,
  setStatuses: setStatuses,
  getIssues: getIssues,
  getSick: getSick,
  getPlan: getPlan,
  setPlan: setPlan,
  getGrowth: getGrowth,
  setGrowth: setGrowth,
  upsertGrowthRecord: upsertGrowthRecord,
  removeGrowthRecord: removeGrowthRecord,
  cleanGrowthEntry: cleanGrowthEntry,
  GROWTH_METRICS: GROWTH_METRICS,
  getBabyPhoto: getBabyPhoto,
  saveBabyPhoto: saveBabyPhoto,
  clearBabyPhoto: clearBabyPhoto,
  getMealLogs: getMealLogs,
  logMeal: logMeal,
  refusedRecipeIds: refusedRecipeIds,
  todayStr: todayStr,
  resetAll: resetAll,
  isBackupText: isBackupText,
  exportUserData: exportUserData,
  importUserData: importUserData
}
