const age = require('../../utils/age')
const storage = require('../../utils/storage')
// 记录详情要按 foodId 显示食材名
const FOODS = require('../../data/foods')
// 喂养记录要按 recipeId 显示菜名 —— 打卡存的是 id
const RECIPES = require('../../data/recipes')

const app = getApp()

// 引入记录的状态标签（bb_introduced.status → 展示文案）
const INTRO_LABEL = { safe: '已吃过', observing: '观察中', bad: '有反应' }

/** 引入记录 → 行内展开用的条目（id 换成名字；bad 的 date 就是反应当天）。
 *  status=null 表示取全部；按日期倒序，最近的排前面。 */
function toItems(status) {
  return storage.getIntroduced()
    .filter(function (it) { return status === null || it.status === status })
    .map(function (it) {
      let name = it.foodId
      for (let i = 0; i < FOODS.length; i++) {
        if (FOODS[i].id === it.foodId) { name = FOODS[i].name; break }
      }
      return {
        foodId: it.foodId,
        name: name,
        date: it.date,
        status: it.status,
        statusLabel: INTRO_LABEL[it.status] || it.status
      }
    })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1 })
}

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
    // 「有反应、已排除」单独一行 —— 数据一直在（badFoodIds），卡上没有行
    // 就等于没入口（v2.1：上一轮把卡加到了档案页，「我的」tab 这边缺的就是它）
    badCount: 0,
    recordedCount: 0,
    issueLabel: '',
    version: '',
    // 行内展开态：'' | 'safe' | 'bad' | 'all'
    openRow: '',
    safeList: [],
    badList: [],
    recordedList: [],
    // 14 天喂养记录（自档案页移来：记录归「我的」，档案页只管编辑）
    mealHistory: []
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

    // 行内展开的三组名单：与上面的计数同一数据源（bb_introduced），
    // 只是换成「带名字」的展示形态；点开哪行就渲哪组
    // （观察中不再单列 —— 观察名单只在档案页观察卡管理，v2.25）
    const safeList = toItems('safe')
    const badList = toItems('bad')
    const recordedList = toItems(null)

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
      badCount: storage.badFoodIds().length,
      recordedCount: storage.recordedFoodIds().length,
      issueLabel: storage.statusLabels(storage.getStatuses()),
      version: app && app.globalData ? app.globalData.version : '',
      safeList: safeList,
      badList: badList,
      recordedList: recordedList
    })
    this.rebuildHistory()
  },

  // 记录行点开该组食材名单，再点一次收起
  toggleRow(e) {
    const row = e.currentTarget.dataset.row
    this.setData({ openRow: this.data.openRow === row ? '' : row })
  },

  // 展开的食材 → 详情页看信息（bad 的解除入口在档案页「有反应的食材」卡，§6j 反向钉保底）
  goFoodDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/food-detail/food-detail?id=' + id })
  },

  /** 最近 14 天喂养记录 —— 每餐打卡的证据列表（自档案页移入）。
   *  存的是 recipeId/食材 id，这里映射回名字；按日期倒序。 */
  rebuildHistory() {
    const now = new Date()
    const fromKey = storage.todayStr(new Date(now.getTime() - 14 * 86400000))
    const RMAP = {}
    RECIPES.forEach(function (r) { RMAP[r.id] = r.name })
    const FMAP = {}
    FOODS.forEach(function (f) { FMAP[f.id] = f.name })
    const LABEL = { full: '吃完了', some: '吃一些', refused: '没吃', reaction: '有反应' }
    const list = storage.getMealLogs()
      .filter(function (e) { return e.date >= fromKey })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1
        return (b.at || 0) - (a.at || 0)
      })
      .map(function (e) {
        return {
          key: e.date + '|' + e.recipeId,
          date: e.date,
          name: RMAP[e.recipeId] || e.recipeId,
          status: e.status,
          label: LABEL[e.status] || e.status,
          reactionName: e.reaction ? (FMAP[e.reaction] || e.reaction) : ''
        }
      })
    this.setData({ mealHistory: list })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
