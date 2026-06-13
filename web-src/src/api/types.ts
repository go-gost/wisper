// ─── Enums ───────────────────────────────────────────────────────────────────

export type TunnelType = 'file' | 'http' | 'tcp' | 'udp';
export type EntrypointType = 'tcp' | 'udp';
export type ServiceStatus = 'running' | 'stopped' | 'error';
export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'en' | 'zh';

export const TUNNEL_TYPES: { value: TunnelType; label: string; desc: string }[] = [
  { value: 'file', label: 'File', desc: '' },
  { value: 'http', label: 'HTTP', desc: '' },
  { value: 'tcp', label: 'TCP', desc: '' },
  { value: 'udp', label: 'UDP', desc: '' },
];

export const ENTRYPOINT_TYPES: { value: EntrypointType; label: string; desc: string }[] = [
  { value: 'tcp', label: 'TCP', desc: '' },
  { value: 'udp', label: 'UDP', desc: '' },
];

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface ServiceStats {
  current_conns: number;
  total_conns: number;
  total_errs: number;
  request_rate: number;
  input_bytes: number;
  output_bytes: number;
  input_rate_bytes: number;
  output_rate_bytes: number;
}

export interface ItemStats {
  current_conns: number;
  total_conns: number;
  total_errs: number;
  request_rate: number;
  input_bytes: number;
  output_bytes: number;
  input_rate_bytes: number;
  output_rate_bytes: number;
}

// ─── Tunnel ──────────────────────────────────────────────────────────────────

export interface TunnelOptions {
  hostname: string;
  username: string;
  password: string;
  basic_auth: boolean;
  enableTLS: boolean;
  rewriteHost: boolean;
  file_upload: boolean;
  keepalive: boolean;
  ttl: number;
}

export interface Tunnel {
  id: string;
  name: string;
  type: TunnelType;
  endpoint: string;
  entrypoint: string;
  status: ServiceStatus;
  favorite: boolean;
  created_at: string;
  error: string;
  options: TunnelOptions;
  stats: ServiceStats;
}

export interface TunnelCreateRequest {
  name: string;
  type: TunnelType;
  endpoint: string;
  hostname?: string;
  username?: string;
  password?: string;
  enableTLS?: boolean;
  rewriteHost?: boolean;
  file_upload?: boolean;
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

export interface EntrypointOptions {
  keepalive: boolean;
  ttl: number;
}

export interface Entrypoint {
  id: string;
  name: string;
  type: EntrypointType;
  endpoint: string;
  entrypoint: string;
  status: ServiceStatus;
  favorite: boolean;
  created_at: string;
  error: string;
  options: EntrypointOptions;
  stats: ServiceStats;
}

export interface EntrypointCreateRequest {
  name: string;
  type: EntrypointType;
  endpoint: string;
  tunnel_id?: string;
  keepalive?: boolean;
  ttl?: number;
}

// ─── Stats Snapshot ──────────────────────────────────────────────────────────

export interface StatsSnapshot {
  tunnels: Tunnel[];
  entrypoints: Entrypoint[];
}

// ─── App Settings ────────────────────────────────────────────────────────────

export interface AppSettings {
  server: string;
  entrypoint: string;
  insecure: boolean;
  lang: LanguagePreference;
  theme: ThemePreference;
  stats_interval: number;
  inspector_url?: string;
}

export interface AppSettingsUpdate {
  server?: string;
  entrypoint?: string;
  insecure?: boolean;
  lang?: string;
  theme?: string;
  stats_interval?: number;
  inspector_url?: string;
}

// ─── Inspector ───────────────────────────────────────────────────────────

/** HTTP header map, as serialized from Go's `http.Header` (`map[string][]string`). */
export type HttpHeaders = Record<string, string[]>;

export interface HttpRecord {
  host: string;
  method: string;
  proto: string;
  scheme: string;
  uri: string;
  statusCode: number;
  request: { header: HttpHeaders; body: string };   // body = base64
  response: { header: HttpHeaders; body: string };  // body = base64
}

export interface WsRecord {
  from: string;
  fin: boolean;
  rsv1: boolean;
  rsv2: boolean;
  rsv3: boolean;
  opcode: number;
  masked: boolean;
  maskKey?: number;
  length: number;
  payload: string;  // base64
}

export interface InspectorRecord {
  node?: string;
  service: string;
  network: string;
  remote: string;
  local: string;
  host: string;
  dst: string;
  proto?: string;
  clientIP: string;
  clientID?: string;
  http?: HttpRecord;
  websocket?: WsRecord;
  route?: string;
  inputBytes: number;
  outputBytes: number;
  redirect?: string;
  err?: string;
  sid: string;
  duration: number;
  time: string;
}

export interface InspectorQueryResponse {
  code: number;
  data: {
    list: InspectorRecord[];
    before?: string;
    after?: string;
  };
  msg: string;
  error?: string;
}

export type ProtocolType = 'http' | 'websocket';
