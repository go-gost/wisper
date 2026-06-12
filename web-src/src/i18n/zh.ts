const zh: Record<string, string> = {
  // App / UI labels
  appName: 'Wisper',
  homeTabTunnel: '隧道',
  homeTabEntrypoint: '入口',
  homeEmptyTunnels: '暂无隧道',
  homeEmptyEntrypoints: '暂无入口',
  homeFavoritesTooltip: '显示收藏',
  homeAllTooltip: '显示全部',
  homeNoFavorites: '暂无收藏',
  homeNoFavTunnelHint: '点击任意隧道上的星标将其添加到收藏。',
  homeNoFavEntryHint: '点击任意入口上的星标将其添加到收藏。',
  homeShowAllTunnels: '显示全部隧道',
  homeShowAllEntrypoints: '显示全部入口',
  homeEmptyTunnelDesc: '创建您的第一个隧道，将本地服务暴露到互联网。',
  homeEmptyEntryDesc: '创建入口，将隧道流量转发到本地端口。',
  tunnelNewTitle: '新建隧道',
  entrypointNewTitle: '新建入口',
  settingsTitle: '设置',
  settingsLanguage: '语言',
  settingsTheme: '主题',

  // Theme options
  settingsThemeSystem: '跟随系统',
  settingsThemeLight: '浅色',
  settingsThemeDark: '深色',
  settingsLangEn: 'English',
  settingsLangZh: '中文',

  // Buttons
  btnStart: '启动',
  btnStop: '停止',
  btnSave: '保存',
  btnEdit: '编辑',
  btnDelete: '删除',
  btnCancel: '取消',
  btnCopy: '复制',
  btnResetStats: '清零',
  btnResetInput: '清零上传',
  btnResetOutput: '清零下载',

  // Form fields
  fieldName: '名称',
  fieldEndpoint: '端点',
  fieldBindAddress: '绑定地址',
  fieldTunnelChain: '隧道链路',
  fieldUsername: '用户名',
  fieldPassword: '密码',
  fieldDirectory: '目录',
  fieldTTL: 'TTL',
  fieldTTLHint: '例如 30s',

  // Switches
  switchBasicAuth: '基本认证',
  fieldHostname: '主机名',
  switchRewriteHost: '重写主机头',
  switchEnableTLS: '启用 TLS',
  switchFileUpload: '文件上传',
  switchKeepalive: '保活',

  // Status
  labelStatistics: '统计',
  statusRunning: '运行中',
  statusStopped: '已停止',
  statusError: '错误',
  activeConnections: '个活跃连接',

  // Type descriptions
  typeFile: '文件',
  typeHttp: 'HTTP',
  typeTcp: 'TCP',
  typeUdp: 'UDP',
  typeFileDesc: '通过 HTTP 暴露本地目录或文件',
  typeHttpDesc: '反向代理到本地 HTTP 服务',
  typeTcpDesc: '转发 TCP 流量到本地端口',
  typeUdpDesc: '转发 UDP 流量到本地端口',
  typeTcpEntryDesc: '将隧道端点暴露为本地 TCP 端口',
  typeUdpEntryDesc: '将隧道端点暴露为本地 UDP 端口',

  // Notifications
  copiedToClipboard: '已复制到剪贴板',
  resetStatsConfirmTitle: '重置统计',
  resetStatsConfirm: '确认清零累计流量？',
  deleteConfirmTitle: '确认删除',
  deleteConfirmMessage: '确定要删除此项吗？',
  saveFailed: '保存失败',
  started: '已启动',
  stopped: '已停止',
  startFailed: '启动失败',
  stopFailed: '停止失败',
  deleted: '已删除',
  deleteFailed: '删除失败',
  saved: '已保存',
  favoriteAdded: '已添加到收藏',
  favoriteRemoved: '已从收藏移除',
  requiredField: '此字段为必填项',

  // Stats interval
  settingsStatsInterval: '统计更新频率',
  settingsInterval1s: '1 秒',
  settingsInterval2s: '2 秒',
  settingsInterval5s: '5 秒',
  settingsInterval10s: '10 秒',
  settingsInterval30s: '30 秒',

  // Settings
  settingsFavorites: '收藏',
  settingsServer: '隧道服务器',
  settingsServerHint: 'tunnel.gost.run',
  settingsEntrypoint: '入口域名',
  settingsEntrypointHint: 'gost.run',
  settingsInsecure: '跳过 TLS 验证',
  settingsInsecureDesc: '跳过隧道连接的证书验证',
};

export default zh;
