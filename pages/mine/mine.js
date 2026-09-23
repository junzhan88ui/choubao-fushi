const age = require('../../utils/age')
const storage = require('../../utils/storage')

const app = getApp()

Page({
  data: {
    hasBaby: false,
    name: '',
    emptyHint: '',
    birthday: '',
    ageText: '',
    stageLabel: '',
    stageHint: '',
    safeCount: 0,
    observingCount: 0,
    recordedCount: 0,
    issueLabel: '',
    version: ''
  },

  onShow() {
    const baby = storage.getBaby()
    const birthday = baby && baby.birthday ? baby.birthday : ''
    const name = baby && baby.name ? baby.name : ''
    // 缺哪项由 storage 算，和首页共用同一处判断
    const miss = storage.missingFields()
    const emptyHint = miss.length ? `还差${miss.join('和')}，填一下就能生成计划` : ''
    const months = birthday ? age.monthsBetween(birthday) : null
    const st = age.getAgeStatus(months)

    let stageLabel = ''
    let stageHint = ''
    if (st.status === 'ok') {
      stageLabel = st.stage.label
    } else if (st.status === 'too_young') {
      stageHint = '还没到加辅食的月龄（通常满 6 个月开始）'
    } else if (st.status === 'out_of_range') {
      stageHint = '已超过 2 岁，当前菜谱覆盖 6–24 月龄'
    }

    this.setData({
      // 和首页共用 storage.isConfigured()：名称和生日都是必填，
      // 两页各判各的会对「填没填完」给出不同答案
      hasBaby: storage.isConfigured(),
      name: name,
      emptyHint: emptyHint,
      birthday: birthday,
      ageText: birthday ? age.describeAge(birthday) : '',
      stageLabel: stageLabel,
      stageHint: stageHint,
      safeCount: storage.safeFoodIds().length,
      observingCount: storage.observingFoodIds().length,
      recordedCount: storage.recordedFoodIds().length,
      issueLabel: storage.statusLabels(storage.getStatuses()),
      version: app && app.globalData ? app.globalData.version : ''
    })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goFood() {
    wx.switchTab({ url: '/pages/food/food' })
  },

  goPlan() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
