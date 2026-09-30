import type {
  AppSettings,
  AppSettingsUpdate,
  Entrypoint,
  EntrypointCreateRequest,
  PendingPeer,
  StatsSnapshot,
  Tunnel,
  TunnelCreateRequest,
  TunnelPeersRequest,
  VersionInfo,
  WisperEvent,
} from './types';

export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

/** A fresh short id per request. The backend logs it on its mutation line and
 *  the p2p seam logs it on the calls the action started, so a click can be
 *  joined with the p2p work it set in motion. It is a label and never auth —
 *  nothing parses it or decides on it. `crypto.randomUUID` needs a secure
 *  context, which an older webview may not give, hence the fallback. */
function actionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID().slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

/** HTTP client for the Wisper Go backend API.
 *  When `baseUrl` is empty, uses relative paths (same-origin — embedded mode).
 */
export class GoBackend {
  private baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache',
      // Every request, not only mutations: the GET path costs nothing (the
      // backend logs mutations only) and one rule is one place to keep right.
      'Wisper-Id': actionId(),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(this.url(path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // 204 No Content — no body to parse
    if (res.status === 204) {
      return undefined as T;
    }

    const data = await res.json();

    if (!res.ok) {
      throw new BackendError(res.status, data?.error ?? res.statusText);
    }

    return data as T;
  }

  // ─── Tunnels ────────────────────────────────────────────────────────────

  listTunnels(): Promise<Tunnel[]> {
    return this.request<Tunnel[]>('GET', '/api/tunnels');
  }

  getTunnel(id: string): Promise<Tunnel> {
    return this.request<Tunnel>('GET', `/api/tunnels/${id}`);
  }

  createTunnel(body: TunnelCreateRequest): Promise<Tunnel> {
    return this.request<Tunnel>('POST', '/api/tunnels', body);
  }

  updateTunnel(id: string, body: TunnelCreateRequest): Promise<Tunnel> {
    return this.request<Tunnel>('PUT', `/api/tunnels/${id}`, body);
  }

  updateTunnelPeers(id: string, body: TunnelPeersRequest): Promise<Tunnel> {
    return this.request<Tunnel>('PUT', `/api/tunnels/${id}/peers`, body);
  }

  deleteTunnel(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/tunnels/${id}`);
  }

  startTunnel(id: string): Promise<void> {
    return this.request<void>('POST', `/api/tunnels/${id}/start`);
  }

  stopTunnel(id: string): Promise<void> {
    return this.request<void>('POST', `/api/tunnels/${id}/stop`);
  }

  // ─── Entrypoints ────────────────────────────────────────────────────────

  listEntrypoints(): Promise<Entrypoint[]> {
    return this.request<Entrypoint[]>('GET', '/api/entrypoints');
  }

  getEntrypoint(id: string): Promise<Entrypoint> {
    return this.request<Entrypoint>('GET', `/api/entrypoints/${id}`);
  }

  createEntrypoint(body: EntrypointCreateRequest): Promise<Entrypoint> {
    return this.request<Entrypoint>('POST', '/api/entrypoints', body);
  }

  updateEntrypoint(id: string, body: EntrypointCreateRequest): Promise<Entrypoint> {
    return this.request<Entrypoint>('PUT', `/api/entrypoints/${id}`, body);
  }

  deleteEntrypoint(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/entrypoints/${id}`);
  }

  startEntrypoint(id: string): Promise<void> {
    return this.request<void>('POST', `/api/entrypoints/${id}/start`);
  }

  stopEntrypoint(id: string): Promise<void> {
    return this.request<void>('POST', `/api/entrypoints/${id}/stop`);
  }

  // ─── Stats ──────────────────────────────────────────────────────────────

  getStats(): Promise<StatsSnapshot> {
    return this.request<StatsSnapshot>('GET', '/api/stats');
  }

  resetStats(id: string, isEntrypoint: boolean, kind?: string): Promise<void> {
    const prefix = isEntrypoint ? '/api/entrypoints/' : '/api/tunnels/';
    const qs = kind ? `?kind=${kind}` : '';
    return this.request<void>('POST', `${prefix}${id}/stats/reset${qs}`);
  }

  // ─── Config ─────────────────────────────────────────────────────────────

  getConfig(): Promise<AppSettings> {
    return this.request<AppSettings>('GET', '/api/config');
  }

  updateConfig(body: AppSettingsUpdate): Promise<void> {
    return this.request<void>('PUT', '/api/config', body);
  }

  // ─── Version ────────────────────────────────────────────────────────────

  getVersion(): Promise<VersionInfo> {
    return this.request<VersionInfo>('GET', '/api/version');
  }

  // ─── P2P ────────────────────────────────────────────────────────────────

  /**
   * Process-wide p2p identity. `public_key` is materialized on demand (never
   * empty); `running` tells whether the shared host is currently started. The
   * transport counters are zero while it is not.
   */
  getP2PIdentity(): Promise<{
    public_key: string;
    running: boolean;
    direct_peers: number;
    derp_peers: number;
    punch_attempts: number;
    punch_success: number;
  }> {
    return this.request('GET', '/api/p2p');
  }

  /** Probe the relay from the wisper process (its real network path and TLS
   *  options), so the result also covers a self-signed relay. */
  testP2PRelay(req: { derp: string; secure?: boolean; ca_file?: string }): Promise<{
    ok: boolean;
    derp?: string;
    latency_ms?: number;
    error?: string;
  }> {
    return this.request('POST', '/api/p2p/test', req);
  }

  /** Probe the STUN server the direct path would use; `mapped` is the public
   *  address the server saw. An empty `stun` probes the configured one. */
  testP2PStun(req: { stun: string }): Promise<{
    ok: boolean;
    stun?: string;
    mapped?: string;
    latency_ms?: number;
    error?: string;
  }> {
    return this.request('POST', '/api/p2p/test-stun', req);
  }

  /** The p2p diagnostic report as plain text, rendered in-process where the
   *  relay's liveness is real. An optional peer key narrows it to one peer. */
  async getP2PDoctor(peer?: string): Promise<string> {
    const q = peer ? `?peer=${encodeURIComponent(peer)}` : '';
    const res = await fetch(this.url(`/api/p2p/doctor${q}`), {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) {
      throw new BackendError(res.status, res.statusText);
    }
    return res.text();
  }

  /** Keys that knocked on the shared host without being on any tunnel's
   *  allowlist, newest first. The list is process-wide: a p2p stream carries
   *  no destination, so a knock cannot be attributed to a tunnel. */
  listPendingPeers(): Promise<{ peers: PendingPeer[] }> {
    return this.request('GET', '/api/p2p/pending');
  }

  /** Forget one knock. The peer is refused either way — this only clears the
   *  notice — so an unknown key is not an error. */
  dismissPendingPeer(key: string): Promise<void> {
    return this.request('DELETE', `/api/p2p/pending/${encodeURIComponent(key)}`);
  }

  /** The host's global event history (relay/STUN failures, host start/stop,
   *  deletions), newest first. */
  getEvents(): Promise<{ events: WisperEvent[] }> {
    return this.request('GET', '/api/events');
  }

  /** Forget the global event history. */
  clearEvents(): Promise<void> {
    return this.request('DELETE', '/api/events');
  }
}
