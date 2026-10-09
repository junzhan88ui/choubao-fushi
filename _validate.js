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
 * v2.25 · 方案A：引入不再由引擎排序自动排（旧的「不能排到最后」已无对象），
 * 改钉档案页这条通道 —— 门得关着、入口得走观察期、还得按月龄拦。
 */
{
  // v2.25 · 方案A：引擎不再自动排新食材（档案页是引入的唯一入口），所以旧的
  // 「26 周自动引入序列」没有对象可扫 —— 改钉档案页这条通道的三个真条件：
  //   ① 门得关着：一条记录都没有时，计划里不许出现含致敏食材的菜；
  //   ② 过了门就得开：全部标 safe 后致敏食材必须真进菜（见下方 allSafe）；
  //   ③ 入口不许跳过观察期：profile.toggleFood 勾致敏食材必须停在 observing。
  // 官方原文（准则二「不盲目回避易过敏食物」）见 utils/plan.js foodUsable 注释。

  // ① 致敏门：safeFoodIds 为空 = 用户什么都没勾过
  const gate = plan.generate({
    months: 10, issues: [], safeFoodIds: [], blockedFoodIds: [],
    recordedFoodIds: [], observingCount: 0
  })
  if (!gate) {
    E('5b 致敏门测试：plan.generate 返回 null')
  } else {
    const leak = gate.days.some(function (d) {
      return (d.meals || []).concat(d.snack ? [d.snack] : []).some(function (meal) {
        const r = recipes.filter(function (x) { return x.id === meal.recipeId })[0]
        if (!r) return false
        return r.mainFoods.concat(r.sideFoods || []).some(function (id) { return allergenIds.indexOf(id) >= 0 })
      })
    })
    if (leak)
      E('5b 什么都没记录时，计划里已经出现含致敏食材的菜 —— 未经引入就喂，比「盲目回避」更危险')
  }

  // ③ 引入入口：勾选致敏食材必须留在观察期，不许当场标 safe
  const pSrc5b = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const tg5b = pSrc5b.indexOf('toggleFood(')
  const tgEnd5b = pSrc5b.indexOf('confirmObservation(', tg5b)
  const tgSeg5b = tg5b >= 0 && tgEnd5b > tg5b ? pSrc5b.slice(tg5b, tgEnd5b) : ''
  if (!tgSeg5b) {
    E('5b profile.js 缺 toggleFood —— 档案页没有引入入口')
  } else if (!/markIntroduced\(id\)/.test(tgSeg5b)) {
    E('5b toggleFood 没调 storage.markIntroduced —— 勾选不落记录，引入通道是断的')
  } else if (!/!\s*f\s*\|\|\s*!\s*f\.allergen/.test(tgSeg5b)) {
    E('5b toggleFood 没把致敏食材留在观察期（缺 !f.allergen 分支）—— 一点就跳过 3 天观察，等于把 v2.11 的老毛病搬回来了')
  } else if (!/isFoodReady\(f,\s*this\.data\.months\)/.test(tgSeg5b)) {
    E('5b toggleFood 没按月龄拦引入 —— 6 月龄就能勾到 9 月龄才该吃的食材（引擎的 minMonth 升序已随方案A删除）')
  }
  console.log('  5b 致敏通道：未记录 → 菜里一道致敏食材都没有；档案页勾 → 停在观察期 + 月龄门 ✓')
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

// 6~7 月龄官方原文是「逐渐达到」，不能报成「不达标」（catApplicable 应为 false）。
// v2.9：7 月龄已按固定菜单/7月知识卡排 2 餐，但豁免口径没变 ——
// 该月菜池全是单类菜，4 类 + 3 必需物理上凑不齐，断言钉的是「豁免」不是「餐数」。
;[6, 7].forEach(function (m) {
  const p = plan.generate({
    months: m, issues: [], safeFoodIds: foods.map(function (f) { return f.id }),
    blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
  })
  if (!p) return
  p.days.forEach(function (d) {
    if (d.catApplicable) E(`${m} 月龄的 catApplicable 应为 false（官方「逐渐达到」，6~7 月龄不作硬要求）`)
  })
})

/* ---------- 5d. 生病中状态（对齐 WS/T 678—2020 3.8） ----------
 * 「患病期间暂停添加新的辅食。……病愈后，及时恢复正常饮食。」
 * v2.25 · 方案A：引擎已不产出任何新食材，这里只钉「病中仍要正常排餐」；
 * 「病中剔未记录加料」这条真正的新辅食暂停语义由 6s F 钉。
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
console.log('  生病中状态：仍正常排餐 ✓、病中剔未记录加料（见 6s F）✓')

if (typeof age.isRecipeSuitable !== 'function') E('age.js 缺 isRecipeSuitable')
if (typeof age.isFoodReady !== 'function') E('age.js 缺 isFoodReady')

/* ---------- 5e. 禁食提示条目不能被引入 ----------
 * foods 里的 honey 是「禁食提示」，不是待引入的辅食。v2.25 · 方案A 之后引擎
 * 已不排新食材，这道门落到档案页：honey 不进可勾选列表（rebuild 直接 continue），
 * 用户点不到；菜谱侧也不许引用它（下方 recipes 扫描）。
 */
{
  const honey = foods.filter(function (f) { return f.id === 'honey' })[0]
  if (!honey) E('foods 里找不到 honey（禁食条目），5e 断言已失效')
  else if (honey.introducible !== false)
    E('honey 必须标 introducible:false —— 禁食条目不进可勾选列表、详情页也藏掉引入按钮')

  const noIntroIds = foods.filter(function (f) { return f.introducible === false })
    .map(function (f) { return f.id })

  // 禁食条目也不该被任何菜谱引用，否则会绕过新食材通道直接进常规菜谱
  recipes.forEach(function (r) {
    const hit = (r.mainFoods || []).concat(r.sideFoods || [])
      .filter(function (id) { return noIntroIds.indexOf(id) >= 0 })
    if (hit.length) E(`${r.id} 引用了不可引入的食材 ${hit.join('/')}（禁食条目不应进菜谱）`)
  })

  // v2.25 · 方案A：引擎不再排新食材，这道门改到档案页 —— honey 必须被挡在
  // 可勾选列表之外（profile.rebuild 里直接 continue），用户连点都点不到。
  // 旧的「构造唯一候选、看它会不会被排成新食材卡」已随方案A删除：候选池不复
  // 存在，扫 day.newFood 恒为 null，只会是假通过。
  const pSrc5e = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  if (!/f\.introducible\s*===\s*false/.test(pSrc5e))
    E('档案页没按 introducible:false 挡住禁食条目 —— 禁食提示现在能被用户勾选引入')

  console.log(`  禁食条目（${noIntroIds.join('/') || '无'}）：introducible:false 且不被任何菜谱引用 ✓`)
}

/* ---------- 5f. 同日主料撞车：软约束，但不能劣化 ----------
 * 这不是硬要求 —— 官方的多样性要求在「类别」层面，由 5c 保证（见 README）。
 * 阈值定在 20% 的依据（15 月龄、多轮实测）：
 *   基线 ~11%  →  去掉主料惩罚后 27%+
 * （v2.9 基线：惩罚 ×0.15、正餐池分槽后实测 ~11.3%——0.15 是 v2.9 重新标定的：
 *   分池后旧力度 ×0.3 会升到 ~19%，贴上限，故加强一档，见 plan.js 注释。）
 * 20% 卡在基线与「无惩罚」之间：既给抽样波动留了 3σ≈4% 的余量，又能拦住
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
    E(`${M} 月龄同日主料撞车率 ${(rate * 100).toFixed(1)}%，超过 20% 上限（基线 ~11%，去掉主料惩罚会升到 27%+）`)
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
    // 容错：文案从「不额外加盐」改成「不加盐」也算在（钉的是口径，不是用词）
    [/不加盐/, '不加盐的口径'],
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
      where: '采购清单（v2.25 · 方案A 后首页已无新食材卡）',
      js: './utils/plan.js', wxml: './pages/index/index.wxml',
      binds: ['{{it.icon}}', 'it.iconBg'],
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

  // v2.25 · 方案A 后 plan.js 只喂采购清单一处（新食材卡随引擎停排一并删除）
  const planJs = rd('./utils/plan.js')
  if ((planJs.match(/iconFor\(/g) || []).length < 1)
    E('plan.js 里 iconFor 一次都没调 —— 采购清单的图标/底色断了')

  // 该 flex 的地方必须 flex：徽标是块级 view，不 flex 会把标题/标签撑成两行
  // v2.25 · 方案A：.newfood-title 已随首页新食材卡删除，不再进这张表
  const flexChecks = [
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
 * sixMonth 两张卡：points（小标题段落，结构 points[]，≥4 条）+ cook（做法行，放最后一张）。
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
      // v2.10 用户删掉「新食物加量有节奏」「确保饮食卫生」两段 → 原钉的
      // 中午（过敏段）、洗手/生熟（卫生段）随之作废，只留仍存在的四条口径
      const PPT = [
        [/尽快/, '尽快添加的口径'],
        [/第一口辅食/, '第一口辅食怎么喂'],
        [/富含铁/, '首选富含铁的泥糊（补铁）'],
        [/2[–-]3 天/, '新食材观察 2–3 天']
      ]
      PPT.forEach(([re, what]) => { if (!re.test(all)) E(`points 段丢了「${what}」—— 6 月龄要点不完整`) })
      // 反向钉：删掉的两段不许再加回来
      ;['新食物加量有节奏', '确保饮食卫生'].forEach((t) => {
        if (all.indexOf(t) >= 0)
          E(`points 段又出现了「${t}」—— v2.10 已按用户要求删除，别加回来`)
      })
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
    console.log('  6 月龄说明：points(5段，加量节奏/卫生两段已按用户要求删+反向钉)+cook(八行、排最后，含起步阶梯) ✓、口径（尽快/第一口/铁/2–3天）在 ✓、闸门=满6不满7 ✓、默认收起+toggle 接通 ✓、箭头靠右 ✓')
}

/* ---------- 6j. 「有反应」(bad) 不可被洗白：藏按钮 + JS 拨卫 + storage 硬拒（H-2） ----------
 * bad 是系统里唯一的永久排除机制。旧版详情页按钮只排 safe/observing、
 * markIntroduced 又无条件覆写 —— 一次点按就把过敏食材洗白成「安全」，
 * 连反应日期都覆写丢失（档案页 profile.js 的拦截被整条绕过）。
 * 三层各司其职，缺一层都算回归：确认弹窗/藏按钮=防误触，JS 拨卫=防假成功 toast，
 * storage 拒写=兜底不变量（bad 只能经 removeIntroduced 解除，任何直接覆写都被硬拒）。
 * v2.25：①「清除记录」+clearRecord、「今天第一次试」+markObserving 移出详情页 ——
 * 清除走档案页「有反应的食材」卡（profile.clearBad），引入/观察走档案页勾选；
 * ②详情页新增「食物过敏」按钮（markBad：就地标 bad）与重新加入入口（markSafe 的 bad
 * 分支：确认弹窗 → removeIntroduced → 重标 safe）—— 防误触由「藏按钮」换成「确认弹窗」，
 * storage 硬拒一层不动。
 * 断言走函数级真跑：内存 wx stub 造 bad 记录 → 各路径覆写 → 逐一验不变量。
 */
{
  const errsBefore = errs.length
  const fj = fs.readFileSync('./pages/food-detail/food-detail.js', 'utf8')
  const fw = fs.readFileSync('./pages/food-detail/food-detail.wxml', 'utf8')

  // 1) WXML：两颗标记按钮各司其职 ——「已经吃过」在 bad 态下**也要**显示（重新加入入口，
  //    防误触靠 JS 弹窗而不是藏按钮）；「食物过敏」标 bad，自身不许对 bad 显示。
  //    「清除记录」与「今天第一次试」仍不许回到详情页（清除的另一条通道在档案页）。
  const pj6j = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const pw6j = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')
  fw.split('\n').forEach((line) => {
    // 「已经吃过」必须对 bad 可见 —— 这是重新加入的入口（靠 JS 弹窗防误触，不是靠藏按钮）
    if (line.indexOf('bindtap="markSafe"') >= 0 && line.indexOf("status !== 'bad'") >= 0)
      E('详情页把「已经吃过，没问题」对 bad 藏了 —— 重新加入的确认弹窗入口没了')
    // 「食物过敏」：标 bad 的入口，自身不许对 bad 显示（重复标记会覆写反应当天日期）
    if (line.indexOf('bindtap="markBad"') >= 0) {
      if (line.indexOf("status !== 'bad'") < 0)
        E('详情页「食物过敏」按钮没排除 bad —— 已过敏的食材会被重复标记、反应当天日期被覆写')
      if (line.indexOf('introducible') < 0)
        E('详情页「食物过敏」按钮没过 introducible 闸 —— 禁食提示条目也能被标过敏')
    }
    if (line.indexOf('bindtap="markObserving"') >= 0)
      E('详情页又出现「今天第一次试」按钮 —— v2.25 起引入只走档案页勾选（致敏即停观察中），别搬回来')
    if (line.indexOf('bindtap="clearRecord"') >= 0)
      E('详情页又出现「清除记录」按钮 —— v2.25 起解除通道在档案页「有反应的食材」卡，别搬回来')
  })
  if (fw.indexOf('bindtap="markBad"') < 0)
    E('详情页缺「食物过敏」按钮 —— 标过敏只剩档案页一个入口，详情页应就地标')
  // 引入/观察通道必须在档案页活着：观察中只由 markIntroduced（致敏）产生
  if (pw6j.indexOf('bindtap="toggleFood"') < 0 || pj6j.indexOf('markIntroduced') < 0)
    E('档案页的引入通道坏了 —— 「观察中」状态再也产生不出来（3 天观察期整个失效）')
  if (/clearRecord\s*\(/.test(fj))
    E('food-detail.js 还留着 clearRecord —— 功能已移到 profile.clearBad，这是死代码')
  // 档案页必须真的给出 bad 的解除入口（按钮 → 处理器 → removeIntroduced 三段都要在）
  if (pw6j.indexOf('bindtap="clearBad"') < 0)
    E('档案页「有反应的食材」卡没有「清除记录」按钮 —— bad 的解除通道被堵死，用户永久锁死')
  if (pj6j.indexOf('clearBad(') < 0 || pj6j.indexOf('storage.removeIntroduced') < 0)
    E('profile.js 缺 clearBad 或它没调 removeIntroduced —— 解除通道是死的（点了解除不了）')
  if (pw6j.indexOf('清除记录') < 0)
    E('档案页文案里丢了「清除记录」字样 —— 引导文案与真实入口对不上')
  // bad 引导行：按钮消失必须给解释 + 正确路径
  if (fw.indexOf('wx:if="{{status === \'bad\'}}"') < 0)
    E('详情页缺 bad 状态的解释/引导行 —— 用户不知道按钮为什么消失了、该怎么重新引入')
  if (fw.indexOf('先点「清除记录」') >= 0)
    E('详情页 bad 引导行还在教用户「先点清除记录」—— 那颗按钮已删，指引是错的')

  // 2) JS：markSafe 的 bad 分支必须是「确认弹窗 + 先解除后重标」的正路（H-2 的 v2.25 形态：
  //    允许显式重新加入，但不许绕过弹窗一键洗白；storage 层仍硬拒 bad→safe 兜底）。
  //    markBad 则必须走 markIntroduced → setIntroStatus('bad') 正路。
  const msS = fj.indexOf('markSafe()'), mbS = fj.indexOf('markBad()')
  const msBad = msS >= 0 ? fj.slice(msS, mbS > msS ? mbS : msS + 800) : ''
  if (!msBad) E('food-detail.js 缺 markSafe —— 没法标记已吃过')
  else if (!/intro\.status === 'bad'/.test(msBad)) E('markSafe 没有 bad 分支 —— 过敏食材会被直接标安全（H-2 回归）')
  else {
    if (!/wx\.showModal/.test(msBad)) E('markSafe 的 bad 分支没弹确认框 —— 一次点按就把过敏食材洗回安全（H-2 回归）')
    if (!/removeIntroduced/.test(msBad)) E('markSafe 的 bad 分支没先 removeIntroduced —— storage 会拒写，重新加入是假成功')
    const irI = msBad.indexOf('removeIntroduced'), miI = msBad.indexOf('markIntroduced')
    if (irI >= 0 && miI >= 0 && irI > miI)
      E('markSafe 的 bad 分支顺序错了 —— 必须先 removeIntroduced 解除，再 markIntroduced 重新标记')
  }
  const mbd = fj.indexOf('markBad(') >= 0 ? fj.slice(fj.indexOf('markBad(')) : ''
  if (!mbd) E('food-detail.js 缺 markBad 处理器 —— 「食物过敏」是死按钮')
  else if (!/markIntroduced\(that\.foodId\)/.test(mbd) || !/setIntroStatus\(that\.foodId,\s*'bad'\)/.test(mbd))
    E('markBad 没走 markIntroduced → setIntroStatus(bad) 正路 —— 反应食材没进永久排除')
  const guardCnt = (fj.match(/status === 'bad'/g) || []).length
  if (guardCnt < 1)
    E(`food-detail.js 的 bad 拨卫丢了（找到 ${guardCnt} 处，markSafe 至少要 1 处）`)
  if (/markObserving\s*\(/.test(fj))
    E('food-detail.js 还留着 markObserving —— 「今天第一次试」已并入档案页引入流程（§6j）')

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
    console.log('  6j 有反应不可洗白：详情页两按钮(过敏可标·重加带弹窗) ? 反向钉(清除/观察入口在档案页) ? markSafe坏分支=弹窗+先解除 ? storage 硬拒(状态/日期/返回值) ? 正常路径(→bad、解除后重引入)不误伤 ✓')
}

/* ---------- 6k. 每餐打卡（记录 → 回写引擎 → 14 天证据列表，v2.1） ----------
 * 三态打卡（full/some/refused）；有反应入口 v2.25 移到档案页「已经吃过」卡；
 * 连续拒吃 → ×0.15 软降权进指纹；档案页 14 天证据列表。各断链的后果：
 * 按钮 bindtap 冒泡 → 点打卡顺手展开步骤；指纹缺 f 段 → 打卡不触发重排，
 * 降权白算；参数没穿透 → 名单传不到 pickWeighted；标记有反应不走 bad 正路
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
  // v2.25：「有反应」入口与 reactionMeal 移到档案页「已经吃过」卡（pickBadFood）——
  // 首页不许再有，档案页不许没有（否则已确认安全的食材过敏后无法标 bad）
  if (iw.indexOf('reactionMeal') >= 0)
    E('index.wxml 又出现「有反应」入口 —— v2.25 起标记有反应在档案页「已经吃过」卡，别搬回来')
  if (iw.indexOf('catchtap="undoMealLog"') < 0) E('index.wxml 缺打卡撤销入口')
  if (ij.indexOf('logMeal(e)') < 0) E('index.js 缺 logMeal 处理器')
  if (/reactionMeal\s*\(/.test(ij))
    E('index.js 还留着 reactionMeal —— 功能已移到 profile.pickBadFood，这是死代码')
  if (ij.indexOf('undoMealLog(e)') < 0) E('index.js 缺 undoMealLog 处理器')

  // 3) 有反应：入口在档案页「已经吃过」卡（v2.25 自首页餐卡移入），且必须走
  //    markIntroduced → setIntroStatus('bad') 正路（§6j 同源）
  if (pw.indexOf('bindtap="pickBadFood"') < 0)
    E('档案页「已经吃过」卡缺「标记有反应」入口 —— 已确认安全的食材过敏后无法标 bad，会继续排进菜单')
  const pbd = pj.indexOf('pickBadFood(') >= 0 ? pj.slice(pj.indexOf('pickBadFood(')) : ''
  if (!pbd) E('profile.js 缺 pickBadFood 处理器 —— 「标记有反应」是死按钮')
  else if (!/markIntroduced\(f\.id\)/.test(pbd) || !/setIntroStatus\(f\.id,\s*'bad'\)/.test(pbd))
    E('pickBadFood 没走 markIntroduced → setIntroStatus(bad) 正路 —— 反应食材没进永久排除')

  // 4) 引擎：降权项 + 参数穿透 + planInputs 取名单 + 指纹 f 段
  if (pl.indexOf('refusedIds.indexOf(r.id) >= 0) w *= 0.15') < 0)
    E('pickWeighted 没有拒吃降权项（×0.15）—— 打卡不反哺排餐')
  if (!/pickWeighted\(mainPool, usedCount, dayMainUse, issueTags, dayCats,\s*opts\.refusedRecipeIds\)/.test(pl.replace(/\n\s*/g, ' ')))
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
    E('mine.wxml 记录行没绑 toggleRow —— 记录行还是只读统计')
  if (mw.indexOf('wx:if="{{openRow === ') < 0)
    E('mine.wxml 没有按 openRow 展开的结构 —— 点开看不到名单')
  if (mj.indexOf('toItems(') < 0 || mw.indexOf('wx:for="{{safeList}}"') < 0)
    E('行内展开的数据链断了（toItems → safeList 渲染）—— 点开是空的')
  if (mj.indexOf('goFoodDetail(e)') < 0 || mw.indexOf('bindtap="goFoodDetail"') < 0)
    E('展开的食材点不进详情页（goFoodDetail 链断）')
  // 6c′) 「正在观察中」行已从「我的记录」删掉（v2.25）：观察名单只在档案页观察卡管理，
  //       「我的」不留第二处入口，也不留算出来没人用的死数据 —— 反向钉防加回来
  if (mw.indexOf('正在观察中') >= 0 || mw.indexOf('observingList') >= 0 || mw.indexOf('observingCount') >= 0)
    E('mine.wxml 又出现「正在观察中」行 —— 观察名单入口已收归档案页观察卡，别在「我的」重复一份')
  if (mj.indexOf('observingList') >= 0 || mj.indexOf('observingCount') >= 0)
    E('mine.js 还在算 observingList/observingCount —— 行删了数据就是死代码')
  if (pj.indexOf('observing') < 0)
    E('profile.js 没有 observing 状态处理 ——「我的」删了观察行，观察名单会没有入口')
  if (pw.indexOf('观察') < 0)
    E('profile.wxml 没有观察卡 ——「我的」删了观察行，这里是观察名单的唯一入口')
  // 6c″) 「查看本周计划」快捷入口已删（v2.25）：底部导航本就有「计划」tab，
  //       「我的」再放一份是重复入口；goPlan 处理器也一并删（留着是死代码）
  if (mw.indexOf('查看本周计划') >= 0 || mj.indexOf('goPlan(') >= 0)
    E('mine 又出现「查看本周计划」/ goPlan —— 底部已有「计划」tab，重复入口不该回来')
  // 6c‴) 「食材查一查」快捷入口已删（v2.25）：查一查页从底部 tab 进就够了；
  //       goFood 处理器与 .link-row 规则一并删（留着是死代码/死样式）
  if (mw.indexOf('食材查一查') >= 0 || mj.indexOf('goFood(') >= 0)
    E('mine 又出现「食材查一查」/ goFood —— 快捷入口已移除，别加回来')
  if (/\.link-row\s*\{/.test(fs.readFileSync('./pages/mine/mine.wxss', 'utf8')))
    E('mine.wxss 还有 .link-row 规则 —— 快捷入口卡已删，这是死样式')

  // 6d) 档案页保留的有反应卡（编辑语境下的管理入口，与「我的」行互为双保险）
  if (pj.indexOf('badFoods') < 0)
    E('profile.js 没建 badFoods —— 有反应的食材在档案页没有落点')
  if (pj.indexOf('return it.status === \'bad\'') < 0)
    E('badFoods 没按 status===bad 过滤 —— 观察中/安全的食材会混进有反应卡')
  if (pj.indexOf('goFoodDetail(e)') < 0)
    E('profile.js 缺 goFoodDetail 处理器 —— 有反应卡点不进详情页（看反应详情断链）')
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
    console.log('  6k 每餐打卡：三态按钮(catchtap)+撤销 ? 有反应入口在档案页+bad 正路 ? 降权×0.15 穿透+指纹f段 ? checkable闸 ? 记录中枢(我的3行+行内展开+有反应行，观察行已移出) ? 14天喂养记录在「我的」 ? 档案页有反应卡+挪干净 ? 规则真跑(2次进/1次不进/窗外不算/吃过即解除/撤销/指纹联动) ✓')
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
  // 反向：「有反应」按钮已随 reactionMeal 移到档案页（v2.25），首页不许再留死样式
  if (ruleOf('ml-btn-react'))
    E('index.wxss 还留着 .ml-btn-react —— 按钮已移到档案页，这是死样式')

  if (errs.length === errsBefore)
    console.log('  6l 视觉基线：.card 阴影唯一+alpha≤0.1 ✓、今天日期=计划页唯一 display(40/600) ✓、基础日期 fs-sm ✓、三档 baseline ✓、打卡行 min-height96≥88+flex居中 ✓、state/undo 同高+行盒撑满 ✓')
}

/* ---------- 6m. 重排窗口与新食材槽位（v2.6 · P2 修复） ----------
 * 两条不变量：
 *   1. 隐式重排（输入指纹变了）：窗口不得前移；「≤今天**且有打卡**」的日子
 *      整段照抄 —— 打卡按 date|recipeId 落库，重排后 recipeId 不在新计划里，
 *      计划页的打卡行凭空消失（数据还在「我的」14 天记录里，但「哪一餐吃了没」
 *      对不上了）；**没打卡的已过日子必须按当前规则重排**（v2.10 自愈：
 *      旧引擎时代的错误行要能变回 6 月固定菜单内容，不用用户手动重新生成）。
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
  if (!/generateFromStorage\(storage,\s*plan\.replanOpts\(p,\s*storage\.getMealLogs\(\)\)\)/.test(idxJs1))
    E('index.js 的隐式重算没走 plan.replanOpts + storage.getMealLogs —— P2 回归（打卡行消失）或冻结名单缺失（旧计划的错误行无法自愈）')
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
    // v2.25 · 方案A：引擎一个引入槽都不排 —— 反向钉。旧口径「每周恒 2 个、
    // 全在工作日、彼此隔 ≥3 天」已随自动排期删除；3 天观察间距改由
    // storage.OBSERVE_DAYS 承担（档案页观察卡 + 首页到期提醒）。
    if (idxs.length !== 0)
      E(`6m ${label}：引擎仍排了 ${idxs.length} 个新食材槽 —— 引入已改走档案页，计划里不该出现 day.newFood`)
  }

  // —— 3) 冻结：窗口不前移；有打卡的日子整段照抄、没打卡的按当前规则重排 ——
  try {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - 2) // 让窗口里有 3 个「已发生」的日子（含今天）
    const p1 = plan.generate(mk({ startDate: start }))
    const todayK = plan.dateKey(new Date())

    if (plan.replanOpts(null, []) !== null || plan.replanOpts({}, []) !== null)
      E('replanOpts 对空计划没有返回 null —— 会把 undefined 当计划用')

    const past = p1.days.filter((d) => d.date <= todayK)
    const loggedDates = past.length ? [{ date: past[0].date }] : [{ date: todayK }] // 只给最早的过去日打卡
    const opts = plan.replanOpts(p1, loggedDates)
    if (!opts) {
      E('6m replanOpts 对「仍覆盖今天」的计划返回 null —— 冻结机制没生效（窗口会重置回今天）')
    } else {
      if (opts.startDate !== p1.startDate)
        E('6m replanOpts 没沿用旧计划的起始日 —— 窗口会前移（P2）')
      const frozenQ = opts.frozenDays.map((d) => d.date)
      if (frozenQ.length !== 1 || frozenQ[0] !== loggedDates[0].date)
        E(`6m replanOpts 冻结了 [${frozenQ}]，应只冻结「≤今天且有打卡」的 [${loggedDates[0].date}]`)
      if (past.some((d) => d.date !== loggedDates[0].date && frozenQ.indexOf(d.date) >= 0))
        E('6m 把没打卡的已过日子也冻结了 —— 旧计划的错误行永远修不回来（自愈通道被堵死）')
      if (opts.frozenDays.some((d) => d.date > todayK))
        E('6m 把未来的日子也冻结了 —— 计划从此不再更新，降权和新输入全部失效')

      const p2 = plan.generate(mk({ startDate: opts.startDate, frozenDays: opts.frozenDays }))
      if (p2.startDate !== p1.startDate)
        E(`6m 重排后起始日 ${p1.startDate} → ${p2.startDate} —— 窗口前移（P2）`)
      p2.days.forEach((d, i) => {
        if (!p1.days[i] || d.date !== p1.days[i].date)
          E(`6m 重排后第 ${i} 天日期错位（${(p1.days[i] || {}).date} → ${d.date}）`)
      })
      // 有打卡的冻结日：整段照抄（打卡行 + 新食材观察都不能动）
      opts.frozenDays.forEach((d) => {
        const nd = p2.days.filter((x) => x.date === d.date)[0]
        if (!nd) return
        if (JSON.stringify(nd.meals) !== JSON.stringify(d.meals))
          E(`6m ${d.date}（已打卡的日子）被重排了 —— 这天的打卡行会从计划页消失（P2）`)
        if (JSON.stringify(nd.newFood) !== JSON.stringify(d.newFood))
          E(`6m ${d.date}（已打卡的日子）的新食材尝试被改了 —— 观察记录与计划对不上`)
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
      opts.frozenDays.forEach((d) => d.meals.forEach((m) => {
        const r = recipes.filter((x) => x.id === m.recipeId)[0]
        if (!r) return
        r.mainFoods.concat(r.sideFoods || []).forEach((fid) => {
          if (!shopCount[fid]) E(`6m 采购清单漏了 ${fid} —— 冻结日的用量没计进 foodUse`)
        })
      }))
    }

    // —— 3b) 自愈钉（v2.10）：没打卡的旧引擎行，升级后第一次隐式重算
    //      必须变成 6 月固定菜单；打了卡的照旧冻结（打卡链路 > 菜单）——
    //      这正是「第 1、2 天应为强化铁米粉糊 2.5g+水40ml」的端到端保证 ——
    const nowD = new Date()
    // 生日锚到 28 号以内：+6 个月永远同月同日（避开月末 JS 月份归一化），
    // 于是今天恒落在菜单日 1..30 内，任何一天跑本脚本都成立
    const birthStr = plan.dateKey(new Date(nowD.getFullYear(), nowD.getMonth() - 6, Math.min(nowD.getDate(), 28)))
    const md = plan.menuDayOf(birthStr, todayK)
    const base6m = {
      months: 6, issues: [], sick: false,
      safeFoodIds: foods.map((f) => f.id), blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
    }
    if (md < 1 || md > 30) {
      E(`6m 自愈钉：menuDayOf(${birthStr}, ${todayK}) = ${md}，应落在 1..30 —— 测试生日算错了`)
    } else {
      const entry = plan.MENU_6[md]
      // 旧计划：同月龄但没有 birth（旧引擎随机行，含水果加餐）
      const legacyP = plan.generate(Object.assign({}, base6m, { startDate: start }))
      if (!legacyP) E('6m 自愈钉：旧引擎（无 birth）6 月龄生成失败')
      const healOpts = plan.replanOpts(legacyP, []) // 一次打卡都没有 → 全部允许重排
      if (!healOpts) {
        E('6m 自愈钉：replanOpts 对未打卡、仍覆盖今天的计划返回 null')
      } else {
        const healed = plan.generate(Object.assign({}, base6m, {
          birth: birthStr, startDate: healOpts.startDate, frozenDays: healOpts.frozenDays
        }))
        const td = (healed && healed.days || []).filter((d) => d.date === todayK)[0]
        if (!td) E(`6m 自愈钉：重排后的计划不含今天 ${todayK}`)
        else {
          const meal = (td.meals || [])[0]
          const want = entry.base.replace(/^\S+\s/, '') // 「谷物 2.5g+水40ml」→「2.5g+水40ml」
          if (!meal || meal.name !== '强化铁米粉糊')
            E(`6m 自愈钉：${todayK}（菜单日 ${md}）正餐是「${meal ? meal.name : '空'}」，没自愈成固定菜单的强化铁米粉糊`)
          else if (!(meal.steps || []).some((s) => s.indexOf(want) >= 0))
            E(`6m 自愈钉：${todayK} 步骤缺菜单用量「${want}」—— 旧计划没按固定菜单重排`)
          if (md < plan.MENU_6_SNACK_START && td.snack)
            E(`6m 自愈钉：菜单日 ${md} < 19 还排了加餐「${td.snack.name}」—— 水果泥应 6+19 起才出现`)
          if (md >= plan.MENU_6_SNACK_START && !td.snack)
            E(`6m 自愈钉：菜单日 ${md} ≥ 19 却没有水果加餐 —— 15:00 加餐没接上`)
        }
      }
      // 反向：这天打了卡 → 旧引擎行必须原样保留（打卡链路优先于菜单锁定）
      const legacy2 = plan.generate(Object.assign({}, base6m, { startDate: start }))
      const opts2 = plan.replanOpts(legacy2, [{ date: todayK }])
      if (!opts2 || opts2.frozenDays.length !== 1 || opts2.frozenDays[0].date !== todayK)
        E('6m 自愈钉：今天有打卡却没被冻结 —— 打卡行会被重排掉（P2 回归）')
      else {
        const back = plan.generate(Object.assign({}, base6m, {
          birth: birthStr, startDate: opts2.startDate, frozenDays: opts2.frozenDays
        }))
        const fd = (back && back.days || []).filter((d) => d.date === todayK)[0]
        const ld = (legacy2.days || []).filter((d) => d.date === todayK)[0]
        if (fd && ld && JSON.stringify(fd.meals) !== JSON.stringify(ld.meals))
          E('6m 自愈钉：已打卡的今天没照抄旧计划 —— 打卡行会从计划页消失（P2 回归）')
      }
    }

    // 窗口过期（整份计划都在过去）→ 没有可冻结的日子，照旧整份重来
    const oldStart = new Date()
    oldStart.setHours(0, 0, 0, 0)
    oldStart.setDate(oldStart.getDate() - 10)
    const expired = plan.generate(mk({ startDate: oldStart }))
    if (plan.replanOpts(expired, []) !== null)
      E('6m 对「窗口不覆盖今天」的计划仍返回冻结选项 —— 旧计划会被原样拖着走')
  } catch (e) {
    E('§6m 函数级断言执行异常：' + e.message)
  }

  if (errs.length === errsBefore)
    console.log('  6m 重排窗口与新食材槽位：隐式重算走 replanOpts+「重新生成」不冻结 ✓、引擎零引入槽（引入全在档案页，反向钉）✓、有打卡照抄+没打卡自愈成固定菜单(强化铁米粉糊+菜单用量) ✓、窗口不前移 ✓、采购清单覆盖冻结日 ✓')
}

/* ---------- 6n. 视觉层级与品牌面（v2.7 · 视觉改版 ①②③④⑥） ----------
 * 每条都锁「改了数据没接线 / 改了样式没数据」的半截工程：
 *   1. 品牌浅绿 token 在，且正文/次级/辅助/琥珀墨/绿深在它上面全部现算过 WCAG AA。
 *   2. 顶部信息卡与今天卡双向接上这个面（wxml ↔ wxss），阴影仍只由 .card 提供。
 *   3. 折叠链路闭环：openDay 状态 → toggleDay 事件 → 展开条件（今天短路）
 *      → refresh 与 regenerate 双处复位 → 今天有 guard 不脏状态。
 *   4. 观察进度点：markToday 按「引入日 = day.date」现算，wxml 两处都绑。
 *   5. 字重三档：标题系 600（首页与「我的」的 head 同档，§6f 的字号钉不动）。
 *   6. 展开动效 .fx-in/关键帧在，且只挂用户点开的节点；箭头有 transition。
 */
{
  const errsBefore = errs.length
  const app = fs.readFileSync('./app.wxss', 'utf8')
  const ix = fs.readFileSync('./pages/index/index.wxss', 'utf8')
  const iw = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ij = fs.readFileSync('./pages/index/index.js', 'utf8')
  const ij1 = ij.replace(/\n\s*/g, ' ')
  const mW = fs.readFileSync('./pages/mine/mine.wxss', 'utf8')
  const mIW = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')
  const fdW = fs.readFileSync('./pages/food-detail/food-detail.wxss', 'utf8')

  // WCAG 现算（与 §6g 同算法；各自作用域各起一份，不跨段引用）
  const lum = (hex) => {
    const v = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
  }
  const ratio = (a, b) => {
    // 与顺序无关：WCAG 取「亮者在分子」—— 暗字在亮底上是 (bg+0.05)/(fg+0.05)
    const la = lum(a)
    const lb = lum(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }

  // —— 1) 品牌浅绿 token + 对比度现算 ——
  const tintM = app.match(/--c-green-tint:\s*(#[0-9a-f]{6})/i)
  if (!tintM) {
    E('app.wxss 缺 --c-green-tint token —— 品牌面没根（v2.7 ③ 白做）')
  } else {
    const tint = tintM[1]
    ;[
      ['正文 #2c2c2a', '#2c2c2a'],
      ['次级 #5f5e5a', '#5f5e5a'],
      ['辅助 #6f6e6a', '#6f6e6a'],
      ['琥珀墨 #633806', '#633806'],
      ['绿深 #3b6d11（阶段 tag）', '#3b6d11']
    ].forEach(([name, fg]) => {
      const r = ratio(fg, tint)
      if (r < 4.5)
        E(`品牌浅绿 ${tint} 上的 ${name} 对比度 ${r.toFixed(1)}:1 < 4.5:1（AA 不达标）`)
    })
    const bgM = app.match(/--c-bg:\s*(#[0-9a-f]{6})/i)
    if (bgM && bgM[1].toLowerCase() === tint.toLowerCase())
      E('--c-green-tint 与 --c-bg 同色 —— 品牌面在页面底色上看不出来')
  }

  // —— 2) 接线：顶部品牌卡 / 今天卡主面，阴影仍唯一 ——
  if (!/\.card--brand\s*\{[^}]*background:\s*var\(--c-green-tint\)/.test(app))
    E('app.wxss 的 .card--brand 没铺 var(--c-green-tint) —— 顶部品牌面没接上')
  if (iw.indexOf('card card--brand') < 0)
    E('index.wxml 顶部信息卡没挂 card--brand —— ③ 是死样式（wxml↔wxss 断链）')
  if (!/\.day-card--today\s*\{[^}]*background:\s*var\(--c-green-tint\)/.test(ix))
    E('index.wxss 的 .day-card--today 没铺品牌浅绿 —— 今天卡没有主角面（①/③ 断链）')
  const brandRule = app.match(/\.card--brand\s*\{[^}]*\}/)
  if (brandRule && /box-shadow/.test(brandRule[0]))
    E('.card--brand 自带 box-shadow —— 阴影必须仍由 .card 一处提供（§6l）')
  // 琥珀文字 AA 修复（③ 配套）：--c-amber 当正文白底只有 3.85:1
  ;['head-issue', 'cat-warn'].forEach((cls) => {
    const m = ix.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*color:\\s*([^;}]+)'))
    if (!m || m[1].trim() !== 'var(--c-amber-ink)')
      E(`index.wxss 的 .${cls} 文字色不是 var(--c-amber-ink) —— --c-amber 当正文 AA 不达标（3.85:1）`)
  })

  // —— 3) 折叠链路闭环 ——
  if (iw.indexOf('openDay === day.date') < 0)
    E('index.wxml 没读 openDay —— 折叠/展开链路断了（① 白做）')
  if (iw.indexOf('bindtap="toggleDay"') < 0)
    E('index.wxml 天卡头部没绑 toggleDay —— 折叠摘要点不开')
  if (!/toggleDay\(e\) \{/.test(ij))
    E('index.js 缺 toggleDay 处理 —— wxml 绑了事件但 JS 没有')
  const tdAt = ij.indexOf('toggleDay(e) {')
  const tdSlice = tdAt >= 0 ? ij.slice(tdAt, tdAt + 400) : ''
  if (tdSlice.indexOf('plan.dateKey(new Date())') < 0)
    E('toggleDay 没挡今天 —— 点今天卡头部会把 openDay 写成今天的日期（脏状态）')
  if (ij1.indexOf("base.openDay = ''") < 0)
    E('refresh 没复位 openDay —— 重排后残留的展开态会指向不存在的日期')
  const regenAt2 = ij.indexOf('regenerate() {')
  const regenSlice2 = regenAt2 >= 0 ? ij.slice(regenAt2) : ''
  if (regenSlice2.indexOf("openDay: ''") < 0)
    E('regenerate 没复位 openDay —— 重新生成后旧展开态残留')
  if (iw.indexOf('wx:if="{{day.isToday || openDay === day.date}}"') < 0)
    E('展开条件没用 day.isToday 短路 —— 「今天恒展开」的语义没了')
  // 折叠摘要只留 餐数·类数（v2.10 用户要求：不再出现「N 段」）—— 正向钉新格式 + 反向钉段数已删
  if (iw.indexOf('{{day.meals.length}} 餐 · {{day.catCount}} 类') < 0)
    E('折叠摘要缺 餐数·类数 —— 折叠把覆盖信息弄丢了')
  if (iw.indexOf('段 · {{day.meals.length}}') >= 0)
    E('折叠摘要还在显示「N 段」—— 段数已按用户要求从计划页删掉')
  if (iw.indexOf('day.total > day.done') < 0 || ij.indexOf('d.done = done') < 0)
    E('「待打卡 N」链路断了（wxml 没读 day.total/day.done，或 js 没算）')

  // —— 4) 观察进度点已随方案A搬进档案页：首页一个入口都不许剩 ——
  if (ij.indexOf('newFood.dots') >= 0 || iw.indexOf('day.newFood.dots') >= 0)
    E('首页仍在算/绑观察进度（dots/progText）—— 观察已搬进档案页，这里是残留死代码')
  if (ij.indexOf('function dayDiff') >= 0)
    E('index.js 还留着 dayDiff —— 它只被已删的观察进度用，是孤儿函数')

  // —— 5) 字重三档：标题系 600 ——
  const wOf = (css, cls) => {
    const m = css.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*font-weight:\\s*([^;}]+)'))
    return m ? m[1].trim() : null
  }
  ;[
    [app, 'card-title', 'app.wxss'],
    [ix, 'head-name', 'index.wxss'],
    [ix, 'head-age', 'index.wxss'],
    [ix, 'day-week', 'index.wxss'],
    [ix, 'meal-name', 'index.wxss'],
    [ix, 'empty-title', 'index.wxss'],
    [mW, 'head-name', 'mine.wxss'],
    [mW, 'head-age', 'mine.wxss'],
    [fdW, 'fd-name', 'food-detail.wxss']
  ].forEach(([css, cls, from]) => {
    const w = wOf(css, cls)
    if (w !== '600')
      E(`${from} 的 .${cls} 字重是 ${w} 而非 600 —— 字重三档（②）没落地`)
  })

  // —— 6) 展开动效与箭头过渡 ——
  if (!/\.fx-in\s*\{[^}]*animation:\s*fxIn/.test(app) || !/@keyframes\s+fxIn\s*\{/.test(app))
    E('app.wxss 缺 .fx-in 或 @keyframes fxIn —— 展开动效（⑥）没根')
  if (iw.indexOf('meal-steps fx-in') < 0)
    E('index.wxml 餐步骤展开没挂 fx-in')
  if (iw.indexOf('guide-body fx-in') < 0)
    E('index.wxml 6 月龄指南展开没挂 fx-in')
  if (iw.indexOf("openDay === day.date ? 'fx-in'") < 0)
    E('index.wxml 折叠天展开没挂 fx-in —— 或没限制在用户点开的节点上（今天会变入场动画）')
  if (mIW.indexOf('row-detail fx-in') < 0)
    E('mine.wxml 记录展开没挂 fx-in')
  ;[['.guide-arrow', ix], ['.day-arrow', ix], ['.link-arrow', mW]].forEach(([sel, css]) => {
    const m = css.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{[^}]*'))
    if (!m || !/transition:\s*transform/.test(m[0]))
      E(`${sel} 没有 transition: transform —— 箭头旋转（⑥）没有过渡，等于瞬间跳变`)
  })
  if (app.indexOf('.link-arrow-open {') < 0 || ix.indexOf('link-arrow-open') < 0 || mIW.indexOf('link-arrow-open') < 0)
    E('link-arrow-open 共享修饰类断链（app.wxss 必须定义，index/mine 必须使用）')

  if (errs.length === errsBefore)
    console.log('  6n 视觉层级与品牌面：品牌浅绿对比度现算 AA ✓、顶卡/今天卡双向接线 ✓、openDay 折叠闭环（今天 guard + 双复位）✓、观察进度已移出首页（反向钉）✓、字重三档 600 ✓、展开动效与箭头过渡 ✓')
}

/* ---------- 6o. 餐次标签与步骤用量（v2.7 · ① 配套） ----------
 * 克数从餐次行的灰字下沉到步骤详情、质地与类别变小标签随菜名 ——
 * 每条都锁「半截工程」：
 *   1. recipes.js：步骤里写 {分类} 占位符 —— 占位符必须属于该菜 amount 的分类，
 *      且 amount 的每个分类都必须有占位符（否则原来灰字行的克数就丢了）。
 *   2. plan.js：fillPortions 按当期档位真填数 —— 对 67 道菜 × 两个月龄档实跑，
 *      填完的步骤不许残留花括号，每段分量值都必须出现在文本里。
 *   3. 页面接线：meal.cats 算出来 + wxml 绑上 + 灰字行 .meal-meta 拆干净；
 *      计划结构版本 sv 有 bump 与失效入口（旧缓存不重算就一直渲染旧结构）。
 */
{
  const errsBefore = errs.length
  const iw = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ix = fs.readFileSync('./pages/index/index.wxss', 'utf8')
  const ij = fs.readFileSync('./pages/index/index.js', 'utf8')
  const pj = fs.readFileSync('./utils/plan.js', 'utf8')
  const fdj = fs.readFileSync('./pages/food-detail/food-detail.js', 'utf8')

  const catsOf = (s) => String(s || '').split('，').map((seg) => seg.trim().split(' ')[0]).filter(Boolean)

  // —— 1) recipes.js 占位符完整性（静态，逐菜） ——
  let tokTotal = 0
  recipes.forEach((r) => {
    const tag = `recipes ${r.id}`
    const c7 = catsOf(r.amount['7-12'])
    const c13 = catsOf(r.amount['13-24'])
    if (c7.join() !== c13.join())
      E(`${tag} 两档 amount 分类不一致（${c7} vs ${c13}）—— 同一份步骤没法两档通用`)
    const text = (r.steps || []).join('\n')
    const tokens = (text.match(/\{([^{}]+)\}/g) || []).map((t) => t.slice(1, -1))
    tokTotal += tokens.length
    tokens.forEach((t) => {
      if (t === '倍粥') return // v2.25 {倍粥} 是月龄占位符（非分类克数），按月龄填当档倍数
      if (c7.indexOf(t) < 0)
        E(`${tag} 步骤占位符 {${t}} 不在 amount 分类 [${c7}] 里 —— 填不出数，会渲染成空`)
    })
    c7.forEach((c) => {
      if (tokens.indexOf(c) < 0)
        E(`${tag} 的分类「${c}」没有任何占位符 —— 原灰字行的克数在详情里丢了`)
    })
    const braces = (text.match(/[{}]/g) || []).length
    if (braces !== tokens.length * 2)
      E(`${tag} 步骤里有不成对的花括号 —— 半截改写，填数会留残渣`)
  })
  if (tokTotal < recipes.length)
    E(`全部菜谱只有 ${tokTotal} 个占位符 —— 用量下沉没做实（每道菜至少 1 个）`)

  // —— 2) fillPortions 实跑：两档 × 全部菜谱 ——
  if (typeof plan.fillPortions !== 'function' || typeof plan.amountForStage !== 'function')
    E('plan 没导出 fillPortions/amountForStage —— 食材详情页拿不到填数能力')
  else {
    ;[9, 18].forEach((months) => {
      recipes.forEach((r) => {
        const amountStr = plan.amountForStage(r, months)
        const filled = plan.fillPortions(r.steps, amountStr, months)
        const text = filled.join('\n')
        if (/[{}]/.test(text))
          E(`${r.id}（${months} 月龄档）填数后仍残留花括号: ${text.match(/\{[^}]*\}?/g)}`)
        if (filled.length !== (r.steps || []).length)
          E(`${r.id} fillPortions 步骤条数变了 —— 不是 1:1 映射`)
        // 信息等价：amount 每段的分量值都必须出现在文本里（克数下沉，不能丢）
        String(amountStr || '').split('，').forEach((seg) => {
          const value = seg.trim().split(' ').slice(1).join(' ')
          if (value && text.indexOf(value) < 0)
            E(`${r.id}（${months} 月龄档）分量「${value}」没出现在填好的步骤里 —— 克数丢了`)
        })
      })
    })
    // 档位敏感性：同一道菜两档必须填出不同的数（写死文案的假实现过不了这条）
    const oat = recipes.find((r) => r.id === 'r_oat_banana')
    if (oat) {
      const t9 = plan.fillPortions(oat.steps, plan.amountForStage(oat, 9), 9).join('\n')
      const t18 = plan.fillPortions(oat.steps, plan.amountForStage(oat, 18), 18).join('\n')
      if (t9.indexOf('20–30g') < 0 || t18.indexOf('30–50g') < 0)
        E(`燕麦香蕉糊两档没填出各自的克数（9 月应含 20–30g、18 月应含 30–50g）: "${t9}" / "${t18}"`)
      if (t9 === t18)
        E('燕麦香蕉糊两档填数结果相同 —— 档位没生效，等于把克数写死了')
    }
  }

  // —— 3) 真生成计划：meal.cats + 填好的步骤 + 结构版本 ——
  ;[9, 18].forEach((months) => {
    const pg = plan.generate({ months: months, issues: [], safeFoodIds: [], recordedFoodIds: [], observingCount: 0 })
    if (!pg) { E(`plan.generate({months:${months}}) 返回 null —— §6o 没法实跑`); return }
    if (pg.sv !== plan.STRUCT_V)
      E(`计划没带上 sv: STRUCT_V（实际 ${pg.sv}，期望 ${plan.STRUCT_V}）—— 缓存失效判断无从比对`)
    ;(pg.days || []).forEach((day) => {
      (day.meals || []).forEach((meal) => {
        if (!Array.isArray(meal.cats) || !meal.cats.length)
          E(`${meal.name} 的 cats 缺失/为空 —— 餐次行小标签没数据（wxml↔js 断链）`)
        else if (catsOf(meal.amount).join() !== meal.cats.join())
          E(`${meal.name} 的 cats ${meal.cats} 与 amount「${meal.amount}」解析不一致 —— 两处解析器要同口径`)
        const text = (meal.steps || []).join('\n')
        if (/[{}]/.test(text))
          E(`${meal.name} 生成到计划里还带花括号 —— 步骤没经过 fillPortions: ${text.match(/\{[^}]*\}?/g)}`)
        String(meal.amount || '').split('，').forEach((seg) => {
          const value = seg.trim().split(' ').slice(1).join(' ')
          if (value && text.indexOf(value) < 0)
            E(`${meal.name} 的分量「${value}」不在计划步骤里 —— 克数下沉到详情链路断了`)
        })
      })
    })
  })

  // —— 4) 页面接线（静态） ——
  if (iw.indexOf('wx:for="{{row.meal.cats}}"') < 0)
    E('index.wxml 没渲染餐次行的类别标签 —— 类别标签没接上（数据算了不显示）')
  if (iw.indexOf('meal-meta') >= 0)
    E('index.wxml 还有 meal-meta —— 旧的「质地 · 克数」灰字行没拆干净')
  if (ix.indexOf('.meal-meta') >= 0)
    E('index.wxss 还有 .meal-meta 规则 —— 死样式')
  const mmRule = ix.match(/\.meal-main\s*\{[^}]*\}/)
  if (!mmRule || !/align-items:\s*baseline/.test(mmRule[0]))
    E('.meal-main 没有 align-items: baseline —— 标签与菜名不对齐（① 没做实）')
  const mtRule = ix.match(/\.meal-tag\s*\{[^}]*\}/)
  if (!mtRule || !/margin:\s*0/.test(mtRule[0]))
    E('.meal-tag 没把全局 .tag 的 margin 清零 —— flex + gap 下间距会翻倍')
  if ((iw.match(/tag tag-grey meal-tag/g) || []).length < 2)
    E('index.wxml 质地标签或类别标签循环没挂 tag-grey meal-tag —— 小标签样式没接上')
  if (pj.indexOf('catsFromAmount(amountStr)') < 0 || pj.indexOf('fillPortions(recipe.steps, amountStr, months)') < 0)
    E('plan.js 的 meal 构建没接 catsFromAmount/fillPortions —— 餐次标签与步骤填数是死代码')
  if (!/sv:\s*STRUCT_V/.test(pj))
    E('plan.generate 返回里没有 sv: STRUCT_V —— 结构版本没写进计划')
  if (ij.indexOf('p.sv !== plan.STRUCT_V') < 0)
    E('index.js refresh 的失效条件没比对 sv —— 升级后旧缓存一直渲染旧结构（标签/克数全缺）')
  if (fdj.indexOf('plan.fillPortions(r.steps, plan.amountForStage(r, months), months)') < 0)
    E('food-detail.js 没按宝宝月龄档填步骤占位符 —— 食材详情页会露出 {谷物} 原文')

  if (errs.length === errsBefore)
    console.log(`  6o 餐次标签与步骤用量：${recipes.length} 道菜占位符全闭合且分类全覆盖 ✓、两档 × 全菜实跑无残留且克数不丢 ✓、档位敏感（20–30g vs 30–50g）✓、生成计划带 cats+填好步骤+sv ✓、灰字行拆净与四端接线 ✓`)
}

/* ---------- 6p. v2.8 公开月龄资料融入：分月龄知识卡 + 6 月卡补充 + 菜谱层知识 ----------
 * 六组新卡（7/8/9/10/11/12 月龄，每月龄一组）：data/guides.js 导出 → index.js 按月龄
 * 挑一组挂 guideLater → WXML 与 6 月龄卡互斥渲染；展开态复用 sixOpen/toggleGuide6 ——
 * 卡 key 跨组撞了会串组。内容钉的是两份公开资料的独有知识点（喂养量、2:1:1、粥倍数、
 * 蛋黄渐进、1→3 勺加量、错峰排敏、每天蛋黄、盐 1.5g、油与水果克数……）：
 * 数据文件删一条页面照常渲染，属于「静默丢失」，必须显式钉。
 * 菜谱层：蛋黄泥写分次渐进；凡步骤里熬稠粥的菜必须带 {倍粥} 占位符（月龄→米水比随月龄变，
 * 写死一种会指错月龄），渲染时按月龄只出当档倍数；新菜式 = 海报点名的蒸糕与馒头（手抓食物，不加新食材）；
 * 蒸蛋羹的菜池月龄必须 ≤9 —— 9 月龄卡承诺了「蒸蛋羹可以开始安排」。
 */
{
  const errsBefore = errs.length
  const gm = require('./data/guides')
  const iw = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ij = fs.readFileSync('./pages/index/index.js', 'utf8')
  const rcs = fs.readFileSync('./data/recipes.js', 'utf8')

  // 1) 三组导出且结构合法；卡 key 跨全部分组唯一（sixOpen 按 key 存展开态）
  const keyOwner = {}
  ;['tooYoung', 'sixMonth'].forEach((gname) => {
    ;(gm[gname] || []).forEach((c) => { if (c && c.key) keyOwner[c.key] = gname })
  })
  const GROUPS = [['sevenMonth', '7 月龄'], ['eightMonth', '8 月龄'], ['nineMonth', '9 月龄'],
    ['tenMonth', '10 月龄'], ['elevenMonth', '11 月龄'], ['twelveMonth', '12 月龄']]
  GROUPS.forEach(([g, label]) => {
    const arr = gm[g]
    if (!Array.isArray(arr) || arr.length < 2) {
      E(`guides.js 没导出 ${g}（${label}知识卡，至少「喂养要点 + 注意事项」两张）`)
      return
    }
    arr.forEach((c) => {
      if (!c.key) return E(`${g} 有卡缺 key —— 按 key 存展开态会互相覆盖`)
      if (keyOwner[c.key]) E(`${g}.${c.key} 的 key 撞了 ${keyOwner[c.key]} —— sixOpen 按 key 存展开态，撞了会展开串组`)
      keyOwner[c.key] = g
      const ic = c.icon
      if (typeof ic !== 'string' || !ic || /\s/.test(ic) || [...ic].length > 4)
        E(`${g}.${c.key} 的 icon 非法：${JSON.stringify(ic)}`)
      if (!/^#[0-9a-f]{6}$/i.test(c.iconBg || ''))
        E(`${g}.${c.key} 的 iconBg 不是 6 位 hex：${c.iconBg}`)
      if (!c.title) E(`${g}.${c.key} 没有 title`)
      if (!c.points && !c.lines) E(`${g}.${c.key} 既没有 points 也没有 lines —— 卡是空的`)
      if (c.points && (!Array.isArray(c.points) || c.points.some((p) => !p.title || !p.text)))
        E(`${g}.${c.key} 的 points 段里有空 title/text —— 会渲染出空段落`)
      if (c.lines && (!Array.isArray(c.lines) || c.lines.some((l) => typeof l !== 'string' || !l.trim())))
        E(`${g}.${c.key} 的 lines 里有空行 —— 会渲染出空的 .guide-line`)
    })
  })

  // 2) 首页接线：按月龄选组（六档闸门）→ 挂进 data → WXML 渲染并复用展开交互
  ;['months >= 7 && months < 8', 'months >= 8 && months < 9', 'months >= 9 && months < 10',
    'months >= 10 && months < 11', 'months >= 11 && months < 12', 'months === 12'].forEach((gt) => {
    if (ij.indexOf(gt) < 0) E(`index.js 缺「${gt}」的选组闸门 —— 这个年龄段挂不到知识卡`)
  })
  if (!/guideLater\s*=\s*months\s*>=\s*7/.test(ij))
    E('index.js 没按月龄挑组赋给 guideLater —— 卡数据没有来源（死数据）')
  if (!/guideLater:\s*guideLater/.test(ij))
    E('index.js 选好的组没挂进 data.guideLater —— WXML 的 wx:for 拿不到卡')
  if (iw.indexOf('wx:for="{{guideLater}}"') < 0)
    E('index.wxml 没渲染 guideLater —— 数据配了页面不显示')
  else {
    const glb = iw.indexOf('wx:for="{{guideLater}}"')
    const seg = iw.slice(Math.max(0, glb - 700), glb + 900)
    ;['guideLater.length', 'toggleGuide6', 'sixOpen[g.key]', 'guide-arrow'].forEach((b) => {
      if (seg.indexOf(b) < 0) E(`guideLater 卡没绑 ${b} —— 互斥渲染/展开/箭头有断链`)
    })
  }
  // 6 月龄卡的闸门不能被这次改动带坏（§6i 也钉，这里双保险）
  if (iw.indexOf('months >= 6 && months < 7') < 0)
    E('6 月龄闸门丢了 —— 7 月龄会看到「第一口辅食」')

  // 3) 海报知识点内容钉（分组钉：防「渲染正常但内容被删」）
  const CT = [
    ['sevenMonth', [
      [/700[–-]800/, '奶量 700–800ml'], [/2\s*[:：]\s*1\s*[:：]\s*1/, '主食:菜:肉 = 2:1:1'],
      [/10 倍粥/, '10 倍粥基准'], [/榨汁/, '不榨汁、果汁不能代替水果'], [/转奶/, '转奶期不加新辅食'],
      [/小颗粒/, '7 月龄小颗粒性状'], [/错峰/, '新食物错峰添加'], [/没有固定的顺序/, '辅食没有固定顺序']
    ]],
    ['eightMonth', [
      [/8 倍粥/, '8 倍粥'], [/1\s*[/／]\s*8/, '蛋黄 1/8 起步渐进'], [/红肉/, '每天红肉'],
      [/动物肝脏/, '每周 1–2 次肝脏'], [/不强迫/, '不强迫进食'],
      [/碎碎面/, '以粥和碎碎面为主'], [/一捏就烂/, '蔬菜条手指食物（一捏就烂）'], [/50[–-]80g/, '水果 50–80g']
    ]],
    ['nineMonth', [
      [/700[–-]800/, '奶量 700–800ml'], [/7 倍粥/, '9 月龄 7 倍粥'], [/蒸蛋羹/, '蒸蛋羹可以安排'],
      [/果汁/, '果汁不能代替水果'], [/清洁牙齿/, '乳牙萌出清洁牙齿'], [/条状/, '条状 → 块状进阶']
    ]],
    ['tenMonth', [
      [/600[–-]700/, '奶量 600–700ml'], [/6 倍粥/, '10 月龄 6 倍粥'], [/每天一个蛋黄/, '每天一个蛋黄'],
      [/小馄饨/, '主食花样（小馄饨/面疙瘩）'], [/勺子/, '练习用勺子舀着吃']
    ]],
    ['elevenMonth', [
      [/600[–-]700/, '奶量 600–700ml'], [/4 倍粥/, '11 月龄 4 倍粥'], [/软米饭/, '软米饭可以开始'],
      [/大颗粒/, '向大颗粒、块状过渡'], [/分开安排/, '辅食和奶分开安排']
    ]],
    ['twelveMonth', [
      [/1\.5/, '每天盐不超过 1.5g'], [/包子/, '丰富种类（包子饺子）'], [/同步/, '三餐与大人同步'],
      [/独立进食/, '引导独立进食'], [/600ml/, '奶量 600ml 左右']
    ]]
  ]
  CT.forEach(([g, list]) => {
    const all = JSON.stringify(gm[g] || [])
    list.forEach(([re, what]) => {
      if (!re.test(all)) E(`${g} 组丢了知识点「${what}」—— 海报内容被删但页面照常渲染（静默丢失）`)
    })
  })

  // 4) 6 月龄卡的海报补充：冲泡比例 / 过敏症状清单 / 午后水果 / 早期红肉 / 叶菜剁碎
  //    v2.10 用户删掉「加量节奏」「饮食卫生」两段 → 原钉的 1 勺、菜泥不超米糊一半作废；
  //    空格改 \s* 容错 —— 文案里的排版空格不该让自检卡死
  const six = JSON.stringify(gm.sixMonth || [])
  ;[[/50\s*ml/, '冲泡 50ml 温水'], [/30\s*秒/, '静置 30 秒'], [/嘴边/, '过敏症状（嘴边发红）'],
    [/肛周/, '过敏症状（肛周发红）'], [/午后/, '水果午后吃'], [/红肉/, '尽早加红肉'],
    [/剁碎/, '叶菜剁碎不用打泥']]
    .forEach(([re, what]) => {
    if (!re.test(six)) E(`sixMonth 补充丢了「${what}」—— 公开资料的要点没写进去`)
  })

  // 5) 菜谱层：蛋黄渐进 / 倍粥占位符按月龄出当档 / 新菜式
  const eggY = rids['r_egg_yolk_paste']
  if (!eggY) E('蛋黄泥 r_egg_yolk_paste 不见了')
  else {
    const s = JSON.stringify(eggY.steps)
    if (!/1\s*[/／]\s*4/.test(s) || !/1\s*[/／]\s*2/.test(s))
      E('蛋黄泥步骤丢了渐进量（1/4 → 1/2）—— 蛋黄分次引入的知识点没落进步骤')
    if (!/整个蛋黄/.test(s)) E('蛋黄泥步骤没写「逐步到整个蛋黄」—— 渐进终点丢了')
  }
  // 凡步骤里出现「稠粥」的菜，必须写 {倍粥} 占位符 —— 米水比随月龄变，写死一种会指错月龄；
  // 且不许把「8 倍粥起，9 月龄 7 倍粥、…」整段阶梯硬编码回原文（那会把别的月龄的倍数
  // 一起显示给眼前的宝宝），渲染时按月龄只出当前那一档
  recipes.forEach((r) => {
    (r.steps || []).forEach((s) => {
      if (!/稠粥/.test(s)) return
      if (!/\{倍粥\}/.test(s))
        E(`${r.id} 步骤里有「稠粥」但没有 {倍粥} 占位符 —— 粥的米水比随月龄变，写死一种会指错月龄`)
      if (/倍粥起|月龄\s*\d+\s*倍粥/.test(s))
        E(`${r.id} 步骤把倍粥阶梯硬编码进原文 —— 会把其它月龄的倍数一起显示出来（应写 {倍粥}）`)
    })
  })
  if ((rcs.match(/\{倍粥\}/g) || []).length < 7)
    E('菜谱里的 {倍粥} 占位符不足 7 处 —— 粥底类菜谱的稠度阶梯没落全')
  // 按月龄只出当档：9 月龄只见 7 倍粥、11 月龄起只见 4 倍粥，旧档倍数不许跟着一起出
  const porr = recipes.filter((r) => (r.steps || []).some((s) => /\{倍粥\}/.test(s)))
  if (porr.length) {
    const pr = porr[0]
    ;[[8, '8 倍粥'], [9, '7 倍粥'], [10, '6 倍粥'], [11, '4 倍粥']].forEach(([m, want]) => {
      const t = plan.fillPortions(pr.steps, plan.amountForStage(pr, m), m).join('\n')
      const others = ['8 倍粥', '7 倍粥', '6 倍粥', '4 倍粥'].filter((x) => x !== want)
      if (t.indexOf(want) < 0)
        E(`${m} 月龄填出的步骤里没有「${want}」—— 倍粥阶梯没按月龄填（${t}）`)
      const leaked = others.filter((x) => t.indexOf(x) >= 0)
      if (leaked.length)
        E(`${m} 月龄填出的步骤里混进了 ${leaked.join('、')} —— 只应显示当档倍数（${t}）`)
    })
  }
  ;[['r_steam_cake', '蔬菜蒸糕', ['wheat_flour', 'egg_whole']],
    ['r_steam_bun', '南瓜小馒头', ['wheat_flour']]].forEach(([id, name, allergs]) => {
    const r = rids[id]
    if (!r) return E(`海报菜式 ${name}（${id}）没进菜谱库`)
    if (r.monthRange[0] > 9)
      E(`${id} 起始月龄 ${r.monthRange[0]} —— 海报 9 月龄起给手指食物，起晚了就错过抓握练习窗口`)
    if (r.tags.indexOf('手抓食物') < 0)
      E(`${id} 缺「手抓食物」标签 —— 这两道就是海报点名的抓握/咀嚼练习菜`)
    if (!/抓/.test(JSON.stringify(r.steps)))
      E(`${id} 步骤里没有「自己抓着吃」的写法 —— 手指食物的关键做法丢了`)
    allergs.forEach((fid) => {
      if ((r.allergens || []).indexOf(fid) < 0) E(`${id} 致敏主料 ${fid} 没登记进 allergens`)
    })
  })
  // 9 月龄卡承诺「蒸蛋羹可以开始安排」→ 菜池里的蒸蛋羹必须真能排进 9 月龄
  const cust = rids['r_broccoli_egg_custard']
  if (!cust) E('西兰花蒸蛋羹不见了 —— 9 月龄卡承诺了蒸蛋羹')
  else if (cust.monthRange[0] > 9)
    E(`r_broccoli_egg_custard 起始月龄 ${cust.monthRange[0]} —— 9 月龄卡说蒸蛋羹可以安排，菜池却排不进去（建议落不了地）`)

  if (errs.length === errsBefore)
    console.log('  6p 公开月龄资料融入：六组卡(导出→六档选组闸门→挂 data→互斥渲染→key 不撞) ✓、两份资料知识点分组在 ✓、6 月卡补充(冲泡/症状/午后水果…) ✓、蛋黄渐进与 {倍粥} 按月龄只出当档 ✓、蒸糕+小馒头(手抓/致敏登记) ✓、9 月蒸蛋羹承诺↔菜池联动 ✓')
}

/* ---------- 6q. 时段锚点与正/加餐分槽（v2.9） ----------
 * 依据：docs/月度辅食计划-存档.md 固定菜单的逐月时间轴 + 用户三问决策
 * （方案A 含奶参考行 / 按各月龄实际列数 / 10–11月改2餐、12月起3餐）。
 * 钉子：
 *   1) 餐次按月龄：6→1、7–11→2、12–24→3（7月2餐同时对齐7月知识卡「每天2次」）
 *   2) 各月龄时段模板：列数、main/snack/milk 槽数、时刻轴，
 *      main 槽数 === mealsForMonth === 每天实际正餐数
 *   3) 分槽：正餐位零加餐类（水果泥/糕饼不占正餐位）、加餐位必须是加餐类、
 *      加餐行与正餐行同构（cats/克数/步骤齐）
 *   4) 加餐计入当日类别（6 月龄 catNames 必含『水果』）、catApplicable 8 月起为 true
 *   5) 页面接线：timeline 派生、奶行不打卡、时段头 chip、样式与折叠摘要
 *   5b) 时段头同行样式：不渲染时段名、时刻在菜名前、chip 在小标签后、
 *        「辅食 + 奶」与菜名同行且右缘对齐「时段参考」列
 *   6) 冻结日的加餐行照抄保留（打卡按 date|recipeId 落库，丢行即断链）
 */
{
  const errsBefore = errs.length

  // 1) 餐次 pin（决策③ + 7月知识卡口径）
  const MEALS_PIN = { 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 3, 15: 3, 24: 3 }
  Object.keys(MEALS_PIN).forEach((m) => {
    const got = age.mealsForMonth(+m)
    if (got !== MEALS_PIN[m])
      E(`age.mealsForMonth(${m}) = ${got}，期望 ${MEALS_PIN[m]}（决策③：10–11月2餐、12月起3餐；7月2餐对齐知识卡）`)
  })

  // 2) 各月龄时段模板 = 固定菜单实际列（6/7/8–9 六列、10–11 五列、12+ 四段）
  const SLOT_PIN = {
    6:  { total: 6, mains: 1, snacks: 1, milks: 4, times: ['07:00', '10:00', '13:00', '15:00', '16:00', '19:00'] },
    7:  { total: 6, mains: 2, snacks: 1, milks: 3, times: ['07:00', '10:00', '13:00', '15:30', '17:00', '19:00'] },
    8:  { total: 6, mains: 2, snacks: 1, milks: 3, times: ['07:00', '10:00', '13:00', '15:30', '17:00', '19:00'] },
    10: { total: 5, mains: 2, snacks: 1, milks: 2, times: ['07:00', '10:00', '13:00', '15:30', '18:00'] },
    12: { total: 4, mains: 3, snacks: 1, milks: 0, times: ['07:00', '11:00', '15:00', '18:00'] },
    18: { total: 4, mains: 3, snacks: 1, milks: 0, times: ['07:00', '11:00', '15:00', '18:00'] },
    24: { total: 4, mains: 3, snacks: 1, milks: 0, times: ['07:00', '11:00', '15:00', '18:00'] }
  }
  const rmap = {}
  recipes.forEach((r) => { rmap[r.id] = r })
  Object.keys(SLOT_PIN).forEach((mStr) => {
    const m = +mStr
    const pin = SLOT_PIN[mStr]
    const slots = age.slotsForMonth(m)
    const cnt = (k) => slots.filter((s) => s.kind === k).length
    if (slots.length !== pin.total)
      E(`${m} 月龄时段槽数 ${slots.length}，期望 ${pin.total}（固定菜单实际列数，决策②）`)
    if (cnt('main') !== pin.mains || cnt('snack') !== pin.snacks || cnt('milk') !== pin.milks)
      E(`${m} 月龄 main/snack/milk 槽 = ${cnt('main')}/${cnt('snack')}/${cnt('milk')}，期望 ${pin.mains}/${pin.snacks}/${pin.milks}`)
    if (cnt('main') !== age.mealsForMonth(m))
      E(`${m} 月龄 main 槽数 ${cnt('main')} 与 mealsForMonth ${age.mealsForMonth(m)} 不一致 —— 时段与餐次脱钩`)
    if (slots.map((s) => s.time).join() !== pin.times.join())
      E(`${m} 月龄时刻轴 ${slots.map((s) => s.time).join('/')}，期望 ${pin.times.join('/')}`)

    const p = plan.generate({
      months: m, issues: [], safeFoodIds: foods.map((f) => f.id),
      blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
    })
    if (!p) { E(`plan.generate({months:${m}}) 返回 null`); return }
    if (!p.slots || !p.slots.length) E(`${m} 月龄计划没带 slots 时段锚点`)
    if (p.mealsPerDay !== age.mealsForMonth(m))
      E(`${m} 月龄计划 mealsPerDay=${p.mealsPerDay}，期望 ${age.mealsForMonth(m)}`)
    p.days.forEach((d) => {
      if (!d.meals || d.meals.length !== pin.mains)
        E(`${m} 月龄 ${d.date} 正餐 ${d.meals ? d.meals.length : 0} 餐，期望 ${pin.mains}（与模板 main 槽数一致）`)
      // 3) 分槽：正餐位零加餐类 + 行同构
      ;(d.meals || []).forEach((meal) => {
        const r = rmap[meal.recipeId]
        if (r && plan.isSnackRecipe(r))
          E(`${m} 月龄 ${d.date} 正餐位出现加餐类菜「${meal.name}」—— 水果泥/糕类不占正餐位`)
        if (!Array.isArray(meal.cats) || !meal.cats.length)
          E(`「${meal.name}」缺 cats —— 餐次行构造口径不一致`)
        if (!Array.isArray(meal.steps) || !meal.steps.length)
          E(`「${meal.name}」缺填好克数的 steps`)
      })
      if (d.snack) {
        const r = rmap[d.snack.recipeId]
        if (r && !plan.isSnackRecipe(r))
          E(`${m} 月龄 ${d.date} 加餐位排了非加餐类菜「${d.snack.name}」`)
        if (!Array.isArray(d.snack.cats) || !d.snack.cats.length || !d.snack.steps || !d.snack.steps.length)
          E(`${m} 月龄 ${d.date} 加餐行不完整（cats/steps）—— 加餐行必须与正餐行同构`)
      } else {
        E(`${m} 月龄 ${d.date} 没排加餐 —— 加餐池不应为空（水果泥/糕饼均可用）`)
      }
      if (m >= 8 && !d.catApplicable)
        E(`${m} 月龄 catApplicable 应为 true（8 月起才该作硬要求）`)
    })
    // 4) 加餐计入当日类别：6 月龄正餐 1 餐，唯一稳定的『水果』只能来自加餐
    if (m === 6) {
      p.days.forEach((d) => {
        if ((d.catNames || []).indexOf('水果') < 0)
          E(`6 月龄 ${d.date} catNames 缺『水果』—— 加餐没计入当日类别覆盖`)
      })
    }
  })

  // 5) 页面与引擎接线（源码钉）
  const aj = fs.readFileSync('./utils/age.js', 'utf8')
  const pj = fs.readFileSync('./utils/plan.js', 'utf8')
  const ijQ = fs.readFileSync('./pages/index/index.js', 'utf8')
  const iwQ = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const wsQ = fs.readFileSync('./pages/index/index.wxss', 'utf8')
  if (aj.indexOf('function mealsForMonth') < 0 || aj.indexOf('function slotsForMonth') < 0)
    E('age.js 缺 mealsForMonth / slotsForMonth —— 餐次与时段锚点没有事实源')
  if (aj.indexOf('刚起步，一天 1–2 餐') < 0)
    E('puree 阶段 desc 没跟上 7 月 2 餐（描述与计划打架）')
  // 结构版本用下界而不是逐字钉死：v2.10 冻结语义 = 5，v2.25 方案A（newFood
  // 恒 null + 挂载函数删除）= 6。下次再 bump 不必回来改这句话。
  const svM = /STRUCT_V\s*=\s*(\d+)/.exec(pj)
  if (!svM || +svM[1] < 6)
    E(`STRUCT_V 是 ${svM ? svM[1] : '缺失'}，应 ≥ 6 —— v2.25·方案A 没触发旧缓存重算，会一直渲染旧结构`)
  if (pj.indexOf('function isSnackRecipe') < 0 || pj.indexOf('const snackPool =') < 0)
    E('plan.js 缺加餐分池实现（isSnackRecipe / snackPool）')
  if (ijQ.indexOf('d.timeline = rows') < 0)
    E('markToday 没生成 day.timeline —— 时段渲染无数据源')
  if (ijQ.indexOf('p.slots || age.slotsForMonth') < 0)
    E('markToday 没读 plan.slots（旧计划兜底缺失）')
  if (ijQ.indexOf('if (d.snack) markLog(d.snack)') < 0)
    E('markToday 没给加餐行挂打卡态 —— 加餐没法打卡')
  if (ijQ.indexOf('d.snack ? 1 : 0') < 0)
    E('day.total 没把加餐算进待打卡 —— 「待打卡 N」少数一个')
  if (iwQ.indexOf('wx:for="{{day.timeline}}"') < 0)
    E('index.wxml 没按 day.timeline 渲染时段')
  if (iwQ.indexOf('slot-kind') < 0 || iwQ.indexOf('辅食 + 奶') < 0)
    E('时段头缺正/加餐 chip 或「辅食 + 奶」标注')
  if (wsQ.indexOf('.milk-row') < 0 || wsQ.indexOf('.slot-head') < 0 || wsQ.indexOf('.slot-kind.snack') < 0)
    E('index.wxss 缺时段样式（.milk-row / .slot-head / .slot-kind.snack）')
  // —— 5b) 时段头同行样式（v2.9 样式修订，用户四点）——
  // ① 时段名不渲染（删「上午正餐」）② 时刻排在菜名前面且同行
  // ③ 正/加餐 chip 排在质地/类别小标签之后 ④「辅食 + 奶」与菜名同一行头、
  //   右缘与上下奶行「时段参考」同列（奶盒内边距 24rpx），且与菜名行共基线
  if (iwQ.indexOf('slot-name') >= 0 || iwQ.indexOf('row.label') >= 0)
    E('时段头还在渲染时段名 —— 样式修订要求删掉「上午正餐」那截')
  if (wsQ.indexOf('.slot-name') >= 0)
    E('index.wxss 还有 .slot-name 规则 —— 死样式')
  const shAt = iwQ.indexOf('class="slot-head"')
  const shEnd = shAt >= 0 ? iwQ.indexOf('<view class="meal"', shAt) : -1
  const shSeg = shAt >= 0 && shEnd > shAt ? iwQ.slice(shAt, shEnd) : ''
  if (!shSeg) E('index.wxml 缺时段头（.slot-head）或结构改了没同步钉子')
  else {
    const stAt = shSeg.indexOf('slot-time')
    const mnAt = shSeg.indexOf('meal-name')
    if (mnAt < 0 || stAt < 0) E('时段头缺时刻或菜名 —— 时刻与菜名必须同在一行')
    else if (stAt > mnAt) E('时刻没排在菜名前面 —— 要求 10:00 在「强化铁米粉糊」前面且对齐')
    const tgAt = shSeg.indexOf('meal-tag')
    const kdAt = shSeg.indexOf('slot-kind')
    if (tgAt >= 0 && kdAt >= 0 && kdAt < tgAt)
      E('正/加餐 chip 没排在质地/类别小标签后面 —— 要求 chip 放在细泥/谷物之后')
    if (shSeg.indexOf('辅食 + 奶') < 0)
      E('「辅食 + 奶」不在时段头内 —— 要求与菜名同行、与上下「时段参考」对齐')
  }
  const swmRule = wsQ.match(/\.slot-withmilk\s*\{[^}]*\}/)
  if (!swmRule || !/margin-right:\s*24rpx/.test(swmRule[0]))
    E('.slot-withmilk 缺 margin-right:24rpx ——「辅食 + 奶」与奶行「时段参考」右缘对不齐（奶盒内边距 24rpx）')
  const shRule = wsQ.match(/\.slot-head\s*\{[^}]*\}/)
  if (!shRule || !/align-items:\s*baseline/.test(shRule[0]))
    E('.slot-head 没有 align-items: baseline ——「辅食 + 奶」与菜名行不在同一基线')
  // 奶参考行：只标时段，不排菜不打卡（方案A 的边界就在这里）
  const milkAt = iwQ.indexOf('class="milk-row"')
  if (milkAt < 0) E('index.wxml 缺奶参考行（方案A 含奶时段）')
  else {
    const elseAt = iwQ.indexOf('<block wx:else>', milkAt)
    const milkSeg = iwQ.slice(milkAt, elseAt >= 0 ? elseAt : milkAt + 800)
    if (milkSeg.indexOf('logMeal') >= 0 || milkSeg.indexOf('checkable') >= 0 || milkSeg.indexOf('toggleMeal') >= 0)
      E('奶参考行带了打卡/展开入口 —— 奶行只标时段，不可交互排菜')
    if (milkSeg.indexOf('时段参考') < 0)
      E('奶参考行缺「时段参考」标注')
    if (milkSeg.indexOf('{{row.time}}') < 0)
      E('奶参考行没渲染时刻')
  }

  // —— 5c) 方案A（v2.25）：主餐成卡保留，新食材观察条随「引擎停排」移除 ——
  // 反向钉：首页一个新食材渲染入口都不许剩。留着的话观察信息会在计划页与档案页
  // 重复出现，而且计划页那份永远停在「○○○」—— 引擎已经不喂数据了。
  if (iwQ.indexOf('class="meal-card"') < 0)
    E('index.wxml 缺主餐卡（.meal-card）包装 —— 主餐没成卡')
  const mealAt = iwQ.indexOf('<view class="meal"')
  const mealSeg = mealAt >= 0 ? iwQ.slice(mealAt, mealAt + 2400) : ''
  if (!mealSeg) E('index.wxml 缺 <view class="meal"> —— 结构改了没同步钉子')
  else {
    if (mealSeg.indexOf('class="nfstrip"') >= 0 || mealSeg.indexOf('row.meal.newFood') >= 0)
      E('主餐卡内仍挂着新食材观察条（.nfstrip / row.meal.newFood）—— 观察已搬进档案页，这里是残留')
    if (mealSeg.indexOf('newfood-dots') >= 0 || mealSeg.indexOf('newfood-prog-text') >= 0)
      E('主餐卡内仍有 ●○○ 观察进度 —— 进度已由档案页观察卡接管')
  }
  if (iwQ.indexOf('day.newFood && !day.newFoodAttached') >= 0)
    E('顶部独立新食材卡还在（newFoodAttached 兜底闸）—— 引擎不再产出 day.newFood，这张卡永不渲染')
  if (ijQ.indexOf('plan.attachNewFood(') >= 0)
    E('markToday 仍在调 plan.attachNewFood( —— 该函数已随方案A删除，调它会直接抛错')
  if (pj.indexOf('function attachNewFood') >= 0 || pj.indexOf('attachNewFood:') >= 0)
    E('plan.js 里 attachNewFood 还活着 —— 没有任何 day.newFood 可挂，是死代码')
  const mcRule = wsQ.match(/\.meal-card\s*\{[^}]*\}/)
  if (!mcRule || !/background:\s*var\(--c-card\)/.test(mcRule[0]) || !/border:/.test(mcRule[0]))
    E('.meal-card 缺白底/描边 —— 白卡 vs 白底只差 1.5%，主餐卡立不住')
  if (!/\.day-card--today \.meal-card\s*\{[^}]*border-left:\s*3rpx solid var\(--c-green\)/.test(wsQ))
    E('今天没有主餐卡绿边条（.day-card--today .meal-card）—— 今天主角缺视觉锚')
  if (/\.nfstrip\s*\{/.test(wsQ))
    E('.nfstrip 样式还在 —— 观察条已删，这是没人引用的孤儿规则')
  const mcSwm = wsQ.match(/\.meal-card \.slot-withmilk\s*\{[^}]*\}/)
  if (!mcSwm || !/margin-right:\s*0/.test(mcSwm[0]))
    E('.meal-card 内 .slot-withmilk 没归零 —— 卡内右缘多出 24rpx，与「时段参考」列错位')
  // 功能钉：真跑一份 6 月菜单计划 —— 逐日确认 day.newFood 恒 null、餐行也没挂、
  // newFoodAttached 字段不再产生（attachNewFood 已删，挂载无从发生）。
  try {
    const nC = new Date()
    const bC = plan.dateKey(new Date(nC.getFullYear(), nC.getMonth() - 6, Math.min(nC.getDate(), 28)))
    const pC = plan.generate({
      months: 6, birth: bC, issues: [], sick: false,
      safeFoodIds: foods.map((f) => f.id), blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
    })
    if (!pC) E('5c 功能钉：6 月菜单计划生成失败')
    else pC.days.forEach((d) => {
      if (d.newFood) E(`5c ${d.date} 仍在产出 day.newFood —— 引入已改走档案页（方案A）`)
      if (d.newFoodAttached) E(`5c ${d.date} 仍标 newFoodAttached —— 该字段随 attachNewFood 一起删了`)
      const rows = (d.meals || []).concat(d.snack ? [d.snack] : [])
      rows.forEach((m) => {
        if (m.newFood) E(`5c ${d.date} 餐行仍挂 newFood —— 会渲染出永远停在第一天的悬空观察条`)
      })
    })
  } catch (e) {
    E('§6q 5c 功能断言执行异常：' + e.message)
  }

  // 6) 冻结日的加餐行照抄保留（隐式重排：打卡按 date|recipeId，丢行即断链）
  const startPast = plan.dateKey(new Date(Date.now() - 3 * 86400000))
  const oq = {
    months: 9, issues: [], safeFoodIds: foods.map((f) => f.id),
    blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
  }
  const g1 = plan.generate(Object.assign({}, oq, { startDate: startPast }))
  const g2 = plan.generate(Object.assign({}, oq, { startDate: g1.startDate, frozenDays: g1.days }))
  if (g1 && g2) {
    const todayKeyQ = plan.dateKey(new Date())
    g1.days.forEach((d, i) => {
      if (d.date > todayKeyQ) return // 未来日允许重排，只查已冻结的
      if (g2.days[i].date !== d.date) { E(`冻结日错位：${d.date} vs ${g2.days[i].date}`); return }
      if (g2.days[i].snack !== d.snack)
        E(`冻结日 ${d.date} 的加餐行没照抄保留 —— 已打卡的加餐会从计划里凭空消失`)
    })
  } else E('6q 冻结日测试：plan.generate 返回 null')

  if (errs.length === errsBefore)
    console.log('  6q 时段锚点与正/加餐分槽：餐次按月龄(6→1/7–11→2/12→3) ✓、各月龄列数与时刻轴 ✓、main槽=餐次 ✓、正餐位零加餐类 ✓、加餐行同构+计入类别 ✓、奶行不可打卡 ✓、冻结日加餐保留 ✓、timeline 接线与样式 ✓、时段头同行四点(无时段名/时刻前置/chip后置/右列对齐) ✓、主餐成卡 ✓、首页新食材渲染入口反向钉 ✓')
}

/* ---------- 6r. 6–7 月强化铁米粉固定口径（v2.9 · ③） ----------
 * 用量直接引用固定菜单（月龄表，本地存档不入库 → 把值逐字钉进断言）：
 *   6 月 5g+水50ml、7 月 10g+水70ml；8 月起回通用档（菜单 8 月起米粉只是
 *   混合菜配料、没有单独用量行）。
 * 月内节奏承接（v2.9 · ④ 后升级）：6 月已由 MENU_6 菜单锁定逐日入计划
 *   （见 §6s，含起步阶梯与菜泥/肉泥 1→2→3 勺）；7 月计划仍是整月龄稳态值，
 *   末 3 天升量由 7 月卡承接 15g+水80ml。
 * 口径统一：冲泡静置与 6 月卡一致（30 秒，原步骤「1 分钟」撤掉）。
 * 钉子：① amountForStage 实跑四个月龄 ② 固定值经 {谷物} 真填进步骤
 *   ③ 静置口径 ④ 计划实跑：6/7 月排到的每餐米粉都必须是固定值
 *   ⑤ 卡承接文案 + 源码（monthAmount 分支与逐字值）
 */
{
  const errsBefore = errs.length
  const rice = recipes.find((r) => r.id === 'r_rice_cereal')
  const F6 = '谷物 5g+水50ml'
  const F7 = '谷物 10g+水70ml'
  if (!rice) E('r_rice_cereal 不见了 —— 6–7 月固定口径无从谈起')
  else {
    // 1) amountForStage 实跑：6/7 = 固定菜单值（逐字），8/9/18 = 通用档不被泄漏
    if (plan.amountForStage(rice, 6) !== F6)
      E(`6 月龄米粉用量「${plan.amountForStage(rice, 6)}」≠ 固定菜单「${F6}」—— 用量没直接引用固定菜单`)
    if (plan.amountForStage(rice, 7) !== F7)
      E(`7 月龄米粉用量「${plan.amountForStage(rice, 7)}」≠ 固定菜单「${F7}」`)
    if (plan.amountForStage(rice, 8) !== '谷物 20–30g')
      E(`8 月龄米粉应回通用档「谷物 20–30g」—— 固定口径只管 6–7 月（实际 ${plan.amountForStage(rice, 8)}）`)
    if (plan.amountForStage(rice, 9) !== '谷物 20–30g' || plan.amountForStage(rice, 18) !== '谷物 30–50g')
      E(`米粉通用档串了（9 月 ${plan.amountForStage(rice, 9)}、18 月 ${plan.amountForStage(rice, 18)}）—— monthAmount 覆盖泄漏到别的月龄`)

    // 2) 固定值必须经 {谷物} 占位符真的填进步骤（克数下沉链路对固定值同样成立）
    ;[[6, '5g+水50ml'], [7, '10g+水70ml']].forEach(([m, v]) => {
      const t = plan.fillPortions(rice.steps, plan.amountForStage(rice, m), m).join('\n')
      if (/[{}]/.test(t)) E(`${m} 月龄米粉步骤填数后残留花括号: ${t}`)
      if (t.indexOf(v) < 0) E(`${m} 月龄米粉固定用量「${v}」没填进步骤 —— 固定菜单口径没落到眼前`)
    })

    // 3) 静置口径统一：与 6 月卡「静置 30 秒」一致，旧「1 分钟」撤净
    const st6r = (rice.steps || []).join('\n')
    if (st6r.indexOf('静置 30 秒') < 0) E('米粉步骤缺「静置 30 秒」—— 与 6 月卡冲泡口径不统一')
    if (/静置\s*1\s*分钟/.test(st6r)) E('米粉步骤仍写「静置 1 分钟」—— 同一碗粉两种口径')

    // 4) 真生成计划：6/7 月排到的每一餐米粉都必须是固定值（跑到见到为止，防断言空转）
    ;[[6, F6], [7, F7]].forEach(([m, expectAmt]) => {
      let hits = 0
      for (let rep = 0; rep < 30 && hits === 0; rep++) {
        const pg6r = plan.generate({
          months: m, issues: [], safeFoodIds: foods.map((f) => f.id),
          blockedFoodIds: [], recordedFoodIds: [], observingCount: 0
        })
        if (!pg6r) { E(`plan.generate({months:${m}}) 返回 null`); break }
        pg6r.days.forEach((day) => {
          (day.meals || []).forEach((meal) => {
            if (meal.recipeId !== rice.id) return
            hits++
            if (meal.amount !== expectAmt)
              E(`${m} 月龄 ${day.date} 米粉用量「${meal.amount}」≠ 固定菜单「${expectAmt}」`)
            if ((meal.cats || []).join() !== '谷物')
              E(`${m} 月龄 ${day.date} 米粉 cats「${(meal.cats || []).join('/')}」≠ 谷物 —— 固定用量串没按分类口径解析`)
            const text = (meal.steps || []).join('\n')
            if (text.indexOf(expectAmt.slice(3)) < 0)
              E(`${m} 月龄 ${day.date} 米粉计划步骤没带固定用量「${expectAmt.slice(3)}」`)
            if (/[{}]/.test(text)) E(`${m} 月龄 ${day.date} 米粉计划步骤残留花括号 —— 没走 fillPortions`)
          })
        })
      }
      if (!hits) E(`${m} 月龄 30 轮生成都没排到强化铁米粉 —— §6r 断言空转（菜池可疑）`)
    })
  }

  // 5) 知识卡承接月内节奏 + 源码钉
  const gm6 = require('./data/guides')
  const six6r = JSON.stringify(gm6.sixMonth || [])
  const sev6r = JSON.stringify(gm6.sevenMonth || [])
  ;[[/2\.5g/, '起步阶梯 2.5g'], [/40ml/, '起步水量 40ml'],
    [/5g\+水\s*60ml/, '第 4–6 天 5g+水60ml'], [/5g\+水\s*50ml/, '第 7 天起 5g+水50ml'],
    [/核桃油\s*2\s*滴/, '第 7 天起核桃油 2 滴']]
    .forEach(([re, what]) => { if (!re.test(six6r)) E(`sixMonth 缺「${what}」—— 固定菜单的起步阶梯没承接`) })
  ;[[/10g\+水 70ml/, '7 月固定用量 10g+水70ml'], [/15g\+水 80ml/, '7 月末 3 天升量 15g+水80ml']]
    .forEach(([re, what]) => { if (!re.test(sev6r)) E(`sevenMonth 缺「${what}」—— 固定菜单的月内节奏没承接`) })

  const pj6r = fs.readFileSync('./utils/plan.js', 'utf8')
  const rj6r = fs.readFileSync('./data/recipes.js', 'utf8')
  if (pj6r.indexOf('recipe.monthAmount') < 0)
    E('plan.js amountForStage 缺 monthAmount 分支 —— 固定用量实现被回退')
  if (rj6r.indexOf("monthAmount: { 6: '谷物 5g+水50ml', 7: '谷物 10g+水70ml' }") < 0)
    E('recipes.js 缺 6/7 月 monthAmount，或值与固定菜单不逐字一致')

  if (errs.length === errsBefore)
    console.log('  6r 6–7 月强化铁米粉固定口径：6→5g+水50ml、7→10g+水70ml（逐字引用固定菜单）✓、8 月起回通用档 ✓、{谷物} 占位符填数 ✓、静置 30 秒统一 ✓、6 月卡起步阶梯+7 月卡末 3 天升量承接 ✓、计划实跑钉 ✓')
}

/* ---------- 6s. 6 月主食固定菜单锁定（v2.9 · ④ 用户决策） ----------
 * 用户口径：「6月份主食安排请严格参照固定食谱，第20天之前15:00加餐都为空白，
 * 第20天之后加入水果加餐（重新生成计划只修改水果加餐）」。
 * 菜单口径（存档节奏要点原文）：「水果泥从 6+19 起加入 15:00」—— 用户说的
 * 「第20天」按菜单取 19（严格参照固定食谱优先）；MENU_6 三十天逐日值逐字断言。
 * 钉子：① MENU_6 逐日 base+加料逐字钉（30 天全量）+ menuDayOf 锚点 ② 计划实跑：
 *   正餐恒为米粉+当日菜单用量、步骤带用量、menuDay<19 无加餐（15:00 空白）、
 *   ≥19 有水果加餐且计入类别 ③ 加料类别进 cats 与采购清单 ④ 有反应剔加料、
 *   病中/观察中剔未记录加料且不出新食材卡 ⑤ 新食材卡由菜单加料派生
 *   （1→2→3 勺跟菜单、油脂不进卡、前 3 天为米粉）⑥ 重新生成只改水果
 *   （正餐逐字相同、水果有变化）⑦ 生日进指纹 ⑧ 6 月卡承接 + 源码钉
 */
{
  const errsBefore = errs.length
  const rice6s = recipes.find((r) => r.id === 'r_rice_cereal')
  const rmap6s = {}
  recipes.forEach((r) => { rmap6s[r.id] = r })
  const allIds6s = foods.map((f) => f.id)

  // 0) 导出与常量
  if (!plan.MENU_6 || typeof plan.menuDayOf !== 'function')
    E('plan.js 缺 MENU_6 / menuDayOf 导出 —— 6 月固定菜单没有事实源')
  if (plan.MENU_6_SNACK_START !== 19)
    E(`MENU_6_SNACK_START = ${plan.MENU_6_SNACK_START}，期望 19 —— 菜单节奏要点「水果泥从 6+19 起加入 15:00」`)
  if (!rice6s) E('r_rice_cereal 不见了 —— 6 月固定菜单锁定无从谈起')

  // 1) MENU_6 三十天逐字钉（base + 加料 label 拼出完整用量串）
  const M6_PIN = {
    1: '谷物 2.5g+水40ml', 2: '谷物 2.5g+水40ml', 3: '谷物 2.5g+水40ml',
    4: '谷物 5g+水60ml', 5: '谷物 5g+水60ml', 6: '谷物 5g+水60ml',
    7: '谷物 5g+水50ml+核桃油2滴', 8: '谷物 5g+水50ml+核桃油2滴', 9: '谷物 5g+水50ml+核桃油2滴',
    10: '谷物 5g+水50ml+土豆泥1勺', 11: '谷物 5g+水50ml+土豆泥2勺', 12: '谷物 5g+水50ml+土豆泥3勺',
    13: '谷物 5g+水50ml+胡萝卜泥1勺', 14: '谷物 5g+水50ml+胡萝卜泥2勺', 15: '谷物 5g+水50ml+胡萝卜泥3勺',
    16: '谷物 5g+水50ml+猪肉泥1勺', 17: '谷物 5g+水50ml+猪肉泥2勺', 18: '谷物 5g+水50ml+猪肉泥3勺',
    19: '谷物 5g+水50ml+菠菜泥1勺',
    20: '谷物 5g+水50ml+菠菜泥2勺+猪肉泥2勺', 21: '谷物 5g+水50ml+菠菜泥3勺+猪肉泥3勺',
    22: '谷物 5g+水50ml+南瓜泥1勺', 23: '谷物 5g+水50ml+南瓜泥2勺', 24: '谷物 5g+水50ml+南瓜泥3勺',
    25: '谷物 5g+水50ml+牛肉泥1勺', 26: '谷物 5g+水50ml+牛肉泥2勺', 27: '谷物 5g+水50ml+牛肉泥3勺',
    28: '谷物 5g+水50ml+西兰花泥1勺',
    29: '谷物 5g+水50ml+西兰花泥2勺+牛肉泥2勺', 30: '谷物 5g+水50ml+西兰花泥3勺+牛肉泥3勺'
  }
  const m6amt = (md) => {
    const e = plan.MENU_6 && plan.MENU_6[md]
    if (!e) return null
    return e.base + (e.add || []).map((a) => '+' + a.label).join('')
  }
  Object.keys(M6_PIN).forEach((k) => {
    if (m6amt(+k) !== M6_PIN[k])
      E(`MENU_6 第 ${k} 天用量「${m6amt(+k)}」≠ 固定菜单「${M6_PIN[k]}」—— 主食没严格按固定食谱`)
  })
  if (plan.menuDayOf('2026-01-01', '2026-07-01') !== 1)
    E(`menuDayOf 锚点算错：2026-01-01 生日的 2026-07-01 应为菜单第 1 天（实际 ${plan.menuDayOf('2026-01-01', '2026-07-01')}）`)
  if (plan.menuDayOf('2026-01-01', '2026-07-30') !== 30)
    E(`menuDayOf 边界算错：2026-01-01 生日的 2026-07-30 应为菜单第 30 天（实际 ${plan.menuDayOf('2026-01-01', '2026-07-30')}）`)

  // 2) 生日锚点 + 计划实跑（窗口 = 今天起 7 天，用 birthOn 把「今天」钉到指定菜单日）
  const birthOn = (N) => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayKey = plan.dateKey(today)
    let target = new Date(today.getTime())
    target.setDate(target.getDate() - (N - 1))
    let birth = new Date(target.getFullYear(), target.getMonth() - 6, target.getDate())
    // 月末归一化（如 9-31 回拨 6 个月落成 10-01）会让菜单日偏移，迭代校正
    for (let it = 0; it < 4; it++) {
      const md = plan.menuDayOf(plan.dateKey(birth), todayKey)
      if (md === N) break
      target.setDate(target.getDate() - (md - N))
      birth = new Date(target.getFullYear(), target.getMonth() - 6, target.getDate())
    }
    return plan.dateKey(birth)
  }
  const gen6s = (birth, extra) => plan.generate(Object.assign({
    months: 6, issues: [], safeFoodIds: allIds6s,
    blockedFoodIds: [], recordedFoodIds: [], observingCount: 0,
    birth: birth
  }, extra || {}))
  const assertMain = (d, birth, tag) => {
    const md = plan.menuDayOf(birth, d.date)
    const meal = d.meals && d.meals[0]
    if (!meal) { E(`6s ${tag} ${d.date} 没有正餐行`); return md }
    if (d.meals.length !== 1 || meal.recipeId !== 'r_rice_cereal')
      E(`6s ${tag} ${d.date} 正餐不是唯一一份强化铁米粉 —— 6 月主食没锁定到固定菜单`)
    if (meal.amount !== M6_PIN[md])
      E(`6s ${tag} ${d.date}（菜单第 ${md} 天）用量「${meal.amount}」≠ 固定菜单「${M6_PIN[md]}」`)
    const text = (meal.steps || []).join('\n')
    if (text.indexOf(String(M6_PIN[md]).slice(3)) < 0)
      E(`6s ${tag} ${d.date} 步骤没带菜单用量 —— 固定菜单口径没落到眼前`)
    if (/[{}]/.test(text)) E(`6s ${tag} ${d.date} 步骤残留花括号 —— 没走 fillPortions`)
    return md
  }

  // 窗口 A：今天 = 菜单第 5 天 → 窗口 5–11 全部 <19：正餐锁米粉、15:00 全空白
  const bA = birthOn(5)
  const pA = gen6s(bA)
  if (!pA) E('6s 窗口 A：plan.generate({months:6, birth}) 返回 null')
  else pA.days.forEach((d) => {
    const md = assertMain(d, bA, 'A')
    if (md >= 1 && md <= 18 && d.snack)
      E(`6s A ${d.date}（菜单第 ${md} 天 <19）不该有加餐 —— 15:00 应为空白`)
  })

  // 窗口 B：今天 = 菜单第 16 天 → 跨 6+19 边界：16–18 空白、19–22 有水果
  const bB = birthOn(16)
  const pB = gen6s(bB)
  if (!pB) E('6s 窗口 B：plan.generate 返回 null')
  else {
    pB.days.forEach((d) => {
      const md = assertMain(d, bB, 'B')
      if (md < 19) {
        if (d.snack) E(`6s B ${d.date}（菜单第 ${md} 天）15:00 不该有加餐 —— 第 19 天之前应为空白`)
        return
      }
      if (!d.snack) { E(`6s B ${d.date}（菜单第 ${md} 天）缺水果加餐 —— 菜单 6+19 起 15:00 加水果泥`); return }
      const rr = rmap6s[d.snack.recipeId]
      const isFruit = rr && rr.mainFoods.length > 0 && rr.mainFoods.every((fid) => {
        const f = foods.find((x) => x.id === fid)
        return f && f.category === '水果'
      })
      if (!isFruit) E(`6s B ${d.date} 加餐「${d.snack.name}」不是水果 —— 菜单 15:00 加餐列是水果泥`)
      if ((d.catNames || []).indexOf('水果') < 0)
        E(`6s B ${d.date} catNames 缺『水果』—— 水果加餐没计入当日类别`)
    })
    // 加料进采购清单（pork/spinach/pumpkin 覆盖 16–22 日窗口）
    const shopIds = []
    ;(pB.shopping || []).forEach((g) => (g.items || []).forEach((it) => shopIds.push(it.foodId)))
    ;['rice_cereal', 'pork', 'spinach', 'pumpkin'].forEach((fid) => {
      if (shopIds.indexOf(fid) < 0) E(`6s 采购清单缺「${fid}」—— 菜单加料没进采购`)
    })
  }

  // 窗口 C：6 月固定菜单用量（今天 = 第 1 天 → 窗口 1–7）
  // v2.25 · 方案A：新食材卡已移除；菜单用量是主食的真信息，逐日钉死。
  const bC = birthOn(1)
  const pC = gen6s(bC)
  if (!pC) E('6s 窗口 C：plan.generate 返回 null')
  else pC.days.forEach((d) => {
    const md = plan.menuDayOf(bC, d.date)
    const meC = plan.MENU_6[md]
    if (meC) {
      const wantC = meC.base + (meC.add || []).map((a) => '+' + a.label).join('')
      const gotC = d.meals[0] ? d.meals[0].amount : ''
      if (gotC !== wantC)
        E(`6s C ${d.date}（菜单第 ${md} 天）用量「${gotC}」≠ 菜单「${wantC}」`)
      if (md <= 3 && d.meals[0] && d.meals[0].recipeId !== 'r_rice_cereal')
        E(`6s C ${d.date}（菜单第 ${md} 天）首口应是强化铁米粉，实际 ${d.meals[0].recipeId}`)
    }
    if (d.newFood)
      E(`6s C ${d.date}（菜单第 ${md} 天）仍产出 day.newFood —— 引入已改走档案页（方案A），引擎不该再排`)
  })

  // 窗口 D：菜泥/肉泥逐日加量（今天 = 第 10 天 → 窗口 10–16，1→2→3 勺跟菜单走）
  // 原来钉的是「新食材卡量」；卡没了，但 1→2→3 勺是菜单的真信息，继续钉。
  const bD = birthOn(10)
  const pD = gen6s(bD)
  const qtyOf = (md) => (md % 3 === 1 ? '1 勺' : md % 3 === 2 ? '2 勺' : '3 勺')
  if (!pD) E('6s 窗口 D：plan.generate 返回 null')
  else pD.days.forEach((d) => {
    const md = plan.menuDayOf(bD, d.date)
    const meD = plan.MENU_6[md]
    if (meD && (meD.add || []).length) {
      const wantD = meD.base + '+' + meD.add[0].label
      const gotD = d.meals[0] ? d.meals[0].amount : ''
      if (gotD !== wantD)
        E(`6s D ${d.date}（菜单第 ${md} 天）用量「${gotD}」≠ 菜单「${wantD}」`)
      else if (md >= 10 && md <= 16 && meD.add[0].qty !== qtyOf(md))
        E(`6s D 菜单第 ${md} 天的量「${meD.add[0].qty}」≠ 递增档「${qtyOf(md)}」—— 1→2→3 勺节奏丢了`)
    }
    if (d.newFood)
      E(`6s D ${d.date}（菜单第 ${md} 天）仍产出 day.newFood —— 引入已改走档案页（方案A）`)
  })

  // 4) 安全语义优先：有反应剔加料；病中/观察中剔未记录加料且不出新食材卡
  const pE = gen6s(bD, { blockedFoodIds: ['potato'] })
  if (!pE) E('6s 有反应测试：plan.generate 返回 null')
  else pE.days.forEach((d) => {
    const md = plan.menuDayOf(bD, d.date)
    if (md >= 10 && md <= 12) {
      if (d.meals[0] && d.meals[0].amount !== '谷物 5g+水50ml')
        E(`6s E ${d.date} 有反应食材（土豆）没从加料剔除 —— 用量「${d.meals[0].amount}」`)
      if (d.newFood && d.newFood.foodId === 'potato')
        E(`6s E ${d.date} 有反应食材还挂在新食材卡上 —— §6j 语义不可洗白`)
    }
  })

  const pF = gen6s(bD, { sick: true })
  if (!pF) E('6s 病中测试：plan.generate 返回 null')
  else pF.days.forEach((d) => {
    const md = plan.menuDayOf(bD, d.date)
    if (md >= 10 && d.meals[0] && /\+(土豆泥|胡萝卜泥|猪肉泥)/.test(d.meals[0].amount))
      E(`6s F ${d.date} 病中仍排了未记录新加料 —— WS/T 678—2020 3.8 暂停新辅食`)
    if (d.newFood) E(`6s F ${d.date} 病中出了新食材卡 —— 病中不引入新食材`)
  })

  const pG = gen6s(bD, { recordedFoodIds: ['potato'], observingCount: 1 })
  if (!pG) E('6s 观察中测试：plan.generate 返回 null')
  else pG.days.forEach((d) => {
    const md = plan.menuDayOf(bD, d.date)
    if (md >= 13 && d.meals[0] && /\+(胡萝卜泥|猪肉泥)/.test(d.meals[0].amount))
      E(`6s G ${d.date} 观察中仍排了未记录新加料 —— 一次只引入一种（新食材暂停语义）`)
    if (d.newFood) E(`6s G ${d.date} 观察中出了新食材卡 —— 观察期不再引入新食材`)
  })

  // 5) 重新生成只改水果：正餐逐字不动、水果加餐有可变性
  const bH = birthOn(16)
  const pH1 = gen6s(bH)
  const pH2 = gen6s(bH)
  if (!pH1 || !pH2) E('6s 重新生成测试：plan.generate 返回 null')
  else {
    pH1.days.forEach((d, i) => {
      const d2 = pH2.days[i]
      if (!d2 || !d.meals[0] || !d2.meals[0] ||
        d.meals[0].amount !== d2.meals[0].amount ||
        d.meals[0].recipeId !== d2.meals[0].recipeId)
        E(`6s 重新生成改变了正餐（${d.date}）——「重新生成计划只修改水果加餐」被破坏`)
    })
    let fruitVaried = false
    for (let rep = 0; rep < 8 && !fruitVaried; rep++) {
      const pa = gen6s(bH)
      const pb = gen6s(bH)
      if (!pa || !pb) break
      for (let i = 0; i < pa.days.length && !fruitVaried; i++) {
        if (pa.days[i].snack && pb.days[i].snack &&
          pa.days[i].snack.recipeId !== pb.days[i].snack.recipeId) fruitVaried = true
      }
    }
    if (!fruitVaried) E('6s 8 轮重新生成水果加餐一次没变 —— 水果加餐没有可变性（加权随机失效？）')
  }

  // 6) 生日进指纹
  const mkS6s = (birthday) => ({
    getBaby: () => ({ name: '测试', birthday: birthday }),
    getIssues: () => [], getSick: () => false,
    safeFoodIds: () => [], badFoodIds: () => [],
    recordedFoodIds: () => [], observingFoodIds: () => [],
    refusedRecipeIds: () => []
  })
  const in6s = plan.planInputs(mkS6s(bA))
  if (!in6s || in6s.birth !== bA)
    E('planInputs 没带 birth —— 6 月菜单日锚定拿不到生日')
  const sB6s = plan.planSignature(mkS6s(birthOn(5)))
  const sC6s = plan.planSignature(mkS6s(birthOn(6)))
  if (!sB6s || !sC6s || sB6s === sC6s)
    E('生日没进计划指纹 —— 换生日不触发重算，菜单日会整体错位')

  // 7) 6 月卡承接 + 源码钉
  //    v2.10 用户删掉 cook 卡整行「固定菜单：菜泥/肉泥逐 3 天升级 + 加餐列 6+19 起」
  //    → 指南卡不再重复承接月内节奏，改由 plan.js MENU_6 自身保证（下面源码钉仍在）
  const pj6s = fs.readFileSync('./utils/plan.js', 'utf8')
  if (pj6s.indexOf('const MENU_6') < 0 || pj6s.indexOf('function menuDayOf') < 0)
    E('plan.js 缺 MENU_6 / menuDayOf —— 6 月固定菜单锁定没有实现')
  if (pj6s.indexOf('birth: baby.birthday') < 0)
    E('planInputs 没带 birth —— 菜单日锚定拿不到生日')
  if (pj6s.indexOf("'d' + inputs.birth") < 0)
    E('planSignature 没把 birth 计入指纹 —— 换生日不重算')
  if (pj6s.indexOf('MENU_6_SNACK_START') < 0)
    E('plan.js 缺 MENU_6_SNACK_START —— 水果加餐起始日没有事实源')
  if (pj6s.indexOf('menuAdd') < 0)
    E('plan.js 缺 menuAdd（冻结日加料采购补计）—— 隐式重排后采购清单会漏加料')

  if (errs.length === errsBefore)
    console.log('  6s 6 月主食固定菜单锁定：MENU_6 三十天逐字钉 ✓、正餐恒米粉+当日菜单用量逐日核 ✓、15:00 加餐 6+19 前空白/后果实 ✓、加料类别与采购 ✓、有反应/病中/观察中剔加料 ✓、菜泥 1→2→3 勺递增 ✓、引擎零新食材卡（反向钉）✓、重新生成只改水果 ✓、生日进指纹 ✓')
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
