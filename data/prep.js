/**
 * 食材「怎么弄熟」的唯一数据源（v4.1 · 用户 2026-10-21 拍板方案 B）
 *
 * 为什么单独一张表：
 *   同一个食材的加热时长会同时出现在**两处文案**里 —— `data/recipes.js` 的步骤
 *   和 `data/foods.js` 的 `firstIntro.method`。两处各写一份，迟早对不上（改了菜谱
 *   忘了改详情页，家长看到两个时长）。这张表是唯一口径，`_validate.js` 会钉：
 *   凡是这里写了 `time` 的食材，`foods.js` 的 method 必须包含同一个时长字符串。
 *
 * 字段：
 *   way   加热方式：蒸 / 煮 / 焯 / 熬 / 生（生 = 不用加热，直接压泥）
 *   time  时长字符串，**不带「约」**（步骤里写成「蒸 8–10 分钟」，包含即可命中）。
 *         空字符串 = 不用加热（way: '生'）。
 *   cue   熟度判断标准 —— 时长只是参考，蒸锅功率和切块大小差异很大，
 *         家长真正该看的是这个（勺子能压透 / 筷子能戳穿 / 变红卷曲）。
 *
 * 口径约定（写新菜谱时照这个来）：
 *   - 蒸 / 煮 一律从**水开后**开始计时，步骤里要写「水开后」。
 *   - 切末、切小丁的肉比整块熟得快，本表按**整块/小块**给时间；
 *     末状肉按各菜谱步骤里的「煮 5–8 分钟」走，不要套本表。
 *   - 水果分两类：香蕉 / 牛油果 / 橙子 / 草莓 / 猕猴桃 / 芒果**不用加热**；
 *     只有苹果 / 梨 / 桃 / 蓝莓要弄熟。
 *   - 「熟香蕉」是歧义词（= 熟透），文案里别单写「熟X」，要写「选熟透的」或
 *     「蒸熟」。§6x-23 有反向钉：生吃水果的步骤里不许出现蒸 / 煮 / 焯。
 */

const PREP = {
  // —— 谷物 · 熬 ——
  rice: { way: '熬', time: '25 分钟', cue: '米粒开花、粥体浓稠' },
  millet: { way: '熬', time: '20 分钟', cue: '米粒开花、粥体浓稠' },
  oat: { way: '煮', time: '5 分钟', cue: '燕麦片完全软烂、没有硬芯' },
  corn: { way: '煮', time: '10–15 分钟', cue: '玉米粒饱满、指甲能掐开' },

  // —— 谷物 · 蒸 ——
  potato: { way: '蒸', time: '15–20 分钟', cue: '筷子能轻松戳穿' },
  sweet_potato: { way: '蒸', time: '15–20 分钟', cue: '筷子能轻松戳穿' },
  yam: { way: '蒸', time: '15–20 分钟', cue: '筷子能轻松戳穿' },

  // —— 蔬菜 · 蒸 ——
  pumpkin: { way: '蒸', time: '10 分钟', cue: '勺子一压就散' },
  carrot: { way: '蒸', time: '12–15 分钟', cue: '筷子能戳穿（胡萝卜最耐煮，别凭感觉）' },
  zucchini: { way: '蒸', time: '6–8 分钟', cue: '边缘半透明、勺子能压透' },
  winter_melon: { way: '蒸', time: '10 分钟', cue: '整体变透明' },
  eggplant: { way: '蒸', time: '10 分钟', cue: '塌软、筷子能夹断' },

  // —— 蔬菜 · 煮 ——
  white_radish: { way: '煮', time: '10–15 分钟', cue: '勺子能压碎、没有生辣味' },
  lotus_root: { way: '煮', time: '20–30 分钟', cue: '勺子能压碎（莲藕最费火，时间别省）' },
  mushroom: { way: '煮', time: '10 分钟', cue: '泡发后煮到软塌、没有硬芯' },
  pea: { way: '煮', time: '8–10 分钟', cue: '一压就成泥、皮能轻松脱掉' },
  tomato: { way: '煮', time: '3–5 分钟', cue: '皮起皱、果肉出汁' },

  // —— 蔬菜 · 焯 ——
  broccoli: { way: '焯', time: '2–3 分钟', cue: '花球变深绿、梗能掐动' },
  spinach: { way: '焯', time: '1 分钟', cue: '叶片塌软变色即可（只为去草酸，别煮烂）' },
  cabbage: { way: '焯', time: '1 分钟', cue: '叶片塌软变色' },

  // —— 水果 · 蒸 / 煮 ——
  apple: { way: '蒸', time: '8–10 分钟', cue: '勺子能刮下软肉' },
  pear: { way: '蒸', time: '8–10 分钟', cue: '勺子能刮下软肉' },
  peach: { way: '蒸', time: '6–8 分钟', cue: '果肉变软、能压成泥' },
  blueberry: { way: '煮', time: '2–3 分钟', cue: '果皮裂开、一压就散（整颗务必压碎）' },

  // —— 肉禽 · 煮 ——
  pork: { way: '煮', time: '12–15 分钟', cue: '切开中心不见粉色、没有血水' },
  chicken: { way: '煮', time: '10–12 分钟', cue: '中心不见粉色、能撕成丝' },
  beef: { way: '煮', time: '15–20 分钟', cue: '能咬断、不塞牙' },
  lamb: { way: '煮', time: '25–30 分钟', cue: '能轻松咬断' },
  liver_pork: { way: '煮', time: '8–10 分钟', cue: '切开中心无血色、质地变粉' },

  // —— 水产 · 蒸 / 煮 ——
  salmon: { way: '蒸', time: '8 分钟', cue: '肉一压就散、中心不透明' },
  cod: { way: '蒸', time: '8 分钟', cue: '肉一压就散、中心不透明' },
  shrimp: { way: '煮', time: '2–3 分钟', cue: '变红卷曲即可，久煮会老' },

  // —— 蛋奶 · 煮 ——
  egg_yolk: { way: '煮', time: '8–10 分钟', cue: '冷水下锅、水开后计时，全熟才好压碎' },
  egg_whole: { way: '煮', time: '8–10 分钟', cue: '冷水下锅、水开后计时，全熟' },

  // —— 豆类 · 煮 ——
  red_bean: { way: '煮', time: '40 分钟', cue: '提前泡 4 小时以上，煮到一压就成沙' },
  soybean: { way: '煮', time: '40 分钟', cue: '提前泡 4 小时以上，煮到一压就成泥' },
  tofu: { way: '焯', time: '1 分钟', cue: '只为去豆腥，别煮老' },

  // —— 不用加热 · 直接压泥（way: '生'）——
  banana: { way: '生', time: '', cue: '表皮带黑斑、按压微软（生香蕉含鞣酸，别用）' },
  avocado: { way: '生', time: '', cue: '按压微软、蒂部能轻松拔下' },
  orange: { way: '生', time: '', cue: '去皮去籽，取果肉压碎' },
  strawberry: { way: '生', time: '', cue: '洗净去蒂，压成泥' },
  kiwi: { way: '生', time: '', cue: '选熟软的，去皮压泥' },
  mango: { way: '生', time: '', cue: '选熟透的，去皮取果肉压泥' }
}

/** 取某食材的预处理口径；表里没有返回 null（油脂、调味类不需要） */
function prepOf(foodId) {
  return PREP[foodId] || null
}

/** 一句话文案：「蒸 8–10 分钟，勺子能刮下软肉」；不用加热的返回「不用加热，<cue>」 */
function prepLine(foodId) {
  const p = PREP[foodId]
  if (!p) return ''
  if (p.way === '生') return '不用加热，' + p.cue
  return p.way + ' ' + p.time + '，' + p.cue
}

module.exports = { PREP: PREP, prepOf: prepOf, prepLine: prepLine }
