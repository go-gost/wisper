import type {
  Tunnel,
  TunnelCreateRequest,
  Entrypoint,
  EntrypointCreateRequest,
  StatsSnapshot,
  AppSettings,
  AppSettingsUpdate,
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

  // ─── Config ─────────────────────────────────────────────────────────────

  getConfig(): Promise<AppSettings> {
    return this.request<AppSettings>('GET', '/api/config');
  }

  updateConfig(body: AppSettingsUpdate): Promise<void> {
    return this.request<void>('PUT', '/api/config', body);
  }
}
