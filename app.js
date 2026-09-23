const storage = require('./utils/storage')

App({
  onLaunch() {
    // MVP 阶段所有数据都存本地，不依赖云开发。
    // 启动时先把存储结构初始化好，各页面就不用重复判断了。
    storage.ensureInit()
  },

  globalData: {
    version: '2.0'
  }
})
