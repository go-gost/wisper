/**
 * forwarder.js — HTTP and WebSocket request forwarding for tunnel streams.
 *
 * Pure (no chrome dependency) so it is importable in Node for live testing.
 * Used by the offscreen document (and the live-relay test) to bridge inbound
 * requests arriving over a SMUX stream to a local backend.
 *
 *   - handleRequest(stream, req, config): dispatch HTTP vs WebSocket upgrade
 *   - forwardHTTP(stream, req, config):   fetch() to local backend, stream the
 *     response back, fixing Content-Encoding/Length and multi Set-Cookie
 *   - forwardWebSocket(stream, req, config): synthesize a compliant 101 for the
 *     visitor and bridge raw WS frames to/from a local WebSocket via ws-codec
 *
 * `req` is the parsed request from TunnelConnection.onStream:
 *   { method, path, headers (name→string[]), body (Uint8Array|null), peerAddr }
 */

import {
  WsDecoder, encodeWsFrame, wsAccept,
  OP_TEXT, OP_BINARY, OP_CLOSE, OP_PONG,
} from './ws-codec.js';

// ── Request handler (HTTP + WebSocket dispatch) ────────────────────────

export async function handleRequest(stream, req, config) {
  try {
    if (isWebSocketUpgrade(req.headers)) {
      await forwardWebSocket(stream, req, config);
    } else {
      await forwardHTTP(stream, req, config);
    }
  } catch (e) {
    // Catch-all: forwardWebSocket errors and any unexpected forwardHTTP
    // failures that fell through the internal try/catch. forwardHTTP handles
    // its own fetch() errors (returns 502), so this path fires only for
    // truly unexpected failures (e.g. stream write errors, WebSocket setup
    // failures). Always close the stream so the relay tears down cleanly.
    console.error(
      `Wisper: forwarding error → ${config.localEndpoint}${req.path}: ${e.message}`,
      { stack: e.stack },
    );
    try { stream.close(); } catch { /* already closed */ }
  }
}

// ── Header helpers (headers are stored as name→string[] to preserve dupes) ──

/** First value of a header, or undefined. */
export function firstHeader(headers, name) {
  const v = headers[name];
  return v && v.length ? v[0] : undefined;
}

/** Token test on a (possibly comma-listed, possibly multi-valued) header. */
export function headerHasToken(headers, name, token) {
  const vals = headers[name];
  if (!vals) return false;
  const tok = token.toLowerCase();
  for (const v of vals) {
    for (const part of v.split(',')) {
      if (part.trim().toLowerCase() === tok) return true;
    }
  }
  return false;
}

// ── HTTP forwarder ─────────────────────────────────────────────────────

export async function forwardHTTP(stream, req, config) {
  const scheme = config.enableTLS ? 'https' : 'http';
  const url = `${scheme}://${config.localEndpoint}${req.path}`;
  const method = req.method || 'GET';

  // Build a Headers object, appending each value so duplicates (Set-Cookie,
  // Cookie, ...) survive. Strip hop-by-hop and transport-framing headers.
  // fetch() controls Host and Content-Length itself (both are forbidden
  // request headers in the browser), so drop the visitor's values and let
  // fetch set them from the URL and body respectively.
  const fwdHeaders = new Headers();
  for (const [name, values] of Object.entries(req.headers)) {
    const lname = name.toLowerCase();
    if (isHopByHopHeader(lname)) continue;
    if (lname === 'content-length' || lname === 'host') continue;
    for (const v of values) fwdHeaders.append(name, v);
  }

  // Host rewrite (matches Go httpTunnel's hostname option). The browser
  // forbids overriding the Host header on fetch(), so this is a best-effort
  // that takes effect only in contexts where the header is not filtered;
  // otherwise the backend sees the localEndpoint host (as it always did).
  if (config.hostname) {
    try { fwdHeaders.set('Host', config.hostname); } catch { /* forbidden header */ }
  }

  const fetchOpts = { method, headers: fwdHeaders };
  if (!['GET', 'HEAD'].includes(method) && req.body && req.body.length > 0) {
    fetchOpts.body = req.body;
  }

  let resp;
  try {
    resp = await fetch(url, fetchOpts);
  } catch (e) {
    // The fetch() to the local backend failed — connection refused, DNS failure,
    // timeout, or the backend isn't running on the configured localEndpoint.
    // Surface the URL so the user can match the error to their backend config.
    console.error(`Wisper: fetch failed → ${url}: ${e.message}`, {
      method,
      backend: config.localEndpoint,
      path: req.path,
    });
    // Return a well-formed 502 so the visitor sees a meaningful error instead
    // of a hanging connection or generic reset.
    const body = `backend unreachable: ${config.localEndpoint} — ${e.message}`;
    await stream.write(new TextEncoder().encode(
      `HTTP/1.1 502 Bad Gateway\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `\r\n${body}`,
    ));
    stream.close();
    return;
  }

  // Stream the response body straight to the SMUX stream in ≤32KB chunks.
  // We must NOT buffer the whole body (SSE/chunked/streaming break) and must
  // NOT echo the backend's Content-Encoding/Content-Length unmodified —
  // fetch() transparently decompresses, so the bytes we read are already
  // decoded and their length no longer matches a compressed Content-Length.
  const writer = new StreamHttpWriter(stream);
  await writer.writeHead(resp.status, resp.statusText, resp.headers);
  await writer.pipeBody(resp.body);
  stream.close();
}

/**
 * StreamHttpWriter — serializes an HTTP/1.1 response head + a streamed body
 * onto a SMUX Stream, fixing up transport-encoding headers in the process.
 *
 * BODY DELIMITING (critical): the entrypoint that terminates this tunnel
 * (go-gost x/handler/tunnel/entrypoint/ephttp.go) does NOT pipe raw bytes —
 * it calls transport.RoundTrip() over a net.Conn backed by the SMUX stream,
 * which Go's http transport parses with http.ReadResponse. That parser can
 * only delimit a response body via Content-Length or Transfer-Encoding:
 * chunked. A head with NEITHER leaves the body undelimited, so the entrypoint
 * never sees the body end and the visitor hangs / gets cancelled. (The Go
 * reference handler uses raw xnet.Pipe, where the backend's real HTTP server
 * always emits a correct Content-Length/chunked; this JS forwarder builds the
 * head by hand and must do the same.)
 *
 * Strategy:
 *   - If the backend sent Content-Length AND there was no Content-Encoding
 *     (so fetch() didn't change the byte count), keep Content-Length and pass
 *     the body through verbatim.
 *   - Otherwise (streamed, decompressed by fetch, or unknown length), emit
 *     `Transfer-Encoding: chunked` and wrap each body chunk. This delimits
 *     bodies we can't pre-size (SSE, streaming, decompressed) the same way a
 *     real HTTP server would.
 *
 * Content-Encoding is always stripped: fetch() has already decompressed the
 * body, so the bytes we forward are plain and forwarding a gzip
 * Content-Encoding/Length would make the visitor re-decode plain bytes.
 */
export class StreamHttpWriter {
  constructor(stream) {
    this._stream = stream;
    this._wroteHead = false;
    this._chunked = false; // set in writeHead; true → wrap body chunks
  }

  /**
   * Serialize and write the status line + headers. Returns the promise that
   * resolves when the head has been written to the stream (callers SHOULD
   * await it before pipeBody()/close() so a synchronous close() can't drop
   * the queued head write — see Stream.close()'s drain caveat).
   */
  writeHead(status, statusText, respHeaders) {
    // Re-collect response headers, preserving multi-value (Set-Cookie, ...).
    // Drop hop-by-hop + Content-Encoding — the body we forward is already
    // decompressed by fetch() and must not carry a stale compressed length.
    //
    // The Fetch Headers iterator joins duplicate headers (notably Set-Cookie)
    // with ", ", which corrupts cookies whose Expires date contains a comma.
    // Use getSetCookie() to recover the individual values when available.
    const lines = [];
    const seen = new Set();

    // Set-Cookie: emit each cookie on its own line.
    let setCookies = null;
    if (typeof respHeaders.getSetCookie === 'function') {
      setCookies = respHeaders.getSetCookie();
    }
    if (setCookies && setCookies.length) {
      for (const c of setCookies) lines.push(`Set-Cookie: ${c}`);
      seen.add('set-cookie');
    }

    // Decide body-delimiting mode BEFORE emitting headers.
    //   - Keep Content-Length only when there was no Content-Encoding (fetch
    //     passes the body through unchanged, so the backend's length is still
    //     accurate). If fetch decompressed, the length is wrong → chunked.
    const hadEncoding = respHeaders.has('content-encoding');
    const backendLen = respHeaders.get('content-length');
    const keepClen = !hadEncoding && backendLen != null;
    this._chunked = !keepClen;

    for (const [name, value] of respHeaders) {
      const lname = name.toLowerCase();
      if (isHopByHopHeader(lname)) continue;
      if (lname === 'content-encoding') continue;
      if (lname === 'content-length') continue; // handled explicitly below
      if (lname === 'transfer-encoding') continue; // we own framing
      if (seen.has(lname)) continue; // already emitted (e.g. set-cookie above)
      seen.add(lname);
      lines.push(`${name}: ${value}`);
    }
    if (keepClen) {
      lines.push(`Content-Length: ${backendLen}`);
    } else {
      lines.push('Transfer-Encoding: chunked');
    }
    const reason = statusText || '';
    const head = `HTTP/1.1 ${status} ${reason}\r\n${lines.join('\r\n')}\r\n\r\n`;
    const p = this._stream.write(new TextEncoder().encode(head));
    this._wroteHead = true;
    return p;
  }

  async pipeBody(body) {
    if (!this._wroteHead) throw new Error('head not written');
    if (!body) {
      if (this._chunked) await this._stream.write(_CHUNKED_TERMINATOR);
      return;
    }
    const reader = body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (this._chunked) {
          // Wrap each chunk: `<hexLen>\r\n<data>\r\n`. The terminal `0\r\n\r\n`
          // is sent after the loop. Skip zero-length chunks (they'd emit a
          // valid but pointless `0\r\n\r\n` prematurely).
          if (value.length === 0) continue;
          const frame = _chunkedWrap(value);
          await this._stream.write(frame);
        } else {
          // Verbatim — Content-Length in the head already delimits the body.
          await this._stream.write(value);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    if (this._chunked) await this._stream.write(_CHUNKED_TERMINATOR);
  }
}

// `0\r\n\r\n` — terminates a chunked body.
const _CHUNKED_TERMINATOR = new TextEncoder().encode('0\r\n\r\n');

/** Build a single chunked-encoding frame: `<hexLen>\r\n<data>\r\n`. */
function _chunkedWrap(data) {
  const hex = data.length.toString(16);
  const out = new Uint8Array(hex.length + 2 + data.length + 2);
  let o = 0;
  for (let i = 0; i < hex.length; i++) out[o++] = hex.charCodeAt(i);
  out[o++] = 0x0d; out[o++] = 0x0a; // \r\n
  out.set(data, o); o += data.length;
  out[o++] = 0x0d; out[o++] = 0x0a; // \r\n
  return out;
}

// ── WebSocket forwarder ────────────────────────────────────────────────

/**
 * activeWebSockets — maps stream id → local WebSocket connection.
 *
 * ponytail: global map, per-stream granularity is enough;
 * add per-tunnel ShardedMap if hundreds of concurrent WS.
 */
const activeWebSockets = new Map();

export async function forwardWebSocket(stream, req, config) {
  const streamId = stream.id;

  // The visitor's WebSocket key. We must answer with a correct
  // Sec-WebSocket-Accept because the relay pipes RAW frames after the 101 —
  // the browser's own 101 (to the backend below) is consumed by the browser
  // and cannot be forwarded verbatim, so we synthesize a compliant handshake
  // for the visitor and bridge frames to/from the backend's WS connection.
  const key = firstHeader(req.headers, 'sec-websocket-key') || '';
  const protocol = firstHeader(req.headers, 'sec-websocket-protocol');
  const extensions = firstHeader(req.headers, 'sec-websocket-extensions');

  // Open the backend WebSocket. The backend performs its own handshake; we
  // never expose its 101 to the visitor.
  const scheme = config.enableTLS ? 'wss' : 'ws';
  const backendUrl = `${scheme}://${config.localEndpoint}${req.path}`;
  const backend = new WebSocket(backendUrl, protocol || undefined);
  backend.binaryType = 'arraybuffer';

  // Visitor→backend frame decoder, fed from the SMUX stream.
  const decoder = new WsDecoder();

  // If the backend closes before it opens (e.g. refused), tell the visitor.
  backend.onerror = () => {
    // Send a close frame if we've already answered 101; else the visitor will
    // see the stream close as a failed handshake.
    if (activeWebSockets.has(streamId)) {
      sendVisitorClose(stream, 1011); // internal error
    }
    activeWebSockets.delete(streamId);
    try { stream.close(); } catch { /* already closed */ }
  };
  backend.onclose = () => {
    activeWebSockets.delete(streamId);
    sendVisitorClose(stream, 1000);
    try { stream.close(); } catch { /* already closed */ }
  };

  backend.onopen = async () => {
    activeWebSockets.set(streamId, backend);

    // Synthesize the visitor's 101 response with a correct Accept and the
    // negotiated protocol/extensions we can actually honor (permessage-deflate
    // is NOT supported here — drop it to avoid framing divergence).
    const accept = await wsAccept(key);
    const respLines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
    ];
    if (protocol) respLines.push(`Sec-WebSocket-Protocol: ${protocol}`);
    const keptExt = stripPermessageDeflate(extensions);
    if (keptExt) respLines.push(`Sec-WebSocket-Extensions: ${keptExt}`);
    respLines.push('', '');
    try {
      await stream.write(new TextEncoder().encode(respLines.join('\r\n')));
    } catch {
      try { backend.close(); } catch { /* */ }
      return;
    }

    // Pump visitor frames → backend payloads.
    relayVisitorFrames(stream, streamId, decoder, backend);
  };

  // backend → visitor: re-encode each backend message as a server frame.
  backend.onmessage = (event) => {
    if (!activeWebSockets.has(streamId)) return;
    const payload = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : new TextEncoder().encode(event.data);
    const opcode = (typeof event.data === 'string') ? OP_TEXT : OP_BINARY;
    const frame = encodeWsFrame(opcode, payload, false);
    stream.write(frame).catch(() => {});
  };
}

/**
 * relayVisitorFrames — read visitor (masked) WS frames from the SMUX stream,
 * decode them, and deliver payloads to the backend WebSocket.
 */
async function relayVisitorFrames(stream, streamId, decoder, backend) {
  try {
    for (;;) {
      const chunk = await stream.read();
      if (!chunk) break; // visitor closed the stream / tunnel
      decoder.push(chunk);
      const events = decoder.parse();
      for (const ev of events) {
        const be = activeWebSockets.get(streamId);
        if (!be || be.readyState !== WebSocket.OPEN) return;
        switch (ev.type) {
          case 'data':
            be.send(ev.payload);
            break;
          case 'ping':
            // Echo as a pong frame back to the visitor.
            stream.write(encodeWsFrame(OP_PONG, ev.payload, false)).catch(() => {});
            break;
          case 'pong':
            break; // keepalive, ignore
          case 'close': {
            const code = parseCloseCode(ev.payload);
            try { backend.close(code, ''); } catch { backend.close(); }
            sendVisitorClose(stream, code || 1000);
            activeWebSockets.delete(streamId);
            return;
          }
          default:
            break;
        }
      }
    }
  } catch {
    // stream read failed — drop the bridge
  }
  const be = activeWebSockets.get(streamId);
  if (be) {
    try { be.close(); } catch { /* */ }
    activeWebSockets.delete(streamId);
  }
}

/** Send a close frame to the visitor (best-effort). */
function sendVisitorClose(stream, code) {
  const payload = new Uint8Array(2);
  new DataView(payload.buffer).setUint16(0, code, false); // BE per RFC 6455
  try { stream.write(encodeWsFrame(OP_CLOSE, payload, false)).catch(() => {}); } catch { /* */ }
}

/** Extract the status code from a close-frame payload, or null. */
function parseCloseCode(payload) {
  if (payload && payload.length >= 2) {
    return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(0, false);
  }
  return null;
}

/** Drop permessage-deflate from an Extensions header (we don't compress). */
function stripPermessageDeflate(extensions) {
  if (!extensions) return '';
  const kept = extensions
    .split(',')
    .map(s => s.trim())
    .filter(s => s.toLowerCase() !== 'permessage-deflate' && !s.toLowerCase().startsWith('permessage-deflate'));
  return kept.join(', ');
}

// ── Header classification helpers ──────────────────────────────────────

export function isWebSocketUpgrade(headers) {
  return headerHasToken(headers, 'connection', 'upgrade') &&
    (firstHeader(headers, 'upgrade') || '').toLowerCase() === 'websocket';
}

/**
 * Hop-by-hop headers (RFC 7230 §6.1) plus transport-framing headers that must
 * not be forwarded to/from the backend: content-encoding and content-length
 * are handled specially by the streaming writer, so callers strip them there.
 */
export function isHopByHopHeader(name) {
  const HOP = new Set([
    'connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate',
    'te', 'trailer', 'transfer-encoding', 'upgrade',
  ]);
  return HOP.has(name.toLowerCase());
}
