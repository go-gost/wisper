/// Aggregated stats snapshot returned by GET /api/stats.
library;

import 'package:json_annotation/json_annotation.dart';

import 'tunnel.dart';
import 'entrypoint.dart';

part 'tunnel_stats.g.dart';

/// The full stats response from the Go backend.
///
/// Go returns arrays of full tunnel/entrypoint objects (with embedded stats).
@JsonSerializable()
class StatsSnapshot {
  const StatsSnapshot({
    this.tunnels = const [],
    this.entrypoints = const [],
  });

  /// Full tunnel objects (stats are embedded inside each).
  final List<Tunnel> tunnels;

  /// Full entrypoint objects (stats are embedded inside each).
  final List<Entrypoint> entrypoints;

  factory StatsSnapshot.fromJson(Map<String, dynamic> json) =>
      _$StatsSnapshotFromJson(json);
  Map<String, dynamic> toJson() => _$StatsSnapshotToJson(this);
}
