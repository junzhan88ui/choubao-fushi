/**
 * 月龄计算与辅食阶段映射
 *
 * 说明：这里的月龄分段与性状对应关系，是辅食添加领域的通行做法
 * （6 月龄起加辅食、由细到粗、由稀到稠）。产品内所有相关文案
 * 都必须标注「参考公开喂养指南，具体请遵医嘱」。
 */

// 辅食最早引入月龄。早于这个月龄，本产品不给任何建议。
const MIN_MONTH = 6

// 当前版本的内容覆盖上限。超过这个月龄，菜谱库会匹配不到东西，
// 必须显式提示「超出覆盖范围」，而不是静默给出一份空计划。
const CONTENT_MAX = 24

// 阶段定义：月龄区间 → 性状档位（v2.9 起「每日餐次」从这里拆出去，见 mealsForMonth：
// 餐次按月龄逐月对齐知识卡与固定菜单，不再绑在性状阶段上）
const STAGES = [
  { key: 'puree', label: '细泥', min: 6, max: 7, desc: '刚起步，一天 1–2 餐，从强化铁米粉开始' },
  { key: 'thick', label: '稠糊 / 带颗粒', min: 8, max: 9, desc: '一天 2 餐，质地加稠、留一点颗粒' },
  { key: 'mince', label: '碎末 / 小丁', min: 10, max: 12, desc: '一天 2–3 餐，练咀嚼，可以自己抓着吃' },
  { key: 'junior', label: '小丁 / 小块', min: 13, max: 24, desc: '一天 3 餐，逐步接近成人食物（仍然少盐）' }
]

/**
 * 每日正餐餐次（v2.9 · 与固定菜单逐月对齐）。
 * 依据两处已确认口径：
 *   - data/guides.js 分月知识卡：7 月「每天 2 次」、8–9 月「每天 2 次」、
 *     10–11 月「2–3 次」、12 月「每天 3 次」（6 月卡按 1 餐起步）；
 *   - docs/月度辅食计划-存档.md 固定菜单正餐列：6 月 1 列、7–11 月 2 列、12 月起 3 列。
 * 10–11 月从原来的 3 餐改为 2 餐，12 月起恢复 3 餐（用户决策③）。
 */
function mealsForMonth(months) {
  if (months <= 6) return 1
  if (months <= 11) return 2
  return 3
}

/**
 * 每天的时段锚点（v2.9 · 方案A「含奶参考行」，用户已看模拟页确认）。
 * 列结构取固定菜单各月龄的实际列数：6–9 月 6 列、10–11 月 5 列、12 月起 4 段。
 * kind：milk = 奶参考行（只标时段，不排菜不打卡）/ main = 正餐 / snack = 加餐。
 * 约束（_validate §6q 钉死）：main 槽数 === mealsForMonth(months)，snack 恒 1 槽。
 */
function slotsForMonth(months) {
  if (months <= 6) return [
    { time: '07:00', kind: 'milk' },
    { time: '10:00', kind: 'main', label: '上午正餐', withMilk: true },
    { time: '13:00', kind: 'milk' },
    { time: '15:00', kind: 'snack', label: '加餐' },
    { time: '16:00', kind: 'milk' },
    { time: '19:00', kind: 'milk' }
  ]
  if (months === 7) return [
    { time: '07:00', kind: 'milk' },
    { time: '10:00', kind: 'main', label: '上午正餐', withMilk: true },
    { time: '13:00', kind: 'milk' },
    { time: '15:30', kind: 'snack', label: '加餐' },
    { time: '17:00', kind: 'main', label: '傍晚正餐' },
    { time: '19:00', kind: 'milk' }
  ]
  if (months <= 9) return [ // 8–9 月：同 7 月，17:00 那顿也是「辅食 + 奶」
    { time: '07:00', kind: 'milk' },
    { time: '10:00', kind: 'main', label: '上午正餐', withMilk: true },
    { time: '13:00', kind: 'milk' },
    { time: '15:30', kind: 'snack', label: '加餐' },
    { time: '17:00', kind: 'main', label: '傍晚正餐', withMilk: true },
    { time: '19:00', kind: 'milk' }
  ]
  if (months <= 11) return [ // 10–11 月：5 列（减奶增饭，正餐列是纯辅食）
    { time: '07:00', kind: 'milk' },
    { time: '10:00', kind: 'main', label: '上午正餐' },
    { time: '13:00', kind: 'milk' },
    { time: '15:30', kind: 'snack', label: '加餐' },
    { time: '18:00', kind: 'main', label: '晚餐' }
  ]
  // 12–24 月：4 段，三餐向大人时间同步（13–24 月龄套 12 月节律）
  return [
    { time: '07:00', kind: 'main', label: '早餐' },
    { time: '11:00', kind: 'main', label: '午餐' },
    { time: '15:00', kind: 'snack', label: '加餐' },
    { time: '18:00', kind: 'main', label: '晚餐' }
  ]
}

/**
 * 计算月龄（整月）
 * @param {string} birthday 生日字符串，如 '2026-05-20'
 * @param {Date} [now]
 * @returns {number|null} 月龄；生日非法时返回 null
 */
function monthsBetween(birthday, now) {
  if (!birthday) return null
  const b = new Date(birthday)
  if (isNaN(b.getTime())) return null
  const n = now || new Date()
  let m = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth())
  if (n.getDate() < b.getDate()) m -= 1
  return Math.max(0, m)
}

/**
 * 根据月龄取阶段信息
 *
 * 注意：月龄 < 6 或 > 24 时都会返回 null。调用方**不要**把 null 直接
 * 理解为「太小了」——请改用 getAgeStatus()，它会区分这两种情况。
 *
 * @returns {object|null}
 */
function getStage(months) {
  if (months === null || months === undefined) return null
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i]
    if (months >= s.min && months <= s.max) return s
  }
  return null
}

/**
 * 判断月龄状态（推荐所有页面用这个，而不是裸调 getStage）
 *
 * @returns {{status:'unknown'|'too_young'|'ok'|'out_of_range', stage:object|null, months:number|null}}
 *   unknown      生日没填或非法
 *   too_young    还没到 6 月龄，不给任何辅食建议
 *   ok           在内容覆盖范围内
 *   out_of_range 已超过 24 月龄，超出当前版本内容范围
 */
function getAgeStatus(months) {
  if (months === null || months === undefined || isNaN(months)) {
    return { status: 'unknown', stage: null, months: null }
  }
  if (months < MIN_MONTH) {
    return { status: 'too_young', stage: null, months: months }
  }
  if (months > CONTENT_MAX) {
    return { status: 'out_of_range', stage: null, months: months }
  }
  const stage = getStage(months)
  if (!stage) return { status: 'unknown', stage: null, months: months }
  return { status: 'ok', stage: stage, months: months }
}

/**
 * 把月龄格式化成「X 个月 Y 天」这类可读文案
 */
function describeAge(birthday, now) {
  if (!birthday) return ''
  const b = new Date(birthday)
  if (isNaN(b.getTime())) return ''
  const n = now || new Date()
  const months = monthsBetween(birthday, n)

  // 算余下的天数
  const anchor = new Date(b.getFullYear(), b.getMonth() + months, b.getDate())
  let days = Math.floor((n - anchor) / 86400000)
  if (days < 0) days = 0

  if (months <= 0) return days + ' 天'
  return months + ' 个月' + (days > 0 ? ' ' + days + ' 天' : '')
}

/**
 * 该食材在指定月龄是否已经可以吃
 */
function isFoodReady(food, months) {
  if (!food || months === null) return false
  return months >= food.minMonth
}

/**
 * 该菜谱在指定月龄是否适用
 */
function isRecipeSuitable(recipe, months) {
  if (!recipe || months === null) return false
  return months >= recipe.monthRange[0] && months <= recipe.monthRange[1]
}

module.exports = {
  MIN_MONTH,
  CONTENT_MAX,
  STAGES,
  monthsBetween,
  getStage,
  getAgeStatus,
  describeAge,
  isFoodReady,
  isRecipeSuitable,
  mealsForMonth,
  slotsForMonth
}
