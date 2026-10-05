/**
 * 计划生成规则引擎
 *
 * 这里是整个产品的核心：不调用任何大模型，全部靠规则匹配。
 * 好处是结果 100% 可控、可复现、零成本，而且每条内容都能追溯到数据表。
 *
 * 规则顺序：
 *   1. 月龄 → 性状档位 + 每日餐次
 *   2. 候选池 = 月龄合适 且 主料安全（高致敏食材必须已确认安全）
 *   3. 按「当前状态」加权（多选，每个状态各自贡献一个标签，命中任一 ×3）
 *   4. 去重（软约束）：同一道菜用过之后权重 ×0.2/次；当天已用主料权重 ×0.3
 *      —— 是权重衰减不是硬上限，实测一周最多 3 次、同日撞主料约 8~14% 的天。
 *      官方要求的多样性在「类别」层面，由下方每日 4 类覆盖的修补循环保证。
 *   5. 插入新食材名额（每周最多 2 个，只排工作日，遇周末顺延不丢槽）
 *   6. 隐式重排（replanOpts）：旧计划仍覆盖今天时沿用它的起始日，
 *      冻结「日期 ≤ 今天」的整天，只重排明天之后的餐
 */

const age = require('./age')
const FOODS = require('../data/foods')
const RECIPES = require('../data/recipes')
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
function amountForStage(recipe, months) {
  if (!recipe || !recipe.amount) return ''
  const key = (months >= 13 && months <= 24) ? '13-24' : '7-12'
  return recipe.amount[key] || recipe.amount.default || ''
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

/** 一组菜谱（+可选新食材）合并后的类别覆盖，动物性已合并 */
function coverageOf(recipes, newFood) {
  const cats = {}
  for (let i = 0; i < recipes.length; i++) {
    const rc = catsOf(recipes[i])
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
    // 而且修补循环只按覆盖度换菜、不检查这里，所以同日撞主料仍会发生）
    for (let i = 0; i < r.mainFoods.length; i++) {
      const fid = r.mainFoods[i]
      if (dayMainUse[fid]) w *= 0.3
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

  // 2. 安排新食材引入日（只在工作日，最多 2 天，遇周末顺延不丢槽 —— newFoodSlots）
  //
  // ⚠️ 排序规则：按月龄升序，同月龄内把「致敏」和「非致敏」交错开。
  // 不要把所有致敏食材排到最后 —— 那等于系统性地推迟易过敏食物的引入，
  // 而官方指南明确说「1岁内适时引入」可以降低过敏风险，「避免食用未见明显益处」。
  const newFoodDays = {}
  // WS/T 678—2020 3.8：患病期间暂停添加新的辅食
  if (!opts.observingCount && !sick) {
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
      ;(fz.meals || []).forEach(function (m) {
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
      continue
    }

    const nf = newFoodDays[i] || null

    // 3.1 先按加权随机选出当天的菜
    const dayMainUse = {}
    const dayCats = {}
    const picked = []
    for (let m = 0; m < stage.meals; m++) {
      const recipe = pickWeighted(pool, usedCount, dayMainUse, issueTags, dayCats, opts.refusedRecipeIds)
      if (!recipe) break
      picked.push(recipe)
      for (let k = 0; k < recipe.mainFoods.length; k++) dayMainUse[recipe.mainFoods[k]] = true
      const rc0 = catsOf(recipe)
      Object.keys(rc0).forEach(function (c) { dayCats[c] = true })
    }

    // 3.2 确定性修补：把「每日不少于4类，且含动物性/蔬菜/谷薯」补到位。
    //     只靠加权随机命中率不够（实测约 76%），这里做一次定向替换。
    //     6~7 月龄每天只有 1 餐，物理上凑不齐 4 类，官方原文也是「逐渐达到」，
    //     所以 meals >= 2 才做修补。
    if (stage.meals >= 2 && picked.length >= 2) {
      for (let pass = 0; pass < 4; pass++) {
        const cur = coverageOf(picked, nf)
        const curMissing = REQUIRED_CATS.filter(function (c) { return !cur[c] })
        if (curMissing.length === 0 && Object.keys(cur).length >= DAY_MIN_CATS) break

        let best = null
        for (let idx = 0; idx < picked.length; idx++) {
          const rest = picked.filter(function (_, k) { return k !== idx })
          for (let c = 0; c < pool.length; c++) {
            const cand = pool[c]
            if (picked.indexOf(cand) >= 0) continue
            const cov = coverageOf(rest.concat([cand]), nf)
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

    // 3.3 结算这一天的用量与类别覆盖
    const dayMainUseFinal = {}
    const dayCatsFinal = {}
    const meals = []
    for (let m = 0; m < picked.length; m++) {
      const recipe = picked[m]
      usedCount[recipe.id] = (usedCount[recipe.id] || 0) + 1
      for (let k = 0; k < recipe.mainFoods.length; k++) {
        dayMainUseFinal[recipe.mainFoods[k]] = true
        foodUse[recipe.mainFoods[k]] = (foodUse[recipe.mainFoods[k]] || 0) + 1
      }
      for (let k = 0; k < (recipe.sideFoods || []).length; k++) {
        foodUse[recipe.sideFoods[k]] = (foodUse[recipe.sideFoods[k]] || 0) + 1
      }
      const rc = catsOf(recipe)
      Object.keys(rc).forEach(function (c) { dayCatsFinal[c] = true })

      meals.push({
        key: 'm' + i + '_' + m,
        recipeId: recipe.id,
        name: recipe.name,
        texture: recipe.texture,
        amount: amountForStage(recipe, months),
        tags: recipe.tags || [],
        steps: recipe.steps || []
      })
    }

    const coveredSet = coverageOf(picked, nf)
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
      catCount: catKeys.length,
      catNames: catNames,
      // 6~7 月龄每天只有 1 餐，凑不齐 4 类是正常的（官方原文是「逐渐达到」），
      // 所以只有 meals >= 2 时才把这条当作应当满足的要求
      catApplicable: stage.meals >= 2,
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
    startDate: dateKey(start),
    months: months,
    stageKey: stage.key,
    stageLabel: stage.label,
    stageDesc: stage.desc,
    mealsPerDay: stage.meals,
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
  generateFromStorage: generateFromStorage,
  replanOpts: replanOpts,
  planInputs: planInputs,
  planSignature: planSignature,
  getFood: getFood,
  foodName: foodName,
  dateKey: dateKey,
  WEEKDAYS: WEEKDAYS
}
