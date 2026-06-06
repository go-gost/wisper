// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tunnel_stats.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StatsSnapshot _$StatsSnapshotFromJson(Map<String, dynamic> json) =>
    StatsSnapshot(
      tunnels:
          (json['tunnels'] as List<dynamic>?)
              ?.map((e) => Tunnel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      entrypoints:
          (json['entrypoints'] as List<dynamic>?)
              ?.map((e) => Entrypoint.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );

Map<String, dynamic> _$StatsSnapshotToJson(StatsSnapshot instance) =>
    <String, dynamic>{
      'tunnels': instance.tunnels,
      'entrypoints': instance.entrypoints,
    };
