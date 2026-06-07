/// Application settings model.
library;

/// Theme mode preference.
enum ThemePreference { system, light, dark }

/// Language preference.
enum LanguagePreference { en, zh }

/// Application-wide settings.
class AppSettings {
  const AppSettings({
    this.theme = ThemePreference.system,
    this.language = LanguagePreference.en,
    this.backendPort = 8900,
  });

  final ThemePreference theme;
  final LanguagePreference language;
  final int backendPort;

  AppSettings copyWith({
    ThemePreference? theme,
    LanguagePreference? language,
    int? backendPort,
  }) {
    return AppSettings(
      theme: theme ?? this.theme,
      language: language ?? this.language,
      backendPort: backendPort ?? this.backendPort,
    );
  }
}
