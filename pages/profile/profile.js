const FOODS = require('../../data/foods')
const icons = require('../../data/food-icons')
const age = require('../../utils/age')
const storage = require('../../utils/storage')

const CATEGORY_ORDER = ['谷物', '蔬菜', '水果', '肉禽', '水产', '蛋奶', '豆类', '油脂']

Page({
  data: {
    name: '',
    // 名称上限跟着 storage.BABY_NAME_MAX 走，不在页面里另写一个数
    nameMax: storage.BABY_NAME_MAX,
    birthday: '',
    today: '',
    minDate: '',
    ageText: '',
    // 当前月龄（null = 没填生日）。v2.25 · 方案A 之后档案页是引入的唯一入口，
    // 引擎不再按 minMonth 升序排引入，这道月龄门只能在这里挡。
    months: null,
    // 状态多选：由 storage.STATUSES 逐项算出是否已勾选
    statuses: [],
    keyword: '',
    groups: [],
    observing: [],
    totalChecked: 0,
    // 有反应的食材（status=bad）—— 计划页「有反应」/观察期标完的落点。
    // 没有专属卡的话，用户标完在档案页只会淹没在大列表的一个红标签里。
    badFoods: []
  },

  onLoad() {
    const now = new Date()
    const min = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())
    this.setData({
      today: storage.todayStr(now),
      minDate: storage.todayStr(min)
    })
  },

  onShow() {
    const baby = storage.getBaby()
    const birthday = baby && baby.birthday ? baby.birthday : ''
    this.setData({
      name: baby && baby.name ? baby.name : '',
      birthday: birthday,
      ageText: birthday ? age.describeAge(birthday) : '',
      months: birthday ? age.monthsBetween(birthday) : null
    })
    this.rebuildStatus()
    this.rebuild()
  },

  /** 重建状态卡选项（列表由 storage 提供，「状态正常」恒在第一位）
   *  页面不自己判断勾选态 —— 互斥关系由 storage 的 statusOptions 负责。 */
  rebuildStatus() {
    this.setData({ statuses: storage.statusOptions() })
  },

  /** 重建食材勾选列表 */
  rebuild() {
    const safe = storage.safeFoodIds()
    const months = this.data.months
    const kw = (this.data.keyword || '').trim()
    const map = {}

    for (let i = 0; i < FOODS.length; i++) {
      const f = FOODS[i]
      // introducible:false 的条目（蜂蜜等）只是「禁食提示」，不作为可勾选食材
      // —— 按数据标记挡，而不是写死 id，将来再加禁食条目自动生效
      if (f.introducible === false) continue
      if (kw) {
        const aliasHit = (f.alias || []).join(' ').indexOf(kw) >= 0
        if (f.name.indexOf(kw) < 0 && !aliasHit) continue
      }
      if (!map[f.category]) map[f.category] = []
      const intro = storage.findIntro(f.id)
      map[f.category].push({
        id: f.id,
        name: f.name,
        allergen: f.allergen,
        checked: safe.indexOf(f.id) >= 0,
        // bad 必须单独标出来：它的 chip 也是「未勾选」的样子，
        // 但点击语义完全不同（见 toggleFood）
        status: intro ? intro.status : 'new',
        // v2.25 · 方案A：引擎不再按 minMonth 升序排引入，这道门由档案页补上 ——
        // 没到月龄的食材点了不许引入（toggleFood 里再拦一道并给提示）。
        tooEarly: months !== null && !age.isFoodReady(f, months),
        minMonth: f.minMonth,
        // v2.0 图标：未选中的 chip 用分类色做底，选中态由 .chip-on 覆盖
        icon: icons.iconFor(f),
        iconBg: icons.bgFor(f)
      })
    }

    const groups = []
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      const c = CATEGORY_ORDER[i]
      if (map[c] && map[c].length) groups.push({ category: c, foods: map[c] })
    }

    const observing = storage.getIntroduced()
      .filter(function (it) { return it.status === 'observing' })
      .map(function (it) {
        let fo = null
        for (let i = 0; i < FOODS.length; i++) {
          if (FOODS[i].id === it.foodId) { fo = FOODS[i]; break }
        }
        const fi = fo && fo.firstIntro ? fo.firstIntro : null
        // v2.25 · 方案A：观察期 = 你自己喂、计划不排 —— 首次喂法必须就地给出，
        // 否则用户只知道「在观察」，不知道喂多少、怎么喂。
        return {
          foodId: it.foodId,
          name: fo ? fo.name : it.foodId,
          date: it.date,
          amount: fi ? fi.amount : '',
          method: fi ? fi.method : ''
        }
      })

    // 有反应的食材（bad）：date 就是反应当天（markIntroduced 落的日期）。
    // 计划页「有反应」和观察期点「有反应」都会落到这里，专属卡是唯一落点。
    const badFoods = storage.getIntroduced()
      .filter(function (it) { return it.status === 'bad' })
      .map(function (it) {
        let name = it.foodId
        for (let i = 0; i < FOODS.length; i++) {
          if (FOODS[i].id === it.foodId) { name = FOODS[i].name; break }
        }
        return { foodId: it.foodId, name: name, date: it.date }
      })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1 })

    this.setData({
      groups: groups,
      observing: observing,
      badFoods: badFoods,
      totalChecked: safe.length
    })
  },

  // 有反应卡 → 食材详情页看信息（v2.25 起「清除记录」就地在本页，见 clearBad）
  goFoodDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/food-detail/food-detail?id=' + id })
  },

  /** 「清除记录」—— bad 的唯一解除通道（v2.25 自食材详情页移入本页）。
   *  storage 层硬拒 bad→safe/observing（见 _validate §6j），
   *  只有 removeIntroduced 能解除；先弹确认框，防一次误触洗掉过敏记录。 */
  clearBad(e) {
    const id = e.currentTarget.dataset.id
    const f = FOODS.filter(function (x) { return x.id === id })[0] || null
    const name = f ? f.name : id
    const that = this
    wx.showModal({
      title: '清除记录',
      content: '会把「' + name + '」从记录里移除，之后不会再排进菜单。要重新引入，再勾选一次即可。',
      success(res) {
        if (!res.confirm) return
        storage.removeIntroduced(id)
        storage.setPlan(null)
        that.rebuild()
      }
    })
  },

  /** 「标记有反应」—— v2.25 自首页餐卡（原 reactionMeal）移入本页。
   *  bad 是系统里唯一的硬排除机制：观察期内的食材由观察卡「有反应」落，
   *  已确认安全的食材过敏后只能从这里补标，否则它会继续被排进菜单。
   *  走 markIntroduced → setIntroStatus('bad') 正路（反应当天日期随记录写入，§6j）。 */
  pickBadFood() {
    const that = this
    const list = []
    FOODS.forEach(function (f) {
      if (f.introducible === false) return // 禁食提示条目不参与引入
      const it = storage.findIntro(f.id)
      if (!it || it.status === 'bad') return // 只列已吃过/观察中的
      list.push({ id: f.id, name: f.name })
    })
    if (!list.length) {
      wx.showToast({ title: '还没有已吃过的食材', icon: 'none' })
      return
    }
    // ActionSheet 最多 6 项
    wx.showActionSheet({
      itemList: list.slice(0, 6).map(function (x) { return x.name }),
      success(res) {
        const f = list[res.tapIndex]
        storage.markIntroduced(f.id)
        storage.setIntroStatus(f.id, 'bad')
        storage.setPlan(null)
        that.rebuild()
        wx.showToast({ title: '已标为有反应，不再排进菜单', icon: 'none' })
      }
    })
  },

  /** 名称实时清洗后落库。
   *  名称是**必填**（缺了 isConfigured 和 planInputs 会双双挡住生成），
   *  但名称的**取值**不进指纹 —— 改个名字不该重排整份计划，
   *  所以这里绝不能 setPlan(null)，那会让每次敲字都重排一次。 */
  onNameInput(e) {
    const name = storage.sanitizeBabyName(e.detail.value)
    storage.setBaby({ name: name })
    this.setData({ name: name })
  },

  onDateChange(e) {
    const birthday = e.detail.value
    storage.setBaby({ birthday: birthday })
    this.setData({
      birthday: birthday,
      ageText: age.describeAge(birthday)
    })
    // 月龄变了，旧计划作废
    storage.setPlan(null)
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  /** 状态多选：点「状态正常」清空全部，点真状态则 toggle，互不影响其它已选项 */
  onStatusChange(e) {
    const key = e.currentTarget.dataset.key
    storage.setStatuses(storage.toggleStatus(key))
    // 状态会改变加权方向，也会改变指纹里的 sick（生病时暂停新食材），计划作废
    storage.setPlan(null)
    this.rebuildStatus()
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
    this.rebuild()
  },

  clearKeyword() {
    this.setData({ keyword: '' })
    this.rebuild()
  },

  toggleFood(e) {
    const id = e.currentTarget.dataset.id
    const exist = storage.findIntro(id)

    // ⚠️ 「有反应」(bad) 是这个系统里唯一的硬排除机制，语义是永久排除。
    // bad 的 chip 在界面上也是未勾选的样子，如果直接走 removeIntroduced，
    // 等于让用户「点一下就解除过敏排除」，食材会立刻重新排进菜单。
    // 所以这里必须拦下来，引导到食材详情页去处理。
    if (exist && exist.status === 'bad') {
      wx.showModal({
        title: '这种食材标记过「有反应」',
        content: '为安全起见它不会被排进菜单。要重新引入，请在上方「有反应的食材」卡里点「清除记录」，再回下方食材列表重新勾选。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    if (exist) {
      storage.removeIntroduced(id)
    } else {
      // v2.25 · 方案A：档案页是引入的唯一入口（引擎不再自动排新食材）。
      const f = FOODS.filter(function (x) { return x.id === id })[0] || null
      if (f && this.data.months !== null && !age.isFoodReady(f, this.data.months)) {
        wx.showToast({ title: f.minMonth + ' 月龄起再引入「' + f.name + '」', icon: 'none' })
        return
      }
      // markIntroduced 落 status='observing'。**致敏食材就停在这一档** ——
      // 3 天内由你自己喂、计划不排它（foodUsable 对不在 safeIds 的致敏食材
      // 返回 false），到期由观察卡或首页到期提醒确认「没问题」才转 safe 进菜单。
      // 非致敏食材没有这道观察期：勾选即「已吃过、确认没问题」。
      storage.markIntroduced(id)
      if (!f || !f.allergen) storage.setIntroStatus(id, 'safe')
    }
    storage.setPlan(null)
    this.rebuild()
  },

  confirmObservation(e) {
    const id = e.currentTarget.dataset.id
    const ok = e.currentTarget.dataset.ok === '1'
    storage.setIntroStatus(id, ok ? 'safe' : 'bad')
    storage.setPlan(null)
    this.rebuild()
    wx.showToast({
      title: ok ? '已标记为没问题' : '已标记为有反应',
      icon: 'none'
    })
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  }
})
