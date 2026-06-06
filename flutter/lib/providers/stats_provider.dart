/// Riverpod provider for polling tunnel/entrypoint stats.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/tunnel.dart' show Tunnel;
import '../models/entrypoint.dart' show Entrypoint;
import '../providers/tunnel_provider.dart' show backendProvider;

/// Stats data held per-item.
class ItemStats {
  const ItemStats({
    required this.currentConns,
    required this.totalConns,
    required this.requestRate,
    required this.inputBytes,
    required this.outputBytes,
    required this.inputRateBytes,
    required this.outputRateBytes,
  });

  final int currentConns;
  final int totalConns;
  final double requestRate;
  final int inputBytes;
  final int outputBytes;
  final int inputRateBytes;
  final int outputRateBytes;
}

/// Polled stats map: tunnel/entrypoint ID → stats.
/// Updated every [kStatsPollIntervalMs] (1 second).
final statsProvider =
    StateNotifierProvider<StatsNotifier, AsyncValue<Map<String, ItemStats>>>(
  StatsNotifier.new,
);

/// Notifier that polls the backend for stats at a fixed interval.
///
/// Uses GET /api/stats (single request) instead of fetching full lists.
class StatsNotifier extends StateNotifier<AsyncValue<Map<String, ItemStats>>> {
  StatsNotifier(this.ref) : super(const AsyncData({})) {
    _startPolling();
  }

  final Ref ref;
  Timer? _timer;

  void _startPolling() {
    _timer = Timer.periodic(
      const Duration(milliseconds: 1000),
      (_) => _poll(),
    );
    // Fetch immediately
    _poll();
  }

  Future<void> _poll() async {
    try {
      final backend = ref.read(backendProvider);
      final snapshot = await backend.getStats();

      if (!mounted) return;

      final map = <String, ItemStats>{};
      for (final Tunnel t in snapshot.tunnels) {
        map[t.id] = ItemStats(
          currentConns: t.stats.currentConns,
          totalConns: t.stats.totalConns,
          requestRate: t.stats.requestRate,
          inputBytes: t.stats.inputBytes,
          outputBytes: t.stats.outputBytes,
          inputRateBytes: t.stats.inputRateBytes,
          outputRateBytes: t.stats.outputRateBytes,
        );
      }
      for (final Entrypoint e in snapshot.entrypoints) {
        map[e.id] = ItemStats(
          currentConns: e.stats.currentConns,
          totalConns: e.stats.totalConns,
          requestRate: e.stats.requestRate,
          inputBytes: e.stats.inputBytes,
          outputBytes: e.stats.outputBytes,
          inputRateBytes: e.stats.inputRateBytes,
          outputRateBytes: e.stats.outputRateBytes,
        );
      }

      state = AsyncData(map);
    } catch (e, st) {
      state = AsyncError(e, st);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
