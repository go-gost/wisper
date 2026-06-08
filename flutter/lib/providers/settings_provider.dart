/// Riverpod provider for application settings.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/app_settings.dart';
import '../providers/backend_provider.dart' show backendProvider;

/// Application settings state notifier.
final settingsProvider =
    StateNotifierProvider<SettingsNotifier, AppSettings>(
  SettingsNotifier.new,
);

/// Notifier that manages app settings (theme, language, etc.).
class SettingsNotifier extends StateNotifier<AppSettings> {
  SettingsNotifier(this.ref) : super(const AppSettings()) {
    _loadFromBackend();
  }

  final Ref ref;

  Future<void> _loadFromBackend() async {
    try {
      final backend = ref.read(backendProvider);
      final config = await backend.getConfig();
      if (!mounted) return;
      state = AppSettings(
        theme: _parseTheme(config['theme'] as String?),
        language: _parseLanguage(config['lang'] as String?),
        backendPort: config['port'] as int? ?? 8900,
        server: config['server'] as String? ?? '',
        entrypoint: config['entrypoint'] as String? ?? '',
        insecure: config['insecure'] as bool? ?? false,
      );
    } catch (_) {
      // Use defaults if backend is unavailable
    }
  }

  /// Update theme preference.
  Future<void> setTheme(ThemePreference theme) async {
    state = state.copyWith(theme: theme);
    await _saveToBackend();
  }

  /// Update language preference.
  Future<void> setLanguage(LanguagePreference language) async {
    state = state.copyWith(language: language);
    await _saveToBackend();
  }

  /// Update tunnel server hostname.
  Future<void> setServer(String server) async {
    state = state.copyWith(server: server);
    await _saveToBackend();
  }

  /// Update entrypoint domain.
  Future<void> setEntrypoint(String entrypoint) async {
    state = state.copyWith(entrypoint: entrypoint);
    await _saveToBackend();
  }

  /// Update TLS skip-verify setting.
  Future<void> setInsecure(bool insecure) async {
    state = state.copyWith(insecure: insecure);
    await _saveToBackend();
  }

  Future<void> _saveToBackend() async {
    try {
      final backend = ref.read(backendProvider);
      await backend.updateConfig({
        'theme': state.theme.name,
        'lang': state.language.name,
        'port': state.backendPort,
        'server': state.server,
        'entrypoint': state.entrypoint,
        'insecure': state.insecure,
      });
    } catch (_) {
      // Silently fail — settings are kept locally
    }
  }

  static ThemePreference _parseTheme(String? value) {
    return switch (value) {
      'light' => ThemePreference.light,
      'dark' => ThemePreference.dark,
      _ => ThemePreference.system,
    };
  }

  static LanguagePreference _parseLanguage(String? value) {
    return switch (value) {
      'zh' => LanguagePreference.zh,
      _ => LanguagePreference.en,
    };
  }
}

/// Derive [ThemeMode] from settings.
final themeModeProvider = Provider<ThemeMode>((ref) {
  final settings = ref.watch(settingsProvider);
  return switch (settings.theme) {
    ThemePreference.light => ThemeMode.light,
    ThemePreference.dark => ThemeMode.dark,
    ThemePreference.system => ThemeMode.system,
  };
});

/// Derive [Locale] from settings.
final localeProvider = Provider<Locale>((ref) {
  final settings = ref.watch(settingsProvider);
  return switch (settings.language) {
    LanguagePreference.zh => const Locale('zh'),
    LanguagePreference.en => const Locale('en'),
  };
});
