/// Settings page — theme, language, app info.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/app_settings.dart';
import '../../providers/settings_provider.dart';
import '../../widgets/app_scaffold.dart';
import '../../widgets/selector_field.dart';

/// Settings page with theme/language selectors and app info.
class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider);
    final notifier = ref.read(settingsProvider.notifier);

    return AppScaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.pop()),
        title: const Text('Settings'),
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
            const Text(
              'Wisper',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 20),
            ),
            const SizedBox(height: 4),
            Text(
              'v0.1.0',
              style: TextStyle(color: Theme.of(context).disabledColor),
            ),
            const SizedBox(height: 24),

            // Settings card
            Card(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                children: [
                  SelectorField(
                    label: 'Language',
                    options: const ['English', '中文'],
                    selectedIndex: settings.language == LanguagePreference.en
                        ? 0
                        : 1,
                    onChanged: (i) => notifier.setLanguage(
                      i == 0 ? LanguagePreference.en : LanguagePreference.zh,
                    ),
                  ),
                  const Divider(height: 1),
                  SelectorField(
                    label: 'Theme',
                    options: const ['System', 'Light', 'Dark'],
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
