import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('zh'),
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'Wisper'**
  String get appName;

  /// No description provided for @homeTabTunnel.
  ///
  /// In en, this message translates to:
  /// **'Tunnel'**
  String get homeTabTunnel;

  /// No description provided for @homeTabEntrypoint.
  ///
  /// In en, this message translates to:
  /// **'Entrypoint'**
  String get homeTabEntrypoint;

  /// No description provided for @homeEmptyTunnels.
  ///
  /// In en, this message translates to:
  /// **'No tunnels yet'**
  String get homeEmptyTunnels;

  /// No description provided for @homeEmptyEntrypoints.
  ///
  /// In en, this message translates to:
  /// **'No entrypoints yet'**
  String get homeEmptyEntrypoints;

  /// No description provided for @homeFavoritesTooltip.
  ///
  /// In en, this message translates to:
  /// **'Show favorites only'**
  String get homeFavoritesTooltip;

  /// No description provided for @homeAllTooltip.
  ///
  /// In en, this message translates to:
  /// **'Show all'**
  String get homeAllTooltip;

  /// No description provided for @tunnelNewTitle.
  ///
  /// In en, this message translates to:
  /// **'Tunnel'**
  String get tunnelNewTitle;

  /// No description provided for @entrypointNewTitle.
  ///
  /// In en, this message translates to:
  /// **'Entrypoint'**
  String get entrypointNewTitle;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// No description provided for @settingsTheme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get settingsTheme;

  /// No description provided for @settingsThemeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsThemeSystem;

  /// No description provided for @settingsThemeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsThemeLight;

  /// No description provided for @settingsThemeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsThemeDark;

  /// No description provided for @settingsLangEn.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get settingsLangEn;

  /// No description provided for @settingsLangZh.
  ///
  /// In en, this message translates to:
  /// **'中文'**
  String get settingsLangZh;

  /// No description provided for @btnStart.
  ///
  /// In en, this message translates to:
  /// **'Start'**
  String get btnStart;

  /// No description provided for @btnStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get btnStop;

  /// No description provided for @btnSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get btnSave;

  /// No description provided for @btnEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get btnEdit;

  /// No description provided for @btnDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get btnDelete;

  /// No description provided for @btnCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get btnCancel;

  /// No description provided for @btnCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get btnCopy;

  /// No description provided for @fieldName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get fieldName;

  /// No description provided for @fieldEndpoint.
  ///
  /// In en, this message translates to:
  /// **'Endpoint'**
  String get fieldEndpoint;

  /// No description provided for @fieldBindAddress.
  ///
  /// In en, this message translates to:
  /// **'Bind Address'**
  String get fieldBindAddress;

  /// No description provided for @fieldTunnelChain.
  ///
  /// In en, this message translates to:
  /// **'Tunnel Chain'**
  String get fieldTunnelChain;

  /// No description provided for @fieldUsername.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get fieldUsername;

  /// No description provided for @fieldPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get fieldPassword;

  /// No description provided for @fieldDirectory.
  ///
  /// In en, this message translates to:
  /// **'Directory'**
  String get fieldDirectory;

  /// No description provided for @fieldTTL.
  ///
  /// In en, this message translates to:
  /// **'TTL'**
  String get fieldTTL;

  /// No description provided for @fieldTTLHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 30s'**
  String get fieldTTLHint;

  /// No description provided for @switchBasicAuth.
  ///
  /// In en, this message translates to:
  /// **'Basic Auth'**
  String get switchBasicAuth;

  /// No description provided for @fieldHostname.
  ///
  /// In en, this message translates to:
  /// **'Hostname'**
  String get fieldHostname;

  /// No description provided for @switchRewriteHost.
  ///
  /// In en, this message translates to:
  /// **'Rewrite Host'**
  String get switchRewriteHost;

  /// No description provided for @switchEnableTLS.
  ///
  /// In en, this message translates to:
  /// **'Enable TLS'**
  String get switchEnableTLS;

  /// No description provided for @switchFileUpload.
  ///
  /// In en, this message translates to:
  /// **'File Upload'**
  String get switchFileUpload;

  /// No description provided for @switchKeepalive.
  ///
  /// In en, this message translates to:
  /// **'Keepalive'**
  String get switchKeepalive;

  /// No description provided for @labelStatistics.
  ///
  /// In en, this message translates to:
  /// **'Statistics'**
  String get labelStatistics;

  /// No description provided for @statusRunning.
  ///
  /// In en, this message translates to:
  /// **'running'**
  String get statusRunning;

  /// No description provided for @statusStopped.
  ///
  /// In en, this message translates to:
  /// **'stopped'**
  String get statusStopped;

  /// No description provided for @statusError.
  ///
  /// In en, this message translates to:
  /// **'error'**
  String get statusError;

  /// No description provided for @copiedToClipboard.
  ///
  /// In en, this message translates to:
  /// **'Copied to clipboard'**
  String get copiedToClipboard;

  /// No description provided for @deleteConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete?'**
  String get deleteConfirmTitle;

  /// No description provided for @deleteConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'This action cannot be undone.'**
  String get deleteConfirmMessage;

  /// No description provided for @saveFailed.
  ///
  /// In en, this message translates to:
  /// **'Save failed: {error}'**
  String saveFailed(String error);

  /// No description provided for @started.
  ///
  /// In en, this message translates to:
  /// **'Started successfully'**
  String get started;

  /// No description provided for @stopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped successfully'**
  String get stopped;

  /// No description provided for @startFailed.
  ///
  /// In en, this message translates to:
  /// **'Start failed: {error}'**
  String startFailed(String error);

  /// No description provided for @stopFailed.
  ///
  /// In en, this message translates to:
  /// **'Stop failed: {error}'**
  String stopFailed(String error);

  /// No description provided for @deleted.
  ///
  /// In en, this message translates to:
  /// **'Deleted successfully'**
  String get deleted;

  /// No description provided for @deleteFailed.
  ///
  /// In en, this message translates to:
  /// **'Delete failed: {error}'**
  String deleteFailed(String error);

  /// No description provided for @saved.
  ///
  /// In en, this message translates to:
  /// **'Saved successfully'**
  String get saved;

  /// No description provided for @favoriteAdded.
  ///
  /// In en, this message translates to:
  /// **'Added to favorites'**
  String get favoriteAdded;

  /// No description provided for @favoriteRemoved.
  ///
  /// In en, this message translates to:
  /// **'Removed from favorites'**
  String get favoriteRemoved;

  /// No description provided for @requiredField.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get requiredField;

  /// No description provided for @typeFile.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get typeFile;

  /// No description provided for @typeHttp.
  ///
  /// In en, this message translates to:
  /// **'HTTP'**
  String get typeHttp;

  /// No description provided for @typeTcp.
  ///
  /// In en, this message translates to:
  /// **'TCP'**
  String get typeTcp;

  /// No description provided for @typeUdp.
  ///
  /// In en, this message translates to:
  /// **'UDP'**
  String get typeUdp;

  /// No description provided for @typeFileDesc.
  ///
  /// In en, this message translates to:
  /// **'Share files from a local directory'**
  String get typeFileDesc;

  /// No description provided for @typeHttpDesc.
  ///
  /// In en, this message translates to:
  /// **'Share a local HTTP server'**
  String get typeHttpDesc;

  /// No description provided for @typeTcpDesc.
  ///
  /// In en, this message translates to:
  /// **'Forward a local TCP port'**
  String get typeTcpDesc;

  /// No description provided for @typeUdpDesc.
  ///
  /// In en, this message translates to:
  /// **'Forward a local UDP port'**
  String get typeUdpDesc;

  /// No description provided for @typeTcpEntryDesc.
  ///
  /// In en, this message translates to:
  /// **'Expose a TCP service through the tunnel'**
  String get typeTcpEntryDesc;

  /// No description provided for @typeUdpEntryDesc.
  ///
  /// In en, this message translates to:
  /// **'Expose a UDP service through the tunnel'**
  String get typeUdpEntryDesc;

  /// No description provided for @settingsFavorites.
  ///
  /// In en, this message translates to:
  /// **'Favorites'**
  String get settingsFavorites;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'zh'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
