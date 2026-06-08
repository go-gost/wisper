/// Tunnel data model matching the Go backend JSON response.
library;

import 'package:json_annotation/json_annotation.dart';

part 'tunnel.g.dart';

/// A tunnel represents a local-to-remote proxy connection.
@JsonSerializable()
class Tunnel {
  const Tunnel({
    required this.id,
    required this.name,
    required this.type,
    required this.endpoint,
    this.entrypoint = '',
    this.status = 'stopped',
    this.favorite = false,
    this.createdAt = '',
    this.error = '',
    this.options = const TunnelOptions(),
    this.stats = const TunnelStats(),
  });

  final String id;
  final String name;
  final String type;
  final String endpoint;
  final String entrypoint;
  final String status;
  final bool favorite;
  @JsonKey(name: 'created_at')
  final String createdAt;
  final String error;
  final TunnelOptions options;
  final TunnelStats stats;

  factory Tunnel.fromJson(Map<String, dynamic> json) => _$TunnelFromJson(json);
  Map<String, dynamic> toJson() => _$TunnelToJson(this);
}

/// Tunnel configuration options.
@JsonSerializable()
class TunnelOptions {
  const TunnelOptions({
    this.hostname = '',
    this.directory = '',
    this.username = '',
    this.password = '',
    this.basicAuth = false,
    this.enableTLS = false,
    this.rewriteHost = false,
    this.fileUpload = false,
    this.keepalive = false,
    this.ttl = 0,
  });

  final String hostname;
  final String directory;
  final String username;
  final String password;
  @JsonKey(name: 'basic_auth')
  final bool basicAuth;
  final bool enableTLS;
  final bool rewriteHost;
  @JsonKey(name: 'file_upload')
  final bool fileUpload;
  final bool keepalive;
  final int ttl;

  factory TunnelOptions.fromJson(Map<String, dynamic> json) =>
      _$TunnelOptionsFromJson(json);
  Map<String, dynamic> toJson() => _$TunnelOptionsToJson(this);
}

/// Tunnel traffic statistics.
@JsonSerializable()
class TunnelStats {
  const TunnelStats({
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

  factory TunnelStats.fromJson(Map<String, dynamic> json) =>
      _$TunnelStatsFromJson(json);
  Map<String, dynamic> toJson() => _$TunnelStatsToJson(this);
}
