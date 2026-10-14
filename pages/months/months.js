/* 各月龄滑动指南页（v2.30；v2.31 改 8 页；v2.32 落页双时钟分流）
 * 入口：首页【当前状态】行下方胶囊按钮「滑动查看各月龄注意事项」（index.goMonths）。
 * 每页三块：怎么喂 + 注意事项 + 一周食谱（参考）。
 *   - 知识卡：data/guides.js —— 6 月龄两张卡原题保留、7–12 月分月卡；
 *     13–24 月龄不再逐月做（v2.31 · 用户决策）：统一为最后一页「1 岁以上」
 *     （guides.onePlus，幼儿期「软着陆」口径，首页 13 月龄起也挂同一份）。
 *   - 一周食谱：plan.generate 按月龄现算 7 天（1 岁以上页按 13 月龄起点现算）。
 *     **通用样例**：全部食材视同已引入（safeFoodIds = 全量），不带宝宝个人排除 ——
 *     这是「各月龄参考」，不是宝宝的个人计划（个人计划在首页）。
 *   - 6 月龄走 MENU_6 固定菜单：birth 锚到 startDate − 6 个月 → 菜单第 1–7 天。
 * 渲染节制：8 个 swiper-item 只常渲染「当前 ±1」—— 全渲染会顶到小程序
 * 单页节点上限；远页留骨架，滑到（或点指示点跳到）再挂内容。
 */
const guides = require('../../data/guides.js')
const foods = require('../../data/foods.js')
const age = require('../../utils/age.js')
const plan = require('../../utils/plan.js')
const storage = require('../../utils/storage.js')

// 7–12 月龄知识组（与 index.js 的 guideLater 同一张映射表）
const LATER = {
  7: guides.sevenMonth,
  8: guides.eightMonth,
  9: guides.nineMonth,
  10: guides.tenMonth,
  11: guides.elevenMonth,
  12: guides.twelveMonth
}

// 通用样例：全部食材视同「已引入且安全」→ 菜池最完整（不带个人排除）
const ALL_IDS = foods.map(function (f) { return f.id })

Page({
  data: {
    current: 0,   // swiper 下标（0 = 6 月龄，7 = 1 岁以上）
    slides: []
  },

  onLoad() {
    // 默认停在宝宝当前月龄（v2.32 双时钟分流，§6w）：「1 岁以上」页看**生理
    // 月龄 ≥13**（幼儿期口径是生理的）；6–12 月页看**辅食月龄**（没填辅食日期
    // 时 = 生理月龄，行为不变）。越界/没建档从 6 月龄开始
    let idx = 0
    try {
      if (storage.isConfigured()) {
        const baby = storage.getBaby()
        const phys = age.monthsBetween(baby.birthday)
        const fm = age.foodMonthsOf(baby)
        if (phys >= 13) idx = 7
        else if (fm >= 6 && fm <= 12) idx = fm - 6
      }
    } catch (e) { /* 走默认 6 月龄 */ }

    this.setData({
      current: idx,
      slides: this.buildSlides(idx)
    })
  },

  buildSlides(curIdx) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    // 6 月龄菜单锁定要求 anchor（生日 + 6 个月）= startDate → 生日 = startDate − 6 个月
    const b = new Date(start.getFullYear(), start.getMonth() - 6, start.getDate())
    const birth = plan.dateKey(b)

    const slides = []
    // 6–12 月：逐月页（知识卡 = 6 月原题卡 / 7–12 分月卡）
    for (let m = 6; m <= 12; m++) {
      const st = age.getStage(m)
      const slide = {
        key: 'm' + m,
        month: m,
        title: m + ' 月龄',
        stageLabel: st ? st.label : '',
        stageDesc: st ? st.desc : '',
        menuTip: '按 ' + m + ' 月龄现算的 7 天样例，不带宝宝个人的食材排除；个人计划在首页。',
        cards: m === 6 ? guides.sixMonth : LATER[m],
        menu: [],
        active: Math.abs(slides.length - curIdx) <= 1 // 只常渲染当前 ±1（节点上限）
      }
      const p = plan.generate({
        months: m,
        startDate: start,
        birth: birth,
        safeFoodIds: ALL_IDS,
        blockedFoodIds: [],
        recordedFoodIds: ALL_IDS
      })
      if (p) slide.menu = this.menuRows(p)
      slides.push(slide)
    }

    // 1 岁以上（13–24 统一，v2.31 · 用户决策）：样例食谱按 13 月龄起点现算
    const plus = {
      key: 'plus',
      month: 13,
      title: '1 岁以上',
      stageLabel: '幼儿期',
      stageDesc: '从辅食向家庭饮食过渡的「软着陆」阶段',
      menuTip: '按 13 月龄（1 岁以上起点）现算的 7 天样例，不带宝宝个人的食材排除；个人计划在首页。',
      cards: guides.onePlus,
      menu: [],
      active: Math.abs(7 - curIdx) <= 1
    }
    const pp = plan.generate({
      months: 13,
      startDate: start,
      birth: birth,
      safeFoodIds: ALL_IDS,
      blockedFoodIds: [],
      recordedFoodIds: ALL_IDS
    })
    if (pp) plus.menu = this.menuRows(pp)
    slides.push(plus)

    return slides
  },

  // plan.days → 渲染行：时刻从 age.slotsForMonth 的正餐/加餐槽对齐
  // （main 槽数 === mealsForMonth，与 index.markToday 的 timeline 同一套对位规则）
  menuRows(p) {
    const slots = age.slotsForMonth(p.months)
    const mains = slots.filter(function (s) { return s.kind === 'main' })
    const snackSlot = slots.filter(function (s) { return s.kind === 'snack' })[0]
    return p.days.map(function (d) {
      const items = []
      ;(d.meals || []).forEach(function (meal, i) {
        items.push({
          id: (mains[i] ? mains[i].time : '') + i,
          time: mains[i] ? mains[i].time : '',
          name: meal.name,
          texture: meal.texture,
          kind: 'main'
        })
      })
      if (d.snack) {
        items.push({
          id: (snackSlot ? snackSlot.time : '') + 'snack',
          time: snackSlot ? snackSlot.time : '',
          name: d.snack.name,
          texture: d.snack.texture,
          kind: 'snack'
        })
      }
      return {
        id: d.date,
        weekday: d.weekday,
        dateLabel: d.dateLabel,
        isWeekend: !!d.isWeekend,
        items: items
      }
    })
  },

  // 滑动切换：current 跟着 swiper 走，同时维护「当前 ±1」的 active 窗口
  onMonthChange(e) {
    const idx = +e.detail.current
    const upd = { current: idx }
    this.data.slides.forEach(function (s, i) {
      const on = Math.abs(i - idx) <= 1
      if (!!s.active !== on) upd['slides[' + i + '].active'] = on
    })
    this.setData(upd)
  }
})
