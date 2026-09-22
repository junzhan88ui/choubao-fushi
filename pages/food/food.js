const FOODS = require('../../data/foods')
const age = require('../../utils/age')
const storage = require('../../utils/storage')

const CATEGORY_ORDER = ['谷物', '蔬菜', '水果', '肉禽', '水产', '蛋奶', '豆类', '油脂', '其他']

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
    const kw = (this.data.keyword || '').trim()
    const months = this.data.months
    const map = {}

    for (let i = 0; i < FOODS.length; i++) {
      const f = FOODS[i]
      if (kw) {
        const aliasHit = (f.alias || []).join(' ').indexOf(kw) >= 0
        if (f.name.indexOf(kw) < 0 && !aliasHit) continue
      }

      const intro = storage.findIntro(f.id)
      let status = 'new'
      let statusText = '未引入'
      if (intro) {
        if (intro.status === 'safe') { status = 'safe'; statusText = '已吃过' }
        else if (intro.status === 'observing') { status = 'observing'; statusText = '观察中' }
        else { status = 'bad'; statusText = '有反应' }
      }

      const ready = months !== null && f.minMonth <= months

      if (!map[f.category]) map[f.category] = []
      map[f.category].push({
        id: f.id,
        name: f.name,
        allergen: f.allergen,
        minMonth: f.minMonth,
        status: status,
        statusText: statusText,
        ready: ready
      })
    }

    const groups = []
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      const c = CATEGORY_ORDER[i]
      if (map[c] && map[c].length) groups.push({ category: c, foods: map[c] })
    }

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
