/// Wisper application widget — MaterialApp with Riverpod + GoRouter.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'config/theme.dart';
import 'config/routes.dart';
import 'providers/settings_provider.dart';

/// Root application widget.
class WisperApp extends ConsumerWidget {
  const WisperApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);

    return MaterialApp.router(
      title: 'Wisper',
      debugShowCheckedModeBanner: false,

      // Theming
      theme: lightTheme,
      darkTheme: darkTheme,
      themeMode: themeMode,

      // Routing
      routerConfig: router,
    );
  }
}
