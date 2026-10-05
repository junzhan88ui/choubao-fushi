const FOODS = require('../../data/foods')
const RECIPES = require('../../data/recipes')
const icons = require('../../data/food-icons')
const age = require('../../utils/age')
const storage = require('../../utils/storage')
const plan = require('../../utils/plan')

const STATUS_TEXT = {
  safe: '已经吃过，没问题',
  observing: '观察中',
  bad: '上次有反应',
  new: '还没引入'
}

Page({
  data: {
    food: null,
    recipes: [],
    status: 'new',
    statusText: '',
    months: null,
    ready: true,
    expanded: ''
  },

  onLoad(query) {
    this.foodId = query.id
  },

  onShow() {
    this.build()
  },

  build() {
    let food = null
    for (let i = 0; i < FOODS.length; i++) {
      if (FOODS[i].id === this.foodId) { food = FOODS[i]; break }
    }
    if (!food) {
      wx.showToast({ title: '没找到这个食材', icon: 'none' })
      return
    }

    const baby = storage.getBaby()
    const months = baby && baby.birthday ? age.monthsBetween(baby.birthday) : null
    const intro = storage.findIntro(food.id)
    const status = intro ? intro.status : 'new'

    const recipes = RECIPES.filter(function (r) {
      return r.mainFoods.indexOf(food.id) >= 0 || (r.sideFoods || []).indexOf(food.id) >= 0
    }).map(function (r) {
      return {
        id: r.id,
        name: r.name,
        texture: r.texture,
        monthText: r.monthRange[0] + '–' + r.monthRange[1] + ' 月龄',
        isMain: r.mainFoods.indexOf(food.id) >= 0,
        // 步骤里的 {分类} 占位符按宝宝月龄档填数（与计划页同一套 fillPortions，v2.7）
        steps: plan.fillPortions(r.steps, plan.amountForStage(r, months))
      }
    })

    wx.setNavigationBarTitle({ title: food.name })

    this.setData({
      food: food,
      // v2.0 图标：单独放 data，不写进 food —— food 是 FOODS 模块
      // 缓存里的原对象，改它会污染所有引用方
      icon: icons.iconFor(food),
      iconBg: icons.bgFor(food),
      recipes: recipes,
      status: status,
      statusText: STATUS_TEXT[status] || '',
      months: months,
      // 禁食提示条目（蜂蜜）不参与引入流程，见 data/foods.js
      introducible: food.introducible !== false,
      ready: months === null ? true : food.minMonth <= months
    })
  },

  markSafe() {
    // bad 状态下按钮已藏（wxml），这里再挡一层：storage 层会拒写，
    // 但不拦住就会弹「已加入菜单候选」的假成功 toast（H-2）
    const intro = storage.findIntro(this.foodId)
    if (intro && intro.status === 'bad') {
      wx.showToast({ title: '有反应的食材要先清除记录', icon: 'none' })
      return
    }
    storage.markIntroduced(this.foodId)
    storage.setIntroStatus(this.foodId, 'safe')
    storage.setPlan(null)
    this.build()
    wx.showToast({ title: '已加入菜单候选', icon: 'success' })
  },

  markObserving() {
    const intro = storage.findIntro(this.foodId)
    if (intro && intro.status === 'bad') {
      wx.showToast({ title: '有反应的食材要先清除记录', icon: 'none' })
      return
    }
    storage.markIntroduced(this.foodId)
    storage.setPlan(null)
    this.build()
    wx.showToast({ title: '已记录，观察 3 天', icon: 'none' })
  },

  clearRecord() {
    const that = this
    wx.showModal({
      title: '清除记录',
      content: '会把这种食材从记录里移除，之后不会再排进菜单。',
      success(res) {
        if (!res.confirm) return
        storage.removeIntroduced(that.foodId)
        storage.setPlan(null)
        that.build()
      }
    })
  },

  toggleSteps(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ expanded: this.data.expanded === id ? '' : id })
  }
})
