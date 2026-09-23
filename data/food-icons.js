/**
 * 食材图标（v2.0）：emoji + 分类底色托底
 *
 * 规则（两级解析）：
 *   1. EXACT 精确优先 —— id 有比分类兜底更贴切的 emoji 就用它
 *   2. 没有的走 FALLBACK[category] 分类兜底
 *   3. 底色由 BG[category] 提供，9 类各一个低饱和浅色
 *
 * 设计约束：
 *   - 覆盖必须 53/53：有的配有没的配，同一张列表会参差不齐（_validate.js §6g 硬校验）
 *   - 底色必须浅到 chip 上的文字（--c-text #2c2c2a）对比度 ≥ 7:1（§6g 现算 WCAG）
 *   - 9 个底色必须两两不同，否则「分类托底」白做
 *   - emoji 只是视觉锚点，**食材名永远保留**：emoji 不可搜索、读屏不友好，不能替代文字
 *   - 本表**不进计划指纹**（见 utils/plan.js planSignature）——换图标不该重排 7 天计划
 *
 * 故意不收录的（宁可统一分类图标，也不硬凑一个误导的）：
 *   谷物：millet / oat / yam / wheat_flour —— 都用 🌾
 *     （曾提过 燕麦🥣 / 山药🍠 / 面粉🍞，分别撞米粉、撞红薯，用户定稿：谷物组不动）
 *   蔬菜：cabbage / zucchini / winter_melon / white_radish / lotus_root —— 都用 🥗
 *     （曾提过 小白菜🥬撞菠菜、白萝卜🥕撞胡萝卜、冬瓜🍈易误读蜜瓜、西葫芦🥒、莲藕🪷，
 *      用户定稿：蔬菜组不动）
 *   水产：cod —— 🐟
 *
 * 2026-09 用户定稿采纳：
 *   肉禽 猪肉🐖 / 牛肉🐂 / 羊肉🐑（猪肝🥩待定，暂留肉片）
 *   豆类 豆腐🧈 / 红豆🫘 / 黄豆🟡
 *   油脂 核桃油🌰 / 亚麻籽油🌱 / 菜籽油🌻 / 橄榄油🫒 / 芝麻酱🥜
 */

// 精确映射：只收「确实比分类兜底更贴切」的
const EXACT = {
  // —— 谷物 ——
  rice: '🍚',            // 大米：煮好的米饭，比 🌾 更指名道姓
  rice_cereal: '🥣',      // 强化铁米粉：冲调成糊的样子
  potato: '🥔',
  sweet_potato: '🍠',
  corn: '🌽',

  // —— 蔬菜 ——
  pumpkin: '🎃',
  carrot: '🥕',
  broccoli: '🥦',
  spinach: '🥬',
  tomato: '🍅',
  pea: '🫛',
  mushroom: '🍄',
  eggplant: '🍆',

  // —— 水果（10 个全有精确对应）——
  apple: '🍎',
  banana: '🍌',
  pear: '🍐',
  avocado: '🥑',
  peach: '🍑',
  blueberry: '🫐',
  orange: '🍊',
  strawberry: '🍓',
  kiwi: '🥝',
  mango: '🥭',

  // —— 肉禽 ——
  pork: '🐖',            // 猪肉：动物代表肉类（用户定稿）
  chicken: '🍗',          // 鸡肉：鸡腿
  beef: '🐂',            // 牛肉：肉牛/黄牛 —— 🐄 是奶牛，不用
  lamb: '🐑',            // 羊肉
  liver_pork: '🥩',        // 猪肝：**待定**，暂留肉片 —— 现在是全表唯一的 🥩

  // —— 水产 ——
  salmon: '🍣',            // 三文鱼：切片形态辨识度比 🐟 高
  shrimp: '🦐',

  // —— 蛋奶 ——
  egg_yolk: '🍳',          // 蛋黄：煎蛋才看得见黄
  egg_whole: '🥚',
  milk_yogurt: '🥛',
  cheese: '🧀',

  // —— 豆类（用户定稿：一豆一图，拆掉 🫘×3）——
  tofu: '🧈',            // 豆腐：白软块（⬜ 在浅色 chip 底上看不见，已否决）
  red_bean: '🫘',         // 红豆：维持
  soybean: '🟡',          // 黄豆：黄色圆粒，形态颜色都准（几何符号但零歧义）

  // —— 油脂（用户定稿：一油一图，拆掉 🫒×5）——
  walnut_oil: '🌰',       // 核桃油：坚果 → 核桃 → 核桃油
  flaxseed_oil: '🌱',     // 亚麻籽油：没有亚麻 emoji，🌱 表植物籽来源（全表已知最弱的一条）
  rapeseed_oil: '🌻',     // 菜籽油
  olive_oil: '🫒',
  sesame_paste: '🥜',     // 芝麻酱：与花生酱形态相同，文字兜底

  // —— 其他 ——
  honey: '🍯'
}

// 分类兜底：EXACT 没收录的食材统一用所属分类的图标，9 类必须全覆盖
const FALLBACK = {
  '谷物': '🌾',
  '蔬菜': '🥗',
  '水果': '🍉',
  '肉禽': '🍖',
  '水产': '🐟',
  '蛋奶': '🍼',
  '豆类': '🫘',
  '油脂': '🫒',
  '其他': '🍽'
}

// 分类底色（低饱和浅色，9 色两两不同）：
// 在白卡片上给 emoji 一层过渡，也承担 chip 的默认底色；
// 浅到 #2c2c2a 文字压上去仍有 ≥ 7:1 对比度（§6g 现算）
const BG = {
  '谷物': '#f0e7d3', // 暖沙（麦色）
  '蔬菜': '#e7f2dc', // 嫩绿
  '水果': '#fdeee7', // 蜜桃粉
  '肉禽': '#f8e6e2', // 陶土玫瑰
  '水产': '#e4eff6', // 海蓝
  '蛋奶': '#fdf6e1', // 奶黄
  '豆类': '#efe9f5', // 藕紫
  '油脂': '#f7ebc6', // 蜜金
  '其他': '#f0efeb'  // 中性灰
}

/** 该食材的 emoji：精确优先，缺了走分类兜底，再缺给个最后兜底 */
function iconFor(food) {
  if (!food) return FALLBACK['其他']
  return EXACT[food.id] || FALLBACK[food.category] || FALLBACK['其他']
}

/** 该食材分类的底色（徽标 / chip 的 background） */
function bgFor(food) {
  if (!food) return BG['其他']
  return BG[food.category] || BG['其他']
}

module.exports = {
  EXACT: EXACT,
  FALLBACK: FALLBACK,
  BG: BG,
  iconFor: iconFor,
  bgFor: bgFor
}
