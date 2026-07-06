/**
 * integration.test.js — End-to-end test against the real GOST relay.
 *
 * Flow:
 *   1. Start local HTTP server on random port
 *   2. Connect to wss://wisper.gost.run:443
 *   3. Send relay CmdBind (TunnelFeature + UserAuthFeature + AddrFeature×2)
 *   4. Verify StatusOK, extract public entrypoint
 *   5. Create SmuxServer, feed WebSocket binary messages
 *   6. Make HTTP request to public entrypoint
 *   7. Verify SMUX stream arrives → forward to local server → response back
 *
 * Run: node --test test/integration.test.js
 * Requires: npm install ws
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';

import {
  Version1, CmdBind, StatusOK,
  FeatureUserAuth, FeatureAddr, FeatureTunnel, FeatureNetwork,
  NetworkTCP,
  RelayRequest, relayResponseFromWire, findFeature, encodeAddr,
} from '../lib/relay.js';
import { SmuxServer } from '../lib/smux.js';

// ── Config ───────────────────────────────────────────────────────────────

const RELAY_URL = process.env.WISPER_RELAY_URL || 'wss://wisper.gost.run/ws';
const TEST_TIMEOUT = 30000;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Generate a 20-byte tunnel ID (16 random bytes + 1 flag + 2 rsv + 1 weight) */
function generateTunnelId() {
  const id = new Uint8Array(20);
  for (let i = 0; i < 16; i++) id[i] = Math.floor(Math.random() * 256);
  // byte 16 = flag (0 = public), bytes 17-18 = rsv (0), byte 19 = weight (0)
  return id;
}

/** Start a simple HTTP server on a random port, returns { server, port } */
function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Wisper-Test': 'true',
        });
        res.end(JSON.stringify({
          ok: true,
          method: req.method,
          path: req.url,
          headers: req.headers,
          body: body || null,
          ts: Date.now(),
        }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

/** Connect WebSocket to relay, return ws */
function connectRelay(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'nodebuffer'; // ws package uses 'nodebuffer', not 'arraybuffer'
    const timer = setTimeout(() => reject(new Error('connection timeout')), 10000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Relay handshake', () => {
  it('CmdBind returns StatusOK with public entrypoint', { timeout: TEST_TIMEOUT }, async () => {
    const tunnelId = generateTunnelId();
    const ws = await connectRelay(RELAY_URL);

    // Build CmdBind request
    const req = new RelayRequest(CmdBind);
    req.addFeature(FeatureTunnel, tunnelId);
    req.addFeature(FeatureUserAuth, ['', '']);  // public tunnel
    req.addFeature(FeatureAddr, ['127.0.0.1', 8080]);  // source
    req.addFeature(FeatureAddr, ['0.0.0.0', 8080]);    // dest
    req.addFeature(FeatureNetwork, NetworkTCP);

    // Send and await response
    const resp = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay bind timeout')), 15000);

      ws.on('message', (data) => {
        clearTimeout(timer);
        const buf = new Uint8Array(data);
        resolve(relayResponseFromWire(buf));
      });

      ws.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });

      ws.send(req.encode());
    });

    assert.equal(resp.version, Version1);
    assert.equal(resp.status, StatusOK, `expected StatusOK, got ${resp.status}`);

    // Verify we got an AddrFeature (public entrypoint)
    const addrFeat = findFeature(resp.features, FeatureAddr);
    assert(addrFeat, 'response must contain AddrFeature');
    assert(addrFeat.value.port > 0, 'entrypoint port must be positive');

    // Verify TunnelFeature (connector ID)
    const tunnelFeat = findFeature(resp.features, FeatureTunnel);
    assert(tunnelFeat, 'response must contain TunnelFeature');
    assert.equal(tunnelFeat.value.length, 20, 'connector ID must be 20 bytes');

    ws.close();
  });
});

describe('Pipeline: SMUX → relay response → HTTP → local server', () => {
  let localServer, localPort;

  before(async () => {
    const { server, port } = await startLocalServer();
    localServer = server;
    localPort = port;
  });

  after(() => {
    if (localServer) localServer.close();
  });

  /**
   * Simulates the relay server pushing an inbound HTTP request through a
   * SMUX stream. This is exactly what happens when an external client hits
   * the public tunnel URL:
   *
   *   1. Relay opens a SMUX SYN stream (odd ID = client side)
   *   2. Relay sends a relay Response (peer address info) as first data on stream
   *   3. Relay sends the raw HTTP request bytes
   *   4. We forward to local server, write response back, close stream
   */
  it('handles relay response + HTTP request + forward + response', { timeout: TEST_TIMEOUT }, async () => {
    // ── Build the simulated relay data ──────────────────────────────

    // Relay response in the stream: StatusOK + AddrFeature(peer)
    const peerAddr = encodeAddr('10.0.0.1', 54321);
    const relayRespPayload = new Uint8Array(4 + 3 + peerAddr.length);
    relayRespPayload[0] = Version1;
    relayRespPayload[1] = StatusOK;
    // FEALEN = length of one AddrFeature TLV
    const featLen = 3 + peerAddr.length; // TYPE(1) + LEN(2) + DATA
    new DataView(relayRespPayload.buffer).setUint16(2, featLen, false); // BE
    relayRespPayload[4] = FeatureAddr;
    new DataView(relayRespPayload.buffer).setUint16(5, peerAddr.length, false); // BE
    relayRespPayload.set(peerAddr, 7);

    // HTTP request that the relay forwards
    const httpReq = `POST /api/echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 19\r\n\r\n{"msg":"hello-wsp"}`;
    const httpBytes = new TextEncoder().encode(httpReq);

    // ── Wire up SMUX server ────────────────────────────────────────

    const streamPromise = new Promise(resolve => {
      const smux = new SmuxServer({
        onStream: (stream) => resolve({ smux, stream }),
        onError: (err) => console.error('  SMUX error:', err.message),
      });
      // Capture output frames
      const outFrames = [];
      smux.setOutput((f) => outFrames.push(f));

      // ── Feed a SYN frame (stream ID 1 = client/relay side) ─────

      // Piggyback relay response + HTTP request on SYN data
      const synData = new Uint8Array(relayRespPayload.length + httpBytes.length);
      synData.set(relayRespPayload);
      synData.set(httpBytes, relayRespPayload.length);

      smux.feed(synFrame(1, synData));
    });

    const { smux, stream } = await streamPromise;

    try {
      // ── Step 1: Read relay Response from stream ──────────────────
      // The relay response + HTTP request are piggybacked on the SYN frame.
      // The first read() returns all of it as one chunk.

      let relayBuf = new Uint8Array(0);
      while (relayBuf.length < 4) {
        const chunk = await stream.read();
        assert(chunk, 'stream closed before relay header');
        const merged = new Uint8Array(relayBuf.length + chunk.length);
        merged.set(relayBuf);
        merged.set(chunk, relayBuf.length);
        relayBuf = merged;
      }

      const dv = new DataView(relayBuf.buffer, relayBuf.byteOffset, 4);
      const fl = dv.getUint16(2, false);
      while (relayBuf.length < 4 + fl) {
        const chunk = await stream.read();
        assert(chunk, 'stream closed before relay features');
        const merged = new Uint8Array(relayBuf.length + chunk.length);
        merged.set(relayBuf);
        merged.set(chunk, relayBuf.length);
        relayBuf = merged;
      }

      // Relay response consumed 4 + fl bytes. Remaining bytes are the HTTP request.
      const relayConsumed = 4 + fl;
      const peerResp = relayResponseFromWire(relayBuf.slice(0, relayConsumed));
      assert.equal(peerResp.status, StatusOK);
      const pAddr = findFeature(peerResp.features, FeatureAddr);
      assert(pAddr, 'peer AddrFeature missing');
      assert.equal(pAddr.value.host, '10.0.0.1');
      assert.equal(pAddr.value.port, 54321);

      // ── Step 2: Parse HTTP request from remaining data ─────────────

      let httpBuf = relayBuf.slice(relayConsumed);
      let headerEnd = indexOfSequence(httpBuf, [0x0d, 0x0a, 0x0d, 0x0a]);

      // If headers not yet complete (unlikely with piggyback, but handle it)
      while (headerEnd === -1) {
        const chunk = await stream.read();
        if (!chunk) break;
        const merged = new Uint8Array(httpBuf.length + chunk.length);
        merged.set(httpBuf);
        merged.set(chunk, httpBuf.length);
        httpBuf = merged;
        headerEnd = indexOfSequence(httpBuf, [0x0d, 0x0a, 0x0d, 0x0a]);
      }
      assert(headerEnd >= 0, 'HTTP headers not found');

      const headerStr = new TextDecoder().decode(httpBuf.slice(0, headerEnd));
      let bodyBytes = httpBuf.slice(headerEnd + 4);

      // Parse headers
      const lines = headerStr.split('\r\n');
      const reqLine = lines[0].split(' ');
      const method = reqLine[0];
      const path = reqLine[1];
      const headers = {};
      for (let i = 1; i < lines.length; i++) {
        const ci = lines[i].indexOf(':');
        if (ci === -1) continue;
        headers[lines[i].substring(0, ci).trim().toLowerCase()] = lines[i].substring(ci + 1).trim();
      }

      // Read remaining body per Content-Length if not all buffered
      const cl = parseInt(headers['content-length'], 10);
      if (cl > 0) {
        while (bodyBytes.length < cl) {
          const chunk = await stream.read();
          if (!chunk) break;
          const merged = new Uint8Array(bodyBytes.length + chunk.length);
          merged.set(bodyBytes);
          merged.set(chunk, bodyBytes.length);
          bodyBytes = merged;
        }
      }

      assert.equal(method, 'POST');
      assert.equal(path, '/api/echo');

      // ── Step 3: Forward to local HTTP server ─────────────────────

      const url = `http://127.0.0.1:${localPort}/api/echo`;
      const fetchResp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: bodyBytes,
      });

      assert.equal(fetchResp.status, 200);
      const respJson = await fetchResp.json();
      assert.equal(respJson.ok, true);
      assert.equal(respJson.method, 'POST');
      assert.equal(respJson.body, '{"msg":"hello-wsp"}');
      assert.equal(respJson.path, '/api/echo');

      // ── Step 4: Write HTTP response back through stream ──────────

      const statusLine = `HTTP/1.1 ${fetchResp.status} ${fetchResp.statusText}\r\n`;
      const respBody = new TextEncoder().encode(JSON.stringify(respJson));
      const respHeaders = `Content-Type: application/json\r\nContent-Length: ${respBody.length}\r\n\r\n`;
      const responseHead = new TextEncoder().encode(statusLine + respHeaders);

      await stream.write(responseHead);
      await stream.write(respBody);
      stream.close();

      // Verify output frames include PSH + FIN
      const outFrames = [];
      smux.setOutput((f) => outFrames.push(f)); // reset collector
      // Feed FIN from remote side to clean up
      smux.feed(finFrame(1));

      smux.close();
      console.log(`  ✅ Pipeline verified: relay → SMUX → HTTP → local server → response`);
    } finally {
      smux.close();
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────

function indexOfSequence(arr, seq) {
  outer:
  for (let i = 0; i <= arr.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (arr[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Build a raw SMUX frame (8-byte header, LE integers) */
function makeFrame(ver, cmd, sid, data = new Uint8Array(0)) {
  const len = data.length;
  const buf = new Uint8Array(8 + len);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, ver);
  dv.setUint8(1, cmd);
  dv.setUint16(2, len, true);  // LE
  dv.setUint32(4, sid, true);  // LE
  if (len > 0) buf.set(data, 8);
  return buf;
}

function synFrame(sid, data) { return makeFrame(2, 0, sid, data); }
function finFrame(sid) { return makeFrame(2, 1, sid); }
