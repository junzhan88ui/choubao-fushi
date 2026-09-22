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

/* ---------- 4. 标签体系对齐：ISSUE_TAG 的值必须真的存在于菜谱标签里 ---------- */
const planSrc = fs.readFileSync('./utils/plan.js', 'utf8')
const issueTagBlock = planSrc.match(/ISSUE_TAG\s*=\s*\{([\s\S]*?)\}/)
if (!issueTagBlock) E('plan.js 里找不到 ISSUE_TAG')
else {
  const vals = [...issueTagBlock[1].matchAll(/:\s*'([^']*)'/g)].map((m) => m[1]).filter(Boolean)
  const allTags = new Set()
  recipes.forEach((r) => (r.tags || []).forEach((t) => allTags.add(t)))
  vals.forEach((v) => {
    if (!allTags.has(v)) E(`ISSUE_TAG 用了「${v}」，但没有任何菜谱带这个标签，加权会全部落空`)
  })
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
  const p = plan.generate({ months: m, issue: 'none', safeFoodIds: [], recordedFoodIds: [], observingCount: 0 })
  if (p) E(`plan.generate({months:${m}}) 应该返回 null（超出覆盖范围），实际生成了 ${p.days ? p.days.length : '?'} 天`)
})

// 覆盖范围内必须能生成出东西，且每天至少有 1 餐
;[6, 8, 10, 12, 18, 24].forEach(function (m) {
  const p = plan.generate({
    months: m, issue: 'none',
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
const noSafe = plan.generate({ months: 8, issue: 'none', safeFoodIds: [], blockedFoodIds: [], recordedFoodIds: [], observingCount: 0 })
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
      months: mm, issue: 'none', safeFoodIds: introduced, blockedFoodIds: [],
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
  months: 8, issue: 'none', safeFoodIds: [], blockedFoodIds: [badId],
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
  months: 10, issue: 'none', safeFoodIds: foods.map(function (f) { return f.id }),
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
        months: m, issue: 'none', safeFoodIds: foods.map(function (f) { return f.id }),
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
    months: m, issue: 'none', safeFoodIds: foods.map(function (f) { return f.id }),
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
    months: m, issue: 'none', sick: true,
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

/* ---------- 6. storage 关键函数 ---------- */
;['ensureInit', 'getBaby', 'setBaby', 'isConfigured', 'getIntroduced', 'markIntroduced',
  'safeFoodIds', 'observingFoodIds', 'badFoodIds', 'dueObservations', 'getIssue', 'setIssue',
  'getPlan', 'setPlan', 'resetAll'].forEach((fn) => {
  if (typeof storage[fn] !== 'function') E(`storage.js 缺函数 ${fn}`)
})

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
