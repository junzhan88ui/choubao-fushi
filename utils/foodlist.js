/**
 * 食材清单唯一事实源（v2.30 ·「查一查」↔「修改宝宝档案」打通）
 *
 * 两页过去各写各的：CATEGORY_ORDER（档案页少了「其他」）、状态映射、
 * 图标取法、搜索匹配全都复制了一份 —— 改一处另一处就漂移。现在都从这里出：
 *   - 分类顺序（含「其他」，蜂蜜等禁食提示条目归这里）
 *   - 关键词匹配（name + alias，两边同一套）
 *   - 状态徽标（new=未引入 / safe=已吃过 / bad=有反应，同一套词）
 *   - 图标与分类底色（icons.iconFor / bgFor）
 * _validate §6u 钉：两页都必须走 buildGroups，不许再本地分组。
 *
 * 「观察中」已随 3 天观察期规则整体删除（用户决策）：存量 observing 记录由
 * storage.getIntroduced 一次性迁移为 safe，这里没有该分支。
 */
const FOODS = require('../data/foods')
const icons = require('../data/food-icons')
const age = require('./age')
const storage = require('./storage')

// 与 data/foods.js 的分类口径一致；「其他」排最后（禁食提示条目：蜂蜜）
const CATEGORY_ORDER = ['谷物', '蔬菜', '水果', '肉禽', '水产', '蛋奶', '豆类', '油脂', '其他']

/** intro 记录 → 徽标词（查一查与档案页共用同一套词表） */
function statusOf(intro) {
  if (!intro) return { status: 'new', statusText: '未引入' }
  if (intro.status === 'bad') return { status: 'bad', statusText: '有反应' }
  // 非 bad 即「已吃过、确认没问题」（safe；以及迁移后不再可能出现的历史遗留态）
  return { status: 'safe', statusText: '已吃过' }
}

/**
 * 构建按分类分组的食材清单。
 * @param {object} opts
 *   keyword            搜索词（匹配 name + alias；空 = 全量）
 *   months             当前月龄；null/undefined = 没填生日
 *                      （ready 恒 false、不算月龄门 —— 与旧的两页口径一致）
 *   skipUnintroducible 档案页用：禁食提示条目（introducible:false，蜂蜜）
 *                       不进可勾选清单；查一查要展示它，别传
 * @returns {Array<{category: string, foods: Array}>}
 *   每项：id/name/allergen/minMonth/introducible/status/statusText/
 *        ready/tooEarly/checked/icon/iconBg
 */
function buildGroups(opts) {
  opts = opts || {}
  const kw = (opts.keyword || '').trim()
  const months = opts.months == null || opts.months === undefined ? null : opts.months
  const safeIds = storage.safeFoodIds()
  const map = {}

  for (let i = 0; i < FOODS.length; i++) {
    const f = FOODS[i]
    if (opts.skipUnintroducible && f.introducible === false) continue
    if (kw) {
      const aliasHit = (f.alias || []).join(' ').indexOf(kw) >= 0
      if (f.name.indexOf(kw) < 0 && !aliasHit) continue
    }
    const st = statusOf(storage.findIntro(f.id))
    const ready = age.isFoodReady(f, months)
    if (!map[f.category]) map[f.category] = []
    map[f.category].push({
      id: f.id,
      name: f.name,
      allergen: f.allergen,
      minMonth: f.minMonth,
      introducible: f.introducible !== false,
      status: st.status,
      statusText: st.statusText,
      ready: ready,
      // 月龄门只在有档案时亮（没填生日时两页都不显示「未到月龄」）
      tooEarly: months !== null && !ready,
      checked: safeIds.indexOf(f.id) >= 0,
      // v2.0 图标：emoji + 分类底色（§6g 四段链路的取数端）
      icon: icons.iconFor(f),
      iconBg: icons.bgFor(f)
    })
  }

  const groups = []
  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const c = CATEGORY_ORDER[i]
    if (map[c] && map[c].length) groups.push({ category: c, foods: map[c] })
  }
  return groups
}

module.exports = {
  buildGroups: buildGroups,
  statusOf: statusOf,
  CATEGORY_ORDER: CATEGORY_ORDER
}
