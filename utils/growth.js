/**
 * v3.0 成长曲线 · 计算层（纯函数，无 wx、无副作用）
 *
 * 三个来源，各管一段：
 *   日龄    —— utils/age.js 的 daysBetween（生理钟唯一入口，不看首次辅食
 *              日期；生长属「安全与事实类」，§6w 分流表）
 *   LMS 表  —— data/who-growth.js（WHO Child Growth Standards 2006 官方
 *              展开表生成，0–60 月逐月，男/女两套）
 *   区间    —— 六带中性命名（P3 以下 / P3–P10 / P10–P50 / P50–P90 /
 *              P90–P97 / P97 以上）
 *
 * 红线：只做记录与展示，不做营养评估。
 *   本模块只输出「数值 + z + 百分位 + 区间标签」，绝不输出评价词
 *   （偏瘦/偏胖/发育迟缓/正常范围…），也不给任何建议 —— 那是医生的事。
 *
 * z-score 用 LMS（Box-Cox）法：
 *   L ≠ 0:  z = ((x/M)^L − 1) / (L·S)
 *   L = 0:  z = ln(x/M) / S
 * 百分位用标准正态 CDF（Abramowitz–Stegun erf 逼近，|ε| < 1.5e-7，自写不引库）。
 */
const age = require('./age')
const who = require('../data/who-growth')

/** 日龄 → 月龄的换算系数（WHO 表按月龄发布，与生成脚本同口径） */
const DAYS_PER_MONTH = 30.4375

/** WHO 2006 标准覆盖 0–5 岁 = 0–60 月龄，超出不出百分位（只出记录） */
const MAX_MONTH = 60

/** 指标 → WHO 表名 + 页面文案 */
const METRICS = {
  weight: { key: 'weight', label: '体重', unit: 'kg', table: 'wfa' },
  length: { key: 'length', label: '身长', unit: 'cm', table: 'lhfa' },
  head: { key: 'head', label: '头围', unit: 'cm', table: 'hcfa' }
}

/**
 * 六个区间带（决策②口径：只给 P 值区间，不加任何形容词）。
 * lo 闭、hi 开；顶层 gt97 用 hi=101 兜住 p=100。
 * 边界归属：P3 → P3–P10，P50 → P50–P90，P97 → P97 以上（§6x 钉死）。
 */
const BANDS = [
  { key: 'lt3', lo: 0, hi: 3, label: 'P3 以下' },
  { key: 'p3p10', lo: 3, hi: 10, label: 'P3–P10' },
  { key: 'p10p50', lo: 10, hi: 50, label: 'P10–P50' },
  { key: 'p50p90', lo: 50, hi: 90, label: 'P50–P90' },
  { key: 'p90p97', lo: 90, hi: 97, label: 'P90–P97' },
  { key: 'gt97', lo: 97, hi: 101, label: 'P97 以上' }
]

/** 恒定说明句：区间卡与免责声明共用这句，任何百分位露出的地方都必须带上 */
const DISCLAIMER = '百分位只表示在同龄同性别儿童中的位置，不是健康评价；有疑问请咨询医生。'

/** 日龄 → 月龄（浮点，供表内插值） */
function monthOf(days) {
  return days / DAYS_PER_MONTH
}

/**
 * 取某月龄的 LMS 三元组（月龄间线性插值）。
 * @returns {number[]|null} [L, M, S]；越界/缺表/缺性别 → null
 */
function lmsAt(metricKey, sex, month) {
  if (month === null || month === undefined || !isFinite(month)) return null
  if (month < 0 || month > MAX_MONTH) return null
  const tableKey = METRICS[metricKey] ? METRICS[metricKey].table : null
  const sexKey = sex === 'm' ? 'male' : sex === 'f' ? 'female' : null
  if (!tableKey || !sexKey) return null
  const table = who[tableKey] && who[tableKey][sexKey]
  if (!Array.isArray(table) || table.length !== MAX_MONTH + 1) return null
  const i0 = Math.floor(month)
  const i1 = i0 >= MAX_MONTH ? MAX_MONTH : i0 + 1
  const f = month - i0
  const a = table[i0]
  const b = table[i1]
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f
  ]
}

/** LMS → z 分数 */
function zScore(x, L, M, S) {
  if (!(x > 0) || !(M > 0) || !(S > 0)) return null
  if (L === 0) return Math.log(x / M) / S
  return (Math.pow(x / M, L) - 1) / (L * S)
}

/** 标准正态 CDF（erf 有理逼近，|ε| < 1.5e-7）→ 百分位 0–100 */
function percentileOf(z) {
  if (z === null || z === undefined || !isFinite(z)) return null
  const x = z / Math.SQRT2
  const a = x < 0 ? -x : x
  const t = 1 / (1 + 0.3275911 * a)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
    0.284496736) * t + 0.254829592) * t
  const erf = (x < 0 ? -1 : 1) * (1 - poly * Math.exp(-a * a))
  const p = 50 * (1 + erf)
  return p < 0 ? 0 : p > 100 ? 100 : p
}

/** 百分位 → 六带区间 */
function bandOf(p) {
  if (p === null || p === undefined || !isFinite(p)) return null
  for (let i = 0; i < BANDS.length; i++) {
    if (p >= BANDS[i].lo && p < BANDS[i].hi) return BANDS[i]
  }
  return null
}

/**
 * 一次测量 → 百分位。
 * @param {string} metricKey 'weight' | 'length' | 'head'
 * @param {number} value 测量值（kg / cm）
 * @param {number} days 生理日龄（age.daysBetween）
 * @param {string} sex 'm' | 'f'（缺性别不出百分位 —— WHO 表分男女，查错表比不查更糟）
 * @returns {{z:number,p:number,band:object}|null} null = 缺性别/缺数值/日龄或月龄越界
 */
function metricAt(metricKey, value, days, sex) {
  if (value === null || value === undefined || value === '') return null
  if (days === null || days === undefined || !isFinite(days) || days < 0) return null
  const lms = lmsAt(metricKey, sex, monthOf(days))
  if (!lms) return null
  const z = zScore(Number(value), lms[0], lms[1], lms[2])
  if (z === null) return null
  const p = percentileOf(z)
  if (p === null) return null
  return { z: z, p: p, band: bandOf(p) }
}

/**
 * 记录列表 → 曲线点（升序，含原因标记，页面按标记分流展示）。
 * 点形状：{ date, days, month, value, z, p, band, reason }
 *   reason: undefined = 正常；'no_sex' = 没填性别；'no_range' = 超 0–60 月；'no_value' = 该指标没记
 * @param {Array} records storage.getGrowth() 的记录（已按日期升序）
 * @param {string} metricKey
 * @param {{birthday:string,sex?:string}} baby
 */
function pointsFor(records, metricKey, baby) {
  const out = []
  const list = Array.isArray(records) ? records : []
  const sex = baby ? baby.sex : ''
  const birthday = baby ? baby.birthday : ''
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r) continue
    const days = birthday ? age.daysBetween(birthday, r.date) : null
    const point = {
      date: r.date,
      days: days,
      month: days === null ? null : monthOf(days),
      value: r[metricKey],
      z: null,
      p: null,
      band: null,
      reason: undefined
    }
    if (r[metricKey] === undefined || r[metricKey] === null || r[metricKey] === '') {
      point.reason = 'no_value'
    } else if (sex !== 'm' && sex !== 'f') {
      point.reason = 'no_sex'
    } else if (days === null || days < 0 || monthOf(days) > MAX_MONTH) {
      point.reason = 'no_range'
    } else {
      const m = metricAt(metricKey, r[metricKey], days, sex)
      if (m) {
        point.z = m.z
        point.p = m.p
        point.band = m.band
      } else {
        point.reason = 'no_range'
      }
    }
    out.push(point)
  }
  return out
}

/**
 * 百分位 → z（对 percentileOf 二分，60 轮远超浮点精度）—— 画参考线用。
 * @returns {number|null}
 */
function zForPercentile(p) {
  if (p === null || p === undefined || !isFinite(p)) return null
  const target = Math.max(0, Math.min(100, p))
  let lo = -9
  let hi = 9
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (percentileOf(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** z → 数值（LMS 逆变换）：曲线上的参考线就是这么算的 */
function valueAtZ(L, M, S, z) {
  if (z === null || z === undefined || !isFinite(z)) return null
  if (L === 0) return M * Math.exp(S * z)
  const base = 1 + L * S * z
  if (!(base > 0)) return null
  return M * Math.pow(base, 1 / L)
}

/**
 * 某百分位在 0–60 月的参考曲线（逐月数值，画图用）。
 * @returns {number[]|null} 61 个值；缺表/缺性别 → null
 */
function percentileCurve(metricKey, sex, p) {
  const z = zForPercentile(p)
  if (z === null) return null
  const out = []
  for (let m = 0; m <= MAX_MONTH; m++) {
    const lms = lmsAt(metricKey, sex, m)
    out.push(lms ? valueAtZ(lms[0], lms[1], lms[2], z) : null)
  }
  return out
}

module.exports = {
  DAYS_PER_MONTH,
  MAX_MONTH,
  METRICS,
  BANDS,
  DISCLAIMER,
  monthOf,
  lmsAt,
  zScore,
  percentileOf,
  bandOf,
  metricAt,
  pointsFor,
  zForPercentile,
  valueAtZ,
  percentileCurve
}
