// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tunnel.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Tunnel _$TunnelFromJson(Map<String, dynamic> json) => Tunnel(
  id: json['id'] as String,
  name: json['name'] as String,
  type: json['type'] as String,
  endpoint: json['endpoint'] as String,
  entrypoint: json['entrypoint'] as String? ?? '',
  status: json['status'] as String? ?? 'stopped',
  favorite: json['favorite'] as bool? ?? false,
  createdAt: json['created_at'] as String? ?? '',
  error: json['error'] as String? ?? '',
  options: json['options'] == null
      ? const TunnelOptions()
      : TunnelOptions.fromJson(json['options'] as Map<String, dynamic>),
  stats: json['stats'] == null
      ? const TunnelStats()
      : TunnelStats.fromJson(json['stats'] as Map<String, dynamic>),
);

Map<String, dynamic> _$TunnelToJson(Tunnel instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'type': instance.type,
  'endpoint': instance.endpoint,
  'entrypoint': instance.entrypoint,
  'status': instance.status,
  'favorite': instance.favorite,
  'created_at': instance.createdAt,
  'error': instance.error,
  'options': instance.options,
  'stats': instance.stats,
};

TunnelOptions _$TunnelOptionsFromJson(Map<String, dynamic> json) =>
    TunnelOptions(
      hostname: json['hostname'] as String? ?? '',
      username: json['username'] as String? ?? '',
      password: json['password'] as String? ?? '',
      basicAuth: json['basic_auth'] as bool? ?? false,
      enableTLS: json['enableTLS'] as bool? ?? false,
      keepalive: json['keepalive'] as bool? ?? false,
      ttl: (json['ttl'] as num?)?.toInt() ?? 0,
    );

Map<String, dynamic> _$TunnelOptionsToJson(TunnelOptions instance) =>
    <String, dynamic>{
      'hostname': instance.hostname,
      'username': instance.username,
      'password': instance.password,
      'basic_auth': instance.basicAuth,
      'enableTLS': instance.enableTLS,
      'keepalive': instance.keepalive,
      'ttl': instance.ttl,
    };

TunnelStats _$TunnelStatsFromJson(Map<String, dynamic> json) => TunnelStats(
  currentConns: (json['current_conns'] as num?)?.toInt() ?? 0,
  totalConns: (json['total_conns'] as num?)?.toInt() ?? 0,
  requestRate: (json['request_rate'] as num?)?.toDouble() ?? 0.0,
  inputBytes: (json['input_bytes'] as num?)?.toInt() ?? 0,
  outputBytes: (json['output_bytes'] as num?)?.toInt() ?? 0,
  inputRateBytes: (json['input_rate_bytes'] as num?)?.toInt() ?? 0,
  outputRateBytes: (json['output_rate_bytes'] as num?)?.toInt() ?? 0,
);

Map<String, dynamic> _$TunnelStatsToJson(TunnelStats instance) =>
    <String, dynamic>{
      'current_conns': instance.currentConns,
      'total_conns': instance.totalConns,
      'request_rate': instance.requestRate,
      'input_bytes': instance.inputBytes,
      'output_bytes': instance.outputBytes,
      'input_rate_bytes': instance.inputRateBytes,
      'output_rate_bytes': instance.outputRateBytes,
    };
