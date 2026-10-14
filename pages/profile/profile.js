const FOODS = require('../../data/foods')
const age = require('../../utils/age')
const storage = require('../../utils/storage')
// 清单、分类顺序、状态徽标、图标都由共享模块出（「查一查」同源，§6u 钉），
// 本页不再自己分组 —— 改数据口径只改 utils/foodlist.js 一处，两页同步。
const foodlist = require('../../utils/foodlist')

Page({
  data: {
    name: '',
    // 名称上限跟着 storage.BABY_NAME_MAX 走，不在页面里另写一个数
    nameMax: storage.BABY_NAME_MAX,
    birthday: '',
    today: '',
    minDate: '',
    // 首次辅食日期（v2.32 双时钟，选填）：当天视为辅食 6 月龄第 1 天。
    // foodMinDate = picker 下限 = 出生 + 4 个月（公开指南「最早不早于 4 月龄」）
    foodStart: '',
    foodMinDate: '',
    ageText: '',
    // 当前月龄（null = 没填生日）。v2.25 · 方案A 之后档案页是引入的唯一入口，
    // 引擎不再按 minMonth 升序排引入，这道月龄门只能在这里挡。
    months: null,
    // 状态多选：由 storage.STATUSES 逐项算出是否已勾选
    statuses: [],
    keyword: '',
    groups: [],
    totalChecked: 0,
    // 有反应的食材（status=bad）—— 计划页/详情页标完「有反应」的落点。
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
      // v2.32 双时钟：档案页的引入月龄门走辅食月龄（没填回退生理月龄）
      months: birthday ? age.foodMonthsOf(baby) : null,
      foodStart: (baby && baby.foodStart) || '',
      foodMinDate: this.foodMinOf(birthday)
    })
    this.rebuildStatus()
    this.rebuild()
  },

  /** 辅食日期 picker 的下限：出生 + 4 个月（公开指南「最早不早于 4 月龄」）。
   *  没填生日返回 ''（无下限；handler 会先提示补生日再选） */
  foodMinOf(birthday) {
    if (!birthday) return ''
    const b = new Date(birthday)
    if (isNaN(b.getTime())) return ''
    return storage.todayStr(new Date(b.getFullYear(), b.getMonth() + 4, b.getDate()))
  },

  /** 重建状态卡选项（列表由 storage 提供，「状态正常」恒在第一位）
   *  页面不自己判断勾选态 —— 互斥关系由 storage 的 statusOptions 负责。 */
  rebuildStatus() {
    this.setData({ statuses: storage.statusOptions() })
  },

  /** 重建食材勾选列表 —— 取数走共享模块（与「查一查」同一份数据源）。
   *  skipUnintroducible：禁食提示条目（蜂蜜等）不进可勾选清单 —— 按数据标记挡，
   *  不写死 id，将来再加禁食条目自动生效。 */
  rebuild() {
    const groups = foodlist.buildGroups({
      keyword: this.data.keyword,
      months: this.data.months,
      skipUnintroducible: true
    })

    // 有反应的食材（bad）：date 就是反应当天（markIntroduced 落的日期）。
    // 计划页/详情页标「有反应」都会落到这里，专属卡是唯一落点。
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
      badFoods: badFoods,
      totalChecked: storage.safeFoodIds().length
    })
  },

  // 有反应卡 → 食材详情页看信息（v2.25 起「清除记录」就地在本页，见 clearBad）
  goFoodDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/food-detail/food-detail?id=' + id })
  },

  /** 「清除记录」—— bad 的唯一解除通道（v2.25 自食材详情页移入本页）。
   *  storage 层硬拒 bad→safe（见 _validate §6j），
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

  /** 「标记有反应」入口已按用户决策删除（v2.30）：标记 bad 的按钮只剩
   *  食材详情页「食物过敏」（markBad，走 markIntroduced → setIntroStatus('bad')
   *  正路，§6j 钉）。本页保留「有反应的食材」卡（查看 + 清除记录）。 */

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
    const baby = storage.getBaby()
    this.setData({
      birthday: birthday,
      ageText: age.describeAge(birthday),
      // 生日变了：辅食日期下限跟着挪，月龄门同步重算（不等下次 onShow）
      foodMinDate: this.foodMinOf(birthday),
      months: age.foodMonthsOf(baby)
    })
    // 月龄变了，旧计划作废
    storage.setPlan(null)
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  /** 首次辅食日期（v2.32 双时钟，选填）：当天视为辅食 6 月龄第 1 天 ——
   *  计划/性状/餐次/引入门改按辅食月龄排（age.foodMonthsOf 唯一分流入口）。
   *  没填 = 按出生日期推算（现状）。下限 = 出生 + 4 个月；改/清都作废旧计划。 */
  onFoodStartChange(e) {
    const v = e.detail.value
    if (!this.data.birthday) {
      wx.showToast({ title: '先填出生日期', icon: 'none' })
      return
    }
    if (this.data.foodMinDate && v < this.data.foodMinDate) {
      wx.showToast({ title: '最早 ' + this.data.foodMinDate + '（出生满 4 个月）', icon: 'none' })
      return
    }
    this._applyFoodStart(v, '已保存，计划将按辅食开始日安排')
  },

  /** 清除辅食日期 = 回到「按出生日期推算月龄」的现状口径。
   *  选填字段必须可回退：误填/想改回老口径都靠这条通道。 */
  onClearFoodStart() {
    this._applyFoodStart('', '已改回按出生日期推算月龄')
  },

  _applyFoodStart(v, msg) {
    storage.setBaby({ foodStart: v })
    storage.setPlan(null) // 辅食月龄与菜单锚定日变了，旧计划作废
    this.setData({
      foodStart: v,
      months: this.data.birthday ? age.foodMonthsOf(storage.getBaby()) : null
    })
    this.rebuild()
    wx.showToast({ title: msg, icon: 'none' })
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
      // v2.30 · 3 天观察期已按用户决策删除：勾选 = 已经吃过、确认没问题，
      // markIntroduced 直接落 safe 并排进菜单 —— **致敏食材同样当场落 safe**
      // （foodUsable 仍只放行 safe 的致敏食材，月龄门也还在，见 _validate §5b/§6u）。
      storage.markIntroduced(id)
    }
    storage.setPlan(null)
    this.rebuild()
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  /** 导出备份（v2.31）：整段 JSON 复制到剪贴板。用户自己转存到微信聊天/收藏，
   *  程序不上传不联网 —— 隐私口径「未采集」靠这条维持（§6v 钉无网络调用） */
  onExport() {
    wx.setClipboardData({
      data: storage.exportUserData(),
      success() {
        wx.showToast({ title: '已复制，去微信里存好', icon: 'none' })
      }
    })
  },

  /** 导入备份（v2.31）：剪贴板文本 → 信封预检（isBackupText，垃圾文本直接拒）
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
              that.onShow() // 重建档案/状态/食材清单
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
