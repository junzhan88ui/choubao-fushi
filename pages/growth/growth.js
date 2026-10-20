/**
 * 生长曲线页（v3.0 · pages/growth）
 *
 * 红线：只做记录与展示，不做营养评估 —— 页面只出数值、百分位、区间名，
 * 不出现任何评价词（_validate §6x 有词表反向钉）。
 *
 * 分流：日龄走 age.daysBetween（生理钟），百分位走 growth.pointsFor
 * （缺性别 / 超 60 月的闸门与全部数学都在 utils/growth.js，页面不自己算 z）。
 * 照片：只在首页头卡（批⑦ 接真照片、单张落盘），曲线页零媒体（§6x 钉）。
 * 入口：v3.5（用户 2026-10-20 拍板方案 C）从「我的」页「生长曲线」行整行跳入 ——
 *   决策④「零入口」到此作废；本页同时是全站唯一一份测量记录清单（能改能删），
 *   「我的」页不再复制一份只能删的副本。
 * 分享：批⑧ —— 双钩子（好友/朋友圈）同文案，见 utils/share.js 三项拍板。
 */
const storage = require('../../utils/storage')
const age = require('../../utils/age')
const growth = require('../../utils/growth')
const share = require('../../utils/share')

// 参考线百分位：WHO 图上的那几条整点线
const REF_PCTS = [3, 10, 50, 90, 97]

// 画布颜色：canvas 不认 CSS 变量，值全部取自 app.wxss token（注释标来源）
const C = {
  bandEven: 'rgba(44, 44, 42, 0.04)', // --c-text 淡染：交替灰带浅档
  bandOdd: 'rgba(44, 44, 42, 0.09)', // --c-text 淡染：交替灰带深档
  ref: '#c4c3bd', // 参考线（--c-line 加深一档，线条非文本）
  ref50: '#9c9b94', // P50 中位线略重
  axis: '#6f6e6a', // --c-text-3，白底 5.1:1，AA 过（坐标文字）
  line: '#5f8b28', // --c-green 实测折线
  dot: '#3b6d11', // --c-green-dark 实测点
  ring: '#ffffff'
}

Page({
  data: {
    configured: false, // 出生日期填了没
    name: '',
    ageText: '',
    hasSex: false,
    beyond: false, // 生理日龄超 60 月：曲线覆盖外
    empty: false,
    showChart: false,
    metrics: [], // [{key,label,unit}]，分段切换用
    metricKey: 'weight',
    metricLabel: '体重',
    unit: 'kg',
    ph: {}, // 输入占位（区间来自 storage.GROWTH_METRICS，单一来源）
    records: [], // 列表行
    cur: null, // 当前位置卡
    editing: false,
    editDate: '',
    form: { date: '', minDate: '', maxDate: '', weight: '', length: '', head: '' },
    disclaimer: growth.DISCLAIMER
  },

  onLoad() {
    const ph = {}
    Object.keys(storage.GROWTH_METRICS).forEach((k) => {
      const m = storage.GROWTH_METRICS[k]
      ph[k] = '选填 ' + m.min + '–' + m.max
    })
    this.setData({ metrics: Object.keys(growth.METRICS).map((k) => growth.METRICS[k]), ph: ph })
    this.resetForm()
  },

  onShow() {
    this.reload()
  },

  reload() {
    const baby = storage.getBaby() || {}
    const configured = !!(baby && baby.birthday)
    const sex = baby.sex || ''
    const hasSex = sex === 'm' || sex === 'f'
    const records = storage.getGrowth()
    this._records = records
    const today = storage.todayStr()
    const days = configured ? age.daysBetween(baby.birthday, today) : null
    const beyond = days !== null && growth.monthOf(days) > growth.MAX_MONTH
    const metricKey = this.data.metricKey
    const unit = growth.METRICS[metricKey].unit
    const points = growth.pointsFor(records, metricKey, baby)

    // 列表行：值文案 + 当前指标的区间 chip（缺性别/超范围时 chip 不出）
    const rows = records.map((r, i) => {
      const pt = points[i] || {}
      const vals = []
      if (r.weight !== undefined) vals.push('体重 ' + r.weight + ' kg')
      if (r.length !== undefined) vals.push('身长 ' + r.length + ' cm')
      if (r.head !== undefined) vals.push('头围 ' + r.head + ' cm')
      return {
        date: r.date,
        vText: vals.join(' · '),
        band: pt.band ? pt.band.label : '',
        p: pt.p !== null && pt.p !== undefined ? 'P' + Math.round(pt.p) : '',
        hasBand: !!(hasSex && !beyond && pt.band)
      }
    })

    // 当前位置：最新有值的记录 + 与上次差值 + 距今天数。
    // v3.5 起它压成曲线卡里的一行，所以文案要短 —— 精确百分位（「第 41 百分位」）
    // 不再重复：区间 chip 已经给出位置，记录列表每行右侧还带 P 值。
    let cur = null
    const withVal = points.filter((p) => p.value !== undefined && p.value !== null && p.value !== '')
    if (withVal.length) {
      const last = withVal[withVal.length - 1]
      const prev = withVal.length > 1 ? withVal[withVal.length - 2] : null
      const delta = prev ? Math.round((last.value - prev.value) * 10) / 10 : null
      const ago = age.daysBetween(last.date, today)
      const meta = []
      if (delta !== null) meta.push('较上次 ' + (delta > 0 ? '+' + delta : '' + delta))
      if (ago !== null && ago >= 0) meta.push(ago === 0 ? '今天刚测过' : ago + ' 天前')
      cur = {
        valueText: last.value + ' ' + unit,
        bandLabel: hasSex && last.band ? last.band.label : '',
        hasBand: !!(hasSex && last.band),
        metaText: meta.join(' · ')
      }
    }

    const showChart = configured && hasSex && !beyond && records.length > 0

    // 画布数据（实例字段，不进 setData，避免序列化开销）
    const series = showChart
      ? REF_PCTS.map((p) => ({ p: p, values: growth.percentileCurve(metricKey, sex, p) })).filter((s) => s.values)
      : []
    const chartPts = points
      .filter((p) => p.p !== null && p.p !== undefined && isFinite(p.month) && p.value !== undefined)
      .map((p, i, arr) => ({ month: p.month, value: p.value, latest: i === arr.length - 1 }))
    this._chart = { series: series, points: chartPts }

    const form = this.data.editing
      ? this.data.form
      : Object.assign({}, this.data.form, { minDate: baby.birthday || '', maxDate: today })

    this.setData(
      {
        configured: configured,
        name: baby.name || '',
        ageText: configured ? age.describeAge(baby.birthday) : '',
        hasSex: hasSex,
        beyond: beyond,
        empty: records.length === 0,
        showChart: showChart,
        records: rows,
        cur: cur,
        unit: unit,
        metricLabel: growth.METRICS[metricKey].label,
        form: form
      },
      () => {
        if (this.data.showChart) this.drawChart()
      }
    )
  },

  /* —— 画布 —— */
  drawChart() {
    if (this._drawing) return
    this._drawing = true
    const q = wx.createSelectorQuery()
    q.select('#curve')
      .fields({ node: true, size: true })
      .exec((res) => {
        this._drawing = false
        const info = res && res[0]
        if (!info || !info.node) {
          if (!this._retry) {
            this._retry = true
            setTimeout(() => {
              this._retry = false
              this.drawChart()
            }, 80)
          }
          return
        }
        const canvas = info.node
        const ctx = canvas.getContext('2d')
        let dpr = 2
        try {
          if (wx.getWindowInfo) dpr = wx.getWindowInfo().pixelRatio || 2
          else if (wx.getSystemInfoSync) dpr = wx.getSystemInfoSync().pixelRatio || 2
        } catch (e) {
          dpr = 2
        }
        canvas.width = Math.round(info.width * dpr)
        canvas.height = Math.round(info.height * dpr)
        ctx.scale(dpr, dpr)
        this.paint(ctx, info.width, info.height)
      })
  },

  paint(ctx, W, H) {
    const chart = this._chart
    if (!chart || !chart.series.length) return
    const padL = 30
    const padR = 34
    const padT = 12
    const padB = 22
    const plotW = Math.max(10, W - padL - padR)
    const plotH = Math.max(10, H - padT - padB)

    // y 域：参考线 + 实测值一起定界，上下留 8%
    let min = Infinity
    let max = -Infinity
    const acc = (v) => {
      if (v === null || v === undefined || !isFinite(v)) return
      if (v < min) min = v
      if (v > max) max = v
    }
    chart.series.forEach((s) => s.values.forEach(acc))
    chart.points.forEach((p) => acc(p.value))
    if (!isFinite(min) || !isFinite(max)) return
    if (max - min < 0.5) {
      max += 0.3
      min -= 0.3
    }
    const span = max - min
    min -= span * 0.08
    max += span * 0.08
    const X = (m) => padL + (m / growth.MAX_MONTH) * plotW
    const Y = (v) => padT + plotH * (1 - (v - min) / (max - min))

    const curveOf = (p) => {
      const s = chart.series.filter((x) => x.p === p)[0]
      return s ? s.values : null
    }
    const p3 = curveOf(3)
    const p10 = curveOf(10)
    const p50 = curveOf(50)
    const p90 = curveOf(90)
    const p97 = curveOf(97)

    // 六带（底→顶）交替淡染：P3 以下 / P3–P10 / P10–P50 / P50–P90 / P90–P97 / P97 以上
    const zones = [
      { lo: null, hi: p3 },
      { lo: p3, hi: p10 },
      { lo: p10, hi: p50 },
      { lo: p50, hi: p90 },
      { lo: p90, hi: p97 },
      { lo: p97, hi: null }
    ]
    zones.forEach((z, i) => {
      if (!z.hi && !z.lo) return
      ctx.fillStyle = i % 2 === 0 ? C.bandEven : C.bandOdd
      ctx.beginPath()
      for (let m = 0; m <= growth.MAX_MONTH; m++) {
        const yv = z.hi ? z.hi[m] : max
        if (m === 0) ctx.moveTo(X(0), Y(yv))
        else ctx.lineTo(X(m), Y(yv))
      }
      for (let m = growth.MAX_MONTH; m >= 0; m--) {
        const yv = z.lo ? z.lo[m] : min
        ctx.lineTo(X(m), Y(yv))
      }
      ctx.closePath()
      ctx.fill()
    })

    // 参考线 + 右缘标签
    const drawRef = (values, label, strong) => {
      if (!values) return
      ctx.strokeStyle = strong ? C.ref50 : C.ref
      ctx.lineWidth = strong ? 1.4 : 1
      ctx.beginPath()
      values.forEach((v, m) => {
        if (m === 0) ctx.moveTo(X(m), Y(v))
        else ctx.lineTo(X(m), Y(v))
      })
      ctx.stroke()
      ctx.fillStyle = C.axis
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, W - padR + 4, Y(values[growth.MAX_MONTH]))
    }
    drawRef(p3, 'P3', false)
    drawRef(p10, 'P10', false)
    drawRef(p50, 'P50', true)
    drawRef(p90, 'P90', false)
    drawRef(p97, 'P97', false)

    // 坐标文字：左缘 3 个值刻度，底缘月龄
    ctx.fillStyle = C.axis
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const yTicks = [min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15]
    yTicks.forEach((v) => {
      ctx.fillText(v.toFixed(1), padL - 5, Y(v))
    })
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ;[0, 12, 24, 36, 48, 60].forEach((m) => {
      ctx.fillText(m === 60 ? '60 月' : String(m), X(m), H - 6)
    })

    // 实测折线（单点不画线，只画点）
    const pts = chart.points.filter((p) => isFinite(p.value))
    if (pts.length > 1) {
      ctx.strokeStyle = C.line
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(X(p.month), Y(p.value))
        else ctx.lineTo(X(p.month), Y(p.value))
      })
      ctx.stroke()
    }
    pts.forEach((p) => {
      ctx.beginPath()
      ctx.arc(X(p.month), Y(p.value), p.latest ? 4 : 2.5, 0, Math.PI * 2)
      ctx.fillStyle = C.dot
      ctx.fill()
      if (p.latest) {
        ctx.strokeStyle = C.ring
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    })
  },

  /* —— 交互 —— */
  onMetricTap(e) {
    const k = e.currentTarget.dataset.k
    if (k === this.data.metricKey) return
    this.setData({ metricKey: k })
    this.reload()
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value })
  },
  onWeightInput(e) {
    this.setData({ 'form.weight': e.detail.value })
  },
  onLengthInput(e) {
    this.setData({ 'form.length': e.detail.value })
  },
  onHeadInput(e) {
    this.setData({ 'form.head': e.detail.value })
  },

  onSave() {
    const f = this.data.form
    const rec = { date: f.date }
    const fields = [
      { k: 'weight', label: '体重', unit: 'kg' },
      { k: 'length', label: '身长', unit: 'cm' },
      { k: 'head', label: '头围', unit: 'cm' }
    ]
    let any = false
    for (let i = 0; i < fields.length; i++) {
      const fd = fields[i]
      const raw = String(f[fd.k] === undefined || f[fd.k] === null ? '' : f[fd.k]).trim()
      if (raw === '') continue
      const n = Number(raw)
      const range = storage.GROWTH_METRICS[fd.k]
      if (!isFinite(n) || n < range.min || n > range.max) {
        wx.showToast({ title: fd.label + ' ' + range.min + '–' + range.max + ' ' + fd.unit, icon: 'none' })
        return
      }
      rec[fd.k] = Math.round(n * 10) / 10
      any = true
    }
    if (!any) {
      wx.showToast({ title: '至少填一项测量值', icon: 'none' })
      return
    }
    if (!storage.upsertGrowthRecord(rec)) {
      wx.showToast({ title: '日期要在出生到今天之间', icon: 'none' })
      return
    }
    wx.showToast({ title: '已记录', icon: 'success' })
    this.resetForm()
    this.reload()
  },

  onRowTap(e) {
    const date = e.currentTarget.dataset.date
    const list = this._records || []
    const rec = list.filter((r) => r.date === date)[0]
    if (!rec) return
    const baby = storage.getBaby() || {}
    this.setData({
      editing: true,
      editDate: date,
      form: {
        date: rec.date,
        minDate: baby.birthday || '',
        maxDate: storage.todayStr(),
        weight: rec.weight !== undefined ? String(rec.weight) : '',
        length: rec.length !== undefined ? String(rec.length) : '',
        head: rec.head !== undefined ? String(rec.head) : ''
      }
    })
  },

  onCancelEdit() {
    this.resetForm()
  },

  onDelete() {
    const date = this.data.editDate
    if (!date) return
    wx.showModal({
      title: '删除记录',
      content: '删除 ' + date + ' 这条测量记录？',
      success: (res) => {
        if (!res.confirm) return
        storage.removeGrowthRecord(date)
        this.resetForm()
        this.reload()
      }
    })
  },

  resetForm() {
    const baby = storage.getBaby() || {}
    const today = storage.todayStr()
    this.setData({
      editing: false,
      editDate: '',
      form: { date: today, minDate: baby.birthday || '', maxDate: today, weight: '', length: '', head: '' }
    })
  },

  // 分享（批⑧）：曲线页内容型标题，微信自动截当前页，path 落回本页
  onShareAppMessage() {
    return share.card(share.TITLES.growth, '/pages/growth/growth')
  },

  onShareTimeline() {
    return share.card(share.TITLES.growth, '/pages/growth/growth')
  }
})
