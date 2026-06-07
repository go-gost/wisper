import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:wisper/models/tunnel.dart';
import 'package:wisper/models/entrypoint.dart';
import 'package:wisper/models/tunnel_stats.dart';

void main() {
  // ---------------------------------------------------------------------------
  // Tunnel model
  // ---------------------------------------------------------------------------

  test('Tunnel.fromJson parses full Go backend response', () {
    final json = jsonDecode('''
    {
      "id": "abc-123",
      "name": "My Tunnel",
      "type": "file",
      "endpoint": "/tmp/share",
      "entrypoint": "https://abc123.gost.plus",
      "status": "running",
      "favorite": true,
      "created_at": "2026-01-15T10:30:00Z",
      "error": "",
      "options": {
        "hostname": "example.com",
        "username": "admin",
        "password": "secret",
        "basic_auth": true,
        "enableTLS": true,
        "rewriteHost": true
      },
      "stats": {
        "current_conns": 5,
        "total_conns": 120,
        "request_rate": 5.2,
        "input_bytes": 1536,
        "output_bytes": 3200,
        "input_rate_bytes": 800,
        "output_rate_bytes": 1200
      }
    }
    ''') as Map<String, dynamic>;

    final tunnel = Tunnel.fromJson(json);

    expect(tunnel.id, 'abc-123');
    expect(tunnel.name, 'My Tunnel');
    expect(tunnel.type, 'file');
    expect(tunnel.endpoint, '/tmp/share');
    expect(tunnel.entrypoint, 'https://abc123.gost.plus');
    expect(tunnel.status, 'running');
    expect(tunnel.favorite, isTrue);
    expect(tunnel.createdAt, '2026-01-15T10:30:00Z');
    expect(tunnel.error, '');

    expect(tunnel.options.hostname, 'example.com');
    expect(tunnel.options.username, 'admin');
    expect(tunnel.options.basicAuth, isTrue);
    expect(tunnel.options.enableTLS, isTrue);
    expect(tunnel.options.rewriteHost, isTrue);

    expect(tunnel.stats.currentConns, 5);
    expect(tunnel.stats.totalConns, 120);
    expect(tunnel.stats.requestRate, 5.2);
    expect(tunnel.stats.inputBytes, 1536);
    expect(tunnel.stats.outputBytes, 3200);
  });

  test('Tunnel roundtrips through JSON', () {
    const tunnel = Tunnel(
      id: 'x',
      name: 'Test',
      type: 'tcp',
      endpoint: 'localhost:8080',
      status: 'stopped',
      favorite: false,
      createdAt: '2026-06-01T00:00:00Z',
      options: TunnelOptions(
        hostname: 'h',
        basicAuth: false,
        enableTLS: false,
      ),
      stats: TunnelStats(currentConns: 1, totalConns: 2, requestRate: 3.0),
    );

    // Encode to string then decode back — this ensures proper map types.
    final jsonString = jsonEncode(tunnel.toJson());
    final roundtrip = Tunnel.fromJson(
      jsonDecode(jsonString) as Map<String, dynamic>,
    );

    expect(roundtrip.id, tunnel.id);
    expect(roundtrip.name, tunnel.name);
    expect(roundtrip.type, tunnel.type);
    expect(roundtrip.stats.currentConns, 1);
    expect(roundtrip.stats.requestRate, 3.0);
  });

  test('Tunnel.fromJson handles minimal JSON', () {
    final json = jsonDecode('''
    {
      "id": "minimal",
      "name": "Min",
      "type": "http",
      "endpoint": ":80"
    }
    ''') as Map<String, dynamic>;

    final tunnel = Tunnel.fromJson(json);

    expect(tunnel.status, 'stopped');
    expect(tunnel.favorite, isFalse);
    expect(tunnel.stats.currentConns, 0);
    expect(tunnel.options.basicAuth, isFalse);
  });

  // ---------------------------------------------------------------------------
  // Entrypoint model
  // ---------------------------------------------------------------------------

  test('Entrypoint.fromJson maps endpoint→bindAddress and entrypoint→tunnelChain', () {
    final json = jsonDecode('''
    {
      "id": "ep-1",
      "name": "My EP",
      "type": "tcp",
      "endpoint": ":9090",
      "entrypoint": "https://abc.gost.plus",
      "status": "running",
      "favorite": false,
      "created_at": "2026-01-01T00:00:00Z",
      "options": { "keepalive": true, "ttl": 30 },
      "stats": {
        "current_conns": 3,
        "total_conns": 50,
        "request_rate": 1.0,
        "input_bytes": 100,
        "output_bytes": 200,
        "input_rate_bytes": 10,
        "output_rate_bytes": 20
      }
    }
    ''') as Map<String, dynamic>;

    final ep = Entrypoint.fromJson(json);

    expect(ep.id, 'ep-1');
    expect(ep.name, 'My EP');
    expect(ep.type, 'tcp');
    expect(ep.bindAddress, ':9090');
    expect(ep.tunnelChain, 'https://abc.gost.plus');
    expect(ep.status, 'running');
    expect(ep.options.keepalive, isTrue);
    expect(ep.options.ttl, 30);
    expect(ep.stats.currentConns, 3);
  });

  test('Entrypoint roundtrips through JSON', () {
    const ep = Entrypoint(
      id: 'e1',
      name: 'EP',
      type: 'udp',
      bindAddress: ':53',
      tunnelChain: 'chain',
    );
    // Encode to string then decode back for proper map types.
    final jsonString = jsonEncode(ep.toJson());
    final roundtrip = Entrypoint.fromJson(
      jsonDecode(jsonString) as Map<String, dynamic>,
    );
    expect(roundtrip.id, ep.id);
    expect(roundtrip.bindAddress, ':53');
    expect(roundtrip.tunnelChain, 'chain');
  });

  // ---------------------------------------------------------------------------
  // StatsSnapshot
  // ---------------------------------------------------------------------------

  test('StatsSnapshot.fromJson parses nested arrays', () {
    final json = jsonDecode('''
    {
      "tunnels": [
        {
          "id": "t1", "name": "T1", "type": "file", "endpoint": "/a",
          "stats": { "current_conns": 1, "total_conns": 10, "request_rate": 0.0,
                     "input_bytes": 0, "output_bytes": 0, "input_rate_bytes": 0,
                     "output_rate_bytes": 0 }
        }
      ],
      "entrypoints": [
        {
          "id": "e1", "name": "E1", "type": "tcp", "endpoint": ":9090",
          "stats": { "current_conns": 0, "total_conns": 0, "request_rate": 0.0,
                     "input_bytes": 0, "output_bytes": 0, "input_rate_bytes": 0,
                     "output_rate_bytes": 0 }
        }
      ]
    }
    ''') as Map<String, dynamic>;

    final snapshot = StatsSnapshot.fromJson(json);

    expect(snapshot.tunnels.length, 1);
    expect(snapshot.tunnels[0].id, 't1');
    expect(snapshot.entrypoints.length, 1);
    expect(snapshot.entrypoints[0].id, 'e1');
  });

  test('StatsSnapshot handles empty arrays', () {
    final json = jsonDecode('{"tunnels": [], "entrypoints": []}')
        as Map<String, dynamic>;
    final snapshot = StatsSnapshot.fromJson(json);
    expect(snapshot.tunnels, isEmpty);
    expect(snapshot.entrypoints, isEmpty);
  });
}
