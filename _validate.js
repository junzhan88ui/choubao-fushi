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
 * 改钉档案页这条通道 —— 门得关着、勾选当场落 safe、还得按月龄拦。
 * v2.30 · 用户决策：3 天观察期整体删除 —— 致敏食材也勾选即「已吃过、确认
 *       没问题」；本节 ③ 因此从「必须停在 observing」翻转为反向钉。
 */
{
  // v2.25 · 方案A：引擎不再自动排新食材（档案页是引入的唯一入口），所以旧的
  // 「26 周自动引入序列」没有对象可扫 —— 改钉档案页这条通道的三个真条件：
  //   ① 门得关着：一条记录都没有时，计划里不许出现含致敏食材的菜；
  //   ② 过了门就得开：全部标 safe 后致敏食材必须真进菜（见下方 allSafe）；
  //   ③ 入口当场落 safe：profile.toggleFood 勾选（含致敏）= markIntroduced
  //      直落 safe，不许再有观察期分支（反向钉，v2.30 观察期已删）。
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

  // ③ 引入入口：勾选（含致敏）当场落 safe —— v2.30 观察期已按用户决策删除，
  //    反向钉：toggleFood 里不许再出现 !f.allergen 的观察分支（§6u 有实跑钉）
  const pSrc5b = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const tg5b = pSrc5b.indexOf('toggleFood(')
  const tgEnd5b = pSrc5b.indexOf('goBack(', tg5b)
  const tgSeg5b = tg5b >= 0 && tgEnd5b > tg5b ? pSrc5b.slice(tg5b, tgEnd5b) : ''
  if (!tgSeg5b) {
    E('5b profile.js 缺 toggleFood —— 档案页没有引入入口')
  } else if (!/markIntroduced\(id\)/.test(tgSeg5b)) {
    E('5b toggleFood 没调 storage.markIntroduced —— 勾选不落记录，引入通道是断的')
  } else if (/!\s*f\s*\|\|\s*!\s*f\.allergen/.test(tgSeg5b)) {
    E('5b toggleFood 又出现 !f.allergen 观察分支 —— 3 天观察期已按用户决策删除，致敏食材勾选即已吃过')
  } else if (!/isFoodReady\(f,\s*this\.data\.months\)/.test(tgSeg5b)) {
    E('5b toggleFood 没按月龄拦引入 —— 6 月龄就能勾到 9 月龄才该吃的食材（引擎的 minMonth 升序已随方案A删除）')
  }
  console.log('  5b 致敏通道：未记录 → 菜里一道致敏食材都没有；档案页勾 → 当场落已吃过 + 月龄门 ✓')
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
  // 可勾选列表之外，用户连点都点不到。
  // v2.30 · 数据源打通：过滤字面量随分组逻辑移到 utils/foodlist.js（buildGroups
  // 的 skipUnintroducible 分支），档案页改成传参 —— 两端都要钉：
  //  foodlist 有 `f.introducible === false` 字面量，profile 传 skipUnintroducible:true。
  const pSrc5e = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const flSrc5e = fs.readFileSync('./utils/foodlist.js', 'utf8')
  if (!/f\.introducible\s*===\s*false/.test(flSrc5e))
    E('foodlist.js 没按 introducible:false 挡住禁食条目 —— 禁食提示现在能被用户勾选引入')
  if (!/skipUnintroducible:\s*true/.test(pSrc5e))
    E('档案页没给 foodlist.buildGroups 传 skipUnintroducible:true —— 禁食条目进可勾选清单')

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
/* v2.30：dueObservations（观察期到期名单）已随 3 天观察期规则删除 —— 缺它才是对的 */
;['ensureInit', 'getBaby', 'setBaby', 'isConfigured', 'getIntroduced', 'markIntroduced',
  'safeFoodIds', 'observingFoodIds', 'badFoodIds',
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
  // 用户 2026-10-15 拍板删除卡内必填说明文案（星号 + placeholder 已足够说明）——
  // 反向钉：别再加回来；必填标记本身仍由上面的 .req 星号钉住
  if (pw.indexOf('都是必填') >= 0)
    E('profile.wxml 又出现「都是必填」说明文案 —— 用户已拍板删除（2026-10-15），别加回来')

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

/* ---------- 6f. 首页与「我的」：名称与月龄必须同容器、同字号 ----------
 * 用户要求：把月龄和宝宝名称对齐、字号保持一致，且两页一起改。锁三件事 ——
 *   1. 同容器：.head-line 容器存在（名字和月龄都塞在它里面，顺序 名称 → 月龄）
 *   2. 同字号：两个 class 的 font-size 必须**彼此相同**（各页一档）。
 *      2026-10-15 批⑨（用户对标参考图）把首页档位从 --fs-lg 提到 --fs-display，
 *      并改成两行大标题；「我的」仍是并排一行、--fs-lg 不变。用户当初选 --fs-lg
 *      的理由是「缩小后才放得下一行」，改两行后该约束不再成立，但「两者同字号」
 *      的诉求原样保留。
 *   3. 引用的类必须在本页 wxss 里定义过，否则标签裸渲染成无样式黑字
 *      （§1c 抓过同类问题：.day-today 引用了却没定义）
 */
{
  const errsBefore = errs.length
  const fontSizeOf = (css, cls) => {
    const m = css.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*font-size:\\s*([^;}]+)'))
    return m ? m[1].trim() : null
  }
  const EXPECT6f = { index: 'var(--fs-display)', mine: 'var(--fs-lg)' }
  ;['index', 'mine'].forEach((which) => {
    const wxml = fs.readFileSync(`./pages/${which}/${which}.wxml`, 'utf8')
    const wxss = fs.readFileSync(`./pages/${which}/${which}.wxss`, 'utf8')

    const li = wxml.indexOf('class="head-line"')
    if (li < 0) E(`${which} 页：名称和月龄没并到同一容器（缺 .head-line）`)
    if (!/\.head-line\s*\{/.test(wxss))
      E(`${which}.wxss 没定义 .head-line —— 引用了没定义的类，布局会散`)

    if (li >= 0) {
      const rest = wxml.slice(li, li + 300)
      const atName = rest.indexOf('head-name')
      const atAge = rest.indexOf('head-age')
      if (atName < 0 || atAge < 0)
        E(`${which} 页的 .head-line 里没同时放名称和月龄 —— 同容器没实现`)
      else if (atName > atAge)
        E(`${which} 页月龄排在名称前面 —— 顺序应为 名称 → 月龄`)
    }

    const fn = fontSizeOf(wxss, 'head-name')
    const fa = fontSizeOf(wxss, 'head-age')
    if (!fn || !fa || fn !== fa)
      E(`${which} 页 名称(${fn}) / 月龄(${fa}) 字号不一致 —— 名称与月龄必须同字号（§6f）`)
    else if (fn !== EXPECT6f[which])
      E(`${which} 页 名称/月龄字号 ${fn} 不是约定的 ${EXPECT6f[which]}（首页批⑨ 两行大标题 / 「我的」并排一行，§6f）`)
  })
  if (errs.length === errsBefore)
    console.log('  首页与「我的」：名称与月龄同容器 ✓、同字号 ✓（首页 --fs-display / 「我的」--fs-lg）✓')
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
  // v2.30 · 打通：查一查与档案页的取数收进共享模块 utils/foodlist.js
  //（iconFor/bgFor 在那里调用，两页经 buildGroups 拿 icon/iconBg）——
  // 这两条链的 JS 端跟着指过去，页面端由 §6u 反向钉（不许再本地取数）
  const appWxss = rd('./app.wxss')
  const chains = [
    {
      where: '查一查列表',
      js: './utils/foodlist.js', wxml: './pages/food/food.wxml',
      binds: ['{{f.icon}}', 'f.iconBg'],
      cls: [{ name: 'food-ic', css: appWxss, from: 'app.wxss' }]
    },
    {
      where: '档案页 chips',
      js: './utils/foodlist.js', wxml: './pages/profile/profile.wxml',
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
      E('详情页又出现「今天第一次试」按钮 —— v2.25 起引入只走档案页勾选（勾选即已吃过），别搬回来')
    if (line.indexOf('bindtap="clearRecord"') >= 0)
      E('详情页又出现「清除记录」按钮 —— v2.25 起解除通道在档案页「有反应的食材」卡，别搬回来')
  })
  if (fw.indexOf('bindtap="markBad"') < 0)
    E('详情页缺「食物过敏」按钮 —— 标过敏只剩档案页一个入口，详情页应就地标')
  // 引入通道必须在档案页活着；观察期已删（v2.30）—— markIntroduced 直接落 safe
  if (pw6j.indexOf('bindtap="toggleFood"') < 0 || pj6j.indexOf('markIntroduced') < 0)
    E('档案页的引入通道坏了 —— 「勾选 = 已经吃过」的正路断了')
  if (pj6j.indexOf("'observing'") >= 0 || pj6j.indexOf('confirmObservation') >= 0)
    E('profile.js 又出现 observing/confirmObservation —— 3 天观察期已按用户决策删除，别加回来（§6u）')
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

      // 3b) setIntroStatus 不得把 bad 转成 safe（重新引入的入口也不能反向用）
      const r2 = storage.setIntroStatus('yam', 'safe')
      const a2 = storage.findIntro('yam')
      if (!a2 || a2.status !== 'bad')
        E('setIntroStatus 把 bad 转成了 safe —— storage 层没守住不变量')
      if (r2 !== false)
        E('setIntroStatus 拒绝 bad→safe 时应返回 false')

      // 3c) 正常流程不误伤：safe → bad（补标过敏）必须放行
      storage.removeIntroduced('yam')
      storage.markIntroduced('yam')
      const r3 = storage.setIntroStatus('yam', 'bad')
      const a3 = storage.findIntro('yam')
      if (r3 !== true || !a3 || a3.status !== 'bad')
        E('safe→bad 被误伤 —— 「标记有反应」的正常流程断了')

      // 3d) 正确解除路径必须走通：清除记录 → 重新引入回「已吃过」（safe）
      //     —— v2.30 观察期已删，markIntroduced 只写 safe，不许再写 observing
      storage.removeIntroduced('yam')
      const r4 = storage.markIntroduced('yam')
      const a4 = storage.findIntro('yam')
      if (r4 !== true || !a4 || a4.status !== 'safe')
        E('清除记录后重新引入没回「已吃过」（safe）—— 观察期已删，不该产生 observing：' + (a4 ? a4.status : 'null'))
    }
  } catch (e) {
    E('§6j 函数级断言执行异常：' + e.message)
  } finally {
    if (hadWx) global.wx = savedWx
    else delete global.wx
  }

  if (errs.length === errsBefore)
    console.log('  6j 有反应不可洗白：详情页两按钮(过敏可标·重加带弹窗) ? 反向钉(清除入口在档案页·观察期零残留) ? markSafe坏分支=弹窗+先解除 ? storage 硬拒(状态/日期/返回值) ? 正常路径(→bad、解除后重引入回 safe)不误伤 ✓')
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
  // v2.25：「有反应」入口与 reactionMeal 从首页餐卡删除；v2.30 档案页的
  // 「标记有反应」（pickBadFood）也按用户决策删除 —— 双向反向钉：
  // 首页不许有，档案页也不许再有；标 bad 的按钮只剩详情页「食物过敏」（§6j）
  if (iw.indexOf('reactionMeal') >= 0)
    E('index.wxml 又出现「有反应」入口 —— 首页打卡只剩三态，标记通道在食材详情页，别搬回来')
  if (iw.indexOf('catchtap="undoMealLog"') < 0) E('index.wxml 缺打卡撤销入口')
  if (ij.indexOf('logMeal(e)') < 0) E('index.js 缺 logMeal 处理器')
  if (/reactionMeal\s*\(/.test(ij))
    E('index.js 还留着 reactionMeal —— 功能已删（标记通道在食材详情页 markBad），这是死代码')
  if (ij.indexOf('undoMealLog(e)') < 0) E('index.js 缺 undoMealLog 处理器')

  // 3) 有反应：档案页「标记有反应」入口已删（v2.30 · 用户决策）—— 反向钉。
  //    标 bad 的按钮入口只剩食材详情页「食物过敏」(markBad，§6j 钉其
  //    markIntroduced → setIntroStatus('bad') 正路与确认弹窗)
  if (pw.indexOf('pickBadFood') >= 0)
    E('档案页又出现「标记有反应」入口 —— 已按用户决策删除，标记 bad 走食材详情页「食物过敏」')
  if (pj.indexOf('pickBadFood') >= 0)
    E('profile.js 又有 pickBadFood —— 死处理器，别加回来')

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
    E('badList 没从 status=bad 过滤 —— 已吃过/未引入的食材会混进有反应组')

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
  // 6c′) 「正在观察中」行已从「我的记录」删掉（v2.25）；v2.30 用户决策把
  //       3 天观察期整体删除后，观察卡/确认按钮/到期提醒也不复存在 ——
  //       双向反向钉：「我的」不许有，档案页更不许再有（详情见 §6u）
  if (mw.indexOf('正在观察中') >= 0 || mw.indexOf('observingList') >= 0 || mw.indexOf('observingCount') >= 0)
    E('mine.wxml 又出现「正在观察中」行 —— 观察期已整体删除，别在「我的」加回来')
  if (mj.indexOf('observingList') >= 0 || mj.indexOf('observingCount') >= 0)
    E('mine.js 还在算 observingList/observingCount —— 观察名单行已删，算了就是死代码')
  if (pj.indexOf('observing') >= 0 || pj.indexOf('confirmObservation') >= 0)
    E('profile.js 又有观察期处理（observing/confirmObservation）—— 3 天观察期已删，勾选即已吃过（§6u）')
  if (pw.indexOf('观察') >= 0)
    E('profile.wxml 又出现「观察」—— 观察卡与 3 天观察文案已按用户决策删除，别加回来（§6u）')
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
    E('badFoods 没按 status===bad 过滤 —— 已吃过的食材会混进有反应卡')
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
  // 反向：5 条零引用的全局死样式（v2.25 清理）不许回来 —— 加之前先找调用方
  const appCss6l = fs.readFileSync('./app.wxss', 'utf8')
  ;['strong', 'tag-amber', 'tag-red', 'tag-blue', 'divider'].forEach((cls) => {
    if (new RegExp('\\.' + cls + '\\s*\\{').test(appCss6l))
      E(`app.wxss 又出现 .${cls} —— 全仓（js/wxml/md）零引用的死样式，别加回来（§6l）`)
  })

  if (errs.length === errsBefore)
    console.log('  6l 视觉基线：.card 阴影唯一+alpha≤0.1 ✓、今天日期=计划页唯一 display(40/600) ✓、基础日期 fs-sm ✓、三档 baseline ✓、打卡行 min-height96≥88+flex居中 ✓、state/undo 同高+行盒撑满 ✓、全局 5 条死样式反向钉 ✓')
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
    // 全在工作日、彼此隔 ≥3 天」已随自动排期删除；3 天观察间距也随观察期规则
    // 整体删除（v2.30），引入节奏全由用户在档案页自己掌握。
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
  // 批⑬（2026-10-16）：.head-issue 随状态行一并删除 —— 这条 AA 钉只剩 .cat-warn
  // （删掉的琥珀状态行见 §6x-22 反向钉）
  ;['cat-warn'].forEach((cls) => {
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
  if (app.indexOf('.link-arrow-open {') < 0 || ix.indexOf('link-arrow-open') < 0)
    E('link-arrow-open 共享修饰类断链（app.wxss 必须定义，index 必须使用）')

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

  // 2) 首页接线：按**辅食月龄**选组（六档闸门，v2.32 双时钟 fm）→ 挂进 data
  //    → WXML 渲染并复用展开交互；「1 岁以上」进卡看生理 ≥13（§6w 分流表）
  ;['fm >= 7 && fm < 8', 'fm >= 8 && fm < 9', 'fm >= 9 && fm < 10',
    'fm >= 10 && fm < 11', 'fm >= 11 && fm < 12', 'fm === 12'].forEach((gt) => {
    if (ij.indexOf(gt) < 0) E(`index.js 缺「${gt}」的选组闸门 —— 这个年龄段挂不到知识卡`)
  })
  if (!/guideLater\s*=\s*phys\s*>=\s*13\s*\?\s*guides\.onePlus/.test(ij))
    E('index.js 没按「生理月龄 ≥13 → 1 岁以上卡」挑组赋给 guideLater —— 幼儿期分流丢了（§6w）')
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
  // v2.32 双时钟 · 修正：birth 仍是**生日**（menuDayOf 内部 +6 月找 6 月龄第 1 天
  // 的原语义），辅食开始日单独走 foodStart 字段、由 menuDayFrom 直锚 ——
  // 别再把 foodStart 塞进 birth（+6 个月错位到未来，菜单锁整个失效，用户实测抓过）
  if (pj6s.indexOf('birth: baby.birthday') < 0 || pj6s.indexOf('foodStart: baby.foodStart') < 0)
    E('planInputs 锚定字段错了 —— 必须是 birth=生日 + foodStart=辅食开始日两个字段（v2.32 修正）')
  if (pj6s.indexOf("'d' + inputs.birth") < 0)
    E('planSignature 没把 birth 计入指纹 —— 换生日不重算')
  if (pj6s.indexOf('MENU_6_SNACK_START') < 0)
    E('plan.js 缺 MENU_6_SNACK_START —— 水果加餐起始日没有事实源')
  if (pj6s.indexOf('menuAdd') < 0)
    E('plan.js 缺 menuAdd（冻结日加料采购补计）—— 隐式重排后采购清单会漏加料')

  if (errs.length === errsBefore)
    console.log('  6s 6 月主食固定菜单锁定：MENU_6 三十天逐字钉 ✓、正餐恒米粉+当日菜单用量逐日核 ✓、15:00 加餐 6+19 前空白/后果实 ✓、加料类别与采购 ✓、有反应/病中/观察中剔加料 ✓、菜泥 1→2→3 勺递增 ✓、引擎零新食材卡（反向钉）✓、重新生成只改水果 ✓、生日进指纹 ✓')
}

/* ---------- 6t. 各月龄滑动指南 + 首页阶段标签删除（v2.30） ----------
 * 用户决策（2026-10）：① 首页右上角阶段标签（「稠糊 / 带颗粒」= stageLabel）删除，
 * **只删首页**（「我的」页保留）② 入口按钮放【当前状态】行最右侧、与该行对齐，
 * 文案钉死「滑动查看各月龄注意事项」③ 13–24 月龄暂无知识卡数据 → 占位
 * 「内容整理中」，不许硬编内容。
 * 钉子：1) 首页反向钉（别加回来）：wxml 不渲染 stageLabel、js 不再装配；
 *        mine 页必须还在（别顺手删过头）
 *      2) 入口接线：wxml 文案+bindtap → index.goMonths → /pages/months/months
 *        → app.json 注册；v2.31 提案A：独立胶囊按钮（.head-more-row 右对齐、
 *        --r-pill、88rpx 触达，不再与状态行同行，text 链接形态反向钉）
 *      3) 月龄页数据实跑：8 页（6–12 逐月 + 「1 岁以上」统一页）每页 7 天食谱、
 *        正餐数 = mealsForMonth、6 月恒「强化铁米粉糊」（MENU_6 第 1–7 天）、
 *        7–12 分月卡、1 岁上 = guides.onePlus（13 月龄起点现算样例）
 *      4) 节点上限护栏：buildSlides 只挂「当前 ±1」的 active 窗口，
 *        onMonthChange 滑动时窗口跟着挪（全渲染会顶到单页节点上限）
 *      5) 一周食谱是**通用样例**：safeFoodIds 全量、blocked 空 —— 不带个人排除
 */
{
  const errsBefore = errs.length
  const iw6t = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ij6t = fs.readFileSync('./pages/index/index.js', 'utf8')
  const iq6t = fs.readFileSync('./pages/index/index.wxss', 'utf8')
  const miw6t = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')
  const mw6t = fs.readFileSync('./pages/months/months.wxml', 'utf8')
  const mj6t = fs.readFileSync('./pages/months/months.js', 'utf8')
  const mqq6t = fs.readFileSync('./pages/months/months.json', 'utf8')
  const gd6t = fs.readFileSync('./data/guides.js', 'utf8')
  const app6t = fs.readFileSync('./app.json', 'utf8')

  // 1) 首页阶段标签删除（反向钉：别加回来）
  if (iw6t.indexOf('stageLabel') >= 0)
    E('index.wxml 又渲染了 stageLabel —— 首页阶段标签（稠糊/带颗粒…）已按用户要求删除，别加回来')
  if (/stageLabel\s*:/.test(ij6t) || /\.stageLabel\b/.test(ij6t))
    E('index.js 又在装配 stageLabel —— 首页标签删了，这就是死数据')
  if (miw6t.indexOf('{{stageLabel}}') < 0)
    E('mine.wxml 的 stageLabel 被误删 —— 用户只让删首页，「我的」页要保留')
  // 批⑬（用户 2026-10-16 拍板）：阶段说明行（stageDesc）也从首页删了 ——
  // months 页的 slide.stageDesc 是别处的，不受这条影响；剥注释后再扫，
  // 免得我们自己写的说明注释被当成装配
  const noC6t = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  if (iw6t.indexOf('{{stageDesc}}') >= 0)
    E('index.wxml 又渲染了 stageDesc —— 阶段说明行按用户 2026-10-16 要求从首页删除（§6t/§6x-22）')
  if (/stageDesc\s*:/.test(noC6t(ij6t)) || /base\.stageDesc/.test(noC6t(ij6t)))
    E('index.js 又在装配 stageDesc —— 首页不显示它，装配就是死数据（§6t/§6x-22）')

  // 2) 入口接线：文案 → goMonths → months 页 → app.json 注册 → 样式在位
  //    v2.31 · 提案A：入口 = 状态行下方右对齐的独立胶囊按钮（.head-more-row 包着），
  //    不再与状态行同行 —— 位置钉与形态钉都在下面
  const BTN6t = '滑动查看各月龄注意事项'
  if (iw6t.indexOf(BTN6t) < 0)
    E('index.wxml 缺入口按钮文案「' + BTN6t + '」—— 按钮文案是用户定的，别改')
  if (iw6t.indexOf('bindtap="goMonths"') < 0)
    E('index.wxml 入口按钮没绑 goMonths —— 按钮点了没反应（死入口）')
  // 批⑬（2026-10-16）：状态行删了 —— 位置钉改钉「在 2×2 指标格之后」，
  // 形态钉（独立胶囊 / 右对齐 / 88rpx 触达 / 不退回 text 链接）一字不变
  const rowAt6t = iw6t.indexOf('stat-grid')
  const btnAt6t = iw6t.indexOf('head-more')
  if (rowAt6t < 0 || btnAt6t < 0 || btnAt6t < rowAt6t)
    E('入口按钮不在 2×2 指标格之后 —— 头卡顺序应为 小标/标题 → 照片 → 指标格 → 入口胶囊（§6t/§6x-22）')
  if (/<text[^>]*class="head-more"/.test(iw6t))
    E('入口又退回纯文字链接（text.head-more）—— v2.31 提案A 已改独立胶囊按钮，别加回来')
  if (ij6t.indexOf('goMonths()') < 0 || ij6t.indexOf('/pages/months/months') < 0)
    E('index.js 没有 goMonths → navigateTo(/pages/months/months) —— 入口是死的')
  if (iq6t.indexOf('.stat-grid') < 0 || iq6t.indexOf('.head-more') < 0)
    E('index.wxss 缺 .stat-grid / .head-more —— 入口没有样式（裸文本挤在卡里）')
  // 提案A 形态钉：--r-pill 胶囊 + 88rpx(44pt) 触达 + 独立行右对齐（无描边是
  // token 纪律：全站零硬编码描边色，别「补」一条）
  if (!/\.head-more\s*\{[^}]*--r-pill/.test(iq6t))
    E('.head-more 不是 --r-pill 胶囊 —— v2.31 提案A 形态口径（胶囊=全站标签语言）')
  if (!/\.head-more\s*\{[^}]*min-height:\s*88rpx/.test(iq6t))
    E('.head-more 缺 min-height 88rpx —— 触达不到 44pt，手指点不中')
  if (!/\.head-more-row\s*\{[^}]*justify-content:\s*flex-end/.test(iq6t.replace(/\n\s*/g, ' ')))
    E('.head-more-row 不是右对齐（justify-content: flex-end）—— 提案A 定的位置：状态行下方右对齐')
  if (app6t.indexOf('"pages/months/months"') < 0)
    E('app.json 没注册 pages/months/months —— navigateTo 直接失败')
  if (mqq6t.indexOf('各月龄喂养指南') < 0)
    E('months.json 缺 navigationBarTitleText「各月龄喂养指南」')

  // 3) 月龄页源码接线（v2.31：8 页 = 6–12 逐月 + 1 岁以上统一页）
  if (mw6t.indexOf('<swiper') < 0 || mw6t.indexOf('bindchange="onMonthChange"') < 0)
    E('months.wxml 没有 swiper/bindchange —— 「向右滑动查看各月龄」的核心交互没了')
  if (mw6t.indexOf('wx:for="{{slides}}"') < 0)
    E('months.wxml 没渲染 slides —— 数据配了页面不显示（死数据）')
  if (mw6t.indexOf('wx:if="{{slide.active}}"') < 0)
    E('months.wxml 没按 slide.active 控制渲染 —— 全渲染会顶到单页节点上限')
  if (mw6t.indexOf('内容整理中') >= 0)
    E('months.wxml 又出现占位文案「内容整理中」—— 13–24 已统一为「1 岁以上」页（v2.31），别加回来')
  if (mw6t.indexOf('g.placeholder') >= 0 || /placeholder:\s*true/.test(mj6t))
    E('月龄页还留着占位卡分支（placeholder）—— 内容已落地，占位整套删除，别加回来')
  if (mw6t.indexOf('一周食谱（参考）') < 0)
    E('months.wxml 缺「一周食谱（参考）」区块 —— 每页三块内容缺一块')
  if (mj6t.indexOf('m = 6; m <= 12') < 0)
    E('months.js 逐月循环不是 6–12 —— v2.31 起 13–24 统一为「1 岁以上」页')
  if (mj6t.indexOf('guides.sixMonth') < 0)
    E('months.js 没接 6 月龄卡（guides.sixMonth）')
  if (mj6t.indexOf('LATER[m]') < 0)
    E('months.js 没接 7–12 分月卡映射（LATER）')
  if (mj6t.indexOf('guides.onePlus') < 0 || mj6t.indexOf("title: '1 岁以上'") < 0)
    E('months.js 缺「1 岁以上」统一页（guides.onePlus + 标题）—— 13–24 没页可落')
  if (mj6t.indexOf('phys >= 13') < 0 || mj6t.indexOf('idx = 7') < 0
    || mj6t.indexOf('foodMonthsOf') < 0)
    E('onLoad 落页分流丢了 —— 「1 岁以上」页看生理 ≥13、6–12 页看辅食月龄（v2.32 双时钟，§6w）')
  if (mj6t.indexOf('months: 13') < 0)
    E('「1 岁以上」页的样例食谱没按 13 月龄起点现算')
  // 1 岁以上卡内容口径钉（v2.31 用户给定文案 —— 核心口径别删改/稀释）
  if (gd6t.indexOf("title: '怎么喂'") < 0 || gd6t.indexOf("title: '注意事项'") < 0)
    E('guides.onePlus 卡标题不是「怎么喂 / 注意事项」')
  const op6t = gd6t.slice(gd6t.indexOf('ONE_PLUS'))
  ;['软着陆', '最好不加盐', '不超过 2 克', '400–500ml', '350–500ml',
    '整粒坚果', '果冻', '整颗葡萄', '年糕', '汤圆', '3 岁前', '3 岁以后',
    '先单独盛出宝宝那份', '营养密度'].forEach((k) => {
    if (op6t.indexOf(k) < 0)
      E(`guides.onePlus 丢了「${k}」—— 1 岁以上卡是用户给定文案，核心口径别删改`)
  })
  if (ij6t.indexOf('phys >= 13') < 0 || ij6t.indexOf('guides.onePlus') < 0)
    E('index.js 没给生理月龄 ≥13 挂「1 岁以上」卡（phys >= 13 → guides.onePlus，v2.32 双时钟看生理）—— 首页大月龄宝宝没知识卡')
  if (mj6t.indexOf('plan.generate(') < 0 || mj6t.indexOf('safeFoodIds: ALL_IDS') < 0 ||
      mj6t.indexOf('blockedFoodIds: []') < 0)
    E('months.js 一周食谱没走 plan.generate 通用样例（全量 safe、blocked 空）—— 个人排除不该进「各月龄参考」')
  if (mj6t.indexOf('slotsForMonth') < 0)
    E('months.js 没用 age.slotsForMonth 对齐时刻 —— 食谱行的时刻会跟月龄餐次脱节')

  // 4) 数据实跑：buildSlides 8 页（6–12 逐月 + 1 岁以上）+ active 窗口 + onMonthChange
  let pg6t = null
  const hadPg6t = typeof global.Page !== 'undefined'
  const savedPg6t = global.Page
  global.Page = (o) => { pg6t = o }
  try {
    require('./pages/months/months.js')
  } finally {
    if (hadPg6t) global.Page = savedPg6t
    else delete global.Page
  }
  if (!pg6t || typeof pg6t.buildSlides !== 'function' || typeof pg6t.onMonthChange !== 'function')
    E('months.js 没注册成 Page / 缺 buildSlides、onMonthChange —— 页面是死的')
  else {
    const slides6t = pg6t.buildSlides.call(pg6t, 0)
    if (!Array.isArray(slides6t) || slides6t.length !== 8)
      E(`buildSlides 产 ${slides6t ? slides6t.length : '?'} 页，期望 8（6–12 月 + 1 岁以上）`)
    else {
      slides6t.forEach((s) => {
        if (!s.menu || s.menu.length !== 7)
          E(`${s.title}样例食谱只有 ${s.menu ? s.menu.length : 0} 天，期望 7`)
        const want = age.mealsForMonth(s.month)
        ;(s.menu || []).forEach((d) => {
          const mains = d.items.filter((i) => i.kind === 'main')
          if (mains.length !== want)
            E(`${s.title} ${d.weekday} 正餐 ${mains.length} 餐 ≠ mealsForMonth ${want} —— 食谱样例跟月龄餐次脱节`)
        })
      })
      // 6 月龄：MENU_6 第 1–7 天恒强化铁米粉糊；卡 = 两张原题卡
      const s6t = slides6t[0]
      if (s6t.cards.map((c) => c.title).join('/') !== '辅食添加要点/怎么做辅食')
        E('6 月龄卡不是「辅食添加要点 / 怎么做辅食」两张原题卡')
      const rice6t = recipes.find((r) => r.id === 'r_rice_cereal')
      if (rice6t) {
        s6t.menu.forEach((d) => {
          const m0 = d.items.filter((i) => i.kind === 'main')[0]
          if (m0 && m0.name !== rice6t.name)
            E(`6 月龄 ${d.weekday} 正餐是「${m0.name}」—— MENU_6 锁定日应恒为${rice6t.name}`)
        })
      }
      // 7–12：分月数据卡
      ;[7, 8, 9, 10, 11, 12].forEach((m) => {
        const s = slides6t[m - 6]
        const titles = s.cards.map((c) => c.title).join('/')
        if (titles !== `${m} 月龄怎么喂/${m} 月龄注意事项`)
          E(`${m} 月龄卡标题 = ${titles}，期望「${m} 月龄怎么喂 / ${m} 月龄注意事项」`)
        if (s.cards.some((c) => c.placeholder))
          E(`${m} 月龄有现成数据却挂了占位卡 —— 死数据`)
      })
      // 1 岁以上页（v2.31 取代原 13–24 占位）：统一内容卡 + 13 月龄起点样例
      const sp6t = slides6t[7]
      if (sp6t.title !== '1 岁以上' || sp6t.month !== 13)
        E('第 8 页不是「1 岁以上」统一页（month=13 现算样例）')
      if (sp6t.cards.map((c) => c.title).join('/') !== '怎么喂/注意事项')
        E('「1 岁以上」卡不是「怎么喂 / 注意事项」两张（guides.onePlus）')
      if (slides6t.some((s) => (s.cards || []).some((c) => c.placeholder)))
        E('还有占位卡（placeholder）—— v2.31 内容已落地，占位整套删除')
      if (JSON.stringify(sp6t.cards).indexOf('软着陆') < 0)
        E('「1 岁以上」卡数据里没有「软着陆」口径 —— 挂错数据源（应为 guides.onePlus）')
      // active 窗口：curIdx=0 → 2 页；居中 → 3 页
      if (slides6t.filter((s) => s.active).length !== 2)
        E('curIdx=0 的 active 窗口不是 2 页（0 与 1）')
      const mid6t = pg6t.buildSlides.call(pg6t, 5)
      if (mid6t.filter((s) => s.active).length !== 3)
        E('居中 curIdx 的 active 窗口不是「当前 ±1」三页 —— 要么多渲染顶节点上限，要么滑过去是空页')
      // onMonthChange：滑到下标 6 → current 跟着走、窗口挪到 6/7/8
      const fake6t = {
        data: { slides: mid6t, current: 5 },
        setData(u) {
          Object.keys(u).forEach((k) => {
            if (k === 'current') { this.data.current = u[k]; return }
            const mm = k.match(/^slides\[(\d+)\]\.active$/)
            if (mm) this.data.slides[+mm[1]].active = u[k]
          })
        }
      }
      pg6t.onMonthChange.call(fake6t, { detail: { current: 6 } })
      if (fake6t.data.current !== 6)
        E('onMonthChange 没把 current 跟着 swiper 更新')
      const act6t = fake6t.data.slides.filter((s) => s.active).map((s) => s.title)
      if (act6t.join(',') !== '11 月龄,12 月龄,1 岁以上')
        E(`滑动后 active 窗口 = [${act6t}]，期望「11 月龄 / 12 月龄 / 1 岁以上」—— 窗口没跟着挪，滑到的页会是空骨架`)
    }
  }

  if (errs.length === errsBefore)
    console.log('  6t 各月龄滑动指南：首页阶段标签反向钉(仅删首页/mine保留) ✓、入口胶囊按钮接线(提案A：文案+goMonths+注册+形态钉/text链接反向钉) ✓、8页(6–12逐月+1岁以上统一页)每页7天 ✓、6月恒米粉(MENU_6) ✓、正餐数=mealsForMonth ✓、7–12分月卡 ✓、1岁以上=guides.onePlus(口径钉/占位反向钉/默认落页/首页13+挂卡) ✓、通用样例(全量safe) ✓、active窗口当前±1+滑动跟随 ✓')
}

/* ---------- 6u. 观察期规则整体删除 + 档案页↔查一查数据源打通（v2.30 · 用户决策） ----------
 * 三条决策（用户拍板）：
 *   ① 3 天观察期整套删除 —— 勾选（含致敏）= 已经吃过、确认没问题，当场落 safe；
 *   ② 存量 observing 记录一次性迁移为 safe；首页「观察期已满」提醒条一并删除；
 *   ③ 档案页与「查一查」抽共享模块 utils/foodlist.js：同一份清单/分类顺序/
 *      状态徽标（未引入/已吃过/有反应 + 月龄起）/图标，chip 补同款状态徽标。
 * 本节 = 源码反向钉（别加回来）+ 迁移与「勾选即 safe」的函数级实跑。
 */
{
  const errsBefore = errs.length
  const rd6u = (p) => fs.readFileSync(p, 'utf8')

  const pj6u = rd6u('./pages/profile/profile.js')
  const pw6u = rd6u('./pages/profile/profile.wxml')
  const pq6u = rd6u('./pages/profile/profile.wxss')
  const ij6u = rd6u('./pages/index/index.js')
  const iw6u = rd6u('./pages/index/index.wxml')
  const fj6u = rd6u('./pages/food/food.js')
  const fq6u = rd6u('./pages/food/food.wxss')
  const fdj6u = rd6u('./pages/food-detail/food-detail.js')
  const fdq6u = rd6u('./pages/food-detail/food-detail.wxss')
  const sj6u = rd6u('./utils/storage.js')
  const fl6u = rd6u('./utils/foodlist.js')
  const ap6u = rd6u('./app.wxss')

  // —— 1. 观察期 UI/入口/机制反向钉：整套删干净 ——
  if (pw6u.indexOf('观察') >= 0)
    E('profile.wxml 出现「观察」—— 观察卡与 3 天观察文案已按用户决策删除，别加回来')
  // 「标记有反应」按钮与准则二引导文案也已删（v2.30 同批用户决策）
  if (pw6u.indexOf('pickBadFood') >= 0 || pw6u.indexOf('＋ 标记有反应') >= 0)
    E('profile.wxml 又出现「标记有反应」入口 —— 已按用户决策删除，标记 bad 走食材详情页「食物过敏」')
  if (pw6u.indexOf('1 岁内适时引入') >= 0 || pw6u.indexOf('可降低过敏风险') >= 0)
    E('profile.wxml 又出现准则二引导文案（1 岁内适时引入可降低过敏风险…）—— 已按用户决策删除')
  if (pj6u.indexOf('confirmObservation') >= 0 || pj6u.indexOf('observing') >= 0)
    E('profile.js 有 observing/confirmObservation —— 观察确认通道已删，勾选即已吃过')
  if (pj6u.indexOf('!f.allergen') >= 0)
    E('profile.js 又出现 !f.allergen 观察分支 —— 致敏食材也勾选即落 safe（§5b ③ 同钉）')
  if (iw6u.indexOf('观察期') >= 0 || iw6u.indexOf('dueObs') >= 0)
    E('index.wxml 又出现观察期提醒（dueObs）—— 首页到期提醒条已删')
  if (/dueObs\s*[=:]|dueObservations\s*[(:,]/.test(ij6u))
    E('index.js 还在算 dueObs —— 到期提醒已删，算了就是死代码')
  if (fj6u.indexOf('观察中') >= 0)
    E('food.js 还有「观察中」状态词 —— 徽标词表已随观察期删除')
  if (/observing\s*:|'observing'/.test(fdj6u))
    E('food-detail.js 还有 observing —— STATUS_TEXT 的观察项已删')
  if (/\.obs-feed\s*\{|\.mini-ok\s*\{|\.chip-flag-bad\s*\{|\.mark-bad-row\s*\{/.test(pq6u))
    E('profile.wxss 还有观察卡/旧徽标/标记入口死样式（.obs-feed/.mini-ok/.chip-flag-bad/.mark-bad-row）—— 已删，别加回来')
  if (/\.st-observing\s*\{/.test(fq6u) || /\.st-observing\s*\{/.test(fdq6u))
    E('还有 .st-observing 样式规则 —— 观察中徽标已随观察期删除')
  if (/OBSERVE_DAYS\s*[=:]|dueObservations\s*[(:,]/.test(sj6u))
    E('storage.js 又有 OBSERVE_DAYS/dueObservations —— 到期机制已随观察期删除')
  if (/status\s*=\s*'observing'/.test(sj6u))
    E('storage.js 还在写 status=observing —— markIntroduced 只写 safe，observing 绝版')

  // —— 1b. 连带死代码也一并反向钉（随到期提醒一起失去唯一调用方的两处）——
  const pl6u = rd6u('./utils/plan.js')
  if (/function\s+getFood\s*\(|getFood\s*:/.test(pl6u))
    E('plan.getFood 又回来了 —— 唯一调用方（首页观察到期提醒）已删，加回来就是死代码')
  if (/\.rd-tag-observing\s*\{/.test(rd6u('./pages/mine/mine.wxss')))
    E('mine.wxss 又有 .rd-tag-observing —— 观察态标签样式已随观察期删除')
  // 所有页面的 wxml 不许再出现观察期文案（food-detail 免责声明里的「观察 2–3 天」
  // 是喂养建议不是 app 机制，所以只盯「观察期/正在观察」两个词）
  const wxml6u = ['profile', 'index', 'food', 'food-detail', 'mine']
    .map((p) => rd6u(`./pages/${p}/${p}.wxml`)).join('\n')
  if (/观察期|正在观察/.test(wxml6u))
    E('某页 wxml 还有「观察期/正在观察」—— 观察卡、到期提醒、说明文案已全部删除')

  // —— 2. 共享模块接线：两页同源，本地分组/词表不许复活 ——
  if (fl6u.indexOf('function buildGroups') < 0)
    E('utils/foodlist.js 缺 buildGroups —— 共享数据源是空的')
  if (fj6u.indexOf('foodlist.buildGroups') < 0)
    E('food.js 没走共享模块 foodlist.buildGroups —— 查一查与档案页的数据源没打通')
  if (fj6u.indexOf('CATEGORY_ORDER') >= 0)
    E('food.js 又本地维护 CATEGORY_ORDER —— 分类顺序收归 utils/foodlist.js 一处')
  if (pj6u.indexOf('foodlist.buildGroups') < 0)
    E('profile.js 没走共享模块 foodlist.buildGroups —— 数据源没打通')
  if (pj6u.indexOf('CATEGORY_ORDER') >= 0)
    E('profile.js 又本地维护 CATEGORY_ORDER —— 分类顺序收归 utils/foodlist.js 一处')
  if (fl6u.indexOf("'其他'") < 0 || fl6u.indexOf('skipUnintroducible') < 0)
    E('foodlist.js 丢了「其他」分类或 skipUnintroducible —— 分类顺序/禁食条目口径会和旧版漂移')
  if (fl6u.indexOf("'observing'") >= 0)
    E('foodlist.js 出现 observing —— 状态词表只有 new/safe/bad 三态')
  if (fl6u.indexOf('iconFor(') < 0 || fl6u.indexOf('bgFor(') < 0)
    E('foodlist.js 不再取图标（iconFor/bgFor）—— 图标链路断在取数端（§6g）')

  // —— 3. 状态徽标同款：档案页 chip 与查一查同一套词、同一份样式 ——
  if (pw6u.indexOf('food-status') < 0 || pw6u.indexOf('{{f.statusText}}') < 0)
    E('profile.wxml 没用同款状态徽标（.food-status / f.statusText）—— 两页徽标口径漂移')
  if (ap6u.indexOf('.food-status {') < 0 || !/\.st-safe\s*\{/.test(ap6u) || !/\.st-bad\s*\{/.test(ap6u) || !/\.st-new\s*\{/.test(ap6u))
    E('app.wxss 缺 .food-status 或 st-safe/st-bad/st-new —— 状态徽标样式没收到全局')

  // —— 4. 函数级实跑：存量迁移 + 勾选（含致敏）当场落 safe ——
  const mem = {}
  mem[storage.KEYS.INTRO] = [
    { foodId: 'wheat', date: '2026-01-01', status: 'observing' }
  ]
  const hadWx = typeof global.wx !== 'undefined'
  const savedWx = global.wx
  global.wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v },
    removeStorageSync: (k) => { delete mem[k] },
    showToast() {},
    showModal() {},
    setNavigationBarTitle() {}
  }
  try {
    // ① 存量 observing 读一次即迁移为 safe，并一次性写回存储
    const migrated = storage.getIntroduced()
    if (!migrated[0] || migrated[0].status !== 'safe')
      E('存量 observing 记录没迁移成 safe —— 老测试数据会永远卡在观察中（' + JSON.stringify(migrated[0]) + '）')
    if (storage.safeFoodIds().indexOf('wheat') < 0)
      E('迁移后 wheat 没进 safeFoodIds —— 用户以前勾过的食材会从计划里凭空消失')
    if (!mem[storage.KEYS.INTRO][0] || mem[storage.KEYS.INTRO][0].status !== 'safe')
      E('迁移没写回存储 —— 应一次性迁移，不是每次读都重迁')
    if (storage.observingFoodIds().length !== 0)
      E('迁移后 observingFoodIds 还有残留')

    // ② markIntroduced 只写 safe（观察期已删，致敏同样）
    storage.removeIntroduced('wheat')
    storage.markIntroduced('wheat')
    const a6u = storage.findIntro('wheat')
    if (!a6u || a6u.status !== 'safe')
      E('markIntroduced 没直接落 safe（记录为 ' + (a6u ? a6u.status : 'null') + '）—— 观察期已删，勾选即已吃过')

    // ③ 档案页 toggleFood 端到端：勾致敏食材 → 当场 safe + 重建列表
    storage.removeIntroduced('shrimp')
    let profCfg6u = null
    const origPage6u = global.Page
    global.Page = (cfg) => { profCfg6u = cfg }
    delete require.cache[require.resolve('./pages/profile/profile.js')]
    require('./pages/profile/profile.js')
    global.Page = origPage6u
    if (!profCfg6u || typeof profCfg6u.toggleFood !== 'function') {
      E('profile.js 没把 toggleFood 注册到 Page —— 档案页引入入口不存在')
    } else {
      const ctx6u = Object.create(profCfg6u)
      ctx6u.data = { months: 12, keyword: '', groups: [], badFoods: [], totalChecked: 0 }
      ctx6u.setData = () => {}
      profCfg6u.toggleFood.call(ctx6u, { currentTarget: { dataset: { id: 'shrimp' } } })
      const t6u = storage.findIntro('shrimp')
      if (!t6u || t6u.status !== 'safe')
        E('toggleFood 勾致敏食材没当场落 safe（记录为 ' + (t6u ? t6u.status : 'null') + '）—— 又停在观察期了')
      const checked6u = storage.safeFoodIds().indexOf('shrimp') >= 0
      if (!checked6u) E('toggleFood 落的记录没进 safeFoodIds —— 勾了也排不进菜单')
    }
  } catch (e) {
    E('§6u 函数级断言执行异常：' + e.message)
  } finally {
    if (hadWx) global.wx = savedWx
    else delete global.wx
    delete require.cache[require.resolve('./pages/profile/profile.js')]
  }

  if (errs.length === errsBefore)
    console.log('  6u 观察期整体删除：档案页/首页/徽标/机制四层反向钉 ✓、存量 observing→safe 迁移实跑 ✓、markIntroduced 只写 safe ✓、toggleFood 勾致敏当场 safe ✓、共享模块 foodlist 双页接线+三态词表+徽标同款 ✓')
}

/* ---------- 6v. 数据备份：导出 / 导入（v2.31 · 方案A 零后端） ----------
 * 三条决策（用户拍板）：
 *   ① 换机/换账号/重装微信不丢数据 —— 平台层无解（微信官方换机迁移不带
 *      小程序数据），采用手动导出/导入，备份文本经用户自己的手转存；
 *   ② 零后端原则不变：只做剪贴板复制/粘贴，无任何网络调用
 *      （隐私口径「未采集」不变）；
 *   ③ bb_plan 派生缓存不进备份：导入后清空强制重算。
 * 源码钉：storage 导出 exportUserData/importUserData/isBackupText；
 *   信封 app 标记 + fmt 版本；清洗口径 observing→safe（与 v2.30 读取迁移
 *   一致）；档案页两个按钮接线 + 导入前 showModal（整包覆盖必须先确认）。
 * 实跑：往返一致（baby/statuses/introduced/mealLogs 四段）+ 拒收三连
 *   （垃圾文本/错标记/错版本）+ 导入后 bb_plan 被清空 + observing 升 safe。
 */
{
  const errsBefore = errs.length
  const sj6v = fs.readFileSync('./utils/storage.js', 'utf8')
  // v3.2：备份入口从档案页第 5 步搬到「我的」页（用户 2026-10-19 拍板）
  const pj6v = fs.readFileSync('./pages/mine/mine.js', 'utf8')
  const pw6v = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')

  // 1) 源码接线
  ;['function exportUserData', 'function importUserData', 'function isBackupText'].forEach((fn) => {
    if (sj6v.indexOf(fn) < 0) E('storage.js 缺 ' + fn + ' —— 备份方案A（v2.31）没落地')
  })
  const exp6v = sj6v.slice(sj6v.indexOf('function exportUserData'), sj6v.indexOf('function importUserData'))
  const imp6v = sj6v.slice(sj6v.indexOf('function importUserData'))
  if (exp6v.indexOf('BACKUP_MARK') < 0 || exp6v.indexOf('BACKUP_FMT') < 0)
    E('导出信封缺 app 标记或 fmt 版本 —— 导入无法辨认「是不是本小程序的备份」')
  if (/plan/i.test(exp6v))
    E('exportUserData 把派生缓存（bb_plan）也导出了 —— 备份只带用户数据，计划缓存导入后重算')
  if (imp6v.indexOf('KEYS.PLAN, null') < 0)
    E('importUserData 没清 bb_plan —— 旧计划是按旧数据生成的，导入后必须重算')
  if (imp6v.indexOf("it.status === 'bad' ? 'bad' : 'safe'") < 0)
    E('importUserData 清洗口径丢了「observing/未知状态 → safe」—— 与 v2.30 读取迁移口径不一致')
  // 隐私钉：备份链路无任何网络调用（「未采集」口径靠这条维持）
  const bak6v = sj6v.slice(sj6v.indexOf('数据备份：导出 / 导入'))
  if (bak6v.indexOf('数据备份') < 0)
    E('storage.js 找不到「数据备份」段注释 —— 导出/导入实现被挪走或删了？')
  if (/wx\.(request|uploadFile|downloadFile)|wx\.cloud/.test(bak6v))
    E('storage.js 备份段出现网络调用 —— 隐私口径「未采集」会失守')
  // 我的页接线 + 导入前确认（v3.2：从档案页第 5 步搬来）
  if (pw6v.indexOf('bindtap="onExport"') < 0 || pw6v.indexOf('bindtap="onImport"') < 0)
    E('「我的」页缺导出/导入按钮（onExport/onImport 接线）—— 档案页第 5 步已删，备份没家了')
  if (pj6v.indexOf('storage.exportUserData()') < 0 || pj6v.indexOf('storage.importUserData(') < 0 ||
      pj6v.indexOf('storage.isBackupText(') < 0)
    E('mine.js 备份按钮没接 storage 的导出/导入/预检')
  if (pj6v.slice(pj6v.indexOf('onImport()')).indexOf('showModal') < 0)
    E('onImport 没弹确认框 —— 导入是整包覆盖，必须先确认（§6v）')

  // 2) 实跑：往返一致 + 拒收三连 + 计划清空
  const mem6v = {}
  const hadWx6v = typeof global.wx !== 'undefined'
  const savedWx6v = global.wx
  global.wx = {
    getStorageSync: (k) => mem6v[k],
    setStorageSync: (k, v) => { mem6v[k] = v },
    removeStorageSync: (k) => { delete mem6v[k] }
  }
  try {
    const st6v = require('./utils/storage.js')
    ;['exportUserData', 'importUserData', 'isBackupText'].forEach((fn) => {
      if (typeof st6v[fn] !== 'function') E('storage 没导出 ' + fn)
    })
    if (typeof st6v.exportUserData === 'function' && typeof st6v.importUserData === 'function') {
      // 源机数据：含 bad（安全底线）、observing（应升 safe）、非法状态（应滤掉）、
      // foodStart（v2.32 双时钟：首次辅食日期必须随档案整包走）
      mem6v[st6v.KEYS.BABY] = { name: '臭宝', birthday: '2025-01-01', foodStart: '2025-06-15' }
      mem6v[st6v.KEYS.STATUS] = ['constipation', '不存在的key']
      mem6v[st6v.KEYS.INTRO] = [
        { foodId: 'pumpkin', date: '2025-07-01', status: 'safe' },
        { foodId: 'egg_yolk', date: '2025-07-02', status: 'bad' },
        { foodId: 'apple', date: '2025-07-03', status: 'observing' }
      ]
      mem6v[st6v.KEYS.MEALS] = [{ date: '2025-07-01', recipeId: 'r_pumpkin_puree', status: 'full', reaction: '', at: 1 }]
      mem6v[st6v.KEYS.PLAN] = { generatedAt: 1, days: [] }

      const text6v = st6v.exportUserData()
      if (typeof text6v !== 'string' || !st6v.isBackupText(text6v))
        E('exportUserData 产出的文本过不了 isBackupText —— 导出与辨认口径不一致')

      // 换机模拟：清空本机 → 导入
      ;[st6v.KEYS.BABY, st6v.KEYS.STATUS, st6v.KEYS.INTRO, st6v.KEYS.MEALS, st6v.KEYS.PLAN]
        .forEach((k) => { delete mem6v[k] })
      if (st6v.importUserData(text6v) !== true)
        E('importUserData 导入自己的导出文本失败 —— 往返不一致，换机会丢数据')
      const b6v = mem6v[st6v.KEYS.BABY] || {}
      if (b6v.name !== '臭宝' || b6v.birthday !== '2025-01-01')
        E('导入后档案（名称/生日）没还原')
      if (b6v.foodStart !== '2025-06-15')
        E('导入后首次辅食日期（foodStart）没还原 —— v2.32 双时钟字段在导入侧丢了')
      if ((mem6v[st6v.KEYS.STATUS] || []).join(',') !== 'constipation')
        E('导入后状态没还原成合法 key 集合')
      const in6v = mem6v[st6v.KEYS.INTRO] || []
      const egg6v = in6v.filter((x) => x.foodId === 'egg_yolk')[0]
      if (!egg6v || egg6v.status !== 'bad' || egg6v.date !== '2025-07-02')
        E('导入后 bad（有反应）记录没还原 —— 过敏排除是安全底线，备份必须带上')
      const ap6v = in6v.filter((x) => x.foodId === 'apple')[0]
      if (!ap6v || ap6v.status !== 'safe')
        E('导入没把 observing 升成 safe —— 与 v2.30「observing 绝版」口径不一致')
      if ((mem6v[st6v.KEYS.MEALS] || []).length !== 1)
        E('导入后喂养打卡没还原')
      if (mem6v[st6v.KEYS.PLAN])
        E('导入后 bb_plan 没被清空 —— 旧计划是按旧数据生成的，导入后必须重算')

      // 拒收三连：垃圾文本 / 别家标记 / 不支持的版本
      ;['随便一段文本', '{"app":"other","fmt":1}', '{"app":"choubao-fushi","fmt":99}'].forEach((t, i) => {
        if (st6v.isBackupText(t)) E(`isBackupText 误收了第 ${i + 1} 段非备份文本`)
        if (st6v.importUserData(t) !== false)
          E(`importUserData 没拒收第 ${i + 1} 段非备份/错版本文本 —— 会把脏数据写进存储`)
      })
    }
  } finally {
    if (hadWx6v) global.wx = savedWx6v
    else delete global.wx
  }

  if (errs.length === errsBefore)
    console.log('  6v 数据备份（方案A 零后端）：storage 导出/导入/预检接线 ✓、信封标记+版本+派生缓存不进备份 ✓、导入清 bb_plan ✓、observing→safe 清洗口径 ✓、档案页按钮+导入前确认框 ✓、无网络调用(隐私未采集) ✓、往返一致+拒收三连实跑 ✓、foodStart 随档案走 ✓')
}

/* ---------- 6w. 首次辅食日期 · 双时钟（v2.32 · 用户四项拍板） ----------
 * 四条决策（2026-10 用户拍板）：
 *   ① 选填：没填 foodStart = 按生日推算（= v2.31 及以前行为，存量用户
 *      零打扰、指纹不变、不触发重算）；
 *   ② 分流：辅食钟排节奏（计划 months / MENU_6 锚定日 / 6–12 月知识卡 /
 *      滑动页 6–12 页落页 / 引入门 minMonth），生理钟管安全与事实
 *      （年龄文案 ageText、「1 岁以上」卡与落页 = phys ≥13）；
 *   ③ 下限 = 出生 + 4 个月（公开指南「最早不早于 4 月龄」），且有清除通道能回退到
 *      现状口径；**面板自建**（v3.0 用户 2026-10-15 追加：原生 picker 顶栏只有
 *      「取消 / 确定」，放不下「清除」第三个按钮 → 换 picker-view + 顶栏
 *      「取消 / 清除 / 确定」，清除仅在已选过日期后生效）；三列裁切走纯函数
 *      age.dateColumns（越界值不进列表，§6w 实跑）；
 *   ④ 首页加「辅食第 N 个月」副文案，解释两个数字的关系。
 * 源码钉：age.foodMonthsOf 唯一分流入口；白名单三处（setBaby / 导入清洗 /
 *   档案页接线）；纯节奏类页不留「按生日直算月龄」旧写法；index 缓存比对
 *   用 fm（与引擎 p.months 同口径）。
 * 实跑：回退=现状、晚开始不跳级、4 月龄边界推算、缺生日 null、
 *   填 foodStart 改变指纹（自动重算一次）、planInputs 锚字段拆分
 *   （birth 仍是生日 / foodStart 单独带出）、menuDayFrom 直锚的用户实测场景
 *   （5 月龄宝宝 10/13 开荤 → 10/13 = 菜单第 1 天、10/14 = 第 2 天 ——
 *   修正前把 foodStart 当生日 +6 个月错位，菜单锁失效首日排出山药泥）、
 *   menuDayOf 兼容路径（生日 + 6 月）逐字不变。
 */
{
  const errsBefore = errs.length
  const aj6w = fs.readFileSync('./utils/age.js', 'utf8')
  const sj6w = fs.readFileSync('./utils/storage.js', 'utf8')
  const pj6w = fs.readFileSync('./utils/plan.js', 'utf8')
  const ij6w = fs.readFileSync('./pages/index/index.js', 'utf8')
  const iw6w = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const mj6w = fs.readFileSync('./pages/months/months.js', 'utf8')
  const fj6w = fs.readFileSync('./pages/food/food.js', 'utf8')
  const fdj6w = fs.readFileSync('./pages/food-detail/food-detail.js', 'utf8')
  const pjw6w = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const pww6w = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')

  // 1) 唯一分流入口 + 节奏类页面接线
  if (aj6w.indexOf('function foodMonthsOf') < 0 || aj6w.indexOf('foodMonthsOf,') < 0)
    E('age.js 缺 foodMonthsOf / 没导出 —— 双时钟没有唯一分流入口')
  ;[['./pages/food/food.js', fj6w], ['./pages/food-detail/food-detail.js', fdj6w],
    ['./pages/index/index.js', ij6w], ['./pages/months/months.js', mj6w],
    ['./pages/profile/profile.js', pjw6w]].forEach((t) => {
      if (t[1].indexOf('age.foodMonthsOf') < 0)
        E(t[0] + ' 没走 age.foodMonthsOf —— 节奏类逻辑必须用辅食月龄（v2.32 双时钟）')
    })
  // 纯节奏类页（食材清单/详情）不得再留「按生日直算月龄」旧写法
  ;[['food.js', fj6w], ['food-detail.js', fdj6w]].forEach((t) => {
    if (t[1].indexOf('monthsBetween(baby.birthday)') >= 0)
      E(t[0] + ' 还在按生日直算月龄 —— 月龄门要用辅食月龄（v2.32 双时钟）')
  })

  // 2) 白名单三处
  if (sj6w.indexOf("hasOwnProperty.call(patch, 'foodStart')") < 0)
    E('storage.setBaby 没放行 foodStart —— 档案页存不下首次辅食日期')
  if (sj6w.indexOf('foodStart: typeof pack.baby.foodStart') < 0)
    E('importUserData 没清洗 foodStart —— 导入会丢首次辅食日期（换机丢数据）')
  if (pjw6w.indexOf('openFoodPicker') < 0 || pjw6w.indexOf('confirmFoodPicker') < 0 ||
      pjw6w.indexOf('onClearFoodStart') < 0 ||
      pww6w.indexOf('bindtap="openFoodPicker"') < 0 ||
      pww6w.indexOf('bindtap="confirmFoodPicker"') < 0 ||
      pww6w.indexOf('bindtap="onClearFoodStart"') < 0)
    E('档案页缺首次辅食日期的选择/清除接线 —— 选填字段必须能填也能回退')
  if (pjw6w.indexOf('foodMinOf') < 0 || pjw6w.indexOf('getMonth() + 4') < 0)
    E('档案页面板下限不是「出生 + 4 个月」（公开指南最早不早于 4 月龄）')

  // 2b) 自建面板（v3.0，用户 2026-10-15 拍板：把「清除」提到选择面板顶栏）
  //     原生 picker 顶栏只有「取消 / 确定」两个位置，放不下第三个按钮 ——
  //     首次辅食日期必须换成 picker-view + 自定顶栏「取消 / 清除 / 确定」；
  //     全页只剩「出生日期」一个原生日期 picker（mode="date" 恰好一处）。
  //     裁切是纯函数 age.dateColumns（列表里没有非法值，不靠事后校验兜）。
  // 全页原生日期 picker 恰好一处：出生日期
  // （首次辅食日期 2026-10-15 已改成自建面板，不许再变回 mode="date"；
  //  身高体重面板的「测量日期」v3.2 随面板搬到首页，不在这里了）
  if ((pww6w.match(/mode="date"/g) || []).length !== 1 ||
      pww6w.indexOf('bindchange="onDateChange"') < 0)
    E('档案页原生日期 picker 数目不对 —— 只应有「出生日期」一处（首次辅食日期走自建面板，§6w；测量日期面板已搬首页）')
  if (pww6w.indexOf('bindchange="onMetricDate"') >= 0)
    E('档案页又出现测量日期 picker —— 测量面板已搬到首页（v3.2）')
  if (pww6w.indexOf('bindchange="onFoodStartChange"') >= 0)
    E('首次辅食日期又变回原生 picker 了 —— 已改自建面板（§6w）')
  ;[['picker-view', pww6w], ['picker-view-column', pww6w], ['pvValue', pww6w],
    ['bindchange="onFoodPickerChange"', pww6w], ['foodPickerOpen', pww6w],
    ['age.dateColumns', pjw6w]].forEach((t) => {
    if (t[1].indexOf(t[0]) < 0)
      E('首次辅食日期自建面板缺 ' + t[0] + ' —— 面板接线断了（§6w）')
  })
  if (aj6w.indexOf('function dateColumns') < 0 || aj6w.indexOf('dateColumns,') < 0)
    E('age.js 缺 dateColumns / 没导出 —— 面板三列裁切没有纯函数落点（§6w）')
  // 清除按钮：只在「已经选过首次辅食日期」之后生效（用户 2026-10-15 口径）
  if (pjw6w.indexOf('if (!this.data.foodStart) return') < 0)
    E('清除按钮没挡住「还没选过日期」的情况 —— 用户要求选定了首次辅食日期之后才生效（§6w）')
  if (pww6w.indexOf('fs-head-off') < 0)
    E('清除按钮没接置灰态 —— 没选过日期时看不出不可点（§6w）')

  // 3) 分流接线
  if (mj6w.indexOf('phys >= 13') < 0)
    E('months.js 落页没按生理 ≥13 分流 —— 晚开始宝宝的 1 岁+页会判错')
  if (ij6w.indexOf('phys >= 13 ? guides.onePlus') < 0)
    E('index.js 「1 岁以上」卡没按生理月龄分流 —— 幼儿期口径必须看生理钟（§6w）')
  // 批⑬（用户 2026-10-16 拍板）：这条副文案从首页删了 —— 双时钟的事实没有变
  // （「我的」的首次辅食日期行、计划口径照旧），首页只是不再复述；
  // 剥注释再扫：我们自己在 index.js 注释里留了字段名做删除记录
  const noC6w = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  if (noC6w(ij6w).indexOf('foodAgeText') >= 0 || iw6w.indexOf('head-food-age') >= 0)
    E('首页又出现了「辅食第 N 个月」副文案 —— 用户 2026-10-16 要求从首页删除（§6w/§6x-22）')
  if (ij6w.indexOf('p.months !== fm') < 0)
    E('index.js 缓存比对没用辅食月龄（fm）—— 与引擎 p.months 口径不一致会反复重算')
  if (pj6w.indexOf('age.foodMonthsOf(baby)') < 0)
    E('planInputs 没切到辅食钟 —— 计划节奏没跟辅食月龄（v2.32 双时钟）')
  // MENU_6 锚修正（用户实测抓出）：辅食开始日**直锚**（menuDayFrom，别 +6 个月）；
  // 没填时锚 = 生日 + 6 个月（menuDayOf 原语义，兼容路径逐字不变）
  if (pj6w.indexOf('menuDayFrom') < 0 || pj6w.indexOf('plusMonthsKey') < 0)
    E('plan.js 缺 menuDayFrom / plusMonthsKey —— MENU_6 双时钟直锚没有实现')
  if (pj6w.indexOf('opts.foodStart ? menuDayFrom(opts.foodStart, d) : menuDayOf(opts.birth, d)') < 0)
    E('generate 菜单日没按「有辅食日期直锚 / 没填按生日+6月」分流 —— 晚开始宝宝菜单锁失效（用户实测抓过）')
  if (pj6w.indexOf("'fs' + inputs.foodStart") < 0)
    E('foodStart 没进计划指纹 —— 补填/修改辅食日期不触发重算')

  // 4) 实跑：分流语义（固定 now，跑哪天都一样）
  const ag6w = require('./utils/age.js')
  const now6w = new Date('2026-10-14T12:00:00')
  const phys6w = ag6w.monthsBetween('2026-01-01', now6w) // = 9
  if (ag6w.foodMonthsOf({ birthday: '2026-01-01' }, now6w) !== phys6w)
    E('foodMonthsOf 没填辅食日期时没回退生理月龄 —— 存量用户行为会变（必须零打扰）')
  const late6w = ag6w.foodMonthsOf({ birthday: '2026-01-01', foodStart: '2026-09-01' }, now6w)
  if (late6w !== 7)
    E(`晚开始场景辅食月龄 = ${late6w}，期望 7（辅食 6 月龄起 + 满 1 个月）`)
  if (!(late6w < phys6w))
    E('晚开始场景辅食月龄没有落后生理月龄 ——「不跳级」的核心价值丢了')
  const early6w = ag6w.foodMonthsOf({ birthday: '2026-01-01', foodStart: '2026-05-01' }, now6w)
  if (early6w !== 11)
    E(`4 月龄边界场景辅食月龄 = ${early6w}，期望 11（出生+4 月开始，辅食钟超前生理）`)
  if (ag6w.foodMonthsOf({ foodStart: '2026-05-01' }, now6w) !== null)
    E('foodMonthsOf 缺生日时应返回 null（两钟都无从谈起）')

  // 实跑：自建面板的三列裁切（纯函数，不带 now —— 跑哪天都一样）
  const dc6w = ag6w.dateColumns
  const cA6w = dc6w('2026-02-10', '2026-04-05', 2026, 3, 20)
  if (!cA6w || cA6w.years.join() !== '2026' || cA6w.months.join() !== '2,3,4' ||
      cA6w.days.length !== 31 || cA6w.days[0] !== 1 || cA6w.value.join() !== '0,1,19')
    E('dateColumns：同年区间裁错了 —— 面板会给出界外的月份/日或错的下标（§6w）')
  const cB6w = dc6w('2025-11-20', '2026-02-10', 2026, 3, 30)
  if (!cB6w || cB6w.years.join() !== '2025,2026' || cB6w.months.join() !== '1,2' ||
      cB6w.days.join() !== '1,2,3,4,5,6,7,8,9,10' || cB6w.value.join() !== '1,1,9')
    E('dateColumns：跨年/越界没夹进区间 —— 面板能滚到今天之后（§6w）')
  const cC6w = dc6w('2024-02-01', '2024-02-29', 2024, 2, 29)
  if (!cC6w || cC6w.days.length !== 29 || cC6w.days[28] !== 29 || cC6w.value.join() !== '0,0,28')
    E('dateColumns：闰年 2 月没出 29 日 —— 闰年宝宝的区间少一天（§6w）')
  const cD6w = dc6w('2026-10-15', '2026-10-15', 2026, 10, 15)
  if (!cD6w || cD6w.years.length !== 1 || cD6w.months.join() !== '10' ||
      cD6w.days.join() !== '15' || cD6w.value.join() !== '0,0,0')
    E('dateColumns：下限 = 上限（今天刚满 4 个月）时应只剩一天可选（§6w）')
  if (dc6w('2026-11-01', '2026-10-15', 2026, 11, 1) !== null)
    E('dateColumns：下限晚于今天（还不满 4 个月）应返回 null —— 否则面板给出一堆未来日期（§6w）')
  if (dc6w('2026-02-10', '2026-04-05', 2026, 13, 0) === null)
    E('dateColumns：月/日越界时应夹进区间而不是返回 null（§6w）')

  // 指纹自愈：填 foodStart → 锚定日变 → 签名变（自动重算一次）；
  // 没填 → birth = 生日、签名与 v2.31 完全一致（零重算零打扰）
  const mkS6w = (baby) => ({
    getBaby: () => baby,
    getIssues: () => [], getSick: () => false,
    safeFoodIds: () => [], badFoodIds: () => [],
    recordedFoodIds: () => [], observingFoodIds: () => [],
    refusedRecipeIds: () => []
  })
  const noFS6w = plan.planSignature(mkS6w({ name: '测试', birthday: '2026-01-01' }))
  const withFS6w = plan.planSignature(mkS6w({ name: '测试', birthday: '2026-01-01', foodStart: '2026-09-01' }))
  if (!noFS6w || !withFS6w || noFS6w === withFS6w)
    E('foodStart 没进计划指纹 —— 补填辅食日期不触发重算，计划还按旧月龄排')
  const inp6w = plan.planInputs(mkS6w({ name: '测试', birthday: '2026-01-01', foodStart: '2026-09-01' }))
  if (!inp6w || inp6w.birth !== '2026-01-01' || inp6w.foodStart !== '2026-09-01')
    E('planInputs 锚定字段错了 —— birth 应仍是生日、foodStart 单独带出（v2.32 修正）')
  if (!inp6w || inp6w.months !== 6 + ag6w.monthsBetween('2026-09-01'))
    E('planInputs 的 months 没按辅食月龄算 —— 计划节奏没切到辅食钟')

  // 用户实测场景（v2.32 修正回归钉）：宝宝 2026-05-06 生、2026-10-13 开始吃辅食
  // —— 10/13 = MENU_6 第 1 天（强化铁米粉糊）、10/14 = 第 2 天；对 foodStart
  // +6 个月会错位到 2027-04-13、菜单锁失效（当时首日排出山药泥，就是这个 bug）
  if (plan.menuDayFrom('2026-10-13', '2026-10-13') !== 1)
    E('menuDayFrom：辅食开始日当天不是菜单第 1 天 —— 双时钟直锚错了')
  if (plan.menuDayFrom('2026-10-13', '2026-10-14') !== 2)
    E('menuDayFrom：开始次日不是菜单第 2 天 —— 用户实测场景没过（菜单锁仍错位）')
  if (plan.menuDayOf('2026-05-06', '2026-11-06') !== 1)
    E('menuDayOf 兼容路径变了 —— 没填辅食日期时「锚 = 生日 + 6 个月」的原语义必须逐字保持')

  if (errs.length === errsBefore)
    console.log('  6w 首次辅食日期·双时钟(v2.32)：foodMonthsOf 唯一分流入口 ✓、没填回退=现状 ✓、白名单三处(setBaby/导入/档案页) ✓、面板自建(取消/清除/确定,清除仅已选后生效)+下限出生+4月 ✓、dateColumns 裁切实跑(同年/跨年夹取/闰年2月/单日/下限>今天) ✓、节奏=辅食钟/1岁+=生理≥13 ✓、MENU_6 锚=辅食开始日直锚(+6错位修正+用户场景实跑) ✓、首页辅食副文案 ✓、指纹自愈(含 fs 分量)实跑 ✓')
}

/* ---------- 6x. 成长曲线 · 数据层（v3.0 批①） ----------
 * 红线：只做记录与展示，不做营养评估 —— 生长数据绝不进 planSignature
 *   （记一次体重就重排整份周计划 = 脏耦合，§6x-5 钉死）。
 * 批①只动数据层：bb_growth + 档案三字段(sex/birthWeight/birthLength) +
 *   备份 fmt2（fmt1 老备份要能导，不逼老用户重录）。
 * 实跑：同日覆写/排序/归一 ✓、日期闸门（未来点/出生前点拒收）✓、
 *   区间拒收（越界值不进库）✓、resetAll 清 bb_growth ✓、
 *   备份往返一致 + fmt1 兼容 + 脏条目丢弃 ✓、
 *   planSignature 对生长记录不敏感 ✓。
 * 照片：决策④（入口）本版不接线；照片本体 2026-10-15 批⑦ 已接 chooseMedia
 *   （只存一张，固定路径覆盖写）—— 页面层钉见批④/批⑦（§6x-14/17）。
 * 分享：2026-10-15 批⑧ —— 5 内容页双钩子、内容型标题、自动截当前页（§6x-18）。
 */
{
  const errsBefore = errs.length
  const sj6x = fs.readFileSync('./utils/storage.js', 'utf8')
  const pj6x = fs.readFileSync('./utils/plan.js', 'utf8')
  const prj6x = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  const prw6x = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')

  // 1) 源码接线：数据层 5 个函数 + 3 个档案字段白名单
  ;['function getGrowth', 'function setGrowth', 'function upsertGrowthRecord',
    'function removeGrowthRecord', 'function cleanGrowthEntry'].forEach((fn) => {
    if (sj6x.indexOf(fn) < 0) E('storage.js 缺 ' + fn + ' —— v3.0 成长曲线数据层没接线')
  })
  ;['sex', 'birthWeight', 'birthLength'].forEach((k) => {
    if (sj6x.indexOf(`hasOwnProperty.call(patch, '${k}')`) < 0)
      E(`storage.setBaby 白名单没放行 ${k} —— 档案页存不下生长曲线前置字段`)
  })
  if (sj6x.indexOf('KEYS.GROWTH, growth') < 0)
    E('importUserData 没写回 bb_growth —— 导入会丢生长记录')
  if (sj6x.indexOf('growth: getGrowth()') < 0)
    E('exportUserData 没导出 growth —— 备份会丢生长记录')
  if (sj6x.indexOf('removeStorageSync(KEYS.GROWTH)') < 0)
    E('resetAll 没清 bb_growth —— 「清除全部数据」会残留曲线记录')
  // 备份 fmt2 + 老备份兼容
  if (!/BACKUP_FMT\s*=\s*2/.test(sj6x)) E('备份 fmt 没升到 2 —— v3.0 新增 growth 段必须升版本')
  if (sj6x.indexOf('pack.fmt >= BACKUP_FMT_MIN') < 0)
    E('isBackupText 只认单一 fmt —— fmt1 老备份会被拒，老用户换机丢数据')
  // 档案页控件接线
  ;['onSexPick', 'onBirthWeight', 'onBirthLength'].forEach((fn) => {
    if (prj6x.indexOf(fn) < 0) E('profile.js 缺 ' + fn + ' —— 档案页生长前置字段没接线')
    if (prw6x.indexOf(fn) < 0) E('profile.wxml 没接 ' + fn + ' —— 控件是死的')
  })

  // 2) plan.js 不许引用生长数据（红线反向钉）
  if (/GROWTH|getGrowth|upsertGrowthRecord|cleanGrowthEntry/.test(pj6x))
    E('plan.js 引用了生长数据 —— 生长记录不进计划输入/指纹，记一次体重就重排周计划（红线）')

  // 3) 实跑：wx 桩
  const mem6x = {}
  const hadWx6x = typeof global.wx !== 'undefined'
  const savedWx6x = global.wx
  global.wx = {
    getStorageSync: (k) => mem6x[k],
    setStorageSync: (k, v) => { mem6x[k] = v },
    removeStorageSync: (k) => { delete mem6x[k] }
  }
  try {
    const st6x = require('./utils/storage.js')

    // 先落 baby（走 setBaby，读写同源）：日期闸门（未来点/出生前点）依赖生日，
    // 别让 upsert 因缺档案误放行
    st6x.setBaby({ name: '臭宝', birthday: '2025-01-01' })

    // 同日覆写：一条日期只留最后一次
    st6x.upsertGrowthRecord({ date: '2025-01-01', weight: 3.2, length: 50 })
    st6x.upsertGrowthRecord({ date: '2025-01-01', weight: 3.5, length: 51 })
    const g6x = st6x.getGrowth()
    if (g6x.length !== 1 || g6x[0].weight !== 3.5)
      E('同日覆写失效 —— 一条日期存了两条记录（应留最后一次）')

    // 排序 + 归一：乱序录入，读出按 date 升序、数值 1 位小数。
    // 注意 getGrowth() 会保留同日那条（01-01），所以排序后共 3 条，别写死 2。
    st6x.upsertGrowthRecord({ date: '2025-03-01', weight: 6.666, length: 63 })
    st6x.upsertGrowthRecord({ date: '2025-02-01', weight: 5, length: 58 })
    const gs6x = st6x.getGrowth()
    if (gs6x.length !== 3 || gs6x[0].date !== '2025-01-01' ||
        gs6x[1].date !== '2025-02-01' || gs6x[2].date !== '2025-03-01')
      E('getGrowth 没按 date 升序 —— 曲线横轴会乱序')
    if (gs6x[2].weight !== 6.7) E('体重没归一到 1 位小数（6.666 → ' + gs6x[2].weight + '）')

    // 日期闸门：未来点 / 出生前点拒收（baby 已在段首落好）
    if (st6x.upsertGrowthRecord({ date: '2099-01-01', weight: 7 }) !== false)
      E('未来日期记录没被拒 —— 曲线会画出图外的点')
    if (st6x.upsertGrowthRecord({ date: '2024-12-31', weight: 3 }) !== false)
      E('出生前日期记录没被拒 —— 日龄为负，曲线起点错位')

    // 区间拒收：越界值不进库（脏数据比空着更坏）
    if (st6x.upsertGrowthRecord({ date: '2025-02-15', weight: 999 }) !== false)
      E('越界体重（999kg）没被拒 —— 手滑单位错会画出假曲线')
    if (st6x.upsertGrowthRecord({ date: '2025-02-15', length: 5 }) !== false)
      E('越界身长（5cm）没被拒')

    // 至少一项指标有值才成条
    if (st6x.upsertGrowthRecord({ date: '2025-02-20' }) !== false)
      E('三项全空的记录没被拒 —— 空条目在列表里是死行')

    // removeGrowthRecord：删之前先确认库里有 3 条（01-01/02-01/03-01），删 04-01 这条
    // 只是为了验证「删一个不存在的日期不影响已有记录」。removeGrowthRecord 无返回值，
    // 别拿它当布尔断言。
    st6x.upsertGrowthRecord({ date: '2025-04-01', weight: 7 })
    st6x.removeGrowthRecord('2025-04-01')
    if (st6x.getGrowth().length !== 3)
      E('removeGrowthRecord 没删掉指定日期 —— 列表页删除会失效')

    // resetAll 清 bb_growth
    st6x.resetAll()
    if (Array.isArray(mem6x[st6x.KEYS.GROWTH]) && mem6x[st6x.KEYS.GROWTH].length)
      E('resetAll 没清 bb_growth —— 清除全部数据后曲线残留')

    // 备份往返：growth + 3 档案字段都要跟着走（走 setBaby/setGrowth，读写同源）
    st6x.setBaby({ name: '臭宝', birthday: '2025-01-01', sex: 'm', birthWeight: 3.2, birthLength: 50 })
    st6x.setGrowth([{ date: '2025-01-01', weight: 3.2, length: 50 }])
    const pack6x = JSON.parse(st6x.exportUserData())
    if (pack6x.fmt !== 2 || !Array.isArray(pack6x.growth) || pack6x.growth.length !== 1)
      E('exportUserData 没导出 fmt2 + growth —— 备份丢曲线')
    if (pack6x.baby.sex !== 'm' || pack6x.baby.birthWeight !== 3.2)
      E('导出生长前置字段（sex/birthWeight）丢了')
    mem6x[st6x.KEYS.BABY] = null
    mem6x[st6x.KEYS.GROWTH] = []
    if (st6x.importUserData(JSON.stringify(pack6x)) !== true)
      E('importUserData 没导回自己的导出 —— 换机会丢曲线')
    if (st6x.getGrowth().length !== 1 || st6x.getGrowth()[0].weight !== 3.2)
      E('导入后 bb_growth 没还原 —— 换机会丢曲线记录')
    if (st6x.getBaby().sex !== 'm' || st6x.getBaby().birthLength !== 50)
      E('导入后生长前置字段没还原')

    // fmt1 老备份要能导（不逼老用户重录），growth 落成空数组
    const legacy6x = { app: 'choubao-fushi', fmt: 1, at: 1, baby: { name: '老宝', birthday: '2025-01-01' }, statuses: [], introduced: [], mealLogs: [] }
    if (st6x.importUserData(JSON.stringify(legacy6x)) !== true)
      E('fmt1 老备份被拒 —— 升 fmt2 把老用户换机路堵死了')
    if (st6x.getGrowth().length !== 0)
      E('fmt1 老备份导入后 growth 不是空数组 —— 应落成 [] 而非 undefined')

    // 脏条目丢弃：越界 / 坏日期 / 全空都不进库
    const dirty6x = { app: 'choubao-fushi', fmt: 2, at: 1, baby: null, statuses: [], introduced: [], mealLogs: [],
      growth: [{ date: '2025-01-01', weight: 3.2 }, { date: 'bad-date', weight: 3 }, { date: '2025-02-01', weight: 999 }, { date: '2025-03-01' }] }
    if (st6x.importUserData(JSON.stringify(dirty6x)) !== true)
      E('脏备份整体被拒 —— 应逐条清洗而非整包拒收')
    if (st6x.getGrowth().length !== 1)
      E('脏条目没被清洗 —— 坏日期/越界值进了库（应只留 1 条合法）')

    // 4) planSignature 不敏感（红线）
    const babySig6x = { name: '臭宝', birthday: '2025-01-01' }
    const mkSt6x = (baby) => ({
      getBaby: () => baby,
      getIssues: () => [], getSick: () => false,
      safeFoodIds: () => [], badFoodIds: () => [],
      recordedFoodIds: () => [], observingFoodIds: () => [],
      refusedRecipeIds: () => []
    })
    const beforeSig6x = plan.planSignature(mkSt6x(babySig6x))
    st6x.upsertGrowthRecord({ date: '2025-05-01', weight: 7.5, length: 66 })
    const afterSig6x = plan.planSignature(mkSt6x(babySig6x))
    if (beforeSig6x !== afterSig6x)
      E('planSignature 对生长记录敏感 —— 记一次体重就重排整份周计划（红线）')
  } finally {
    if (hadWx6x) global.wx = savedWx6x
    else delete global.wx
  }

  /* ---- 6x · 批②：计算层（WHO 官方表 + utils/growth.js，纯函数无 wx）---- */

  // 6) 双时钟：日龄只走 age.daysBetween（生理钟），与辅食钟零关系
  const gj6x = fs.readFileSync('./utils/growth.js', 'utf8')
  const agj6x = fs.readFileSync('./utils/age.js', 'utf8')
  if (agj6x.indexOf('function daysBetween') < 0)
    E('age.js 缺 daysBetween —— 生理日龄必须收口在 age.js（双时钟唯一入口）')
  if (gj6x.indexOf('daysBetween') < 0 || gj6x.indexOf("require('./age')") < 0)
    E('growth.js 没走 age.daysBetween —— 生长曲线必须用生理钟（§6w 分流表）')
  if (gj6x.indexOf('foodStart') >= 0 || gj6x.indexOf('foodMonthsOf') >= 0)
    E('growth.js 引用了辅食钟 —— 生长属「安全与事实类」，横轴只认出生日期')

  // 8) WHO 表结构（6 表 × 61 月龄点）+ 官方中位锚点（容差兜底抄错/截断/串表）
  const wj6x = require('./data/who-growth.js')
  ;[['wfa', 'male'], ['wfa', 'female'], ['lhfa', 'male'], ['lhfa', 'female'],
    ['hcfa', 'male'], ['hcfa', 'female']].forEach((t) => {
    const tbl = (wj6x[t[0]] || {})[t[1]]
    if (!Array.isArray(tbl) || tbl.length !== 61) {
      E(`WHO 表 ${t[0]}.${t[1]} 不是 61 个月龄点（0–60 月）`)
      return
    }
    for (let i = 0; i < tbl.length; i++) {
      const tri = tbl[i]
      if (!Array.isArray(tri) || tri.length !== 3 || tri.some((v) => !isFinite(v))) {
        E(`WHO 表 ${t[0]}.${t[1]}[${i}] 不是三个有限数值`)
        continue
      }
      if (!(tri[2] > 0 && tri[2] < 1))
        E(`WHO 表 ${t[0]}.${t[1]}[${i}] 的 S 越界（${tri[2]}）—— 表可能抄坏`)
      if (i > 0 && !(tri[1] > tbl[i - 1][1]))
        E(`WHO 表 ${t[0]}.${t[1]} 中位数不是严格递增（第 ${i} 月）—— 表可能串行/截断`)
    }
  })
  const anch6x = [
    ['wfa', 'male', 0, 3.3464, 0.02, '男·出生体重中位'],
    ['wfa', 'male', 6, 7.94, 0.03, '男·6 月龄体重中位'],
    ['wfa', 'male', 12, 9.646, 0.03, '男·12 月龄体重中位'],
    ['wfa', 'female', 12, 8.946, 0.03, '女·12 月龄体重中位'],
    ['wfa', 'male', 60, 18.34, 0.05, '男·60 月龄体重中位'],
    ['lhfa', 'male', 12, 75.74, 0.1, '男·12 月龄身长中位'],
    ['hcfa', 'male', 0, 34.46, 0.1, '男·出生头围中位'],
    ['hcfa', 'female', 0, 33.88, 0.1, '女·出生头围中位']
  ]
  anch6x.forEach((a) => {
    const tri = ((wj6x[a[0]] || {})[a[1]] || [])[a[2]]
    if (!Array.isArray(tri)) { E(`WHO 锚点 ${a[5]}：表不存在`); return }
    if (Math.abs(tri[1] - a[3]) > a[4])
      E(`WHO 锚点 ${a[5]}对不上：中位=${tri[1]}，期望≈${a[3]}±${a[4]} —— 表转录错了`)
  })

  // 计算层实跑（纯函数，不需要 wx 桩）
  const gjs6x = require('./utils/growth.js')

  // 9) 六带边界：lo 闭 hi 开，P3/P10/P50/P90/P97 各归其带 + 标签中性词表
  const bandExp6x = [
    [0, 'P3 以下'], [2.999, 'P3 以下'], [3, 'P3–P10'], [9.999, 'P3–P10'],
    [10, 'P10–P50'], [49.999, 'P10–P50'], [50, 'P50–P90'], [89.999, 'P50–P90'],
    [90, 'P90–P97'], [96.999, 'P90–P97'], [97, 'P97 以上'], [100, 'P97 以上']
  ]
  bandExp6x.forEach((b) => {
    const got = gjs6x.bandOf(b[0])
    if (!got || got.label !== b[1])
      E(`bandOf(${b[0]}) = ${got ? got.label : 'null'}，应为 ${b[1]} —— 区间边界归属变了`)
  })
  gjs6x.BANDS.forEach((b) => {
    if (/偏瘦|偏胖|肥胖|营养不良|发育迟缓|落后|正常|异常|健康|达标|矮小|超重/.test(b.label))
      E(`区间标签混进评价词：${b.label} —— 红线「不做营养评估」`)
  })

  // 10) 0–60 月闸门 + 缺性别/缺数值/未知指标一律不出百分位
  if (gjs6x.metricAt('weight', 7, 0, 'm') === null)
    E('0 日龄算不出百分位 —— 出生点被闸门误挡')
  if (gjs6x.metricAt('weight', 7, 1826, 'm') === null)
    E('60 月龄算不出百分位 —— 0–60 覆盖尾点被挡')
  if (gjs6x.metricAt('weight', 7, 1857, 'm') !== null)
    E('61 月龄还在出百分位 —— 已超出 WHO 0–5 岁表（0–60 闸门失效）')
  if (gjs6x.metricAt('weight', 7, -1, 'm') !== null)
    E('负日龄出百分位 —— 出生前的点不该有数')
  if (gjs6x.metricAt('weight', 7, 100, '') !== null || gjs6x.metricAt('weight', 7, 100, 'x') !== null)
    E('缺性别/非法性别还在出百分位 —— 会查错表（红线闸门）')
  if (gjs6x.metricAt('weight', null, 100, 'm') !== null)
    E('缺数值出百分位')
  if (gjs6x.metricAt('nope', 7, 100, 'm') !== null)
    E('未知指标出百分位')
  // LMS 链路端到端自洽：量到中位数 = P50
  const atMed6x = gjs6x.metricAt('weight', wj6x.wfa.male[0][1], 0, 'm')
  if (!atMed6x || Math.abs(atMed6x.p - 50) > 0.01)
    E('量到中位数不是 P50 —— z/百分位链路算错（p=' + (atMed6x ? atMed6x.p.toFixed(3) : 'null') + '）')
  const edge6x = gjs6x.metricAt('weight', 4.5, 30, 'f')
  if (!edge6x || edge6x.p < 0 || edge6x.p > 100 || !edge6x.band)
    E('正常输入算不出合法百分位/区间 —— 计算链断了')

  // 6b) 双时钟实跑：填不填 foodStart，同一记录的百分位必须逐字一致
  const baby6x = { name: '测试', birthday: '2026-01-01', sex: 'm' }
  const recs6x = [{ date: '2026-07-01', weight: 8, length: 68 }]
  const pt6x = gjs6x.pointsFor(recs6x, 'weight', baby6x)
  const ptFs6x = gjs6x.pointsFor(recs6x, 'weight',
    Object.assign({}, baby6x, { foodStart: '2026-05-01' }))
  if (!pt6x.length || pt6x[0].p === null)
    E('合法记录算不出百分位 —— pointsFor 链路断了')
  else if (pt6x[0].days !== 181)
    E('daysBetween 日龄算错：2026-01-01 → 2026-07-01 应 181 天，实得 ' + pt6x[0].days)
  if (JSON.stringify(pt6x) !== JSON.stringify(ptFs6x))
    E('填了 foodStart 百分位就变 —— 生长曲线串了辅食钟（双时钟分流表红线）')
  // 缺性别的点标 no_sex、p 为 null —— 页面据此「只出记录、不出百分位」（§6x-7 前置）
  const ns6x = gjs6x.pointsFor(recs6x, 'weight', { birthday: '2026-01-01', sex: '' })
  if (!ns6x.length || ns6x[0].reason !== 'no_sex' || ns6x[0].p !== null)
    E('缺性别的点没标 no_sex —— 页面没法只显示记录、不出百分位')

  /* ---- 6x · 批③：曲线页 pages/growth（§6x-7/11/12/13 + 画图链路 + 三项决策钉）---- */

  // 注册：进 pages、不进 tabBar（决策④：本版只注册页面，不加第 4 个 tab；
  //       v3.5 起「不加 tab」仍有效，但「零入口」已作废 —— 入口在「我的」页）
  if (appJson.pages.indexOf('pages/growth/growth') < 0)
    E('app.json 没注册 pages/growth/growth —— 曲线页进不了包')
  ;(appJson.tabBar.list || []).forEach((t) => {
    if (t.pagePath === 'pages/growth/growth')
      E('生长曲线进了 tabBar —— 决策④：先不加入口，只注册页面')
  })

  const grj6x = fs.readFileSync('./pages/growth/growth.js', 'utf8')
  const grw6x = fs.readFileSync('./pages/growth/growth.wxml', 'utf8')
  // wxss 先剥注释再扫 —— 头注释会写「不许 box-shadow」这类字面量，不能误伤
  const grc6x = fs.readFileSync('./pages/growth/growth.wxss', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  // 7) 页面级性别闸门：曲线渲染过 showChart、缺性别出提示、区间 chip 过 hasSex、
  //    页面不许自己算数学（只吃 growth.pointsFor 的闸门结果）
  if (grj6x.indexOf('hasSex') < 0)
    E('growth.js 没有 hasSex 闸门')
  if (grw6x.indexOf('wx:if="{{showChart}}"') < 0)
    E('growth.wxml 曲线卡没挂 showChart 闸门 —— 缺性别/超范围时曲线会被画出来')
  if (grw6x.indexOf('!hasSex') < 0)
    E('growth.wxml 缺「没填性别」提示分支 —— 用户不知道为什么没曲线')
  if (!/hasBand:\s*!!\(hasSex/.test(grj6x))
    E('growth.js 的区间 chip 没过 hasSex —— 缺性别也会露出区间（红线闸门）')
  if (grj6x.indexOf('pointsFor') < 0)
    E('growth.js 没走 growth.pointsFor —— 页面必须吃现成的闸门与生理日龄')
  if (/percentileOf|zScore|Math\.pow/.test(grj6x))
    E('growth.js 自己算了 z/百分位 —— 数学只能在 utils/growth.js 一处')

  // 画图链路：P50 参考线 == 表内中位数；曲线值回代 metricAt 能还原同一百分位（互逆）
  // （lmsAt 约定入参 'm'/'f'，与页面取 baby.sex 同款）
  ;[3, 10, 50, 90, 97].forEach((p) => {
    const cv = gjs6x.percentileCurve('weight', 'm', p)
    if (!Array.isArray(cv) || cv.length !== gjs6x.MAX_MONTH + 1 || cv.some((v) => !isFinite(v)))
      E('percentileCurve(' + p + ') 没返回 61 个有限值 —— 参考线画不出来')
  })
  const cv50_6x = gjs6x.percentileCurve('weight', 'm', 50)
  if (cv50_6x && Math.abs(cv50_6x[12] - wj6x.wfa.male[12][1]) > 1e-9)
    E('P50 参考线不等于表内 12 月龄中位数 —— LMS 逆变换算错')
  const cv10_6x = gjs6x.percentileCurve('weight', 'm', 10)
  const rt6x = cv10_6x ? gjs6x.metricAt('weight', cv10_6x[12], 12 * 30.4375, 'm') : null
  if (!rt6x || Math.abs(rt6x.p - 10) > 0.01)
    E('参考线数值回代 metricAt 不是 P10 —— 曲线与百分位的互逆链路断了')
  if (Math.abs(gjs6x.zForPercentile(50)) > 1e-9)
    E('zForPercentile(50) 不是 0 —— 二分写反了')

  // 11) 评价词反向钉：页面可见文本 + 页面 JS 字符串（剥注释后）零评价词
  const stripJs6x = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const badWords6x = ['偏瘦', '偏胖', '肥胖', '营养不良', '发育迟缓', '正常范围', '正常', '异常', '达标', '超重', '矮小', '落后', '健康状况']
  ;[[stripJs6x(grj6x), 'growth.js'], [grw6x, 'growth.wxml']].forEach((t) => {
    badWords6x.forEach((w) => {
      if (t[0].indexOf(w) >= 0)
        E(t[1] + ' 出现评价词「' + w + '」—— 红线：只做记录与展示，不做营养评估')
    })
  })

  // 12) 恒定说明句 + 免责声明在位（区间卡与页脚各一次）
  if (gj6x.indexOf('不是健康评价') < 0)
    E('growth.DISCLAIMER 丢了「不是健康评价」恒定说明句 —— 硬要求')
  if (grj6x.indexOf('growth.DISCLAIMER') < 0)
    E('growth.js 没引用 growth.DISCLAIMER —— 恒定说明句没接线')
  if (grw6x.indexOf('{{disclaimer}}') < 0)
    E('growth.wxml 没渲染 disclaimer')
  if (grw6x.indexOf('不是健康评价') < 0)
    E('曲线页「不是健康评价」说明句不在位 —— 百分位必须配恒定说明（§6x-12）')
  if (grw6x.indexOf('不做营养评估') < 0)
    E('曲线页缺「不做营养评估」声明')

  // 13) 决策④「曲线页零入口」已作废（v3.5 · 用户 2026-10-20 拍板方案 C）：
  //     入口恰好一处，在「我的」页「生长曲线」行 —— 正向钉。
  //     反向钉仍在：首页**不许**出现曲线入口（首页只管「录入」，看曲线在「我的」）。
  //     计数前先剥注释 —— 注释里写「跳 pages/growth」是文档，不是代码。
  const stripJs13x = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const stripWxml13x = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
  const mineCode13x = stripWxml13x(fs.readFileSync('./pages/mine/mine.wxml', 'utf8'))
    + stripJs13x(fs.readFileSync('./pages/mine/mine.js', 'utf8'))
  const mineHits13x = (mineCode13x.match(/pages\/growth/g) || []).length
  if (mineHits13x !== 1)
    E('「我的」页生长曲线入口数量 = ' + mineHits13x + ' —— 方案 C 要求恰好一处跳曲线页（§6x-13）')
  ;['pages/index/index.js', 'pages/index/index.wxml'].forEach((f) => {
    const code = fs.readFileSync('./' + f, 'utf8')
    if (code.indexOf('goGrowth') >= 0 || code.indexOf('/pages/growth') >= 0)
      E(f + ' 出现生长曲线入口 —— 正向钉：入口只在「我的」页，首页只管录入（§6x-13）')
  })

  // 隐私口径：曲线页零媒体选择、零网络调用（照片上传只属于首页头卡，批⑦）
  if (/chooseMedia|chooseImage|chooseVideo|chooseMessageFile/.test(grj6x))
    E('growth.js 接了媒体选择 —— 照片上传只在首页头卡（批⑦），曲线页零媒体')
  if (/wx\.(request|uploadFile|downloadFile)\b/.test(grj6x))
    E('growth.js 有网络调用 —— 隐私口径「未采集」被破')

  // 画布自绘：type=2d + 自写画笔（无构建约定，不引图表库）
  if (grw6x.indexOf('<canvas') < 0 || grw6x.indexOf('type="2d"') < 0)
    E('growth.wxml 没有 type=2d 的 canvas —— 曲线要自绘')

  // 视觉基线顺手钉住本页：字重三档、阴影唯一、display 唯一（§6l/A1）
  if (/font-weight:\s*(700|bold)/.test(grc6x))
    E('growth.wxss 用了 700/bold —— 字重只许 400/500/600 三档')
  if (/box-shadow/.test(grc6x))
    E('growth.wxss 自己加了 box-shadow —— 阴影只许 app.wxss 的 .card 一处（§6l）')
  if (grc6x.indexOf('--fs-display') >= 0)
    E('growth.wxss 用了 --fs-display —— A1：display 是计划页唯一时刻')

  // 14) 方案 C-1 版面钉（v3.5 · 用户 2026-10-20 拍板）：
  //     ① 「测量记录」卡必须在「曲线卡」之后、「录入卡」之前 —— 从「我的」跳进来的人
  //        要在一屏多一点的位置看见记录，不能滚到 1.3 屏外；
  //     ② 不能再有独立「当前位置」卡压在记录前面（它已压成曲线卡里的一行）；
  //     ③ 曲线卡里 current 那行在位，画布高度 392rpx（腾出那一行的位置）。
  const iChart6x = grw6x.indexOf('{{metricLabel}}曲线')
  const iCur6x = grw6x.indexOf('gr-cur-meta')
  const iRec6x = grw6x.indexOf('测量记录 · {{records.length}} 次')
  const iIn6x = grw6x.indexOf('{{editing ? \'修改记录\' : \'记一次测量\'}}')
  if (iChart6x < 0 || iCur6x < 0 || iRec6x < 0 || iIn6x < 0)
    E('growth.wxml 缺曲线卡 / current 行 / 测量记录卡 / 录入卡锚点（§6x-14）')
  if (!(iCur6x > iChart6x && iRec6x > iChart6x && iIn6x > iRec6x))
    E('曲线页卡片顺序被破坏 —— 方案 C-1 要求 曲线卡 → 测量记录 → 录入卡（§6x-14）')
  if (grc6x.indexOf('height: 392rpx') < 0)
    E('growth.wxss 画布不是 392rpx —— C-1 把 current 压进曲线卡，腾出的就是这个高度（§6x-14）')
  if (/wx:if="\{\{cur \&\& !showChart\}\}"/.test(grw6x) === false)
    E('growth.wxml 缺「没性别/超月龄时单独一张 current 卡」分支 —— 曲线不出时当前值会丢（§6x-14）')

  /* ---- 6x · 批④：首页拍立得贴纸 + 出生信息行（§6x-14/15）---- */

  const iw6x = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const ic6x = fs.readFileSync('./pages/index/index.wxss', 'utf8')
  const ij6x = fs.readFileSync('./pages/index/index.js', 'utf8')

  // 14) 贴纸与照片（决策① · 2026-10-15 批⑦ 修订为真照片，只存一张）：
  //    照片仍走本机文件不进仓库；打包位图在 v3.6（用户 2026-10-20）新增一张品牌位图 ——
  //    分享卡 share-card.png（500×400）。基线是 **7** 个。
  //    （同批还加过关于页 logo-circle.png，当天就撤了 —— 见 §6x-20f，别再加回来。）
  const expectedImgs6x = ['tab-plan.png', 'tab-plan-on.png', 'tab-food.png', 'tab-food-on.png',
    'tab-mine.png', 'tab-mine-on.png', 'share-card.png']
  const imgs6x = fs.readdirSync('./images')
  if (imgs6x.length !== expectedImgs6x.length || imgs6x.some((f) => expectedImgs6x.indexOf(f) < 0))
    E('images/ 目录与基线（6 tab 图标 + share-card）不一致 —— 照片仍走本机文件（§6x-14）')
  const scSize6x = fs.statSync('./images/share-card.png').size
  if (scSize6x > 60 * 1024)
    E('分享卡超过 60KB —— 上传包 ≤2MB 的预算不能砸在位图上（§6x-14）')
  const segS6x = iw6x.indexOf('6x-scan-start')
  const segE6x = iw6x.indexOf('6x-scan-end')
  if (segS6x < 0 || segE6x < 0 || segE6x <= segS6x)
    E('index.wxml 缺 6x-scan-start/end 标记 —— 首页新增段没圈出来，词表没法扫（§6x-11/14）')
  else {
    const seg6x = iw6x.slice(segS6x, segE6x)
    // 结构检查先剥 HTML 注释 —— 起始标记本身在注释里（`<!--` 在切片外，先截到首个 `-->`），
    // 注释里举例的字面标签不是真节点（词表仍扫原文，注释是随手写的，最接近用户可见文案）
    let segNoC6x = seg6x
    const cHead6x = segNoC6x.indexOf('-->')
    if (cHead6x >= 0) segNoC6x = segNoC6x.slice(cHead6x + 3)
    segNoC6x = segNoC6x.replace(/<!--[\s\S]*?-->/g, '')
    if (/background-image|url\(/.test(seg6x))
      E('首页新增段有 CSS 位图 —— 照片只能经 <image> 渲染，贴纸本体仍纯 CSS（§6x-14）')
    const im6x = segNoC6x.match(/<image[^>]*>/g) || []
    if (im6x.length !== 1 || im6x[0].indexOf('src="{{photo}}"') < 0 || im6x[0].indexOf('wx:if="{{photo}}"') < 0)
      E('首页新增段的 <image> 不是唯一、闸门、绑 {{photo}} 的那张 —— 贴纸只渲染本机照片（§6x-14）')
    if (segNoC6x.indexOf('polaroid-ph') < 0)
      E('贴纸缺占位回退（polaroid-ph）—— 没照片时应显示空框（§6x-14）')
    if (segNoC6x.indexOf('bindtap="chooseBabyPhoto"') < 0)
      E('贴纸没接 bindtap chooseBabyPhoto —— 上传入口是死的（决策① 2026-10-15 修订，§6x-14）')
    if (segNoC6x.indexOf('longpress="removeBabyPhoto"') < 0)
      E('贴纸没接 longpress removeBabyPhoto —— 传上去的照片没有回退通道（§6x-14）')
    if (segNoC6x.indexOf('birthText') >= 0)
      E('出生信息行又回来了 —— 用户 2026-10-16 要求从首页删除（批⑬，§6x-14/§6x-22）')
    badWords6x.forEach((w) => {
      if (seg6x.indexOf(w) >= 0)
        E('index.wxml 新增段出现评价词「' + w + '」—— 红线（§6x-11）')
    })
  }
  // 批⑦ · index.js 上传接线：chooseMedia(只图、压缩、单张) → saveBabyPhoto 落盘；
  // 零网络（照片纯本机，隐私口径「未采集」不破）
  const cmAt6x = ij6x.indexOf('wx.chooseMedia(')
  if (cmAt6x < 0)
    E('index.js 没接 chooseMedia —— 用户拍板可传照片，上传入口缺失（批⑦，§6x-17）')
  else {
    const cmBlk6x = ij6x.slice(cmAt6x, ij6x.indexOf('\n  },', cmAt6x))
    ;['count: 1', "mediaType: ['image']", "sizeType: ['compressed']", 'storage.saveBabyPhoto'].forEach((s) => {
      if (cmBlk6x.indexOf(s) < 0)
        E('chooseMedia 选项缺「' + s + '」—— 单张/只图/压缩/落盘口径被改掉（批⑦，§6x-17）')
    })
  }
  if (ij6x.indexOf('chooseBabyPhoto') < 0 || ij6x.indexOf('removeBabyPhoto') < 0 ||
      ij6x.indexOf('storage.clearBabyPhoto') < 0)
    E('index.js 缺 chooseBabyPhoto/removeBabyPhoto/clearBabyPhoto 接线（批⑦，§6x-17）')
  if (/wx\.(request|uploadFile|downloadFile)\b|wx\.cloud/.test(ij6x))
    E('index.js 有网络调用 —— 照片纯本机落盘，隐私口径「未采集」被破（批⑦）')
  if (/PHOTO|BabyPhoto|baby-photo/.test(pj6x))
    E('plan.js 引用了宝宝照片 —— 照片不进计划输入/指纹（§6x-17）')
  // 词表扩到首页：JS/WXSS 剥注释后扫（既有注释里有「正常」字样，属注释不属文案）
  const stripCss6x = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  badWords6x.forEach((w) => {
    if (stripJs6x(ij6x).indexOf(w) >= 0)
      E('index.js（剥注释后）出现评价词「' + w + '」—— 红线（§6x-11）')
    if (stripCss6x(ic6x).indexOf(w) >= 0)
      E('index.wxss（剥注释后）出现评价词「' + w + '」—— 红线（§6x-11）')
  })

  // 15) 字重三档 / 对比度现算不破（复用 §6g/§6n 算法，本段各起一份）
  const app6x = fs.readFileSync('./app.wxss', 'utf8')
  const lum6x = (hex) => {
    const v = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
  }
  const ratio6x = (a, b) => (Math.max(lum6x(a), lum6x(b)) + 0.05) / (Math.min(lum6x(a), lum6x(b)) + 0.05)
  const icStrip6x = stripCss6x(ic6x)
  ;['polaroid', 'polaroid-img', 'polaroid-ph',
    // 批⑨ 头卡新元素：小标 / 两行大标题 / 2×2 指标格。
    // 批⑬ 删掉的 head-date / head-note / head-birth 不在清单里，反向钉在 §6x-22
    'head-main', 'head-kicker', 'head-star', 'head-line', 'head-name', 'head-age',
    'stat-grid', 'stat-row', 'stat-cell',
    'stat-label', 'stat-value', 'stat-unit', 'stat-sub'].forEach((cls) => {
    const rule = icStrip6x.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*\\}'))
    if (!rule) {
      E('index.wxss 缺 .' + cls + ' 规则 —— 引用了没定义的类 / 死样式（wxml↔wxss 断链，§6x-15）')
      return
    }
    const fw = rule[0].match(/font-weight:\s*([^\s;}]+)/)
    if (fw && ['400', '500', '600'].indexOf(fw[1]) < 0)
      E('.' + cls + ' 字重 ' + fw[1] + ' 不在 400/500/600 三档（§6x-15）')
    if (/url\(|background-image/.test(rule[0]))
      E('.' + cls + ' 带了位图 —— 贴纸必须纯 CSS（§6x-14/15）')
  })
  const tintM6x = app6x.match(/--c-green-tint:\s*(#[0-9a-f]{6})/i)
  const t3M6x = app6x.match(/--c-text-3:\s*(#[0-9a-f]{6})/i)
  const cardM6x = app6x.match(/--c-card:\s*(#[0-9a-f]{6})/i)
  if (tintM6x && t3M6x) {
    const rb6x = ratio6x(t3M6x[1], tintM6x[1])
    if (rb6x < 4.5)
      E('出生信息行 ' + t3M6x[1] + ' on 品牌浅绿 ' + tintM6x[1] + ' = ' + rb6x.toFixed(1) + ':1 < 4.5:1（AA，§6x-15）')
  }
  if (cardM6x && t3M6x) {
    const rs6x = ratio6x(t3M6x[1], cardM6x[1])
    if (rs6x < 4.5)
      E('贴纸占位字 ' + t3M6x[1] + ' on 白底 ' + cardM6x[1] + ' = ' + rs6x.toFixed(1) + ':1 < 4.5:1（AA，§6x-15）')
  }

  /* ---- 6x · 批⑥：出生指标区间修订 + 打字期不归一（用户 2026-10-15 实测
     「出生身长无法正常填写」—— 根因是受控输入每击归一：打「50」时半截值
     「5」越界被清空回写，永远填不进。区间同步改为 3–10 kg / 20–70 cm）----
     ---- 批⑭（用户 2026-10-16 拍板）：出生体重放宽为「大于 2 kg 且小于 15 kg」
     —— 端点不算（2.0 / 15.0 都拒），下限从 3 放到 2 是为了让低出生体重宝宝
     （2.0–3.0 那一段）也能建档；越界反馈沿用 blur 清空 + 底部 toast 小字提醒
     （用户选定，不要改成内联小字） ---------------------------------------- */

  // 区间文本钉（体重是严格开区间，身长含端点）
  if (!/BIRTH_WEIGHT_MIN\s*=\s*2\b/.test(sj6x) || !/BIRTH_WEIGHT_MAX\s*=\s*15\b/.test(sj6x))
    E('出生体重区间不是「大于 2 且小于 15」—— 用户 2026-10-16 拍板的区间被改掉了（§6x-16）')
  if (!/BIRTH_LENGTH_MIN\s*=\s*20\b/.test(sj6x) || !/BIRTH_LENGTH_MAX\s*=\s*70\b/.test(sj6x))
    E('出生身长区间不是 20–70 cm —— 用户 2026-10-15 拍板的区间被改掉了（§6x-16）')
  // 四个出生体重调用点必须都带 strict（第 4 实参 true）；身长一个都不许带
  const bwStrict14 = (sj6x.match(/sanitizeBirthMetric\([^)]*BIRTH_WEIGHT[^)]*,\s*true\s*\)/g) || []).length +
    (prj6x.match(/sanitizeBirthMetric\([^)]*BIRTH_WEIGHT[^)]*,\s*true\s*\)/g) || []).length
  if (bwStrict14 !== 4)
    E('出生体重调用点没都走 strict —— 用户口径是「大于 2 且小于 15」，端点要拒收（§6x-16）')
  if (/sanitizeBirthMetric\([^)]*BIRTH_LENGTH[^)]*,\s*true\s*\)/.test(sj6x + prj6x))
    E('出生身长被误加了 strict —— 身长是含端点的 20–70（§6x-16）')

  // 打字期不归一：input 必须回写原始输入；校验/归一/提示全部落 blur
  if (prj6x.indexOf('this.setData({ birthWeight: e.detail.value })') < 0 ||
      prj6x.indexOf('this.setData({ birthLength: e.detail.value })') < 0)
    E('出生指标 input 没回写原始输入 —— 打字中途归一会吞小数点/清半截值（身长「50」打到「5」就没了，§6x-16）')
  if (prw6x.indexOf('bindblur="onBirthWeightBlur"') < 0 || prw6x.indexOf('bindblur="onBirthLengthBlur"') < 0)
    E('档案页出生指标没绑 bindblur —— 校验、归一与提示没有落点（§6x-16）')
  const bwTyp6x = prj6x.match(/onBirthWeight\(e\) \{[\s\S]{0,600}?\n {2}\},/)
  if (!bwTyp6x)
    E('profile.js 的 onBirthWeight 结构变了 —— §6x-16 的钉要跟着核')
  else if (bwTyp6x[0].indexOf('showToast') >= 0)
    E('onBirthWeight 打字过程中弹 toast —— 提示应放 blur（§6x-16）')
  ;[['onBirthWeightBlur', 'BIRTH_WEIGHT_MIN', '出生体重'], ['onBirthLengthBlur', 'BIRTH_LENGTH_MIN', '出生身长']].forEach((t) => {
    const m = prj6x.match(new RegExp(t[0] + '\\(\\) \\{[\\s\\S]{0,600}?\\n {2}\\},'))
    if (!m) {
      E('profile.js 缺 ' + t[0] + ' —— 校验放了 blur 但 handler 没接线')
      return
    }
    if (m[0].indexOf('showToast') < 0 || m[0].indexOf(t[1]) < 0)
      E(t[0] + ' 缺区间校验提示 —— 越界输入用户得不到反馈（§6x-16）')
  })

  // 边界与越界实跑（wx 桩自起一份）
  const mem6xb = {}
  const hadWxb = typeof global.wx !== 'undefined'
  const savedWxb = global.wx
  global.wx = {
    getStorageSync: (k) => mem6xb[k],
    setStorageSync: (k, v) => { mem6xb[k] = v },
    removeStorageSync: (k) => { delete mem6xb[k] }
  }
  try {
    const st6xb = require('./utils/storage.js')
    st6xb.setBaby({ name: '臭宝', birthday: '2026-01-01' })
    // 批⑭：体重是严格开区间 —— 端点内侧（2.1 / 14.9）合法，端点本身（2 / 15）拒收
    st6xb.setBaby({ birthWeight: 2.1, birthLength: 20 })
    const bMin6x = st6xb.getBaby()
    if (bMin6x.birthWeight !== 2.1 || bMin6x.birthLength !== 20)
      E('出生指标下界（2.1kg / 20cm）被拒 —— 端点内侧应合法（§6x-16）')
    st6xb.setBaby({ birthWeight: 14.9, birthLength: 70 })
    const bMax6x = st6xb.getBaby()
    if (bMax6x.birthWeight !== 14.9 || bMax6x.birthLength !== 70)
      E('出生指标上界（14.9kg / 70cm）被拒 —— 端点内侧应合法（§6x-16）')
    ;[2, 15].forEach((v14) => {
      st6xb.setBaby({ birthWeight: v14 })
      if (st6xb.getBaby().birthWeight !== '')
        E('出生体重 ' + v14 + 'kg 没被拒 —— 用户口径是「大于 2 且小于 15」，端点不算（§6x-16）')
    })
    st6xb.setBaby({ birthWeight: 2.9 })
    if (st6xb.getBaby().birthWeight !== 2.9)
      E('出生体重 2.9kg 被拒了 —— 批⑭ 已把下限放宽到 2（§6x-16）')
    st6xb.setBaby({ birthWeight: 20 })
    if (st6xb.getBaby().birthWeight !== '')
      E('出生体重 20kg 没被拒 —— 上限 15 之外应当拒收（§6x-16）')
    st6xb.setBaby({ birthLength: 19.9 })
    if (st6xb.getBaby().birthLength !== '')
      E('出生身长 19.9cm 没被拒 —— 区间应为 20–70 cm')
    st6xb.setBaby({ birthLength: 70.1 })
    if (st6xb.getBaby().birthLength !== '')
      E('出生身长 70.1cm 没被拒 —— 区间应为 20–70 cm')
    st6xb.setBaby({ birthWeight: 3.24 })
    if (st6xb.getBaby().birthWeight !== 3.2)
      E('出生体重没归一到 1 位小数 —— 3.24 应存 3.2（§6x-16）')
  } finally {
    if (hadWxb) global.wx = savedWxb
    else delete global.wx
  }

  /* ---- 6x · 批⑦：照片落盘实跑（用户 2026-10-15 拍板：头卡贴纸可传照片，
     只存一张）—— 固定路径覆盖写 + 移除/清除通道 + 备份信封不含照片 ---- */
  const mem7x = {}
  const files7x = {}
  const hadWx7x = typeof global.wx !== 'undefined'
  const savedWx7x = global.wx
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getStorageSync: (k) => mem7x[k],
    setStorageSync: (k, v) => { mem7x[k] = v },
    removeStorageSync: (k) => { delete mem7x[k] },
    getFileSystemManager: () => ({
      copyFileSync: (s, d) => { files7x[d] = 'from:' + s },
      unlinkSync: (d) => { if (!(d in files7x)) throw new Error('ENOENT: ' + d); delete files7x[d] },
      accessSync: (d) => { if (!(d in files7x)) throw new Error('ENOENT: ' + d) }
    })
  }
  try {
    const st7x = require('./utils/storage.js')
    const p1 = st7x.saveBabyPhoto('wxfile://tmp/a.jpg')
    if (!p1 || p1.indexOf('baby-photo.jpg') < 0)
      E('saveBabyPhoto 没落到固定文件名 baby-photo.jpg —— 单张语义靠固定路径（§6x-17）')
    const p2 = st7x.saveBabyPhoto('wxfile://tmp/b.jpg')
    if (!p1 || p2 !== p1)
      E('第二次保存走了别的路径 —— 会攒出第二张，用户只许一张（§6x-17）')
    if (st7x.getBabyPhoto() !== p1)
      E('getBabyPhoto 没回落盘路径 —— 首页渲染不出刚传的照片（§6x-17）')
    if (files7x[p1] !== 'from:wxfile://tmp/b.jpg')
      E('旧照片没被覆盖写 —— 固定路径覆盖语义坏了，会攒出多张（§6x-17）')
    if (JSON.stringify(JSON.parse(st7x.exportUserData())).indexOf('baby-photo') >= 0)
      E('照片进了备份信封 —— 图是二进制、路径换机必失效，不许进备份（§6x-17）')
    st7x.clearBabyPhoto()
    if (st7x.getBabyPhoto() !== '' || files7x[p1])
      E('clearBabyPhoto 没清干净 —— 路径或本机文件有残留（§6x-17）')
    st7x.saveBabyPhoto('wxfile://tmp/c.jpg')
    st7x.resetAll()
    if (st7x.getBabyPhoto() !== '' || files7x['wxfile://usr/baby-photo.jpg'])
      E('resetAll 没清 bb_photo/照片文件 —— 「清除全部数据」后贴纸还挂旧照或留孤儿文件（§6x-17）')
  } finally {
    if (hadWx7x) global.wx = savedWx7x
    else delete global.wx
  }

  /* ---- 6x · 批⑧：分享（用户 2026-10-15 三项拍板；v3.6 修订②：
     ①标题走页面内容型、不带宝宝名字/月龄/状态；
     ②缩略图**改传本地 share-card.png**（原来是"不传 imageUrl、微信自动截当前页"）；
     ③内容页全开 5 类，档案页与「我的」不开放分享）---- */

  const sh6x = stripJs6x(fs.readFileSync('./utils/share.js', 'utf8'))
  // ① 拍板标题白名单：文案只在 share.js 一处，改字 = 重新拍板
  ;['一周辅食计划', '食材怎么加', '各月龄注意事项', '成长曲线'].forEach((t) => {
    if (sh6x.indexOf("'" + t + "'") < 0)
      E('utils/share.js 缺拍板标题「' + t + '」—— 分享文案是用户拍板的（§6x-18）')
  })
  badWords6x.forEach((w) => {
    if (sh6x.indexOf(w) >= 0)
      E('utils/share.js（剥注释后）出现评价词「' + w + '」—— 红线（§6x-18）')
  })
  if (/require\s*\(|getBaby|storage|https?:\/\//.test(sh6x))
    E('share.js 引了存储/网络 —— 分享不带个人信息（拍板①，§6x-18）')
  // ② 缩略图（v3.6 · 用户 2026-10-20 修订拍板②）：允许 imageUrl，但**只许**指向
  //    本地分享卡位图，且只能在此文件出现一次（页面钩子仍只调 card()）
  if ((sh6x.match(/imageUrl/g) || []).length !== 1)
    E('share.js 里 imageUrl 不是恰好一处 —— 分享卡位图只能有一个绑定点（§6x-18）')
  if (sh6x.indexOf("'/images/share-card.png'") < 0)
    E('share.js 的 imageUrl 不是本地 share-card.png —— 不许网络图、不许带个人信息（拍板②，§6x-18）')
  if (sh6x.indexOf('/images/logo-circle.png') >= 0)
    E('share.js 里出现 about 页的 logo —— 分享卡与关于页是两张位图，别混（§6x-18）')

  // ③ 内容页全开：4 页直配 + 食材详情单独钉（见下），双钩子缺一菜单就有一个是灰的
  const appJson6x = JSON.parse(fs.readFileSync('./app.json', 'utf8'))
  const sharePages6x = [
    ['./pages/index/index.js', '/pages/index/index', 'share.TITLES.plan'],
    ['./pages/food/food.js', '/pages/food/food', 'share.TITLES.food'],
    ['./pages/months/months.js', '/pages/months/months', 'share.TITLES.months'],
    ['./pages/growth/growth.js', '/pages/growth/growth', 'share.TITLES.growth']
  ]
  sharePages6x.forEach((t) => {
    const s = stripJs6x(fs.readFileSync(t[0], 'utf8'))
    ;['onShareAppMessage', 'onShareTimeline'].forEach((h) => {
      if (s.indexOf(h) < 0)
        E(t[0] + ' 缺 ' + h + ' —— 右上角「转发给朋友 / 分享到朋友圈」是灰的（拍板③，§6x-18）')
    })
    if (s.indexOf(t[2]) < 0)
      E(t[0] + ' 分享标题没走 ' + t[2] + ' —— 拍板文案必须单一来源（§6x-18）')
    if (s.indexOf("'" + t[1] + "'") < 0)
      E(t[0] + ' 分享缺显式 path ' + t[1] + ' —— 分享打开要落回原页（§6x-18）')
    if (appJson6x.pages.indexOf(t[1].slice(1)) < 0)
      E(t[0] + ' 的分享 path 没在 app.json 注册 —— 点开就是 404（§6x-18）')
    if (/imageUrl/.test(s))
      E(t[0] + ' 传了 imageUrl —— 拍板②：缩略图用微信自动截当前页（§6x-18）')
  })
  // 食材详情：双钩子 + 标题跟食材走 + path 带 ?id 落回原食材
  const fd6x = stripJs6x(fs.readFileSync('./pages/food-detail/food-detail.js', 'utf8'))
  ;['onShareAppMessage', 'onShareTimeline', 'foodDetailTitle', "'/pages/food-detail/food-detail?id='"].forEach((s) => {
    if (fd6x.indexOf(s) < 0)
      E('food-detail.js 分享缺「' + s + '」—— 双钩子 / 食材标题 / 带 id 落回原页（§6x-18）')
  })
  if (/imageUrl/.test(fd6x))
    E('food-detail.js 传了 imageUrl —— 拍板②：缩略图用微信自动截当前页（§6x-18）')
  // 反向钉：档案页与「我的」不开放分享（拍板③）
  ;['./pages/profile/profile.js', './pages/mine/mine.js'].forEach((f) => {
    if (/onShareAppMessage|onShareTimeline/.test(fs.readFileSync(f, 'utf8')))
      E(f + ' 开了分享 —— 拍板③：档案页与「我的」不开放分享（§6x-18）')
  })

  /* ---- 6x · 批⑨：首页头卡对标参考图（用户 2026-10-15 拍板四项）----
     ① 2×2 下两格换**现有**数据（本周打卡 / 已引入），不新建睡/奶记录
     ② 补「出生时间」「一句话描述」两个选填字段（→ 出生日期行 / 个性行）
     ③ 照片保持拍立得白框（§6x-14 已钉）  ④ 装饰沿用品牌绿
     本批钉：两字段清洗/白名单/导入往返 + 不进指纹；头卡结构；零新数据源 ---- */

  // 19a) 一句话描述的清洗口径（实跑）；出生时间字段已按用户要求删除（19i 反向后钉）
  const st9x = require('./utils/storage.js')
  ;[['  是个 爱笑的\n小家伙  ', '是个 爱笑的 小家伙'], ['', ''], ['   ', '']].forEach((t) => {
    if (st9x.sanitizeBabyNote(t[0]) !== t[1])
      E('sanitizeBabyNote(' + JSON.stringify(t[0]) + ') 应为 ' + JSON.stringify(t[1]) + ' —— 个性行清洗口径变了（§6x-19）')
  })
  if (st9x.sanitizeBabyNote('x'.repeat(99)).length !== st9x.BABY_NOTE_MAX)
    E('sanitizeBabyNote 没按 BABY_NOTE_MAX 截断 —— 超长个性行会撑破头卡（§6x-19）')

  // 19b) 白名单 + 导出/导入往返 + 指纹不敏感（实跑：wx 桩自起一份）
  const mem9x = {}
  const hadWx9x = typeof global.wx !== 'undefined'
  const savedWx9x = global.wx
  global.wx = {
    getStorageSync: (k) => mem9x[k],
    setStorageSync: (k, v) => { mem9x[k] = v },
    removeStorageSync: (k) => { delete mem9x[k] }
  }
  try {
    const s9 = require('./utils/storage.js')
    s9.setBaby({ name: '豆豆', birthday: '2026-05-06', note: '  是个爱笑的小家伙 ' })
    const b9 = s9.getBaby()
    if (b9.note !== '是个爱笑的小家伙')
      E('setBaby 没接住 note 或没清洗 —— 档案页填了存不进去（§6x-19）')

    // 指纹不敏感（红线）：纯展示字段，改它绝不重排计划
    const plan9x = require('./utils/plan.js')
    const sigA9 = plan9x.planSignature(s9)
    s9.setBaby({ note: '换了句话' })
    const sigB9 = plan9x.planSignature(s9)
    if (!sigA9)
      E('planSignature 在已建档输入下返回空 —— 指纹链路断了（§6x-19）')
    else if (sigA9 !== sigB9)
      E('note 进了计划指纹 —— 改它会重排整份计划（红线，§6x-19）')

    // 导出带字段、导入还原字段（换机不丢）
    s9.setBaby({ note: '是个爱笑的小家伙' })
    const env9 = s9.exportUserData()
    if (env9.indexOf('是个爱笑的小家伙') < 0)
      E('导出备份没带个性描述 —— 换机丢字段（§6x-19）')
    const before9 = s9.getBaby()
    s9.importUserData(env9)
    const after9 = s9.getBaby()
    if (after9.note !== before9.note)
      E('导入备份没还原个性描述 —— 往返不一致（§6x-19）')
    // 导入侧同一套清洗：脏备份（带换行）不许写进库
    s9.importUserData(JSON.stringify({ app: 'choubao-fushi', fmt: 2, baby: { name: 'x', birthday: '2026-01-01', note: '  a\n\nb  ' } }))
    const dirty9 = s9.getBaby()
    if (dirty9.note !== 'a b')
      E('导入侧没清洗 note —— 脏备份能写进库（§6x-19）')
  } finally {
    if (hadWx9x) global.wx = savedWx9x; else delete global.wx
  }

  // 19c) 头卡结构（wxml）：小标 / 两行大标题 / 个性行 / 2×2 指标格 ——
  //      批⑬ 删掉 出生日期行 / 出生指标行 / 状态行（§6x-22）；个性行批⑮ 恢复
  ;['head-kicker', 'head-line', 'head-note',
    'stat-grid', 'stat-cell', 'stat-label'].forEach((cls) => {
    if (iw6x.indexOf(cls) < 0)
      E('index.wxml 缺 .' + cls + ' —— 批⑨ 头卡结构没对齐参考图（§6x-19）')
  })
  ;['体重', '身长', '本周打卡', '已引入'].forEach((t) => {
    if (iw6x.indexOf(t) < 0)
      E('index.wxml 头卡指标格缺「' + t + '」—— 2×2 四格标签（§6x-19）')
  })
  if (iw6x.indexOf('wx:if="{{noteText}}"') < 0)
    E('个性行没挂 noteText 闸门 —— 没填描述的人会看到空行（§6x-19）')
  ;['statWeight.value', 'statLength.value', 'statCheck.value', 'statFood.value'].forEach((s) => {
    if (iw6x.indexOf('{{' + s + '}}') < 0)
      E('指标格没绑 {{' + s + '}} —— 四格得走现有数据（拍板①，§6x-19）')
  })

  // 19d) 反向后钉：零新数据源（拍板①：换现有数据，不新建睡/奶记录）
  if (/bb_sleep|bb_milk|bb_nap|bb_night/i.test(sj6x))
    E('storage 出现了睡眠/奶量记录键 —— 拍板①是「换现有数据」，不新建记录（§6x-19）')
  if (/setStorageSync\(\s*['"]bb_(sleep|milk|nap)/i.test(ij6x) ||
      /storage\.(get|set)(Sleep|Milk|Nap)\b/.test(ij6x))
    E('index.js 新建了睡/奶数据 —— 拍板①不新建记录（§6x-19）')
  if (ij6x.indexOf('d.done') < 0 || ij6x.indexOf('d.total') < 0)
    E('本周打卡没走计划已有的 done/total —— 拍板①要复用现有数据（§6x-19）')
  /* 批⑨ 拍板④「装饰沿用品牌绿」在批⑫ 被用户 2026-10-16 修订：两行大标题换
     手写体，颜色改用浅蓝 --c-hand-title —— 那是唯一例外，色值/对比度钉在
     §6x-21。这里原口径保留：语义蓝 --c-blue、语义红 --c-red、任何硬编码色
     仍然一律禁止（--c-hand-title 是新命名的 token，不会落进这条正则）。 */
  ;['head-main', 'head-kicker', 'head-star', 'head-line', 'head-name', 'head-age',
    'head-note', 'stat-grid', 'stat-row', 'stat-cell', 'stat-label',
    'stat-value', 'stat-unit', 'stat-sub'].forEach((cls) => {
    const rule = icStrip6x.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*\\}'))
    if (rule && /var\(--c-(red|blue)\b|#[0-9a-f]{3,6}/i.test(rule[0]))
      E('.' + cls + ' 用了蓝/红或硬编码色 —— 批⑨ 拍板④ 仍有效，批⑫ 只放宽标题浅蓝那一处（§6x-19）')
  })

  // 19e) index.js 接线：小标序数词 + 个性行 + 指标格装配（全走 storage 现有源）。
  //      批⑬ 起 headDateText 不再装配（noteText 批⑮ 恢复了）—— index.js 注释里
  //      还留着这些名字做删除记录，所以一律剥注释再扫，别被自己写的说明误伤
  const noC19e = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  ;['enMonthWord', 'MONTH_WORDS', 'buildStats6x',
    'monthWord', 'monthNo', 'noteText',
    'statWeight', 'statLength', 'statCheck', 'statFood'].forEach((s) => {
    if (noC19e(ij6x).indexOf(s) < 0)
      E('index.js 缺 ' + s + ' —— 批⑨ 头卡派生没装配（§6x-19）')
  })
  ;['headDateText'].forEach((s) => {
    if (noC19e(ij6x).indexOf(s) >= 0)
      E('index.js 又在装配 ' + s + ' —— 首页不显示它，装配就是死数据（批⑬，§6x-19/§6x-22）')
  })
  if (ij6x.indexOf('safeFoodIds()') < 0)
    E('「已引入」没走 storage.safeFoodIds —— 必须与档案页/「我的」同一数据源（§6x-19）')
  if (iw6x.indexOf('{{name}}的') < 0 || iw6x.indexOf('第{{monthNo}}个月') < 0)
    E('两行大标题没拼「名称 + 第 N 个月」—— 批⑨ 标题口径变了（§6x-19）')

  // 19f) 档案页控件接线（一句话描述，选填）
  const prw9x = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')
  const prj9x = fs.readFileSync('./pages/profile/profile.js', 'utf8')
  if (prw9x.indexOf('bindinput="onNoteInput"') < 0)
    E('档案页一句话描述没绑 bindinput —— 存不进库（§6x-19）')
  if (prj9x.indexOf('noteMax: storage.BABY_NOTE_MAX') < 0)
    E('描述上限没跟 storage.BABY_NOTE_MAX 走 —— 页面里另写了个数（§6x-19）')

  // 19g) 对比度现算：品牌深绿小标/增量、次级灰日期行/个性行 ≥ 4.5（AA）
  const gdark9x = app6x.match(/--c-green-dark:\s*(#[0-9a-f]{6})/i)
  const t2M9x = app6x.match(/--c-text-2:\s*(#[0-9a-f]{6})/i)
  if (gdark9x && tintM6x) {
    const r = ratio6x(gdark9x[1], tintM6x[1])
    if (r < 4.5)
      E('英文小标/★ ' + gdark9x[1] + ' on 品牌浅绿 ' + tintM6x[1] + ' = ' + r.toFixed(1) + ':1 < 4.5:1（AA，§6x-19）')
  }
  if (gdark9x && cardM6x) {
    const r = ratio6x(gdark9x[1], cardM6x[1])
    if (r < 4.5)
      E('指标格增量 ' + gdark9x[1] + ' on 白底 ' + cardM6x[1] + ' = ' + r.toFixed(1) + ':1 < 4.5:1（AA，§6x-19）')
  }
  if (t2M9x && tintM6x) {
    const r = ratio6x(t2M9x[1], tintM6x[1])
    if (r < 4.5)
      E('出生日期行/个性行 ' + t2M9x[1] + ' on 品牌浅绿 ' + tintM6x[1] + ' = ' + r.toFixed(1) + ':1 < 4.5:1（AA，§6x-19）')
  }

  // 19h) 批⑬（用户 2026-10-16 拍板）：状态行与出生信息行一并删掉 —— 原来的
  //      「出生信息行 → 状态行 → 指标格」版式钉翻成反向钉；指标格位置不动，
  //      入口胶囊跟在指标格之后的钉挪到 §6t
  if (iw6x.indexOf('head-issue-row') >= 0 || iw6x.indexOf('head-birth') >= 0 ||
      iw6x.indexOf('head-date') >= 0)
    E('头卡又出现状态行 / 出生信息行 / 出生日期行 —— 用户 2026-10-16 要求删除（批⑬，§6x-19h/§6x-22）')
  if (iw6x.indexOf('stat-grid') < 0)
    E('index.wxml 缺 2×2 指标格 —— 头卡版式断链（§6x-19h）')

  // 19i) 反向后钉：出生时间字段已按用户要求**删除**（2026-10-15）——
  //      storage 白名单与清洗、档案页控件、首页日期行都不许再出现
  ;['utils/storage.js', 'pages/index/index.js', 'pages/index/index.wxml',
    'pages/profile/profile.wxml', 'pages/profile/profile.js'].forEach((f) => {
    if (/birthTime/.test(fs.readFileSync('./' + f, 'utf8')))
      E(f + ' 又出现了 birthTime 字段 —— 用户 2026-10-15 要求删除出生时间（§6x-19i）')
  })
  if (prw9x.indexOf('出生时间') >= 0)
    E('档案页又出现「出生时间」这一行 —— 用户 2026-10-15 要求删除（§6x-19i）')

  /* ── §6x-20 身高体重记录入口 + 面板（v3.0 · 用户 2026-10-15；v3.2 搬到首页）
   * 用户要求：① 一个「记身高体重」的入口，点开是贴底面板（图二版式：
   * 身长 / 体重 / 头围 / 测量日期 + 保存 + 已有记录时「删除这条记录」）；
   * ②「我的」页加一行历史（形态待用户拍板，见 20e）。
   * v3.2（用户 2026-10-19）：档案页第 5 步整屏删除，入口搬到**首页头卡胶囊**，
   * 就地弹面板、不跳页 —— 断言目标文件随之从 profile 改为 index。
   * v3.5（用户 2026-10-20）：拍板方案 C —— 「我的」页那一行改成**整行跳曲线页**，
   * 本页不再展开清单、不再逐条删除（全站唯一一份测量记录在曲线页，见 §6x-13）。
   * v3.6（用户 2026-10-20）：同页新增「关于」卡 —— 新头像「围兜宝宝」在包内的
   * 唯一落点（分享卡与平台头像都在微信侧），见 20f。
   * 数据层**不新增**：就是曲线页那份 bb_growth（storage.getGrowth /
   * upsertGrowthRecord / removeGrowthRecord），多处共用同一份，绝不另存。
   * 面板默认载入「今天」这条（用户拍板）：今天已有 → 带出旧值可改可删；今天没有
   * → 空表单新建；改「测量日期」= 改那一天。字段名沿用「身长」（用户拍板：
   * 与曲线页、数据字段 length 一个词）。红线不变：只出数值，不出评价。
   */
  const prw20x = fs.readFileSync('./pages/index/index.wxml', 'utf8')
  const prj20x = fs.readFileSync('./pages/index/index.js', 'utf8')
  const prc20x = fs.readFileSync('./pages/index/index.wxss', 'utf8')

  // 20a) 首页入口 + 面板接线
  if (prw20x.indexOf('记录身高体重') < 0)
    E('首页缺「记录身高体重」入口 —— 档案页第 5 步已删，这是唯一录入口（§6x-20a）')
  ;['bindtap="openMetricSheet"', 'bindchange="onMetricDate"', 'bindinput="onMetricInput"',
    'bindtap="onMetricSave"', '删除这条记录', 'mForm.weight', 'mForm.length',
    'mForm.head'].forEach((s) => {
    if (prw20x.indexOf(s) < 0) E('身高体重面板 wxml 缺 ' + s + '（§6x-20a）')
  })
  ;['openMetricSheet', 'loadMetric', 'onMetricSave', 'onMetricDelete'].forEach((s) => {
    if (prj20x.indexOf(s) < 0) E('首页测量面板缺 ' + s + ' handler（§6x-20a）')
  })
  if (prj20x.indexOf('this.loadMetric(storage.todayStr())') < 0)
    E('测量面板默认载入的不是「今天」这条 —— 用户 2026-10-15 拍板的默认口径变了（§6x-20a）')
  if (prj20x.indexOf('metricHasRecord') < 0 || prw20x.indexOf('metricHasRecord') < 0)
    E('「删除这条记录」没跟「该日期是否已有记录」联动 —— 删除通道会一直挂着（§6x-20a）')
  // v3.2：保存/删除后必须 refresh —— 头卡「体重 / 身长」要立刻跟上
  if ((prj20x.match(/this\.refresh\(\)/g) || []).length < 2)
    E('保存或删除后没 refresh 首页 —— 头卡体重/身长会停在旧数字（§6x-20a）')

  // 20b) 不新增数据源（反向钉）：只走 storage 三个既有接口，页面不碰 key
  ;['storage.getGrowth', 'storage.upsertGrowthRecord', 'storage.removeGrowthRecord'].forEach((s) => {
    if (prj20x.indexOf(s) < 0)
      E('首页测量面板没走 ' + s + ' —— 与曲线页不是同一份数据（§6x-20b）')
  })
  if (prj20x.indexOf('setStorageSync') >= 0 || prj20x.indexOf('KEYS.') >= 0)
    E('首页直接碰 storage key —— 测量记录必须走 utils/storage.js（§6x-20b）')

  // 20c) 红线：新 UI 文案不含评价词。只扫**面板段** —— 首页别处的既有文案
  //      有「恢复正常饮食」「生长发育异常」，全文扫会误报（v3.2 收窄）
  const panel20x = (prw20x.match(/<!-- 身高体重记录 · 贴底面板[\s\S]*?删除这条记录<\/view>/) || [''])[0]
  if (!panel20x) E('首页找不到测量面板段 —— 注释锚点被改了（§6x-20c）')
  ;[[panel20x, 'index.wxml 面板段'], [stripJs6x(prj20x), 'index.js（剥注释）']].forEach((t) => {
    badWords6x.forEach((w) => {
      if (t[0].indexOf(w) >= 0)
        E(t[1] + ' 出现评价词「' + w + '」—— 身高体重只记录不评价（红线，§6x-20c）')
    })
  })

  // 20d) 新元素对比度现算 ≥ 4.5（AA）+ 类名断链
  ;['.ms-head', '.ms-title', '.ms-save', '.ms-del'].forEach((c) => {
    if (prc20x.indexOf(c) < 0) E('index.wxss 缺 ' + c + ' —— 测量面板样式断链（§6x-20d）')
  })
  const muted20x = app6x.match(/--c-muted:\s*(#[0-9a-f]{6})/i)
  const red20x = app6x.match(/--c-red:\s*(#[0-9a-f]{6})/i)
  ;[[cardM6x, t2M9x, '取消（次级灰）on 白底'],
    [cardM6x, gdark9x, '保存（品牌深绿）on 白底'],
    [muted20x, red20x, '删除（红）on 次级底']].forEach((p) => {
    if (!p[0] || !p[1]) return
    const r = ratio6x(p[1][1], p[0][1])
    if (r < 4.5)
      E('§6x-20d ' + p[2] + ' = ' + r.toFixed(1) + ':1 < 4.5:1（AA）')
  })

  // 20e) 「我的」页的「生长曲线」行（v3.5 · 用户 2026-10-20 拍板方案 C）：
  //      整行跳 pages/growth，行右值 = 记录条数；本页**不**展开清单、**不**提供删除。
  //      清单与增删改只在曲线页（§6x-13 正向钉的唯一入口）。
  //      注意：索引页仍由首页头卡胶囊负责「录入」，「我的」这一行只负责「看」。
  const mw20x = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')
  const mj20x = fs.readFileSync('./pages/mine/mine.js', 'utf8')
  if (mw20x.indexOf('生长曲线') < 0 || mw20x.indexOf('{{growthCount}} 次记录') < 0)
    E('「我的」缺「生长曲线」行或次数 —— 曲线页唯一入口断了（§6x-20e）')
  if (mw20x.indexOf('bindtap="goGrowth"') < 0)
    E('「我的」生长曲线行没挂 bindtap="goGrowth" —— 方案 C 是整行跳转（§6x-20e）')
  if (mj20x.indexOf('/pages/growth/growth') < 0)
    E('「我的」缺 goGrowth 里的跳转地址 —— 行能点但跳不走（§6x-20e）')
  // 反向钉：本页不许再复制一份只能删的副本
  ;['growthList', 'removeGrowth', 'hg-del', 'data-row="growth"'].forEach((s) => {
    if (mw20x.indexOf(s) >= 0) E('「我的」又出现 ' + s + ' —— 清单与删除只在曲线页（§6x-20e）')
  })
  if (mj20x.indexOf('removeGrowthRecord') >= 0)
    E('「我的」页自己删测量记录 —— 删除通道只在曲线页（§6x-20e）')
  if (mj20x.indexOf('growthCount') < 0) E('「我的」缺 growthCount —— 行右值没数（§6x-20e）')
  if (mj20x.indexOf('setStorageSync') >= 0 || mj20x.indexOf('KEYS.') >= 0)
    E('「我的」直接碰 storage key —— 测量记录必须走 utils/storage.js（§6x-20e）')
  const mc20x = fs.readFileSync('./pages/mine/mine.wxss', 'utf8')
  ;['.row-ic', '.row-top'].forEach((c) => {
    if (mc20x.indexOf(c) < 0) E('mine.wxss 缺 ' + c + ' —— 生长曲线行样式断链（§6x-20e）')
  })
  // 红线：这一段 UI 文案不含评价词。mine.wxml 全文件扫不了（免责声明里有
  // 「生长发育异常」），所以按 6x-hg-scan-start/end 标记段扫；JS 剥注释后整份扫。
  const hgs20x = mw20x.indexOf('6x-hg-scan-start')
  const hge20x = mw20x.indexOf('6x-hg-scan-end')
  if (hgs20x < 0 || hge20x < 0 || hge20x < hgs20x)
    E('mine.wxml 缺 6x-hg-scan-start/end 标记 —— 新段没圈出来，词表没法扫（§6x-20e）')
  else {
    const seg20x = mw20x.slice(hgs20x, hge20x)
    badWords6x.forEach((w) => {
      if (seg20x.indexOf(w) >= 0)
        E('「我的」生长曲线行段出现评价词「' + w + '」—— 只记录不评价（红线，§6x-20e）')
    })
  }
  badWords6x.forEach((w) => {
    if (stripJs6x(mj20x).indexOf(w) >= 0)
      E('mine.js（剥注释后）出现评价词「' + w + '」—— 红线（§6x-20e）')
  })
  // 20f) 「关于」卡：v3.6 当天新增、当天按用户要求删除（2026-10-20）——
  //      连带 images/logo-circle.png 一并撤掉，品牌位图现在只有分享卡一张。
  //      这里留一条反向钉，免得哪天有人把卡加回来却忘了位图。
  if (mw20x.indexOf('about-card') >= 0 || mw20x.indexOf('logo-circle.png') >= 0)
    E('「我的」又出现关于卡 —— 用户 2026-10-20 已删除，要加回来请连位图一起拍板（§6x-20f）')

  /* ── §6x-21 批⑫ · 首页头卡手写体 + 浅蓝（用户 2026-10-16 拍板）───────────────
   * 用户要求：「臭宝的 / 第 N 个月」两行大标题换手写体，且**不用品牌绿，改浅蓝**。
   * 这次拍板修订了两块旧板：
   *   ① 决策③「不引字体文件」→ 引字体，但只以内嵌子集的形态（不联网）；
   *   ② 批⑨ 拍板④「装饰沿用品牌绿」→ 标题那一处放宽为浅蓝 --c-hand-title。
   * 技术前提（官方口径 + 实测）：WXSS 的 @font-face 只吃 base64 或网络地址，
   *   包内 ttf 的相对路径不生效；wx.loadFontFace 同样必须 https —— 两条都与
   *   「不联网」红线冲突，所以唯一路径是把子集 base64 内嵌进
   *   pages/index/font.wxss（由 scripts/gen-hand-font.py 生成，别手改）。
   * 体积实测（站酷快乐体 · SIL OFL 1.1）：
   *   只覆盖标题字 3.6KB；把宝宝名也做成手写体则要带 GB2312 一级 3755 字
   *   → base64 582KB。配套把 scripts/（1.1MB xlsx 生成缓存）排除出上传包，
   *   净包体积反而比批⑪ 时更小。
   */
  {
    const ftx21x = fs.existsSync('./pages/index/font.wxss')
      ? fs.readFileSync('./pages/index/font.wxss', 'utf8') : ''
    if (!ftx21x) {
      E('缺 pages/index/font.wxss —— 手写体子集没生成（跑 python scripts/gen-hand-font.py）（§6x-21）')
    } else {
      // 21a) @font-face 本体：家族名 / 字重描述符 / base64 woff2 / 零网络
      if (ftx21x.indexOf("font-family: 'ChoubaoHand'") < 0)
        E("font.wxss 的 @font-face 家族名不是 'ChoubaoHand' —— index.wxss 引用不到（§6x-21）")
      if (ftx21x.indexOf('font-weight: 600') < 0)
        E('font.wxss 的 @font-face 没声明 font-weight: 600 —— 站酷快乐体只有一个字重，'
          + '描述符不写 600，渲染器会按 400 处理再伪加粗，圆体笔画会糊成一团（§6f 字重三档钉的 600 也在这）（§6x-21）')
      const uri21x = ftx21x.match(/url\(['"]?data:font\/woff2;base64,([A-Za-z0-9+/=]+)/)
      if (!uri21x) {
        E('font.wxss 的 @font-face 不是 base64 woff2 内嵌 —— 包内字体路径不生效，走网络又破红线（§6x-21）')
      } else {
        // 完整性：解开后前 4 字节必须是 wOF2 魔数（截断/写坏一眼抓住）
        if (Buffer.from(uri21x[1], 'base64').slice(0, 4).toString('latin1') !== 'wOF2')
          E('font.wxss 的 woff2 解开后没有 wOF2 魔数 —— 内容被截断或写坏，重跑 gen-hand-font.py（§6x-21）')
        // 生成脚本的自述必须与实际字节一致（防止手改 base64 没重跑脚本）
        const stat21x = ftx21x.match(/choubao-hand-font:\s*family=(\S+) chars=(\d+) woff2=([\d.]+)KB base64=([\d.]+)KB mode=(\w+)/)
        if (!stat21x) {
          E('font.wxss 缺 choubao-hand-font: 统计行 —— 体积/字集没有可核对的口径（§6x-21）')
        } else {
          if (stat21x[1] !== 'ChoubaoHand')
            E('统计行的家族名与 @font-face 不一致 —— 改了名没重跑脚本（§6x-21）')
          if (Math.abs(uri21x[1].length / 1024 - parseFloat(stat21x[4])) > 2)
            E('统计行声明 base64 ' + stat21x[4] + 'KB，实际 ' + (uri21x[1].length / 1024).toFixed(1)
              + 'KB —— base64 被手改过，重跑 gen-hand-font.py（§6x-21）')
          if (stat21x[5] !== 'full')
            E("字体字集是 '" + stat21x[5] + "' 模式 —— 用户 2026-10-16 拍板两行都换手写体，"
              + '名字那行要覆盖常用汉字。真要精简到只有月龄行：python scripts/gen-hand-font.py --lean（§6x-21）')
          if (parseInt(stat21x[2], 10) < 3700)
            E('字体字集 ' + stat21x[2] + ' 字 < 3700 —— 名字那行的常用汉字覆盖丢了（§6x-21）')
        }
        // 零网络：剥注释后不许出现任何 http(s) 地址（注释里的版权链接是 OFL
        // 要求随附的，不参与判定；真正的来源已由上面的 base64 钉死）
        if (/https?:\/\//i.test(stripCss6x(ftx21x)))
          E('font.wxss 里出现网络地址 —— 字体走网络就破「不联网」红线（§6x-21）')
      }
      // 项目里不许再有第二条加载字体的通道
      const jsDirs21x = ['.'].concat(fs.readdirSync('./pages', { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => './pages/' + d.name))
      const jsFiles21x = jsDirs21x.flatMap((dir) => fs.readdirSync(dir)
        .filter((f) => /\.js$/.test(f) && f !== '_validate.js').map((f) => dir + '/' + f))
      jsFiles21x.forEach((f) => {
        if (/loadFontFace/.test(fs.readFileSync(f, 'utf8')))
          E(f + ' 调用了 wx.loadFontFace —— 字体内嵌即可，不许走网络字体（§6x-21）')
      })
    }

    // 21b) 接线：index.wxss 引入子集 + 标题容器挂家族 + 两个子元素挂浅蓝
    if (!/^\s*@import\s+"font\.wxss"\s*;/m.test(ic6x))
      E('index.wxss 没引入 font.wxss —— @font-face 进不了包，标题会掉回系统字（§6x-21）')
    const hl21x = icStrip6x.match(/\.head-line\s*\{[^}]*\}/)
    if (!hl21x || hl21x[0].indexOf("'ChoubaoHand'") < 0)
      E('.head-line 没挂手写体家族 —— 两行大标题会掉回系统字（§6x-21）')
    ;['head-name', 'head-age'].forEach((cls) => {
      const rule = icStrip6x.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*\\}'))
      if (!rule || rule[0].indexOf('var(--c-hand-title)') < 0)
        E('.' + cls + ' 没用 --c-hand-title —— 用户 2026-10-16 拍板：标题改浅蓝（§6x-21）')
    })
    // 小标与 ★ 仍走品牌绿：这一行没换手写体，12px 的浅蓝压浅绿过不了正文 AA（4.5:1）
    ;['head-kicker', 'head-star'].forEach((cls) => {
      const rule = icStrip6x.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*\\}'))
      if (!rule || rule[0].indexOf('var(--c-green-dark)') < 0)
        E('.' + cls + ' 不再是品牌绿 —— 批⑫ 只放宽标题那一处（§6x-21）')
    })

    // 21c) 色值走 token + 对比度现算：浅蓝压品牌浅绿 ≥ 3:1（40rpx/600 算大字）
    const hand21x = app6x.match(/--c-hand-title:\s*(#[0-9a-f]{6})/i)
    if (!hand21x) {
      E('app.wxss 缺 --c-hand-title —— 标题浅蓝没走 token（§6x-21）')
    } else if (tintM6x) {
      const rh21x = ratio6x(hand21x[1], tintM6x[1])
      if (rh21x < 3)
        E('标题浅蓝 ' + hand21x[1] + ' on 品牌浅绿 ' + tintM6x[1] + ' = ' + rh21x.toFixed(1)
          + ':1 < 3:1 —— 40rpx/600 属「大字」，AA 门槛 3:1；再浅一档连大字都过不了（§6x-21）')
    }

    // 21d) 上传包预算：scripts/ 是构建期产物（含 1.1MB WHO 表 xlsx 缓存），
    //      运行时零依赖 —— 不排除的话，字体那 582KB 就是白花的
    const pc21x = JSON.parse(fs.readFileSync('./project.config.json', 'utf8'))
    const ig21x = (pc21x.packOptions && pc21x.packOptions.ignore) || []
    if (!ig21x.some((o) => o.type === 'folder' && o.value === 'scripts'))
      E('project.config.json 没把 scripts/ 排除出上传包 —— 里面 1.1MB 是 WHO 表生成缓存，'
        + '运行时用不到，不排除会让手写体的包体积白花（§6x-21）')
    const walk21x = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      if (d.name === '.git' || d.name === 'node_modules') return []
      const p21x = dir + '/' + d.name
      if (d.isDirectory()) {
        if (ig21x.some((o) => o.type === 'folder' && o.value === d.name)) return []
        return walk21x(p21x)
      }
      if (d.name === '_validate.js' || /\.(md|bak)$/.test(d.name)) return []
      return [p21x]
    })
    const pkgBytes21x = walk21x('.').reduce((a, p) => a + fs.statSync(p).size, 0)
    if (pkgBytes21x > 1900 * 1024)
      E('上传包（原始字节估）' + (pkgBytes21x / 1024).toFixed(0) + 'KB，已逼近主包上限 2MB —— '
        + '字集是主要开销，重跑 gen-hand-font.py --lean 可降到 4KB 量级（§6x-21）')
  }

  /* ── §6x-22 批⑬ · 首页头卡删五处文案（v3.0 · 用户 2026-10-16 拍板）───────────
   * 用户在真机截图上框了两块，要求把框内文案**从首页删掉**，一共五处：
   *   ① 出生日期行「2026 年 5 月 6 日 · 5 个月 10 天」
   *   ② 出生指标行「出生 6.6kg · 56cm」
   *   ③ 状态行「当前状态：…」
   *   ④ 阶段说明行「刚起步，一天 1–2 餐，从强化铁米粉开始」
   *   ⑤「辅食第 1 个月 · 自 2026-10-13 起」
   * （框里还有一行个性行「爱笑狂魔」，批⑮ 用户 2026-10-16 又要求恢复 —— 它在
   *   §6x-19c/19e 里是正向钉，不在这节的反向名单里。）
   * 这一节是**反向钉**，口径是「只删首页渲染 + 它那份派生装配」，数据源一律不动：
   * 出生体重/身长档案页照填（指标格的 Δ 还要用）、一句话描述照填、
   * foodStart 照进计划指纹、状态在「我的」与档案页照看。
   */
  {
    const w22 = fs.readFileSync('./pages/index/index.wxml', 'utf8')
    const j22 = stripJs6x(fs.readFileSync('./pages/index/index.js', 'utf8'))
    const c22 = stripCss6x(fs.readFileSync('./pages/index/index.wxss', 'utf8'))

    // 22a) wxml：绑定点与类名都不许回来（个性行批⑮ 已恢复，不在名单里）
    ;[['headDateText', '出生日期行'], ['birthText', '出生指标行'],
      ['issueLabel', '状态行'], ['issueNone', '状态行'],
      ['stageDesc', '阶段说明行'], ['foodAgeText', '辅食月龄副文案']].forEach((t) => {
      if (w22.indexOf('{{' + t[0] + '}}') >= 0)
        E('index.wxml 又绑了 {{' + t[0] + '}} —— ' + t[1] + '按用户 2026-10-16 要求从首页删除（§6x-22）')
    })
    ;[['head-date', '出生日期行'], ['head-birth', '出生指标行'],
      ['head-issue', '状态行'], ['head-food-age', '辅食月龄副文案']].forEach((t) => {
      if (w22.indexOf(t[0]) >= 0)
        E('index.wxml 又出现 ' + t[0] + ' —— ' + t[1] + '已删（批⑬，§6x-22）')
    })

    // 22b) js：派生不许再装配（剥注释后扫 —— 我们的注释里留了字段名做删除记录）
    ;['headDateText(', 'birthText:', 'foodAgeText:',
      'issueLabel:', 'issueNone:', 'base.stageDesc'].forEach((t) => {
      if (j22.indexOf(t) >= 0)
        E('index.js 又在装配 ' + t.replace(/[(:,]$/, '') + ' —— 首页不显示它，装配就是死数据（§6x-22）')
    })
    if (/getStatuses\(\)/.test(j22) || /statusLabels\(/.test(j22))
      E('index.js 又去取状态汇总 —— 头卡状态行已删，这行取值是死的（§6x-22）')

    // 22c) wxss：死样式不许复活（剥注释后扫）
    ;['head-date', 'head-birth', 'head-issue-row',
      'head-issue--none', 'head-food-age'].forEach((cls) => {
      if (new RegExp('\\.' + cls + '\\s*\\{').test(c22))
        E('index.wxss 又有 .' + cls + ' 规则 —— 随文案一起删了，加回来就是死样式（§6x-22）')
    })
    if (/\.head-issue(::before)?\s*\{/.test(c22))
      E('index.wxss 又有 .head-issue 规则 —— 状态行已删（§6x-22）')

    // 22d) 反向兜底：数据源不许被顺手删掉（「只删展示」的另一半）——
    //      个性行批⑮ 恢复了，但档案页那个控件照旧不许动
    const prw22 = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')
    ;[['birthWeight', '出生体重控件'], ['birthLength', '出生身长控件'],
      ['onNoteInput', '一句话描述控件']].forEach((t) => {
      if (prw22.indexOf(t[0]) < 0)
        E('档案页' + t[1] + '没了 —— 批⑬ 只删首页展示，数据入口要留着（§6x-22）')
    })
    const mw22 = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')
    if (mw22.indexOf('issueLabel') < 0)
      E('「我的」的状态行被误删 —— 用户只让删首页（§6x-22）')
  }

  if (errs.length === errsBefore) {
    console.log('  6x 成长曲线·数据层(v3.0 批①)：bb_growth 读写/同日覆写/排序/归一 ✓、日期闸门(未来/出生前) ✓、区间拒收+全空拒收 ✓、档案三字段白名单+控件接线 ✓、备份 fmt2 往返+fmt1 兼容+脏条目清洗 ✓、resetAll 清 bb_growth ✓、planSignature 不敏感(红线) ✓')
    console.log('  6x 成长曲线·计算层(v3.0 批②)：WHO 官方表 6 表×61 点结构+8 个中位锚点 ✓、双时钟(生理日龄/foodStart 无感) ✓、六带边界+标签中性词表 ✓、0–60 月与缺性别/缺数值闸门 ✓、中位数=P50 链路自洽 ✓')
    console.log('  6x 成长曲线·页面层(v3.0 批③)：注册+不进 tabBar ✓、性别闸门(曲线/区间过 hasSex) ✓、参考线互逆(曲线↔metricAt) ✓、评价词反向钉 ✓、恒定说明句+免责声明 ✓、入口恰好一处(v3.5 方案C) ✓、曲线页零媒体+零网络 ✓、canvas 自绘+字重/阴影/display 基线 ✓')
    console.log('  6x 成长曲线·首页(v3.0 批④)：贴纸本体纯 CSS+images 打包位图零新增 ✓、出生信息行已删(批⑬ 反向钉) ✓、词表扩扫首页(JS/WXSS 剥注释+标记段) ✓、字重三档+新元素对比度现算 AA ✓')
    console.log('  6x 成长曲线·出生指标修订(批⑥/批⑭·用户 2026-10-15、10-16)：出生体重「大于 2 且小于 15 kg」严格开区间+出生身长 20–70cm 边界与越界实跑 ✓、打字期不归一(input 回写原始值) ✓、校验/归一/提示落 blur(越界清空+toast) ✓')
    console.log('  6x 成长曲线·照片(批⑦·用户 2026-10-15)：chooseMedia(单张/只图/压缩)→固定路径覆盖写实跑 ✓、长按移除回退+占位回退 ✓、resetAll 连文件清 ✓、备份信封不含照片 ✓、index 零网络+plan 零照片指纹 ✓')
    console.log('  6x 成长曲线·分享(批⑧·用户 2026-10-15；v3.6 修订拍板②)：5 内容页双钩子(appMessage+timeline) ✓、内容型拍板标题单一来源+词表 ✓、分享卡位图 imageUrl 恰好一处且只指向本地 share-card.png ✓、零网络/零个人信息 ✓、显式 path 回原页(食材详情带 id) ✓、档案/我的反向钉 ✓')
    console.log('  6x 成长曲线·首页头卡对标(批⑨·用户 2026-10-15)：英文小标+两行大标题(同容器同字号,--fs-display) ✓(出生时间字段已按用户要求删除,反向钉) 、2×2 指标格换现有数据(体重/身长/本周打卡/已引入) ✓、一句话描述 白名单+清洗+导入往返+不进指纹 ✓、零新数据源(不建睡/奶) ✓、新元素字重三档+对比度现算 AA ✓')
    console.log('  6x 首页头卡删五处文案(批⑬·用户 2026-10-16)：出生日期行/出生指标行/状态行/阶段说明行/辅食月龄副文案 五处连同派生装配与样式一并删除 ✓、数据源反向兜底(档案页控件/我的状态行照在) ✓、入口胶囊位置钉改钉指标格之后(形态钉不变) ✓')
    console.log('  6x 首页恢复个性行(批⑮·用户 2026-10-16)：一句话描述 加回头卡(标题与指标格之间) ✓、noteText 装配与 .head-note 样式恢复 ✓、档案页控件不动 ✓')
    console.log('  6x 身高体重记录入口(批⑪·用户 2026-10-15)：档案页入口行+贴底面板(身长/体重/头围/测量日期+保存) ✓、默认载入「今天」这条 ✓、已有记录时「删除这条记录」+确认框 ✓、同一份 bb_growth(不新增数据源反向钉) ✓、红线词表扫档案页 ✓、新元素对比度现算 AA ✓')
    console.log('  6x 生长曲线入口·方案C(v3.5 · 用户 2026-10-20)：「我的」页「生长曲线」行整行跳曲线页(恰好一处,首页反向钉) ✓、「我的」不再复制只能删的清单(反向钉) ✓、记录列表紧跟曲线卡且位置钉死 ✓、current 压成曲线卡内一行+画布 392rpx ✓、没性别/超月龄分支单独一张 current 卡 ✓')
    console.log('  6x 首页头卡手写体(批⑫·用户 2026-10-16)：站酷快乐体子集 base64 内嵌、零网络 ✓、@font-face 家族名+字重描述符 600(防伪加粗) ✓、wOF2 魔数与统计行自洽 ✓、名字常用字覆盖(full 模式,GB2312 一级 3755 字) ✓、index 引入+两行挂家族+浅蓝 token ✓、浅蓝压品牌浅绿 ≥3:1(40rpx/600 按大字算) ✓、小标/★ 仍品牌绿 ✓、scripts 排除出上传包+整包 ≤2MB ✓')
  }

  /* ── 6y 首次进入弹窗 + 档案页分步向导（v3.1 · 用户 2026-10-19 拍板）─────
   *  两个改动互相咬合：弹窗负责「最少信息建好档」，向导负责「剩下的慢慢补」。
   *  所以弹窗里只许出现名字/生日/辅食日期 —— 性别与出生指标一旦进弹窗，
   *  首屏摩擦就加回来了，向导第 2 步也失去存在意义。这条是反向钉。 */
  {
    const errsBefore6y = errs.length
    const stj6y = fs.readFileSync('./utils/storage.js', 'utf8')
    const ij6y = fs.readFileSync('./pages/index/index.js', 'utf8')
    const iw6y = fs.readFileSync('./pages/index/index.wxml', 'utf8')
    const prj6y = fs.readFileSync('./pages/profile/profile.js', 'utf8')
    const prw6y = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')
    const prx6y = fs.readFileSync('./pages/profile/profile.wxss', 'utf8')

    // a) 默认名：存在、已导出、四位无前导零（1000 起）
    if (stj6y.indexOf('function defaultBabyName(') < 0)
      E('storage 缺 defaultBabyName —— 首次进入弹窗没有可预填的名字')
    if (stj6y.indexOf('defaultBabyName: defaultBabyName') < 0)
      E('defaultBabyName 没导出 —— 页面拿不到')
    if (!/1000 \+ Math\.floor\(Math\.random\(\) \* 9000\)/.test(stj6y))
      E('默认名不是「1000 + rand*9000」—— 会出现「宝贝0007」这种前导零编号')

    // b) 弹窗：触发走 isConfigured，且编号必须落库
    if (ij6y.indexOf('maybeOpenOnboard') < 0)
      E('index.js 缺 maybeOpenOnboard —— 首次进入不会弹窗')
    if (ij6y.indexOf('storage.defaultBabyName()') < 0)
      E('弹窗没调 defaultBabyName —— 名字是空的')
    if (ij6y.indexOf('storage.setBaby({ name: name })') < 0)
      E('默认名没落库 —— 每次启动会换一个编号，用户一眼看穿是假的')

    // c) 弹窗字段：名字 + 生日 + 辅食日期；性别/出生指标不许进来（反向钉）
    ;['obName', 'obBirthday', 'onObFoodStart', 'confirmOnboard', 'skipOnboard'].forEach((k) => {
      if (iw6y.indexOf(k) < 0) E('index.wxml 弹窗缺 ' + k)
    })
    // 只扫弹窗本体（ob-dialog → ob-skip），不扫文件里的注释 ——
    // 上面那段说明文字本身就写着这三个词
    const obBlock6y = (iw6y.match(/<view class="ob-dialog"[\s\S]*?<view class="ob-skip"/) || [''])[0]
    if (!obBlock6y)
      E('index.wxml 找不到 ob-dialog 弹窗本体 —— 选择器或结构被改了')
    ;['性别', '出生体重', '出生身长'].forEach((w) => {
      if (obBlock6y.indexOf(w) >= 0)
        E('弹窗里出现「' + w + '」—— 这三项不影响排菜，属于档案页第 2 步（反向钉）')
    })
    if (iw6y.indexOf('catchtouchmove="noop"') < 0)
      E('弹窗遮罩没挡 touchmove —— 背景页会跟着滚')

    // d) 向导：4 步、进度条可点、四个导航 handler 都在
    //    v3.2：原第 5 步「都记好了」整屏删除（用户 2026-10-19），收尾摘要没了
    ;['goStep', 'nextStep', 'prevStep', 'finish'].forEach((h) => {
      if (prj6y.indexOf(h + '(') < 0) E('profile.js 缺向导 handler ' + h)
      if (prw6y.indexOf('bindtap="' + h + '"') < 0) E('profile.wxml 没把 ' + h + ' 接到按钮上')
    })
    const stepCards6y = (prw6y.match(/step === \d/g) || []).length
    if (stepCards6y !== 4)
      E('档案页应为 4 张分步卡，实际 ' + stepCards6y + ' 张')
    if (prw6y.indexOf('wx:for="{{stepPips}}"') < 0)
      E('进度条没遍历 stepPips —— 步骤条会空')
    if (prw6y.indexOf('data-step="{{item}}"') < 0)
      E('进度条没绑 data-step —— 点不动，向导就只能一路翻页')

    // e) 闸门：没生日不许离开第 1 步（后三步全靠月龄，没它全是空转）
    if (prj6y.indexOf('!this.data.birthday') < 0)
      E('nextStep/goStep 没拦「没填生日」—— 会生成一份算不出月龄的空计划')

    // f) 样式：固定头/脚 + 进度条真的定义了（引用没定义 = 裸渲染）
    ;['.wiz-head', '.wiz-foot', '.step-pip', '.wiz-card', '.wiz-btn'].forEach((c) => {
      if (prx6y.indexOf(c + ' {') < 0) E('profile.wxss 缺 ' + c + ' —— 向导骨架没样式')
    })

    // g) 旧外壳不许借尸还魂：固定头脚和 page-wrap 的 padding 会打架
    if (prw6y.indexOf('page-wrap--safe') >= 0)
      E('档案页还留着旧的 page-wrap 外壳 —— 会和固定头脚打架')

    if (errs.length === errsBefore6y) {
      console.log('  6y 首次进入弹窗+档案页向导(v3.2·用户 2026-10-19)：默认名「宝贝+4位」落库一次不重算 ✓、触发走 isConfigured(不新增首次启动标志) ✓、弹窗只含名字/生日/辅食日期(性别与出生指标反向钉) ✓、跳过可用+遮罩挡滚 ✓、档案页 4 张分步卡+可点进度条+四个导航 handler ✓、没生日不放行 ✓、固定头脚样式齐全 ✓')
    }

    /* ── 6z 首页头卡「记录身高体重」胶囊（v3.2 方案A · 用户 2026-10-19 拍板）──
     *  位置：头卡 2×2 指标格下方，与「滑动查看各月龄注意事项」并排（两枚胶囊）。
     *  行为：点左胶囊 → 档案页第 5 步 + 直接弹测量面板（?metric=1）。
     *  反向钉：首页不许复制一套测量面板 UI —— 面板只存在档案页一份，
     *  否则改一处忘另一处，两边的校验口径迟早走样。 */
    const errsBefore6z = errs.length
    const ij6z = fs.readFileSync('./pages/index/index.js', 'utf8')
    const iw6z = fs.readFileSync('./pages/index/index.wxml', 'utf8')
    const iq6z = fs.readFileSync('./pages/index/index.wxss', 'utf8')
    const prj6z = fs.readFileSync('./pages/profile/profile.js', 'utf8')
    const prw6z = fs.readFileSync('./pages/profile/profile.wxml', 'utf8')
    const mw6z = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')

    // a) 两枚胶囊并排：双类选择器覆盖，原 .head-more-row 的 flex-end 一字不动
    if (iw6z.indexOf('head-more-row--dual') < 0)
      E('index.wxml 缺 head-more-row--dual —— 第二枚胶囊会挤在右侧，和月龄入口叠在一起')
    if (!/\.head-more-row\.head-more-row--dual\s*\{[^}]*space-between/.test(iq6z))
      E('.head-more-row--dual 没写 justify-content: space-between —— 两枚胶囊不会分到两端')
    if ((iw6z.match(/class="head-more"/g) || []).length !== 2)
      E('头卡胶囊不是恰好两枚 —— 方案A = 「记录身高体重」+「滑动查看各月龄注意事项」')

    // b) 左胶囊文案与接线：就地弹面板，不跳页
    if (iw6z.indexOf('记录身高体重') < 0)
      E('index.wxml 缺「记录身高体重」胶囊 —— 方案A 的入口没落地')
    if (!/bindtap="openMetricSheet"[^>]*>\s*<text class="hm-plus">＋<\/text>记录身高体重/.test(iw6z))
      E('「记录身高体重」胶囊没绑 openMetricSheet —— 死入口')
    if (/pages\/profile\/profile\?metric=1/.test(ij6z))
      E('首页又跳 profile?metric=1 —— v3.2 已改成就地弹面板，档案页没有面板了')

    // c) 反向钉：面板只存在一份，就在首页。档案页第 5 步与面板都不许复活
    if (/step === 5/.test(prw6z))
      E('档案页又出现第 5 步卡 —— 用户 2026-10-19 拍板整屏删除')
    ;['ms-head', 'metricOpen', 'mForm'].forEach((k) => {
      if (prw6z.indexOf(k) >= 0 || prj6z.indexOf(k) >= 0)
        E('档案页又出现测量面板的 ' + k + ' —— 面板只存在首页一份，别复制第二套 UI')
    })
    if (prj6z.indexOf('openMetricSheet') >= 0 || prj6z.indexOf('metricSummaryText') >= 0)
      E('profile.js 又出现测量面板 handler —— 面板已搬到首页（§6x-20a）')
    if (!/stepPips:\s*\[1,\s*2,\s*3,\s*4\]/.test(prj6z))
      E('档案页 stepPips 不是 [1,2,3,4] —— 第 5 步删了但进度条还是 5 段')

    // d) 备份搬家：「我的」页要有导出/导入（§6v 已钉接线，这里钉它真的在页面上）
    if (mw6z.indexOf('数据备份') < 0 || mw6z.indexOf('bindtap="onExport"') < 0)
      E('「我的」页没有数据备份卡 —— 档案页第 5 步删了，备份就没出口了')

    // e) 「我的」页空态文案要指向新入口
    if (mw6z.indexOf('到首页头卡') < 0)
      E('mine.wxml 生长记录空态还只指档案页 —— 首页现在也能记，文案要一起说')

    if (errs.length === errsBefore6z) {
      console.log('  6z 首页头卡「记录身高体重」胶囊(v3.2 方案A·用户 2026-10-19)：两枚胶囊两端对齐 ✓、文案+openMetricSheet 就地弹面板 ✓、档案页第 5 步与面板均未复活(反向钉) ✓、stepPips 收窄为 4 ✓、备份已落「我的」页 ✓、空态文案同步 ✓')
    }

    /* ── 6z-2 我的记录三格化（v3.4 · 用户 2026-10-19 拍板）────────────────
     *  三行（已吃过 / 有反应 / 累计）改成三格并列：数字提主视觉、标签做注解，
     *  高度从 3 行压到 1 行。展开逻辑不变（openRow + toggleRow 一字未改），
     *  三块清单集中放在三格下方。
     *  反向钉：三行旧文案不许回来 —— 回来就是又占掉三行高度。 */
    const errsBefore6z2 = errs.length
    const mw62 = fs.readFileSync('./pages/mine/mine.wxml', 'utf8')
    const mq62 = fs.readFileSync('./pages/mine/mine.wxss', 'utf8')
    ;['safe', 'bad', 'all'].forEach((r) => {
      if (mw62.indexOf('data-row="' + r + '"') < 0)
        E('我的记录三格缺 data-row="' + r + '" —— 那一格点了没反应（§6z-2）')
    })
    ;['safeCount', 'badCount', 'recordedCount'].forEach((k) => {
      if (mw62.indexOf('{{' + k + '}}') < 0)
        E('三格缺 ' + k + ' —— 数字是空的（§6z-2）')
    })
    ;['已吃过、没问题的食材', '有反应、已排除的食材', '累计记录过的食材'].forEach((t) => {
      if (mw62.indexOf(t) >= 0)
        E('我的记录又退回三行文案「' + t + '」—— v3.4 已改三格，别再占三行（§6z-2）')
    })
    if ((mw62.match(/class="trio-cell/g) || []).length !== 3)
      E('我的记录不是恰好三格 —— 三行改三格是用户 2026-10-19 拍板的形态（§6z-2）')
    ;['.trio', '.trio-cell', '.trio-num', '.trio-on'].forEach((c) => {
      if (mq62.indexOf(c + ' {') < 0) E('mine.wxss 缺 ' + c + ' —— 三格没样式（§6z-2）')
    })
    if (errs.length === errsBefore6z2) {
      console.log('  6z-2 我的记录三格化(v3.4·用户 2026-10-19)：三格 + 三个 data-row ✓、数字绑三个计数 ✓、展开清单仍在三格下方 ✓、旧三行文案反向钉 ✓、样式齐全 ✓')
    }
  }
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
