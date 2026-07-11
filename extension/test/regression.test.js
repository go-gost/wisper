/**
 * regression.test.js — tests for the data-flow bug fixes.
 *
 * Covers:
 *   - Bug 1: SMUX PSH frame splitting (no uint16 LENGTH overflow on >64KB)
 *   - Bug 3: WebSocket frame codec (wsAccept, encode/decode, fragmentation)
 *   - Bug 4: multi-value HTTP headers preserved as arrays
 *   - Bug 5: chunked request body decoding
 *
 * Run: node --test test/regression.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SmuxServer } from '../lib/smux.js';
import {
  WsDecoder, encodeWsFrame, wsAccept,
  OP_TEXT, OP_BINARY, OP_CLOSE, OP_PONG, OP_CONT,
} from '../lib/ws-codec.js';
import { parseHTTPRequest, decodeChunkedBodyFromStream } from '../lib/tunnel-connection.js';
import { isAuthorized, handleRequest, forwardHTTP } from '../lib/forwarder.js';

const LE = true;

function makeFrame(ver, cmd, sid, data = new Uint8Array(0)) {
  const buf = new Uint8Array(8 + data.length);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, ver); dv.setUint8(1, cmd);
  dv.setUint16(2, data.length, LE); dv.setUint32(4, sid, LE);
  if (data.length) buf.set(data, 8);
  return buf;
}
const synFrame = (sid, data) => makeFrame(2, 0, sid, data);

function captureOutput(server) {
  const frames = [];
  server.setOutput((f) => frames.push(f));
  return frames;
}

// ── Bug 1: frame splitting ─────────────────────────────────────────────

describe('Bug 1: SMUX PSH frame splitting', () => {
  it('a >64KB write is split into ≤32KB frames, none overflow LENGTH', async () => {
    const N = 200000; // > 65535 → would overflow uint16 LENGTH without splitting
    const big = new Uint8Array(N);
    for (let i = 0; i < N; i++) big[i] = i & 0xff;

    let resolveDone;
    const done = new Promise(r => { resolveDone = r; });

    const server = new SmuxServer({
      onStream: async (stream) => {
        await stream.write(big);
        resolveDone();
      },
    });
    const output = captureOutput(server);
    server.feed(synFrame(1));
    await done;

    const psh = output.filter(f => new DataView(f.buffer, f.byteOffset, f.byteLength).getUint8(1) === 2);
    assert.ok(psh.length > 1, `expected multiple PSH frames, got ${psh.length}`);

    let totalData = 0;
    for (const f of psh) {
      const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
      const len = dv.getUint16(2, LE);
      assert.ok(len <= 32768, `frame LENGTH ${len} exceeds MAX_FRAME_SIZE 32768`);
      // The frame buffer must exactly match its declared LENGTH (the old bug
      // wrote LENGTH = N & 0xFFFF while attaching all N bytes, desyncing the peer).
      assert.equal(f.length, 8 + len, 'frame buffer must match declared LENGTH');
      totalData += len;
    }
    assert.equal(totalData, N, 'reassembled PSH data must equal the original payload');

    // Byte-for-byte reassembly check.
    let off = 0;
    for (const f of psh) {
      const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
      const len = dv.getUint16(2, LE);
      for (let i = 0; i < len; i++) assert.equal(f[8 + i], big[off + i]);
      off += len;
    }
  });

  it('flow control blocks then resumes on cmdUPD', async () => {
    // Peer advertises a tiny window; write must block until a UPD opens it.
    const payload = new Uint8Array(1000);
    payload.fill(0x7e);

    let resolveDone;
    const done = new Promise(r => { resolveDone = r; });

    const server = new SmuxServer({
      onStream: async (stream) => {
        // Give a window of only 100 bytes, then write 1000 → must block.
        // (initial peer window is 262144, so shrink it via a UPD first)
        const upd = makeFrame(2, 4, stream.id, (() => {
          const d = new Uint8Array(8); const dv = new DataView(d.buffer);
          dv.setUint32(0, 0, LE);    // consumed = 0
          dv.setUint32(4, 100, LE);  // window = 100
          return d;
        })());
        server.feed(upd);

        const writePromise = stream.write(payload);
        // Yield so the write blocks at the 100-byte window.
        await Promise.resolve();
        // Open the window fully → write should now complete.
        const upd2 = makeFrame(2, 4, stream.id, (() => {
          const d = new Uint8Array(8); const dv = new DataView(d.buffer);
          dv.setUint32(0, 0, LE);
          dv.setUint32(4, 1048576, LE);
          return d;
        })());
        server.feed(upd2);
        await writePromise;
        resolveDone();
      },
    });
    const output = captureOutput(server);
    server.feed(synFrame(3));
    await done;

    const psh = output.filter(f => new DataView(f.buffer, f.byteOffset, f.byteLength).getUint8(1) === 2);
    let total = 0;
    for (const f of psh) total += new DataView(f.buffer, f.byteOffset, f.byteLength).getUint16(2, LE);
    assert.equal(total, 1000, 'all bytes eventually sent after window opened');
  });
});

// ── Bug 3: WebSocket frame codec ───────────────────────────────────────

describe('Bug 3: WebSocket frame codec', () => {
  it('wsAccept matches the RFC 6455 §4.2.2 example vector', async () => {
    const accept = await wsAccept('dGhlIHNhbXBsZSBub25jZQ==');
    assert.equal(accept, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('round-trips an unmasked text frame (server→visitor)', () => {
    const payload = new TextEncoder().encode('hello');
    const frame = encodeWsFrame(OP_TEXT, payload, false);
    const dec = new WsDecoder();
    dec.push(frame);
    const [ev] = dec.parse();
    assert.equal(ev.type, 'data');
    assert.equal(ev.opcode, OP_TEXT);
    assert.deepEqual(ev.payload, payload);
  });

  it('round-trips a masked binary frame (visitor→server, demasked)', () => {
    const payload = new Uint8Array(256);
    for (let i = 0; i < 256; i++) payload[i] = i;
    const frame = encodeWsFrame(OP_BINARY, payload, true); // masked
    const dec = new WsDecoder();
    dec.push(frame);
    const [ev] = dec.parse();
    assert.equal(ev.type, 'data');
    assert.equal(ev.opcode, OP_BINARY);
    assert.deepEqual(ev.payload, payload);
  });

  it('handles a >125-byte payload (16-bit length)', () => {
    const payload = new Uint8Array(300);
    payload.fill(0x41);
    const frame = encodeWsFrame(OP_BINARY, payload, false);
    const dec = new WsDecoder();
    dec.push(frame);
    const [ev] = dec.parse();
    assert.deepEqual(ev.payload, payload);
  });

  it('reassembles a fragmented message (FIN=0 text + FIN=1 continuation)', () => {
    const part1 = new TextEncoder().encode('hel');
    const part2 = new TextEncoder().encode('lo');
    // FIN=0 text frame
    const f1 = new Uint8Array([0x01, part1.length, ...part1]);
    // FIN=1 continuation frame
    const f2 = new Uint8Array([0x80 | OP_CONT, part2.length, ...part2]);
    const dec = new WsDecoder();
    dec.push(f1);
    assert.equal(dec.parse().length, 0, 'no complete message yet');
    dec.push(f2);
    const [ev] = dec.parse();
    assert.equal(ev.type, 'data');
    assert.equal(ev.opcode, OP_TEXT);
    assert.deepEqual(new TextDecoder().decode(ev.payload), 'hello');
  });

  it('decodes a close frame with status code', () => {
    const payload = new Uint8Array(2);
    new DataView(payload.buffer).setUint16(0, 1000, false); // BE
    const frame = encodeWsFrame(OP_CLOSE, payload, false);
    const dec = new WsDecoder();
    dec.push(frame);
    const [ev] = dec.parse();
    assert.equal(ev.type, 'close');
    assert.equal(new DataView(ev.payload.buffer, ev.payload.byteOffset, 2).getUint16(0, false), 1000);
  });

  it('echoes a ping as a pong via event type', () => {
    const payload = new TextEncoder().encode('ping!');
    const frame = encodeWsFrame(0x9, payload, false); // 0x9 = OP_PING
    const dec = new WsDecoder();
    dec.push(frame);
    const [ev] = dec.parse();
    assert.equal(ev.type, 'ping');
    assert.deepEqual(ev.payload, payload);
  });

  it('handles partial frames across pushes', () => {
    const payload = new TextEncoder().encode('split-me');
    const frame = encodeWsFrame(OP_TEXT, payload, false);
    const dec = new WsDecoder();
    dec.push(frame.subarray(0, 3));
    assert.equal(dec.parse().length, 0);
    dec.push(frame.subarray(3));
    const [ev] = dec.parse();
    assert.equal(ev.type, 'data');
    assert.deepEqual(ev.payload, payload);
  });
});

// ── Bug 4: multi-value headers ─────────────────────────────────────────

describe('Bug 4: multi-value HTTP headers', () => {
  it('preserves duplicate Set-Cookie as an array', () => {
    const raw = [
      'GET / HTTP/1.1',
      'Host: example.com',
      'Set-Cookie: a=1',
      'Set-Cookie: b=2; Expires=Wed, 09 Jun 2021 10:18:14 GMT',
      '',
      '',
    ].join('\r\n');
    const { method, path, headers } = parseHTTPRequest(raw);
    assert.equal(method, 'GET');
    assert.equal(path, '/');
    assert.deepEqual(headers['set-cookie'], ['a=1', 'b=2; Expires=Wed, 09 Jun 2021 10:18:14 GMT']);
    assert.deepEqual(headers['host'], ['example.com']);
  });
});

// ── Bug 5: chunked request body ────────────────────────────────────────

describe('Bug 5: chunked request body decoding', () => {
  it('decodes a simple chunked body', async () => {
    const chunked = new TextEncoder().encode('5\r\nHello\r\n0\r\n\r\n');
    const stream = { async read() { return null; } };
    const body = await decodeChunkedBodyFromStream(stream, chunked);
    assert.deepEqual(body, new TextEncoder().encode('Hello'));
  });

  it('decodes multiple chunks and ignores chunk extensions', async () => {
    const chunked = new TextEncoder().encode('5;name=value\r\nHello\r\n6\r\n World\r\n0\r\n\r\n');
    const stream = { async read() { return null; } };
    const body = await decodeChunkedBodyFromStream(stream, chunked);
    assert.deepEqual(body, new TextEncoder().encode('Hello World'));
  });

  it('reads across stream.read() boundaries', async () => {
    const parts = [
      new TextEncoder().encode('5\r\nHel'),
      new TextEncoder().encode('lo\r\n0\r\n\r\n'),
    ];
    const stream = { async read() { return parts.shift() ?? null; } };
    const body = await decodeChunkedBodyFromStream(stream, new Uint8Array(0));
    assert.deepEqual(body, new TextEncoder().encode('Hello'));
  });
});

// ── HTTP basic auth (public-endpoint guard) ────────────────────────────

const b64 = (s) => Buffer.from(s).toString('base64');
const authHeader = (v) => ({ authorization: [v] });

describe('HTTP basic auth: isAuthorized', () => {
  const auth = { username: 'admin', password: 'p:ss' }; // password with a colon

  it('open when no auth configured', () => {
    assert.equal(isAuthorized({}, undefined), true);
    assert.equal(isAuthorized({}, { username: '' }), true);
  });

  it('rejects when credentials are missing', () => {
    assert.equal(isAuthorized({}, auth), false);
  });

  it('accepts exact credentials', () => {
    assert.equal(isAuthorized(authHeader('Basic ' + b64('admin:p:ss')), auth), true);
  });

  it('splits username:password on the first colon', () => {
    // password "p:ss" must survive — only the first colon delimits.
    assert.equal(isAuthorized(authHeader('Basic ' + b64('admin:wrong')), auth), false);
  });

  it('scheme match is case-insensitive', () => {
    assert.equal(isAuthorized(authHeader('basic ' + b64('admin:p:ss')), auth), true);
  });

  it('rejects malformed base64 token', () => {
    assert.equal(isAuthorized(authHeader('Basic @@@@'), auth), false);
  });

  it('rejects non-Basic scheme', () => {
    assert.equal(isAuthorized(authHeader('Bearer ' + b64('admin:p:ss')), auth), false);
  });

  it('supports an empty configured password', () => {
    assert.equal(isAuthorized(authHeader('Basic ' + b64('u:')), { username: 'u', password: '' }), true);
  });
});

describe('HTTP basic auth: handleRequest 401', () => {
  function mockStream() {
    const writes = [];
    return {
      writes,
      closed: false,
      async write(b) { writes.push(b); },
      close() { this.closed = true; },
      text() { return Buffer.concat(writes.map(Buffer.from)).toString('utf8'); },
    };
  }

  it('writes 401 + WWW-Authenticate and does not forward on missing creds', async () => {
    const stream = mockStream();
    const req = { method: 'GET', path: '/', headers: {}, body: null };
    // localEndpoint points nowhere; if we forwarded, fetch would run. The 401
    // short-circuit must fire first, so no fetch and a clean close.
    await handleRequest(stream, req, { localEndpoint: '127.0.0.1:1', auth: { username: 'admin', password: 'x' } });
    const out = stream.text();
    assert.match(out, /^HTTP\/1\.1 401 Unauthorized\r\n/);
    assert.match(out, /WWW-Authenticate: Basic\r\n/);
    assert.equal(stream.closed, true);
  });
});

// ── Host rewrite: fetch FROM the hostname (Bug: all paths returned homepage) ─
//
// Root cause recap: fetch() forbids setting Host, and DNR treats Host as a
// protected header it won't override, so every DNR rewrite attempt silently
// failed — the backend's default vhost (SPA `try_files $uri /index.html`)
// then served index.html for EVERY path, so /transmission-app.css and
// /transmission-app.js returned the homepage. Fix: make the fetch target the
// configured hostname itself, so the browser sets Host = hostname from the
// URL. These tests pin that the upstream URL's authority is the hostname and
// the visitor's path is preserved verbatim.

// Monkey-patch fetch() to capture the request URL instead of hitting a real
// backend. Each test restores the original after.
function captureFetch() {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    calls.push({ url: String(url), method: opts && opts.method });
    const body = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('ok'));
        ctrl.close();
      },
    });
    return Promise.resolve(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }));
  };
  return { calls, restore: () => { globalThis.fetch = origFetch; } };
}

function mockStreamRW() {
  const writes = [];
  return {
    writes,
    async write(b) { writes.push(b); return Promise.resolve(); },
    close() {},
  };
}

describe('Host rewrite: fetch target is the configured hostname', () => {
  it('routes to the hostname and preserves the sub-resource path', async () => {
    const { calls, restore } = captureFetch();
    const stream = mockStreamRW();
    await forwardHTTP(stream, {
      method: 'GET', path: '/transmission-app.css',
      headers: { host: ['aaca85f9a4190e4f.gost.run'] }, body: null,
    }, {
      localEndpoint: '192.168.100.200:80', hostname: 'bt.home.pi',
    });
    restore();
    assert.equal(calls.length, 1, 'exactly one upstream fetch');
    assert.equal(
      calls[0].url,
      'http://bt.home.pi/transmission-app.css',
      'authority must be the hostname; default port :80 omitted (Host = "bt.home.pi", no port)',
    );
    assert.equal(calls[0].method, 'GET');
  });

  it('keeps a non-default port on the rewritten authority', async () => {
    const { calls, restore } = captureFetch();
    const stream = mockStreamRW();
    await forwardHTTP(stream, {
      method: 'GET', path: '/style.css',
      headers: { host: ['x.gost.run'] }, body: null,
    }, {
      localEndpoint: '192.168.100.200:8080', hostname: 'bt.home.pi',
    });
    restore();
    assert.equal(calls[0].url, 'http://bt.home.pi:8080/style.css',
      'non-default port is retained on the rewritten hostname');
  });

  it('uses the localEndpoint host when no hostname is configured', async () => {
    const { calls, restore } = captureFetch();
    const stream = mockStreamRW();
    await forwardHTTP(stream, {
      method: 'GET', path: '/large',
      headers: { host: ['x.gost.run'] }, body: null,
    }, {
      localEndpoint: 'localhost:8000',
    });
    restore();
    assert.equal(calls[0].url, 'http://localhost:8000/large',
      'without hostname the original localEndpoint authority is used');
  });

  it('omits :443 for https when hostname is configured', async () => {
    const { calls, restore } = captureFetch();
    const stream = mockStreamRW();
    await forwardHTTP(stream, {
      method: 'GET', path: '/api',
      headers: { host: ['x.gost.run'] }, body: null,
    }, {
      localEndpoint: '192.168.100.200:443', hostname: 'bt.home.pi', enableTLS: true,
    });
    restore();
    assert.equal(calls[0].url, 'https://bt.home.pi/api',
      'default https port :443 omitted so Host = "bt.home.pi"');
  });
});

// ── Redirect transparency: fetch follows 3xx silently; synthesize 302 back ─
//
// fetch(redirect:'follow') absorbs server 3xx redirects and returns the final
// response at the ORIGINAL url, so the browser keeps the wrong base path and
// relative sub-resources resolve incorrectly (the "CSS/JS return homepage
// HTML" symptom for prefix-mounted backends like Transmission). The fix:
// when fetch reports it followed a redirect (resp.redirected), synthesize a
// 302 to the final path so the browser navigates. 'manual' mode can't be used
// because it yields an opaque-redirect (status 0, unreadable Location).

// A fake fetch Response carrying redirected:true (a flag a Response built via
// `new Response()` does NOT expose, so we hand-roll it).
function fakeRedirectedResponse(finalUrl, { status = 200, statusText = 'OK', contentType = 'text/html' } = {}) {
  const body = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode('final-body'));
      ctrl.close();
    },
  });
  return {
    redirected: true, url: finalUrl, status, statusText,
    headers: new Headers({ 'content-type': contentType }),
    body,
  };
}

describe('Redirect transparency: synthesize 302 when fetch followed a redirect', () => {
  it('emits 302 to the final path for a redirected GET', async () => {
    const origFetch = globalThis.fetch;
    let called;
    globalThis.fetch = (url, opts) => { called = String(url); return Promise.resolve(fakeRedirectedResponse('http://bt.home.pi/transmission/web/')); };
    try {
      const stream = mockStreamRW();
      await forwardHTTP(stream, {
        method: 'GET', path: '/',
        headers: { host: ['x.gost.run'] }, body: null,
      }, { localEndpoint: '192.168.100.200:80', hostname: 'bt.home.pi' });
      const out = Buffer.concat(stream.writes.map(Buffer.from)).toString('utf8');
      assert.equal(called, 'http://bt.home.pi/', 'upstream fetch went to the hostname at the request path');
      assert.match(out, /^HTTP\/1\.1 302 Found\r\n/);
      assert.match(out, /Location: \/transmission\/web\/\r\n/);
      // The final body must NOT be leaked to the visitor — only the redirect.
      assert.doesNotMatch(out, /final-body/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('emits the full absolute URL when the redirect crossed origins', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(fakeRedirectedResponse('https://cdn.example.com/assets/x'));
    try {
      const stream = mockStreamRW();
      await forwardHTTP(stream, {
        method: 'GET', path: '/',
        headers: { host: ['x.gost.run'] }, body: null,
      }, { localEndpoint: '192.168.100.200:80', hostname: 'bt.home.pi' });
      const out = Buffer.concat(stream.writes.map(Buffer.from)).toString('utf8');
      // Cross-origin redirect must NOT be folded onto the entrypoint host.
      assert.match(out, /Location: https:\/\/cdn\.example\.com\/assets\/x\r\n/);
      assert.doesNotMatch(out, /Location: \/assets\/x/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('passes the final response through when no redirect occurred', async () => {
    const origFetch = globalThis.fetch;
    // A constructed Response has redirected=false; emulate that exact shape so
    // we exercise the "no synthesis" branch with a redirected:false value.
    const body = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('css-body')); c.close(); },
    });
    globalThis.fetch = () => Promise.resolve({
      redirected: false, url: 'http://bt.home.pi/transmission-app.css',
      status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/css' }),
      body,
    });
    try {
      const stream = mockStreamRW();
      await forwardHTTP(stream, {
        method: 'GET', path: '/transmission-app.css',
        headers: { host: ['x.gost.run'] }, body: null,
      }, { localEndpoint: 'bt.home.pi', hostname: 'bt.home.pi' });
      const out = Buffer.concat(stream.writes.map(Buffer.from)).toString('utf8');
      assert.match(out, /^HTTP\/1\.1 200 OK\r\n/);
      assert.doesNotMatch(out, /302 Found/);
      assert.doesNotMatch(out, /Location: /);
      assert.match(out, /css-body/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('does NOT synthesize a redirect for redirected POST (body/method semantics)', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(fakeRedirectedResponse('http://bt.home.pi/new'));
    try {
      const stream = mockStreamRW();
      await forwardHTTP(stream, {
        method: 'POST', path: '/echo',
        body: new TextEncoder().encode('payload'),
        headers: { host: ['x.gost.run'] },
      }, { localEndpoint: 'bt.home.pi', hostname: 'bt.home.pi' });
      const out = Buffer.concat(stream.writes.map(Buffer.from)).toString('utf8');
      // POST redirected: fetch already preserved method+body internally; we
      // hand the final response through (200 with body), NOT a 302.
      assert.match(out, /^HTTP\/1\.1 200/);
      assert.doesNotMatch(out, /Location: /);
      assert.match(out, /final-body/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
