const age = require('../../utils/age')
const storage = require('../../utils/storage')
// 记录详情要按 foodId 显示食材名
const FOODS = require('../../data/foods')
// 喂养记录要按 recipeId 显示菜名 —— 打卡存的是 id
const RECIPES = require('../../data/recipes')

const app = getApp()

// 引入记录的状态标签（bb_introduced.status → 展示文案）
const INTRO_LABEL = { safe: '已吃过', bad: '有反应' } // v2.30：观察期已删，observing 绝版

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
    // 生长曲线（v3.5 · 用户 2026-10-20 拍板方案 C）：本页只留计数 + 跳转入口，
    // 记录清单与增删改全部交给曲线页（同一份 bb_growth，那边能改能删）。
    growthCount: 0,
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
    // v2.32 双时钟：阶段/超范围判断走辅食月龄（没填辅食日期时 = 生理月龄，
    // 行为不变）；年龄文案 ageText 仍是生理月龄（事实陈述）
    const st = age.getAgeStatus(age.foodMonthsOf(baby))

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
    // （观察名单行 v2.25 已删；3 天观察期整体删除后 observing 绝版，v2.30）
    const safeList = toItems('safe')
    const badList = toItems('bad')
    const recordedList = toItems(null)

    // 生长曲线：只取条数（getGrowth 是升序，条数与顺序无关）。
    // 清单、数值文案、增删改都在曲线页 —— 这里不再复制一份
    const growthCount = storage.getGrowth().length

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
      recordedList: recordedList,
      growthCount: growthCount
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

  /** 生长曲线（v3.5 · 用户 2026-10-20 拍板方案 C）：整行跳曲线页。
   *  曲线页的「测量记录」卡就是本页原来那份清单的完整版（能改能删 + 区间/P 值），
   *  所以本页不再自己做行内展开与删除 —— 同一件事只留一个入口。 */
  goGrowth() {
    wx.navigateTo({ url: '/pages/growth/growth' })
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
  },

  /* ── 数据备份（v3.2 从档案页搬来，用户 2026-10-19）──────────────────────
   *  档案页第 5 步删除后，导出/导入落在这里。「我的」是低频操作的家，
   *  备份正是一年用一两次的事 —— 放在这里比放在编辑页更合理。
   *  红线不变：只走剪贴板，不联网（§6v 钉）。 */

  /** 导出备份：整段 JSON 复制到剪贴板。用户自己转存到微信聊天/收藏，
   *  程序不上传不联网 —— 隐私口径「未采集」靠这条维持 */
  onExport() {
    wx.setClipboardData({
      data: storage.exportUserData(),
      success() {
        wx.showToast({ title: '已复制，去微信里存好', icon: 'none' })
      }
    })
  },

  /** 导入备份：剪贴板文本 → 信封预检（isBackupText，垃圾文本直接拒）
   *  → 确认框（导入 = 整包覆盖，必须先确认，§6v 钉 showModal）→ 落库 → 整页重建 */
  onImport() {
    const that = this
    wx.getClipboardData({
      success(res) {
        const text = res.data || ''
        if (!storage.isBackupText(text)) {
          wx.showToast({ title: '剪贴板里不是备份文本', icon: 'none' })
          return
        }
        wx.showModal({
          title: '导入备份',
          content: '会用备份里的内容整体覆盖当前档案、食材记录和喂养打卡，导入后本周计划会重新生成。确定导入吗？',
          success(r) {
            if (!r.confirm) return
            if (storage.importUserData(text)) {
              that.onShow() // 计数与清单一起重建
              wx.showToast({ title: '导入完成', icon: 'success' })
            } else {
              wx.showToast({ title: '备份格式不支持', icon: 'none' })
            }
          }
        })
      }
    })
  }
})
