const age = require('../../utils/age')
const storage = require('../../utils/storage')

const app = getApp()

Page({
  data: {
    hasBaby: false,
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
      hasBaby: !!birthday,
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
