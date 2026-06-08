// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get appName => 'Wisper';

  @override
  String get homeTabTunnel => '隧道';

  @override
  String get homeTabEntrypoint => '入口';

  @override
  String get homeEmptyTunnels => '暂无隧道';

  @override
  String get homeEmptyEntrypoints => '暂无入口';

  @override
  String get homeFavoritesTooltip => '仅显示收藏';

  @override
  String get homeAllTooltip => '显示全部';

  @override
  String get tunnelNewTitle => '隧道';

  @override
  String get entrypointNewTitle => '入口';

  @override
  String get settingsTitle => '设置';

  @override
  String get settingsLanguage => '语言';

  @override
  String get settingsTheme => '主题';

  @override
  String get settingsThemeSystem => '跟随系统';

  @override
  String get settingsThemeLight => '浅色';

  @override
  String get settingsThemeDark => '深色';

  @override
  String get settingsLangEn => 'English';

  @override
  String get settingsLangZh => '中文';

  @override
  String get btnStart => '启动';

  @override
  String get btnStop => '停止';

  @override
  String get btnSave => '保存';

  @override
  String get btnEdit => '编辑';

  @override
  String get btnDelete => '删除';

  @override
  String get btnCancel => '取消';

  @override
  String get btnCopy => '复制';

  @override
  String get fieldName => '名称';

  @override
  String get fieldEndpoint => '端点';

  @override
  String get fieldBindAddress => '绑定地址';

  @override
  String get fieldTunnelChain => '隧道链';

  @override
  String get fieldUsername => '用户名';

  @override
  String get fieldPassword => '密码';

  @override
  String get fieldDirectory => '目录';

  @override
  String get fieldTTL => 'TTL';

  @override
  String get fieldTTLHint => '例如 30s';

  @override
  String get switchBasicAuth => '基本认证';

  @override
  String get fieldHostname => '主机名';

  @override
  String get switchRewriteHost => '重写主机';

  @override
  String get switchEnableTLS => '启用 TLS';

  @override
  String get switchKeepalive => '保活';

  @override
  String get labelStatistics => '统计';

  @override
  String get statusRunning => '运行中';

  @override
  String get statusStopped => '已停止';

  @override
  String get statusError => '连接失败';

  @override
  String get copiedToClipboard => '已复制到剪贴板';

  @override
  String get deleteConfirmTitle => '确认删除？';

  @override
  String get deleteConfirmMessage => '此操作无法撤销。';

  @override
  String saveFailed(String error) {
    return '保存失败：$error';
  }

  @override
  String get started => '启动成功';

  @override
  String get stopped => '停止成功';

  @override
  String startFailed(String error) {
    return '启动失败：$error';
  }

  @override
  String stopFailed(String error) {
    return '停止失败：$error';
  }

  @override
  String get deleted => '删除成功';

  @override
  String deleteFailed(String error) {
    return '删除失败：$error';
  }

  @override
  String get saved => '保存成功';

  @override
  String get favoriteAdded => '已添加到收藏';

  @override
  String get favoriteRemoved => '已从收藏移除';

  @override
  String get requiredField => '必填';

  @override
  String get typeFile => '文件';

  @override
  String get typeHttp => 'HTTP';

  @override
  String get typeTcp => 'TCP';

  @override
  String get typeUdp => 'UDP';

  @override
  String get typeFileDesc => '从本地目录共享文件';

  @override
  String get typeHttpDesc => '共享本地 HTTP 服务';

  @override
  String get typeTcpDesc => '转发本地 TCP 端口';

  @override
  String get typeUdpDesc => '转发本地 UDP 端口';

  @override
  String get typeTcpEntryDesc => '通过隧道暴露 TCP 服务';

  @override
  String get typeUdpEntryDesc => '通过隧道暴露 UDP 服务';

  @override
  String get settingsFavorites => '收藏';
}
