import type { InspectorQueryResponse, InspectorRecord, ProtocolType } from './types';

export class InspectorApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** GET /liveness — health check */
  async liveness(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/liveness`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** GET /api/records/query — historical records */
  async query(params: {
    client_id: string;
    type?: ProtocolType;
    service?: string;
    sid?: string;
    start?: number;
    end?: number;
    before?: string;
    after?: string;
    limit?: number;
  }): Promise<InspectorQueryResponse> {
    const search = new URLSearchParams();
    search.set('client_id', params.client_id);
    if (params.type) search.set('type', params.type);
    if (params.service) search.set('service', params.service);
    if (params.sid) search.set('sid', params.sid);
    if (params.start !== undefined) search.set('start', String(params.start));
    if (params.end !== undefined) search.set('end', String(params.end));
    if (params.before) search.set('before', params.before);
    if (params.after) search.set('after', params.after);
    if (params.limit !== undefined) search.set('limit', String(params.limit));

    const res = await fetch(`${this.baseUrl}/api/records/query?${search.toString()}`);
    if (!res.ok) throw new Error(`Inspector query failed: ${res.status}`);
    return res.json();
  }

  /** WS /api/records/tail — live stream */
  connectTail(params: {
    client_id: string;
    type?: ProtocolType;
    service?: string;
    sid?: string;
  }): WebSocket {
    const search = new URLSearchParams();
    search.set('client_id', params.client_id);
    if (params.type) search.set('type', params.type);
    if (params.service) search.set('service', params.service);
    if (params.sid) search.set('sid', params.sid);

    const wsUrl = this.baseUrl.replace(/^http/, 'ws');
    return new WebSocket(`${wsUrl}/api/records/tail?${search.toString()}`);
  }

  /** GET /api/records/:id — full record with body + headers */
  async getRecord(id: string): Promise<InspectorRecord> {
    const res = await fetch(`${this.baseUrl}/api/records/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Inspector record detail failed: ${res.status}`);
    const resp = await res.json();
    if (resp.code !== 0) throw new Error(resp.msg || resp.error || 'Unknown error');
    return resp.data;
  }
}

/**
 * Decode a base64-encoded string into a Uint8Array.
 * Used for body/payload fields in inspector records.
 */
export function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
