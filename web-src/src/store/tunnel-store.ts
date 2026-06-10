import { GoBackend } from '../api/backend';
import type { Tunnel, TunnelCreateRequest } from '../api/types';

// ─── State ───────────────────────────────────────────────────────────────────

let tunnels: Tunnel[] = [];
let loading = false;
const listeners = new Set<() => void>();
const backend = new GoBackend();

// ─── Public API ──────────────────────────────────────────────────────────────

export function getTunnels(): Tunnel[] {
  return tunnels;
}

export function isLoading(): boolean {
  return loading;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}

/** Fetch the full tunnel list from the backend. */
export async function refresh(): Promise<void> {
  loading = true;
  notify();
  try {
    tunnels = await backend.listTunnels();
  } catch {
    // Keep existing list on error.
  }
  loading = false;
  notify();
}

/** Create a new tunnel and start it. */
export async function create(req: TunnelCreateRequest): Promise<Tunnel> {
  const t = await backend.createTunnel(req);
  tunnels = [...tunnels, t];
  notify();
  return t;
}

/** Update an existing tunnel (stop old, start new). */
export async function update(id: string, req: TunnelCreateRequest): Promise<Tunnel> {
  const t = await backend.updateTunnel(id, req);
  tunnels = tunnels.map(x => (x.id === id ? t : x));
  notify();
  return t;
}

/** Delete a tunnel. */
export async function remove(id: string): Promise<void> {
  await backend.deleteTunnel(id);
  tunnels = tunnels.filter(x => x.id !== id);
  notify();
}

/** Start a stopped tunnel. */
export async function start(id: string): Promise<void> {
  await backend.startTunnel(id);
  await refresh();
}

/** Stop a running tunnel. */
export async function stop(id: string): Promise<void> {
  await backend.stopTunnel(id);
  await refresh();
}

/** Toggle favorite status. */
export async function toggleFavorite(id: string): Promise<void> {
  const idx = tunnels.findIndex(x => x.id === id);
  if (idx === -1) return;

  const current = tunnels[idx].favorite;
  // Optimistic update.
  tunnels = tunnels.map(x => (x.id === id ? { ...x, favorite: !current } : x));
  notify();

  try {
    const t = await backend.getTunnel(id);
    tunnels = tunnels.map(x => (x.id === id ? t : x));
  } catch {
    // Revert on error.
    tunnels = tunnels.map(x => (x.id === id ? { ...x, favorite: current } : x));
  }
  notify();
}

/** Apply stats snapshot to tunnel list (called by stats store every 1s). */
export function applyStats(statsList: Tunnel[]): void {
  for (const s of statsList) {
    tunnels = tunnels.map(t => (t.id === s.id ? { ...t, stats: s.stats, status: s.status } : t));
  }
  notify();
}
