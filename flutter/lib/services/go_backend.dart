/// HTTP client for communicating with the Wisper Go backend.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/tunnel.dart';
import '../models/entrypoint.dart';
import '../models/tunnel_stats.dart';

/// HTTP client for the Wisper Go backend API.
class GoBackend {
  GoBackend({String host = 'localhost', int port = 18080})
      : _base = 'http://$host:$port';

  final String _base;

  // ---------------------------------------------------------------------------
  // Tunnels
  // ---------------------------------------------------------------------------

  /// List all tunnels.
  Future<List<Tunnel>> listTunnels() async {
    final resp = await _get('/api/tunnels');
    return (jsonDecode(resp) as List)
        .map((e) => Tunnel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Get a single tunnel by ID.
  Future<Tunnel> getTunnel(String id) async {
    final resp = await _get('/api/tunnels/$id');
    return Tunnel.fromJson(jsonDecode(resp) as Map<String, dynamic>);
  }

  /// Create a new tunnel.
  Future<Tunnel> createTunnel(Map<String, dynamic> body) async {
    final resp = await _post('/api/tunnels', body);
    return Tunnel.fromJson(jsonDecode(resp) as Map<String, dynamic>);
  }

  /// Update an existing tunnel.
  Future<Tunnel> updateTunnel(String id, Map<String, dynamic> body) async {
    final resp = await _put('/api/tunnels/$id', body);
    return Tunnel.fromJson(jsonDecode(resp) as Map<String, dynamic>);
  }

  /// Delete a tunnel.
  Future<void> deleteTunnel(String id) async {
    await _delete('/api/tunnels/$id');
  }

  /// Start a tunnel.
  Future<void> startTunnel(String id) async {
    await _post('/api/tunnels/$id/start', null);
  }

  /// Stop a tunnel.
  Future<void> stopTunnel(String id) async {
    await _post('/api/tunnels/$id/stop', null);
  }

  // ---------------------------------------------------------------------------
  // Entrypoints
  // ---------------------------------------------------------------------------

  /// List all entrypoints.
  Future<List<Entrypoint>> listEntrypoints() async {
    final resp = await _get('/api/entrypoints');
    return (jsonDecode(resp) as List)
        .map((e) => Entrypoint.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Get a single entrypoint by ID.
  Future<Entrypoint> getEntrypoint(String id) async {
    final resp = await _get('/api/entrypoints/$id');
    return Entrypoint.fromJson(jsonDecode(resp) as Map<String, dynamic>);
  }

  /// Create a new entrypoint.
  Future<Entrypoint> createEntrypoint(Map<String, dynamic> body) async {
    final resp = await _post('/api/entrypoints', body);
    return Entrypoint.fromJson(jsonDecode(resp) as Map<String, dynamic>);
  }

  /// Update an existing entrypoint.
  Future<Entrypoint> updateEntrypoint(
      String id, Map<String, dynamic> body) async {
    final resp = await _put('/api/entrypoints/$id', body);
    return Entrypoint.fromJson(jsonDecode(resp) as Map<String, dynamic>);
  }

  /// Delete an entrypoint.
  Future<void> deleteEntrypoint(String id) async {
    await _delete('/api/entrypoints/$id');
  }

  /// Start an entrypoint.
  Future<void> startEntrypoint(String id) async {
    await _post('/api/entrypoints/$id/start', null);
  }

  /// Stop an entrypoint.
  Future<void> stopEntrypoint(String id) async {
    await _post('/api/entrypoints/$id/stop', null);
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  /// Get aggregated stats for all tunnels and entrypoints.
  Future<StatsSnapshot> getStats() async {
    final resp = await _get('/api/stats');
    return StatsSnapshot.fromJson(jsonDecode(resp) as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  /// Read the current backend configuration.
  Future<Map<String, dynamic>> getConfig() async {
    final resp = await _get('/api/config');
    return jsonDecode(resp) as Map<String, dynamic>;
  }

  /// Update the backend configuration.
  Future<void> updateConfig(Map<String, dynamic> config) async {
    await _put('/api/config', config);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  Future<String> _get(String path) async {
    final resp = await http.get(Uri.parse('$_base$path'));
    _check(resp);
    return resp.body;
  }

  Future<String> _post(String path, Map<String, dynamic>? body) async {
    final resp = await http.post(
      Uri.parse('$_base$path'),
      headers: {'Content-Type': 'application/json'},
      body: body != null ? jsonEncode(body) : '',
    );
    _check(resp);
    return resp.body;
  }

  Future<String> _put(String path, Map<String, dynamic> body) async {
    final resp = await http.put(
      Uri.parse('$_base$path'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    _check(resp);
    return resp.body;
  }

  Future<void> _delete(String path) async {
    final resp = await http.delete(Uri.parse('$_base$path'));
    _check(resp);
  }

  void _check(http.Response resp) {
    if (resp.statusCode >= 400) {
      throw BackendException(resp.statusCode, resp.body);
    }
  }
}

/// Exception thrown when the backend returns a non-2xx status.
class BackendException implements Exception {
  const BackendException(this.statusCode, this.body);
  final int statusCode;
  final String body;

  @override
  String toString() => 'BackendException($statusCode): $body';
}
