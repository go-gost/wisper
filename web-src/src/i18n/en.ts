const en: Record<string, string> = {
  // App / UI labels
  appName: 'Wisper',
  homeTabTunnel: 'Tunnels',
  homeTabEntrypoint: 'Entrypoints',
  homeEmptyTunnels: 'No tunnels yet',
  homeEmptyEntrypoints: 'No entrypoints yet',
  homeFavoritesTooltip: 'Show favorites',
  homeAllTooltip: 'Show all',
  tunnelNewTitle: 'New Tunnel',
  entrypointNewTitle: 'New Entrypoint',
  settingsTitle: 'Settings',
  settingsLanguage: 'Language',
  settingsTheme: 'Theme',

  // Theme options
  settingsThemeSystem: 'System',
  settingsThemeLight: 'Light',
  settingsThemeDark: 'Dark',
  settingsLangEn: 'English',
  settingsLangZh: '中文',

  // Buttons
  btnStart: 'Start',
  btnStop: 'Stop',
  btnSave: 'Save',
  btnEdit: 'Edit',
  btnDelete: 'Delete',
  btnCancel: 'Cancel',
  btnCopy: 'Copy',

  // Form fields
  fieldName: 'Name',
  fieldEndpoint: 'Endpoint',
  fieldBindAddress: 'Bind Address',
  fieldTunnelChain: 'Tunnel Chain',
  fieldUsername: 'Username',
  fieldPassword: 'Password',
  fieldDirectory: 'Directory',
  fieldTTL: 'TTL',
  fieldTTLHint: 'e.g. 30s',

  // Switches
  switchBasicAuth: 'Basic Auth',
  fieldHostname: 'Hostname',
  switchRewriteHost: 'Rewrite Host',
  switchEnableTLS: 'Enable TLS',
  switchFileUpload: 'File Upload',
  switchKeepalive: 'Keepalive',

  // Status
  labelStatistics: 'Statistics',
  statusRunning: 'Running',
  statusStopped: 'Stopped',
  statusError: 'Error',

  // Type descriptions
  typeFile: 'File',
  typeHttp: 'HTTP',
  typeTcp: 'TCP',
  typeUdp: 'UDP',
  typeFileDesc: 'Expose a local directory or file via HTTP',
  typeHttpDesc: 'Reverse proxy to a local HTTP service',
  typeTcpDesc: 'Forward TCP traffic to a local port',
  typeUdpDesc: 'Forward UDP traffic to a local port',
  typeTcpEntryDesc: 'Expose a tunnel endpoint as a local TCP port',
  typeUdpEntryDesc: 'Expose a tunnel endpoint as a local UDP port',

  // Notifications
  copiedToClipboard: 'Copied to clipboard',
  deleteConfirmTitle: 'Confirm Delete',
  deleteConfirmMessage: 'Are you sure you want to delete this item?',
  saveFailed: 'Failed to save',
  started: 'Started',
  stopped: 'Stopped',
  startFailed: 'Failed to start',
  stopFailed: 'Failed to stop',
  deleted: 'Deleted',
  deleteFailed: 'Failed to delete',
  saved: 'Saved',
  favoriteAdded: 'Added to favorites',
  favoriteRemoved: 'Removed from favorites',
  requiredField: 'This field is required',

  // Settings
  settingsFavorites: 'Favorites',
  settingsServer: 'Tunnel Server',
  settingsServerHint: 'tunnel.gost.run',
  settingsEntrypoint: 'Entrypoint Domain',
  settingsEntrypointHint: 'gost.run',
  settingsInsecure: 'Skip TLS Verify',
  settingsInsecureDesc: 'Skip certificate verification for tunnel connections',
};

export default en;
