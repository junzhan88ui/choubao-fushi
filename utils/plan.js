/**
 * 计划生成规则引擎
 *
 * 这里是整个产品的核心：不调用任何大模型，全部靠规则匹配。
 * 好处是结果 100% 可控、可复现、零成本，而且每条内容都能追溯到数据表。
 *
 * 规则顺序：
 *   1. 月龄 → 性状档位（age.getStage）+ 每日正餐餐次（age.mealsForMonth，
 *      v2.9 起按月龄对齐知识卡与固定菜单，不再绑性状阶段）+ 时段锚点（age.slotsForMonth）
 *   2. 候选池 = 月龄合适 且 主料安全（高致敏食材必须已确认安全）；
 *      v2.9 再分两池：水果泥/糕饼进加餐池（isSnackRecipe），正餐池不含它们
 *   3. 按「当前状态」加权（多选，每个状态各自贡献一个标签，命中任一 ×3）
 *   4. 去重（软约束）：同一道菜用过之后权重 ×0.2/次；当天已用主料权重 ×0.15
 *      —— 是权重衰减不是硬上限，实测一周最多 3 次、同日撞主料约 8~14% 的天。
 *      官方要求的多样性在「类别」层面，由下方每日 4 类覆盖的修补循环保证。
 *   5. 插入新食材名额（每周最多 2 个，只排工作日，遇周末顺延不丢槽）
 *   6. 隐式重排（replanOpts）：旧计划仍覆盖今天时沿用它的起始日，
 *      冻结「日期 ≤ 今天」的整天，只重排明天之后的餐
 */

const age = require('./age')
const FOODS = require('../data/foods')
const RECIPES = require('../data/recipes')

// 计划结构版本：结构或步骤文案变化必须 bump（v2.7 加 meal.cats 与占位符填数；
// v2.8 步骤写入倍粥参考与蛋黄渐进、菜池 +2 道手抓菜；
// v2.9 正餐/加餐分槽（day.snack）+ plan.slots 时段锚点 + 餐次按月龄重排，
//        加餐行与正餐行同构但只从加餐池出，正餐池不再含水果泥/糕饼），
// 缓存计划的 sv 对不上就失效重算 —— 否则升级后旧缓存一直渲染旧结构
const STRUCT_V = 4
// v2.0 图标：只喂给展示字段（newFood / shopping），不进指纹
const icons = require('../data/food-icons')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 状态 → 加权标签（多选，各自生效）
// allergy 没有对应标签：疑似过敏是「别乱试新食材」的语义，
// 由新食材通道和 blockedIds 承担，不靠抬某个菜谱标签的权重。
const STATUS_TAG = {
  iron: '补铁',
  constipation: '膳食纤维',
  loose: '易消化',
  refuse: '易入口',
  allergy: '',
  sick: '易消化'   // WS/T 678—2020 3.8：患病期间鼓励易消化、营养丰富的辅食
}

const FOOD_MAP = (function () {
  const m = {}
  for (let i = 0; i < FOODS.length; i++) m[FOODS[i].id] = FOODS[i]
  return m
})()

function getFood(id) {
  return FOOD_MAP[id] || null
}

// 冻结日（见 replanOpts）只带 recipeId，结算用量时要反查主料/配料
const RECIPE_MAP = (function () {
  const m = {}
  for (let i = 0; i < RECIPES.length; i++) m[RECIPES[i].id] = RECIPES[i]
  return m
})()

// amount 按宝塔两阶段取值：6~12 月用「7-12」较小的参考量，13~24 月用「13-24」
// v2.9·③：monthAmount 按整月龄优先覆盖通用档位 —— 6~7 月强化铁米粉的固定用量
// 直接引用固定菜单（具体克数+水量，不是区间），8 月起没写覆盖就回通用档。
function amountForStage(recipe, months) {
  if (!recipe || !recipe.amount) return ''
  if (recipe.monthAmount && recipe.monthAmount[months]) return recipe.monthAmount[months]
  const key = (months >= 13 && months <= 24) ? '13-24' : '7-12'
  return recipe.amount[key] || recipe.amount.default || ''
}

/* ---------- v2.7：步骤用量填数 ----------
 * recipes.js 的步骤里写 {分类} 占位符（如「燕麦片{谷物}加水煮 5 分钟至软烂」），
 * 渲染前按当期月龄档填成「燕麦片20–30g加水煮 5 分钟至软烂」。
 * 克数分两档（7-12 与 13-24 不同），写死进文案会和另一档的分量打架 ——
 * 占位符 + 运行时填数让同一道菜在两个月龄段各自正确。
 */
function portionMap(amountStr) {
  const map = {}
  String(amountStr || '').split('，').forEach(function (seg) {
    const parts = seg.trim().split(' ')
    if (parts.length >= 2) map[parts[0]] = parts.slice(1).join(' ')
  })
  return map
}

function fillPortions(steps, amountStr) {
  const map = portionMap(amountStr)
  return (steps || []).map(function (s) {
    return String(s).replace(/\{([^{}]+)\}/g, function (_, key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : ''
    })
  })
}

// 餐次行小标签用：amount 串拆成分类名数组（『谷物 20–30g，水果 20–30g』→ ['谷物','水果']）
function catsFromAmount(amountStr) {
  return String(amountStr || '').split('，').map(function (seg) {
    return seg.trim().split(' ')[0]
  }).filter(Boolean)
}

/** 计划里的餐次行对象（v2.9 抽成公共构造：正餐行与加餐行同构，
 *  打卡、展开、类别标签、克数填数走同一套逻辑）。 */
function mealRow(recipe, key, months, amountOverride) {
  // v2.9 · ④：6 月固定菜单锁定日传入逐日用量（amountOverride），其余路径走月龄档
  const amountStr = amountOverride || amountForStage(recipe, months)
  return {
    key: key,
    recipeId: recipe.id,
    name: recipe.name,
    texture: recipe.texture,
    amount: amountStr,
    cats: catsFromAmount(amountStr), // 餐次行小标签（质地之外的类别名，v2.7）
    tags: recipe.tags || [],
    // 步骤里的 {分类} 占位符按当期档位填成真克数（v2.7，见 fillPortions）
    steps: fillPortions(recipe.steps, amountStr)
  }
}

function foodName(id) {
  const f = FOOD_MAP[id]
  return f ? f.name : id
}

/* ---------- 工具 ---------- */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function dateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function isWeekend(d) {
  const w = d.getDay()
  return w === 0 || w === 6
}

/** 'YYYY-MM-DD' → 本地时区的当天零点。
 *  new Date('YYYY-MM-DD') 按 UTC 零点解析，非东八区会落到前一天 ——
 *  现在每次隐式重排都要拿缓存的 startDate 原路还原窗口，错一天就整周错位。 */
function parseDateKey(s) {
  if (s instanceof Date) return new Date(s.getTime())
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  if (!m) return new Date(s)
  return new Date(+m[1], +m[2] - 1, +m[3])
}

/**
 * 本周的新食材引入日槽位：第 1 个可用工作日 + 与它间隔 ≥3 天的下一个工作日。
 *
 * 旧写法是固定 [0, 3] 遇周末直接跳过、不补位 —— 起始日是周三/周四/周六/周日时
 * 第 4 天落在周末，一周只剩 1 个引入名额，引入节奏凭空慢一半。
 * 间隔 ≥3 天是观察期要求（一次一种，观察 3 天），顺延也必须保住这个间距。
 *
 * 实测 7 个起始日全部拿到 2 个名额（周一/周二/周五起始与旧写法一致）。
 * @returns {number[]} 两个日期下标（0~6），理论恒为 2 个
 */
function newFoodSlots(start) {
  const idxAt = function (from) {
    for (let i = from; i < 7; i++) {
      const d = new Date(start.getTime())
      d.setDate(d.getDate() + i)
      if (!isWeekend(d)) return i
    }
    return -1
  }
  const a = idxAt(0)
  if (a < 0) return []
  const b = idxAt(a + 3)
  return b < 0 ? [a] : [a, b]
}

/**
 * 食材是否已「引入过」——决定它能不能出现在常规菜谱里。
 *
 * ⚠️ 设计依据（重要，不要改回「一律排除致敏食材」）
 * 《中国居民膳食指南(2022)》7~24月龄婴幼儿喂养指南 · 准则二 核心推荐：
 *   「不盲目回避易过敏食物，1岁内适时引入各种食物」
 * 官方原文补充：
 *   「婴儿开始添加辅食后适时引入花生、鸡蛋、鱼肉等易过敏食物，可以降低婴儿
 *     对这些食物过敏或特应性皮炎的风险；1岁内婴儿避免食用这些食物对防止
 *     食物过敏未见明显益处。」
 *
 * 所以：致敏食材**不能**被系统性地排除在计划之外，那等于「盲目回避」。
 * 正确做法是让它们经由「新食材引入」通道，一次一种、观察 2~3 天进入计划。
 * 只有用户明确标记「有反应」的食材才永久排除（由 safeIds / blockedIds 控制）。
 */
function foodUsable(fid, safeIds, blockedIds) {
  const f = FOOD_MAP[fid]
  if (!f) return false
  if (blockedIds.indexOf(fid) >= 0) return false   // 已确认有反应 → 永久排除
  if (safeIds.indexOf(fid) >= 0) return true       // 已确认没问题 → 可用
  return !f.allergen                               // 没引入过的致敏食材，走新食材通道
}

/** 整道菜谱是否可用：主料和辅料都要过同一关，避免致敏食材从 sideFoods 绕进来 */
function recipeUsable(recipe, safeIds, blockedIds) {
  const all = recipe.mainFoods.concat(recipe.sideFoods || [])
  for (let i = 0; i < all.length; i++) {
    if (!foodUsable(all[i], safeIds, blockedIds)) return false
  }
  return true
}

/**
 * 加餐类菜谱（v2.9 · 正餐与加餐分槽）。
 * 口径（用户定）：**水果泥 / 糕类不占正餐位** —— 只进加餐池，排进 day.snack。
 * 两条判定：
 *   ① 主料全是水果（水果泥、水果酸奶杯）—— 固定菜单里它们固定在 15:00/15:30 加餐列；
 *   ② 菜名含「糕 / 饼 / 馒头」（蔬菜蒸糕、南瓜小馒头、小饼、土豆饼）—— 糕饼点心类。
 * 第②条兜在菜名上而不是标记字段：新菜谱归类对了就自动进对池，
 * 不依赖「记得打标」；判定口径写进 _validate §6q，改规则会被断言拦住。
 */
function isSnackRecipe(r) {
  if (r.mainFoods && r.mainFoods.length) {
    let allFruit = true
    for (let i = 0; i < r.mainFoods.length; i++) {
      const f = FOOD_MAP[r.mainFoods[i]]
      if (!f || f.category !== '水果') { allFruit = false; break }
    }
    if (allFruit) return true
  }
  return /糕|饼|馒头/.test(r.name)
}

/**
 * 把候选食材按「非致敏 / 致敏」交错排列。
 *
 * 目的：让易过敏食物在引入序列里均匀分布，而不是被排到最后。
 * 例：37 个非致敏 + 14 个致敏 → 前 28 位里就能覆盖全部 14 个致敏食材，
 *     按每周 2 种的速度，约 3.5 个月内全部引入完毕（而不是拖到 1 岁以后）。
 */
function interleaveByAllergen(list) {
  const low = []
  const high = []
  for (let i = 0; i < list.length; i++) {
    (list[i].allergen ? high : low).push(list[i])
  }
  const out = []
  const n = Math.max(low.length, high.length)
  for (let k = 0; k < n; k++) {
    if (k < low.length) out.push(low[k])
    if (k < high.length) out.push(high[k])
  }
  return out
}

/**
 * 每日食物种类要求
 * 依据《3岁以下婴幼儿健康养育照护指南（试行）》（国卫办妇幼函〔2022〕409号）：
 *   「添加辅食种类每日不少于4种，并且至少应包括一种动物性食物、一种蔬菜和
 *     一种谷薯类食物」
 *
 * 注意：油脂不算「一类食物」（官方把烹调油单列），「其他」是兜底分类也不算。
 */
const DAY_MIN_CATS = 4
const COUNTED_CATS = ['谷物', '蔬菜', '水果', '肉禽', '水产', '蛋奶', '豆类']
const ANIMAL_CATS = ['肉禽', '水产', '蛋奶']
const REQUIRED_CATS = ['谷物', '蔬菜', '动物性']

/** 一道菜谱覆盖了哪些「计数的」食物类别 */
function recipeCats(recipe) {
  const out = {}
  const all = recipe.mainFoods.concat(recipe.sideFoods || [])
  for (let i = 0; i < all.length; i++) {
    const f = FOOD_MAP[all[i]]
    if (!f) continue
    if (COUNTED_CATS.indexOf(f.category) >= 0) out[f.category] = true
  }
  return out
}

/** 一天已覆盖的类别；动物性食物合并成 '动物性' 一类 */
function dayCatSet(dayCats) {
  const s = {}
  Object.keys(dayCats).forEach(function (c) {
    if (ANIMAL_CATS.indexOf(c) >= 0) s['动物性'] = true
    else s[c] = true
  })
  return s
}

// recipeCats 会被修补循环反复调用，缓存一次
const CATS_CACHE = {}
function catsOf(recipe) {
  if (!CATS_CACHE[recipe.id]) CATS_CACHE[recipe.id] = recipeCats(recipe)
  return CATS_CACHE[recipe.id]
}

/** 一组菜谱（+可选新食材/加餐）合并后的类别覆盖，动物性已合并。
 *  v2.9：第三个参数传当天加餐 —— 官方「每日不少于4 类」数的是全天食物，
 *  水果加餐贡献的类别要算进去，正餐修补循环才能看见它。 */
function coverageOf(recipes, newFood, also) {
  const cats = {}
  for (let i = 0; i < recipes.length; i++) {
    const rc = catsOf(recipes[i])
    Object.keys(rc).forEach(function (c) { cats[c] = true })
  }
  if (also) {
    const rc = catsOf(also)
    Object.keys(rc).forEach(function (c) { cats[c] = true })
  }
  if (newFood && FOOD_MAP[newFood.id]) {
    const f = FOOD_MAP[newFood.id]
    if (COUNTED_CATS.indexOf(f.category) >= 0) cats[f.category] = true
  }
  return dayCatSet(cats)
}

/** 覆盖度打分：必需类优先，其次类别总数 */
function covScore(cov) {
  let missing = 0
  for (let i = 0; i < REQUIRED_CATS.length; i++) {
    if (!cov[REQUIRED_CATS[i]]) missing++
  }
  return (REQUIRED_CATS.length - missing) * 100 + Object.keys(cov).length
}

/** 加权随机抽一道菜。
 *  @param {string[]} issueTags 命中的状态标签（可多个，来自 STATUS_TAG）
 *                             —— 命中任一 ×3 就够，不叠加：
 *                             叠到 ×9 会压过重复惩罚（0.2/次），
 *                             让带两个标签的菜变成必选项，反而一周反复出现。 */
function pickWeighted(candidates, usedCount, dayMainUse, issueTags, dayCats, refusedIds) {
  if (!candidates.length) return null

  const scored = candidates.map(function (r) {
    let w = 1

    // 状态加权（多选：命中任一标签即 ×3）
    if (issueTags && issueTags.length) {
      for (let i = 0; i < issueTags.length; i++) {
        if (issueTags[i] && r.tags.indexOf(issueTags[i]) >= 0) { w *= 3; break }
      }
    }

    // 已出现次数惩罚（软约束：权重衰减，不是硬上限 —— 实测一周最多约 3 次）
    const used = usedCount[r.id] || 0
    w *= Math.pow(0.2, used)

    // 连续拒吃降权（每餐打卡回写）：近 7 天同一道菜 2 次「没吃」且之后没再吃
    // → ×0.15。同样是软约束：只降概率不剔除（剔除会碰 §5 的池子门槛），
    // 名单由 storage.refusedRecipeIds() 算，吃过一次自动解除。
    if (refusedIds && refusedIds.indexOf(r.id) >= 0) w *= 0.15

    // 当天主料重复惩罚（同样是软的：只压权重，不拦截；
    // 而且修补循环只按覆盖度换菜、不检查这里，所以同日撞主料仍会发生）。
    // ×0.15（v2.9 从 0.3 加强）：正餐池去掉水果/糕饼后撞车分布变陡，
    // 0.3 撑不住（15 月龄实测 ~19%，贴 §5f 的 20% 上限）；0.15 让同日撞主料
    // 压过 ×6 补类加成（6×0.15=0.9 < 1），实测回落到 ~11%（文档带 8–14% 内），
    // 且类别达标率不动（修补循环保底，见 §5c/§5f）。
    for (let i = 0; i < r.mainFoods.length; i++) {
      const fid = r.mainFoods[i]
      if (dayMainUse[fid]) w *= 0.15
    }

    // 补齐当天缺失的食物类别 —— 把「每日不少于4类、且含动物性/蔬菜/谷薯」
    // 这条官方要求，做成选择偏好而不是事后校验
    if (dayCats) {
      const covered = dayCatSet(dayCats)
      const cats = recipeCats(r)
      let need = 0
      let needRequired = 0
      Object.keys(cats).forEach(function (c) {
        const key = ANIMAL_CATS.indexOf(c) >= 0 ? '动物性' : c
        if (covered[key]) return
        need++
        if (REQUIRED_CATS.indexOf(key) >= 0) needRequired++
      })
      if (needRequired > 0) w *= 6        // 补上「必须有的那几类」权重最高
      else if (need > 0) w *= 2           // 补普通类别次之
    }

    return { r: r, w: w }
  })

  let total = 0
  for (let i = 0; i < scored.length; i++) total += scored[i].w
  if (total <= 0) return scored[0].r

  let rnd = Math.random() * total
  for (let i = 0; i < scored.length; i++) {
    rnd -= scored[i].w
    if (rnd <= 0) return scored[i].r
  }
  return scored[scored.length - 1].r
}

/* ---------- 6 月龄固定菜单（v2.9 · ④ 用户决策：主食严格按固定食谱） ----------
 * 逐日钉死 6 月正餐 = 强化铁米粉糊 + 当日用量（含菜泥/肉泥加料），数值逐字取自
 * 固定菜单月龄表（本地存档不入库 → 值直接写进代码，_validate §6s 全量断言）：
 *   1–3: 2.5g+水40ml → 4–6: 5g+水60ml → 7–9: 5g+水50ml+核桃油2滴
 *   10–30: 5g+水50ml + 菜泥/肉泥按 1→2→3 勺逐 3 天升级
 *   （菠菜+猪肉 19–21 并行、西兰花+牛肉 28–30 并行）。
 * add：当日加料 [{foodId, label, qty}] —— 供类别/采购/新食材卡派生。
 * 安全语义优先于菜单：有反应剔加料；病中/观察中剔「未记录」的加料。
 */
const MENU_6_SNACK_START = 19 // 菜单节奏要点原文「水果泥从 6+19 起加入 15:00」
const MENU_6 = {
  1: { base: '谷物 2.5g+水40ml', add: [] },
  2: { base: '谷物 2.5g+水40ml', add: [] },
  3: { base: '谷物 2.5g+水40ml', add: [] },
  4: { base: '谷物 5g+水60ml', add: [] },
  5: { base: '谷物 5g+水60ml', add: [] },
  6: { base: '谷物 5g+水60ml', add: [] },
  7: { base: '谷物 5g+水50ml', add: [{ foodId: 'walnut_oil', label: '核桃油2滴', qty: '2 滴' }] },
  8: { base: '谷物 5g+水50ml', add: [{ foodId: 'walnut_oil', label: '核桃油2滴', qty: '2 滴' }] },
  9: { base: '谷物 5g+水50ml', add: [{ foodId: 'walnut_oil', label: '核桃油2滴', qty: '2 滴' }] },
  10: { base: '谷物 5g+水50ml', add: [{ foodId: 'potato', label: '土豆泥1勺', qty: '1 勺' }] },
  11: { base: '谷物 5g+水50ml', add: [{ foodId: 'potato', label: '土豆泥2勺', qty: '2 勺' }] },
  12: { base: '谷物 5g+水50ml', add: [{ foodId: 'potato', label: '土豆泥3勺', qty: '3 勺' }] },
  13: { base: '谷物 5g+水50ml', add: [{ foodId: 'carrot', label: '胡萝卜泥1勺', qty: '1 勺' }] },
  14: { base: '谷物 5g+水50ml', add: [{ foodId: 'carrot', label: '胡萝卜泥2勺', qty: '2 勺' }] },
  15: { base: '谷物 5g+水50ml', add: [{ foodId: 'carrot', label: '胡萝卜泥3勺', qty: '3 勺' }] },
  16: { base: '谷物 5g+水50ml', add: [{ foodId: 'pork', label: '猪肉泥1勺', qty: '1 勺' }] },
  17: { base: '谷物 5g+水50ml', add: [{ foodId: 'pork', label: '猪肉泥2勺', qty: '2 勺' }] },
  18: { base: '谷物 5g+水50ml', add: [{ foodId: 'pork', label: '猪肉泥3勺', qty: '3 勺' }] },
  19: { base: '谷物 5g+水50ml', add: [{ foodId: 'spinach', label: '菠菜泥1勺', qty: '1 勺' }] },
  20: { base: '谷物 5g+水50ml', add: [{ foodId: 'spinach', label: '菠菜泥2勺', qty: '2 勺' }, { foodId: 'pork', label: '猪肉泥2勺', qty: '2 勺' }] },
  21: { base: '谷物 5g+水50ml', add: [{ foodId: 'spinach', label: '菠菜泥3勺', qty: '3 勺' }, { foodId: 'pork', label: '猪肉泥3勺', qty: '3 勺' }] },
  22: { base: '谷物 5g+水50ml', add: [{ foodId: 'pumpkin', label: '南瓜泥1勺', qty: '1 勺' }] },
  23: { base: '谷物 5g+水50ml', add: [{ foodId: 'pumpkin', label: '南瓜泥2勺', qty: '2 勺' }] },
  24: { base: '谷物 5g+水50ml', add: [{ foodId: 'pumpkin', label: '南瓜泥3勺', qty: '3 勺' }] },
  25: { base: '谷物 5g+水50ml', add: [{ foodId: 'beef', label: '牛肉泥1勺', qty: '1 勺' }] },
  26: { base: '谷物 5g+水50ml', add: [{ foodId: 'beef', label: '牛肉泥2勺', qty: '2 勺' }] },
  27: { base: '谷物 5g+水50ml', add: [{ foodId: 'beef', label: '牛肉泥3勺', qty: '3 勺' }] },
  28: { base: '谷物 5g+水50ml', add: [{ foodId: 'broccoli', label: '西兰花泥1勺', qty: '1 勺' }] },
  29: { base: '谷物 5g+水50ml', add: [{ foodId: 'broccoli', label: '西兰花泥2勺', qty: '2 勺' }, { foodId: 'beef', label: '牛肉泥2勺', qty: '2 勺' }] },
  30: { base: '谷物 5g+水50ml', add: [{ foodId: 'broccoli', label: '西兰花泥3勺', qty: '3 勺' }, { foodId: 'beef', label: '牛肉泥3勺', qty: '3 勺' }] }
}

/** 生日 + 日期 →「6+N」菜单日。anchor = 生日 + 6 个日历月；anchor 当天记作
 *  菜单第 1 天（与菜单起步档一致）。越界（非 6 月龄窗口）返回值交给调用方
 *  按 1..30 夹取，夹不住就落回原引擎。 */
function menuDayOf(birth, d) {
  if (!birth) return 0
  const b = parseDateKey(birth)
  if (isNaN(b.getTime())) return 0
  const day = parseDateKey(d)
  const anchor = new Date(b.getFullYear(), b.getMonth() + 6, b.getDate())
  const diff = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()) - anchor) / 86400000)
  return diff + 1
}

/* ---------- 主流程 ---------- */

/**
 * @param {object} opts
 *   months           月龄（必填）
 *   issues           当前状态 key 数组（多选，不含 sick）—— 见 storage.STATUSES
 *   sick             宝宝生病中（true 时暂停引入新食材，并偏向易消化菜谱）
 *                    —— 它在界面上是状态里的一项，但语义是硬开关，所以单独传
 *   safeFoodIds      已确认安全的食材 id 数组
 *   blockedFoodIds   已确认「有反应」的食材 id 数组（唯一会被系统性排除的一类）
 *   recordedFoodIds  所有记录过的食材 id 数组（含观察中/异常）
 *   observingCount   正在观察中的食材数量
 *   startDate        Date，默认今天
 * @returns {object|null}
 */
function generate(opts) {
  const months = opts.months
  const stage = age.getStage(months)
  if (!stage) return null

  const issues = opts.issues || []
  const safeIds = opts.safeFoodIds || []
  const blockedIds = opts.blockedFoodIds || []
  const recordedIds = opts.recordedFoodIds || []

  const sick = !!opts.sick
  // 多个状态各自贡献标签；去重后交给 pickWeighted（命中任一 ×3，不叠加）
  const issueTags = []
  for (let i = 0; i < issues.length; i++) {
    const t = STATUS_TAG[issues[i]]
    if (t && issueTags.indexOf(t) < 0) issueTags.push(t)
  }
  if (sick && STATUS_TAG.sick && issueTags.indexOf(STATUS_TAG.sick) < 0) {
    issueTags.push(STATUS_TAG.sick)
  }
  const start = opts.startDate ? parseDateKey(opts.startDate) : new Date()
  start.setHours(0, 0, 0, 0)

  // 隐式重排传入的「已发生的日子」（见 replanOpts）：按日期建索引，逐天照抄。
  // 只收日期 ≤ 今天的 —— 未来的日子必须允许重排，否则计划从此不再更新。
  const todayKey = dateKey(new Date())
  const frozenByDate = {}
  ;(opts.frozenDays || []).forEach(function (day) {
    if (day && day.date && day.date <= todayKey) frozenByDate[day.date] = day
  })

  // 1. 候选池
  // 只排除「用户确认有反应」的食材。未引入过的致敏食材不排除，但只能走新食材通道
  // （见 recipeUsable 注释：排除它们等于「盲目回避」，与准则二相悖）。
  let pool = RECIPES.filter(function (r) {
    return age.isRecipeSuitable(r, months) && recipeUsable(r, safeIds, blockedIds)
  })

  // 候选太少时放宽：只保留「不含已确认有反应食材」这一条底线，不再额外排除致敏食材
  if (pool.length < 8) {
    const relaxed = RECIPES.filter(function (r) {
      if (!age.isRecipeSuitable(r, months)) return false
      const all = r.mainFoods.concat(r.sideFoods || [])
      for (let i = 0; i < all.length; i++) {
        if (blockedIds.indexOf(all[i]) >= 0) return false
      }
      return true
    })
    if (relaxed.length > pool.length) pool = relaxed
  }

  // 极端情况：连放宽都不够，就用全部月龄合适的（仍然排除已确认有反应的）
  if (pool.length === 0) {
    pool = RECIPES.filter(function (r) {
      if (!age.isRecipeSuitable(r, months)) return false
      const all = r.mainFoods.concat(r.sideFoods || [])
      for (let i = 0; i < all.length; i++) {
        if (blockedIds.indexOf(all[i]) >= 0) return false
      }
      return true
    })
  }
  if (pool.length === 0) return null

  // 1.1 正餐池 / 加餐池分槽（v2.9 · 用户决策①）：水果泥与糕饼只进加餐池，
  //     不占正餐位。mainPool 空（极端屏蔽场景）时退回整池 ——
  //     一份「正餐里有水果泥」的计划好过排不出餐的空计划。
  const snackPool = pool.filter(isSnackRecipe)
  const mainPool = pool.filter(function (r) { return !isSnackRecipe(r) })
  if (!mainPool.length) mainPool = pool.slice()

  // 餐次与时段锚点（v2.9 · 决策②③）：按月龄对齐知识卡与固定菜单，
  // 不再随性状阶段走（见 age.mealsForMonth / age.slotsForMonth）
  const mealsPerDay = age.mealsForMonth(months)
  const slots = age.slotsForMonth(months)

  // 6 月固定菜单锁定（v2.9 · ④）：生日进指纹后每天各自算「6+N」菜单日
  // （窗口可跨月龄边界）。没有 birth 的直接调用（旧测试路径/详情页）走
  // 原引擎 + monthAmount 稳态值，行为不变。
  const menuLock = months === 6 && !!opts.birth

  // 2. 安排新食材引入日（只在工作日，最多 2 天，遇周末顺延不丢槽 —— newFoodSlots）
  //
  // ⚠️ 排序规则：按月龄升序，同月龄内把「致敏」和「非致敏」交错开。
  // 不要把所有致敏食材排到最后 —— 那等于系统性地推迟易过敏食物的引入，
  // 而官方指南明确说「1岁内适时引入」可以降低过敏风险，「避免食用未见明显益处」。
  const newFoodDays = {}
  // WS/T 678—2020 3.8：患病期间暂停添加新的辅食
  // v2.9 · ④：6 月菜单锁定日的新食材卡由菜单加料派生（见日循环 3.0），这里不排
  if (!opts.observingCount && !sick && !menuLock) {
    const pool2 = FOODS.filter(function (f) {
      // introducible === false 是「禁食提示条目」（蜂蜜），不是待引入的辅食。
      // 漏掉这一条，12 月龄时会把蜂蜜当成新食材排进计划，
      // 展示成「新食材尝试 · 蜂蜜 / 一岁以内禁食 / 观察 3 天」。
      if (f.introducible === false) return false
      return f.minMonth <= months && recordedIds.indexOf(f.id) < 0 && blockedIds.indexOf(f.id) < 0
    })
    pool2.sort(function (a, b) {
      if (a.minMonth !== b.minMonth) return a.minMonth - b.minMonth
      return 0
    })
    const candidates = interleaveByAllergen(pool2)
    const slots = newFoodSlots(start) // 第 1 个可用工作日 + 间隔 ≥3 天的下一个（遇周末顺延）
    let assigned = 0
    for (let s = 0; s < slots.length && assigned < candidates.length; s++) {
      const idx = slots[s]
      const d = new Date(start.getTime())
      d.setDate(d.getDate() + idx)
      if (isWeekend(d)) continue // 槽位本身已避开周末，这里只是兜底
      const fz = frozenByDate[dateKey(d)]
      if (fz) {
        // 这天已经发生过：它自带 newFood，原样保留即可。
        // 名额是否消耗看候选对不对得上：对得上（记录没变）就消耗，
        // 保持「第 1 个候选给第 1 个槽位」的连续性；对不上
        // （recordedIds 变了、候选列表整体前移）就不消耗，
        // 让后面的候选顶上，别把整个引入序列跳掉一种。
        const next = candidates[assigned]
        if (fz.newFood && next && next.id === fz.newFood.foodId) assigned++
        continue
      }
      newFoodDays[idx] = candidates[assigned]
      assigned++
    }
  }

  // 3. 逐天生成
  const usedCount = {}
  const days = []
  const foodUse = {} // 用于采购清单统计

  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime())
    d.setDate(d.getDate() + i)

    // 已发生的日子（隐式重排时由 replanOpts 传入）整天照抄，不参与选菜：
    // 打卡是按 date|recipeId 落库的，整天被重排后 recipeId 不在新计划里，
    // 已打卡的行会从计划页凭空消失（记录没丢，但「哪一餐吃了没」对不上了）。
    // 但用量必须照常计入 —— 未来几餐要避开这些已用过的菜/主料，
    // 采购清单也要覆盖整周，而不是「从今天起」。
    const fz = frozenByDate[dateKey(d)]
    if (fz) {
      days.push(fz)
      // v2.9：冻结日带加餐行，用量/采购照常计入（旧版冻结日没有 snack，天然跳过）
      ;(fz.meals || []).concat(fz.snack ? [fz.snack] : []).forEach(function (m) {
        usedCount[m.recipeId] = (usedCount[m.recipeId] || 0) + 1
        const r = RECIPE_MAP[m.recipeId]
        if (!r) return
        for (let k = 0; k < r.mainFoods.length; k++) {
          foodUse[r.mainFoods[k]] = (foodUse[r.mainFoods[k]] || 0) + 1
        }
        for (let k = 0; k < (r.sideFoods || []).length; k++) {
          foodUse[r.sideFoods[k]] = (foodUse[r.sideFoods[k]] || 0) + 1
        }
      })
      // v2.9 · ④：菜单锁定日的加料不在菜谱 foods 里，冻结重排时单独计入采购
      ;(fz.menuAdd || []).forEach(function (a) {
        foodUse[a.foodId] = (foodUse[a.foodId] || 0) + 1
      })
      continue
    }

    let nf = newFoodDays[i] || null
    let nfQty = null // v2.9 · ④：菜单锁定日新食材卡用量取菜单勺数（1/2/3 勺）

    // 3.0 6 月固定菜单锁定（v2.9 · ④ 用户决策「主食严格按固定食谱」）：
    // 正餐 = 米粉 + 当日菜单用量（定值，重新生成不变）；15:00 加餐 6+19 起
    // 才有水果 ——「重新生成计划只修改水果加餐」改的就是这里（水果加权随机）。
    // 拿不到菜单日（越界/缺生日）就落回原引擎，7 月+ 与旧测试路径不受影响。
    let menuDay = 0
    if (menuLock) {
      const md0 = menuDayOf(opts.birth, d)
      if (md0 >= 1 && md0 <= 30) menuDay = md0
    }
    if (menuDay) {
      const entry = MENU_6[menuDay]
      // 加料过滤：有反应永远剔除；病中/观察中剔「未记录」的 —— 新食材暂停
      // 语义优先于菜单（WS/T 678—2020 3.8），已引入过的照排。
      const add = (entry.add || []).filter(function (a) {
        if (blockedIds.indexOf(a.foodId) >= 0) return false
        if ((sick || opts.observingCount) && recordedIds.indexOf(a.foodId) < 0) return false
        return true
      })
      const amount = entry.base + add.map(function (a) { return '+' + a.label }).join('')
      // 加料进采购清单（正餐行的 recipe foods 只有米粉，加料得单独计数）
      add.forEach(function (a) { foodUse[a.foodId] = (foodUse[a.foodId] || 0) + 1 })
      const rice = RECIPE_MAP['r_rice_cereal']

      // 新食材卡由菜单加料派生：第一个未记录且非屏蔽的（油脂不进卡 ——
      // foods.js 注明油不需单独观察）；菜单前 3 天的「新食材」就是米粉本身。
      if (!sick && !opts.observingCount) {
        for (let k = 0; k < add.length && !nf; k++) {
          const f = FOOD_MAP[add[k].foodId]
          if (!f || f.category === '油脂') continue
          if (recordedIds.indexOf(f.id) >= 0 || blockedIds.indexOf(f.id) >= 0) continue
          nf = f
          nfQty = add[k].qty
        }
        if (!nf && menuDay <= 3 && recordedIds.indexOf('rice_cereal') < 0 && blockedIds.indexOf('rice_cereal') < 0) {
          nf = FOOD_MAP['rice_cereal']
          nfQty = entry.base.slice(3) // 卡片用量显示菜单起步档（2.5g+水40ml）
        }
      }

      const menuMeals = []
      if (rice) {
        usedCount[rice.id] = (usedCount[rice.id] || 0) + 1
        foodUse[rice.mainFoods[0]] = (foodUse[rice.mainFoods[0]] || 0) + 1
        const row = mealRow(rice, 'm' + i + '_0', months, amount)
        // 餐次行小标签补上加料类别（土豆在 foods.js 归谷薯 → 谷物，去重自然处理）
        add.forEach(function (a) {
          const f = FOOD_MAP[a.foodId]
          if (f && COUNTED_CATS.indexOf(f.category) >= 0 && row.cats.indexOf(f.category) < 0) row.cats.push(f.category)
        })
        menuMeals.push(row)
      }

      // 水果加餐：6+19 起才有（菜单节奏要点「水果泥从 6+19 起加入 15:00」），
      // 从加餐池加权随机 —— 正餐是定值，重新生成时唯一会变的就是这份水果。
      let menuSnack = null
      if (menuDay >= MENU_6_SNACK_START && snackPool.length) {
        menuSnack = pickWeighted(snackPool, usedCount, { 'rice_cereal': true }, issueTags, {}, opts.refusedRecipeIds)
      }

      // 当日类别与覆盖（与原引擎同口径：菜谱类别 + 加料类别 + 新食材类别）
      const dayCatsMenu = {}
      if (rice) Object.keys(catsOf(rice)).forEach(function (c) { dayCatsMenu[c] = true })
      add.forEach(function (a) {
        const f = FOOD_MAP[a.foodId]
        if (f && COUNTED_CATS.indexOf(f.category) >= 0) dayCatsMenu[f.category] = true
      })
      if (nf && FOOD_MAP[nf.id] && COUNTED_CATS.indexOf(FOOD_MAP[nf.id].category) >= 0) {
        dayCatsMenu[FOOD_MAP[nf.id].category] = true
      }
      let menuSnackRow = null
      if (menuSnack) {
        usedCount[menuSnack.id] = (usedCount[menuSnack.id] || 0) + 1
        for (let k = 0; k < menuSnack.mainFoods.length; k++) {
          foodUse[menuSnack.mainFoods[k]] = (foodUse[menuSnack.mainFoods[k]] || 0) + 1
        }
        for (let k = 0; k < (menuSnack.sideFoods || []).length; k++) {
          foodUse[menuSnack.sideFoods[k]] = (foodUse[menuSnack.sideFoods[k]] || 0) + 1
        }
        Object.keys(catsOf(menuSnack)).forEach(function (c) { dayCatsMenu[c] = true })
        menuSnackRow = mealRow(menuSnack, 's' + i, months)
      }

      const coveredMenu = dayCatSet(dayCatsMenu)
      const missingMenu = REQUIRED_CATS.filter(function (c) { return !coveredMenu[c] })
      const catCountMenu = Object.keys(coveredMenu).length
      days.push({
        date: dateKey(d),
        dateLabel: (d.getMonth() + 1) + '/' + pad2(d.getDate()),
        weekday: WEEKDAYS[d.getDay()],
        isWeekend: isWeekend(d),
        meals: menuMeals,
        snack: menuSnackRow, // null = 菜单第 19 天之前：15:00 空白（timeline 自然少一行）
        catCount: catCountMenu,
        catNames: Object.keys(dayCatsMenu),
        catApplicable: months >= 8, // 6 月恒 false（「逐渐达到」豁免语义与原引擎一致）
        catOk: catCountMenu >= DAY_MIN_CATS && missingMenu.length === 0,
        catMissing: missingMenu,
        newFood: nf
          ? {
              foodId: nf.id,
              name: nf.name,
              amount: nfQty || nf.firstIntro.amount,
              method: nf.firstIntro.method,
              observeDays: 3,
              note: nf.note || '',
              icon: icons.iconFor(nf),
              iconBg: icons.bgFor(nf)
            }
          : null,
        menuDay: menuDay, // 调试与校验用（_validate §6s 按它断言菜单日）
        // 菜单加料清单：冻结日被复制重排时，采购清单靠它补上加料食材
        menuAdd: add.map(function (a) { return { foodId: a.foodId, label: a.label } })
      })
      continue
    }

    // 3.1 先按加权随机选出当天的正餐（正餐先选：主槽是锚点，加餐随后补位）
    const dayMainUse = {}
    const dayCats = {}
    const picked = []
    for (let m = 0; m < mealsPerDay; m++) {
      const recipe = pickWeighted(mainPool, usedCount, dayMainUse, issueTags, dayCats, opts.refusedRecipeIds)
      if (!recipe) break
      picked.push(recipe)
      for (let k = 0; k < recipe.mainFoods.length; k++) dayMainUse[recipe.mainFoods[k]] = true
      const rc0 = catsOf(recipe)
      Object.keys(rc0).forEach(function (c) { dayCats[c] = true })
    }

    // 3.2 加餐再选（v2.9 · 决策①）：从独立的加餐池出 —— 水果泥/糕饼不占正餐位；
    //     dayMainUse 已含正餐主料，加餐自动避开同主料（比如正餐有燕麦苹果粥就不再配苹果泥）；
    //     传 dayCats：正餐随机挑选若漏了必需类，加餐优先补位（再由修补循环保底）。
    //     不排与当天新食材同源的菜：新食材那 3 天观察口是一两勺，
    //     同一天再拿它当一整份加餐，排敏语义就乱了。
    let snack = null
    if (snackPool.length) {
      let snackCands = snackPool
      if (nf) {
        const filtered = snackPool.filter(function (r) {
          return r.mainFoods.concat(r.sideFoods || []).indexOf(nf.id) < 0
        })
        if (filtered.length) snackCands = filtered
      }
      snack = pickWeighted(snackCands, usedCount, dayMainUse, issueTags, dayCats, opts.refusedRecipeIds)
    }

    // 3.3 确定性修补：把「每日不少于4类，且含动物性/蔬菜/谷薯」补到位。
    //     只靠加权随机命中率不够（实测约 76%），这里做一次定向替换。
    //     加餐的类别算进覆盖（官方「每日4 类」数的是全天食物，不只正餐）；
    //     6~7 月龄官方原文是「逐渐达到」，正餐 <2 时不做修补。
    if (mealsPerDay >= 2 && picked.length >= 2) {
      for (let pass = 0; pass < 4; pass++) {
        const cur = coverageOf(picked, nf, snack)
        const curMissing = REQUIRED_CATS.filter(function (c) { return !cur[c] })
        if (curMissing.length === 0 && Object.keys(cur).length >= DAY_MIN_CATS) break

        let best = null
        for (let idx = 0; idx < picked.length; idx++) {
          const rest = picked.filter(function (_, k) { return k !== idx })
          for (let c = 0; c < mainPool.length; c++) {
            const cand = mainPool[c]
            if (picked.indexOf(cand) >= 0) continue
            const cov = coverageOf(rest.concat([cand]), nf, snack)
            const sc = covScore(cov)
            // 覆盖度相同时，优先选「本周用得少」的那道。
            // 否则修补循环会退化成「取池子里第一个最优解」，让靠前的高覆盖菜
            // （例如一次补齐动物性+豆类的那道）被跨天反复选中，一周重复 4~5 次。
            const rep = usedCount[cand.id] || 0
            if (!best || sc > best.sc || (sc === best.sc && rep < best.rep)) {
              best = { idx: idx, cand: cand, sc: sc, rep: rep }
            }
          }
        }
        if (!best) break
        if (best.sc <= covScore(cur)) break   // 换了没变好，停
        picked[best.idx] = best.cand
      }
    }

    // 3.4 结算这一天的用量与类别覆盖（v2.9：加餐一并计入 —— 采购、
    //     去重计数、当日类别都按「全天吃进嘴的」算，不只算正餐）
    const dayCatsFinal = {}
    const meals = []
    for (let m = 0; m < picked.length; m++) {
      const recipe = picked[m]
      usedCount[recipe.id] = (usedCount[recipe.id] || 0) + 1
      for (let k = 0; k < recipe.mainFoods.length; k++) {
        foodUse[recipe.mainFoods[k]] = (foodUse[recipe.mainFoods[k]] || 0) + 1
      }
      for (let k = 0; k < (recipe.sideFoods || []).length; k++) {
        foodUse[recipe.sideFoods[k]] = (foodUse[recipe.sideFoods[k]] || 0) + 1
      }
      const rc = catsOf(recipe)
      Object.keys(rc).forEach(function (c) { dayCatsFinal[c] = true })

      meals.push(mealRow(recipe, 'm' + i + '_' + m, months))
    }

    let snackRow = null
    if (snack) {
      usedCount[snack.id] = (usedCount[snack.id] || 0) + 1
      for (let k = 0; k < snack.mainFoods.length; k++) {
        foodUse[snack.mainFoods[k]] = (foodUse[snack.mainFoods[k]] || 0) + 1
      }
      for (let k = 0; k < (snack.sideFoods || []).length; k++) {
        foodUse[snack.sideFoods[k]] = (foodUse[snack.sideFoods[k]] || 0) + 1
      }
      const rc = catsOf(snack)
      Object.keys(rc).forEach(function (c) { dayCatsFinal[c] = true })

      snackRow = mealRow(snack, 's' + i, months)
    }

    const coveredSet = coverageOf(picked, nf, snack)
    const catKeys = Object.keys(coveredSet)
    const missingRequired = REQUIRED_CATS.filter(function (c) { return !coveredSet[c] })
    const catNames = []
    Object.keys(dayCatsFinal).forEach(function (c) { catNames.push(c) })
    if (nf && FOOD_MAP[nf.id] && COUNTED_CATS.indexOf(FOOD_MAP[nf.id].category) >= 0) {
      catNames.push(FOOD_MAP[nf.id].category)
    }

    days.push({
      date: dateKey(d),
      dateLabel: (d.getMonth() + 1) + '/' + pad2(d.getDate()),
      weekday: WEEKDAYS[d.getDay()],
      isWeekend: isWeekend(d),
      meals: meals,
      snack: snackRow, // v2.9 加餐行（null = 当天加餐池空/没排上），与正餐行同构
      catCount: catKeys.length,
      catNames: catNames,
      // 6~7 月龄官方原文是「逐渐达到」，不作硬要求（v2.9 起 7 月龄也按固定菜单
      // 排 2 餐，但该月菜池全是单类菜，4 类 + 3 必需靠加餐也补不齐 —— 豁免语义不变）
      catApplicable: months >= 8,
      catOk: catKeys.length >= DAY_MIN_CATS && missingRequired.length === 0,
      catMissing: missingRequired,
      newFood: nf
        ? {
            foodId: nf.id,
            name: nf.name,
            amount: nf.firstIntro.amount,
            method: nf.firstIntro.method,
            observeDays: 3,
            note: nf.note || '',
            // v2.0 图标：只作展示，不进指纹（见 planSignature）
            icon: icons.iconFor(nf),
            iconBg: icons.bgFor(nf)
          }
        : null
    })
  }

  // 4. 采购清单（按食材分类聚合，标注本周出现次数）
  const CATEGORY_ORDER = ['谷物', '蔬菜', '水果', '肉禽', '水产', '蛋奶', '豆类', '油脂']
  const grouped = {}
  Object.keys(foodUse).forEach(function (fid) {
    const f = FOOD_MAP[fid]
    if (!f) return
    if (!grouped[f.category]) grouped[f.category] = []
    grouped[f.category].push({
      foodId: fid,
      name: f.name,
      count: foodUse[fid],
      // v2.0 图标：采购清单行徽标（只作展示，不进指纹）
      icon: icons.iconFor(f),
      iconBg: icons.bgFor(f)
    })
  })

  const shopping = []
  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const c = CATEGORY_ORDER[i]
    if (grouped[c] && grouped[c].length) {
      grouped[c].sort(function (a, b) { return b.count - a.count })
      shopping.push({ category: c, items: grouped[c] })
    }
  }

  return {
    generatedAt: Date.now(),
    // 结构版本（structure version）：meal 字段变化必须 bump ——
    // 缓存里的旧计划靠它触发失效重算（v2.7 加了 cats + 步骤填数）
    sv: STRUCT_V,
    startDate: dateKey(start),
    months: months,
    stageKey: stage.key,
    stageLabel: stage.label,
    stageDesc: stage.desc,
    mealsPerDay: mealsPerDay,
    // v2.9 时段锚点（方案A）：每天的时段模板，由 index.js markToday 按当天
    // 正餐/加餐填成渲染行（day.timeline）；main 槽数 === mealsPerDay
    slots: slots,
    issues: issues,
    sick: sick,
    days: days,
    shopping: shopping,
    shoppingCount: Object.keys(foodUse).length
  }
}

/**
 * 生成计划所需的全部输入 —— 只在这一处收集。
 *
 * 关键：**缓存失效判断必须和实际生成读同一组输入**。
 * 之前的写法是页面里自己判 `p.months !== months`，结果漏掉了
 * 状态（多选）/ 生病 / 已引入食材 —— 用户把某食材标成「有反应」后，
 * 缓存计划里那道菜还在，下次打开照样推荐（这是安全相关的缺陷，
 * 「有反应」的语义就是永久排除）。
 *
 * 注意 issues 是数组：状态改成多选后，勾上或取消任意一项都必须让指纹变化。
 */
function planInputs(storage) {
  const baby = storage.getBaby()
  // 名称和出生日期都是必填。首页另有一层 isConfigured 拦截，这里是引擎
  // 自己的闸门 —— 免得哪条调用路径绕过去，生成一份「没名字」的计划。
  // 只判**有没有**名字：名称的取值不进返回值，改名不该重排计划。
  if (!baby || !baby.name || !baby.birthday) return null
  const months = age.monthsBetween(baby.birthday)
  if (months === null) return null

  return {
    months: months,
    // 6 月固定菜单按生日锚定「6+N」菜单日（v2.9 · ④）；进指纹 —— 生日改了
    // 菜单日整体错位，必须触发重算（名称取值仍不进指纹，见 planSignature 注释）
    birth: baby.birthday,
    issues: storage.getIssues(),
    sick: storage.getSick(),
    safeFoodIds: storage.safeFoodIds(),
    blockedFoodIds: storage.badFoodIds(),
    recordedFoodIds: storage.recordedFoodIds(),
    observingCount: storage.observingFoodIds().length,
    // 每餐打卡回写（v2.1）：连续拒吃的菜 → 软降权名单。
    // 只影响权重，不进候选过滤 —— §5 的池子不变量不许被它碰到。
    refusedRecipeIds: storage.refusedRecipeIds()
  }
}

/** 输入指纹：任一输入变了，缓存的计划就该重算。
 *  注意名称**不进**指纹：它只作为必填闸门（缺了 planInputs 返回 null），
 *  取值变化不影响生成结果，改个名字不该白重排一次计划。 */
function planSignature(storage) {
  const inputs = planInputs(storage)
  if (!inputs) return null
  const list = function (a) {
    return (a || []).slice().sort().join(',')
  }
  return [
    'm' + inputs.months,
    // 6 月固定菜单锚定日（v2.9 · ④）：生日变了菜单日错位，必须重算
    'd' + inputs.birth,
    // 排序后再拼：多选项的勾选顺序不该影响指纹，
    // 否则同一组状态换个顺序就会白重算一次
    'i' + list(inputs.issues),
    's' + (inputs.sick ? 1 : 0),
    'k' + list(inputs.safeFoodIds),
    'b' + list(inputs.blockedFoodIds),
    'r' + list(inputs.recordedFoodIds),
    'o' + inputs.observingCount,
    // 打卡降权名单（排序同上：名单顺序不该影响指纹）
    'f' + list(inputs.refusedRecipeIds)
  ].join('|')
}

/**
 * 隐式重排时该保留什么（P2 修复）。
 *
 * 只要输入指纹变了（改状态 / 标「有反应」/ 第二次拒吃……）refresh 就会重算。
 * 直接从今天重排有两个后果：
 *   1. 窗口前移 —— 周一生成的计划周三重排变成周三~下周二，
 *      本周已排的未来餐被整体换掉；
 *   2. 打卡行凭空消失 —— 打卡按 date|recipeId 落库，已过去的整天被重排后
 *      recipeId 不在新计划里，计划页不再渲染这些行（数据仍在「我的」14 天
 *      记录里，但用户看到的「哪一餐吃了没」断了）。
 *
 * 所以：旧计划仍覆盖今天时，沿用它的起始日（窗口不前移），
 * 并把「日期 ≤ 今天」的整天原样冻结，只有明天之后的日子参与重排 ——
 * 降权/新输入只影响未来的餐，这才是「重排」应有的语义。
 *
 * 明确点「重新生成」不走这里：用户已经确认「原来的会被替换」。
 *
 * @param {object|null} p 缓存的计划（storage.getPlan() 的结果，未做 markToday 装饰）
 * @returns {{startDate: string, frozenDays: object[]}|null} null = 没有可保留的，照旧从今天整份重来
 */
function replanOpts(p) {
  if (!p || !p.startDate || !p.days || !p.days.length) return null
  const todayKey = dateKey(new Date())
  // 窗口已经不覆盖今天 → 整份计划都成了过去时，没有可冻结的日子
  if (p.days[0].date > todayKey || p.days[p.days.length - 1].date < todayKey) return null
  const frozen = p.days.filter(function (d) { return d.date <= todayKey })
  if (!frozen.length) return null
  return { startDate: p.startDate, frozenDays: frozen }
}

/** 从当前存储状态直接生成（页面调这个）
 *  @param {object} [opts] 见 replanOpts —— 只在隐式重排时传 */
function generateFromStorage(storage, opts) {
  const inputs = planInputs(storage)
  if (!inputs) return null

  if (opts) {
    // 只是把窗口/冻结信息带进 generate，不参与指纹
    // （planSignature 自己重新 planInputs，不受影响）
    if (opts.startDate) inputs.startDate = opts.startDate
    if (opts.frozenDays) inputs.frozenDays = opts.frozenDays
  }

  const p = generate(inputs)
  // 把指纹写进计划，页面用它判断缓存是否过期
  if (p) p.signature = planSignature(storage)
  return p
}

module.exports = {
  generate: generate,
  MENU_6: MENU_6,                         // 6 月固定菜单逐日表（v2.9 · ④，§6s 逐字钉）
  MENU_6_SNACK_START: MENU_6_SNACK_START, // 水果加餐起始菜单日（菜单：6+19 起 15:00）
  menuDayOf: menuDayOf,                   // 生日 + 日期 →「6+N」菜单日
  generateFromStorage: generateFromStorage,
  replanOpts: replanOpts,
  planInputs: planInputs,
  planSignature: planSignature,
  getFood: getFood,
  foodName: foodName,
  dateKey: dateKey,
  amountForStage: amountForStage, // 食材详情页按月龄档取分量（步骤填数用）
  fillPortions: fillPortions,     // 步骤 {分类} 占位符填数（计划页与食材详情页共用）
  isSnackRecipe: isSnackRecipe,   // 加餐分类口径（正餐/加餐分槽，_validate §6q 钉死）
  STRUCT_V: STRUCT_V,
  WEEKDAYS: WEEKDAYS
}
