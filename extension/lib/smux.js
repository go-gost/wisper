/**
 * smux.js — SMUX v2 stream multiplexer (server-side).
 *
 * Wire-compatible with xtaci/smux (Go). Reference:
 *   - x/internal/util/mux/mux.go (GOST wrapper)
 *   - github.com/xtaci/smux (v1.5.31, used by GOST)
 *
 * Frame format (8-byte header, all integers LittleEndian):
 *   | VER(1) | CMD(1) | LENGTH(2, LE) | STREAMID(4, LE) | DATA(LENGTH) |
 *
 * Version: 2 (default in GOST x/handler/tunnel/metadata.go:168-170)
 *
 * Commands:
 *   0 = cmdSYN — open new stream
 *   1 = cmdFIN — close stream
 *   2 = cmdPSH — push data
 *   3 = cmdNOP — keepalive
 *   4 = cmdUPD — flow control window update (v2 only)
 *
 * cmdUPD payload (8 bytes):
 *   | CONSUMED(4, LE) | WINDOW(4, LE) |
 *   CONSUMED is an ABSOLUTE counter (total bytes the peer has READ OUT of the
 *   stream), not a delta. WINDOW is the ABSOLUTE peer receive window size.
 *   Both are REPLACED (not added) on receipt — see Go stream.update().
 *
 * Flow control (mirrors Go stream.writeV2 / tryReadv2):
 *   Write side (us → peer):  win = peerWindow - (numWritten - peerConsumed).
 *     Send at most `win` bytes, split into frames of ≤ MAX_FRAME_SIZE. When
 *     win ≤ 0, block until a cmdUPD advances peerConsumed.
 *   Read side (peer → us):   on each chunk read OUT via Stream.read(), account
 *     it in numRead and send a cmdUPD(consumed=numRead, window=MAX_STREAM_BUFFER)
 *     on the first read and whenever ≥ MAX_STREAM_BUFFER/2 bytes have been
 *     consumed since the last UPD — i.e. we advertise credit for bytes actually
 *     drained, not merely received. This is what lets the peer back-pressure us.
 *
 * Stream IDs:
 *   Client (relay): odd, starting from 1, increment by 2
 *   Server (this):  even, starting from 0, increment by 2 (we never open streams)
 *
 * No initial handshake. Version checked per-frame. A keepalive NOP is sent every
 * 10s; if no frame is received within 30s the session is closed as a dead link
 * (mirrors Go smux KeepAliveTimeout).
 */

// ── Constants ──────────────────────────────────────────────────────────

const HEADER_LEN = 8;
const CMD_SYN = 0;
const CMD_FIN = 1;
const CMD_PSH = 2;
const CMD_NOP = 3;
const CMD_UPD = 4;
const SZ_CMD_UPD = 8;
const INITIAL_PEER_WINDOW = 262144; // initialPeerWindow from xtaci/smux frame.go
const MAX_STREAM_BUFFER = 1048576;  // from metadata.go default
const MAX_FRAME_SIZE = 32768;        // smux DefaultConfig().MaxFrameSize
const NOP_INTERVAL = 10000;          // 10s keepalive send
const KEEPALIVE_TIMEOUT = 30000;     // 30s no-recv → dead link
const KEEPALIVE_CHECK_INTERVAL = 5000;
const UPD_THRESHOLD = MAX_STREAM_BUFFER >> 1; // 524288

// ── SmuxServer ─────────────────────────────────────────────────────────

export class SmuxServer {
  /**
   * @param {object} callbacks
   * @param {function} callbacks.onStream — called with Stream when relay opens a new stream
   * @param {function} [callbacks.onError] — called on protocol error
   * @param {function} [callbacks.onClose] — called when session is closed
   */
  constructor(callbacks = {}) {
    this._cb = callbacks;
    this._streams = new Map();     // streamId → StreamState
    this._buffer = new Uint8Array(0);
    this._version = 2;            // v2, matching GOST default
    this._closed = false;
    this._output = null;          // set by setOutput()
    this._nopTimer = null;
    this._timeoutTimer = null;
    this._lastRecvAt = Date.now();
  }

  /** Set the output function that writes frames back to the transport. */
  setOutput(fn) {
    this._output = fn;
  }

  /** Feed incoming binary data (from WebSocket). Handles partial frames. */
  feed(data) {
    if (this._closed) return;

    if (this._buffer.length === 0) {
      this._buffer = data;
    } else {
      const merged = new Uint8Array(this._buffer.length + data.length);
      merged.set(this._buffer);
      merged.set(data, this._buffer.length);
      this._buffer = merged;
    }

    this._processFrames();
  }

  /** Close all streams and stop keepalive. */
  close() {
    if (this._closed) return;
    this._closed = true;

    if (this._nopTimer) {
      clearInterval(this._nopTimer);
      this._nopTimer = null;
    }
    if (this._timeoutTimer) {
      clearInterval(this._timeoutTimer);
      this._timeoutTimer = null;
    }

    for (const st of this._streams.values()) {
      this._closeStream(st);
    }
    this._streams.clear();

    if (this._cb.onClose) this._cb.onClose();
  }

  /** Start periodic NOP keepalive + dead-link detection. Call after setOutput. */
  startKeepalive() {
    if (this._nopTimer) return;
    this._lastRecvAt = Date.now();
    this._nopTimer = setInterval(
      () => this._sendFrame(CMD_NOP, 0, new Uint8Array(0)),
      NOP_INTERVAL,
    );
    this._timeoutTimer = setInterval(() => {
      if (this._closed) return;
      if (Date.now() - this._lastRecvAt > KEEPALIVE_TIMEOUT) {
        this._error('keepalive timeout: no data received for 30s');
        this.close();
      }
    }, KEEPALIVE_CHECK_INTERVAL);
  }

  // ── Internal: frame processing ──────────────────────────────────────

  _processFrames() {
    while (this._buffer.length >= HEADER_LEN) {
      const dv = new DataView(this._buffer.buffer, this._buffer.byteOffset, this._buffer.byteLength);
      const ver = dv.getUint8(0);
      const cmd = dv.getUint8(1);
      const len = dv.getUint16(2, true);   // LE
      const sid = dv.getUint32(4, true);   // LE

      const totalLen = HEADER_LEN + len;
      if (this._buffer.length < totalLen) break; // wait for more data

      const data = this._buffer.slice(HEADER_LEN, totalLen);
      this._buffer = this._buffer.slice(totalLen);
      this._lastRecvAt = Date.now();
      this._dispatch(ver, cmd, sid, data);
    }
  }

  _dispatch(ver, cmd, sid, data) {
    if (ver !== this._version) {
      this._error(`bad version: ${ver}`);
      return;
    }

    switch (cmd) {
      case CMD_SYN: this._handleSyn(sid, data); break;
      case CMD_PSH: this._handlePsh(sid, data); break;
      case CMD_FIN: this._handleFin(sid);       break;
      case CMD_NOP: this._sendFrame(CMD_NOP, 0, new Uint8Array(0)); break;
      case CMD_UPD: this._handleUpd(sid, data); break;
      default:
        this._error(`unknown command: ${cmd}`);
    }
  }

  // ── cmd handlers ────────────────────────────────────────────────────

  _handleSyn(sid, data) {
    // Client (relay) opens a new stream to push an inbound request.
    const st = new StreamState(sid, this);
    this._streams.set(sid, st);

    // Piggybacked data on SYN
    if (data && data.length > 0) {
      st._pushData(data);
    }

    // Emit the stream to the consumer
    const stream = new Stream(st);
    if (this._cb.onStream) this._cb.onStream(stream);
  }

  _handlePsh(sid, data) {
    const st = this._streams.get(sid);
    if (!st) {
      // Stream not found — may have been closed; ignore
      return;
    }
    // Credit (cmdUPD) is reported when the consumer READS the data out, not on
    // receipt — this is what back-pressures the peer. See Stream.read().
    st._pushData(data);
  }

  _handleFin(sid) {
    const st = this._streams.get(sid);
    if (!st) return;
    // Remote closed its write side. Mirror Go: reads return EOF, blocked writes
    // error out. Do NOT send FIN back and do NOT drop from the map — the local
    // side's close() does both (Go stream.Close → streamClosed).
    st._remoteClosed = true;
    if (st._readResolve) {
      st._readResolve(null);
      st._readResolve = null;
    }
    if (st._writeResolve) {
      st._writeResolve();
      st._writeResolve = null;
    }
  }

  _handleUpd(sid, data) {
    if (data.length < SZ_CMD_UPD) return;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const consumed = dv.getUint32(0, true);  // LE, absolute
    const window = dv.getUint32(4, true);    // LE, absolute

    const st = this._streams.get(sid);
    if (!st) return;

    // REPLACE (not add) — Go stream.update() stores absolute values.
    st._peerConsumed = consumed;
    st._peerWindow = window;

    // Resume a write blocked on flow control if the window opened up.
    if (st._writeResolve && this._writeWin(st) > 0) {
      st._writeResolve();
      st._writeResolve = null;
    }
  }

  /** Current send window for a stream: peerWindow - (numWritten - peerConsumed). */
  _writeWin(st) {
    const inflight = st._numWritten - st._peerConsumed;
    return st._peerWindow - inflight;
  }

  // ── Internal: frame output ──────────────────────────────────────────

  _sendFrame(cmd, sid, data) {
    if (!this._output || this._closed) return;
    const len = data ? data.length : 0;
    const buf = new Uint8Array(HEADER_LEN + len);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, this._version);
    dv.setUint8(1, cmd);
    dv.setUint16(2, len, true);   // LE — len ≤ MAX_FRAME_SIZE ≤ 65535, no overflow
    dv.setUint32(4, sid, true);   // LE
    if (len > 0) buf.set(data, HEADER_LEN);
    this._output(buf);
  }

  _sendUPD(sid, consumed, window) {
    const data = new Uint8Array(SZ_CMD_UPD);
    const dv = new DataView(data.buffer);
    dv.setUint32(0, consumed, true);  // LE
    dv.setUint32(4, window, true);    // LE
    this._sendFrame(CMD_UPD, sid, data);
  }

  /** Send PSH on behalf of a stream (called by Stream.write). */
  _sendPSH(sid, data) {
    this._sendFrame(CMD_PSH, sid, data);
  }

  /** Send FIN on behalf of a stream (called by Stream.close). */
  _sendFIN(sid) {
    this._sendFrame(CMD_FIN, sid, new Uint8Array(0));
  }

  // ── Internal ────────────────────────────────────────────────────────

  _error(msg) {
    if (this._cb.onError) this._cb.onError(new Error(`SMUX: ${msg}`));
    else console.error(`SMUX: ${msg}`);
  }

  _closeStream(st) {
    st._closed = true;
    st._closing = true;
    if (st._readResolve) {
      st._readResolve(null);
      st._readResolve = null;
    }
    if (st._writeResolve) {
      st._writeResolve();
      st._writeResolve = null;
    }
  }

  _removeStream(sid) {
    this._streams.delete(sid);
  }
}

// ── StreamState ────────────────────────────────────────────────────────

class StreamState {
  constructor(id, session) {
    this.id = id;
    this._session = session;
    this._readQueue = [];      // queue of Uint8Array chunks
    this._readResolve = null;  // pending read() promise resolver
    this._writeResolve = null; // pending write() resolver (blocked on flow control)
    this._closed = false;
    this._closing = false;   // set by close(): rejects new writes, drains queued
    this._remoteClosed = false;

    // Flow-control counters (absolute, mirroring Go stream.go).
    this._numRead = 0;          // bytes read OUT via Stream.read()
    this._updIncr = 0;          // bytes read since last cmdUPD sent
    this._numWritten = 0;       // bytes sent (PSH)
    this._peerConsumed = 0;     // absolute, from peer's cmdUPD
    this._peerWindow = INITIAL_PEER_WINDOW;  // absolute, from peer's cmdUPD

    // Per-stream write serialization. Concurrent write() calls (e.g. a
    // backend→visitor WS frame and a pong frame in flight at once) would
    // otherwise clobber the single _writeResolve slot and lose a waiter.
    // Chaining them serializes flow-control state mutations safely.
    this._writeTail = Promise.resolve();
  }

  _pushData(data) {
    if (this._closed) return;
    if (this._readResolve) {
      this._readResolve(data);
      this._readResolve = null;
    } else {
      this._readQueue.push(data);
    }
  }

  /** Account for a chunk read out of the stream and send credit (cmdUPD). */
  _accountRead(chunk) {
    this._numRead += chunk.length;
    this._updIncr += chunk.length;
    // Send UPD on the first read, or once half the buffer has been consumed
    // since the last UPD — matches Go tryReadv2's batching.
    if (this._numRead === chunk.length || this._updIncr >= UPD_THRESHOLD) {
      this._session._sendUPD(this.id, this._numRead, MAX_STREAM_BUFFER);
      this._updIncr = 0;
    }
  }
}

// ── Stream (public API) ────────────────────────────────────────────────

/**
 * Stream — a single multiplexed stream.
 *
 * API:
 *   await stream.read()  → Uint8Array | null (null = EOF)
 *   await stream.write(data: Uint8Array) → void
 *   await stream.close() → void
 *
 * Properties:
 *   stream.id — stream ID (number)
 *   stream.closed — whether stream is closed
 */
export class Stream {
  constructor(st) {
    this._st = st;
  }

  get id() { return this._st.id; }

  get closed() {
    return this._st._closed || this._st._closing || this._st._remoteClosed;
  }

  /** Read next chunk. Returns null on EOF. */
  async read() {
    const st = this._st;
    if (st._closed) return null;

    if (st._readQueue.length > 0) {
      const chunk = st._readQueue.shift();
      st._accountRead(chunk);
      return chunk;
    }

    if (st._remoteClosed) return null;

    // Wait for data (or EOF via FIN, which resolves with null).
    const chunk = await new Promise(resolve => {
      st._readResolve = resolve;
    });
    if (!chunk) return null; // FIN
    st._accountRead(chunk);
    return chunk;
  }

  /**
   * Write data to this stream. Respects flow control (awaits if the send
   * window is exhausted) and splits into ≤ MAX_FRAME_SIZE PSH frames —
   * required because the LENGTH field is uint16 and Go's peer caps frame
   * size at 32768. A single oversized frame would overflow LENGTH and
   * permanently desync the session.
   *
   * Concurrent write() calls on the same stream are serialized so that the
   * single flow-control waiter slot isn't clobbered and `_numWritten` stays
   * consistent.
   */
  write(data) {
    const st = this._st;
    if (st._closed || st._closing || st._remoteClosed) {
      return Promise.reject(new Error('stream closed'));
    }
    st._writeTail = st._writeTail.then(() => this._writeSync(data)).catch(() => {});
    // Detach: return a promise that resolves with the outcome of THIS write
    // only, not chained to a prior failure (which would propagate incorrectly).
    return st._writeTail.then(
      () => {},
      () => { throw new Error('stream closed'); },
    );
  }

  async _writeSync(data) {
    const st = this._st;
    if (st._closed || st._remoteClosed) {
      throw new Error('stream closed');
    }

    let offset = 0;
    while (offset < data.length) {
      let win = st._session._writeWin(st);
      while (win <= 0 && !st._closed && !st._remoteClosed) {
        await new Promise(resolve => {
          st._writeResolve = resolve;
        });
        st._writeResolve = null;
        win = st._session._writeWin(st);
      }

      if (st._closed || st._remoteClosed) {
        throw new Error('stream closed');
      }

      const remaining = data.length - offset;
      const chunkLen = Math.min(win, remaining, MAX_FRAME_SIZE);
      if (chunkLen <= 0) continue;

      const chunk = data.subarray(offset, offset + chunkLen);
      st._session._sendPSH(st.id, chunk);
      st._numWritten += chunkLen;
      offset += chunkLen;
    }
  }

  /**
   * Close this stream (send FIN). Returns a promise that resolves once any
   * writes still queued on the stream's write tail have been driven to
   * completion (or rejected) — this guarantees the FIN is sent AFTER the
   * pending PSH data, not before it.
   *
   * Why this matters: Stream.write() chains work onto `_writeTail` and the
   * actual PSH send happens in a later microtask (_writeSync). A SYNCHRONOUS
   * close() that immediately set `_closed=true` and sent FIN would make those
   * queued _writeSync calls throw "stream closed" on the next tick — silently
   * dropping the head/body a caller just wrote. By draining the tail first,
   * close() preserves frame order (PSH…PSH…FIN) even when the caller did not
   * await every write (as can happen on the WebSocket frame-bridge path).
   *
   * `force` (rare) skips the drain and sends FIN immediately, for use when the
   * caller knows the stream is being torn down hard and pending writes should
   * be abandoned.
   */
  close(force) {
    const st = this._st;
    if (st._closed) return;
    if (force) {
      st._closed = true;
      if (st._readResolve) { st._readResolve(null); st._readResolve = null; }
      if (st._writeResolve) { st._writeResolve(); st._writeResolve = null; }
      st._session._sendFIN(st.id);
      st._session._removeStream(st.id);
      return;
    }

    // Mark closing: rejects NEW write() calls immediately, but does NOT set
    // _closed yet — queued _writeSync calls check _closed (not _closing), so
    // they still run and the data is sent before the FIN.
    st._closing = true;
    // Unblock any read()/write() currently blocked on flow control.
    if (st._readResolve) { st._readResolve(null); st._readResolve = null; }
    if (st._writeResolve) { st._writeResolve(); st._writeResolve = null; }

    // Drain pending writes, then finalize: set _closed, send FIN, remove.
    // Errors in the tail (e.g. a write that fails because the remote closed
    // mid-drain) are swallowed — close() must still send FIN and remove.
    st._writeTail = st._writeTail
      .catch(() => {})
      .then(() => {
        st._closed = true;
        st._session._sendFIN(st.id);
        st._session._removeStream(st.id);
      });
    return st._writeTail;
  }
}
