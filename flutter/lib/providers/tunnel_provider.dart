/// Riverpod providers for tunnel state management.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/tunnel.dart';
import '../providers/backend_provider.dart' show backendProvider;

/// Async list of all tunnels.
final tunnelListProvider =
    AsyncNotifierProvider<TunnelListNotifier, List<Tunnel>>(
  TunnelListNotifier.new,
);

/// Notifier that manages the list of tunnels.
class TunnelListNotifier extends AsyncNotifier<List<Tunnel>> {
  @override
  Future<List<Tunnel>> build() async {
    final backend = ref.read(backendProvider);
    return backend.listTunnels();
  }

  /// Refresh the tunnel list from the backend.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final backend = ref.read(backendProvider);
      return backend.listTunnels();
    });
  }

  /// Create a new tunnel and refresh the list.
  Future<Tunnel> create(Map<String, dynamic> body) async {
    final backend = ref.read(backendProvider);
    final tunnel = await backend.createTunnel(body);
    await refresh();
    return tunnel;
  }

  /// Delete a tunnel by ID and refresh the list.
  Future<void> delete(String id) async {
    final backend = ref.read(backendProvider);
    await backend.deleteTunnel(id);
    await refresh();
  }

  /// Start a tunnel by ID and refresh.
  Future<void> start(String id) async {
    final backend = ref.read(backendProvider);
    await backend.startTunnel(id);
    await refresh();
  }

  /// Stop a tunnel by ID and refresh.
  Future<void> stop(String id) async {
    final backend = ref.read(backendProvider);
    await backend.stopTunnel(id);
    await refresh();
  }

  /// Toggle the favorite status of a tunnel.
  Future<void> toggleFavorite(String id, bool current) async {
    final backend = ref.read(backendProvider);
    final tunnels = state.valueOrNull ?? [];
    final tunnel = tunnels.firstWhere((t) => t.id == id);
    await backend.updateTunnel(id, {
      ...tunnel.toJson(),
      'favorite': !current,
    });
    await refresh();
  }
}

/// Provider for a single tunnel by ID.
final tunnelProvider =
    FutureProvider.family<Tunnel, String>((ref, id) async {
  final backend = ref.read(backendProvider);
  return backend.getTunnel(id);
});
