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

// 阶段定义：月龄区间 → 性状档位 + 每日辅食餐次
const STAGES = [
  { key: 'puree', label: '细泥', min: 6, max: 7, meals: 1, desc: '刚起步，一天 1 餐，从强化铁米粉开始' },
  { key: 'thick', label: '稠糊 / 带颗粒', min: 8, max: 9, meals: 2, desc: '一天 2 餐，质地加稠、留一点颗粒' },
  { key: 'mince', label: '碎末 / 小丁', min: 10, max: 12, meals: 3, desc: '一天 2–3 餐，练咀嚼，可以自己抓着吃' },
  { key: 'junior', label: '小丁 / 小块', min: 13, max: 24, meals: 3, desc: '一天 3 餐，逐步接近成人食物（仍然少盐）' }
]

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
  isRecipeSuitable
}
