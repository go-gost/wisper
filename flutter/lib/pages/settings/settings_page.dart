/// Settings page — theme, language, app info.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../l10n/app_localizations.dart';
import '../../models/app_settings.dart';
import '../../providers/settings_provider.dart';
import '../../widgets/app_scaffold.dart';
import '../../widgets/selector_field.dart';

/// Settings page with theme/language selectors and app info.
class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  late final TextEditingController _serverController;
  late final TextEditingController _entrypointController;
  Timer? _serverDebounce;
  Timer? _entrypointDebounce;

  @override
  void initState() {
    super.initState();
    final settings = ref.read(settingsProvider);
    _serverController = TextEditingController(text: settings.server);
    _entrypointController = TextEditingController(text: settings.entrypoint);
  }

  @override
  void dispose() {
    _serverDebounce?.cancel();
    _entrypointDebounce?.cancel();
    _serverController.dispose();
    _entrypointController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsProvider);
    final notifier = ref.read(settingsProvider.notifier);
    final l10n = AppLocalizations.of(context)!;

    // Sync controllers when settings load from backend.
    if (_serverController.text != settings.server && settings.server.isNotEmpty) {
      _serverController.text = settings.server;
    }
    if (_entrypointController.text != settings.entrypoint && settings.entrypoint.isNotEmpty) {
      _entrypointController.text = settings.entrypoint;
    }

    return AppScaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.pop()),
        title: Text(l10n.settingsTitle),
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            // App info header
            const SizedBox(height: 32),
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary,
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Center(
                child: Text(
                  'W',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 32,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              l10n.appName,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 20),
            ),
            const SizedBox(height: 4),
            Text(
              'v0.1.0',
              style: TextStyle(color: Theme.of(context).disabledColor),
            ),
            const SizedBox(height: 24),

            // Server settings card
            Card(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                    child: TextField(
                      controller: _serverController,
                      decoration: InputDecoration(
                        labelText: l10n.settingsServer,
                        hintText: l10n.settingsServerHint,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      onChanged: (v) {
                        _serverDebounce?.cancel();
                        _serverDebounce = Timer(
                          const Duration(milliseconds: 600),
                          () => notifier.setServer(v.trim()),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 12),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    child: TextField(
                      controller: _entrypointController,
                      decoration: InputDecoration(
                        labelText: l10n.settingsEntrypoint,
                        hintText: l10n.settingsEntrypointHint,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      onChanged: (v) {
                        _entrypointDebounce?.cancel();
                        _entrypointDebounce = Timer(
                          const Duration(milliseconds: 600),
                          () => notifier.setEntrypoint(v.trim()),
                        );
                      },
                    ),
                  ),
                  Divider(height: 1, indent: 16, endIndent: 16),
                  SwitchListTile(
                    title: Text(l10n.settingsInsecure),
                    subtitle: Text(l10n.settingsInsecureDesc),
                    value: settings.insecure,
                    onChanged: (v) => notifier.setInsecure(v),
                    dense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),

            // Theme & language card
            Card(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                children: [
                  SelectorField(
                    label: l10n.settingsLanguage,
                    options: [l10n.settingsLangEn, l10n.settingsLangZh],
                    selectedIndex: settings.language == LanguagePreference.en
                        ? 0
                        : 1,
                    onChanged: (i) => notifier.setLanguage(
                      i == 0 ? LanguagePreference.en : LanguagePreference.zh,
                    ),
                  ),
                  const Divider(height: 1),
                  SelectorField(
                    label: l10n.settingsTheme,
                    options: [
                      l10n.settingsThemeSystem,
                      l10n.settingsThemeLight,
                      l10n.settingsThemeDark,
                    ],
                    selectedIndex: settings.theme.index,
                    onChanged: (i) => notifier.setTheme(
                      ThemePreference.values[i],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
