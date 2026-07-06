/**
 * relay.test.js — Unit tests for relay protocol encoder/decoder.
 *
 * Run: node --test test/relay.test.js (Node 22+)
 *      node test/relay.test.js       (Node 18+, using node:test)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  // Constants
  Version1, CmdBind, CmdConnect, CmdAssociate, FUDP,
  StatusOK, StatusUnauthorized,
  FeatureUserAuth, FeatureAddr, FeatureTunnel, FeatureNetwork,
  AddrIPv4, AddrDomain, AddrIPv6,
  NetworkTCP, NetworkUDP,
  // Encoders/decoders
  encodeUserAuth, decodeUserAuth,
  encodeAddr, decodeAddr,
  encodeTunnel, decodeTunnel,
  encodeNetwork, decodeNetwork,
  // Request/Response
  RelayRequest, relayResponseFromWire, findFeature,
} from '../lib/relay.js';

// ── UserAuth ───────────────────────────────────────────────────────────

describe('UserAuthFeature', () => {
  it('round-trip encode/decode with username and password', () => {
    const encoded = encodeUserAuth('bob', 'secret');
    const decoded = decodeUserAuth(encoded);
    assert.equal(decoded.username, 'bob');
    assert.equal(decoded.password, 'secret');
  });

  it('round-trip with empty username', () => {
    const encoded = encodeUserAuth('', 'pass');
    const decoded = decodeUserAuth(encoded);
    assert.equal(decoded.username, '');
    assert.equal(decoded.password, 'pass');
  });

  it('round-trip with empty password', () => {
    const encoded = encodeUserAuth('user', '');
    const decoded = decodeUserAuth(encoded);
    assert.equal(decoded.username, 'user');
    assert.equal(decoded.password, '');
  });

  it('round-trip with both empty', () => {
    const encoded = encodeUserAuth('', '');
    const decoded = decodeUserAuth(encoded);
    assert.equal(decoded.username, '');
    assert.equal(decoded.password, '');
  });

  it('0-length username stored as 0', () => {
    const encoded = encodeUserAuth('', 'pass');
    assert.equal(encoded[0], 0, 'ULEN should be 0');
  });
});

// ── AddrFeature ────────────────────────────────────────────────────────

describe('AddrFeature', () => {
  it('round-trip IPv4 address', () => {
    const encoded = encodeAddr('192.168.1.1', 8080);
    const decoded = decodeAddr(encoded);
    assert.equal(decoded.host, '192.168.1.1');
    assert.equal(decoded.port, 8080);
    assert.equal(decoded.aType, AddrIPv4);
  });

  it('round-trip domain name', () => {
    const encoded = encodeAddr('example.com', 443);
    const decoded = decodeAddr(encoded);
    assert.equal(decoded.host, 'example.com');
    assert.equal(decoded.port, 443);
    assert.equal(decoded.aType, AddrDomain);
  });

  it('round-trip IPv6 address', () => {
    const encoded = encodeAddr('::1', 3000);
    const decoded = decodeAddr(encoded);
    assert.equal(decoded.host, '0:0:0:0:0:0:0:1');
    assert.equal(decoded.port, 3000);
    assert.equal(decoded.aType, AddrIPv6);
  });

  it('IPv4 has correct wire length (7 bytes data)', () => {
    const encoded = encodeAddr('127.0.0.1', 80);
    // ATYP(1) + IP(4) + PORT(2) = 7
    assert.equal(encoded.length, 7);
    assert.equal(encoded[0], AddrIPv4);
  });

  it('domain has correct wire format', () => {
    const encoded = encodeAddr('ab', 9999);
    // ATYP(1) + LEN(1) + 2 bytes + PORT(2) = 6
    assert.equal(encoded.length, 6);
    assert.equal(encoded[0], AddrDomain);
    assert.equal(encoded[1], 2); // domain length
  });
});

// ── TunnelFeature ──────────────────────────────────────────────────────

describe('TunnelFeature', () => {
  it('round-trip 20-byte ID', () => {
    const id = new Uint8Array(20);
    id[0] = 0xde; id[19] = 0xad;
    const encoded = encodeTunnel(id);
    assert.equal(encoded.length, 20);
    const decoded = decodeTunnel(encoded);
    assert.equal(decoded[0], 0xde);
    assert.equal(decoded[19], 0xad);
    assert.equal(decoded.length, 20);
  });
});

// ── NetworkFeature ─────────────────────────────────────────────────────

describe('NetworkFeature', () => {
  it('round-trip TCP', () => {
    const encoded = encodeNetwork(NetworkTCP);
    assert.equal(encoded.length, 2);
    const decoded = decodeNetwork(encoded);
    assert.equal(decoded, NetworkTCP);
  });

  it('round-trip UDP', () => {
    const encoded = encodeNetwork(NetworkUDP);
    const decoded = decodeNetwork(encoded);
    assert.equal(decoded, NetworkUDP);
  });

  it('TCP is 0x0000', () => {
    const encoded = encodeNetwork(NetworkTCP);
    assert.equal(encoded[0], 0x00);
    assert.equal(encoded[1], 0x00);
  });

  it('UDP is 0x0001', () => {
    const encoded = encodeNetwork(NetworkUDP);
    assert.equal(encoded[0], 0x00);
    assert.equal(encoded[1], 0x01);
  });
});

// ── RelayRequest ───────────────────────────────────────────────────────

describe('RelayRequest', () => {
  it('encode CmdBind with features', () => {
    const tunnelId = new Uint8Array(20);
    tunnelId[0] = 0xaa;

    const req = new RelayRequest(CmdBind);
    req.addFeature(FeatureTunnel, tunnelId);
    req.addFeature(FeatureAddr, ['localhost', 8080]);
    req.addFeature(FeatureNetwork, NetworkTCP);

    const encoded = req.encode();

    // 4-byte header
    assert.equal(encoded[0], Version1);
    assert.equal(encoded[1], CmdBind);

    // Total features length encoded correctly (BE)
    const dv = new DataView(encoded.buffer);
    const flen = dv.getUint16(2, false);
    assert.equal(flen, encoded.length - 4);
  });

  it('empty features produces 4-byte frame', () => {
    const req = new RelayRequest(CmdConnect);
    const encoded = req.encode();
    assert.equal(encoded.length, 4);
    assert.equal(encoded[0], Version1);
    assert.equal(encoded[1], CmdConnect);
    // FEALEN = 0
    assert.equal(encoded[2], 0);
    assert.equal(encoded[3], 0);
  });
});

// ── RelayResponse ──────────────────────────────────────────────────────

describe('RelayResponse', () => {
  it('decode StatusOK with AddrFeature and TunnelFeature', () => {
    // Build a response manually: StatusOK + AddrFeature(localhost:8080) + TunnelFeature(20 bytes)
    const addrData = encodeAddr('localhost', 8080);
    const tunnelId = new Uint8Array(20);
    tunnelId[0] = 0xbb;

    // Build feature payload
    const featBuf = [];
    // AddrFeature TLV
    featBuf.push(FeatureAddr);
    featBuf.push(0x00, addrData.length); // BE length
    for (const b of addrData) featBuf.push(b);
    // TunnelFeature TLV
    featBuf.push(FeatureTunnel);
    featBuf.push(0x00, 20); // BE length
    for (const b of tunnelId) featBuf.push(b);

    const totalFeatLen = featBuf.length;

    // Build full response
    const header = new Uint8Array(4);
    header[0] = Version1;
    header[1] = StatusOK;
    header[2] = (totalFeatLen >> 8) & 0xff;
    header[3] = totalFeatLen & 0xff;

    const encoded = new Uint8Array([...header, ...featBuf]);
    const resp = relayResponseFromWire(encoded);

    assert.equal(resp.version, Version1);
    assert.equal(resp.status, StatusOK);
    assert.equal(resp.features.length, 2);

    const addrFeat = findFeature(resp.features, FeatureAddr);
    assert(addrFeat, 'AddrFeature not found');
    assert.equal(addrFeat.value.host, 'localhost');
    assert.equal(addrFeat.value.port, 8080);

    const tunnelFeat = findFeature(resp.features, FeatureTunnel);
    assert(tunnelFeat, 'TunnelFeature not found');
    assert.equal(tunnelFeat.value[0], 0xbb);
  });

  it('decode unauthorized response', () => {
    const buf = new Uint8Array(4);
    buf[0] = Version1;
    buf[1] = StatusUnauthorized;
    buf[2] = 0;
    buf[3] = 0;

    const resp = relayResponseFromWire(buf);
    assert.equal(resp.status, StatusUnauthorized);
    assert.equal(resp.features.length, 0);
  });

  it('rejects bad version', () => {
    const buf = new Uint8Array(4);
    buf[0] = 0x02; // bad version
    buf[1] = StatusOK;
    buf[2] = 0;
    buf[3] = 0;

    assert.throws(() => relayResponseFromWire(buf), /bad version/);
  });
});

// ── CmdBind round-trip (integration-style) ─────────────────────────────

describe('CmdBind round-trip', () => {
  it('full bind request encodes without error', () => {
    const tunnelId = new Uint8Array(20);
    for (let i = 0; i < 16; i++) tunnelId[i] = i; // pseudo-UUID

    const req = new RelayRequest(CmdBind);
    req.addFeature(FeatureTunnel, tunnelId);
    req.addFeature(FeatureUserAuth, ['alice', 'pw123']);
    req.addFeature(FeatureAddr, ['0.0.0.0', 8080]);  // src
    req.addFeature(FeatureAddr, ['0.0.0.0', 8080]);  // dst
    req.addFeature(FeatureNetwork, NetworkTCP);

    const encoded = req.encode();

    // Header checks
    assert.equal(encoded[0], Version1);
    assert.equal(encoded[1], CmdBind);

    // Total length should be > 4 (has features)
    assert(encoded.length > 4);

    // Should not throw
    const dv = new DataView(encoded.buffer);
    const flen = dv.getUint16(2, false);
    assert(flen > 0);
    assert.equal(4 + flen, encoded.length);
  });
});
