/**
 * live-relay.test.js — end-to-end test against the LIVE GOST relay.
 *
 * Exercises the PRODUCTION tunnel code (TunnelConnection + forwarder, the same
 * modules the offscreen document uses) by binding a real tunnel through
 * wss://wisper.gost.run/ws and forwarding to a local HTTP server on :8000,
 * then hitting the public entrypoint as a visitor.
 *
 * Scenarios chosen to exercise the data-flow bug fixes:
 *   - small GET            : baseline
 *   - 200 KB response       : Bug 1 (PSH frame splitting; >64KB would overflow
 *                              uint16 LENGTH and desync the session pre-fix)
 *   - chunked POST body     : Bug 5 (chunked request body decoding)
 *   - multiple Set-Cookie   : Bug 4 (multi-value headers preserved)
 *   - gzip response         : Bug 2 (Content-Encoding/Length stripped, body
 *                              already decompressed by fetch)
 *
 * Run: node --test test/live-relay.test.js   (needs: npm i ws)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import https from 'node:https';
import { WebSocket as WsRaw } from 'ws';

import { TunnelConnection } from '../lib/tunnel-connection.js';
import { handleRequest } from '../lib/forwarder.js';
import { uuidToTunnelIdBytes, entrypointFromUuid } from '../lib/tunnel-id.js';

const RELAY_URL = process.env.WISPER_RELAY_URL || 'wss://wisper.gost.run/ws';
const LOCAL_PORT = 8000;
const LOCAL_ENDPOINT = `localhost:${LOCAL_PORT}`;
const DOMAIN = 'gost.run';
const TEST_TIMEOUT = 60000;

// ── Browser-WebSocket adapter over Node's `ws` ─────────────────────────
//
// TunnelConnection uses the browser WebSocket API surface (onopen/onmessage/
// onclose/onerror properties, binaryType='arraybuffer', readyState, send,
// close, and the WebSocket.OPEN constant). Node's `ws` is an EventEmitter.
// This adapter bridges them so we exercise the PRODUCTION TunnelConnection
// code unchanged.
class BrowserWebSocketAdapter {
  constructor(url) {
    this._ws = new WsRaw(url);
    this.binaryType = 'arraybuffer';
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._ws.on('open', () => this.onopen && this.onopen());
    this._ws.on('error', (e) => this.onerror && this.onerror(e));
    this._ws.on('close', (code, reason) => {
      // Node ws fires (code, reason) directly, not a CloseEvent object.
      // The browser adapter must provide the browser API surface so
      // TunnelConnection's `this._ws.onclose = (e) => e.code` works.
      this.onclose && this.onclose({ code: code || 0, reason: reason || '' });
    });
    this._ws.on('message', (data, isBinary) => {
      // TunnelConnection does `new Uint8Array(event.data)`. In the browser,
      // binaryType='arraybuffer' makes event.data an ArrayBuffer. Provide
      // an ArrayBuffer view so `new Uint8Array(event.data)` works identically.
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this.onmessage && this.onmessage({ data: ab });
    });
  }
  get readyState() { return this._ws.readyState; }
  get OPEN() { return WsRaw.OPEN; }
  send(data) {
    // TunnelConnection sends ArrayBuffers/Uint8Arrays; `ws` accepts Buffer.
    if (data instanceof ArrayBuffer) data = Buffer.from(data);
    else if (ArrayBuffer.isView(data)) data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    this._ws.send(data);
  }
  close() { this._ws.close(); }
}
BrowserWebSocketAdapter.OPEN = WsRaw.OPEN;
BrowserWebSocketAdapter.CLOSED = WsRaw.CLOSED;
globalThis.WebSocket = BrowserWebSocketAdapter;

// ── Local backend on :8000 ─────────────────────────────────────────────

let localServer;
const served = {}; // record what the backend received, for assertions

function startLocalServer() {
  return new Promise((resolve, reject) => {
    localServer = http.createServer((req, res) => {
      let body = Buffer.alloc(0);
      req.on('data', (c) => body = Buffer.concat([body, c]));
      req.on('end', () => {
        served.last = { method: req.method, url: req.url, headers: req.headers, body };
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, msg: 'hello from :8000' }));
        } else if (req.url === '/large') {
          // 200 KB body — exceeds the 64KB uint16 LENGTH that broke pre-fix.
          const payload = Buffer.alloc(200000, 0x41); // 'AAAA...'
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'Content-Length': payload.length,
            'X-Wisper-Large': 'true',
          });
          res.end(payload);
        } else if (req.url === '/echo' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            receivedLen: body.length,
            receivedBody: body.toString('utf8'),
          }));
        } else if (req.url === '/cookies') {
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'Set-Cookie': ['a=1; Path=/', 'b=2; Expires=Wed, 09 Jun 2031 10:18:14 GMT'],
          });
          res.end('two cookies');
        } else if (req.url === '/gzip') {
          const plain = Buffer.from('compressed-body-repeated-'.repeat(50));
          const gz = zlib.gzipSync(plain);
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'Content-Encoding': 'gzip',
            'Content-Length': gz.length,
          });
          res.end(gz);
        } else {
          res.writeHead(404);
          res.end('not found');
        }
      });
    });
    localServer.listen(LOCAL_PORT, '127.0.0.1', () => resolve());
    localServer.on('error', reject);
  });
}

// ── Visitor HTTP client (hits the public entrypoint over TLS) ──────────

function visitorGet(url) {
  return visitorRequest(url, 'GET');
}
function visitorRequest(url, method, { headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: 443,
      headers: headers || {},
      // The relay's entrypoint serves a wildcard cert for *.gost.run.
      servername: u.hostname,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('visitor timeout')));
    if (body) req.write(body);
    req.end();
  });
}

// ── Harness: bind one tunnel, reuse across scenarios ───────────────────

let conn, entrypoint, tunnelUuid;

async function bindTunnel() {
  tunnelUuid = crypto.randomUUID();
  const tunnelId = uuidToTunnelIdBytes(tunnelUuid);
  entrypoint = entrypointFromUuid(tunnelUuid, DOMAIN); // https://<md5>.gost.run

  conn = new TunnelConnection({
    tunnelId,
    localEndpoint: LOCAL_ENDPOINT,
    auth: {},
    relayUrl: RELAY_URL,
    entrypointUrl: entrypoint,
    onStream: ({ stream, request }) => handleRequest(stream, request, { localEndpoint: LOCAL_ENDPOINT }),
  });

  await conn.connect();
  return conn;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Live relay: wss://wisper.gost.run/ws → localhost:8000', { timeout: TEST_TIMEOUT, concurrency: false }, () => {
  before(async () => {
    await startLocalServer();
    await bindTunnel();
    console.log(`  tunnel bound: ${entrypoint}`);
    // Let the relay propagate the ingress rule before visitors arrive.
    // 1 s is borderline; 3 s gives Cloudflare + the relay mux pool time to
    // settle so the very first stream doesn't hit a cold routing table.
    await new Promise(r => setTimeout(r, 3000));
  });

  after(() => {
    try { conn && conn.close(); } catch { /* */ }
    try { localServer && localServer.close(); } catch { /* */ }
  });

  it('bind succeeded and entrypoint is reachable (baseline GET)', async () => {
    const r = await visitorGet(`${entrypoint}/`);
    assert.equal(r.status, 200);
    const json = JSON.parse(r.body.toString());
    assert.equal(json.ok, true);
    assert.equal(json.msg, 'hello from :8000');
  });

  it('200 KB response survives frame splitting (Bug 1)', async () => {
    const r = await visitorGet(`${entrypoint}/large`);
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 200000, 'body must be the full 200KB');
    // Verify byte integrity end to end.
    const expected = Buffer.alloc(200000, 0x41);
    assert.deepEqual(r.body, expected, '200KB body must match byte-for-byte');
  });

  it('forwards a chunked POST body (Bug 5)', async () => {
    // Send the request body with Transfer-Encoding: chunked from the visitor.
    // The relay re-serializes via Go http transport; what reaches the tunnel
    // stream is a chunked body, which the extension must decode before fetch().
    const body = 'chunked-body-payload-' + 'X'.repeat(500);
    const r = await visitorRequest(`${entrypoint}/echo`, 'POST', {
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    assert.equal(r.status, 200);
    const json = JSON.parse(r.body.toString());
    assert.equal(json.ok, true);
    assert.equal(json.receivedBody, body, 'backend must receive the decoded body');
  });

  it('preserves multiple Set-Cookie headers (Bug 4)', async () => {
    const r = await visitorGet(`${entrypoint}/cookies`);
    assert.equal(r.status, 200);
    // Node's http response collapses Set-Cookie into an array under headers.
    const setCookies = r.headers['set-cookie'];
    assert.ok(Array.isArray(setCookies) && setCookies.length === 2, `expected 2 Set-Cookie, got ${JSON.stringify(setCookies)}`);
    assert.ok(setCookies.some(c => c.startsWith('a=1')));
    assert.ok(setCookies.some(c => c.startsWith('b=2')));
  });

  it('strips Content-Encoding and serves decompressed body (Bug 2)', async () => {
    const r = await visitorGet(`${entrypoint}/gzip`);
    assert.equal(r.status, 200);
    // The extension's fetch() decompressed the gzip; it must NOT forward
    // Content-Encoding: gzip (which would make the visitor try to decompress
    // already-plain bytes) nor the stale compressed Content-Length.
    assert.equal(r.headers['content-encoding'], undefined, 'Content-Encoding must be stripped');
    const expected = 'compressed-body-repeated-'.repeat(50);
    assert.equal(r.body.toString('utf8'), expected, 'visitor must receive the decompressed body');
  });
});
