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
 *
 * Stream IDs:
 *   Client (relay): odd, starting from 1, increment by 2
 *   Server (this):  even, starting from 0, increment by 2
 *
 * No initial handshake. Version checked per-frame.
 * Default MaxStreamBuffer = 1048576 (1 MB, from GOST config).
 */

// ── Constants ──────────────────────────────────────────────────────────

const HEADER_LEN = 8;
const CMD_SYN = 0;
const CMD_FIN = 1;
const CMD_PSH = 2;
const CMD_NOP = 3;
const CMD_UPD = 4;
const SZ_CMD_UPD = 8;
const INITIAL_PEER_WINDOW = 262144; // initialPeerWindow from xtaci/smux
const MAX_STREAM_BUFFER = 1048576;   // from metadata.go default
const NOP_INTERVAL = 10000;          // 10s keepalive

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
      // ponytail: simple concat, per-stream WindowUpdate bounds growth
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

    for (const st of this._streams.values()) {
      this._closeStream(st);
    }
    this._streams.clear();

    if (this._cb.onClose) this._cb.onClose();
  }

  /** Start periodic NOP keepalive. Call after setting output. */
  startKeepalive() {
    if (this._nopTimer) return;
    this._nopTimer = setInterval(() => this._sendFrame(CMD_NOP, 0, new Uint8Array(0)), NOP_INTERVAL);
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
    st._pushData(data);

    // Send cmdUPD on every PSH (v2 flow control).
    // We consumed len(data) bytes, advertise MAX_STREAM_BUFFER window.
    st._consumedTotal += data.length;
    this._sendUPD(sid, st._consumedTotal, MAX_STREAM_BUFFER);
  }

  _handleFin(sid) {
    const st = this._streams.get(sid);
    if (!st) return;
    st._remoteClosed = true;
    // Resolve pending read with null (EOF)
    if (st._readResolve) {
      st._readResolve(null);
      st._readResolve = null;
    }
  }

  _handleUpd(sid, data) {
    if (data.length < SZ_CMD_UPD) return;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const consumed = dv.getUint32(0, true);  // LE
    const window = dv.getUint32(4, true);    // LE

    const st = this._streams.get(sid);
    if (!st) return;

    st._peerWindow += consumed;  // bytes the peer consumed → free up our send budget
    st._peerWindowSize = window; // new advertised window from peer

    // Resume pending writes if they were blocked on flow control
    if (st._writeResolve && st._peerWindow > 0) {
      st._writeResolve();
      st._writeResolve = null;
    }
  }

  // ── Internal: frame output ──────────────────────────────────────────

  _sendFrame(cmd, sid, data) {
    if (!this._output) return;
    const len = data ? data.length : 0;
    const buf = new Uint8Array(HEADER_LEN + len);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, this._version);
    dv.setUint8(1, cmd);
    dv.setUint16(2, len, true);   // LE
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
    this._remoteClosed = false;
    this._consumedTotal = 0;   // total bytes consumed (for cmdUPD)
    this._peerWindow = INITIAL_PEER_WINDOW;  // bytes we can still send
    this._peerWindowSize = INITIAL_PEER_WINDOW;
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
    return this._st._closed || this._st._remoteClosed;
  }

  /** Read next chunk. Returns null on EOF. */
  async read() {
    const st = this._st;
    if (st._closed) return null;

    // Return queued data immediately
    if (st._readQueue.length > 0) {
      const chunk = st._readQueue.shift();
      // ponytail: batch UPD — one per read, not per chunk.
      // This matches smux semantics where consumed is reported per-stream.
      return chunk;
    }

    if (st._remoteClosed) return null;

    // Wait for data
    return new Promise(resolve => {
      st._readResolve = resolve;
    });
  }

  /** Write data to this stream. Respects flow control (awaits if necessary). */
  async write(data) {
    const st = this._st;
    if (st._closed || st._remoteClosed) {
      throw new Error('stream closed');
    }

    // Flow control: wait until peer has window space
    // ponytail: global lock, per-stream windows if throughput matters
    while (st._peerWindow < data.length && !st._closed) {
      await new Promise(resolve => {
        st._writeResolve = resolve;
      });
    }

    if (st._closed || st._remoteClosed) {
      throw new Error('stream closed');
    }

    st._peerWindow -= data.length;
    st._session._sendPSH(st.id, data);
  }

  /** Close this stream (send FIN). */
  close() {
    const st = this._st;
    if (st._closed) return;
    st._closed = true;

    // Resolve any waiters
    if (st._readResolve) { st._readResolve(null); st._readResolve = null; }
    if (st._writeResolve) { st._writeResolve(); st._writeResolve = null; }

    st._session._sendFIN(st.id);
    st._session._removeStream(st.id);
  }
}
