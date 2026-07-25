/**
 * tunnel-connection.js — WebSocket + relay bind + SMUX orchestration.
 *
 * Opens a WSS connection to the GOST relay server, performs the relay CmdBind
 * handshake, then multiplexes inbound HTTP/WebSocket requests through SMUX v2.
 *
 * The connection lifecycle:
 *   1. Open WebSocket (wss://wisper.gost.run:443)
 *   2. Send relay CmdBind request (TunnelFeature, UserAuthFeature, AddrFeature×2)
 *   3. Receive relay Response → verify StatusOK
 *   4. Create SmuxServer, feed all subsequent binary messages
 *   5. On each new SMUX stream: read relay Response → parse HTTP → forward to localhost
 */

import { CmdBind, StatusOK, FeatureUserAuth, FeatureAddr, FeatureTunnel, FeatureNetwork, FeatureMetadata, NetworkTCP } from './relay.js';
import { RelayRequest, relayResponseFromWire, findFeature, encodeAddr, encodeUserAuth, encodeTunnel, encodeNetwork } from './relay.js';
import { SmuxServer } from './smux.js';

export class TunnelConnection {
  /**
   * @param {object} config
   * @param {Uint8Array} config.tunnelId — 20-byte tunnel ID
   * @param {string} config.localEndpoint — e.g. "localhost:8080"
   * @param {object} [config.auth] — { username, password }
   * @param {string} [config.relayUrl] — defaults to wss://wisper.gost.run:443
   * @param {string} [config.entrypointUrl] — pre-computed public URL, e.g. "https://abc123.gost.run"
   */
  constructor(config) {
    this._config = config;
    this._relayUrl = config.relayUrl || 'wss://wisper.gost.run/ws';
    this._tunnelId = config.tunnelId;
    this._ws = null;
    this._smux = null;
    this._onStream = config.onStream || null;
    this._wrapStream = config.wrapStream || null;
    this._closed = false;
    this._reconnectAttempts = 0;
    /** @type {string|null} */
    this._bindAddr = config.entrypointUrl || null;
  }

  /**
   * connect — open WebSocket, perform relay handshake, start SMUX.
   * Resolves when the tunnel is bound (StatusOK received).
   */
  async connect() {
    if (this._closed) throw new Error('connection closed');

    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(this._relayUrl);
        this._ws.binaryType = 'arraybuffer';
      } catch (e) {
        reject(e);
        return;
      }

      this._ws.onopen = () => {
        try {
          this._sendBind();
        } catch (e) {
          reject(e);
        }
      };

      this._ws.onmessage = (event) => {
        if (this._closed) return;

        const data = new Uint8Array(event.data);

        if (!this._bound) {
          // First message is the relay bind response
          try {
            const resp = relayResponseFromWire(data);
            if (resp.status !== StatusOK) {
              reject(new Error(`relay bind failed: status ${resp.status}`));
              return;
            }

            // Extract connector ID
            const tunnelFeat = findFeature(resp.features, FeatureTunnel);
            this._connectorId = tunnelFeat ? tunnelFeat.value : null;

            // Initialize SMUX server
            this._smux = new SmuxServer({
              onStream: (stream) => this._handleStream(stream),
              onError: (err) => this._onError(err),
              onClose: () => this._onSmuxClose(),
            });
            this._smux.setOutput((frame) => {
              if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                this._ws.send(frame.buffer);
              }
            });
            this._smux.startKeepalive();
            this._bound = true;
            this._reconnectAttempts = 0;
            resolve();
          } catch (e) {
            reject(e);
          }
        } else {
          // Subsequent messages → SMUX frames
          this._smux.feed(data);
        }
      };

      this._ws.onclose = (e) => {
        if (!this._bound && !this._closed) {
          reject(new Error(
            `WebSocket closed before bind response: ` +
            `code=${e.code || 'none'} reason="${e.reason || ''}"`,
          ));
        }
        // Surface the status code so _onError + onClose callbacks have context.
        this._closeCode = e.code || 0;
        this._closeReason = e.reason || '';
        this._onSmuxClose();
      };

      this._ws.onerror = (e) => {
        // Browser WebSocket ErrorEvent is deliberately sparse (no error code,
        // no reason string) for security. The actual cause — TLS failure,
        // DNS NXDOMAIN, connection refused, non-101 response — is only
        // visible through chrome://net-export (net-internals). We collect
        // what little the browser gives us and pair it with the close event,
        // which arrives immediately after onerror with code/reason.
        const ctx = { url: this._relayUrl, type: 'WebSocket' };
        if (!this._bound) {
          reject(new Error(
            `WebSocket connect failed to ${this._relayUrl}. ` +
            `Check: (1) is wisper.gost.run reachable? ` +
            `(2) does the extension manifest's host_permissions include the relay host? ` +
            `(3) is there a proxy/VPN blocking wss:// traffic?`,
          ));
        }
        // The close event follows onerror immediately; defer _onError so
        // onclose can surface a real status code if the server sent a close
        // frame before the error.
        this._onError(new Error(
          `WebSocket error on ${this._relayUrl}` +
          (e && e.message ? ` — ${e.message}` : ''),
        ));
      };
    });
  }

  /** Whether the tunnel is connected and bound. */
  get connected() {
    return this._bound && !this._closed;
  }

  /** The public entrypoint URL (set from config). */
  get entrypoint() {
    return this._bindAddr;
  }

  /** Close the tunnel connection. */
  close() {
    this._closed = true;
    if (this._smux) {
      this._smux.close();
      this._smux = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._bound = false;
  }

  // ── Internal ────────────────────────────────────────────────────────

  _sendBind() {
    const req = new RelayRequest(CmdBind);
    const localEndpoint = this._config.localEndpoint;

    // Parse local endpoint into host + port
    let host, port;
    const colonIdx = localEndpoint.lastIndexOf(':');
    if (colonIdx === -1) {
      host = localEndpoint;
      port = 80;
    } else {
      host = localEndpoint.substring(0, colonIdx);
      port = parseInt(localEndpoint.substring(colonIdx + 1), 10) || 80;
    }

    // TunnelFeature with our tunnel ID
    req.addFeature(FeatureTunnel, this._tunnelId);

    // UserAuthFeature — relay-level bind auth. wisper uses public tunnels, so
    // this is empty (matches the Go reference: its chain node sets no connector
    // Auth, so GOST's tunnel connector sends no/empty UserAuth). This is NOT the
    // HTTP basic-auth credential — that guards the public endpoint and is
    // enforced client-side in forwarder.js (isAuthorized). Do not put
    // config.auth here: it would leak the endpoint password to the relay bind
    // and conflate two unrelated credentials.
    req.addFeature(FeatureUserAuth, ['', '']);

    // AddrFeature for source (local address)
    req.addFeature(FeatureAddr, [host, port]);

    // AddrFeature for destination
    req.addFeature(FeatureAddr, ['0.0.0.0', port]);

    // NetworkFeature (TCP)
    req.addFeature(FeatureNetwork, NetworkTCP);

    // MetadataFeature — record.mode controls traffic recording privacy.
    // Valid values: "full" (full), "headers" (headers only), "off" (disabled).
    // "" is the relay protocol value for full recording (translated from "full").
    // Defaults to "off". The server-side handler propagates this to the
    // RecorderObject so no request/response data is captured unless the
    // user explicitly opts in.
    const VALID_RECORD_MODES = new Set(['', 'full', 'headers', 'off']);
    let recordMode = VALID_RECORD_MODES.has(this._config.recordMode)
      ? this._config.recordMode
      : 'off';
    // Map "full" → "" for relay protocol compatibility ("" means full recording).
    if (recordMode === 'full') recordMode = '';
    req.addFeature(FeatureMetadata, { 'record.mode': recordMode });

    this._ws.send(req.encode().buffer);
  }

  _handleStream(stream) {
    // Apply stream wrapper (e.g. byte counting) before ANY reads — the relay
    // response header and HTTP request are both consumed from this stream before
    // the onStream callback fires, so wrapping too late misses those bytes.
    if (this._wrapStream) {
      stream = this._wrapStream(stream);
    }

    // Step 1: Read the relay Response (peer address info) from the stream.
    // Escaped carry bytes (from over-reading the stream) must be forwarded
    // to _readHTTP or they are lost forever.
    this._readRelayResponse(stream).then(({peerAddr, carry}) => {
      if (!this._onStream) {
        stream.close();
        return;
      }

      // Step 2: Read HTTP request from the stream
      this._readHTTP(stream, peerAddr, carry).then((req) => {
        if (!req) {
          stream.close();
          return;
        }
        // Step 3: Deliver to handler
        this._onStream({ stream, request: req, peerAddr });
      }).catch(() => stream.close());
    }).catch(() => stream.close());
  }

  async _readRelayResponse(stream) {
    // relay Response header is 4 bytes fixed + variable features.
    // Read 4 bytes first to get features length.
    let headerBuf = new Uint8Array(0);
    while (headerBuf.length < 4) {
      const chunk = await stream.read();
      if (!chunk) throw new Error('stream closed before relay response');
      const merged = new Uint8Array(headerBuf.length + chunk.length);
      merged.set(headerBuf);
      merged.set(chunk, headerBuf.length);
      headerBuf = merged;
    }

    const dv = new DataView(headerBuf.buffer, headerBuf.byteOffset, 4);
    const version = dv.getUint8(0);
    if (version !== 0x01) throw new Error(`bad relay version: ${version}`);
    const status = dv.getUint8(1);
    const flen = dv.getUint16(2, false); // BE

    // Read features
    let dataBuf = headerBuf.slice(4);
    while (dataBuf.length < flen) {
      const chunk = await stream.read();
      if (!chunk) throw new Error('stream closed before features');
      const merged = new Uint8Array(dataBuf.length + chunk.length);
      merged.set(dataBuf);
      merged.set(chunk, dataBuf.length);
      dataBuf = merged;
    }

    const totalFeatures = dataBuf.slice(0, flen);
    const carry = dataBuf.slice(flen);

    // Build the wire buffer from just the header + known feature bytes so
    // relayResponseFromWire never sees stray bytes past the feature span.
    const resp = relayResponseFromWire(
      new Uint8Array([...headerBuf.slice(0, 4), ...totalFeatures]),
    );
    if (resp.status !== StatusOK) {
      throw new Error(`peer relay response: status ${resp.status}`);
    }

    const addrFeat = findFeature(resp.features, FeatureAddr);
    return { peerAddr: addrFeat ? addrFeat.value : null, carry };
  }

  async _readHTTP(stream, peerAddr, carry = new Uint8Array(0)) {
    // Read until we have the full HTTP request headers (\r\n\r\n).
    // carry holds any bytes over-read from the relay response that belong
    // to this HTTP request; seed the buffer with them so nothing is lost.
    let buf = new Uint8Array(carry);
    let headerEnd = indexOfSequence(buf, [0x0d, 0x0a, 0x0d, 0x0a]);

    while (headerEnd === -1) {
      const chunk = await stream.read();
      if (!chunk) return null;

      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf);
      merged.set(chunk, buf.length);
      buf = merged;

      // Search for \r\n\r\n
      headerEnd = indexOfSequence(buf, [0x0d, 0x0a, 0x0d, 0x0a]);
    }

    const headerBytes = buf.slice(0, headerEnd);
    let bodyBytes = buf.slice(headerEnd + 4);
    const headerStr = new TextDecoder().decode(headerBytes);

    const { method, path, headers } = parseHTTPRequest(headerStr);

    // Read the request body. The relay may carry either a Content-Length or a
    // Transfer-Encoding: chunked body (Go's http.ReadRequest decodes chunked
    // before forwarding, so what reaches us is always either a fixed-length
    // Content-Length body or chunked-encoded bytes). fetch() understands
    // neither raw chunked bytes nor a Uint8Array carrying them, so we decode
    // chunked here and hand fetch() a plain byte body + Content-Length.
    const contentLength = parseInt(headerValue(headers, 'content-length'), 10);
    const transferEncoding = (headerValue(headers, 'transfer-encoding') || '').toLowerCase();

    if (transferEncoding.includes('chunked')) {
      // Read the full chunked stream (may span more SMUX frames) and decode.
      bodyBytes = await readChunkedBody(stream, bodyBytes);
      // We decoded the body — replace the framing headers so fetch() sends it
      // as a fixed-length body. Strip the original headers below.
      delete headers['transfer-encoding'];
      headers['content-length'] = [String(bodyBytes.length)];
    } else if (contentLength > 0) {
      while (bodyBytes.length < contentLength) {
        const chunk = await stream.read();
        if (!chunk) break;
        const merged = new Uint8Array(bodyBytes.length + chunk.length);
        merged.set(bodyBytes);
        merged.set(chunk, bodyBytes.length);
        bodyBytes = merged;
      }
      // Truncate any over-read bytes that belong to the next request.
      if (bodyBytes.length > contentLength) {
        bodyBytes = bodyBytes.slice(0, contentLength);
      }
    }

    return {
      method,
      path,
      headers,
      body: bodyBytes.length > 0 ? bodyBytes : null,
      peerAddr,
    };
  }

  _onSmuxClose() {
    this._bound = false;
    if (this.onClose) this.onClose();
  }

  _onError(err) {
    const extra = this._closeCode
      ? ` (ws close: code=${this._closeCode} reason="${this._closeReason}")`
      : '';
    console.error(`TunnelConnection(${this._relayUrl}):`, err.message + extra);
  }
}

// ── HTTP request parser (stdlib-free) ──────────────────────────────────

/**
 * parseHTTPRequest — parse raw HTTP request headers into structured form.
 *
 * Input: "GET /path HTTP/1.1\r\nHost: example.com\r\nHeader: value\r\n"
 *
 * Returns { method, path, headers }. Header names are lowercased; values are
 * stored as arrays to preserve duplicate headers (e.g. Set-Cookie, Cookie).
 */
export function parseHTTPRequest(raw) {
  const lines = raw.split('\r\n');
  if (lines.length === 0) throw new Error('empty HTTP request');

  // Request line: "METHOD /path HTTP/1.1"
  const reqLine = lines[0].split(' ');
  const method = reqLine[0] || 'GET';
  const path = reqLine[1] || '/';

  // Headers — preserve multi-value (array) headers like Set-Cookie/Cookie.
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const colonPos = line.indexOf(':');
    if (colonPos === -1) continue;
    const name = line.substring(0, colonPos).trim().toLowerCase();
    const value = line.substring(colonPos + 1).trim();
    if (headers[name] === undefined) {
      headers[name] = [value];
    } else {
      headers[name].push(value);
    }
  }

  return { method, path, headers };
}

/**
 * headerValue — first value for a (possibly multi-value) header, joined by
 * ", " for multiple values when joined=true.
 */
function headerValue(headers, name, joined = false) {
  const v = headers[name];
  if (v === undefined) return undefined;
  return joined ? v.join(', ') : v[0];
}

/**
 * readChunkedBody — read and decode an HTTP/1.1 chunked body from a stream.
 *
 * `carry` holds any chunked bytes already buffered past the header boundary.
 * Reads further chunks from the stream until the terminating 0-length chunk.
 * Returns the fully decoded body as a Uint8Array.
 */
async function readChunkedBody(stream, carry) {
  let buf = carry;
  const out = [];

  for (;;) {
    // Find the next CRLF that delimits a chunk-size line.
    let crlf = indexOfSequence(buf, [0x0d, 0x0a]);
    while (crlf === -1) {
      const chunk = await stream.read();
      if (!chunk) throw new Error('stream closed mid chunked body');
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf);
      merged.set(chunk, buf.length);
      buf = merged;
      crlf = indexOfSequence(buf, [0x0d, 0x0a]);
    }

    const sizeLine = new TextDecoder().decode(buf.subarray(0, crlf));
    const sizeToken = sizeLine.split(';')[0].trim(); // ignore chunk extensions
    const size = parseInt(sizeToken, 16);
    if (isNaN(size)) throw new Error(`bad chunk size: "${sizeLine}"`);

    buf = buf.subarray(crlf + 2); // past the size CRLF

    if (size === 0) {
      // Read trailing CRLF (after any trailer headers). Trailers are rare; we
      // consume up to and including the final CRLF that ends the chunked body.
      for (;;) {
        const end = indexOfSequence(buf, [0x0d, 0x0a]);
        if (end !== -1) {
          if (end === 0) break; // empty line → end of trailers
          buf = buf.subarray(end + 2);
          continue;
        }
        const chunk = await stream.read();
        if (!chunk) break;
        const merged = new Uint8Array(buf.length + chunk.length);
        merged.set(buf);
        merged.set(chunk, buf.length);
        buf = merged;
      }
      break;
    }

    // Read `size` bytes of chunk data plus the trailing CRLF.
    while (buf.length < size + 2) {
      const chunk = await stream.read();
      if (!chunk) throw new Error('stream closed mid chunked body');
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf);
      merged.set(chunk, buf.length);
      buf = merged;
    }
    out.push(buf.subarray(0, size));
    buf = buf.subarray(size + 2); // skip chunk data + trailing CRLF
  }

  const total = out.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of out) {
    body.set(c, off);
    off += c.length;
  }
  return body;
}

// Exposed for unit testing (decode a chunked body from a fake stream).
export async function decodeChunkedBodyFromStream(stream, carry) {
  return readChunkedBody(stream, carry);
}

/**
 * indexOfSequence — find the first occurrence of a byte sequence in a Uint8Array.
 */
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
