/* 各月龄滑动指南页（v2.30）
 * 入口：首页【当前状态】行右侧「滑动查看各月龄注意事项」（index.goMonths）。
 * 每页三块：怎么喂 + 注意事项 + 一周食谱（参考）。
 *   - 知识卡：data/guides.js —— 6 月龄两张卡原题保留、7–12 月分月卡；
 *     13–24 月龄暂无数据 → 占位「内容整理中」（用户决策：先占位，不硬编内容）。
 *   - 一周食谱：plan.generate 按月龄现算 7 天。**通用样例**：全部食材视同已引入
 *     （safeFoodIds = 全量），不带宝宝个人排除 —— 这是「各月龄参考」，
 *     不是宝宝的个人计划（个人计划在首页）。
 *   - 6 月龄走 MENU_6 固定菜单：birth 锚到 startDate − 6 个月 → 菜单第 1–7 天。
 * 渲染节制：19 个 swiper-item 只常渲染「当前 ±1」三页 —— 全渲染会顶到小程序
 * 单页节点上限；远页留月份骨架，滑到（或点指示点跳到）再挂内容。
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

// 13–24 月龄占位卡（用户决策：内容先占位「整理中」，不硬编）
const PLACEHOLDER = [
  { key: 'ph-how', icon: '📖', iconBg: '#f0efeb', title: '怎么喂', placeholder: true },
  { key: 'ph-warn', icon: '📌', iconBg: '#faeeda', title: '注意事项', placeholder: true }
]

// 通用样例：全部食材视同「已引入且安全」→ 菜池最完整（不带个人排除）
const ALL_IDS = foods.map(function (f) { return f.id })

Page({
  data: {
    current: 0,   // swiper 下标（0 = 6 月龄）
    slides: []
  },

  onLoad() {
    const months = []
    for (let m = 6; m <= 24; m++) months.push(m)

    // 默认停在宝宝当前月龄（越界/没建档就从 6 月龄开始）
    let cur = 6
    try {
      if (storage.isConfigured()) {
        const mm = age.monthsBetween(storage.getBaby().birthday)
        if (mm >= 6 && mm <= 24) cur = mm
      }
    } catch (e) { /* 走默认 6 月龄 */ }

    this.setData({
      current: cur - 6,
      slides: this.buildSlides(months, cur - 6)
    })
  },

  buildSlides(months, curIdx) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    // 6 月龄菜单锁定要求 anchor（生日 + 6 个月）= startDate → 生日 = startDate − 6 个月
    const b = new Date(start.getFullYear(), start.getMonth() - 6, start.getDate())
    const birth = plan.dateKey(b)

    return months.map((m, idx) => {
      const st = age.getStage(m)
      // 6 → 两张原题卡；7–12 → 分月卡；13–24 → 占位「整理中」
      const cards = m === 6 ? guides.sixMonth : (LATER[m] || PLACEHOLDER)
      const slide = {
        month: m,
        stageLabel: st ? st.label : '',
        stageDesc: st ? st.desc : '',
        cards: cards,
        menu: [],
        active: Math.abs(idx - curIdx) <= 1 // 只常渲染当前 ±1 三页（节点上限）
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
      return slide
    })
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
