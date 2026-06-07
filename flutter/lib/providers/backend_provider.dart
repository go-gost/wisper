/// Riverpod providers for the Go backend lifecycle.
library;

import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/constants.dart';
import '../services/go_backend.dart';
import '../services/platform_service.dart';

/// Singleton [PlatformService] instance.
final platformServiceProvider = Provider<PlatformService>((ref) {
  final service = PlatformService();
  ref.onDispose(() => service.stop());
  return service;
});

/// Whether the Go backend is ready to accept requests.
final backendReadyProvider = FutureProvider<bool>((ref) async {
  final platform = ref.read(platformServiceProvider);

  if (!Platform.isLinux && !Platform.isMacOS && !Platform.isWindows) {
    // On mobile/web, assume the backend is managed externally.
    return true;
  }

  // Try to start the backend on desktop.
  final started = await platform.start(port: kDefaultBackendPort);
  if (!started) {
    // Backend may already be running externally; check health.
    return platform.isHealthy();
  }
  return true;
});

/// Singleton [GoBackend] instance, dependent on backend readiness.
final backendProvider = Provider<GoBackend>((ref) {
  // Watch the readiness provider so this rebuilds if backend restarts.
  ref.watch(backendReadyProvider);
  return GoBackend(port: kDefaultBackendPort);
});
