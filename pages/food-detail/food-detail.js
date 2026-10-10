const FOODS = require('../../data/foods')
const RECIPES = require('../../data/recipes')
const icons = require('../../data/food-icons')
const age = require('../../utils/age')
const storage = require('../../utils/storage')
const plan = require('../../utils/plan')

const STATUS_TEXT = {
  safe: '已经吃过，没问题',
  bad: '有反应',
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
    // 状态口径与两处清单同源（utils/foodlist.js statusOf）：
    // 只有 safe|bad|new —— observing 已随观察期删除，读取时迁移为 safe（v2.30）
    const status = intro ? (intro.status === 'bad' ? 'bad' : 'safe') : 'new'

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
        steps: plan.fillPortions(r.steps, plan.amountForStage(r, months), months)
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
    const intro = storage.findIntro(this.foodId)
    // bad 分支（§6j）：storage 层硬拒 bad→safe，所以这里绝不能直接标 ——
    // v2.25 起允许用户显式「重新加入」，但必须先弹确认框（一次误触不该洗白过敏记录），
    // 确认后走 removeIntroduced 解除再按正路重新标记。绕过弹窗直接调 markIntroduced
    // 会被 storage 拒写（假成功 toast 防住了，H-2 的底线不变）。
    if (intro && intro.status === 'bad') {
      const that = this
      wx.showModal({
        title: '重新加入食谱？',
        content: '「' + this.data.food.name + '」之前标记过食物过敏，已从食谱中排除。确认没问题后才会重新排进去，建议先按新食材少量试一次。',
        confirmText: '重新加入',
        success(res) {
          if (!res.confirm) return
          storage.removeIntroduced(that.foodId)
          storage.markIntroduced(that.foodId)
          storage.setIntroStatus(that.foodId, 'safe')
          storage.setPlan(null)
          that.build()
          wx.showToast({ title: '已重新加入菜单候选', icon: 'success' })
        }
      })
      return
    }
    storage.markIntroduced(this.foodId)
    storage.setIntroStatus(this.foodId, 'safe')
    storage.setPlan(null)
    this.build()
    wx.showToast({ title: '已加入菜单候选', icon: 'success' })
  },

  /** 「食物过敏」（v2.25 新增）：把当前食材标成 bad —— 永久排除，不再排进食谱。
   *  档案页「＋ 标记有反应」入口已删（v2.30）—— 本页这颗是标 bad 的唯一按钮入口：
   *  markIntroduced → setIntroStatus('bad')，
   *  反应当天日期随记录写入（§6j）。重新加入走上面 markSafe 的确认弹窗。 */
  markBad() {
    const that = this
    wx.showModal({
      title: '标记为食物过敏',
      content: '会把「' + this.data.food.name + '」当作过敏食材，之后不再排进食谱。要重新加入请在本页确认。',
      confirmText: '标记过敏',
      success(res) {
        if (!res.confirm) return
        storage.markIntroduced(that.foodId)
        storage.setIntroStatus(that.foodId, 'bad')
        storage.setPlan(null)
        that.build()
        wx.showToast({ title: '已标记过敏，不再排进食谱', icon: 'none' })
      }
    })
  },

  // v2.25：详情页标记按钮就这两颗 ——「已经吃过，没问题」(markSafe，bad 态下带确认弹窗
  // 充当重新加入入口) 与「食物过敏」(markBad)。「清除记录」(clearRecord)、「今天第一次试」
  // (markObserving) 都在档案页：解除 bad 的通道是「有反应的食材」卡。
  // v2.30：3 天观察期已删 —— 引入只有「勾选 = 已经吃过、确认没问题」一条正路。

  toggleSteps(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ expanded: this.data.expanded === id ? '' : id })
  }
})
