const age = require('../../utils/age')
const storage = require('../../utils/storage')
// 取数走共享模块（与「修改宝宝档案」同一份数据源：分组/顺序/状态徽标/图标，
// utils/foodlist.js，_validate §6u 钉）—— 本页不再自己 require data/foods 分组
const foodlist = require('../../utils/foodlist')

Page({
  data: {
    keyword: '',
    groups: [],
    months: null,
    hasBaby: false
  },

  onShow() {
    const baby = storage.getBaby()
    const months = baby && baby.birthday ? age.monthsBetween(baby.birthday) : null
    this.setData({ months: months, hasBaby: !!months })
    this.rebuild()
  },

  rebuild() {
    // 禁食提示条目（蜂蜜）不传 skipUnintroducible —— 查一查照全量展示
    const groups = foodlist.buildGroups({
      keyword: this.data.keyword,
      months: this.data.months
    })
    this.setData({ groups: groups })
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
    this.rebuild()
  },

  clearKeyword() {
    this.setData({ keyword: '' })
    this.rebuild()
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/food-detail/food-detail?id=' + id })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
