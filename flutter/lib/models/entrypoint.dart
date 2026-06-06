/// Entrypoint data model matching the Go backend JSON response.
library;

import 'package:json_annotation/json_annotation.dart';

part 'entrypoint.g.dart';

/// An entrypoint exposes a local service through a tunnel to the public network.
@JsonSerializable()
class Entrypoint {
  const Entrypoint({
    required this.id,
    required this.name,
    required this.type,
    this.bindAddress = '',
    this.tunnelChain = '',
    this.status = 'stopped',
    this.favorite = false,
    this.createdAt = '',
    this.error = '',
    this.options = const EntrypointOptions(),
    this.stats = const EntrypointStats(),
  });

  final String id;
  final String name;
  final String type;
  @JsonKey(name: 'endpoint')
  final String bindAddress;
  @JsonKey(name: 'entrypoint')
  final String tunnelChain;
  final String status;
  final bool favorite;
  @JsonKey(name: 'created_at')
  final String createdAt;
  final String error;
  final EntrypointOptions options;
  final EntrypointStats stats;

  factory Entrypoint.fromJson(Map<String, dynamic> json) =>
      _$EntrypointFromJson(json);
  Map<String, dynamic> toJson() => _$EntrypointToJson(this);
}

/// Entrypoint configuration options.
@JsonSerializable()
class EntrypointOptions {
  const EntrypointOptions({
    this.keepalive = false,
    this.ttl = 0,
    this.tunnelID = '',
  });

  final bool keepalive;
  final int ttl;
  final String tunnelID;

  factory EntrypointOptions.fromJson(Map<String, dynamic> json) =>
      _$EntrypointOptionsFromJson(json);
  Map<String, dynamic> toJson() => _$EntrypointOptionsToJson(this);
}

/// Entrypoint traffic statistics (same shape as TunnelStats).
@JsonSerializable()
class EntrypointStats {
  const EntrypointStats({
    this.currentConns = 0,
    this.totalConns = 0,
    this.requestRate = 0.0,
    this.inputBytes = 0,
    this.outputBytes = 0,
    this.inputRateBytes = 0,
    this.outputRateBytes = 0,
  });

  @JsonKey(name: 'current_conns')
  final int currentConns;
  @JsonKey(name: 'total_conns')
  final int totalConns;
  @JsonKey(name: 'request_rate')
  final double requestRate;
  @JsonKey(name: 'input_bytes')
  final int inputBytes;
  @JsonKey(name: 'output_bytes')
  final int outputBytes;
  @JsonKey(name: 'input_rate_bytes')
  final int inputRateBytes;
  @JsonKey(name: 'output_rate_bytes')
  final int outputRateBytes;

  factory EntrypointStats.fromJson(Map<String, dynamic> json) =>
      _$EntrypointStatsFromJson(json);
  Map<String, dynamic> toJson() => _$EntrypointStatsToJson(this);
}
