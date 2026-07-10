/**
 * ws-codec.js — minimal RFC 6455 WebSocket frame codec.
 *
 * Used by the tunnel host to bridge a visitor's WebSocket (which arrives over
 * the SMUX stream as RAW frames after the 101 upgrade — the GOST relay does
 * raw byte piping post-upgrade, see x/handler/tunnel/entrypoint/ephttp.go
 * handleUpgradeResponse → xnet.Pipe) to a local `WebSocket` opened to the
 * backend via the browser API.
 *
 * The browser `WebSocket` API hides framing: it gives us decoded message
 * payloads and accepts payloads to send. So we must:
 *   - visitor → backend: DECODE the visitor's (masked) frames, hand payloads
 *     to `ws.send(payload)`.
 *   - backend → visitor: RE-ENCODE backend payloads as (unmasked) server
 *     frames and write them onto the SMUX stream.
 *   - Compute Sec-WebSocket-Accept from the visitor's Sec-WebSocket-Key so the
 *     visitor accepts our 101 (the browser's own 101 to the backend is consumed
 *     by the browser and cannot be forwarded verbatim).
 *
 * Server-to-client frames are sent UNMASKED (RFC 6455 §5.1). Visitor
 * (client-to-server) frames are MASKED and we demask on decode.
 */

export const OP_CONT = 0x0;
export const OP_TEXT = 0x1;
export const OP_BINARY = 0x2;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : '=';
  }
  return out;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * wsAccept — compute Sec-WebSocket-Accept for a visitor's Sec-WebSocket-Key.
 *   accept = base64(sha1(key + GUID))
 */
export async function wsAccept(key) {
  const data = new TextEncoder().encode(key + WS_GUID);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  return base64(digest);
}

/**
 * WsDecoder — stateful decoder for inbound (visitor) frames.
 *
 * push(data) appends received bytes; parse() returns an array of decoded
 * events, draining complete frames from the buffer. Fragmented data messages
 * are reassembled: only a complete message (FIN=1) yields a 'data' event.
 *
 * Event shapes:
 *   { type: 'data',  opcode, payload }   — complete data message (text/binary)
 *   { type: 'close', payload }            — close frame (payload may be empty)
 *   { type: 'ping',  payload }            — ping; reply with pong of same payload
 *   { type: 'pong',  payload }            — pong; ignore
 */
export class WsDecoder {
  constructor() {
    this._buf = new Uint8Array(0);
    this._frag = null; // { opcode, payload } while accumulating continuations
  }

  push(data) {
    if (this._buf.length === 0) {
      this._buf = data;
    } else {
      this._buf = concat(this._buf, data);
    }
  }

  parse() {
    const frames = [];
    for (;;) {
      const f = this._parseOne();
      if (f === null) break;
      if (f !== 'more') frames.push(f);
    }
    return frames;
  }

  _parseOne() {
    const b = this._buf;
    if (b.length < 2) return null;
    const b0 = b[0];
    const b1 = b[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    const len7 = b1 & 0x7f;

    let off = 2;
    let len;
    if (len7 < 126) {
      len = len7;
    } else if (len7 === 126) {
      if (b.length < 4) return null;
      len = (b[2] << 8) | b[3];
      off = 4;
    } else {
      if (b.length < 10) return null;
      if (b[2] || b[3] || b[4] || b[5]) {
        // length exceeds 2^32 — unsupported; drop the buffer to resync
        this._buf = new Uint8Array(0);
        return { type: 'close', payload: new Uint8Array(0) };
      }
      len = ((b[6] << 24) | (b[7] << 16) | (b[8] << 8) | b[9]) >>> 0;
      off = 10;
    }

    let maskKey = null;
    if (masked) {
      if (b.length < off + 4) return null;
      maskKey = b.subarray(off, off + 4);
      off += 4;
    }

    if (b.length < off + len) return null; // incomplete payload — wait for more

    let payload = b.subarray(off, off + len);
    if (masked) {
      const demasked = new Uint8Array(len);
      for (let i = 0; i < len; i++) demasked[i] = payload[i] ^ maskKey[i & 3];
      payload = demasked;
    }

    // consume the frame from the buffer
    this._buf = b.subarray(off + len);

    if (opcode === OP_TEXT || opcode === OP_BINARY) {
      if (fin) return { type: 'data', opcode, payload };
      this._frag = { opcode, payload: new Uint8Array(payload) };
      return 'more';
    }
    if (opcode === OP_CONT) {
      if (!this._frag) return { type: 'close', payload: new Uint8Array(0) }; // unsolicited continuation
      const merged = concat(this._frag.payload, payload);
      if (fin) {
        const op = this._frag.opcode;
        this._frag = null;
        return { type: 'data', opcode: op, payload: merged };
      }
      this._frag.payload = merged;
      return 'more';
    }
    if (opcode === OP_CLOSE) return { type: 'close', payload };
    if (opcode === OP_PING) return { type: 'ping', payload };
    if (opcode === OP_PONG) return { type: 'pong', payload };
    return { type: 'close', payload: new Uint8Array(0) };
  }
}

/**
 * encodeWsFrame — encode a WebSocket frame to send to the visitor.
 *
 * Server-to-client frames are UNMASKED (masked=false, the default). Set
 * masked=true only if encoding a client-to-server frame.
 */
export function encodeWsFrame(opcode, payload, masked = false) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = new Uint8Array([0x80 | opcode, (masked ? 0x80 : 0) | len]);
  } else if (len < 65536) {
    header = new Uint8Array(4);
    header[0] = 0x80 | opcode;
    header[1] = (masked ? 0x80 : 0) | 126;
    header[2] = (len >> 8) & 0xff;
    header[3] = len & 0xff;
  } else {
    header = new Uint8Array(10);
    header[0] = 0x80 | opcode;
    header[1] = (masked ? 0x80 : 0) | 127;
    // high 4 bytes are zero (len < 2^32)
    header[6] = (len >>> 24) & 0xff;
    header[7] = (len >>> 16) & 0xff;
    header[8] = (len >>> 8) & 0xff;
    header[9] = len & 0xff;
  }

  if (!masked) {
    const out = new Uint8Array(header.length + len);
    out.set(header, 0);
    out.set(payload, header.length);
    return out;
  }

  const mask = new Uint8Array(4);
  crypto.getRandomValues(mask);
  const maskedPayload = new Uint8Array(len);
  for (let i = 0; i < len; i++) maskedPayload[i] = payload[i] ^ mask[i & 3];
  const out = new Uint8Array(header.length + 4 + len);
  out.set(header, 0);
  out.set(mask, header.length);
  out.set(maskedPayload, header.length + 4);
  return out;
}
