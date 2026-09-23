/**
 * 食材库
 *
 * ⚠️ 内容准确性说明
 * 本表内容参考辅食添加领域的通行做法整理，用于「计划编排工具」的规则匹配，
 * 不构成营养或医疗建议。上线前请逐条对照《中国居民膳食指南（2022）》及
 * 中国营养学会《7–24 月龄婴幼儿喂养指南》核对，有条件的话请一位注册营养师通审。
 *
 * 字段说明：
 *   minMonth   最早建议引入月龄
 *   allergen   是否属于常见致敏食材（这类食材必须由用户确认安全后才会进入候选池）
 *   firstIntro 首次引入的分量与方法
 */

const SOURCE = '参考《7–24 月龄婴幼儿喂养指南》'

module.exports = [
  /* ---------- 谷物 ---------- */
  {
    id: 'rice_cereal', name: '强化铁米粉', alias: ['铁米粉', '婴儿米粉'],
    category: '谷物', minMonth: 6, allergen: false,
    firstIntro: { amount: '1 小勺（约 5g 干粉）', method: '用温水或母乳/配方奶冲调成稀糊，从 1 小勺开始' },
    note: '通常作为第一口辅食。冲调稠度从稀到稠逐步过渡。',
    source: SOURCE
  },
  {
    id: 'rice', name: '大米', alias: ['白米'],
    category: '谷物', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '熬成很烂的粥，取上层米油或压成米糊' },
    note: '粥要熬到米粒开花、入口即化。',
    source: SOURCE
  },
  {
    id: 'millet', name: '小米',
    category: '谷物', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '熬成小米粥，取上层米汤或压成糊' },
    note: '比大米更容易消化，适合初期。',
    source: SOURCE
  },
  {
    id: 'oat', name: '燕麦', alias: ['燕麦片'],
    category: '谷物', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '用即食纯燕麦片煮软，压成糊' },
    note: '选无糖无添加的纯燕麦片，不要选速溶调味麦片。',
    source: SOURCE
  },
  {
    id: 'potato', name: '土豆', alias: ['马铃薯'],
    category: '谷物', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '蒸熟压成细泥，用温水或奶调稀' },
    note: '发芽或表皮发绿的土豆不能吃。',
    source: SOURCE
  },
  {
    id: 'sweet_potato', name: '红薯', alias: ['地瓜', '番薯'],
    category: '谷物', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '蒸熟压成细泥，可加少量温水调稀' },
    note: '口感甜、接受度高。吃多了可能胀气，初期量要小。',
    source: SOURCE
  },
  {
    id: 'yam', name: '山药', alias: ['淮山'],
    category: '谷物', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '蒸熟压成细泥' },
    note: '处理生山药时手会痒，建议戴手套。',
    source: SOURCE
  },
  {
    id: 'corn', name: '玉米', alias: ['玉米粒'],
    category: '谷物', minMonth: 8, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '煮熟后取玉米粒打成泥并过筛去皮' },
    note: '玉米皮不易消化，初期一定要过筛去皮。',
    source: SOURCE
  },
  {
    id: 'wheat_flour', name: '小麦面粉', alias: ['面粉', '面条'],
    category: '谷物', minMonth: 8, allergen: true,
    firstIntro: { amount: '1–2 小勺', method: '做成很烂的面条或面糊，从少量开始' },
    note: '含麸质，属于常见致敏食材，需单独引入并观察。',
    source: SOURCE
  },

  /* ---------- 蔬菜 ---------- */
  {
    id: 'pumpkin', name: '南瓜',
    category: '蔬菜', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '去皮去瓤切块蒸熟，压成细泥' },
    note: '天然带甜味，是很好的初期蔬菜。',
    source: SOURCE
  },
  {
    id: 'carrot', name: '胡萝卜',
    category: '蔬菜', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '蒸熟或煮熟后压成细泥' },
    note: '胡萝卜素是脂溶性的，可滴一两滴食用油帮助吸收。',
    source: SOURCE
  },
  {
    id: 'broccoli', name: '西兰花',
    category: '蔬菜', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '取花球部分焯水煮软，压成细泥' },
    note: '只用花球，梗部纤维粗，初期不用。',
    source: SOURCE
  },
  {
    id: 'zucchini', name: '西葫芦',
    category: '蔬菜', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '去皮去籽蒸熟，压成细泥' },
    note: '水分多、质地软，容易压泥。',
    source: SOURCE
  },
  {
    id: 'spinach', name: '菠菜',
    category: '蔬菜', minMonth: 7, allergen: false,
    firstIntro: { amount: '1 小勺', method: '焯水后挤干，取嫩叶压成泥' },
    note: '含草酸，必须先焯水再给，且不要与高钙食物同一餐大量同吃。',
    source: SOURCE
  },
  {
    id: 'pea', name: '豌豆', alias: ['青豆'],
    category: '蔬菜', minMonth: 7, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '煮烂后去皮压成泥并过筛' },
    note: '外皮不易消化，初期必须去皮过筛。',
    source: SOURCE
  },
  {
    id: 'tomato', name: '番茄', alias: ['西红柿'],
    category: '蔬菜', minMonth: 7, allergen: false,
    firstIntro: { amount: '1 小勺', method: '去皮去籽，煮熟后压成泥' },
    note: '偏酸，部分宝宝会出现口周发红，属刺激反应而非过敏，可停几天再试。',
    source: SOURCE
  },
  {
    id: 'cabbage', name: '小白菜', alias: ['青菜', '油菜'],
    category: '蔬菜', minMonth: 7, allergen: false,
    firstIntro: { amount: '1 小勺', method: '焯水后取嫩叶剁碎或压泥' },
    note: '选嫩叶，菜梗纤维粗，初期不用。',
    source: SOURCE
  },
  {
    id: 'winter_melon', name: '冬瓜',
    category: '蔬菜', minMonth: 7, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '去皮去瓤蒸熟压泥' },
    note: '水分多、性质温和。',
    source: SOURCE
  },
  {
    id: 'white_radish', name: '白萝卜',
    category: '蔬菜', minMonth: 8, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '煮烂后压成泥或剁碎' },
    note: '生萝卜辛辣，必须彻底煮软。',
    source: SOURCE
  },
  {
    id: 'lotus_root', name: '莲藕',
    category: '蔬菜', minMonth: 9, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '煮至软烂后剁成细末' },
    note: '纤维较粗，要煮到能用勺子轻松压碎。',
    source: SOURCE
  },
  {
    id: 'mushroom', name: '香菇', alias: ['蘑菇'],
    category: '蔬菜', minMonth: 9, allergen: false,
    firstIntro: { amount: '1 小勺', method: '泡发后煮烂，剁成细末' },
    note: '气味较重，先从极少量开始，有些宝宝不接受。',
    source: SOURCE
  },
  {
    id: 'eggplant', name: '茄子',
    category: '蔬菜', minMonth: 9, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '去皮蒸熟，压成泥' },
    note: '吸油，不要用油炒的方式做给一岁内宝宝。',
    source: SOURCE
  },

  /* ---------- 水果 ---------- */
  {
    id: 'apple', name: '苹果',
    category: '水果', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '蒸熟或煮熟后压成泥（生苹果泥偏硬，初期建议熟食）' },
    note: '熟苹果泥较温和，初期优先选熟食。',
    source: SOURCE
  },
  {
    id: 'banana', name: '香蕉',
    category: '水果', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '选熟透的香蕉，用勺背直接压成泥' },
    note: '不用加热。生香蕉含鞣酸，可能加重便秘，要选熟透带斑点的。',
    source: SOURCE
  },
  {
    id: 'pear', name: '梨',
    category: '水果', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '蒸熟或煮熟后压成泥' },
    note: '水分多，对大便偏干的宝宝比较友好。',
    source: SOURCE
  },
  {
    id: 'avocado', name: '牛油果', alias: ['鳄梨'],
    category: '水果', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '选熟软的，直接压成泥' },
    note: '脂肪含量高、能量密度大，适合长身体阶段。',
    source: SOURCE
  },
  {
    id: 'peach', name: '桃', alias: ['水蜜桃'],
    category: '水果', minMonth: 7, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '去皮蒸熟后压成泥' },
    note: '表面绒毛可能刺激皮肤，务必去皮。',
    source: SOURCE
  },
  {
    id: 'blueberry', name: '蓝莓',
    category: '水果', minMonth: 8, allergen: false,
    firstIntro: { amount: '1 小勺', method: '煮软后压成泥，大月龄可对半切开' },
    note: '整颗蓝莓有窒息风险，一岁内务必压碎或切开。',
    source: SOURCE
  },
  {
    id: 'orange', name: '橙子', alias: ['柑橘'],
    category: '水果', minMonth: 8, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '去皮去籽，取果肉压碎或挤汁稀释' },
    note: '偏酸，建议稀释后给，且不要在空腹时喂。',
    source: SOURCE
  },
  {
    id: 'strawberry', name: '草莓',
    category: '水果', minMonth: 8, allergen: true,
    firstIntro: { amount: '1 小勺', method: '洗净去蒂，压成泥' },
    note: '部分宝宝会出现口周红点，属于常见反应，需单独引入观察。',
    source: SOURCE
  },
  {
    id: 'kiwi', name: '猕猴桃', alias: ['奇异果'],
    category: '水果', minMonth: 9, allergen: true,
    firstIntro: { amount: '1 小勺', method: '选熟软的，去皮压成泥' },
    note: '偏酸且致敏性较高，建议较晚引入并单独观察。',
    source: SOURCE
  },
  {
    id: 'mango', name: '芒果',
    category: '水果', minMonth: 9, allergen: true,
    firstIntro: { amount: '1 小勺', method: '去皮取果肉压成泥' },
    note: '致敏性较高，果皮汁液也可能刺激皮肤，务必去皮。',
    source: SOURCE
  },

  /* ---------- 肉禽 ---------- */
  {
    id: 'pork', name: '猪肉', alias: ['瘦肉'],
    category: '肉禽', minMonth: 7, allergen: false,
    firstIntro: { amount: '1 小勺', method: '选里脊等瘦肉，煮熟后剁成极细的肉末或打成泥' },
    note: '红肉含铁，是 6 个月后补铁的重要来源。',
    source: SOURCE
  },
  {
    id: 'chicken', name: '鸡肉', alias: ['鸡胸肉'],
    category: '肉禽', minMonth: 7, allergen: false,
    firstIntro: { amount: '1 小勺', method: '鸡胸肉煮熟后撕成丝再剁成细末' },
    note: '鸡胸肉纤维较粗，一定要剁得很细。',
    source: SOURCE
  },
  {
    id: 'beef', name: '牛肉',
    category: '肉禽', minMonth: 8, allergen: false,
    firstIntro: { amount: '1 小勺', method: '选牛里脊，煮熟后剁成细末或打成泥' },
    note: '含铁量高，但纤维粗，要处理得比猪肉更细。',
    source: SOURCE
  },
  {
    id: 'liver_pork', name: '猪肝',
    category: '肉禽', minMonth: 8, allergen: false,
    firstIntro: { amount: '1 小勺', method: '充分浸泡去血水，煮熟后压成泥' },
    note: '补铁效果好，但维生素 A 含量极高，每周不超过 1–2 次、每次少量。',
    source: SOURCE
  },
  {
    id: 'lamb', name: '羊肉',
    category: '肉禽', minMonth: 10, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '选嫩部位煮熟剁碎' },
    note: '气味较重，先从极少量试。',
    source: SOURCE
  },

  /* ---------- 水产 ---------- */
  {
    id: 'salmon', name: '三文鱼',
    category: '水产', minMonth: 8, allergen: true,
    firstIntro: { amount: '1 小勺', method: '蒸熟后仔细挑刺，压成泥' },
    note: '富含 DHA。属于常见致敏食材，需单独引入观察；务必彻底挑净鱼刺。',
    source: SOURCE
  },
  {
    id: 'cod', name: '鳕鱼',
    category: '水产', minMonth: 8, allergen: true,
    firstIntro: { amount: '1 小勺', method: '蒸熟后挑刺压成泥' },
    note: '刺少肉嫩，但仍是致敏食材，需单独引入观察。',
    source: SOURCE
  },
  {
    id: 'shrimp', name: '虾', alias: ['虾仁'],
    category: '水产', minMonth: 9, allergen: true,
    firstIntro: { amount: '1 小勺', method: '去壳去虾线，煮熟后剁成极细的末' },
    note: '致敏性较高，建议较晚引入。虾肉弹牙，务必剁细防噎。',
    source: SOURCE
  },

  /* ---------- 蛋奶 ---------- */
  {
    id: 'egg_yolk', name: '蛋黄',
    category: '蛋奶', minMonth: 6, allergen: true,
    firstIntro: { amount: '1/4 个', method: '鸡蛋煮全熟，取蛋黄压碎，用温水或奶调成糊' },
    note: '从 1/4 个开始，观察 2–3 天无异常再逐步加量。含铁，是早期重要来源。',
    source: SOURCE
  },
  {
    id: 'egg_whole', name: '全蛋', alias: ['蛋清', '鸡蛋'],
    category: '蛋奶', minMonth: 8, allergen: true,
    firstIntro: { amount: '1 小勺', method: '煮全熟后压碎，或做成蛋羹（不加盐）' },
    note: '蛋清致敏性高于蛋黄，建议在蛋黄适应后再引入全蛋。必须全熟。',
    source: SOURCE
  },
  {
    id: 'milk_yogurt', name: '无糖酸奶', alias: ['酸奶'],
    category: '蛋奶', minMonth: 9, allergen: true,
    firstIntro: { amount: '1–2 小勺', method: '选无糖原味酸奶，常温放置片刻再喂' },
    note: '一岁内可以吃酸奶和奶酪，但不能用鲜奶替代母乳或配方奶。必须选无糖。',
    source: SOURCE
  },
  {
    id: 'cheese', name: '奶酪',
    category: '蛋奶', minMonth: 10, allergen: true,
    firstIntro: { amount: '1 小勺', method: '选低钠原制奶酪，刨碎后加入粥或饭中加热融化' },
    note: '奶酪钠含量普遍偏高，一岁内要选低钠款并控制量。',
    source: SOURCE
  },

  /* ---------- 豆类 ---------- */
  {
    id: 'tofu', name: '豆腐', alias: ['嫩豆腐'],
    category: '豆类', minMonth: 8, allergen: true,
    firstIntro: { amount: '1 小勺', method: '嫩豆腐焯水后压成泥' },
    note: '大豆制品属于常见致敏食材。选嫩豆腐，老豆腐纤维粗。',
    source: SOURCE
  },
  {
    id: 'red_bean', name: '红豆', alias: ['赤小豆'],
    category: '豆类', minMonth: 10, allergen: false,
    firstIntro: { amount: '1–2 小勺', method: '提前浸泡，煮到极烂后压成泥并过筛去皮' },
    note: '豆皮不易消化，务必煮烂并去皮。',
    source: SOURCE
  },
  {
    id: 'soybean', name: '黄豆',
    category: '豆类', minMonth: 10, allergen: true,
    firstIntro: { amount: '1 小勺', method: '充分浸泡煮烂后压成泥过筛' },
    note: '致敏性较高，且整粒黄豆有窒息风险，必须彻底煮烂并压碎。',
    source: SOURCE
  },

  /* ---------- 油脂 ---------- */
  {
    id: 'walnut_oil', name: '核桃油',
    category: '油脂', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 滴', method: '直接滴入做好的辅食中拌匀，不要高温加热' },
    note: '富含亚油酸、α-亚麻酸，是官方指南推荐用于辅食的油脂之一。油本身不需单独观察（不是致敏形态）；但整粒核桃属于致敏食材且 3 岁内禁食（窒息风险），坚果要引入请用坚果酱或细粉。',
    source: SOURCE
  },
  {
    id: 'flaxseed_oil', name: '亚麻籽油',
    category: '油脂', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 滴', method: '直接滴入做好的辅食中拌匀，不要加热' },
    note: 'α-亚麻酸含量最高的常用油之一，官方指南点名推荐。不耐高温，只能凉拌或出锅后加。',
    source: SOURCE
  },
  {
    id: 'rapeseed_oil', name: '菜籽油',
    category: '油脂', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 滴', method: '用于低温煸炒或出锅后滴入' },
    note: '亚油酸和 α-亚麻酸比例较均衡，官方指南推荐。选低芥酸菜籽油。',
    source: SOURCE
  },
  {
    id: 'olive_oil', name: '橄榄油',
    category: '油脂', minMonth: 6, allergen: false,
    firstIntro: { amount: '1–2 滴', method: '滴入辅食中，或用于低温烹调' },
    note: '用量极小即可，辅食不需要额外大量用油。',
    source: SOURCE
  },
  {
    id: 'sesame_paste', name: '芝麻酱', alias: ['芝麻'],
    category: '油脂', minMonth: 8, allergen: true,
    firstIntro: { amount: '1/4 小勺', method: '用温水或辅食调稀，拌入菜泥或粥中' },
    note: '芝麻是常见致敏食材，需单独引入观察。不要给整粒芝麻。',
    source: SOURCE
  },

  /* ---------- 明确禁食 ---------- */
  // introducible: false —— 这类条目只是「禁食提示」，不是待引入的辅食。
  // 必须显式排除在「新食材尝试」通道之外：否则 12 月龄时它会以
  // 「新食材尝试 · 蜂蜜 / 一岁以内禁食 / 观察 3 天」的荒谬组合被排进计划。
  // 注意它仍保留 minMonth 供「查一查」页展示月龄门槛。
  {
    id: 'honey', name: '蜂蜜',
    category: '其他', minMonth: 12, allergen: false, introducible: false,
    firstIntro: { amount: '—', method: '一岁以内禁食' },
    note: '⛔ 1 岁以内禁食。蜂蜜可能含肉毒杆菌芽孢，婴儿肠道未发育成熟，存在婴儿肉毒中毒风险。',
    source: SOURCE
  }
]
