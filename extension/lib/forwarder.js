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
    // HTTP basic auth guards the public endpoint (matches Go's sniffer_http.go:
    // it checks req.BasicAuth() and returns 401 + WWW-Authenticate before ever
    // reaching the backend). Enforced client-side because the relay only pipes
    // bytes — the tunnel operator (this forwarder) is where auth must happen.
    if (!isAuthorized(req.headers, config.auth)) {
      await writeUnauthorized(stream);
      return;
    }
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

// ── HTTP basic auth ────────────────────────────────────────────────────

/**
 * Validate the visitor's `Authorization: Basic` header against the tunnel's
 * configured credentials. Returns true when auth is not configured (no
 * username) or when the supplied credentials match exactly.
 *
 * Mirrors Go's http.Request.BasicAuth(): base64-decode the token, split the
 * "username:password" on the FIRST colon (passwords may contain colons).
 */
export function isAuthorized(headers, auth) {
  if (!auth || !auth.username) return true; // auth not configured → open
  const header = firstHeader(headers, 'authorization');
  if (!header) return false;
  const m = /^basic\s+(\S+)$/i.exec(header.trim());
  if (!m) return false;
  let decoded;
  try {
    decoded = decodeBase64Utf8(m[1]);
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  const user = idx === -1 ? decoded : decoded.slice(0, idx);
  const pass = idx === -1 ? '' : decoded.slice(idx + 1);
  return user === auth.username && pass === (auth.password || '');
}

/** Decode a base64 string to UTF-8 text (browser + Node compatible). */
function decodeBase64Utf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Write a 401 with WWW-Authenticate: Basic and close the stream. */
async function writeUnauthorized(stream) {
  const body = 'Unauthorized';
  const head =
    'HTTP/1.1 401 Unauthorized\r\n' +
    'WWW-Authenticate: Basic\r\n' +
    'Content-Type: text/plain\r\n' +
    `Content-Length: ${body.length}\r\n` +
    '\r\n';
  try {
    await stream.write(new TextEncoder().encode(head + body));
  } finally {
    try { stream.close(); } catch { /* already closed */ }
  }
}

// ── HTTP forwarder ─────────────────────────────────────────────────────

/**
 * Build the URL authority (host[:port]) for the upstream fetch.
 *
 * When a hostname is configured (Host rewrite), we substitute it for the
 * localEndpoint's host so fetch() sets the Host header FROM the URL — the
 * only reliable way to get `Host: <hostname>` on the wire. fetch() forbids
 * setting Host directly (forbidden request-header per Fetch spec), and
 * chrome.declarativeNetRequest treats Host as a protected header it silently
 * refuses to override either, so neither route works. Making the request TO
 * <hostname> makes the browser set Host = <hostname> itself, which the
 * backend's `server_name <hostname>` vhost then matches.
 *
 * The default port for the scheme is omitted so Host carries no port, matching
 * Go's sniffer_http.go (`req.Host = httpSettings.Host`, host-only). Path is
 * preserved verbatim below, so each sub-resource resolves to its own content
 * (the root cause of the prior "all paths return the homepage" symptom: with
 * the wrong vhost selected, an SPA catch-all `try_files $uri /index.html`
 * served index.html for every path).
 *
 * Requires <hostname> to resolve on the host running Chrome — true for the
 * typical Host-Rewrite case (a local DNS name → backend IP). If it does not
 * resolve, fetch() fails with a DNS error and the visitor gets a 502.
 */
export function _urlAuthority(localEndpoint, hostname, scheme) {
  let host = localEndpoint;
  let port = '';
  const bracket = localEndpoint.lastIndexOf(']');
  const colon = localEndpoint.lastIndexOf(':');
  if (colon > bracket) {
    host = localEndpoint.slice(0, colon);
    port = localEndpoint.slice(colon + 1);
  }
  const targetHost = hostname || host;
  const defaultPort = (scheme === 'https' || scheme === 'wss') ? '443' : '80';
  if (!port || port === defaultPort) return targetHost;
  return `${targetHost}:${port}`;
}

export async function forwardHTTP(stream, req, config) {
  const scheme = config.enableTLS ? 'https' : 'http';
  // Use the configured hostname as the fetch target (Host rewrite). See
  // _urlAuthority for why we route TO the hostname instead of rewriting Host.
  const authority = _urlAuthority(config.localEndpoint, config.hostname, scheme);
  const url = `${scheme}://${authority}${req.path}`;
  const method = req.method || 'GET';

  console.log(
    `Wisper: forward → ${method} ${url}  (path="${req.path}" hostname="${config.hostname || ''}")`,
  );

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

  // Host is NOT set explicitly here: fetch() forbids setting Host, so it is
  // derived from the URL authority (see _urlAuthority). When a hostname is
  // configured we fetch FROM the hostname, so the browser sets Host = hostname
  // for us and the backend's virtual host is selected correctly.

  const fetchOpts = { method, headers: fwdHeaders };
  if (!['GET', 'HEAD'].includes(method) && req.body && req.body.length > 0) {
    fetchOpts.body = req.body;
  }

  let resp;
  try {
    resp = await fetch(url, fetchOpts);
    console.log(
      `Wisper: fetch response ← ${resp.status} ${resp.statusText}  for ${method} ${url}`,
      { contentType: resp.headers.get('content-type') },
    );
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
    // of a hanging connection or generic reset. Use TextEncoder for the byte
    // length — Buffer is a Node global absent in the offscreen DOM context,
    // so Buffer.byteLength would throw ReferenceError there.
    const body = `backend unreachable: ${config.localEndpoint} — ${e.message}`;
    const bodyBytes = new TextEncoder().encode(body);
    await stream.write(new TextEncoder().encode(
      `HTTP/1.1 502 Bad Gateway\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Length: ${bodyBytes.length}\r\n` +
      `\r\n`,
    ));
    await stream.write(bodyBytes);
    stream.close();
    return;
  }

  // Redirect transparency for safe methods.
  //
  // fetch() follows 3xx redirects by default (redirect:'follow' is the only
  // mode that yields a readable response — 'manual' returns an opaque-redirect
  // with status 0 and no readable Location, 'error' throws). That silently
  // ABSORBS server-side redirects: the visitor never sees the 301/302, and
  // because fetch returns the final response while the browser keeps the
  // ORIGINAL url, the page's relative sub-resource URLs resolve against the
  // wrong base path. That is the real mechanism behind "CSS/JS sub-paths
  // return the homepage HTML" for backends that serve their UI under a path
  // prefix and redirect / there (e.g. Transmission → /transmission/web/):
  // fetch follows / → /transmission/web/, hands the HTML back at /, and
  // <link href="transmission-app.css"> resolves to /transmission-app.css,
  // which redirects again → HTML served as CSS.
  //
  // We can't read the original 3xx (fetch hid it), so for safe methods we
  // synthesize a 302 and let the browser perform the navigation. When the
  // redirect chain stayed on the SAME origin as our fetch (the common case:
  // `<hostname>/` → `<hostname>/transmission/web/`), emit a PATH-relative
  // Location so the visitor's browser stays on the entrypoint host (the
  // backend hostname like bt.home.pi is reachable on this machine but the
  // VISITOR can only reach it through the entrypoint, so we must not leak
  // it into the Location). When the chain crossed to a DIFFERENT origin
  // (backend redirected to an external site), emit the full absolute URL so
  // the browser leaves the entrypoint to that destination — a path-relative
  // Location would wrongly bind it to the entrypoint host.
  //
  // Non-safe methods are left as fetch left them: fetch preserved method+body
  // across 307/308 internally, and reconstructing that from an opaque
  // redirect isn't faithful, so the final response passes through unchanged.
  if (resp.redirected && (method === 'GET' || method === 'HEAD')) {
    const finalUrl = new URL(resp.url);
    const fetchOrigin = new URL(url).origin;
    const loc = finalUrl.origin === fetchOrigin
      ? (finalUrl.pathname || '/') + finalUrl.search
      : finalUrl.href;
    const bodyBytes = new TextEncoder().encode(`redirected to ${loc}`);
    const head =
      `HTTP/1.1 302 Found\r\n` +
      `Location: ${loc}\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Length: ${bodyBytes.length}\r\n` +
      `\r\n`;
    const headBytes = new TextEncoder().encode(head);
    const out = new Uint8Array(headBytes.length + bodyBytes.length);
    out.set(headBytes, 0);
    out.set(bodyBytes, headBytes.length);
    console.log(`Wisper: redirect absorbed by fetch → synthesized 302 → ${loc} (orig ${method} ${url})`);
    await stream.write(out);
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
  //
  // Use _urlAuthority so that when a hostname is configured (Host rewrite),
  // the WebSocket connects TO the hostname and the browser sets Host from the
  // URL. Without this, WebSocket connections went to the raw localEndpoint
  // while HTTP requests fetched from the hostname — name-based virtual
  // hosting selected the wrong server block for WebSocket upgrades.
  //
  // IMPORTANT: Chrome extension pages (including offscreen documents) are
  // secure contexts. Chrome's mixed content policy BLOCKS `ws://` from secure
  // contexts — the connection is killed before the TCP handshake. `wss://`
  // works because it uses TLS. `fetch()` to `http://` works because Chrome
  // has a localhost exception for fetch, but that exception does NOT extend
  // to the WebSocket API. So: WebSocket to a plain-HTTP backend WILL fail
  // from an extension page. The user must enable TLS for the tunnel when they
  // need WebSocket forwarding.
  const scheme = config.enableTLS ? 'wss' : 'ws';
  const authority = _urlAuthority(config.localEndpoint, config.hostname, scheme);
  const backendUrl = `${scheme}://${authority}${req.path}`;

  // Detect when Chrome will block this connection so we can surface a
  // specific error instead of a generic "connection failed" message.
  const isSecureContext = typeof globalThis.isSecureContext === 'boolean'
    ? globalThis.isSecureContext
    : false;
  const wsWillBeBlocked = isSecureContext && scheme === 'ws';

  if (wsWillBeBlocked) {
    console.warn(
      `Wisper: WebSocket to ${backendUrl} will be blocked — ` +
      `Chrome blocks ws:// from secure extension pages. ` +
      `Enable TLS on this tunnel to use wss:// instead.`,
    );
  }

  console.log(
    `Wisper: WebSocket connect → ${backendUrl}` +
    (protocol ? ` (protocol: ${protocol})` : '') +
    (wsWillBeBlocked ? ' [WILL BE BLOCKED by Chrome secure-context policy]' : ''),
  );

  const backend = new WebSocket(backendUrl, protocol || undefined);
  backend.binaryType = 'arraybuffer';

  // Visitor→backend frame decoder, fed from the SMUX stream.
  const decoder = new WsDecoder();

  // Guard: make sure we only respond once (onerror + onclose both fire on
  // failure, and we must not double-write). Track whether we already sent a
  // response back through the SMUX stream.
  let responded = false;

  /**
   * Write an HTTP error response to the SMUX stream when the backend WebSocket
   * fails before onopen. The Go entrypoint's transport.RoundTrip() is waiting
   * for an HTTP response — if we just close the stream it gets a connection
   * reset and the visitor sees a generic 503. Sending a well-formed 502 gives
   * the visitor a meaningful error instead of a hung/nulled connection.
   */
  async function failVisitor(status, reason) {
    if (responded) return;
    responded = true;
    const body = reason || 'WebSocket backend unreachable';
    const bodyBytes = new TextEncoder().encode(body);
    const head =
      `HTTP/1.1 ${status} ${reason || 'Error'}\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Length: ${bodyBytes.length}\r\n` +
      `\r\n`;
    const headBytes = new TextEncoder().encode(head);
    const out = new Uint8Array(headBytes.length + bodyBytes.length);
    out.set(headBytes, 0);
    out.set(bodyBytes, headBytes.length);
    try {
      await stream.write(out);
    } catch { /* stream already closed */ }
    try { stream.close(); } catch { /* already closed */ }
  }

  backend.onerror = () => {
    console.error(
      `Wisper: WebSocket error → ${backendUrl}` +
      ` (readyState=${backend.readyState})`,
    );
    // If the backend already opened and we're relaying frames, send a close
    // frame to the visitor so the client gets an orderly shutdown. Otherwise
    // (error before onopen), write an HTTP error — the visitor is waiting for
    // a 101 and won't understand a raw close frame at the HTTP level.
    if (activeWebSockets.has(streamId)) {
      sendVisitorClose(stream, 1011);
    }
    activeWebSockets.delete(streamId);
    if (!responded) {
      const reason = wsWillBeBlocked
        ? `Chrome blocks ws:// from extension pages (secure context). Enable TLS on this tunnel to use wss:// instead. Backend: ${backendUrl}`
        : `backend unreachable: ${backendUrl}`;
      failVisitor(502, reason);
    } else {
      try { stream.close(); } catch { /* already closed */ }
    }
  };

  backend.onclose = (event) => {
    console.log(
      `Wisper: WebSocket closed ← ${backendUrl}` +
      ` (code=${event.code || 'none'} reason="${event.reason || ''}" wasClean=${event.wasClean})`,
    );
    if (activeWebSockets.has(streamId)) {
      sendVisitorClose(stream, event.code || 1000);
    }
    activeWebSockets.delete(streamId);
    if (!responded) {
      failVisitor(502, `backend closed before handshake: ${backendUrl} (code=${event.code})`);
    } else {
      try { stream.close(); } catch { /* already closed */ }
    }
  };

  backend.onopen = async () => {
    console.log(`Wisper: WebSocket opened ← ${backendUrl}`);
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
      responded = true;
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
            // Preserve the original frame's opcode: send text frames as
            // strings (WebSocket.send(string) → OP_TEXT) and binary frames
            // as byte arrays (WebSocket.send(Uint8Array) → OP_BINARY).
            // Before this fix, all payloads were Uint8Arrays and sent as
            // binary — text-protocol backends like Cockpit (cockpit1 over
            // JSON text frames) would receive binary frames they can't parse.
            if (ev.opcode === OP_TEXT) {
              be.send(new TextDecoder().decode(ev.payload));
            } else {
              be.send(ev.payload);
            }
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
