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
    // foodMinDate = 面板下限 = 出生 + 4 个月（公开指南「最早不早于 4 月龄」）
    foodStart: '',
    foodMinDate: '',
    // 首次辅食日期 · 自建底部面板（用户 2026-10-15 拍板）：原生 picker 顶栏只有
    // 「取消 / 确定」，放不下第三个「清除」按钮，所以自画面板。years/months/days =
    // 当前三列可选项（已按「出生+4月 ~ 今天」裁过，越界值不进列表），
    // pvValue = 三列选中下标（picker-view 的 value 语义）。
    foodPickerOpen: false,
    years: [],
    months: [],
    days: [],
    pvValue: [0, 0, 0],
    // 性别 + 出生指标（v3.0 成长曲线前置字段，全选填）：性别决定查哪套 WHO
    // 百分位表（男/女两套），出生指标兼作曲线第一条锚点与首页出生信息行。
    // 三项都不进计划指纹 —— 改它们绝不触发计划重算。
    sex: '',
    sexOpts: [{ k: 'm', label: '男' }, { k: 'f', label: '女' }],
    birthWeight: '',
    birthLength: '',
    // 一句话描述（v3.0 批⑨，选填）：首页头卡的个性行。
    // 上限跟 storage.BABY_NOTE_MAX 走，页面里不另写一个数。不进计划指纹。
    note: '',
    noteMax: storage.BABY_NOTE_MAX,
    ageText: '',
    // 当前月龄（null = 没填生日）。v2.25 · 方案A 之后档案页是引入的唯一入口，
    // 引擎不再按 minMonth 升序排引入，这道月龄门只能在这里挡。
    months: null,
    // 状态多选：由 storage.STATUSES 逐项算出是否已勾选
    statuses: [],
    // ── v3.1 分步向导（用户 2026-10-19 拍板）──────────────────────────────
    // 一屏一张卡，一次只处理一件事。4 步：信息 / 成长 / 状态 / 食材。
    // 原第 5 步「都记好了」整屏已删（v3.2）：摘要只是复述前面四步，
    // 身高体重记录改由首页头卡胶囊直接弹面板，备份挪到「我的」页。
    // 顶部进度条可点跳转 —— 改单个字段不用一路翻页（这是向导唯一被诟病的点，
    // 用可点进度条抵消掉）。stepPips 只做渲染，长度就是总步数。
    step: 1,
    stepPips: [1, 2, 3, 4],
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
      foodMinDate: this.foodMinOf(birthday),
      sex: (baby && baby.sex) || '',
      birthWeight: (baby && baby.birthWeight) || '',
      birthLength: (baby && baby.birthLength) || '',
      note: (baby && baby.note) || ''
    })
    this.rebuildStatus()
    this.rebuild()
  },

  /** 性别（v3.0 选填，两选一互斥）：写 'm'/'f'，再点一次取消 = ''。
   *  不进计划指纹，不 setPlan(null)。 */
  onSexPick(e) {
    const k = e.currentTarget.dataset.k
    const next = this.data.sex === k ? '' : k
    storage.setBaby({ sex: next })
    this.setData({ sex: next })
  },

  /** 出生体重/身长（v3.0 选填；区间按用户 2026-10-16 拍板：出生体重**大于 2 kg
   *  且小于 15 kg**（端点不算）、出生身长 20–70 cm（含端点））：
   *  input 阶段只回写**原始输入**、不归一 —— 旧版每击归一会吞掉小数点、并把
   *  打字中途的半截越界值清空（身长「50」打到「5」就没了，永远填不进）；
   *  校验、归一与提示全部放 blur —— 越界就是清空输入框 + 底部弹 toast 小字提醒
   *  （用户 2026-10-16 选定保留 toast，不要内联小字）。不进计划指纹。 */
  onBirthWeight(e) {
    this.setData({ birthWeight: e.detail.value })
    storage.setBaby({ birthWeight: storage.sanitizeBirthMetric(e.detail.value,
      storage.BIRTH_WEIGHT_MIN, storage.BIRTH_WEIGHT_MAX, true) })
  },
  onBirthWeightBlur() {
    const raw = this.data.birthWeight
    const v = storage.sanitizeBirthMetric(raw, storage.BIRTH_WEIGHT_MIN, storage.BIRTH_WEIGHT_MAX, true)
    this.setData({ birthWeight: v })
    storage.setBaby({ birthWeight: v })
    if (v === '' && String(raw === undefined || raw === null ? '' : raw).trim() !== '')
      wx.showToast({ title: '出生体重需大于 ' + storage.BIRTH_WEIGHT_MIN + ' kg、小于 ' + storage.BIRTH_WEIGHT_MAX + ' kg', icon: 'none' })
  },

  onBirthLength(e) {
    this.setData({ birthLength: e.detail.value })
    storage.setBaby({ birthLength: storage.sanitizeBirthMetric(e.detail.value,
      storage.BIRTH_LENGTH_MIN, storage.BIRTH_LENGTH_MAX) })
  },
  onBirthLengthBlur() {
    const raw = this.data.birthLength
    const v = storage.sanitizeBirthMetric(raw, storage.BIRTH_LENGTH_MIN, storage.BIRTH_LENGTH_MAX)
    this.setData({ birthLength: v })
    storage.setBaby({ birthLength: v })
    if (v === '' && String(raw === undefined || raw === null ? '' : raw).trim() !== '')
      wx.showToast({ title: '出生身长需在 ' + storage.BIRTH_LENGTH_MIN + '–' + storage.BIRTH_LENGTH_MAX + ' cm', icon: 'none' })
  },

  /** 一句话描述（v3.0 批⑨，选填）：首页头卡个性行，实时清洗（压空格/截断）后落库。
   *  用户自己的话，不校验、不弹提示，不进计划指纹。 */
  onNoteInput(e) {
    const note = storage.sanitizeBabyNote(e.detail.value)
    storage.setBaby({ note: note })
    this.setData({ note: note })
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
    const list = storage.statusOptions()
    this.setData({ statuses: list })
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

  /** 首次辅食日期 · 自建底部面板（v3.0，用户 2026-10-15 拍板）：
   *  原生 `<picker mode="date">` 顶栏只有「取消 / 确定」两个位置，放不下第三个
   *  「清除」按钮 —— 只能自己画面板（picker-view + 自定顶栏「取消 / 清除 / 确定」）。
   *  日期范围口径不变：下限 = 出生 + 4 个月（§6w 决策③），上限 = 今天。 */

  /** 'YYYY-MM-DD' → [y, m, d]；非法返回 null（页面自己的入参归一，不外借） */
  _ymd(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  },

  /** 打开面板：已填过 → 停在那天；没填过 → 停在今天（最常用的就是「今天开吃」） */
  openFoodPicker() {
    if (!this.data.birthday) {
      wx.showToast({ title: '先填出生日期', icon: 'none' })
      return
    }
    const p = this._ymd(this.data.foodStart) || this._ymd(this.data.today)
    // 裁切逻辑全在 age.dateColumns（纯函数，§6w 实跑）：越界的年月日不进列表，
    // 宝宝还不满 4 个月时（下限 > 今天）返回 null —— 此时没有任何合法日期可选
    const cols = p && age.dateColumns(this.data.foodMinDate, this.data.today, p[0], p[1], p[2])
    if (!cols) {
      wx.showToast({ title: '宝宝满 4 个月后才能填首次辅食日期', icon: 'none' })
      return
    }
    this.setData({
      foodPickerOpen: true,
      years: cols.years, months: cols.months, days: cols.days, pvValue: cols.value
    })
  },

  closeFoodPicker() {
    this.setData({ foodPickerOpen: false })
  },

  /** 滚动即时重裁：年变了月份列跟着变、年月变了天数列跟着变（2 月只有 28/29 天）。
   *  裁完必须回写 pvValue —— 否则 picker-view 停在已被裁掉的下标上。 */
  onFoodPickerChange(e) {
    const v = e.detail.value || []
    const cols = age.dateColumns(this.data.foodMinDate, this.data.today,
      this.data.years[v[0]], this.data.months[v[1]], this.data.days[v[2]])
    if (!cols) return
    this.setData({
      years: cols.years, months: cols.months, days: cols.days, pvValue: cols.value
    })
  },

  /** 确定：按下标取回年月日 → 落库。列里不可能有非法值，这里不再重复校验范围。 */
  confirmFoodPicker() {
    const v = this.data.pvValue || []
    const y = this.data.years[v[0]]
    const m = this.data.months[v[1]]
    const d = this.data.days[v[2]]
    if (!y || !m || !d) return
    this.setData({ foodPickerOpen: false })
    this._applyFoodStart(storage.todayStr(new Date(y, m - 1, d)),
      '已保存，计划将按辅食开始日安排')
  },

  /** 清除辅食日期（面板顶栏中间那个按钮）= 回到「按出生日期推算月龄」的现状口径。
   *  选填字段必须可回退：误填/想改回老口径都靠这条通道。
   *  只在**已经选过**日期后才生效（用户 2026-10-15：清除要「选定了首次辅食日期
   *  之后」才能点）—— 没选过时按钮置灰，且这里也挡一道。 */
  onClearFoodStart() {
    if (!this.data.foodStart) return
    this.setData({ foodPickerOpen: false })
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

  /** 面板遮罩的 catchtouchmove 落点：只为挡住背景页跟着滚，不做任何事 */
  noop() {},

  /* ── v3.1 分步向导（用户 2026-10-19 拍板）───────────────────────────────
   *  5 步 = 5 张卡，一屏一张。数据仍是**边填边存**（每个 input handler 自己
   *  调 storage.setBaby），向导只切视图、不攒草稿 —— 中途杀进程不丢，
   *  也不需要维护一份「未提交」的状态。
   *
   *  唯一硬闸门是出生日期：没有它就算不出月龄，后面三步（状态/食材/收尾）
   *  全是空转，所以第 1 步不放行。其余步骤都能留空。 */

  /** 切步 + 回到页顶（不回到顶部的话，从长列表翻页会停在半截） */
  _toStep(s) {
    this.setData({ step: s })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  /** 点进度条跳步：第 1 步之外都要求已有生日（否则后三步没有意义） */
  goStep(e) {
    const s = Number(e.currentTarget.dataset.step)
    const max = this.data.stepPips.length
    if (!s || s < 1 || s > max || s === this.data.step) return
    if (s > 1 && !this.data.birthday) {
      wx.showToast({ title: '先选一下出生日期', icon: 'none' })
      return
    }
    this._toStep(s)
  },

  nextStep() {
    if (this.data.step === 1 && !this.data.birthday) {
      wx.showToast({ title: '先选一下出生日期', icon: 'none' })
      return
    }
    if (this.data.step >= this.data.stepPips.length) return
    this._toStep(this.data.step + 1)
  },

  prevStep() {
    if (this.data.step <= 1) return
    this._toStep(this.data.step - 1)
  },

  /** 收尾页「完成」：这里才做整体校验。缺项直接把人送回第 1 步 ——
   *  在收尾页弹一句「还差出生日期」而不给入口，等于让用户自己找路。 */
  finish() {
    const miss = storage.missingFields()
    if (miss.length) {
      wx.showToast({ title: '还差' + miss.join('和'), icon: 'none' })
      this._toStep(1)
      return
    }
    this.goBack()
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
