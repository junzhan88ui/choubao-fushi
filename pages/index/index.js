const age = require('../../utils/age')
const storage = require('../../utils/storage')
const plan = require('../../utils/plan')

// 盐摄入提示（依据《中国居民膳食指南(2022)》7~24 月龄喂养指南）
// 7~12 月龄不建议额外加盐；13~24 月龄可少量，每天 0~1.5g。
function saltTipFor(months) {
  if (months >= 6 && months <= 12) {
    return '7~12 月龄（含刚满 6 月龄）都不建议额外加盐，酱油、鸡精、味精等含盐调料也先不加。'
  }
  if (months >= 13 && months <= 24) {
    return '13~24 月龄可少量加盐，每天总量不超过 0~1.5g（约一粒黄豆大小），仍以清淡为主。'
  }
  return ''
}

// 标记「今天」，供列表做视觉锚点。
// 只在渲染前算，不写回 storage —— 它是派生状态，存下来会过期。
function markToday(p) {
  if (!p || !p.days) return p
  const todayKey = plan.dateKey(new Date())
  p.days.forEach(function (d) { d.isToday = d.date === todayKey })
  return p
}

// 缓存的计划是否覆盖今天（日期窗口内）
function coversToday(p) {
  if (!p || !p.days || p.days.length === 0) return false
  const todayKey = plan.dateKey(new Date())
  return p.days[0].date <= todayKey && todayKey <= p.days[p.days.length - 1].date
}

Page({
  data: {
    ready: false,
    configured: false,
    months: 0,
    ageText: '',
    stageLabel: '',
    stageDesc: '',
    issueLabel: '',
    issueNone: false,
    ageStatus: '',
    tooYoung: false,
    outOfRange: false,
    tab: 'plan',
    planData: null,
    dueObs: [],
    expanded: ''
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh() {
    if (!storage.isConfigured()) {
      this.setData({ ready: true, configured: false })
      return
    }

    const baby = storage.getBaby()
    const months = age.monthsBetween(baby.birthday)
    const st = age.getAgeStatus(months)

    const dueObs = storage.dueObservations().map(function (it) {
      const f = plan.getFood(it.foodId)
      return { foodId: it.foodId, name: f ? f.name : it.foodId, date: it.date }
    })

    // 状态是多选，这里取全部；一项都没勾 → statusLabels 兜底成「正常」
    const statuses = storage.getStatuses()

    const base = {
      ready: true,
      configured: true,
      months: months,
      ageText: age.describeAge(baby.birthday),
      ageStatus: st.status,
      issueLabel: storage.statusLabels(statuses),
      // 全空 = 没有任何待改善项 → 用灰色，别让「正常」看起来像告警
      issueNone: statuses.length === 0,
      dueObs: dueObs,
      saltTip: saltTipFor(months),
      tooYoung: false,
      outOfRange: false
    }

    // 还没到 6 月龄 —— 不给任何辅食建议
    if (st.status === 'too_young' || st.status === 'unknown') {
      base.tooYoung = true
      base.stageLabel = ''
      base.stageDesc = ''
      base.planData = null
      this.setData(base)
      return
    }

    // 超过 24 月龄 —— 超出当前版本内容覆盖范围，别硬生成一份空计划
    if (st.status === 'out_of_range') {
      base.outOfRange = true
      base.stageLabel = ''
      base.stageDesc = ''
      base.planData = null
      this.setData(base)
      return
    }

    const stage = st.stage

    // 缓存计划在三种情况下失效，任一命中就重算：
    //   1. 月龄变了
    //   2. 日期窗口已经不包含今天（旧计划会显得「过期」，今天标记也会落空）
    //   3. 生成输入变了 —— issue / 生病状态 / 已引入食材（指纹比对）
    //      ⚠️ 第 3 条不能省：用户把某食材标成「有反应」后，旧计划里那道菜
    //      还在，下次打开照样推荐。「有反应」的语义是永久排除。
    let p = storage.getPlan()
    const sig = plan.planSignature(storage)
    if (!p || p.months !== months || !coversToday(p) || p.signature !== sig) {
      p = plan.generateFromStorage(storage)
      storage.setPlan(p)
    }
    markToday(p)

    base.stageLabel = stage.label
    base.stageDesc = stage.desc
    base.planData = p
    base.expanded = ''
    this.setData(base)
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  toggleMeal(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ expanded: this.data.expanded === key ? '' : key })
  },

  regenerate() {
    const that = this
    wx.showModal({
      title: '重新生成',
      content: '会按当前月龄和食材记录重排一份 7 天计划，原来的会被替换。',
      confirmText: '重新生成',
      success(res) {
        if (!res.confirm) return
        const p = plan.generateFromStorage(storage)
        if (!p) {
          wx.showToast({ title: '生成失败，请检查宝宝档案', icon: 'none' })
          return
        }
        storage.setPlan(p)
        that.setData({ planData: markToday(p), tab: 'plan', expanded: '' })
        wx.showToast({ title: '已重新生成', icon: 'success' })
      }
    })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
