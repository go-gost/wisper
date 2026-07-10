/**
 * tunnel-id.js — tunnel identity helpers.
 *
 * Pure (no chrome dependency) so it can be imported in Node for live testing.
 *
 *   - uuidToTunnelIdBytes: UUID string → 20-byte relay TunnelID
 *     (matches Go's relay.NewTunnelID(uuid[:]))
 *   - entrypointFromUuid:  UUID → public entrypoint URL
 *     (matches Go's hex.EncodeToString(md5.Sum([]byte(id))[:8]) → <16hex>.<domain>)
 */

import md5 from './md5.js';

/**
 * Convert a UUID string to a 20-byte relay TunnelID.
 *
 * Layout: | ID(16) | FLAG(1) | RSV(2) | WEIGHT(1) | with bytes 16-19 = 0
 * (public tunnel, no weight). This ensures the tunnel ID sent in the relay
 * CmdBind derives from the same UUID used for the entrypoint computation, so
 * the relay server's ingress hostname mapping matches the displayed URL.
 */
export function uuidToTunnelIdBytes(uuidString) {
  const hex = uuidString.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`invalid UUID: ${uuidString}`);
  const id = new Uint8Array(20);
  for (let i = 0; i < 16; i++) {
    id[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  // bytes[16] = 0 (flag: public tunnel)
  // bytes[17-18] = 0 (reserved)
  // bytes[19] = 0 (weight)
  return id;
}

/**
 * Public entrypoint URL for a tunnel: https://<md5(uuid)[:16]>.<domain>.
 *
 * Mirrors Go's:
 *   v := md5.Sum([]byte(id)); endpoint := hex.EncodeToString(v[:8])
 *   fmt.Sprintf("https://%s.%s", endpoint, domain)
 */
export function entrypointFromUuid(uuidString, domain = 'gost.run') {
  return `https://${md5(uuidString).substring(0, 16)}.${domain}`;
}
