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

import { CmdBind, StatusOK, FeatureUserAuth, FeatureAddr, FeatureTunnel, FeatureNetwork, NetworkTCP } from './relay.js';
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

      this._ws.onclose = () => {
        if (!this._bound && !this._closed) {
          reject(new Error('WebSocket closed before bind response'));
        }
        this._onSmuxClose();
      };

      this._ws.onerror = (e) => {
        if (!this._bound) {
          reject(new Error('WebSocket connection failed'));
        }
        this._onError(new Error('WebSocket error'));
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

    // UserAuthFeature
    const auth = this._config.auth || {};
    req.addFeature(FeatureUserAuth, [auth.username || '', auth.password || '']);

    // AddrFeature for source (local address)
    req.addFeature(FeatureAddr, [host, port]);

    // AddrFeature for destination
    req.addFeature(FeatureAddr, ['0.0.0.0', port]);

    // NetworkFeature (TCP)
    req.addFeature(FeatureNetwork, NetworkTCP);

    this._ws.send(req.encode().buffer);
  }

  _handleStream(stream) {
    // Step 1: Read the relay Response (peer address info) from the stream
    this._readRelayResponse(stream).then((peerAddr) => {
      if (!this._onStream) {
        stream.close();
        return;
      }

      // Step 2: Read HTTP request from the stream
      this._readHTTP(stream, peerAddr).then((req) => {
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

    const resp = relayResponseFromWire(new Uint8Array([...headerBuf, ...dataBuf]));
    if (resp.status !== StatusOK) {
      throw new Error(`peer relay response: status ${resp.status}`);
    }

    const addrFeat = findFeature(resp.features, FeatureAddr);
    return addrFeat ? addrFeat.value : null;
  }

  async _readHTTP(stream, peerAddr) {
    // Read until we have the full HTTP request headers (\r\n\r\n)
    let buf = new Uint8Array(0);
    let headerEnd = -1;

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

    // Read remaining body based on Content-Length if not all buffered
    const contentLength = parseInt(headers['content-length'], 10);
    if (contentLength > 0) {
      while (bodyBytes.length < contentLength) {
        const chunk = await stream.read();
        if (!chunk) break;
        const merged = new Uint8Array(bodyBytes.length + chunk.length);
        merged.set(bodyBytes);
        merged.set(chunk, bodyBytes.length);
        bodyBytes = merged;
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
    console.error('TunnelConnection error:', err.message);
  }
}

// ── HTTP request parser (stdlib-free) ──────────────────────────────────

/**
 * parseHTTPRequest — parse raw HTTP request headers into structured form.
 *
 * Input: "GET /path HTTP/1.1\r\nHost: example.com\r\nHeader: value\r\n"
 *
 * Returns { method, path, headers }.
 */
function parseHTTPRequest(raw) {
  const lines = raw.split('\r\n');
  if (lines.length === 0) throw new Error('empty HTTP request');

  // Request line: "METHOD /path HTTP/1.1"
  const reqLine = lines[0].split(' ');
  const method = reqLine[0] || 'GET';
  const path = reqLine[1] || '/';

  // Headers
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const colonPos = line.indexOf(':');
    if (colonPos === -1) continue;
    const name = line.substring(0, colonPos).trim().toLowerCase();
    const value = line.substring(colonPos + 1).trim();
    headers[name] = value;
  }

  return { method, path, headers };
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
