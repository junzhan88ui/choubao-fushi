/**
 * 菜谱库
 *
 * ⚠️ 内容准确性说明
 * 本表内容参考辅食添加领域的通行做法整理，用于「计划编排工具」的规则匹配，
 * 不构成营养或医疗建议。上线前请逐条对照公开喂养指南核对，有条件请注册营养师通审。
 *
 * 字段说明：
 *   monthRange  适用月龄区间 [最小, 最大]
 *   texture     性状档位（细泥 / 稠糊 / 碎末 / 小丁）—— 这是区别于普通菜谱的关键字段
 *   mainFoods   主料（候选池过滤、采购清单汇总都用它）
 *   tags        营养标签，同时用于「当前问题」加权：
 *               补铁 / 膳食纤维 / 易消化 / 易入口
 *   allergens   含有的致敏食材 id
 *   amount      参考分量，按《中国居民膳食指南(2022)》7~24 月龄平衡膳食宝塔折算：
 *               '7-12' = 7~12 月每道菜参考克数，'13-24' = 13~24 月，default = 兜底（取 7-12）
 *               宝塔给的是「每日各类食物推荐范围」，这里按单餐约量折算（非精确处方，需营养师通审）
 */

const SOURCE = '参考《7–24 月龄婴幼儿喂养指南》'

module.exports = [
  /* ================= 细泥期（6–9 月龄） ================= */
  {
    id: 'r_rice_cereal', name: '强化铁米粉糊',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['rice_cereal'], sideFoods: [],
    tags: ['补铁', '易消化'], allergens: [],
    amount: { '7-12': '谷物 20–30g', '13-24': '谷物 30–50g', default: '谷物 20–30g' },
    steps: ['取强化铁米粉 1 小勺放入碗中', '倒入约 60℃ 温水，边倒边搅拌', '调成能挂勺又缓慢滴落的稀糊，静置 1 分钟再喂'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_pumpkin_puree', name: '南瓜泥',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['pumpkin'], sideFoods: [],
    tags: ['易消化', '易入口'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g', '13-24': '蔬菜 30–50g', default: '蔬菜 20–30g' },
    steps: ['南瓜去皮去瓤，切小块', '上锅蒸 15 分钟至能轻松压碎', '用勺背压成细泥，太稠可加少量温水调稀'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_carrot_puree', name: '胡萝卜泥',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['carrot'], sideFoods: ['walnut_oil'],
    tags: ['易消化'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g，油脂 几滴', '13-24': '蔬菜 30–50g，油脂 少许', default: '蔬菜 20–30g，油脂 几滴' },
    steps: ['胡萝卜去皮切薄片', '蒸 15 分钟至软烂', '压成细泥，滴 1–2 滴核桃油拌匀（胡萝卜素是脂溶性的）'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_apple_puree', name: '熟苹果泥',
    monthRange: [6, 12], texture: '细泥',
    mainFoods: ['apple'], sideFoods: [],
    tags: ['易消化', '易入口', '膳食纤维'], allergens: [],
    amount: { '7-12': '水果 20–30g', '13-24': '水果 30–50g', default: '水果 20–30g' },
    steps: ['苹果去皮去核切块', '蒸 10 分钟或加水煮软', '压成细泥，初期建议熟食更温和'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_banana_puree', name: '香蕉泥',
    monthRange: [6, 12], texture: '细泥',
    mainFoods: ['banana'], sideFoods: [],
    tags: ['易入口'], allergens: [],
    amount: { '7-12': '水果 20–30g', '13-24': '水果 30–50g', default: '水果 20–30g' },
    steps: ['选熟透带斑点的香蕉', '取中段，用勺背直接压成泥', '不需要加热，即做即吃'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_sweet_potato_puree', name: '红薯泥',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['sweet_potato'], sideFoods: [],
    tags: ['膳食纤维', '易入口'], allergens: [],
    amount: { '7-12': '谷物 20–30g', '13-24': '谷物 30–50g', default: '谷物 20–30g' },
    steps: ['红薯去皮切块', '蒸 20 分钟至软烂', '压成细泥，太干可加少量温水或母乳调稀'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_potato_puree', name: '土豆泥',
    monthRange: [6, 12], texture: '细泥',
    mainFoods: ['potato'], sideFoods: [],
    tags: ['易消化'], allergens: [],
    amount: { '7-12': '谷物 20–30g', '13-24': '谷物 30–50g', default: '谷物 20–30g' },
    steps: ['土豆去皮切块', '蒸 20 分钟至能轻松压碎', '压成细泥，加少量温水调至合适稠度'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_broccoli_puree', name: '西兰花泥',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['broccoli'], sideFoods: [],
    tags: ['膳食纤维'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g', '13-24': '蔬菜 30–50g', default: '蔬菜 20–30g' },
    steps: ['只取西兰花花球部分', '沸水焯 3 分钟后捞出', '压成细泥，菜梗纤维粗不要用'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_avocado_puree', name: '牛油果泥',
    monthRange: [6, 12], texture: '细泥',
    mainFoods: ['avocado'], sideFoods: [],
    tags: ['易入口'], allergens: [],
    amount: { '7-12': '水果 20–30g', '13-24': '水果 30–50g', default: '水果 20–30g' },
    steps: ['选按压微软的熟牛油果', '对半切开去核，挖出果肉', '用叉子压成泥，可混入米粉或香蕉泥'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_yam_puree', name: '山药泥',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['yam'], sideFoods: [],
    tags: ['易消化'], allergens: [],
    amount: { '7-12': '谷物 20–30g', '13-24': '谷物 30–50g', default: '谷物 20–30g' },
    steps: ['山药去皮切段（戴手套操作，生山药会让手发痒）', '蒸 20 分钟至软烂', '压成细泥，可加少量温水调稀'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_zucchini_puree', name: '西葫芦泥',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['zucchini'], sideFoods: [],
    tags: ['易消化'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g', '13-24': '蔬菜 30–50g', default: '蔬菜 20–30g' },
    steps: ['西葫芦去皮去籽切块', '蒸 10 分钟至软', '压成细泥，水分多不用额外加水'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_pear_puree', name: '熟梨泥',
    monthRange: [6, 12], texture: '细泥',
    mainFoods: ['pear'], sideFoods: [],
    tags: ['膳食纤维', '易入口'], allergens: [],
    amount: { '7-12': '水果 20–30g', '13-24': '水果 30–50g', default: '水果 20–30g' },
    steps: ['梨去皮去核切块', '蒸 10 分钟至软', '压成细泥，水分较多，适合大便偏干的宝宝'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_millet_paste', name: '小米糊',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['millet'], sideFoods: [],
    tags: ['易消化'], allergens: [],
    amount: { '7-12': '谷物 20–30g', '13-24': '谷物 30–50g', default: '谷物 20–30g' },
    steps: ['小米洗净，加 8 倍水', '小火熬 30 分钟至米粒开花', '取上层米汤，或整锅打成糊'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_egg_yolk_paste', name: '蛋黄泥',
    monthRange: [6, 9], texture: '细泥',
    mainFoods: ['egg_yolk'], sideFoods: [],
    tags: ['补铁'], allergens: ['egg_yolk'],
    amount: { '7-12': '蛋奶 15–25g', '13-24': '蛋奶 25–40g', default: '蛋奶 15–25g' },
    steps: ['鸡蛋冷水下锅，水开后煮 10 分钟至全熟', '取出蛋黄，压碎', '用温水、母乳或配方奶调成糊'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_spinach_puree', name: '菠菜泥',
    monthRange: [7, 9], texture: '细泥',
    mainFoods: ['spinach'], sideFoods: [],
    tags: ['补铁'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g', '13-24': '蔬菜 30–50g', default: '蔬菜 20–30g' },
    steps: ['取菠菜嫩叶洗净', '沸水焯 1 分钟（去草酸），捞出挤干水分', '剁碎或压成泥，混入米粉或粥中'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_pea_puree', name: '豌豆泥',
    monthRange: [7, 9], texture: '细泥',
    mainFoods: ['pea'], sideFoods: [],
    tags: ['膳食纤维'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g', '13-24': '蔬菜 30–50g', default: '蔬菜 20–30g' },
    steps: ['新鲜或冷冻豌豆煮熟至软烂', '剥去外皮', '压成泥并过筛，确保没有整粒残留'],
    freezable: true, source: SOURCE
  },

  /* ================= 稠糊带颗粒期（8–12 月龄） ================= */
  {
    id: 'r_chicken_potato', name: '鸡肉土豆泥',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['chicken', 'potato'], sideFoods: [],
    tags: ['高蛋白'], allergens: [],
    amount: { '7-12': '谷物 20–30g，肉禽 20–30g', '13-24': '谷物 30–50g，肉禽 30–50g', default: '谷物 20–30g，肉禽 20–30g' },
    steps: ['鸡胸肉煮熟，撕成丝后剁成极细的末', '土豆蒸熟压成泥', '两者混合，加少量温水调成稠糊，保留一点颗粒'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_liver_spinach_congee', name: '猪肝菠菜粥',
    monthRange: [8, 10], texture: '稠糊',
    mainFoods: ['liver_pork', 'rice'], sideFoods: ['spinach'],
    tags: ['补铁'], allergens: [],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，肉禽 20–30g', '13-24': '谷物 30–50g，蔬菜 30–50g，肉禽 30–50g', default: '谷物 20–30g，蔬菜 20–30g，肉禽 20–30g' },
    steps: ['猪肝切片，清水浸泡 30 分钟去血水', '煮熟后压成泥（每周不超过 1–2 次）', '大米熬成稠粥，拌入肝泥和焯过水剁碎的菠菜'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_salmon_broccoli_congee', name: '三文鱼西兰花粥',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['salmon', 'rice'], sideFoods: ['broccoli'],
    tags: ['高蛋白'], allergens: ['salmon'],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，水产 20–30g', '13-24': '谷物 30–50g，蔬菜 30–50g，水产 30–50g', default: '谷物 20–30g，蔬菜 20–30g，水产 20–30g' },
    steps: ['三文鱼蒸熟，用手指仔细挑净鱼刺后压碎', '西兰花焯水取花球压碎', '拌入熬好的稠粥中'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_beef_tomato_congee', name: '番茄牛肉稠粥',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['beef', 'rice'], sideFoods: ['tomato'],
    tags: ['补铁', '高蛋白'], allergens: [],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，肉禽 20–30g', '13-24': '谷物 30–50g，蔬菜 30–50g，肉禽 30–50g', default: '谷物 20–30g，蔬菜 20–30g，肉禽 20–30g' },
    steps: ['牛里脊煮熟后剁成极细的末', '番茄去皮去籽，煮熟压碎', '与稠粥混合，小火煮 2 分钟'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_egg_pumpkin_congee', name: '蛋黄南瓜粥',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['egg_yolk', 'rice'], sideFoods: ['pumpkin'],
    tags: ['补铁', '易入口'], allergens: ['egg_yolk'],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，蛋奶 15–25g', '13-24': '谷物 30–50g，蔬菜 30–50g，蛋奶 25–40g', default: '谷物 20–30g，蔬菜 20–30g，蛋奶 15–25g' },
    steps: ['南瓜蒸熟压泥', '鸡蛋煮全熟取蛋黄压碎', '两者拌入稠粥，搅匀即可'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_tofu_veg', name: '豆腐蔬菜糊',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['tofu'], sideFoods: ['zucchini'],
    tags: ['补钙'], allergens: ['tofu'],
    amount: { '7-12': '蔬菜 20–30g，豆类 15–25g', '13-24': '蔬菜 30–50g，豆类 25–40g', default: '蔬菜 20–30g，豆类 15–25g' },
    steps: ['嫩豆腐焯水 1 分钟去豆腥', '西葫芦蒸熟压泥', '两者混合压成稠糊，保留少量颗粒'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_cod_carrot', name: '鳕鱼胡萝卜泥',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['cod'], sideFoods: ['carrot'],
    tags: ['高蛋白'], allergens: ['cod'],
    amount: { '7-12': '蔬菜 20–30g，水产 20–30g', '13-24': '蔬菜 30–50g，水产 30–50g', default: '蔬菜 20–30g，水产 20–30g' },
    steps: ['鳕鱼蒸熟，仔细挑净鱼刺', '胡萝卜蒸熟压泥', '两者混合拌匀'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_oat_banana', name: '燕麦香蕉糊',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['oat'], sideFoods: ['banana'],
    tags: ['膳食纤维', '易入口'], allergens: [],
    amount: { '7-12': '谷物 20–30g，水果 20–30g', '13-24': '谷物 30–50g，水果 30–50g', default: '谷物 20–30g，水果 20–30g' },
    steps: ['纯燕麦片加水煮 5 分钟至软烂', '熟香蕉压成泥', '两者混合，保留一点燕麦颗粒'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_radish_pork_congee', name: '白萝卜猪肉粥',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['pork', 'rice'], sideFoods: ['white_radish'],
    tags: ['补铁'], allergens: [],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，肉禽 20–30g', '13-24': '谷物 30–50g，蔬菜 30–50g，肉禽 30–50g', default: '谷物 20–30g，蔬菜 20–30g，肉禽 20–30g' },
    steps: ['猪里脊煮熟剁成细末', '白萝卜煮至软烂后剁碎', '拌入稠粥，小火煮 2 分钟'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_corn_chicken', name: '玉米鸡肉糊',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['corn', 'chicken'], sideFoods: [],
    tags: ['高蛋白'], allergens: [],
    amount: { '7-12': '谷物 20–30g，肉禽 20–30g', '13-24': '谷物 30–50g，肉禽 30–50g', default: '谷物 20–30g，肉禽 20–30g' },
    steps: ['玉米煮熟取粒，打成泥后过筛去皮', '鸡胸肉煮熟剁成细末', '两者混合，加少量温水调成稠糊'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_blueberry_oat', name: '蓝莓燕麦糊',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['blueberry', 'oat'], sideFoods: [],
    tags: ['膳食纤维'], allergens: [],
    amount: { '7-12': '谷物 20–30g，水果 20–30g', '13-24': '谷物 30–50g，水果 30–50g', default: '谷物 20–30g，水果 20–30g' },
    steps: ['蓝莓洗净煮软，压碎（整颗有窒息风险，务必压碎）', '燕麦片加水煮软', '两者混合拌匀'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_liver_millet', name: '猪肝小米粥',
    monthRange: [8, 10], texture: '稠糊',
    mainFoods: ['liver_pork', 'millet'], sideFoods: [],
    tags: ['补铁'], allergens: [],
    amount: { '7-12': '谷物 20–30g，肉禽 20–30g', '13-24': '谷物 30–50g，肉禽 30–50g', default: '谷物 20–30g，肉禽 20–30g' },
    steps: ['猪肝浸泡去血水后煮熟压泥', '小米熬成稠粥', '拌入肝泥，每周不超过 1–2 次'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_sesame_broccoli', name: '芝麻酱拌西兰花',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['broccoli'], sideFoods: ['sesame_paste'],
    tags: ['补钙', '膳食纤维'], allergens: ['sesame_paste'],
    amount: { '7-12': '蔬菜 20–30g，油脂 几滴', '13-24': '蔬菜 30–50g，油脂 少许', default: '蔬菜 20–30g，油脂 几滴' },
    steps: ['西兰花焯水后取花球压碎', '芝麻酱用温水调稀（1/4 小勺即可）', '拌匀，不要给整粒芝麻'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_orange_apple', name: '橙香苹果糊',
    monthRange: [8, 12], texture: '稠糊',
    mainFoods: ['apple'], sideFoods: ['orange'],
    tags: ['易入口'], allergens: [],
    amount: { '7-12': '水果 20–30g', '13-24': '水果 30–50g', default: '水果 20–30g' },
    steps: ['苹果蒸熟压泥', '橙子去皮去籽取果肉压碎', '两者混合，酸味明显时可少放橙子'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_peach_yogurt', name: '桃泥酸奶',
    monthRange: [9, 12], texture: '稠糊',
    mainFoods: ['peach'], sideFoods: ['milk_yogurt'],
    tags: ['易消化', '易入口'], allergens: ['milk_yogurt'],
    amount: { '7-12': '水果 20–30g，蛋奶 15–25g', '13-24': '水果 30–50g，蛋奶 25–40g', default: '水果 20–30g，蛋奶 15–25g' },
    steps: ['桃去皮蒸熟压泥', '取无糖原味酸奶，常温放片刻', '两者拌匀，不要加热酸奶'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_mushroom_chicken_congee', name: '香菇鸡肉粥',
    monthRange: [9, 12], texture: '稠糊',
    mainFoods: ['chicken', 'rice'], sideFoods: ['mushroom'],
    tags: ['高蛋白'], allergens: [],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，肉禽 20–30g', '13-24': '谷物 30–50g，蔬菜 30–50g，肉禽 30–50g', default: '谷物 20–30g，蔬菜 20–30g，肉禽 20–30g' },
    steps: ['香菇泡发后煮烂，剁成细末', '鸡胸肉煮熟剁细', '与稠粥同煮 2 分钟'],
    freezable: true, source: SOURCE
  },

  /* ================= 碎末小丁期（10 月龄以上，可吃到 2 岁） ================= */
  {
    id: 'r_hand_veg_cubes', name: '手抓蔬菜小丁',
    monthRange: [10, 24], texture: '小丁',
    mainFoods: ['carrot', 'potato'], sideFoods: ['broccoli'],
    tags: ['膳食纤维', '手抓食物'], allergens: [],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g', '13-24': '谷物 30–50g，蔬菜 30–50g', default: '谷物 20–30g，蔬菜 20–30g' },
    steps: ['胡萝卜、土豆切成 1cm 见方的小丁', '蒸 15 分钟至用勺子能压碎', '西兰花取小朵同蒸，放凉到不烫手让宝宝自己抓'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_tomato_egg_noodle', name: '番茄鸡蛋碎面',
    monthRange: [10, 24], texture: '碎末',
    mainFoods: ['wheat_flour'], sideFoods: ['tomato', 'egg_whole'],
    tags: ['高蛋白'], allergens: ['wheat_flour', 'egg_whole'],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，蛋奶 15–25g', '13-24': '谷物 30–50g，蔬菜 30–50g，蛋奶 25–40g', default: '谷物 20–30g，蔬菜 20–30g，蛋奶 15–25g' },
    steps: ['宝宝面条掰成 2cm 短段，煮至软烂', '番茄去皮切碎炒出汁（不加油盐）', '淋入打散的蛋液煮成蛋花，与面条拌匀'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_pork_tofu', name: '肉末豆腐羹',
    monthRange: [10, 24], texture: '碎末',
    mainFoods: ['pork'], sideFoods: ['tofu'],
    tags: ['补铁', '补钙'], allergens: ['tofu'],
    amount: { '7-12': '肉禽 20–30g，豆类 15–25g', '13-24': '肉禽 30–50g，豆类 25–40g', default: '肉禽 20–30g，豆类 15–25g' },
    steps: ['猪里脊剁成细末，煮至变色', '嫩豆腐切小丁焯水', '两者加水煮 3 分钟，勾薄芡至微稠'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_shrimp_zucchini', name: '虾仁西葫芦小丁',
    monthRange: [10, 24], texture: '小丁',
    mainFoods: ['shrimp'], sideFoods: ['zucchini'],
    tags: ['高蛋白'], allergens: ['shrimp'],
    amount: { '7-12': '蔬菜 20–30g，水产 20–30g', '13-24': '蔬菜 30–50g，水产 30–50g', default: '蔬菜 20–30g，水产 20–30g' },
    steps: ['虾去壳去虾线，煮熟后剁成细末（虾肉弹牙，务必剁细）', '西葫芦去皮切小丁蒸软', '两者拌匀'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_beef_potato', name: '牛肉土豆丁',
    monthRange: [10, 24], texture: '小丁',
    mainFoods: ['beef', 'potato'], sideFoods: [],
    tags: ['补铁'], allergens: [],
    amount: { '7-12': '谷物 20–30g，肉禽 20–30g', '13-24': '谷物 30–50g，肉禽 30–50g', default: '谷物 20–30g，肉禽 20–30g' },
    steps: ['牛里脊逆纹切小丁，煮至软烂', '土豆切小丁蒸熟', '混合后加少量温水煮 2 分钟'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_salmon_rice', name: '三文鱼碎饭',
    monthRange: [10, 24], texture: '碎末',
    mainFoods: ['salmon', 'rice'], sideFoods: [],
    tags: ['高蛋白'], allergens: ['salmon'],
    amount: { '7-12': '谷物 20–30g，水产 20–30g', '13-24': '谷物 30–50g，水产 30–50g', default: '谷物 20–30g，水产 20–30g' },
    steps: ['三文鱼蒸熟，仔细挑净鱼刺后压碎', '米饭煮软（比成人饭多加水）', '拌匀，可加一点煮软的蔬菜碎'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_lotus_pork', name: '莲藕猪肉小丁',
    monthRange: [10, 24], texture: '小丁',
    mainFoods: ['pork'], sideFoods: ['lotus_root'],
    tags: ['补铁'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g，肉禽 20–30g', '13-24': '蔬菜 30–50g，肉禽 30–50g', default: '蔬菜 20–30g，肉禽 20–30g' },
    steps: ['莲藕煮至软烂（要能用勺压碎），切成小丁', '猪肉末煮熟', '两者混合，加少量水煮 2 分钟'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_eggplant_chicken', name: '茄子鸡肉末',
    monthRange: [10, 24], texture: '碎末',
    mainFoods: ['chicken'], sideFoods: ['eggplant'],
    tags: ['高蛋白'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g，肉禽 20–30g', '13-24': '蔬菜 30–50g，肉禽 30–50g', default: '蔬菜 20–30g，肉禽 20–30g' },
    steps: ['茄子去皮蒸熟，剁成碎末', '鸡胸肉煮熟剁细', '两者混合，不用油炒'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_veg_egg_pancake', name: '全蛋蔬菜小饼',
    monthRange: [10, 24], texture: '小丁',
    mainFoods: ['egg_whole', 'wheat_flour'], sideFoods: ['carrot'],
    tags: ['高蛋白', '手抓食物'], allergens: ['egg_whole', 'wheat_flour'],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，蛋奶 15–25g', '13-24': '谷物 30–50g，蔬菜 30–50g，蛋奶 25–40g', default: '谷物 20–30g，蔬菜 20–30g，蛋奶 15–25g' },
    steps: ['鸡蛋打散，加少量面粉和胡萝卜碎调成稠糊（不加盐）', '不粘锅小火，用勺舀入摊成小圆饼', '两面煎熟后切成手指粗细的条，方便抓握'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_redbean_millet', name: '红豆小米粥',
    monthRange: [10, 24], texture: '碎末',
    mainFoods: ['red_bean', 'millet'], sideFoods: [],
    tags: ['补铁', '膳食纤维'], allergens: [],
    amount: { '7-12': '谷物 20–30g，豆类 15–25g', '13-24': '谷物 30–50g，豆类 25–40g', default: '谷物 20–30g，豆类 15–25g' },
    steps: ['红豆提前浸泡 4 小时以上', '与小米同煮 40 分钟至红豆开花', '用勺背把红豆压碎（豆皮不易消化）'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_mushroom_tofu', name: '香菇豆腐小丁',
    monthRange: [10, 24], texture: '小丁',
    mainFoods: ['tofu'], sideFoods: ['mushroom'],
    tags: ['补钙'], allergens: ['tofu'],
    amount: { '7-12': '蔬菜 20–30g，豆类 15–25g', '13-24': '蔬菜 30–50g，豆类 25–40g', default: '蔬菜 20–30g，豆类 15–25g' },
    steps: ['香菇泡发煮烂后剁成细末', '嫩豆腐切 1cm 小丁焯水', '同煮 2 分钟，勾薄芡'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_chicken_egg_rice', name: '鸡肉蛋黄软饭',
    monthRange: [10, 24], texture: '碎末',
    mainFoods: ['chicken', 'rice'], sideFoods: ['egg_yolk'],
    tags: ['补铁', '高蛋白'], allergens: ['egg_yolk'],
    amount: { '7-12': '谷物 20–30g，肉禽 20–30g，蛋奶 15–25g', '13-24': '谷物 30–50g，肉禽 30–50g，蛋奶 25–40g', default: '谷物 20–30g，肉禽 20–30g，蛋奶 15–25g' },
    steps: ['鸡胸肉煮熟剁成细末', '鸡蛋煮全熟取蛋黄压碎', '与软饭拌匀，可加少量煮软的蔬菜碎'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_avocado_banana', name: '牛油果香蕉泥',
    monthRange: [10, 18], texture: '稠糊',
    mainFoods: ['avocado', 'banana'], sideFoods: [],
    tags: ['易入口'], allergens: [],
    amount: { '7-12': '水果 20–30g', '13-24': '水果 30–50g', default: '水果 20–30g' },
    steps: ['熟牛油果挖出果肉压泥', '熟香蕉压泥', '两者拌匀，即做即吃（牛油果易氧化发黑）'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_cheese_rice', name: '奶酪蔬菜焗饭',
    monthRange: [12, 24], texture: '碎末',
    mainFoods: ['cheese', 'rice'], sideFoods: ['broccoli'],
    tags: ['补钙'], allergens: ['cheese'],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g，蛋奶 15–25g', '13-24': '谷物 30–50g，蔬菜 30–50g，蛋奶 25–40g', default: '谷物 20–30g，蔬菜 20–30g，蛋奶 15–25g' },
    steps: ['选低钠原制奶酪，刨成碎末', '米饭加煮软的西兰花碎拌匀，装入小碗', '撒上奶酪碎，烤箱或微波加热至融化'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_lamb_radish', name: '羊肉萝卜丁',
    monthRange: [12, 24], texture: '小丁',
    mainFoods: ['lamb'], sideFoods: ['white_radish'],
    tags: ['补铁', '高蛋白'], allergens: [],
    amount: { '7-12': '蔬菜 20–30g，肉禽 20–30g', '13-24': '蔬菜 30–50g，肉禽 30–50g', default: '蔬菜 20–30g，肉禽 20–30g' },
    steps: ['羊肉选嫩部位，煮至软烂后切小丁', '白萝卜煮软切小丁', '两者加少量水同煮 3 分钟'],
    freezable: true, source: SOURCE
  },
  {
    id: 'r_kiwi_yogurt', name: '猕猴桃酸奶杯',
    monthRange: [12, 24], texture: '小丁',
    mainFoods: ['kiwi'], sideFoods: ['milk_yogurt'],
    tags: ['易入口'], allergens: ['kiwi', 'milk_yogurt'],
    amount: { '7-12': '水果 20–30g，蛋奶 15–25g', '13-24': '水果 30–50g，蛋奶 25–40g', default: '水果 20–30g，蛋奶 15–25g' },
    steps: ['猕猴桃选熟软的，去皮切小丁', '取无糖原味酸奶', '两者拌匀，不要加热'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_mango_yogurt', name: '芒果酸奶杯',
    monthRange: [12, 24], texture: '小丁',
    mainFoods: ['mango'], sideFoods: ['milk_yogurt'],
    tags: ['易入口'], allergens: ['mango', 'milk_yogurt'],
    amount: { '7-12': '水果 20–30g，蛋奶 15–25g', '13-24': '水果 30–50g，蛋奶 25–40g', default: '水果 20–30g，蛋奶 15–25g' },
    steps: ['芒果去皮取果肉切小丁（务必去皮，果皮汁液可能刺激皮肤）', '取无糖原味酸奶', '两者拌匀'],
    freezable: false, source: SOURCE
  },
  {
    id: 'r_corn_pea_rice', name: '玉米豌豆软饭',
    monthRange: [12, 24], texture: '小丁',
    mainFoods: ['corn', 'rice'], sideFoods: ['pea'],
    tags: ['膳食纤维'], allergens: [],
    amount: { '7-12': '谷物 20–30g，蔬菜 20–30g', '13-24': '谷物 30–50g，蔬菜 30–50g', default: '谷物 20–30g，蔬菜 20–30g' },
    steps: ['玉米粒煮熟去皮（或打成泥过筛）', '豌豆煮烂去皮', '与软饭拌匀，可加一点煮软的肉末'],
    freezable: true, source: SOURCE
  }
]
