// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Wisper';

  @override
  String get homeTabTunnel => 'Tunnel';

  @override
  String get homeTabEntrypoint => 'Entrypoint';

  @override
  String get homeEmptyTunnels => 'No tunnels yet';

  @override
  String get homeEmptyEntrypoints => 'No entrypoints yet';

  @override
  String get homeFavoritesTooltip => 'Show favorites only';

  @override
  String get homeAllTooltip => 'Show all';

  @override
  String get tunnelNewTitle => 'Tunnel';

  @override
  String get entrypointNewTitle => 'Entrypoint';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsLanguage => 'Language';

  @override
  String get settingsTheme => 'Theme';

  @override
  String get settingsThemeSystem => 'System';

  @override
  String get settingsThemeLight => 'Light';

  @override
  String get settingsThemeDark => 'Dark';

  @override
  String get settingsLangEn => 'English';

  @override
  String get settingsLangZh => '中文';

  @override
  String get btnStart => 'Start';

  @override
  String get btnStop => 'Stop';

  @override
  String get btnSave => 'Save';

  @override
  String get btnEdit => 'Edit';

  @override
  String get btnDelete => 'Delete';

  @override
  String get btnCancel => 'Cancel';

  @override
  String get btnCopy => 'Copy';

  @override
  String get fieldName => 'Name';

  @override
  String get fieldEndpoint => 'Endpoint';

  @override
  String get fieldBindAddress => 'Bind Address';

  @override
  String get fieldTunnelChain => 'Tunnel Chain';

  @override
  String get fieldUsername => 'Username';

  @override
  String get fieldPassword => 'Password';

  @override
  String get fieldDirectory => 'Directory';

  @override
  String get fieldTTL => 'TTL';

  @override
  String get fieldTTLHint => 'e.g. 30s';

  @override
  String get switchBasicAuth => 'Basic Auth';

  @override
  String get fieldHostname => 'Hostname';

  @override
  String get switchRewriteHost => 'Rewrite Host';

  @override
  String get switchEnableTLS => 'Enable TLS';

  @override
  String get switchFileUpload => 'File Upload';

  @override
  String get switchKeepalive => 'Keepalive';

  @override
  String get labelStatistics => 'Statistics';

  @override
  String get statusRunning => 'running';

  @override
  String get statusStopped => 'stopped';

  @override
  String get statusError => 'error';

  @override
  String get copiedToClipboard => 'Copied to clipboard';

  @override
  String get deleteConfirmTitle => 'Delete?';

  @override
  String get deleteConfirmMessage => 'This action cannot be undone.';

  @override
  String saveFailed(String error) {
    return 'Save failed: $error';
  }

  @override
  String get started => 'Started successfully';

  @override
  String get stopped => 'Stopped successfully';

  @override
  String startFailed(String error) {
    return 'Start failed: $error';
  }

  @override
  String stopFailed(String error) {
    return 'Stop failed: $error';
  }

  @override
  String get deleted => 'Deleted successfully';

  @override
  String deleteFailed(String error) {
    return 'Delete failed: $error';
  }

  @override
  String get saved => 'Saved successfully';

  @override
  String get favoriteAdded => 'Added to favorites';

  @override
  String get favoriteRemoved => 'Removed from favorites';

  @override
  String get requiredField => 'Required';

  @override
  String get typeFile => 'File';

  @override
  String get typeHttp => 'HTTP';

  @override
  String get typeTcp => 'TCP';

  @override
  String get typeUdp => 'UDP';

  @override
  String get typeFileDesc => 'Share files from a local directory';

  @override
  String get typeHttpDesc => 'Share a local HTTP server';

  @override
  String get typeTcpDesc => 'Forward a local TCP port';

  @override
  String get typeUdpDesc => 'Forward a local UDP port';

  @override
  String get typeTcpEntryDesc => 'Expose a TCP service through the tunnel';

  @override
  String get typeUdpEntryDesc => 'Expose a UDP service through the tunnel';

  @override
  String get settingsFavorites => 'Favorites';

  @override
  String get settingsServer => 'Tunnel Server';

  @override
  String get settingsServerHint => 'e.g. tunnel.gost.run';

  @override
  String get settingsEntrypoint => 'Entrypoint Domain';

  @override
  String get settingsEntrypointHint => 'e.g. gost.run';

  @override
  String get settingsInsecure => 'Skip TLS Verify';

  @override
  String get settingsInsecureDesc =>
      'Disable certificate verification for private/self-signed servers';
}
