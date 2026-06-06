/// Riverpod providers for entrypoint state management.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/entrypoint.dart';
import '../providers/tunnel_provider.dart' show backendProvider;

/// Async list of all entrypoints.
final entrypointListProvider =
    AsyncNotifierProvider<EntrypointListNotifier, List<Entrypoint>>(
  EntrypointListNotifier.new,
);

/// Notifier that manages the list of entrypoints.
class EntrypointListNotifier extends AsyncNotifier<List<Entrypoint>> {
  @override
  Future<List<Entrypoint>> build() async {
    final backend = ref.read(backendProvider);
    return backend.listEntrypoints();
  }

  /// Refresh the entrypoint list from the backend.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final backend = ref.read(backendProvider);
      return backend.listEntrypoints();
    });
  }

  /// Create a new entrypoint and refresh the list.
  Future<Entrypoint> create(Map<String, dynamic> body) async {
    final backend = ref.read(backendProvider);
    final entrypoint = await backend.createEntrypoint(body);
    await refresh();
    return entrypoint;
  }

  /// Delete an entrypoint by ID and refresh the list.
  Future<void> delete(String id) async {
    final backend = ref.read(backendProvider);
    await backend.deleteEntrypoint(id);
    await refresh();
  }

  /// Start an entrypoint by ID and refresh.
  Future<void> start(String id) async {
    final backend = ref.read(backendProvider);
    await backend.startEntrypoint(id);
    await refresh();
  }

  /// Stop an entrypoint by ID and refresh.
  Future<void> stop(String id) async {
    final backend = ref.read(backendProvider);
    await backend.stopEntrypoint(id);
    await refresh();
  }
}

/// Provider for a single entrypoint by ID.
final entrypointProvider =
    FutureProvider.family<Entrypoint, String>((ref, id) async {
  final backend = ref.read(backendProvider);
  return backend.getEntrypoint(id);
});
