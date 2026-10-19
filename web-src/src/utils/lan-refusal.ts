import type { TunnelLAN } from '../api/types';

/** The refusal reasons a peer's LAN allow row can answer. The other three —
 *  covers-member, hub-own-route, taken-by-peer — are conflicts with the route
 *  table, and writing the prefix into an allow row would not fix them. */
const ALLOW_ROW_REASONS = new Set(['no-allow-row', 'empty-allow', 'outside-allow']);

/** One refused claim, with the journal's repeated copies of it collapsed. */
export interface LANRefusalGroup {
  peer: string;
  prefix: string;
  reason: string;
  detail?: string;
  at: string;
  /** How many identical refusals this run's journal held. */
  count: number;
  /** Whether adding `prefix` to the peer's LAN allow row can approve it. */
  fixableByAllow: boolean;
  /** Whether the hub has since installed the prefix for that peer. */
  resolved: boolean;
}

/**
 * The hub's refusal journal, one entry per claim rather than per assertion.
 *
 * A refused spoke re-asserts every ~20 seconds, so a single unapproved LAN
 * fills the whole 16-entry window with copies of itself. Everything reading
 * the list wants the claim, not the tick: the newest entry — the journal is
 * newest first — is kept and the rest counted.
 *
 * A claim the hub has since installed is marked `resolved` rather than
 * dropped: the refusal table is the run's history, while the prompts are about
 * what is still being refused.
 */
export function lanRefusalGroups(lan?: TunnelLAN): LANRefusalGroup[] {
  const claimed = new Map<string, Set<string>>();
  for (const [peer, c] of Object.entries(lan?.claims ?? {})) {
    claimed.set(peer, new Set(c.prefixes));
  }

  const groups: LANRefusalGroup[] = [];
  const byClaim = new Map<string, LANRefusalGroup>();
  for (const r of lan?.rejected ?? []) {
    const key = `${r.peer}\u0000${r.prefix}`;
    const seen = byClaim.get(key);
    if (seen) {
      seen.count++;
      continue;
    }
    const group: LANRefusalGroup = {
      peer: r.peer,
      prefix: r.prefix,
      reason: r.reason,
      detail: r.detail,
      at: r.at,
      count: 1,
      fixableByAllow: ALLOW_ROW_REASONS.has(r.reason),
      resolved: claimed.get(r.peer)?.has(r.prefix) === true,
    };
    byClaim.set(key, group);
    groups.push(group);
  }
  return groups;
}
