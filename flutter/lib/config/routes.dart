/// GoRouter route definitions for Wisper.
library;

import 'package:go_router/go_router.dart';

import '../pages/home/home_page.dart';
import '../pages/tunnel/tunnel_detail_page.dart';
import '../pages/tunnel/tunnel_list_page.dart';
import '../pages/entrypoint/entrypoint_detail_page.dart';
import '../pages/entrypoint/entrypoint_list_page.dart';
import '../pages/settings/settings_page.dart';

/// Application router.
final router = GoRouter(
  initialLocation: '/',
  routes: [
    // Home — tunnel/entrypoint tabs
    GoRoute(
      path: '/',
      builder: (context, state) => const HomePage(),
    ),

    // Tunnel type selection
    GoRoute(
      path: '/tunnel/new',
      builder: (context, state) => const TunnelListPage(),
    ),

    // Tunnel detail (view/edit/create) — parameterised by type
    GoRoute(
      path: '/tunnel/:type/:id',
      builder: (context, state) {
        final type = state.pathParameters['type']!;
        final id = state.pathParameters['id']!;
        return TunnelDetailPage(type: type, id: id);
      },
    ),

    // Entrypoint type selection
    GoRoute(
      path: '/entrypoint/new',
      builder: (context, state) => const EntrypointListPage(),
    ),

    // Entrypoint detail (view/edit)
    GoRoute(
      path: '/entrypoint/:type/:id',
      builder: (context, state) {
        final type = state.pathParameters['type']!;
        final id = state.pathParameters['id']!;
        return EntrypointDetailPage(type: type, id: id);
      },
    ),

    // Settings
    GoRoute(
      path: '/settings',
      builder: (context, state) => const SettingsPage(),
    ),
  ],
);
