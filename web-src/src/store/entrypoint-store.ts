import { GoBackend } from '../api/backend';
import type { Entrypoint, EntrypointCreateRequest } from '../api/types';

// ─── State ───────────────────────────────────────────────────────────────────

let entrypoints: Entrypoint[] = [];
let loading = false;
const listeners = new Set<() => void>();
const backend = new GoBackend();

// ─── Public API ──────────────────────────────────────────────────────────────

export function getEntrypoints(): Entrypoint[] {
  return entrypoints;
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

export async function refresh(): Promise<void> {
  loading = true;
  notify();
  try {
    entrypoints = await backend.listEntrypoints();
  } catch {
    // Keep existing list on error.
  }
  loading = false;
  notify();
}

export async function create(req: EntrypointCreateRequest): Promise<Entrypoint> {
  const ep = await backend.createEntrypoint(req);
  entrypoints = [...entrypoints, ep];
  notify();
  return ep;
}

export async function update(id: string, req: EntrypointCreateRequest): Promise<Entrypoint> {
  const ep = await backend.updateEntrypoint(id, req);
  entrypoints = entrypoints.map(x => (x.id === id ? ep : x));
  notify();
  return ep;
}

export async function remove(id: string): Promise<void> {
  await backend.deleteEntrypoint(id);
  entrypoints = entrypoints.filter(x => x.id !== id);
  notify();
}

export async function start(id: string): Promise<void> {
  await backend.startEntrypoint(id);
  await refresh();
}

export async function stop(id: string): Promise<void> {
  await backend.stopEntrypoint(id);
  await refresh();
}

export async function toggleFavorite(id: string): Promise<void> {
  const idx = entrypoints.findIndex(x => x.id === id);
  if (idx === -1) return;

  const current = entrypoints[idx].favorite;
  entrypoints = entrypoints.map(x => (x.id === id ? { ...x, favorite: !current } : x));
  notify();

  try {
    const ep = await backend.getEntrypoint(id);
    entrypoints = entrypoints.map(x => (x.id === id ? ep : x));
  } catch {
    entrypoints = entrypoints.map(x => (x.id === id ? { ...x, favorite: current } : x));
  }
  notify();
}

export function applyStats(statsList: Entrypoint[]): void {
  for (const s of statsList) {
    entrypoints = entrypoints.map(e =>
      e.id === s.id ? { ...e, stats: s.stats, status: s.status } : e,
    );
  }
  notify();
}
