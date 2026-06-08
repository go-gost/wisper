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
    this.server = '',
    this.entrypoint = '',
    this.insecure = false,
  });

  final ThemePreference theme;
  final LanguagePreference language;
  final int backendPort;

  /// Tunnel relay server hostname (e.g. tunnel.gost.run).
  final String server;

  /// Public entrypoint domain (e.g. gost.run).
  final String entrypoint;

  /// Skip TLS certificate verification for the tunnel server.
  final bool insecure;

  AppSettings copyWith({
    ThemePreference? theme,
    LanguagePreference? language,
    int? backendPort,
    String? server,
    String? entrypoint,
    bool? insecure,
  }) {
    return AppSettings(
      theme: theme ?? this.theme,
      language: language ?? this.language,
      backendPort: backendPort ?? this.backendPort,
      server: server ?? this.server,
      entrypoint: entrypoint ?? this.entrypoint,
      insecure: insecure ?? this.insecure,
    );
  }
}
