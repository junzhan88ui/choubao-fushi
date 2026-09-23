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

/* ---------- 6b. 喂养提醒文案（对齐膳食指南，发布前需营养师复核） ----------
 * 用户已确认：维生素 D 提示不做；此处锁定「避免腌制/卤制/烧烤」与盐摄入说明两条。
 */
{
  const wxml = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  if (wxml.indexOf('腌制') < 0 || wxml.indexOf('卤制') < 0 || wxml.indexOf('烧烤') < 0)
    E('index.wxml 的「喂养提醒」缺「避免腌制/卤制/烧烤」文案')
  if (wxml.indexOf('saltTip') < 0)
    E('index.wxml 没有绑定 saltTip（盐摄入按年龄动态提示）')

  const js = fs.readFileSync('./pages/index/index.js', 'utf8')
  if (js.indexOf('saltTipFor') < 0)
    E('index.js 缺 saltTipFor（按年龄算盐提示）')
  if (js.indexOf('0~1.5g') < 0)
    E('index.js 的盐摄入说明缺官方上限「0~1.5g」')
  console.log('  喂养提醒文案：避免腌制/卤制/烧烤 ✓，盐摄入按年龄提示 ✓')
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
    getBaby() { return { birthday: state.birthday } },
    getStatuses() { return state.issues.concat(state.sick ? ['sick'] : []) },
    getIssues() { return state.issues },
    getSick() { return state.sick },
    safeFoodIds() { return state.safe },
    badFoodIds() { return state.bad },
    recordedFoodIds() { return state.safe.concat(state.bad, state.obs) },
    observingFoodIds() { return state.obs }
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
    ['观察中食材', (s) => { s.obs = ['pumpkin'] }]
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
