const FOODS = require('../../data/foods')
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
    // 状态多选：由 storage.STATUSES 逐项算出是否已勾选
    statuses: [],
    keyword: '',
    groups: [],
    observing: [],
    totalChecked: 0
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
      ageText: birthday ? age.describeAge(birthday) : ''
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
    const kw = (this.data.keyword || '').trim()
    const map = {}

    for (let i = 0; i < FOODS.length; i++) {
      const f = FOODS[i]
      // 蜂蜜只作为「禁食」提示存在，不作为可勾选食材
      if (f.id === 'honey') continue
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
        status: intro ? intro.status : 'new'
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
        let name = it.foodId
        for (let i = 0; i < FOODS.length; i++) {
          if (FOODS[i].id === it.foodId) { name = FOODS[i].name; break }
        }
        return { foodId: it.foodId, name: name, date: it.date }
      })

    this.setData({
      groups: groups,
      observing: observing,
      totalChecked: safe.length
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
    // 等于让用户「点一下就解除过敏排除」，食材会重新回到新食材推荐通道。
    // 所以这里必须拦下来，引导到食材详情页去处理。
    if (exist && exist.status === 'bad') {
      wx.showModal({
        title: '这种食材标记过「有反应」',
        content: '为安全起见它不会被排进菜单。要重新引入，请到它的详情页清除记录，再走一次「新食材尝试」。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    if (exist) {
      storage.removeIntroduced(id)
    } else {
      storage.markIntroduced(id)
      storage.setIntroStatus(id, 'safe')
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
