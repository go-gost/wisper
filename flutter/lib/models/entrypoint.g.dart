// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'entrypoint.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Entrypoint _$EntrypointFromJson(Map<String, dynamic> json) => Entrypoint(
  id: json['id'] as String,
  name: json['name'] as String,
  type: json['type'] as String,
  bindAddress: json['endpoint'] as String? ?? '',
  tunnelChain: json['entrypoint'] as String? ?? '',
  status: json['status'] as String? ?? 'stopped',
  favorite: json['favorite'] as bool? ?? false,
  createdAt: json['created_at'] as String? ?? '',
  error: json['error'] as String? ?? '',
  options: json['options'] == null
      ? const EntrypointOptions()
      : EntrypointOptions.fromJson(json['options'] as Map<String, dynamic>),
  stats: json['stats'] == null
      ? const EntrypointStats()
      : EntrypointStats.fromJson(json['stats'] as Map<String, dynamic>),
);

Map<String, dynamic> _$EntrypointToJson(Entrypoint instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'type': instance.type,
      'endpoint': instance.bindAddress,
      'entrypoint': instance.tunnelChain,
      'status': instance.status,
      'favorite': instance.favorite,
      'created_at': instance.createdAt,
      'error': instance.error,
      'options': instance.options,
      'stats': instance.stats,
    };

EntrypointOptions _$EntrypointOptionsFromJson(Map<String, dynamic> json) =>
    EntrypointOptions(
      keepalive: json['keepalive'] as bool? ?? false,
      ttl: (json['ttl'] as num?)?.toInt() ?? 0,
      tunnelID: json['tunnelID'] as String? ?? '',
    );

Map<String, dynamic> _$EntrypointOptionsToJson(EntrypointOptions instance) =>
    <String, dynamic>{
      'keepalive': instance.keepalive,
      'ttl': instance.ttl,
      'tunnelID': instance.tunnelID,
    };

EntrypointStats _$EntrypointStatsFromJson(Map<String, dynamic> json) =>
    EntrypointStats(
      currentConns: (json['current_conns'] as num?)?.toInt() ?? 0,
      totalConns: (json['total_conns'] as num?)?.toInt() ?? 0,
      requestRate: (json['request_rate'] as num?)?.toDouble() ?? 0.0,
      inputBytes: (json['input_bytes'] as num?)?.toInt() ?? 0,
      outputBytes: (json['output_bytes'] as num?)?.toInt() ?? 0,
      inputRateBytes: (json['input_rate_bytes'] as num?)?.toInt() ?? 0,
      outputRateBytes: (json['output_rate_bytes'] as num?)?.toInt() ?? 0,
    );

Map<String, dynamic> _$EntrypointStatsToJson(EntrypointStats instance) =>
    <String, dynamic>{
      'current_conns': instance.currentConns,
      'total_conns': instance.totalConns,
      'request_rate': instance.requestRate,
      'input_bytes': instance.inputBytes,
      'output_bytes': instance.outputBytes,
      'input_rate_bytes': instance.inputRateBytes,
      'output_rate_bytes': instance.outputRateBytes,
    };
