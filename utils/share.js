/**
 * 分享（v3.0 批⑧ · 用户 2026-10-15 三项拍板）
 *
 * ① 标题 = 页面内容型：只写「这一页是什么」，不带宝宝名字 / 月龄 / 状态 ——
 *    微信卡片下方自动带小程序名（臭宝吃什么），标题不重复应用名，更不把
 *    个人信息随卡片发出去（§6x-18 钉：本文件不引 storage、词表扫过）。
 * ② 缩略图 = **固定分享卡位图**（v3.6 · 用户 2026-10-20 修订批⑧拍板②）：
 *    此前是「不传 imageUrl、让微信自动截当前页」，截图会把整页菜单糊成一张
 *    信息量过载的图，且五页五个样、没有品牌识别。现在统一走
 *    `images/share-card.png`（500×400，5:4 暖白底 + 围兜宝宝 logo）。
 *    只此一处绑定：位图路径写死在本文件，页面钩子仍只调 card(title, path)。
 *    反向钉仍在：不许网络地址、不许带个人信息（§6x-18）。
 * ③ 范围 = 内容页全开：计划首页 / 查一查 / 食材详情 / 各月龄指南 / 生长曲线；
 *    档案页（profile）与「我的」（mine）不开放分享（§6x-18 反向钉）。
 *
 * 好友卡片（onShareAppMessage）与朋友圈（onShareTimeline）共用同一套
 * title + path —— 两个钩子都调 card()，文案只在本文件这一处。
 * path 全部显式给全（以 / 开头、必须在 app.json 注册）：分享打开落回原页，
 * 食材详情带 ?id 落回原食材。
 */

// 拍板文案（改一个字 = 重新拍板，§6x-18 文本钉）
const TITLES = {
  plan: '一周辅食计划',
  food: '食材怎么加',
  months: '各月龄注意事项',
  growth: '成长曲线'
}

// 分享卡位图：本地路径、5:4、约 12KB —— 只有这一处写死路径
const SHARE_IMG = '/images/share-card.png'

// 食材详情：标题跟当前食材走（「南瓜怎么加」）；没 build 出来兜底查一查标题
function foodDetailTitle(name) {
  return name ? name + '怎么加' : TITLES.food
}

function card(title, path) {
  // imageUrl 全文件只出现这一次 —— 分享卡位图的唯一绑定点（§6x-18 反向钉）
  const o = { title: title, imageUrl: SHARE_IMG }
  if (path) o.path = path
  return o
}

module.exports = {
  TITLES: TITLES,
  foodDetailTitle: foodDetailTitle,
  card: card
}
