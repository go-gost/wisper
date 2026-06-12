import { GoBackend } from '../api/backend';
import type { ItemStats } from '../api/types';
import { applyStats as applyTunnelStats } from './tunnel-store';
import { applyStats as applyEntrypointStats } from './entrypoint-store';
import { getSettings } from './settings-store';

// ─── State ───────────────────────────────────────────────────────────────────

let stats: Map<string, ItemStats> = new Map();
let pollTimer: ReturnType<typeof setInterval> | null = null;
const backend = new GoBackend();

// ─── Public API ──────────────────────────────────────────────────────────────

export function getStats(id: string): ItemStats | undefined {
  return stats.get(id);
}

/** Immediately update cached stats for an item.
 *  Called by resetStats to sync the cache with the freshly-refreshed store
 *  data, so the detail page shows the correct baseline-subtracted values
 *  without waiting for the next poll cycle. */
export function setItemStats(id: string, s: ItemStats): void {
  stats.set(id, { ...s });
}

/** Start polling stats with the configured interval (default 1s). */
export function startPolling(): void {
  if (pollTimer !== null) return;
  const intervalSec = getSettings().stats_interval || 1;
  poll();
  pollTimer = setInterval(poll, intervalSec * 1000);
}

/** Stop polling stats. */
export function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Restart polling timer with a new interval (in seconds). No-op if timer is not running. */
export function updatePollingInterval(intervalSec: number): void {
  if (pollTimer === null) return;
  const ms = (intervalSec > 0 ? intervalSec : 1) * 1000;
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, ms);
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  try {
    const snapshot = await backend.getStats();

    // Update tunnel stats + status in tunnel store.
    applyTunnelStats(snapshot.tunnels);

    // Update entrypoint stats + status in entrypoint store.
    applyEntrypointStats(snapshot.entrypoints);

    // Merge into local stats map for detail page lookups.
    const next = new Map<string, ItemStats>();
    for (const t of snapshot.tunnels) {
      next.set(t.id, { ...t.stats });
    }
    for (const e of snapshot.entrypoints) {
      next.set(e.id, { ...e.stats });
    }
    stats = next;
  } catch {
    // Silently skip a failed poll — next interval will retry.
  }
}
