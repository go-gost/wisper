/**
 * relay.js — GOST relay protocol v1 encoder/decoder.
 *
 * Wire format (reference: relay/relay.go, relay/feature.go):
 *
 *   Request:  | VER(1) | CMD(1) | FEALEN(2, BE) | FEATURES(VAR) |
 *   Response: | VER(1) | STATUS(1) | FEALEN(2, BE) | FEATURES(VAR) |
 *
 * Each feature: | TYPE(1) | LEN(2, BE) | DATA(VAR) |
 *
 * All multi-byte integers in the relay layer are BigEndian.
 */

// ── Protocol constants ────────────────────────────────────────────────

export const Version1 = 0x01;

// Commands (request)
export const CmdConnect = 0x01;
export const CmdBind = 0x02;
export const CmdAssociate = 0x03;

// Command flags
export const FUDP = 0x80;

// Response status
export const StatusOK = 0x00;
export const StatusBadRequest = 0x01;
export const StatusUnauthorized = 0x02;
export const StatusForbidden = 0x03;
export const StatusTimeout = 0x04;
export const StatusServiceUnavailable = 0x05;
export const StatusHostUnreachable = 0x06;
export const StatusNetworkUnreachable = 0x07;
export const StatusInternalServerError = 0x08;

// Feature types
export const FeatureUserAuth = 0x01;
export const FeatureAddr = 0x02;
export const FeatureTunnel = 0x03;
export const FeatureNetwork = 0x04;
export const FeatureMetadata = 0x05;

// Address types
export const AddrIPv4 = 1;
export const AddrDomain = 3;
export const AddrIPv6 = 4;

// Network IDs
export const NetworkTCP = 0x0000;
export const NetworkUDP = 0x0001;

// Feature header length
const FEATURE_HEADER_LEN = 3;

// ── Errors ────────────────────────────────────────────────────────────

export class RelayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RelayError';
  }
}

// ── Feature encoders/decoders ─────────────────────────────────────────

/**
 * encodeUserAuth — encode username + password as UserAuthFeature.
 *
 * Wire format:
 *   | ULEN(1) | UNAME(0-255) | PLEN(1) | PASSWD(0-255) |
 */
export function encodeUserAuth(username, password) {
  const uname = new TextEncoder().encode(username || '');
  const pwd = new TextEncoder().encode(password || '');
  if (uname.length > 0xff) throw new RelayError('username max length exceeded');
  if (pwd.length > 0xff) throw new RelayError('password max length exceeded');

  const buf = new Uint8Array(2 + uname.length + pwd.length);
  buf[0] = uname.length;
  buf.set(uname, 1);
  buf[1 + uname.length] = pwd.length;
  buf.set(pwd, 2 + uname.length);
  return buf;
}

/**
 * decodeUserAuth — decode a UserAuthFeature payload.
 */
export function decodeUserAuth(data) {
  if (data.length < 2) throw new RelayError('short buffer');
  let pos = 0;
  const ulen = data[pos++];
  if (data.length < pos + ulen + 1) throw new RelayError('short buffer');
  const username = new TextDecoder().decode(data.slice(pos, pos + ulen));
  pos += ulen;
  const plen = data[pos++];
  if (data.length < pos + plen) throw new RelayError('short buffer');
  const password = new TextDecoder().decode(data.slice(pos, pos + plen));
  return { username, password };
}

/**
 * encodeAddr — encode host + port as AddrFeature.
 *
 * Wire format:
 *   | ATYP(1) | ADDR(VAR) | PORT(2, BE) |
 *
 * ATYP 1 (IPv4):  4 bytes address + 2 bytes port = 7 total
 * ATYP 3 (domain): 1 byte length + name + 2 bytes port
 * ATYP 4 (IPv6):  16 bytes address + 2 bytes port = 19 total
 */
export function encodeAddr(host, port) {
  // Try to parse as IP to determine address type.
  const ip4 = parseIPv4(host);
  const ip6 = parseIPv6(host);

  const dv = new DataView(new ArrayBuffer(256)); // max possible
  let off = 0;

  if (ip4) {
    dv.setUint8(off, AddrIPv4); off += 1;
    new Uint8Array(dv.buffer).set(ip4, off); off += 4;
  } else if (ip6) {
    dv.setUint8(off, AddrIPv6); off += 1;
    new Uint8Array(dv.buffer).set(ip6, off); off += 16;
  } else {
    // Domain name
    const name = new TextEncoder().encode(host);
    if (name.length > 0xff) throw new RelayError('addr maximum length exceeded');
    dv.setUint8(off, AddrDomain); off += 1;
    dv.setUint8(off, name.length); off += 1;
    new Uint8Array(dv.buffer).set(name, off); off += name.length;
  }

  dv.setUint16(off, port & 0xffff, false); // BigEndian!
  off += 2;

  return new Uint8Array(dv.buffer.slice(0, off));
}

/**
 * decodeAddr — decode an AddrFeature payload.
 */
export function decodeAddr(data) {
  if (data.length < 4) throw new RelayError('short buffer');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const aType = dv.getUint8(0);
  let pos = 1;
  let host;

  switch (aType) {
    case AddrIPv4: {
      if (data.length < 1 + 4 + 2) throw new RelayError('short buffer');
      const ip = data.slice(pos, pos + 4);
      host = ip.join('.');
      pos += 4;
      break;
    }
    case AddrIPv6: {
      if (data.length < 1 + 16 + 2) throw new RelayError('short buffer');
      const parts = [];
      for (let i = 0; i < 16; i += 2) {
        parts.push(((data[pos + i] << 8) | data[pos + i + 1]).toString(16));
      }
      host = parts.join(':');
      pos += 16;
      break;
    }
    case AddrDomain: {
      const alen = data[pos++];
      if (data.length < 1 + 1 + alen + 2) throw new RelayError('short buffer');
      host = new TextDecoder().decode(data.slice(pos, pos + alen));
      pos += alen;
      break;
    }
    default:
      throw new RelayError(`bad address type: ${aType}`);
  }

  const port = dv.getUint16(pos, false); // BigEndian!
  return { host, port, aType };
}

/**
 * encodeTunnel — encode 20-byte tunnel/connector ID.
 *
 * Wire format:
 *   | ID(16) | FLAG(1) | RSV(2) | WEIGHT(1) |
 */
export function encodeTunnel(id20) {
  if (id20.length !== 20) throw new RelayError('tunnel ID must be 20 bytes');
  return new Uint8Array(id20);
}

/**
 * decodeTunnel — decode 20-byte tunnel/connector ID.
 */
export function decodeTunnel(data) {
  if (data.length < 20) throw new RelayError('short buffer');
  return new Uint8Array(data.slice(0, 20));
}

/**
 * encodeNetwork — encode 2-byte network ID (BigEndian).
 */
export function encodeNetwork(networkId) {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, networkId, false); // BE
  return buf;
}

/**
 * decodeNetwork — decode 2-byte network ID (BigEndian).
 */
export function decodeNetwork(data) {
  if (data.length < 2) throw new RelayError('short buffer');
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, false);
}

/**
 * encodeMetadata — encode key-value metadata as MetadataFeature.
 *
 * Wire format:
 *   | NKEYS(2, BE) | KEYLEN(2, BE) | KEY(VAR) | VALLEN(2, BE) | VAL(VAR) | ...
 *
 * @param {Record<string, string>} kvs
 */
export function encodeMetadata(kvs) {
  const keys = Object.keys(kvs);
  if (keys.length === 0) {
    return new Uint8Array([0, 0]);
  }
  // Compute total length
  let total = 2; // NKEYS
  for (const k of keys) {
    const keyBytes = new TextEncoder().encode(k);
    const valBytes = new TextEncoder().encode(kvs[k] || '');
    total += 2 + keyBytes.length + 2 + valBytes.length;
  }
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  let off = 0;
  dv.setUint16(off, keys.length, false); off += 2;
  for (const k of keys) {
    const keyBytes = new TextEncoder().encode(k);
    const valBytes = new TextEncoder().encode(kvs[k] || '');
    dv.setUint16(off, keyBytes.length, false); off += 2;
    buf.set(keyBytes, off); off += keyBytes.length;
    dv.setUint16(off, valBytes.length, false); off += 2;
    buf.set(valBytes, off); off += valBytes.length;
  }
  return buf;
}

/**
 * decodeMetadata — decode a MetadataFeature payload.
 *
 * @returns {Record<string, string>}
 */
export function decodeMetadata(data) {
  if (data.length < 2) throw new RelayError('short buffer');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 0;
  const n = dv.getUint16(off, false); off += 2;
  const kvs = {};
  for (let i = 0; i < n; i++) {
    if (off + 2 > data.length) throw new RelayError('short buffer');
    const klen = dv.getUint16(off, false); off += 2;
    if (off + klen > data.length) throw new RelayError('short buffer');
    const key = new TextDecoder().decode(data.slice(off, off + klen));
    off += klen;
    if (off + 2 > data.length) throw new RelayError('short buffer');
    const vlen = dv.getUint16(off, false); off += 2;
    if (off + vlen > data.length) throw new RelayError('short buffer');
    const val = new TextDecoder().decode(data.slice(off, off + vlen));
    off += vlen;
    kvs[key] = val;
  }
  return kvs;
}

// ── Feature registry ──────────────────────────────────────────────────

/** Map feature type → { encode, decode } */
const featureHandlers = {
  [FeatureUserAuth]: { encode: encodeUserAuth, decode: decodeUserAuth },
  [FeatureAddr]: { encode: encodeAddr, decode: decodeAddr },
  [FeatureTunnel]: { encode: encodeTunnel, decode: decodeTunnel },
  [FeatureNetwork]: { encode: encodeNetwork, decode: decodeNetwork },
  [FeatureMetadata]: { encode: encodeMetadata, decode: decodeMetadata },
};

/**
 * encodeFeature — encode a { type, data } feature object.
 *
 * Returns the full TLV: | TYPE(1) | LEN(2, BE) | DATA(VAR) |
 */
function encodeFeature({ type, payload }) {
  const handler = featureHandlers[type];
  if (!handler) {
    // Opaque passthrough — use raw payload
    const raw = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    return _encodeTLV(type, raw);
  }
  return _encodeTLV(type, handler.encode(...(Array.isArray(payload) ? payload : [payload])));
}

/**
 * _encodeTLV — encode a feature type + raw payload as TLV.
 */
function _encodeTLV(type, raw) {
  const len = raw.length;
  const buf = new Uint8Array(FEATURE_HEADER_LEN + len);
  buf[0] = type;
  new DataView(buf.buffer).setUint16(1, len, false); // BE
  buf.set(raw, FEATURE_HEADER_LEN);
  return buf;
}

/**
 * decodeFeature — decode a feature TLV from a buffer at the given offset.
 *
 * Returns { feature, bytesRead }.
 */
function decodeFeature(buffer, offset) {
  if (buffer.length - offset < FEATURE_HEADER_LEN) throw new RelayError('short buffer');
  const dv = new DataView(buffer.buffer, buffer.byteOffset + offset, buffer.byteLength - offset);
  const type = dv.getUint8(0);
  const len = dv.getUint16(1, false); // BE
  if (buffer.length - offset - FEATURE_HEADER_LEN < len) throw new RelayError('short buffer');

  const raw = buffer.slice(offset + FEATURE_HEADER_LEN, offset + FEATURE_HEADER_LEN + len);
  const handler = featureHandlers[type];
  let value;
  if (handler) {
    value = handler.decode(raw);
  } else {
    value = raw; // opaque passthrough
  }

  return {
    feature: { type, value },
    bytesRead: FEATURE_HEADER_LEN + len,
  };
}

// ── Request ────────────────────────────────────────────────────────────

/**
 * RelayRequest represents a relay protocol request.
 *
 * Wire format:
 *   | VER(1) | CMD(1) | FEALEN(2, BE) | FEATURES(VAR) |
 */
export class RelayRequest {
  /**
   * @param {number} cmd - Command byte (CmdConnect, CmdBind, CmdAssociate)
   * @param {Array<{type: number, payload: any}>} features
   */
  constructor(cmd, features = []) {
    this.version = Version1;
    this.cmd = cmd;
    this.features = features;
  }

  /**
   * addFeature — append a feature.
   * @param {number} type - Feature type constant
   * @param {*} payload - Feature-specific payload (args for encoder, or raw Uint8Array)
   */
  addFeature(type, payload) {
    this.features.push({ type, payload });
    return this;
  }

  /**
   * encode — serialize to Uint8Array for sending over the wire.
   */
  encode() {
    const encodedFeatures = this.features.map(f => encodeFeature(f));
    const flen = encodedFeatures.reduce((sum, b) => sum + b.length, 0);
    if (flen > 0xffff) throw new RelayError('features maximum length exceeded');

    const buf = new Uint8Array(4 + flen);
    buf[0] = this.version;
    buf[1] = this.cmd;
    new DataView(buf.buffer).setUint16(2, flen, false); // BE
    let off = 4;
    for (const ef of encodedFeatures) {
      buf.set(ef, off);
      off += ef.length;
    }
    return buf;
  }
}

// ── Response ───────────────────────────────────────────────────────────

/**
 * relayResponseFromWire — decode a relay Response from a Uint8Array.
 *
 * Returns { version, status, features }.
 */
export function relayResponseFromWire(buffer) {
  if (buffer.length < 4) throw new RelayError('short buffer');
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const version = dv.getUint8(0);
  if (version !== Version1) throw new RelayError(`bad version: ${version}`);
  const status = dv.getUint8(1);
  const flen = dv.getUint16(2, false); // BE

  const features = [];
  let offset = 4;
  while (offset < 4 + flen) {
    const { feature, bytesRead } = decodeFeature(buffer, offset);
    features.push(feature);
    offset += bytesRead;
  }

  return { version, status, features };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * findFeature — find a feature by type in a decoded response.
 */
export function findFeature(features, type) {
  return features.find(f => f.type === type);
}

// ── IP parsing (stdlib-free, no allocations for simple cases) ─────────

function parseIPv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = parseInt(parts[i], 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

function parseIPv6(host) {
  // Handles fully-expanded and :: compressed forms.
  // ponytail: this exists; use a proper IPv6 library if we need zone IDs or embedded IPv4.

  // Quick check: must contain at least 2 colons
  const colons = (host.match(/:/g) || []).length;
  if (colons < 2 || colons > 7) return null;

  const doubleColon = host.indexOf('::');
  let left = '', right = '';

  if (doubleColon === -1) {
    // Fully expanded — must have exactly 7 colons (8 groups)
    if (colons !== 7) return null;
    left = host;
  } else {
    left = host.substring(0, doubleColon);
    right = host.substring(doubleColon + 2);
  }

  const leftParts = left ? left.split(':').filter(p => p !== '') : [];
  const rightParts = right ? right.split(':').filter(p => p !== '') : [];
  const omitted = 8 - leftParts.length - rightParts.length;
  if (omitted < 0) return null;

  const bytes = new Uint8Array(16);
  let byteIdx = 0;

  for (const part of leftParts) {
    const n = parseInt(part, 16);
    if (isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes[byteIdx++] = (n >> 8) & 0xff;
    bytes[byteIdx++] = n & 0xff;
  }

  byteIdx += omitted * 2; // skip compressed zero groups

  for (const part of rightParts) {
    const n = parseInt(part, 16);
    if (isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes[byteIdx++] = (n >> 8) & 0xff;
    bytes[byteIdx++] = n & 0xff;
  }

  return bytes;
}
