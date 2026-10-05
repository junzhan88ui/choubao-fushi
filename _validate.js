/**
 * 交付前自检脚本（一次性，交付后可删）
 * 运行： node _validate.js
 */
const fs = require('fs')
const path = require('path')

const foods = require('./data/foods')
const recipes = require('./data/recipes')
const age = require('./utils/age')
const storage = require('./utils/storage')
const plan = require('./utils/plan')

let errs = []
let warns = []
const E = (m) => errs.push(m)
const W = (m) => warns.push(m)

/* ---------- 1. app.json 页面与 tabBar ---------- */
const appJson = JSON.parse(fs.readFileSync('./app.json', 'utf8'))
appJson.pages.forEach((p) => {
  ;['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    const f = `${p}.${ext}`
    if (!fs.existsSync(f)) E(`app.json 声明的页面文件缺失：${f}`)
  })
})
;(appJson.tabBar.list || []).forEach((t) => {
  if (appJson.pages.indexOf(t.pagePath) === -1) E(`tabBar 的 ${t.pagePath} 不在 pages 列表里`)
})

/* ---------- 1b. 实现了 onPullDownRefresh 的页面必须开 enablePullDownRefresh ----------
 * 没开的话手势根本不触发，onPullDownRefresh 是死代码（本次审查就查出过这条）。
 */
appJson.pages.forEach((p) => {
  const js = fs.readFileSync(`./${p}.js`, 'utf8')
  if (js.indexOf('onPullDownRefresh') < 0) return
  const conf = JSON.parse(fs.readFileSync(`./${p}.json`, 'utf8'))
  if (conf.enablePullDownRefresh !== true)
    E(`${p} 实现了 onPullDownRefresh，但 ${p}.json 没开 enablePullDownRefresh —— 手势不会触发，函数是死代码`)
})

/* ---------- 1c. 「今天」视觉锚点必须三段接上 ----------
 * 链路：index.js 算 isToday → index.wxml 绑成 class → index.wxss 生效。
 * 断在中间那段（WXML 写死 class、没做条件绑定）的话，JS 每次 onShow
 * 照样跑 markToday() 写数据、wxss 两条规则照样打包进包，但用户看不到锚点
 * —— 死数据，比死代码更难发现（本次审查就查出过这条）。
 *
 * 另外盯住「今天」胶囊：WXML 里引用了 .day-today，但 wxss 忘了定义，
 * 标签会裸渲染成无样式的黑字。
 */
{
  const errsBefore = errs.length
  const idxWxml = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const idxWxss = fs.readFileSync('./pages/index/index.wxss', 'utf8')
  const idxJs = fs.readFileSync('./pages/index/index.js', 'utf8')

  const wxssHas = (cls) => new RegExp('\\.' + cls + '\\s*\\{').test(idxWxss)

  if (idxJs.indexOf('isToday') >= 0 && idxWxml.indexOf('day.isToday') < 0)
    E('index.js 算了 day.isToday，但 index.wxml 没读它 —— markToday 是死数据，今天锚点不生效')

  if (idxWxml.indexOf('day-card--today') < 0)
    E('index.wxml 没引用 .day-card--today（左侧绿边）—— 该 class 永远不会被应用')
  else if (!wxssHas('day-card--today'))
    E('index.wxml 引用了 .day-card--today，但 index.wxss 没定义')

  if (idxWxml.indexOf('day-today') < 0)
    E('index.wxml 没引用 .day-today（「今天」胶囊）')
  else if (!wxssHas('day-today'))
    E('index.wxml 引用了 .day-today，但 index.wxss 没定义 —— 标签会裸渲染')

  if (idxWxml.indexOf('day.isToday') >= 0 && idxJs.indexOf('markToday') < 0)
    E('index.wxml 读了 day.isToday，但 index.js 没调 markToday —— 字段永远是 undefined，锚点永远不出现')

  // 三段都接通才报绿，否则上面已有 ❌，再打 ✓ 会自相矛盾
  if (errs.length === errsBefore)
    console.log('  今天视觉锚点：isToday → class → 样式三段已接通 ✓')
}

/* ---------- 2. 食材库 ---------- */
const CATS = ['谷物', '蔬菜', '水果', '肉禽', '水产', '蛋奶', '豆类', '油脂', '其他']
const fids = {}
foods.forEach((f, i) => {
  const tag = `foods[${i}] ${f.id || '(无 id)'}`
  if (!f.id) return E(`${tag} 缺 id`)
  if (fids[f.id]) E(`${tag} id 重复`)
  fids[f.id] = f
  ;['name', 'category', 'minMonth'].forEach((k) => {
    if (f[k] === undefined) E(`${tag} 缺字段 ${k}`)
  })
  if (CATS.indexOf(f.category) === -1) E(`${tag} 未知 category: ${f.category}`)
  if (typeof f.minMonth !== 'number' || f.minMonth < 4 || f.minMonth > 36)
    E(`${tag} minMonth 异常: ${f.minMonth}`)
  if (typeof f.allergen !== 'boolean') E(`${tag} allergen 必须是 boolean`)
  if (!f.firstIntro || !f.firstIntro.amount || !f.firstIntro.method)
    W(`${tag} 缺 firstIntro 的 amount/method`)
  if (f.alias && !Array.isArray(f.alias)) E(`${tag} alias 必须是数组`)
})

/* ---------- 3. 菜谱库 ---------- */
const TEXTS = ['细泥', '稠糊', '碎末', '小丁']
const KNOWN_TAGS = ['补铁', '膳食纤维', '易消化', '易入口', '高蛋白', '补钙', '手抓食物']
const rids = {}
recipes.forEach((r, i) => {
  const tag = `recipes[${i}] ${r.id || '(无 id)'}`
  if (!r.id) return E(`${tag} 缺 id`)
  if (rids[r.id]) E(`${tag} id 重复`)
  rids[r.id] = r

  if (!Array.isArray(r.monthRange) || r.monthRange.length !== 2) E(`${tag} monthRange 必须是 [min,max]`)
  else {
    const [a, b] = r.monthRange
    if (a > b) E(`${tag} monthRange 反了: ${a}>${b}`)
    if (a < 6) E(`${tag} 起始月龄 ${a} 早于 6 个月，辅食不应早于 6 月龄`)
    if (b > 36) W(`${tag} 月龄上限 ${b} 偏大`)
  }
  if (TEXTS.indexOf(r.texture) === -1) E(`${tag} texture 未知: ${r.texture}`)
  if (!Array.isArray(r.mainFoods) || r.mainFoods.length === 0) E(`${tag} mainFoods 不能为空`)
  if (!Array.isArray(r.steps) || r.steps.length === 0) E(`${tag} steps 不能为空`)
  if (!r.amount || !r.amount.default) E(`${tag} amount 缺 default`)
  if (r.amount && !r.amount['7-12']) E(`${tag} amount 缺「7-12」阶段（宝塔 7~12 月参考量）`)
  if (r.amount && !r.amount['13-24']) E(`${tag} amount 缺「13-24」阶段（宝塔 13~24 月参考量）`)

  // 引用完整性
  ;(r.mainFoods || []).forEach((id) => {
    if (!fids[id]) E(`${tag} mainFoods 引用了不存在的食材 id: ${id}`)
  })
  ;(r.sideFoods || []).forEach((id) => {
    if (!fids[id]) E(`${tag} sideFoods 引用了不存在的食材 id: ${id}`)
  })
  ;(r.allergens || []).forEach((id) => {
    if (!fids[id]) E(`${tag} allergens 引用了不存在的食材 id: ${id}`)
    else if (!fids[id].allergen) W(`${tag} allergens 里的 ${id} 在食材库里没标 allergen:true`)
  })

  // 标签必须落在已知集合内（否则「当前问题」加权会失效）
  ;(r.tags || []).forEach((t) => {
    if (KNOWN_TAGS.indexOf(t) === -1) E(`${tag} 未知 tag: ${t}`)
  })

  // 主料月龄必须覆盖菜谱起始月龄，否则过滤逻辑会把它整条剔除
  const start = Array.isArray(r.monthRange) ? r.monthRange[0] : 6
  const bad = (r.mainFoods || []).filter((id) => fids[id] && fids[id].minMonth > start)
  if (bad.length) E(`${tag} 起始 ${start} 月龄，但主料 ${bad.join('/')} 要到 ${bad.map((i) => fids[i].minMonth).join('/')} 月龄才可引入`)

  // 致敏主料必须在 allergens 里列出来，否则安全过滤会漏
  const missAllergen = (r.mainFoods || []).filter((id) => fids[id] && fids[id].allergen && (r.allergens || []).indexOf(id) === -1)
  if (missAllergen.length) E(`${tag} 致敏主料 ${missAllergen.join('/')} 未登记到 allergens`)
})

/* ---------- 4. 标签体系对齐：STATUS_TAG 的值必须真的存在于菜谱标签里 ----------
 * 状态改成多选后，每个非空标签都会独立地去候选池里加权，
 * 所以任何一个标签落空 = 用户勾了那个状态却毫无效果（静默失效）。
 */
const planSrc = fs.readFileSync('./utils/plan.js', 'utf8')
const statusTagBlock = planSrc.match(/STATUS_TAG\s*=\s*\{([\s\S]*?)\}/)
if (!statusTagBlock) E('plan.js 里找不到 STATUS_TAG')
else {
  const vals = [...statusTagBlock[1].matchAll(/:\s*'([^']*)'/g)].map((m) => m[1]).filter(Boolean)
  const allTags = new Set()
  recipes.forEach((r) => (r.tags || []).forEach((t) => allTags.add(t)))
  vals.forEach((v) => {
    if (!allTags.has(v)) E(`STATUS_TAG 用了「${v}」，但没有任何菜谱带这个标签，加权会全部落空`)
  })
  // 多选的前提：状态表和加权表不能脱节
  const statusKeys = [...statusTagBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  const storageSrc = fs.readFileSync('./utils/storage.js', 'utf8')
  const statBlock = storageSrc.match(/STATUSES\s*=\s*\[([\s\S]*?)\]/)
  if (!statBlock) E('storage.js 里找不到 STATUSES')
  else {
    const sk = [...statBlock[1].matchAll(/key:\s*'(\w+)'/g)].map((m) => m[1])
    sk.forEach((k) => {
      if (statusKeys.indexOf(k) < 0) E(`STATUSES 有「${k}」但 STATUS_TAG 没有它，勾选后加权表取不到标签`)
    })
    statusKeys.forEach((k) => {
      if (sk.indexOf(k) < 0) E(`STATUS_TAG 有「${k}」但 STATUSES 没有这个选项，是删漏的残留`)
    })
  }
}

/* ---------- 5. 月龄阶段与三态判断 ---------- */
if (typeof age.getAgeStatus !== 'function') E('age.js 缺 getAgeStatus')

const expectStatus = [
  [null, 'unknown'], [0, 'too_young'], [4, 'too_young'], [5, 'too_young'],
  [6, 'ok'], [7, 'ok'], [8, 'ok'], [10, 'ok'], [12, 'ok'], [13, 'ok'],
  [18, 'ok'], [24, 'ok'], [25, 'out_of_range'], [36, 'out_of_range'], [60, 'out_of_range']
]
expectStatus.forEach(function (pair) {
  const m = pair[0]
  const want = pair[1]
  const got = age.getAgeStatus(m)
  if (!got || got.status !== want) E(`getAgeStatus(${m}) 期望 ${want}，实际 ${got && got.status}`)
  if (want === 'ok' && !got.stage) E(`getAgeStatus(${m}) 是 ok 但没返回 stage`)
  if (want !== 'ok' && got.stage) E(`getAgeStatus(${m}) 不是 ok 却返回了 stage`)
})

// 月龄在覆盖范围外时，规则引擎必须拒绝生成，而不是给一份空计划
;[0, 4, 5, 25, 30, 36].forEach(function (m) {
  const p = plan.generate({ months: m, issues: [], safeFoodIds: [], recordedFoodIds: [], observingCount: 0 })
  if (p) E(`plan.generate({months:${m}}) 应该返回 null（超出覆盖范围），实际生成了 ${p.days ? p.days.length : '?'} 天`)
})

// 覆盖范围内必须能生成出东西，且每天至少有 1 餐
;[6, 8, 10, 12, 18, 24].forEach(function (m) {
  const p = plan.generate({
    months: m, issues: [],
    safeFoodIds: foods.map(function (f) { return f.id }),
    recordedFoodIds: [], observingCount: 0
  })
  if (!p) { E(`plan.generate({months:${m}}) 返回 null，但该月龄在覆盖范围内`); return }
  if (!p.days || p.days.length !== 7) E(`plan.generate({months:${m}}) 天数不是 7`)
  const emptyDays = p.days.filter(function (d) { return !d.meals || d.meals.length === 0 }).length
  if (emptyDays > 0) E(`plan.generate({months:${m}}) 有 ${emptyDays} 天排不出餐`)
  if (!p.shopping || !p.shopping.length) E(`plan.generate({months:${m}}) 采购清单为空`)
})

// 未确认安全的致敏食材不能出现在常规菜谱里（主料或辅料都不行）
const allergenIds = foods.filter(function (f) { return f.allergen }).map(function (f) { return f.id })
const noSafe = plan.generate({ months: 8, issues: [], safeFoodIds: [], blockedFoodIds: [], recordedFoodIds: [], observingCount: 0 })
if (noSafe) {
  noSafe.days.forEach(function (d) {
    ;(d.meals || []).forEach(function (meal) {
      const r = recipes.filter(function (x) { return x.id === meal.recipeId })[0]
      if (!r) return
      r.mainFoods.concat(r.sideFoods || []).forEach(function (id) {
        if (allergenIds.indexOf(id) !== -1) E(`致敏食材 ${id} 未确认安全却被排进计划（${meal.name}）`)
      })
    })
  })
}

/* ---------- 5b. 过敏原引入策略（对齐官方指南准则二） ----------
 * 官方：「不盲目回避易过敏食物，1岁内适时引入各种食物」，
 *       且「1岁内婴儿避免食用这些食物对防止食物过敏未见明显益处」。
 * 因此致敏食材必须能通过「新食材尝试」通道被引入，且不能被系统性地排到最后。
 */
const newFoodSeq = []
{
  // 模拟连续 26 周、每周推进，月龄随之增长（6 月龄起步，每周约 0.23 个月）
  let introduced = []
  for (let wk = 0; wk < 26; wk++) {
    const mm = Math.min(24, 6 + Math.floor(wk / 4.33))
    const p = plan.generate({
      months: mm, issues: [], safeFoodIds: introduced, blockedFoodIds: [],
      recordedFoodIds: introduced, observingCount: 0,
      startDate: new Date(2026, 0, 5 + wk * 7)   // 周一
    })
    if (!p) break
    p.days.forEach(function (d) {
      if (d.newFood && introduced.indexOf(d.newFood.foodId) < 0) {
        introduced.push(d.newFood.foodId)
        newFoodSeq.push(d.newFood.foodId)
      }
    })
  }

  const firstAllergenAt = newFoodSeq.findIndex(function (id) { return allergenIds.indexOf(id) >= 0 })
  if (firstAllergenAt < 0) {
    E('连续 26 周都没引入过任何一种致敏食材 —— 等于「盲目回避」，违反准则二')
  } else if (firstAllergenAt > 3) {
    E(`第 ${firstAllergenAt + 1} 个才引入第一种致敏食材，引入序列把致敏食材排得太靠后（应在前 4 位内出现）`)
  }

  const allergenCount = newFoodSeq.filter(function (id) { return allergenIds.indexOf(id) >= 0 }).length
  if (allergenCount < 5) {
    E(`26 周内只引入了 ${allergenCount} 种致敏食材，明显偏少（全部 ${allergenIds.length} 种）`)
  }
  console.log(`  新食材引入序列前 12 位：${newFoodSeq.slice(0, 12).join(' → ')}`)
  console.log(`  26 周共引入 ${newFoodSeq.length} 种，其中致敏 ${allergenCount} 种`)
}

// 已确认「有反应」的食材必须被永久排除
const badId = allergenIds[0]
const withBad = plan.generate({
  months: 8, issues: [], safeFoodIds: [], blockedFoodIds: [badId],
  recordedFoodIds: [badId], observingCount: 0
})
if (withBad) {
  withBad.days.forEach(function (d) {
    ;(d.meals || []).forEach(function (meal) {
      const r = recipes.filter(function (x) { return x.id === meal.recipeId })[0]
      if (!r) return
      if (r.mainFoods.concat(r.sideFoods || []).indexOf(badId) !== -1)
        E(`已标记「有反应」的 ${badId} 仍被排进了计划（${meal.name}）`)
    })
    if (d.newFood && d.newFood.foodId === badId) E(`已标记「有反应」的 ${badId} 仍被当作新食材推荐`)
  })
}

// 确认安全的致敏食材应该能正常进入常规菜谱
const allSafe = plan.generate({
  months: 10, issues: [], safeFoodIds: foods.map(function (f) { return f.id }),
  blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
})
if (allSafe) {
  const usedAllergen = allSafe.days.some(function (d) {
    return (d.meals || []).some(function (meal) {
      const r = recipes.filter(function (x) { return x.id === meal.recipeId })[0]
      if (!r) return false
      return r.mainFoods.concat(r.sideFoods || []).some(function (id) { return allergenIds.indexOf(id) !== -1 })
    })
  })
  if (!usedAllergen) E('全部食材都确认安全时，计划里仍一道含致敏食材的菜都没有 —— 说明排除过度')
}

/* ---------- 5c. 每日食物种类（官方硬要求） ----------
 * 依据《3岁以下婴幼儿健康养育照护指南（试行）》（国卫办妇幼函〔2022〕409号）：
 *   「添加辅食种类每日不少于4种，并且至少应包括一种动物性食物、一种蔬菜和
 *     一种谷薯类食物」
 * 6~7 月龄每天只有 1 餐，凑不齐属正常（官方原文「逐渐达到」），不纳入断言。
 */
{
  const MIN_OK_RATE = 0.98
  let total = 0
  let ok = 0
  let worst = { rate: 1, months: null }
  ;[8, 9, 10, 12, 15, 18, 22, 24].forEach(function (m) {
    let t = 0
    let o = 0
    for (let rep = 0; rep < 30; rep++) {
      const p = plan.generate({
        months: m, issues: [], safeFoodIds: foods.map(function (f) { return f.id }),
        blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
      })
      if (!p) return
      p.days.forEach(function (d) {
        t++
        if (d.catOk) o++
      })
    }
    total += t
    ok += o
    const rate = o / t
    if (rate < worst.rate) worst = { rate: rate, months: m }
    if (rate < MIN_OK_RATE) {
      E(`${m} 月龄只有 ${(rate * 100).toFixed(1)}% 的天数满足「每日≥4类且含动物性/蔬菜/谷薯」`)
    }
  })
  console.log(`  每日食物种类达标率：${(ok / total * 100).toFixed(1)}%（最差 ${worst.months} 月龄 ${(worst.rate * 100).toFixed(1)}%）`)
}

// 6~7 月龄虽然凑不齐 4 类，但不能报成「不达标」（catApplicable 应为 false）
;[6, 7].forEach(function (m) {
  const p = plan.generate({
    months: m, issues: [], safeFoodIds: foods.map(function (f) { return f.id }),
    blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
  })
  if (!p) return
  p.days.forEach(function (d) {
    if (d.catApplicable) E(`${m} 月龄的 catApplicable 应为 false（每天只有 1 餐）`)
  })
})

/* ---------- 5d. 生病中状态（对齐 WS/T 678—2020 3.8） ----------
 * 「患病期间暂停添加新的辅食。……病愈后，及时恢复正常饮食。」
 * 因此 sick=true 时：计划里不能出现任何「新食材尝试」，但仍要正常排餐。
 */
;[8, 12, 18].forEach(function (m) {
  const p = plan.generate({
    months: m, issues: [], sick: true,
    safeFoodIds: foods.map(function (f) { return f.id }),
    blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
  })
  if (!p) { E(`plan.generate({months:${m}, sick:true}) 返回 null（生病时仍应排餐）`); return }
  if (p.sick !== true) E(`plan.generate({months:${m}, sick:true}) 的计划没带上 sick:true`)
  let newFoodDays = 0
  let emptyDays = 0
  p.days.forEach(function (d) {
    if (d.newFood) newFoodDays++
    if (!d.meals || d.meals.length === 0) emptyDays++
  })
  if (newFoodDays > 0) E(`${m} 月龄生病时仍排了 ${newFoodDays} 天新食材尝试 —— 违反 WS/T 678 3.8「暂停添加新辅食」`)
  if (emptyDays > 0) E(`${m} 月龄生病时排不出餐（${emptyDays} 天空）`)
})
console.log('  生病中状态：暂停新食材、仍正常排餐 ✓')

if (typeof age.isRecipeSuitable !== 'function') E('age.js 缺 isRecipeSuitable')
if (typeof age.isFoodReady !== 'function') E('age.js 缺 isFoodReady')

/* ---------- 5e. 禁食提示条目不能进「新食材尝试」通道 ----------
 * foods 里的 honey 是「禁食提示」，不是待引入的辅食。它 minMonth=12 恰好落在
 * 覆盖范围内，不显式排除的话会在 12 月龄被当成新食材排进计划，展示成
 * 「新食材尝试 · 蜂蜜 / 一岁以内禁食 / 观察 3 天」。
 */
{
  const honey = foods.filter(function (f) { return f.id === 'honey' })[0]
  if (!honey) E('foods 里找不到 honey（禁食条目），5e 断言已失效')
  else if (honey.introducible !== false)
    E('honey 必须标 introducible:false —— 禁食条目不能进新食材通道')

  const noIntroIds = foods.filter(function (f) { return f.introducible === false })
    .map(function (f) { return f.id })

  // 禁食条目也不该被任何菜谱引用，否则会绕过新食材通道直接进常规菜谱
  recipes.forEach(function (r) {
    const hit = (r.mainFoods || []).concat(r.sideFoods || [])
      .filter(function (id) { return noIntroIds.indexOf(id) >= 0 })
    if (hit.length) E(`${r.id} 引用了不可引入的食材 ${hit.join('/')}（禁食条目不应进菜谱）`)
  })

  // 精准测试：把除禁食条目外的食材全部标成「已记录」，让新食材候选池只剩它。
  // 候选唯一时，day0 / day3 的两个名额必然会给它 —— 这才测得到那条过滤。
  //
  // ⚠️ 不要改回「扫一遍全月龄看 newFood」：候选池 53 种按 minMonth 升序排，
  // 蜂蜜的 minMonth 最大、永远落在两个引入名额之外，那种扫描永远是绿的（假通过）。
  const others = foods.filter(function (f) { return noIntroIds.indexOf(f.id) < 0 })
    .map(function (f) { return f.id })
  const p = plan.generate({
    months: 12, issues: [],
    safeFoodIds: others, blockedFoodIds: [],
    recordedFoodIds: others, observingCount: 0,
    startDate: new Date(2026, 0, 5)   // 周一，保证 day0 不是周末
  })
  if (!p) E('5e 构造用例生成失败（月龄 12、其余食材均已记录）')
  else {
    p.days.forEach(function (d) {
      if (d.newFood && noIntroIds.indexOf(d.newFood.foodId) >= 0)
        E(`新食材候选池没排除禁食条目「${d.newFood.name}」，被排成了新食材尝试`)
    })
  }

  // 构造前提自证：候选池里除了禁食条目，不该还有别的可引入食材。
  // 否则「没排到 newFood」可能只是名额被别人占了，断言是空转的。
  const leftover = foods.filter(function (f) {
    return f.minMonth <= 12 && others.indexOf(f.id) < 0 && noIntroIds.indexOf(f.id) < 0
  })
  if (leftover.length)
    W(`5e 候选池里还有未记录的可引入食材 ${leftover.map(function (f) { return f.id }).join('/')}，断言没真正压到禁食条目`)

  console.log(`  禁食条目（${noIntroIds.join('/') || '无'}）未进入新食材通道 ✓`)
}

/* ---------- 5f. 同日主料撞车：软约束，但不能劣化 ----------
 * 这不是硬要求 —— 官方的多样性要求在「类别」层面，由 5c 保证（见 README）。
 * 阈值定在 20% 的依据（15 月龄、1050 天实测）：
 *   基线 11.7%  →  去掉主料惩罚后 27%
 * 20% 正好卡在两者之间：既给抽样波动留了 3σ≈4% 的余量，又能拦住
 * 「惩罚被移除 / 修补循环失守」这类劣化。真要收紧成硬约束，先改 README 再动这里。
 */
{
  const M = 15
  const REPS = 100
  let total = 0
  let hit = 0
  for (let rep = 0; rep < REPS; rep++) {
    const p = plan.generate({
      months: M, issues: [],
      safeFoodIds: foods.map(function (f) { return f.id }),
      blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
    })
    if (!p) { E(`plan.generate({months:${M}}) 返回 null`); break }
    p.days.forEach(function (d) {
      total++
      const use = {}
      d.meals.forEach(function (m) {
        const r = rids[m.recipeId]
        if (!r) return
        r.mainFoods.forEach(function (fid) { use[fid] = (use[fid] || 0) + 1 })
      })
      if (Object.keys(use).some(function (fid) { return use[fid] > 1 })) hit++
    })
  }
  const rate = total ? hit / total : 0
  if (rate > 0.20)
    E(`${M} 月龄同日主料撞车率 ${(rate * 100).toFixed(1)}%，超过 20% 上限（基线 11.7%，去掉主料惩罚会升到 27%）`)
  console.log(`  同日主料撞车率（软约束，上限 20%）：${(rate * 100).toFixed(1)}% ✓`)
}

/* ---------- 6. storage 关键函数 ---------- */
;['ensureInit', 'getBaby', 'setBaby', 'isConfigured', 'getIntroduced', 'markIntroduced',
  'safeFoodIds', 'observingFoodIds', 'badFoodIds', 'dueObservations',
  'getStatuses', 'setStatuses', 'getIssues', 'getSick',
  'statusOptions', 'toggleStatus',
  'getPlan', 'setPlan', 'resetAll'].forEach((fn) => {
  if (typeof storage[fn] !== 'function') E(`storage.js 缺函数 ${fn}`)
})
// 常量（不是函数）：排它选项的身份标记
;['OK_KEY', 'OK_LABEL', 'STATUSES'].forEach((k) => {
  if (storage[k] === undefined) E(`storage.js 缺常量 ${k}`)
})

// 状态是多选：唯一数据源 STATUSES 里不许再有「空值选项」（none / 状态正常），
// 那会让「什么都不勾」和「勾了个占位」两种表达并存，加权表也跟着分叉。
{
  const sk = storage.STATUSES.map((s) => s.key)
  if (sk.indexOf('none') >= 0 || sk.indexOf('ok') >= 0 || sk.indexOf('normal') >= 0)
    E(`STATUSES 里还有空值选项（${sk.join(',')}）：多选状态下应当用「全不勾」表达正常`)
  if (sk.indexOf('sick') < 0)
    E('STATUSES 缺 sick —— 合并后的「宝宝状态」卡少了生病这个选项')
  if (new Set(sk).size !== sk.length) E('STATUSES 有重复 key')

  // 「状态正常」是**排它**选项，不是第 7 个状态：锁死三件事 ——
  // 排第一、key 不落进 STATUSES、点了确实清空。
  ;(function () {
    const errsBefore = errs.length
    const opts = storage.statusOptions([])
    if (opts[0].label !== storage.OK_LABEL)
      E('statusOptions 第一项的标签不是 storage.OK_LABEL「状态正常」')
    if (opts[0].key === undefined || sk.indexOf(opts[0].key) >= 0)
      E('「状态正常」的 key 混进了 STATUSES —— 会和「便秘」同时勾上，自相矛盾')
    if (opts[0].on !== true)
      E('一项都没勾时「状态正常」没有亮起')
    // 互斥：勾了真状态，状态正常必须灭；且真状态之间不能互斥
    const opts2 = storage.statusOptions(['constipation'])
    if (opts2[0].on !== false)
      E('勾了「便秘」后「状态正常」还亮着 —— 排它没生效')
    if (!opts2.some((o) => o.key === 'constipation' && o.on))
      E('勾了「便秘」但它自己没亮')
    if (opts2.filter((o) => o.on).length !== 1)
      E('勾一项却点亮了 ' + opts2.filter((o) => o.on).length + ' 个 —— 排它没生效，应只亮那 1 项')
    // 排序要求：用户指定「状态正常」放第一位
    const fromWxml = opts.map((o) => o.label)
    if (fromWxml[0] !== storage.OK_LABEL) E(`状态正常 应排第一，实际顺序：${fromWxml.join('/')}`)
    // 点它 = 清空
    if (storage.toggleStatus(storage.OK_KEY, ['constipation']).length !== 0)
      E('点「状态正常」没有清空其它选项')
    if (storage.toggleStatus(storage.OK_KEY, []).length !== 0)
      E('点「状态正常」在已为空时应保持为空')
    // 点真状态不能清掉别的
    const t = storage.toggleStatus('iron', ['constipation'])
    if (!(t.indexOf('iron') >= 0 && t.indexOf('constipation') >= 0))
      E('勾「缺铁 / 贫血」把已勾的「便秘」挤掉了 —— 真状态之间应可多选')
    if (storage.toggleStatus('iron', ['iron']).indexOf('iron') >= 0)
      E('再点一次已勾的「缺铁 / 贫血」没有取消')
    // 排它 key 绝不能被写进存储
    if (storage.toggleStatus(storage.OK_KEY, []).indexOf(storage.OK_KEY) >= 0)
      E('排它 key 被写进了状态数组，会污染 bb_status')
    // 写进存储也不能带上它（setStatuses 会滤，这里锁住兜底行为）
    if (errs.length === errsBefore)
      console.log('  状态正常：排第一 ✓、与真状态互斥 ✓、点它清空 ✓、真状态仍可多选 ✓')
  })()

  // 反向：代码里不该再出现旧的单选 API
  const bad = ['getIssue()', 'setIssue(', 'issueLabel(', 'onIssueChange', 'onSickChange']
  const srcs = [
    './utils/storage.js', './utils/plan.js',
    './pages/profile/profile.js', './pages/profile/profile.wxml',
    './pages/index/index.js', './pages/mine/mine.js'
  ]
  srcs.forEach((f) => {
    const t = fs.readFileSync(f, 'utf8')
    bad.forEach((b) => {
      if (t.indexOf(b) >= 0) E(`${f} 还在用旧的单选 API「${b}」，应改为 getIssues/getStatuses 多选`)
    })
  })
  // 「状态正常」的**标签**必须来自 storage.OK_LABEL，页面不许自己拼一个 chip 出来
  // —— 否则同一选项会在列表里渲染两次。说明性文字（card-sub 里提一句
  // 「点状态正常会清空」）是允许的，所以只盯 chip 标签的字面量。
  {
    const pj = fs.readFileSync('./pages/profile/profile.js', 'utf8')
    const pw = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')
    // 检查「调用」而非子串 —— 否则注释里提一句 storage.statusOptions
    // 就能让断言失效（负向注入 E 证明过这一点）
    if (pj.indexOf('storage.statusOptions(') < 0)
      E('profile.js 没调用 storage.statusOptions()，状态选项列表在页面里另起炉灶了')
    if (pj.indexOf('storage.toggleStatus(') < 0)
      E('profile.js 没调用 storage.toggleStatus()，排它/多选逻辑被写在页面里')
    // WXML 里出现 >状态正常</view> = 有人手写了一个 chip，会和 storage 的列表重复
    if (/>状态正常\s*<\/view>/.test(pw))
      E('profile.wxml 手写了一个「状态正常」chip —— 会和 statusOptions 的列表重复渲染')
    if (pw.indexOf('bindtap="onStatusChange"') < 0)
      E('profile.wxml 没有把 chip 点击绑到 onStatusChange')
    if (pw.indexOf('{{statuses}}') < 0)
      E('profile.wxml 没有遍历 statusOptions 的结果 {{statuses}} —— 视图会是空的')
    // 注释不能顶替调用：把 rebuildStatus 里的调用改成注释会让整页选中态冻结
    const body = (pj.match(/rebuildStatus\(\)\s*\{([\s\S]*?)\n  \}/) || [])[1] || ''
    if (body.indexOf('storage.statusOptions(') < 0)
      E('rebuildStatus 的函数体里没有真的调用 storage.statusOptions() —— 注释顶不了调用，选中态会冻结')
  }

  console.log(`  状态多选：${sk.length} 项 + 排它的「状态正常」、无空值选项、旧单选 API 零残留 ✓`)
}

/* ---------- 6b. 喂养文案（对齐膳食指南，发布前需营养师复核） ----------
 * 用户已确认：维生素 D 提示不做。
 * 历史：原「喂养提醒」卡整卡删除，内容并入六月龄「辅食添加要点」（sixMonth.points）。
 * 用户第三轮文案（v3）再次精简：「避免腌制/卤制/烧烤」与「过敏食物及时引入」
 * 两句**未再保留** —— 对应钉子已撤；如要恢复，先加内容再把钉子加回来。
 * 盐钉子对齐 v3 措辞「额外加盐 + 酱油」；13~24 月龄「0~1.5g」随旧卡删除，未保留。
 * 卡片与 saltTip 必须拆净（防死代码回潮）。
 */
{
  const wxml = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ij = fs.readFileSync('./pages/index/index.js', 'utf8')
  const gd = fs.readFileSync('./data/guides.js', 'utf8')

  if (wxml.indexOf('card guidance') >= 0)
    E('index.wxml 还有「喂养提醒」卡 —— 已按用户要求整卡删除，内容应并入六月龄要点卡')
  if (wxml.indexOf('saltTip') >= 0)
    E('index.wxml 还在绑定 saltTip —— 动态盐提示随卡一起拆掉了')
  if (ij.indexOf('saltTipFor') >= 0)
    E('index.js 还留着 saltTipFor —— 喂养提醒卡已删，这是死代码')

  const BP = [
    [/额外加盐/, '不额外加盐的口径'],
    [/酱油/, '酱油等含盐调料也不加']
  ]
  BP.forEach(([re, what]) => {
    if (!re.test(gd)) E(`guides.js 要点卡丢了「${what}」—— 喂养提醒并入时丢内容`)
  })
  console.log('  喂养文案：不加盐+酱油 ✓，已并入要点卡 ✓、旧卡与 saltTip 拆净 ✓（腌制/及时引入按 v3 文案撤钉）')
}

/* ---------- 6c. 计划缓存失效判断必须覆盖所有生成输入 ----------
 * 锁的是一个不变量：planSignature 必须对「任何会改变生成结果的输入」敏感。
 * 漏掉任何一个 → 用户改了设置、计划却不刷新。
 *
 * 最严重的是「有反应」：它的语义是**永久排除**。缓存不失效的话，
 * 用户明明标了有反应，旧计划里那道菜还在，下次打开照样推荐 —— 安全缺陷。
 */
{
  const mkStorage = (state) => ({
    // 名称是必填（planInputs 会判），测试用例默认带上；
    // 要测「缺名称」时显式传 name: ''
    getBaby() { return { birthday: state.birthday, name: state.name === undefined ? '测试' : state.name } },
    getStatuses() { return state.issues.concat(state.sick ? ['sick'] : []) },
    getIssues() { return state.issues },
    getSick() { return state.sick },
    safeFoodIds() { return state.safe },
    badFoodIds() { return state.bad },
    recordedFoodIds() { return state.safe.concat(state.bad, state.obs) },
    observingFoodIds() { return state.obs },
    // v2.1 打卡回写：连续拒吃名单（没传 state.refused 时视为空名单）
    refusedRecipeIds() { return state.refused || [] }
  })

  const birthdayAgo = (months) => {
    const d = new Date()
    d.setMonth(d.getMonth() - months)
    d.setDate(1)
    const mm = d.getMonth() + 1
    const dd = d.getDate()
    return `${d.getFullYear()}-${mm < 10 ? '0' + mm : mm}-${dd < 10 ? '0' + dd : dd}`
  }

  const foodIdsIn = (p) => {
    const out = []
    p.days.forEach((d) => {
      d.meals.forEach((m) => {
        const r = recipes.filter((x) => x.id === m.recipeId)[0]
        if (!r) return
        r.mainFoods.forEach((f) => out.push(f))
        ;(r.sideFoods || []).forEach((f) => out.push(f))
      })
    })
    return out
  }

  // 每个用例都用全新 state，避免「改 A 掩盖了 B 没生效」这种假通过
  // 基准状态故意**带一项勾选**：否则「取消勾选」和基准都是空数组，
  // 那条用例测了个寂寞（第一次写就踩了这个坑，靠自检才抓出来）。
  const sigWith = (mutate) => {
    const s = {
      birthday: birthdayAgo(14),
      issues: ['iron'],
      sick: false,
      safe: foods.map((f) => f.id),
      bad: [],
      obs: []
    }
    if (mutate) mutate(s)
    return plan.planSignature(mkStorage(s))
  }

  const baseSig = sigWith(null)

  if (!baseSig) E('planSignature 对已配置的宝宝返回了空值')
  if (plan.planSignature(mkStorage({
    birthday: '', issues: ['iron'], sick: false, safe: [], bad: [], obs: []
  })) !== null) E('planSignature 在没填生日时应当返回 null')

  // 同一状态必须稳定 —— 否则每次 onShow 都会重算计划
  if (sigWith(null) !== baseSig)
    E('planSignature 不稳定：同一状态两次结果不同，会导致每次进页面都重算计划')

  const SENSITIVE = [
    ['当前状态（换成另一项）', (s) => { s.issues = ['constipation'] }],
    ['当前状态（追加一项）', (s) => { s.issues = s.issues.concat('constipation') }],
    ['当前状态（取消勾选）', (s) => { s.issues = [] }],
    ['生病状态（sick）', (s) => { s.sick = true }],
    ['已确认安全的食材集合', (s) => { s.safe = s.safe.slice(0, 5) }],
    ['观察中食材', (s) => { s.obs = ['pumpkin'] }],
    ['连续拒吃降权名单（打卡回写）', (s) => { s.refused = ['rice'] }]
  ]
  SENSITIVE.forEach(([name, mutate]) => {
    if (sigWith(mutate) === baseSig)
      E(`planSignature 对「${name}」不敏感 —— 用户改了它，缓存的计划不会重算`)
  })

  // 反向：勾选顺序不该进指纹。指纹对 issues 做了排序，否则
  // 「先勾便秘再勾缺铁」和反过来算两个计划，每次 onShow 都白重算一次。
  if (sigWith((s) => { s.issues = s.issues.slice().reverse() }) !== baseSig)
    E('planSignature 把 issues 的顺序也算进去了 —— 同一组状态换个勾选顺序就会无谓重算')

  // 最强的一条：把计划里真实出现的食材标成「有反应」，重生成后必须消失
  const st0 = {
    birthday: birthdayAgo(14),
    issues: ['iron'],
    sick: false,
    safe: foods.map((f) => f.id),
    bad: [],
    obs: []
  }
  const s0 = mkStorage(st0)
  const before = foodIdsIn(plan.generateFromStorage(s0))
  const fmap = {}
  foods.forEach((f) => { fmap[f.id] = f })
  const targetId = before.filter((id) => fmap[id] && !fmap[id].allergen)[0]

  if (!targetId) {
    W('6c 无法选出测试食材（计划为空），「有反应」排除的回归测试被跳过')
  } else {
    st0.bad = [targetId]
    st0.safe = st0.safe.filter((x) => x !== targetId)
    if (plan.planSignature(mkStorage(st0)) === baseSig)
      E('planSignature 对「标记有反应」不敏感 —— 已排除的食材会继续被推荐（安全缺陷）')
    if (foodIdsIn(plan.generateFromStorage(mkStorage(st0))).indexOf(targetId) >= 0)
      E(`标记「有反应」后重生成，${fmap[targetId].name} 仍出现在计划里 —— 永久排除没生效`)
    console.log('  缓存失效判断：输入指纹覆盖状态多选 / 生病 / 食材记录 ✓，顺序无关 ✓，「有反应」重生成后已剔除 ✓')
  }
}

/* ---------- 6d. 档案页不能一键解除「有反应」排除 ----------
 * bad 是系统里唯一的硬排除机制，语义是永久排除。但它的 chip 和普通未勾选
 * 长得一样，toggleFood 原本不区分状态 —— 点一下就 removeIntroduced，
 * 记录被删、食材重新回到新食材推荐通道（安全缺陷）。
 *
 * 这里锁两件事：拦截分支必须存在，且必须写在 removeIntroduced 之前。
 */
{
  const profileSrc = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const profileWxml = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')

  const badIdx = profileSrc.search(/status\s*===\s*'bad'/)
  // 匹配真实调用而非裸词，否则注释里提到 removeIntroduced 就会误判位置
  const removeIdx = profileSrc.indexOf('storage.removeIntroduced')
  if (badIdx < 0) {
    E("profile.js 没有对 status==='bad' 单独分支 —— 点一下会删掉「有反应」记录（安全缺陷）")
  } else if (removeIdx >= 0 && badIdx > removeIdx) {
    E('profile.js 的 bad 拦截写在 removeIntroduced 之后，可能拦不住')
  }
  if (profileWxml.indexOf("f.status === 'bad'") < 0)
    E("profile.wxml 没渲染 bad 态 —— 「有反应」和普通未勾选长得一样，用户会误点")
  console.log('  档案页：「有反应」记录不会被勾选操作误删 ✓')
}

/* ---------- 6e. 宝宝名称：录得进、存得住、看得到 ----------
 * 三段链路：档案页 input → storage 合并写入 → 「我的」页回显。
 *
 * 最容易断的是中间那段：setBaby 原本是**整体覆盖**，而页面里名称和
 * 生日是两个独立控件各写各的字段 —— 用户先填名称、再改生日，
 * 先前的名字就被 setBaby({ birthday }) 整个抹掉（本次就修了这个）。
 * 所以下面用内存版 wx 真跑一遍 setBaby，不是读源码猜。
 */
{
  const errsBefore = errs.length
  const pj = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const pw = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')
  const mj = fs.readFileSync('./pages/mine/mine.js', 'utf8')
  const mw = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')

  const iw = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ij = fs.readFileSync('./pages/index/index.js', 'utf8')
  const ix = fs.readFileSync('./pages/index/index.wxss', 'utf8')
  const px = fs.readFileSync('./pages/profile/profile.wxss', 'utf8')

  // 录入端：input 绑到处理函数，且处理函数在 profile.js 里真存在
  if (pw.indexOf('bindinput="onNameInput"') < 0)
    E('profile.wxml 的名称输入框没绑 onNameInput —— 名称录不进去')
  if (!/onNameInput\s*\(/.test(pj))
    E('profile.js 缺 onNameInput 处理函数 —— 输入框绑了个不存在的 handler')
  if (pj.indexOf('storage.setBaby({ name:') < 0)
    E('onNameInput 没调用 storage.setBaby({ name }) —— 名称没落库，是死输入框')
  // 卡片并入了名称，标题还叫「宝宝生日」就名不副实
  if (pw.indexOf('宝宝信息') < 0 || pw.indexOf('宝宝生日') >= 0)
    E('profile.wxml 第一张卡标题应为「宝宝信息」（卡里现在含名称 + 生日）')
  // 必填：两行都要有星号，且样式真的定义了（引用没定义 = 裸渲染）
  if ((pw.match(/class="req"/g) || []).length < 2)
    E('profile.wxml 的必填星号少于 2 个 —— 名称和出生日期都必须标 *')
  if (!/\.req\s*\{/.test(px))
    E('profile.wxml 引用了 .req，但 profile.wxss 没定义 —— 星号会裸渲染')
  if (pw.indexOf('都是必填') < 0)
    E('profile.wxml 缺必填说明文案 —— 用户不知道为什么填完生日还生成不了')

  // 展示端：首页 + 我的都得回显（用户明确要求首页也要映射）
  if (ij.indexOf('baby.name') < 0 || iw.indexOf('{{name}}') < 0)
    E('首页没有回显宝宝名称 —— 名称存了首页看不到（死数据）')
  if (/class="head-name"/.test(iw) && !/\.head-name\s*\{/.test(ix))
    E('index.wxml 用了 .head-name，但 index.wxss 没定义 —— 名称会裸渲染成无样式黑字')
  if (mj.indexOf('storage.isConfigured()') < 0)
    E('mine.js 的 hasBaby 没走 storage.isConfigured() —— 两页对「填没填完」会给出不同答案')
  if (mw.indexOf('{{name}}') < 0)
    E('「我的」页没有回显 {{name}} —— 名称存了没有显示位置（死数据）')
  // 缺项提示必须是算出来的：写死字段数必然过期
  if (iw.indexOf('3 个字段') >= 0)
    E('index.wxml 空状态还写着「3 个字段」—— 字段早就不是 3 个了，应改用 emptyHint')
  if (iw.indexOf('{{emptyHint}}') < 0 || ij.indexOf('storage.missingFields(') < 0)
    E('缺项提示没接 missingFields —— 老用户只缺名称时，首页只会说「先填一下宝宝的信息」')

  // 行为端：真跑 setBaby（内存版 wx，跑完还原）
  const mem = {}
  const hadWx = typeof global.wx !== 'undefined'
  const savedWx = global.wx
  global.wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v },
    removeStorageSync: (k) => { delete mem[k] }
  }
  try {
    // 字段级合并：改生日不能抹掉名称
    storage.setBaby({ name: '臭宝' })
    storage.setBaby({ birthday: '2026-05-01' })
    const b = storage.getBaby()
    if (!b || b.name !== '臭宝')
      E('填完名称再改生日，名称被 setBaby 整体覆盖抹掉了 —— 必须字段级合并')
    if (!b || b.birthday !== '2026-05-01')
      E('setBaby({ name }) 把已填的生日弄丢了 —— 合并必须是双向的')

    // 清洗与截断
    storage.setBaby({ name: ' 臭\n宝  ' })
    if (storage.getBaby().name !== '臭 宝')
      E('名称没清洗：换行/首尾空格应被压掉，否则摘要行会被撑破')
    storage.setBaby({ name: '一'.repeat(30) })
    if (storage.getBaby().name.length > storage.BABY_NAME_MAX)
      E(`名称没有截断到 ${storage.BABY_NAME_MAX} 字，长名字会把「我的」页摘要行撑破`)
    if (typeof storage.BABY_NAME_MAX !== 'number') E('storage 没导出 BABY_NAME_MAX')
    if (typeof storage.sanitizeBabyName !== 'function') E('storage 没导出 sanitizeBabyName')
    if (typeof storage.missingFields !== 'function') E('storage 没导出 missingFields')

    // 必填矩阵：档案全空 / 只有名称 / 只有生日 → 三项都必须是「未配置」
    global.wx.removeStorageSync(storage.KEYS.BABY)
    if (storage.isConfigured()) E('档案全空却算已配置 —— 首页会直接去生成计划')
    if (storage.missingFields().length !== 2)
      E(`档案全空时 missingFields 应报 2 项，实际 ${storage.missingFields().join(',')}`)

    storage.setBaby({ name: '臭宝' })
    if (storage.isConfigured())
      E('只填名称没填生日就算「已配置」—— isConfigured 必须两项都要')
    if (storage.missingFields().join('') !== '出生日期')
      E('只缺生日时 missingFields 没报「出生日期」')

    global.wx.removeStorageSync(storage.KEYS.BABY)
    storage.setBaby({ birthday: '2025-07-01' })
    if (storage.isConfigured())
      E('只填生日没填名称就算「已配置」—— 名称是必填项，这条没生效')

    storage.setBaby({ name: '臭宝' })
    if (!storage.isConfigured())
      E('名称和生日都填了 isConfigured 仍为假 —— 首页会永远停在空状态')
    if (storage.missingFields().length !== 0)
      E('两项齐全了 missingFields 还在返回缺项')

    // 引擎自己的闸门：缺名称不得生成（防止绕过首页那层 isConfigured）
    const mk = (name) => ({
      getBaby() { return { birthday: '2025-07-01', name: name } },
      getIssues() { return [] },
      getSick() { return false },
      safeFoodIds() { return [] },
      badFoodIds() { return [] },
      recordedFoodIds() { return [] },
      observingFoodIds() { return [] },
      refusedRecipeIds() { return [] }
    })
    if (plan.planInputs(mk('')) !== null)
      E('planInputs 缺名称仍返回输入 —— 名称必填没进引擎闸门，别的调用路径能绕过去')
    if (plan.planSignature(mk('')) !== null)
      E('planSignature 在缺名称时应返回 null')
    if (plan.planInputs(mk('臭宝')) === null)
      E('名称生日齐全 planInputs 却返回 null —— 计划永远生成不出来')
    // 名称的取值不该进指纹：否则改个名字就白重排一次计划
    if (plan.planSignature(mk('臭宝')) !== plan.planSignature(mk('豆豆')))
      E('改名字让指纹变了 —— 名称取值不该进指纹，改名不该重排计划')
  } finally {
    if (hadWx) global.wx = savedWx
    else delete global.wx
  }

  if (errs.length === errsBefore)
    console.log('  宝宝名称：必填（存储+引擎双闸门）✓、首页与「我的」回显 ✓、清洗/截断 ✓、取值不进指纹 ✓')
}

/* ---------- 6f. 首页与「我的」：名称与月龄必须同行、同字号 ----------
 * 用户明确要求：把「4 个月 1 天」和宝宝名称对齐、字号保持一致，
 * 且两页一起改。锁三件事 ——
 *   1. 同行：.head-line 容器存在（名字和月龄都塞在它里面）
 *   2. 同字号：两个 class 的 font-size 都必须是 --fs-lg（用户选定
 *      用名字那档；月龄原来是 --fs-display 大字，缩小后才放得下一行）
 *   3. 引用的类必须在本页 wxss 里定义过，否则标签裸渲染成无样式黑字
 *      （§1c 抓过同类问题：.day-today 引用了却没定义）
 */
{
  const errsBefore = errs.length
  const fontSizeOf = (css, cls) => {
    const m = css.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*font-size:\\s*([^;}]+)'))
    return m ? m[1].trim() : null
  }
  ;['index', 'mine'].forEach((which) => {
    const wxml = fs.readFileSync(`./pages/${which}/${which}.wxml`, 'utf8')
    const wxss = fs.readFileSync(`./pages/${which}/${which}.wxss`, 'utf8')

    const li = wxml.indexOf('class="head-line"')
    if (li < 0) E(`${which} 页：名称和月龄没并到同一行（缺 .head-line 容器）`)
    if (!/\.head-line\s*\{/.test(wxss))
      E(`${which}.wxss 没定义 .head-line —— 引用了没定义的类，行内布局会散`)

    if (li >= 0) {
      const rest = wxml.slice(li, li + 300)
      const atName = rest.indexOf('head-name')
      const atAge = rest.indexOf('head-age')
      if (atName < 0 || atAge < 0)
        E(`${which} 页的 .head-line 里没同时放名称和月龄 —— 同行没实现`)
      else if (atName > atAge)
        E(`${which} 页同行内月龄排在名称前面 —— 顺序应为 名称 → 月龄`)
    }

    const fn = fontSizeOf(wxss, 'head-name')
    const fa = fontSizeOf(wxss, 'head-age')
    if (fn !== 'var(--fs-lg)' || fa !== 'var(--fs-lg)')
      E(`${which} 页 名称(${fn}) / 月龄(${fa}) 应同为 var(--fs-lg) —— 用户选定用名字那档字号（月龄原为 --fs-display）`)
  })
  if (errs.length === errsBefore)
    console.log('  首页与「我的」：名称与月龄同行 ✓、字号同为 --fs-lg ✓、两页一致 ✓')
}

/* ---------- 6g. v2.0 食材图标：emoji + 分类底色，53/53 全覆盖 ----------
 * 四段链路缺一不可，断在哪一段都是「死图标」—— 数据配了、样式也打包了，
 * 用户却看不到（比死代码更难发现，同 §1c 抓 isToday 的道理）：
 *   1. 数据：EXACT/FALLBACK/BG 结构合法、53/53 覆盖、9 色唯一且够浅
 *   2. JS：  四处取数（查一查 / 档案 chips / 详情头 / 计划页两处）
 *   3. WXML：绑定 {{...icon}} 且用 iconBg 挂分类底色
 *   4. WXSS：引用的 class 都有定义，该 flex 的地方必须 flex（否则徽标把标题撑成两行）
 * 另锁三条不变量：
 *   - 图标取值不进指纹：改图标不该白重排一次 7 天计划
 *   - 详情页不许把 icon 写回 food —— 那是 FOODS 模块缓存的原对象
 *   - EXACT 不许被掏空成「全兜底」—— 精确优先是选定的策略
 */
{
  const errsBefore = errs.length
  const icons = require('./data/food-icons')
  const rd = (p) => fs.readFileSync(p, 'utf8')

  // —— 1. 数据层 ——
  const foodIds = new Set(foods.map((f) => f.id))
  Object.keys(icons.EXACT).forEach((id) => {
    if (!foodIds.has(id)) E(`food-icons.EXACT 里的 id 不存在：${id} —— 拼错永远命中不了`)
  })
  const exactCount = Object.keys(icons.EXACT).length
  if (exactCount < 30)
    E(`EXACT 只剩 ${exactCount} 条 ——「精确优先 + 分类兜底」被掏空成全兜底了`)

  // 用户 2026-09 定稿的关键取值 —— 防止后续「清理」时被改回撞车方案
  const PINS = { pork: '🐖', beef: '🐂', lamb: '🐑', tofu: '🧈', soybean: '🟡', walnut_oil: '🌰' }
  Object.keys(PINS).forEach((id) => {
    if (icons.EXACT[id] !== PINS[id])
      E(`${id} 的图标是 ${icons.EXACT[id]}，应为 ${PINS[id]} —— 用户定稿的取值被改动了`)
  })
  // 这三个被明确否决过：分别撞红薯 / 菠菜 / 胡萝卜，不许配上精确图标
  ;['yam', 'cabbage', 'white_radish'].forEach((id) => {
    if (icons.EXACT[id]) E(`${id} 配了精确图标 ${icons.EXACT[id]} —— 撞车方案已被否决（红薯/菠菜/胡萝卜）`)
  })

  const cats = [...new Set(foods.map((f) => f.category))]
  cats.forEach((c) => {
    if (!icons.FALLBACK[c]) E(`分类兜底缺失：${c}`)
    if (!icons.BG[c]) E(`分类底色缺失：${c}`)
  })
  const hexes = Object.values(icons.BG)
  hexes.forEach((h) => { if (!/^#[0-9a-f]{6}$/i.test(h)) E(`分类底色不是 6 位 hex：${h}`) })
  if (new Set(hexes).size !== hexes.length) E('分类底色有重复 —— 9 类要能一眼区分')

  // 53/53：缺一个都会让同类列表参差不齐（有的有图标有的没有）
  let covered = 0
  foods.forEach((f) => {
    const ic = icons.iconFor(f)
    if (typeof ic === 'string' && ic && !/\s/.test(ic) && [...ic].length <= 4) covered++
    else E(`食材图标非法：${f.id} → ${JSON.stringify(ic)}`)
  })
  if (covered !== foods.length)
    E(`食材图标覆盖 ${covered}/${foods.length} —— 必须全量覆盖`)

  // 兜底路径真的接上了：模拟一个没有精确图标的食材
  if (icons.iconFor({ id: '__none__', category: '谷物' }) !== icons.FALLBACK['谷物'])
    E('iconFor 的分类兜底没接上 —— 没精确图标的食材会渲染成空白')
  if (icons.bgFor({ id: '__none__', category: '谷物' }) !== icons.BG['谷物'])
    E('bgFor 的分类底色没接上')

  // 底色上的 chip 文字（--c-text #2c2c2a）对比度 ≥ 7:1 —— WCAG 现算，不许拿注释写死
  const lum = (hex) => {
    const v = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
  }
  const textLum = lum('#2c2c2a')
  hexes.forEach((h) => {
    if (!/^#[0-9a-f]{6}$/i.test(h)) return
    const ratio = (lum(h) + 0.05) / (textLum + 0.05)
    if (ratio < 7) E(`分类底色 ${h} 上的文字对比度 ${ratio.toFixed(1)}:1 < 7:1 —— 底色太深`)
  })

  // —— 2/3/4. 四处链路：JS 取数 → WXML 绑定 → WXSS 类 ——
  const appWxss = rd('./app.wxss')
  const chains = [
    {
      where: '查一查列表',
      js: './pages/food/food.js', wxml: './pages/food/food.wxml',
      binds: ['{{f.icon}}', 'f.iconBg'],
      cls: [{ name: 'food-ic', css: appWxss, from: 'app.wxss' }]
    },
    {
      where: '档案页 chips',
      js: './pages/profile/profile.js', wxml: './pages/profile/profile.wxml',
      binds: ['{{f.icon}}', 'f.iconBg'],
      cls: [{ name: 'chip-ic', css: rd('./pages/profile/profile.wxss'), from: 'profile.wxss' }]
    },
    {
      where: '食材详情头',
      js: './pages/food-detail/food-detail.js', wxml: './pages/food-detail/food-detail.wxml',
      binds: ['{{icon}}', '{{iconBg}}'],
      cls: [
        { name: 'fd-title', css: rd('./pages/food-detail/food-detail.wxss'), from: 'food-detail.wxss' },
        { name: 'fd-ic', css: rd('./pages/food-detail/food-detail.wxss'), from: 'food-detail.wxss' }
      ]
    },
    {
      where: '首页新食材卡 + 采购清单',
      js: './utils/plan.js', wxml: './pages/index/index.wxml',
      binds: ['{{day.newFood.icon}}', 'day.newFood.iconBg', '{{it.icon}}', 'it.iconBg'],
      cls: [
        { name: 'food-ic', css: appWxss, from: 'app.wxss' },
        { name: 'shop-label', css: rd('./pages/index/index.wxss'), from: 'index.wxss' }
      ]
    }
  ]
  chains.forEach((c) => {
    const js = rd(c.js)
    const wxml = rd(c.wxml)
    if (js.indexOf('iconFor(') < 0 || js.indexOf('bgFor(') < 0)
      E(`${c.where}：${c.js} 没取图标数据（iconFor/bgFor）—— 数据配了页面拿不到`)
    c.binds.forEach((b) => {
      if (wxml.indexOf(b) < 0) E(`${c.where}：${c.wxml} 没绑定 ${b} —— 图标/底色没渲染出来`)
    })
    c.cls.forEach((x) => {
      if (!new RegExp('\\.' + x.name + '\\s*\\{').test(x.css))
        E(`${c.where}：引用了 .${x.name} 但 ${x.from} 没定义 —— 标签裸渲染成无样式黑字`)
    })
  })

  // plan.js 要喂两处（新食材卡 + 采购清单），只喂一处另一处就没图标
  const planJs = rd('./utils/plan.js')
  if ((planJs.match(/iconFor\(/g) || []).length < 2)
    E('plan.js 里 iconFor 只用了一次 —— newFood 和 shopping 应各喂一处')

  // 该 flex 的地方必须 flex：徽标是块级 view，不 flex 会把标题/标签撑成两行
  const flexChecks = [
    ['.newfood-title', rd('./pages/index/index.wxss'), 'index.wxss'],
    ['.shop-label', rd('./pages/index/index.wxss'), 'index.wxss'],
    ['.fd-title', rd('./pages/food-detail/food-detail.wxss'), 'food-detail.wxss']
  ]
  flexChecks.forEach(([cls, css, from]) => {
    const m = css.match(new RegExp('\\' + cls + '\\s*\\{[^}]*'))
    if (m && m[0].indexOf('display: flex') < 0)
      E(`${from} 的 ${cls} 不是 display:flex —— 内嵌徽标会把标题/标签撑成两行`)
  })

  // 图标取值不进指纹：把图标全换掉，指纹必须原样不动（否则换图标会白重排计划）
  const mkSig = (name) => ({
    getBaby() { return { birthday: '2025-07-01', name: name } },
    getIssues() { return [] },
    getSick() { return false },
    safeFoodIds() { return [] },
    badFoodIds() { return [] },
    recordedFoodIds() { return [] },
    observingFoodIds() { return [] },
    refusedRecipeIds() { return [] }
  })
  const sigA = plan.planSignature(mkSig('臭宝'))
  const origIconFor = icons.iconFor
  const origBgFor = icons.bgFor
  try {
    icons.iconFor = () => '🟢'
    icons.bgFor = () => '#000000'
    if (plan.planSignature(mkSig('臭宝')) !== sigA)
      E('图标取值影响了指纹 —— 换图标会白重排一次计划，图标只许做展示')
  } finally {
    icons.iconFor = origIconFor
    icons.bgFor = origBgFor
  }
  if (plan.planSignature(mkSig('臭宝')) !== sigA)
    E('还原图标后指纹没回来 —— 测试自身没还原干净')

  // 详情页不许写回 food：那是 FOODS 模块缓存里的原对象
  const fdJs = rd('./pages/food-detail/food-detail.js')
  if (/food\s*\.\s*icon\s*=/.test(fdJs) || /food\s*\.\s*iconBg\s*=/.test(fdJs))
    E('food-detail.js 把 icon 写回了 food —— 会污染 FOODS 模块缓存，影响所有引用方')

  if (errs.length === errsBefore)
    console.log('  食材图标：53/53 全覆盖 ✓、9 类底色唯一且 ≥7:1 ✓、四段链路（数据→JS→WXML→WXSS）接通 ✓、不进指纹 ✓、不污染 FOODS ✓')
}

/* ---------- 6h. <6 月龄「开始之前」说明：数据 → 首页 → WXML ----------
 * tooYoung 分支原来是两行空状态，现在铺 3 张说明卡（时机与风险/信号/原则
 * —— 按用户要求，「过早过晚的危害」已合并进 when 卡，不再单列）。
 * 断链同样是死数据：guides 写了页面没绑、或绑在了 tooYoung 分支之外
 * （= 正在吃辅食的宝宝突然看到「什么时候开始添加」）都是错的。
 * 另钉住核心口径：这些是选题依据，被删掉说明就没营养了。
 */
{
  const errsBefore = errs.length
  const guidesMod = require('./data/guides')
  const iw = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ij = fs.readFileSync('./pages/index/index.js', 'utf8')
  const ix = fs.readFileSync('./pages/index/index.wxss', 'utf8')

  // 1) 数据结构：4 个必备分段，字段齐全、icon/iconBg 合法
  const NEED = ['when', 'signal', 'rules']
  const list = guidesMod.tooYoung
  if (!Array.isArray(list) || !list.length) {
    E('data/guides.js 没导出非空的 tooYoung 数组')
  } else {
    NEED.forEach((k) => {
      const card = list.find((c) => c.key === k)
      if (!card) { E(`guides.tooYoung 缺少分段：${k}`); return }
      if (!card.title || !Array.isArray(card.lines) || !card.lines.length)
        E(`guides.${k} 的 title/lines 不完整 —— 卡片会渲染成空壳`)
      else if (card.lines.some((l) => typeof l !== 'string' || !l.trim()))
        E(`guides.${k} 里有空行 —— 会渲染出空的 .guide-line`)
      const ic = card.icon
      if (typeof ic !== 'string' || !ic || /\s/.test(ic) || [...ic].length > 4)
        E(`guides.${k} 的 icon 非法：${JSON.stringify(ic)}`)
      if (!/^#[0-9a-f]{6}$/i.test(card.iconBg || ''))
        E(`guides.${k} 的 iconBg 不是 6 位 hex：${card.iconBg}`)
    })

    // 2) 核心口径不能丢（选题依据，删了说明就没营养了）
    //    注：满 6 月龄 / 不早于 4 月龄这两段按用户要求从 when 卡删除了，
    //    「满 6 个月」的官方口径改由 index.wxml 的 intro 承担（下面单独查）。
    const all = JSON.stringify(list)
    const PINS = [
      [/4 月龄/, '「4 月龄」这个最早下限'],
      [/过早（不满 4 月龄）/, '「过早」的危害（已并入 when 卡）'],
      [/过晚（超过 6 月龄）/, '「过晚」的危害（已并入 when 卡）'],
      [/挺舌/, '「挺舌反射」这个识别信号'],
      [/2[–-]3 天/, '一次一种、观察 2–3 天'],
      [/不加盐/, '不加盐糖的原则'],
      [/蜂蜜/, '1 岁内不加蜂蜜']
    ]
    PINS.forEach(([re, what]) => {
      if (!re.test(all)) E(`guides 里丢了「${what}」—— 说明的核心口径不完整`)
    })
    // when 卡的口径段删掉后，intro 是全页仅剩的「满 6 个月」依据 —— 丢了首页就不再说明何时开始
    if (iw.indexOf('满 6 个月') < 0)
      E('index.wxml 的 intro 丢了「满 6 个月」—— when 卡已按要求删掉口径段，首页不再说明何时开始添加')
    if (list.length > NEED.length + 2)
      W(`guides.tooYoung 有 ${list.length} 张卡，首页会很长 —— 确认是有意的`)
  }

  // 3) 页面链路：index.js 挂数据 → WXML 在 tooYoung 分支内渲染
  if (ij.indexOf("require('../../data/guides')") < 0)
    E("index.js 没引入 data/guides —— 页面拿不到说明数据")
  if (!/guide:\s*guides\.tooYoung/.test(ij))
    E('index.js 没把 guide 放进 data —— WXML 的 wx:for 拿不到东西')

  const tgAt = iw.indexOf('<block wx:if="{{tooYoung}}">')
  const orAt = iw.indexOf('<block wx:if="{{outOfRange}}"')
  const gdAt = iw.indexOf('wx:for="{{guide}}"')
  if (tgAt < 0) E('index.wxml 没有 tooYoung 分支')
  if (gdAt < 0) E('index.wxml 没渲染 guide —— 数据配了页面不显示（死数据）')
  else if (tgAt >= 0 && (gdAt < tgAt || (orAt > tgAt && gdAt > orAt)))
    E('guide 的渲染不在 tooYoung 分支里 —— 正在吃辅食的宝宝会看到「什么时候开始添加」')

  if (tgAt >= 0 && gdAt > tgAt) {
    const seg = iw.slice(tgAt, orAt > tgAt ? orAt : iw.length)
    ;['{{g.title}}', '{{g.lines}}', 'food-ic'].forEach((b) => {
      if (seg.indexOf(b) < 0) E(`tooYoung 分支没绑 ${b} —— 卡头/徽标/正文没渲染`)
    })
  }

  // 4) 样式段：引用的类都要有定义，卡头必须 flex（徽标是块级，不 flex 会撑成两行）
  ;['empty-guide', 'guide-head', 'guide-line'].forEach((cls) => {
    if (!new RegExp('\\.' + cls + '\\s*\\{').test(ix))
      E(`index.wxss 没定义 .${cls} —— 引用了没定义的类，会裸渲染`)
  })
  const gh = ix.match(/\.guide-head\s*\{[^}]*/)
  if (gh && gh[0].indexOf('display: flex') < 0)
    E('index.wxss 的 .guide-head 不是 display:flex —— emoji 徽标会把标题撑成两行')

  if (errs.length === errsBefore)
    console.log('  <6 月龄说明：3 分段（时机与风险合并、口径段已删）✓、核心口径（满6个月→intro、4月龄、过早过晚、挺舌、2–3天、盐、蜂蜜）在 ✓、渲染锁在 tooYoung 分支 ✓、卡头 flex ✓')
}

/* ---------- 6i. 6 月龄说明（添加要点 + 怎么做辅食）：数据 → 首页 → 收起交互 ----------
 * sixMonth 两张卡：points（5 条小标题段落，结构 points[]）+ cook（做法行，放最后一张）。
 * 用户要求：只在满 6 不满 7 显示、默认收起点头部展开。
 * 断链/错闸门的后果各不同：闸门写错 → 7 月龄还挂着「第一口辅食」；
 * 展开态没接 → 点了没反应（死交互）；cook 挪位/删行 → 做法缺东西。
 */
{
  const errsBefore = errs.length
  const guidesMod = require('./data/guides')
  const iw = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ij = fs.readFileSync('./pages/index/index.js', 'utf8')
  const ix = fs.readFileSync('./pages/index/index.wxss', 'utf8')

  // 1) 数据结构：必须是 points + cook 两张，cook 排最后（用户指定）
  const l6 = guidesMod.sixMonth
  if (!Array.isArray(l6) || !l6.length) {
    E('data/guides.js 没导出非空的 sixMonth 数组')
  } else {
    const pt = l6.find((c) => c.key === 'points')
    const ck = l6.find((c) => c.key === 'cook')
    if (!pt) E('sixMonth 缺少 points 卡（辅食添加要点）')
    if (!ck) E('sixMonth 缺少 cook 卡（怎么做辅食）')
    if (l6.length && l6[l6.length - 1].key !== 'cook')
      E('cook 不是最后一张卡 —— 用户要求「怎么做辅食」放最后')

    // 字段与徽标合法性（同 §6h 的 icon/iconBg 校验）
    l6.forEach((c) => {
      const ic = c.icon
      if (typeof ic !== 'string' || !ic || /\s/.test(ic) || [...ic].length > 4)
        E(`sixMonth.${c.key} 的 icon 非法：${JSON.stringify(ic)}`)
      if (!/^#[0-9a-f]{6}$/i.test(c.iconBg || ''))
        E(`sixMonth.${c.key} 的 iconBg 不是 6 位 hex：${c.iconBg}`)
      if (!c.title) E(`sixMonth.${c.key} 没有 title`)
    })

    // points 卡：小标题+段落组（≥4 条，字段齐全）
    if (pt) {
      if (!Array.isArray(pt.points) || pt.points.length < 4)
        E(`points 卡缺 points 段或不足 4 条（现 ${Array.isArray(pt.points) ? pt.points.length : '无'}）—— 截图 5 条要点会渲染不全`)
      else if (pt.points.some((p) => !p.title || !p.text))
        E('points 段里有空 title/text —— 会渲染出空的小标题或空段落')

      const all = JSON.stringify(pt.points)
      const PPT = [
        [/尽快/, '尽快添加的口径'],
        [/第一口辅食/, '第一口辅食怎么喂'],
        [/富含铁/, '首选富含铁的泥糊（补铁）'],
        [/2[–-]3 天/, '新食材观察 2–3 天'],
        [/中午/, '新食材安排中午'],
        [/洗手|生熟/, '饮食卫生']
      ]
      PPT.forEach(([re, what]) => { if (!re.test(all)) E(`points 段丢了「${what}」—— 6 月龄要点不完整`) })
    }

    // cook 卡：七种做法一种都不能少（用户点名：肉/肝/鱼/虾/菜/薯/果）
    if (ck) {
      if (!Array.isArray(ck.lines) || ck.lines.length < 5)
        E('cook 卡缺 lines 或不足 5 行 —— 做法列表渲染不全')
      else if (ck.lines.some((l) => typeof l !== 'string' || !l.trim()))
        E('cook 卡里有空行 —— 会渲染出空的 .guide-line')

      const call = JSON.stringify(ck.lines)
      const CKP = ['肉泥', '肝泥', '鱼泥', '虾泥', '菜泥', '薯类', '水果泥']
      CKP.forEach((w) => { if (call.indexOf(w) < 0) E(`cook 卡丢了「${w}」做法 —— 用户点名要的七种之一`) })
    }
  }

  // 2) 页面链路：数据挂载 + 月龄闸门 + 展开交互
  if (!/guide6:\s*guides\.sixMonth/.test(ij))
    E('index.js 没把 guide6 放进 data —— WXML 的 wx:for 拿不到六月龄卡片')
  if (!/sixOpen:\s*\{\s*\}/.test(ij))
    E('index.js 的 sixOpen 初始值必须是 {} —— 默认收起，不能开箱即展开')
  if (!/toggleGuide6\s*\(/.test(ij))
    E('index.js 缺少 toggleGuide6 方法 —— 点卡头没反应（死交互）')

  if (iw.indexOf('months >= 6 && months < 7') < 0)
    E('index.wxml 的 6 月龄闸门不是「满 6 不满 7」—— 闸门写错会让别的月龄看到第一口辅食')
  const gd6 = iw.indexOf('wx:for="{{guide6}}"')
  if (gd6 < 0) E('index.wxml 没渲染 guide6 —— 数据配了页面不显示（死数据）')
  else {
    const tg = iw.indexOf('<block wx:if="{{tooYoung}}">')
    if (tg >= 0 && gd6 > tg)
      E('guide6 渲染在 tooYoung 分支里 —— 会和 <6 月龄说明叠在一起')
    const seg = iw.slice(gd6, tg > gd6 ? tg : gd6 + 1600)
    ;['toggleGuide6', 'sixOpen[g.key]', '{{pt.title}}', '{{g.lines}}', 'guide-arrow'].forEach((b) => {
      if (seg.indexOf(b) < 0) E(`guide6 卡没绑 ${b} —— 展开按钮/箭头/要点/做法有断链`)
    })
  }

  // 3) 样式段：交互与要点排版的类都要有定义
  ;['guide-head--tap', 'guide-arrow', 'guide-body', 'guide-pt-title', 'guide-pt-text'].forEach((cls) => {
    if (!new RegExp('\\.' + cls.replace('--', '\\-\\-') + '\\s*\\{').test(ix))
      E(`index.wxss 没定义 .${cls} —— 引用了没定义的类，会裸渲染`)
  })
  const ga = ix.match(/\.guide-arrow\s*\{[^}]*/)
  if (ga && ga[0].indexOf('margin-left: auto') < 0)
    E('index.wxss 的 .guide-arrow 没有 margin-left:auto —— 箭头不会靠右，看不出可点开')

  if (errs.length === errsBefore)
    console.log('  6 月龄说明：points(6段：5要点+并入的清淡少盐)+cook(七种做法、排最后) ✓、口径（尽快/第一口/铁/2–3天/中午/卫生）在 ✓、闸门=满6不满7 ✓、默认收起+toggle 接通 ✓、箭头靠右 ✓')
}

/* ---------- 6j. 「有反应」(bad) 不可被洗白：藏按钮 + JS 拨卫 + storage 硬拒（H-2） ----------
 * bad 是系统里唯一的永久排除机制。旧版详情页按钮只排 safe/observing、
 * markIntroduced 又无条件覆写 —— 一次点按就把过敏食材洗白成「安全」，
 * 连反应日期都覆写丢失（档案页 profile.js 的拦截被整条绕过）。
 * 三层各司其职，缺一层都算回归：藏按钮=防误触，JS 拨卫=防假成功 toast，
 * storage 拒写=兜底不变量（bad 只能经 removeIntroduced 解除）。
 * 断言走函数级真跑：内存 wx stub 造 bad 记录 → 各路径覆写 → 逐一验不变量。
 */
{
  const errsBefore = errs.length
  const fj = fs.readFileSync('./pages/food-detail/food-detail.js', 'utf8')
  const fw = fs.readFileSync('./pages/food-detail/food-detail.wxml', 'utf8')

  // 1) WXML：两颗按钮必须显式排除 bad（只排 safe/observing 正是旧版漏洞）
  fw.split('\n').forEach((line) => {
    if (line.indexOf('bindtap="markSafe"') >= 0 && line.indexOf("status !== 'bad'") < 0)
      E('详情页「已经吃过，没问题」按钮没排除 bad —— bad 记录可被一键洗白（H-2 回归）')
    if (line.indexOf('bindtap="markObserving"') >= 0 && line.indexOf("status !== 'bad'") < 0)
      E('详情页「今天第一次试」按钮没排除 bad —— bad 记录可被一键洗白（H-2 回归）')
    // 反向钉：清除记录必须对 bad 可见 —— 否则用户被永久锁死、无解除通道
    if (line.indexOf('bindtap="clearRecord"') >= 0) {
      if (line.indexOf("status !== 'new'") < 0)
        E('详情页「清除记录」按钮的显示条件丢了 status !== new')
      if (line.indexOf("status !== 'bad'") >= 0)
        E('详情页把「清除记录」也对 bad 藏了 —— 解除 bad 的唯一通道被堵死，用户无法重新引入')
    }
  })
  // bad 引导行：按钮消失必须给解释 + 正确路径
  if (fw.indexOf('wx:if="{{status === \'bad\'}}"') < 0)
    E('详情页缺 bad 状态的解释/引导行 —— 用户不知道按钮为什么消失了、该怎么重新引入')

  // 2) JS：markSafe/markObserving 各要一处 bad 拨卫（防 WXML 条件被改坏后弹假成功 toast）
  const guardCnt = (fj.match(/status === 'bad'/g) || []).length
  if (guardCnt < 2)
    E(`food-detail.js 的 bad 拨卫不足（找到 ${guardCnt} 处，markSafe/markObserving 各要 1 处）`)

  // 3) storage 硬拒：函数级真跑（内存 wx stub，跑完还原）
  const mem = {}
  mem[storage.KEYS.INTRO] = []
  const hadWx = typeof global.wx !== 'undefined'
  const savedWx = global.wx
  global.wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v },
    removeStorageSync: (k) => { delete mem[k] }
  }
  try {
    // 前置：造一条 bad 记录
    storage.markIntroduced('yam')
    storage.setIntroStatus('yam', 'bad')
    const seed = storage.findIntro('yam')
    if (!seed || seed.status !== 'bad') {
      E('前置失败：没能造出 bad 记录，§6j 后续断言全部无效')
    } else {
      const d0 = seed.date

      // 3a) markIntroduced 不得覆写 bad（状态与日期都不行），且要返回 false
      const r1 = storage.markIntroduced('yam')
      const a1 = storage.findIntro('yam')
      if (!a1 || a1.status !== 'bad')
        E(`markIntroduced 把 bad 覆写成了 ${a1 ? a1.status : 'null'} —— 过敏食材被洗白（H-2 主漏洞）`)
      if (a1 && a1.date !== d0)
        E('markIntroduced 覆写了 bad 记录的日期 —— 过敏反应日期是核心信息，不能丢')
      if (r1 !== false)
        E('markIntroduced 遇 bad 应返回 false —— 调用方拿不到失败信号会弹「成功」toast')

      // 3b) setIntroStatus 不得把 bad 转成 safe（观察中确认结果的入口也不能反向用）
      const r2 = storage.setIntroStatus('yam', 'safe')
      const a2 = storage.findIntro('yam')
      if (!a2 || a2.status !== 'bad')
        E('setIntroStatus 把 bad 转成了 safe —— storage 层没守住不变量')
      if (r2 !== false)
        E('setIntroStatus 拒绝 bad→safe 时应返回 false')

      // 3c) 正常流程不误伤：观察中 → bad（确认过敏）必须放行
      storage.removeIntroduced('yam')
      storage.markIntroduced('yam')
      const r3 = storage.setIntroStatus('yam', 'bad')
      const a3 = storage.findIntro('yam')
      if (r3 !== true || !a3 || a3.status !== 'bad')
        E('observing→bad 被误伤 —— 档案页「确认有反应」的正常流程断了')

      // 3d) 正确解除路径必须走通：清除记录 → 重新引入回观察中
      storage.removeIntroduced('yam')
      const r4 = storage.markIntroduced('yam')
      const a4 = storage.findIntro('yam')
      if (r4 !== true || !a4 || a4.status !== 'observing')
        E('清除记录后重新引入失败 —— bad 守卫误伤了正常路径')
    }
  } catch (e) {
    E('§6j 函数级断言执行异常：' + e.message)
  } finally {
    if (hadWx) global.wx = savedWx
    else delete global.wx
  }

  if (errs.length === errsBefore)
    console.log('  6j 有反应不可洗白：藏按钮×2 ? 反向钉(清除记录必可见) ? JS 拨卫×2 ? storage 硬拒(状态/日期/返回值) ? 正常路径(→bad、清除后重引入)不误伤 ✓')
}

/* ---------- 6k. 每餐打卡（记录 → 回写引擎 → 14 天证据列表，v2.1） ----------
 * 三态打卡（full/some/refused）+ 有反应联动标 bad；连续拒吃 → ×0.15 软降权
 * 进指纹；档案页 14 天证据列表。各断链的后果：
 * 按钮 bindtap 冒泡 → 点打卡顺手展开步骤；指纹缺 f 段 → 打卡不触发重排，
 * 降权白算；参数没穿透 → 名单传不到 pickWeighted；reaction 不走 bad 正路
 * → 过敏食材还留在菜单里（H-2 反向回归）。
 */
{
  const errsBefore = errs.length
  const iw = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ij = fs.readFileSync('./pages/index/index.js', 'utf8')
  const pj = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const pw = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')
  const pl = fs.readFileSync('./utils/plan.js', 'utf8')
  const sj = fs.readFileSync('./utils/storage.js', 'utf8')
  const iw1 = iw.replace(/\s+/g, ' ')

  // 1) storage：函数、导出、键、清空
  ;['getMealLogs', 'logMeal', 'refusedRecipeIds'].forEach(function (fn) {
    if (sj.indexOf('function ' + fn + '(') < 0)
      E('storage 缺函数 ' + fn + '（每餐打卡链路断）')
    if (sj.indexOf(fn + ': ' + fn) < 0)
      E('storage 没导出 ' + fn)
  })
  if (sj.indexOf("MEALS: 'bb_meals'") < 0) E('storage 缺 KEYS.MEALS')
  if (sj.indexOf('removeStorageSync(KEYS.MEALS)') < 0)
    E('resetAll 没清 MEALS —— 「清除全部数据」后喂养记录残留')

  // 2) 按钮链路：三态齐 + 必须 catchtap（bindtap 会冒泡到 meal 的 toggleMeal）
  ;['full', 'some', 'refused'].forEach(function (st) {
    if (!new RegExp('catchtap="logMeal"[^>]*data-status="' + st + '"').test(iw1))
      E(`index.wxml 缺 catchtap=logMeal 的 "${st}" 打卡按钮`)
  })
  if (iw.indexOf('bindtap="logMeal"') >= 0)
    E('打卡按钮用了 bindtap —— 冒泡到 toggleMeal，点打卡顺手展开步骤')
  if (iw.indexOf('catchtap="reactionMeal"') < 0) E('index.wxml 缺「有反应」入口')
  if (iw.indexOf('catchtap="undoMealLog"') < 0) E('index.wxml 缺打卡撤销入口')
  if (ij.indexOf('logMeal(e)') < 0) E('index.js 缺 logMeal 处理器')
  if (ij.indexOf('reactionMeal(e)') < 0) E('index.js 缺 reactionMeal 处理器')
  if (ij.indexOf('undoMealLog(e)') < 0) E('index.js 缺 undoMealLog 处理器')

  // 3) 有反应：必须走 markIntroduced → setIntroStatus('bad') 正路（§6j 同源），
  //    且本餐记为 reaction —— 证据列表要能看到这次反应
  const rs = ij.slice(ij.indexOf('reactionMeal(e)'))
  if (!/markIntroduced\(fid\)/.test(rs) || !/setIntroStatus\(fid,\s*'bad'\)/.test(rs))
    E('reactionMeal 没走 markIntroduced → setIntroStatus(bad) 正路 —— 反应食材没进永久排除')
  if (!/logMeal\(d\.date,\s*d\.rid,\s*'reaction',\s*fid\)/.test(rs))
    E('reactionMeal 没把本餐记为 reaction —— 证据列表缺这次反应')

  // 4) 引擎：降权项 + 参数穿透 + planInputs 取名单 + 指纹 f 段
  if (pl.indexOf('refusedIds.indexOf(r.id) >= 0) w *= 0.15') < 0)
    E('pickWeighted 没有拒吃降权项（×0.15）—— 打卡不反哺排餐')
  if (!/pickWeighted\(pool, usedCount, dayMainUse, issueTags, dayCats,\s*opts\.refusedRecipeIds\)/.test(pl.replace(/\n\s*/g, ' ')))
    E('调用点没把 refusedRecipeIds 传进 pickWeighted —— 名单算了白算')
  if (pl.indexOf('refusedRecipeIds: storage.refusedRecipeIds()') < 0)
    E('planInputs 没取打卡名单 —— 引擎看不到回写')
  if (pl.indexOf("'f' + list(inputs.refusedRecipeIds)") < 0)
    E('planSignature 缺 f 段 —— 打卡后指纹不变，降权不触发重排')

  // 5) 装饰与渲染：checkable 闸（未来餐不能打卡）+ meal.log 挂载
  if (!/d\.checkable\s*=\s*d\.date\s*<=\s*todayKey/.test(ij))
    E('markToday 没算 day.checkable —— 未来餐也会出现打卡按钮')
  if (ij.indexOf('m.log =') < 0) E('markToday 没装饰 meal.log')
  if (iw.indexOf('wx:if="{{day.checkable}}"') < 0) E('打卡行没锁在 day.checkable 上')

  // 6) 证据列表：14 天喂养记录（v2.1 自档案页移入「我的」tab —— 记录归「我的」，
  //    档案页只管编辑。卡留在档案页 =「我的」记录中枢缺一块，且两页重复）
  const mj = fs.readFileSync('./pages/mine/mine.js', 'utf8')
  const mw = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')
  if (mj.indexOf('rebuildHistory') < 0)
    E('mine.js 缺 rebuildHistory —— 14 天喂养记录没跟着挪到「我的」')
  if (mj.indexOf('14 * 86400000') < 0)
    E('rebuildHistory 没按 14 天窗口过滤')
  if (mj.indexOf('this.rebuildHistory()') < 0)
    E('mine onShow 没调 rebuildHistory —— 进页看不到记录')
  if (mw.indexOf('最近 14 天喂养记录') < 0)
    E('mine.wxml 缺历史记录卡')
  if (pw.indexOf('最近 14 天喂养记录') >= 0)
    E('喂养记录卡还留在档案页 —— 挪了没挪走，两页重复')
  if (pj.indexOf('rebuildHistory') >= 0 || pj.indexOf('mealHistory') >= 0)
    E('档案页还残留喂养记录代码 —— 挪走没挪干净（死代码）')

  // 6b) 「有反应」入口双保险：「我的」记录卡的专属行（主入口，上轮修错页的回归点）
  //     + 档案页有反应卡（编辑语境）。大列表红标签不算入口：标题写着「没问题」。
  if (mj.indexOf('badCount') < 0)
    E('mine.js 没算 badCount —— 我的记录卡缺「有反应」行的数据')
  if (mw.indexOf('data-row="bad"') < 0)
    E('mine.wxml 缺「有反应、已排除」行 —— 「我的」tab 又没入口了（上轮修错页的回归）')
  if (mw.indexOf('wx:for="{{badList}}"') < 0)
    E('有反应行没绑 badList —— 点开是空壳，看不到具体食材')
  if (mj.indexOf("toItems('bad')") < 0)
    E('badList 没从 status=bad 过滤 —— 观察中/安全食材会混进有反应组')

  // 6c) 行内展开链：行可点 → openRow 展开 → 渲染带名字的真名单 → 点得进详情
  if (mj.indexOf('toggleRow(e)') < 0)
    E('mine.js 缺 toggleRow —— 记录行点不开')
  if (mw.indexOf('bindtap="toggleRow"') < 0)
    E('mine.wxml 记录行没绑 toggleRow —— 四行还是只读统计')
  if (mw.indexOf('wx:if="{{openRow === ') < 0)
    E('mine.wxml 没有按 openRow 展开的结构 —— 点开看不到名单')
  if (mj.indexOf('toItems(') < 0 || mw.indexOf('wx:for="{{safeList}}"') < 0)
    E('行内展开的数据链断了（toItems → safeList 渲染）—— 点开是空的')
  if (mj.indexOf('goFoodDetail(e)') < 0 || mw.indexOf('bindtap="goFoodDetail"') < 0)
    E('展开的食材点不进详情页（goFoodDetail 链断）')

  // 6d) 档案页保留的有反应卡（编辑语境下的管理入口，与「我的」行互为双保险）
  if (pj.indexOf('badFoods') < 0)
    E('profile.js 没建 badFoods —— 有反应的食材在档案页没有落点')
  if (pj.indexOf('return it.status === \'bad\'') < 0)
    E('badFoods 没按 status===bad 过滤 —— 观察中/安全的食材会混进有反应卡')
  if (pj.indexOf('goFoodDetail(e)') < 0)
    E('profile.js 缺 goFoodDetail 处理器 —— 有反应卡点不进详情页（清除记录没入口）')
  if (pj.indexOf('/pages/food-detail/food-detail?id=') < 0)
    E('goFoodDetail 没跳 food-detail?id= —— 详情页入口断链')
  if (pw.indexOf('有反应的食材') < 0)
    E('profile.wxml 缺「有反应的食材」卡 —— 档案页管理入口丢了')
  if (pw.indexOf('wx:for="{{badFoods}}"') < 0)
    E('有反应卡没绑 badFoods —— 卡片是空壳')
  if (pw.indexOf('出现反应') < 0)
    E('有反应卡没显示反应日期 —— 就医证据缺时间')

  // 7) 函数级真跑（内存 wx stub，跑完还原）：规则本身不许纸面化
  const mem = {}
  const hadWx = typeof global.wx !== 'undefined'
  const savedWx = global.wx
  global.wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v },
    removeStorageSync: (k) => { delete mem[k] }
  }
  try {
    const day = storage.todayStr()
    const d1 = storage.todayStr(new Date(Date.now() - 86400000))
    const d2 = storage.todayStr(new Date(Date.now() - 2 * 86400000))
    const old = storage.todayStr(new Date(Date.now() - 9 * 86400000))

    storage.logMeal(day, 'rice', 'full')
    storage.logMeal(day, 'rice', 'refused') // 同日同菜覆写
    const same = storage.getMealLogs().filter((e) => e.recipeId === 'rice' && e.date === day)
    if (same.length !== 1) E(`同日同菜应只保留 1 条，实际 ${same.length} 条`)
    if (same.length && same[0].status !== 'refused')
      E('同日同菜第二次打卡没覆盖第一次')

    // 连续 2 次没吃（隔天）→ 进名单；单次 → 不进
    storage.logMeal(d1, 'oat', 'refused')
    storage.logMeal(d2, 'oat', 'refused')
    const r1 = storage.refusedRecipeIds()
    if (r1.indexOf('oat') < 0) E('连续 2 次没吃没进降权名单 —— 拒吃不反哺')
    if (r1.indexOf('rice') >= 0) E('单次没吃就进了名单 —— 规则是「连续 2 次」')

    // 7 天窗外的没吃不算
    storage.logMeal(old, 'millet', 'refused')
    storage.logMeal(d1, 'millet', 'refused')
    if (storage.refusedRecipeIds().indexOf('millet') >= 0)
      E('7 天窗外的没吃也算了 —— 窗口没生效')

    // 吃一次（some/full 都算）→ 自动解除
    storage.logMeal(day, 'oat', 'some')
    if (storage.refusedRecipeIds().indexOf('oat') >= 0)
      E('吃过一次还留在降权名单 —— 解除规则没生效')

    // 撤销
    storage.logMeal(day, 'rice', null)
    if (storage.getMealLogs().some((e) => e.recipeId === 'rice'))
      E('撤销（status=null）没删掉记录')

    // 指纹联动：连续拒吃必须让签名变化，否则缓存不失效、降权不触发重排
    storage.setBaby({ name: '臭宝', birthday: '2026-01-01' })
    const s0 = plan.planSignature(storage)
    storage.logMeal(day, 'yam', 'refused')
    storage.logMeal(d1, 'yam', 'refused')
    const s1 = plan.planSignature(storage)
    if (!s0 || !s1 || s0 === s1)
      E('连续拒吃打卡后 planSignature 没变 —— 降权不触发重排')
    const inputs = plan.planInputs(storage)
    if (!inputs || (inputs.refusedRecipeIds || []).indexOf('yam') < 0)
      E('planInputs 没带出 refusedRecipeIds —— 引擎断链')
  } catch (e) {
    E('§6k 函数级断言执行异常：' + e.message)
  } finally {
    if (hadWx) global.wx = savedWx
    else delete global.wx
  }

  if (errs.length === errsBefore)
    console.log('  6k 每餐打卡：三态按钮(catchtap)+撤销 ? 反应走 bad 正路+记本餐 ? 降权×0.15 穿透+指纹f段 ? checkable闸 ? 记录中枢(我的4行+行内展开+有反应行) ? 14天喂养记录在「我的」 ? 档案页有反应卡+挪干净 ? 规则真跑(2次进/1次不进/窗外不算/吃过即解除/撤销/指纹联动) ✓')
}

/* ---------- 6l. v2.2 视觉基线：卡片阴影（B1） ----------
 * 设计评审结论：#fff 卡 vs #faf9f6 页面底色差约 1.5%，全站又零阴影、
 * 只靠 1rpx 描边分层 —— 真机低亮度下白卡会糊成一片。
 * 锁三件事 ——
 *   1. 唯一定义：阴影只许写在 app.wxss 的 .card 里。散到各页 = 重复定义，
 *      改一处漏一处（.mini-btn 已经这样漂移过，见评审 B3）
 *   2. 必须有：.card 没 box-shadow 就是 B1 白做，卡浮不起来
 *   3. 必须够浅（alpha ≤ 0.1）：这是边界提示不是立体感。加成重阴影
 *      就背离了「暖白台面 + 全描边 + quiet」的风格方向
 */
{
  const errsBefore = errs.length
  const appWxss = fs.readFileSync('./app.wxss', 'utf8')
  const cardRule = appWxss.match(/\.card\s*\{[^}]*\}/)
  if (!cardRule) {
    E('app.wxss 找不到 .card 规则 —— 全局卡片样式没了')
  } else {
    const m = cardRule[0].match(/box-shadow:\s*([^;]+)/)
    if (!m) {
      E('app.wxss 的 .card 没有 box-shadow —— 白卡 vs 暖白底只差约 1.5%，低亮度下糊成一片（B1 被拆了）')
    } else {
      // rgba(r, g, b, a) → 取最后一个数即 alpha
      const rgba = m[1].match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/)
      if (rgba && parseFloat(rgba[1]) > 0.1)
        E('.card 阴影 alpha=' + rgba[1] + ' 过重（>0.1）—— B1 要的是极浅边界提示，不是立体重阴影')
    }
    // 反向：页面 wxss 不许各自再给 card 系加阴影（散落必漂移）
    ;['index', 'mine', 'profile', 'food', 'food-detail'].forEach((p) => {
      const css = fs.readFileSync(`./pages/${p}/${p}.wxss`, 'utf8')
      if (/\.card[^{]*\{[^}]*box-shadow/.test(css))
        E(`${p}.wxss 自己给 card 系类加了 box-shadow —— 阴影必须只在 app.wxss 的 .card 一处定义`)
    })
  }

  /* —— A1：今天日期 = 计划页唯一的 display 时刻 ——
   * 锁三件事：今天专属规则升到 --fs-display/600；基础 .day-date 保持 fs-sm
   * （非今天的日子必须安静，否则人人都大 = 没有锚点）；混合三档字号用
   * baseline 对齐（center 会让 22rpx 胶囊浮在 40rpx 日期中间）。 */
  const idxWxss = fs.readFileSync('./pages/index/index.wxss', 'utf8')
  const fontSizeOf = (css, cls) => {
    const m = css.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*font-size:\\s*([^;}]+)'))
    return m ? m[1].trim() : null
  }
  const todayDate = idxWxss.match(/\.day-card--today\s+\.day-date\s*\{[^}]*\}/)
  if (!todayDate) {
    E('index.wxss 缺 .day-card--today .day-date 规则 —— 今天日期没提档（A1 被拆了）')
  } else {
    if (!/font-size:\s*var\(--fs-display\)/.test(todayDate[0]))
      E('今天日期没用 --fs-display —— A1 要它是计划页唯一的 display 时刻')
    if (!/font-weight:\s*600/.test(todayDate[0]))
      E('今天日期没加 font-weight 600 —— A1 拔高不完整')
  }
  const baseDate = fontSizeOf(idxWxss, 'day-date')
  if (baseDate !== 'var(--fs-sm)')
    E('基础 .day-date 字号是 ' + baseDate + ' 而非 var(--fs-sm) —— 非今天的日子被一起放大，锚点就没了')
  if (!/\.day-head-l\s*\{[^}]*align-items:\s*baseline/.test(idxWxss))
    E('.day-head-l 没用 baseline 对齐 —— 星期/日期/今天胶囊三档字号 center 会错位')

  /* —— B2：打卡行命中区 ≥ 44pt ——
   * min-height 直接表达需求（88rpx = 44pt @2rpx=1pt），不靠 padding 反推。
   * 三个配套一起锁：flex 居中（否则 min-height 顶字）、state/undo 与按钮
   * 同高（否则打卡前后行高跳变）、文本内部 lh+2×pad 必须撑满 88（贴顶=半残）。 */
  const ruleOf = (cls) => {
    const m = idxWxss.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*\\}'))
    return m ? m[0] : null
  }
  const hBtn = (() => {
    const r = ruleOf('ml-btn')
    const m = r && r.match(/min-height:\s*(\d+)rpx/)
    return m ? parseInt(m[1], 10) : null
  })()
  if (hBtn === null)
    E('.ml-btn 没有 min-height —— 打卡按钮命中区没有保证（B2 被拆了）')
  else if (hBtn < 88)
    E('.ml-btn min-height=' + hBtn + 'rpx < 88rpx（44pt，2rpx=1pt）—— 打卡按钮命中区不达标（B2）')
  const btnRule = ruleOf('ml-btn')
  if (btnRule && !(/display:\s*flex/.test(btnRule) && /align-items:\s*center/.test(btnRule)))
    E('.ml-btn 没有 flex 垂直居中 —— min-height 会把文字顶在上边（B2 半残）')
  ;['ml-state', 'ml-undo'].forEach((cls) => {
    const r = ruleOf(cls)
    if (!r) { E(`.${cls} 规则不见了`); return }
    const lh = (r.match(/line-height:\s*(\d+)rpx/) || [])[1]
    const pad = (r.match(/padding:\s*(\d+)rpx/) || [])[1]
    const h = lh && pad ? parseInt(lh, 10) + 2 * parseInt(pad, 10) : 0
    if (h < 88)
      E(`.${cls} 实际高度算术 = ${lh || '?'}+2×${pad || '?'} = ${h}rpx < 88rpx —— 文本贴顶/命中区缩水`)
    if (hBtn && Math.abs(h - hBtn) > 4)
      E(`.${cls} 高度(${h}rpx)与 .ml-btn(${hBtn}rpx)差 >4rpx —— 打卡前后整行高度跳变`)
  })
  // 反向：有反应也是打卡行的点击目标，不许缩水
  const reactRule = ruleOf('ml-btn-react')
  const hm = reactRule && reactRule.match(/min-height:\s*(\d+)rpx/)
  if (hm && parseInt(hm[1], 10) < 88)
    E('.ml-btn-react 把 min-height 改小了 —— 有反应也是打卡行的点击目标')

  if (errs.length === errsBefore)
    console.log('  6l 视觉基线：.card 阴影唯一+alpha≤0.1 ✓、今天日期=计划页唯一 display(40/600) ✓、基础日期 fs-sm ✓、三档 baseline ✓、打卡行 min-height96≥88+flex居中 ✓、state/undo 同高+行盒撑满 ✓')
}

/* ---------- 6m. 重排窗口与新食材槽位（v2.6 · P2 修复） ----------
 * 两条不变量：
 *   1. 隐式重排（输入指纹变了）不得改动「已发生的日子」，且窗口不得前移。
 *      打卡按 date|recipeId 落库 —— 整段从今天重排后，已打卡那天的 recipeId
 *      不在新计划里，计划页的打卡行凭空消失（数据还在「我的」14 天记录里，
 *      但「哪一餐吃了没」对不上了）；窗口也会从周一起始漂到周一起始+今天。
 *   2. 新食材名额恒为每周 2 个、全在工作日、彼此间隔 ≥3 天（观察期）。
 *      旧写法固定第 1/4 天、遇周末直接丢槽 —— 起始日是周三/周四/周六/周日时
 *      一周只剩 1 个名额，引入节奏凭空慢一半（实测 4/7 起始日中招）。
 * 断链的后果都是「代码全绿但产品不能用」，正是本脚本要拦的那一类。
 */
{
  const errsBefore = errs.length
  const idxJs = fs.readFileSync('./pages/index/index.js', 'utf8')
  const idxJs1 = idxJs.replace(/\n\s*/g, ' ')
  const pl = fs.readFileSync('./utils/plan.js', 'utf8')

  // —— 1) 链路钉：隐式重算走 replanOpts；「重新生成」必须不冻结 ——
  if (pl.indexOf('function replanOpts(') < 0 || pl.indexOf('replanOpts: replanOpts') < 0)
    E('plan.js 缺 replanOpts 或没导出 —— 保留窗口/冻结机制根本不存在')
  if (!/generateFromStorage\(storage,\s*plan\.replanOpts\(p\)\)/.test(idxJs1))
    E('index.js 的隐式重算没走 plan.replanOpts —— P2 回归：重排前移窗口、打卡行从计划页消失')
  // 锚点必须是函数体定义「regenerate() {」—— 注释里提到的 regenerate() 不带大括号
  const regenAt = idxJs.indexOf('regenerate() {')
  const regenSlice = regenAt >= 0 ? idxJs.slice(regenAt) : ''
  if (regenAt < 0) E('index.js 找不到 regenerate() 定义 —— 「重新生成」入口没了')
  if (regenSlice.indexOf('replanOpts') >= 0)
    E('regenerate（用户明确点「重新生成」）走了 replanOpts —— 用户已确认「原来的会被替换」，不该被冻结')
  if (!/generateFromStorage\(storage\)/.test(regenSlice))
    E('regenerate 没有整份重排（generateFromStorage 不带第二参）')

  // —— 2) 槽位：7 个起始日各 2 个名额、全工作日、间隔 ≥3 天 ——
  const baseInputs = {
    months: 10, issues: [], sick: false,
    safeFoodIds: [], blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
  }
  const mk = (extra) => {
    const o = {}
    Object.keys(baseInputs).forEach((k) => { o[k] = baseInputs[k] })
    Object.keys(extra || {}).forEach((k) => { o[k] = extra[k] })
    return o
  }

  for (let back = 0; back < 7; back++) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - back)
    const p = plan.generate(mk({ startDate: start }))
    if (!p) { E(`6m 起始回退 ${back} 天生成失败`); continue }
    const idxs = []
    p.days.forEach((d, i) => { if (d.newFood) idxs.push(i) })
    const label = `${p.days[0].date} ${p.days[0].weekday}起始`
    if (idxs.length !== 2)
      E(`6m ${label}：本周只排了 ${idxs.length} 个新食材（应恒为 2，遇周末顺延不丢槽）`)
    idxs.forEach((i) => {
      if (p.days[i].isWeekend) E(`6m ${label}：新食材排在了周末（${p.days[i].date}）`)
    })
    if (idxs.length === 2 && idxs[1] - idxs[0] < 3)
      E(`6m ${label}：两个引入日只隔 ${idxs[1] - idxs[0]} 天 < 3 —— 观察期被压缩`)
  }

  // —— 3) 冻结：窗口不前移、已发生的日子逐餐照抄、采购清单仍覆盖整周 ——
  try {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - 2) // 让窗口里有 3 个「已发生」的日子（含今天）
    const p1 = plan.generate(mk({ startDate: start }))
    const todayK = plan.dateKey(new Date())

    if (plan.replanOpts(null) !== null || plan.replanOpts({}) !== null)
      E('replanOpts 对空计划没有返回 null —— 会把 undefined 当计划用')

    const opts = plan.replanOpts(p1)
    if (!opts) {
      E('6m replanOpts 对「仍覆盖今天」的计划返回 null —— 冻结机制没生效')
    } else {
      if (opts.startDate !== p1.startDate)
        E('6m replanOpts 没沿用旧计划的起始日 —— 窗口会前移（P2）')
      const past = p1.days.filter((d) => d.date <= todayK)
      if (opts.frozenDays.length !== past.length)
        E(`6m replanOpts 冻结了 ${opts.frozenDays.length} 天，应为「日期 ≤ 今天」的 ${past.length} 天`)
      if (opts.frozenDays.some((d) => d.date > todayK))
        E('6m 把未来的日子也冻结了 —— 计划从此不再更新，降权和新输入全部失效')

      const p2 = plan.generate(mk({ startDate: opts.startDate, frozenDays: opts.frozenDays }))
      if (p2.startDate !== p1.startDate)
        E(`6m 重排后起始日 ${p1.startDate} → ${p2.startDate} —— 窗口前移（P2）`)
      p2.days.forEach((d, i) => {
        if (!p1.days[i] || d.date !== p1.days[i].date)
          E(`6m 重排后第 ${i} 天日期错位（${(p1.days[i] || {}).date} → ${d.date}）`)
      })
      past.forEach((d, i) => {
        if (JSON.stringify(p2.days[i].meals) !== JSON.stringify(d.meals))
          E(`6m ${d.date}（已发生的日子）被重排了 —— 这天的打卡行会从计划页消失（P2）`)
        if (JSON.stringify(p2.days[i].newFood) !== JSON.stringify(d.newFood))
          E(`6m ${d.date}（已发生的日子）的新食材尝试被改了 —— 观察记录与计划对不上`)
      })
      // 未来的新食材名额：记录没变时候选序列不变，应与旧计划一致
      p1.days.filter((d) => d.date > todayK).forEach((d, i) => {
        const nd = p2.days[past.length + i]
        if (nd && JSON.stringify(nd.newFood) !== JSON.stringify(d.newFood))
          E(`6m ${d.date} 的新食材候选发生漂移 —— 冻结日的名额消耗算错了`)
      })
      // 采购清单必须覆盖冻结日用到的食材（用量已计入，而不是「从今天起」）
      const shopCount = {}
      p2.shopping.forEach((g) => g.items.forEach((it) => { shopCount[it.foodId] = it.count }))
      past.forEach((d) => d.meals.forEach((m) => {
        const r = recipes.filter((x) => x.id === m.recipeId)[0]
        if (!r) return
        r.mainFoods.concat(r.sideFoods || []).forEach((fid) => {
          if (!shopCount[fid]) E(`6m 采购清单漏了 ${fid} —— 冻结日的用量没计进 foodUse`)
        })
      }))
    }

    // 窗口过期（整份计划都在过去）→ 没有可冻结的日子，照旧整份重来
    const oldStart = new Date()
    oldStart.setHours(0, 0, 0, 0)
    oldStart.setDate(oldStart.getDate() - 10)
    const expired = plan.generate(mk({ startDate: oldStart }))
    if (plan.replanOpts(expired) !== null)
      E('6m 对「窗口不覆盖今天」的计划仍返回冻结选项 —— 旧计划会被原样拖着走')
  } catch (e) {
    E('§6m 函数级断言执行异常：' + e.message)
  }

  if (errs.length === errsBefore)
    console.log('  6m 重排窗口与新食材槽位：隐式重算走 replanOpts+「重新生成」不冻结 ✓、7 个起始日各 2 名额且全工作日+间隔≥3 ✓、已发生的日子逐餐照抄 ✓、窗口不前移 ✓、采购清单覆盖冻结日 ✓')
}

/* ---------- 7. 统计 ---------- */
const byCat = {}
foods.forEach((f) => { byCat[f.category] = (byCat[f.category] || 0) + 1 })
const byTexture = {}
recipes.forEach((r) => { byTexture[r.texture] = (byTexture[r.texture] || 0) + 1 })

console.log('================ 统计 ================')
console.log(`食材 ${foods.length} 条，致敏 ${foods.filter((f) => f.allergen).length} 条`)
console.log('  分类：', byCat)
console.log(`菜谱 ${recipes.length} 条`)
console.log('  性状：', byTexture)
const allTags = new Set()
recipes.forEach((r) => (r.tags || []).forEach((t) => allTags.add(t)))
console.log('  实际标签：', [...allTags].join(' / '))

// 每个阶段至少要有多少条可选
console.log('  各月龄可选菜谱数：')
;[6, 8, 10, 13, 18].forEach((m) => {
  const n = recipes.filter((r) => age.isRecipeSuitable(r, m)).length
  console.log(`    ${m} 月龄 → ${n} 条${n < 10 ? '  ← 偏少，建议补充' : ''}`)
})

console.log('\n================ 结果 ================')
if (warns.length) {
  console.log(`⚠️  提醒 ${warns.length} 条：`)
  warns.forEach((w) => console.log('   - ' + w))
}
if (errs.length) {
  console.log(`\n❌ 错误 ${errs.length} 条：`)
  errs.forEach((e) => console.log('   - ' + e))
  process.exit(1)
} else {
  console.log('\n✅ 无错误')
}
