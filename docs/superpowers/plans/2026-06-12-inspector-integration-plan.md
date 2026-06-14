# Inspector Traffic Inspection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate go-gost/inspector traffic observability into wisper as a dedicated page accessible from tunnel/entrypoint detail pages, using browser-direct API calls to an existing inspector instance.

**Architecture:** Pure frontend integration — the browser calls the inspector API directly. Wisper's Go backend only persists the inspector URL setting. All inspector features (Query + Live mode, HTTP/WebSocket/TLS/DNS protocol tabs, record detail with body viewer) are implemented in Lit web components.

**Tech Stack:** Lit 3.x, TypeScript, CSS custom properties (wisper theme), WebSocket, fetch API

---

### Task 1: Go Backend — Inspector URL Config Field

**Files:**
- Modify: `config/config.go:104-115`
- Modify: `api/config_handler.go:15-55`

- [ ] **Step 1: Add InspectorURL to Settings struct**

In `config/config.go`, add `InspectorURL` field to `Settings`:

```go
// Settings holds application settings.
type Settings struct {
	// Server address (default: tunnel.gost.run).
	Server string
	// Public entrypoint address (default: gost.run).
	Entrypoint string
	// Skip TLS certificate verification for the tunnel server.
	Insecure bool
	Lang          string
	Theme         string
	StatsInterval int `yaml:"stats_interval,omitempty" json:"stats_interval,omitempty"`
	// Inspector API URL (e.g., http://inspector:8000). Empty = disabled.
	InspectorURL string `yaml:"inspector_url,omitempty" json:"inspector_url,omitempty"`
}
```

The `yaml:"inspector_url,omitempty"` and `json:"inspector_url,omitempty"` tags ensure serialization matches the existing snake_case naming pattern. The `deepCopyConfig` function already copies `Settings` as a whole struct value, so no deep-copy change is needed.

- [ ] **Step 2: Add inspector_url to config HTTP handlers**

In `api/config_handler.go`, update `configResponse`:

```go
type configResponse struct {
	Server        string `json:"server"`
	Entrypoint    string `json:"entrypoint"`
	Insecure      bool   `json:"insecure"`
	Lang          string `json:"lang"`
	Theme         string `json:"theme"`
	StatsInterval int    `json:"stats_interval"`
	InspectorURL  string `json:"inspector_url"`
}
```

Update `handleGetConfig` — add to the response literal at line 37-44:

```go
writeJSON(w, http.StatusOK, configResponse{
	Server:        settings.Server,
	Entrypoint:    settings.Entrypoint,
	Insecure:      settings.Insecure,
	Lang:          settings.Lang,
	Theme:         settings.Theme,
	StatsInterval: statsInterval,
	InspectorURL:  settings.InspectorURL,
})
```

Update `configUpdateRequest`:

```go
type configUpdateRequest struct {
	Server        *string `json:"server,omitempty"`
	Entrypoint    *string `json:"entrypoint,omitempty"`
	Insecure      *bool   `json:"insecure,omitempty"`
	Lang          *string `json:"lang,omitempty"`
	Theme         *string `json:"theme,omitempty"`
	StatsInterval *int    `json:"stats_interval,omitempty"`
	InspectorURL  *string `json:"inspector_url,omitempty"`
}
```

In `handleUpdateConfig`, add after the `StatsInterval` block (line 88-90):

```go
if req.InspectorURL != nil {
	cfg.Settings.InspectorURL = *req.InspectorURL
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /config/workspace/go-gost/wisper && go build ./... && go vet ./...
```

Expected: build passes, no vet warnings.

- [ ] **Step 4: Run tests**

```bash
cd /config/workspace/go-gost/wisper && go test ./... -v
```

Expected: all existing tests pass (21/21). No new tests needed — this is pure config plumbing.

---

### Task 2: TypeScript Types — Inspector Data Structures

**Files:**
- Modify: `web-src/src/api/types.ts`
- Create: `web-src/src/api/inspector.ts`

- [ ] **Step 1: Add inspector types to types.ts**

Append to `web-src/src/api/types.ts`:

```typescript
// ─── Inspector ───────────────────────────────────────────────────────────

export interface HttpRecord {
  host: string;
  method: string;
  proto: string;
  scheme: string;
  uri: string;
  statusCode: number;
  request: { header: string; body: string };   // body = base64
  response: { header: string; body: string };  // body = base64
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

export interface TlsRecord {
  serverName: string;
  cipherSuite: number;
  compressionMethod: number;
  proto: string;
  version: number;
  clientHello: string;  // hex
  serverHello: string;  // hex
}

export interface DnsRecord {
  id: number;
  name: string;
  class: number;
  type: number;
  question: string;
  answer: string;
  cached: boolean;
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
  tls?: TlsRecord;
  dns?: DnsRecord;
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

export type ProtocolType = 'http' | 'websocket' | 'tls' | 'dns';

// Add inspector_url to AppSettings
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
```

**Important**: The `AppSettings` and `AppSettingsUpdate` interfaces already exist in `types.ts` (around lines 124-140). Do **not** replace them — merge only the new `inspector_url` field into each. For `AppSettings` add `inspector_url?: string;` as a new property. For `AppSettingsUpdate` add `inspector_url?: string;`. Do not duplicate the other fields.

- [ ] **Step 2: Create inspector API client**

Create `web-src/src/api/inspector.ts`:

```typescript
import type { InspectorRecord, InspectorQueryResponse, ProtocolType } from './types';

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
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd /config/workspace/go-gost/wisper/web-src && npx tsc --noEmit
```

Expected: no type errors.

---

### Task 3: Settings Store — Inspector URL

**Files:**
- Modify: `web-src/src/store/settings-store.ts`

- [ ] **Step 1: Add inspectorUrl to settings state**

Update the initial `settings` object (around line 35-41):

```typescript
let settings: AppSettings = {
  server: 'tunnel.gost.run',
  entrypoint: 'gost.run',
  insecure: false,
  lang: 'en',
  theme: 'system',
  stats_interval: 1,
  inspector_url: '',
};
```

- [ ] **Step 2: Include inspector_url in loadSettings**

In `loadSettings()` (around line 64-74), add `inspector_url`:

```typescript
settings = {
  server: cfg.server || 'tunnel.gost.run',
  entrypoint: cfg.entrypoint || 'gost.run',
  insecure: cfg.insecure || false,
  lang: cfg.lang || 'en',
  theme: cfg.theme || getStoredTheme(),
  stats_interval: cfg.stats_interval || 1,
  inspector_url: cfg.inspector_url || '',
};
```

- [ ] **Step 3: Include inspector_url in updateSettings**

In `updateSettings()` (after the `stats_interval` block around line 106-108), add:

```typescript
if (update.inspector_url !== undefined) {
  settings.inspector_url = update.inspector_url;
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd /config/workspace/go-gost/wisper/web-src && npx tsc --noEmit
```

---

### Task 4: i18n Strings — Inspector Keys

**Files:**
- Modify: `web-src/src/i18n/en.ts`
- Modify: `web-src/src/i18n/zh.ts`

- [ ] **Step 1: Add English strings**

In `web-src/src/i18n/en.ts`, append to the translations object:

```typescript
// Inspector
inspectorEntryTitle: 'Traffic Inspection',
inspectorEntryDesc: 'View HTTP / WebSocket / TLS / DNS records',
inspectorTitle: 'Traffic',
inspectorNotConfigured: 'Inspector not configured',
inspectorNotConfiguredDesc: 'Set the inspector API URL in Settings to enable traffic inspection.',
inspectorSettingsLabel: 'Inspector API URL',
inspectorSettingsDesc: 'Traffic inspection service base URL. When set, a "Traffic Inspection" button appears on tunnel detail pages.',
inspectorUrlPlaceholder: 'e.g. http://inspector.local:8000',
inspectorConnected: 'Connected',
inspectorUnreachable: 'Unreachable',
inspectorTest: 'Test',
inspectorQuery: 'Query',
inspectorLive: 'Live',
inspectorNoRecords: 'No records found',
inspectorRecordsCount: '{count} records',
inspectorProtocolHttp: 'HTTP',
inspectorProtocolWs: 'WebSocket',
inspectorProtocolTls: 'TLS',
inspectorProtocolDns: 'DNS',
inspectorFilterService: 'Service',
inspectorFilterSid: 'Session ID',
inspectorFieldTunnelId: 'Tunnel ID',
inspectorDetailHeaders: 'Headers',
inspectorDetailBody: 'Body',
inspectorTabText: 'Text',
inspectorTabHex: 'Hex',
inspectorTabJson: 'JSON',
inspectorBtnCopy: 'Copy',
inspectorBtnStop: 'Stop',
inspectorBtnClear: 'Clear',
inspectorBtnReconnect: 'Reconnect',
inspectorStatusConnected: 'Connected',
inspectorStatusDisconnected: 'Disconnected',
```

- [ ] **Step 2: Add Chinese strings**

In `web-src/src/i18n/zh.ts`, append:

```typescript
// Inspector
inspectorEntryTitle: '流量检查',
inspectorEntryDesc: '查看 HTTP / WebSocket / TLS / DNS 记录',
inspectorTitle: '流量',
inspectorNotConfigured: '流量检查未配置',
inspectorNotConfiguredDesc: '在设置中配置 Inspector API URL 以启用流量检查。',
inspectorSettingsLabel: 'Inspector API URL',
inspectorSettingsDesc: '流量检查服务地址。设置后，隧道详情页会出现"流量检查"按钮。',
inspectorUrlPlaceholder: '例如 http://inspector.local:8000',
inspectorConnected: '已连接',
inspectorUnreachable: '无法访问',
inspectorTest: '测试',
inspectorQuery: '查询',
inspectorLive: '实时',
inspectorNoRecords: '暂无记录',
inspectorRecordsCount: '{count} 条记录',
inspectorProtocolHttp: 'HTTP',
inspectorProtocolWs: 'WebSocket',
inspectorProtocolTls: 'TLS',
inspectorProtocolDns: 'DNS',
inspectorFilterService: '服务',
inspectorFilterSid: '会话 ID',
inspectorFieldTunnelId: '隧道 ID',
inspectorDetailHeaders: '头信息',
inspectorDetailBody: '内容',
inspectorTabText: '文本',
inspectorTabHex: 'Hex',
inspectorTabJson: 'JSON',
inspectorBtnCopy: '复制',
inspectorBtnStop: '停止',
inspectorBtnClear: '清除',
inspectorBtnReconnect: '重连',
inspectorStatusConnected: '已连接',
inspectorStatusDisconnected: '已断开',
```

---

### Task 5: Settings Page — Inspector Section

**Files:**
- Modify: `web-src/src/pages/settings-page.ts`

- [ ] **Step 1: Add inspector URL state field**

Add to the `@state()` declarations (after `_statsInterval`, around line 35-36):

```typescript
@state() private _inspectorUrl = '';
@state() private _inspectorConnected = false;
```

- [ ] **Step 2: Populate inspector URL in lifecycle hooks**

In `connectedCallback()` (after `this._statsInterval = s.stats_interval || 1;` at line 49):

```typescript
this._inspectorUrl = s.inspector_url || '';
```

In the `subscribe` callback (after `this._statsInterval = s2.stats_interval || 1;` at line 58-59):

```typescript
this._inspectorUrl = s2.inspector_url || '';
```

- [ ] **Step 3: Add debounced liveness check method**

Add after the `_setInterval` method:

```typescript
private _livenessTimer: ReturnType<typeof setTimeout> | null = null;

private _onInspectorUrlChange(url: string) {
  this._inspectorUrl = url;
  // Debounce liveness check by 500ms
  if (this._livenessTimer) clearTimeout(this._livenessTimer);
  this._livenessTimer = setTimeout(() => this._checkLiveness(), 500);
}

private async _checkLiveness() {
  if (!this._inspectorUrl) {
    this._inspectorConnected = false;
    return;
  }
  try {
    const res = await fetch(`${this._inspectorUrl.replace(/\/$/, '')}/liveness`);
    this._inspectorConnected = res.ok;
  } catch {
    this._inspectorConnected = false;
  }
  this.requestUpdate();
}
```

Update `disconnectedCallback` to clear the timer:

```typescript
disconnectedCallback() {
  super.disconnectedCallback();
  for (const fn of this._unsubs) fn();
  if (this._livenessTimer) clearTimeout(this._livenessTimer);
}
```

- [ ] **Step 4: Add inspector save logic**

Add a save method for inspector URL changes (optimistic save, no full-save button needed):

```typescript
private async _saveInspectorUrl() {
  try {
    await updateSettings({ inspector_url: this._inspectorUrl });
    this._showSnackbar('✓ ' + t('saved'));
  } catch {
    this._showSnackbar(t('saveFailed'));
  }
}
```

- [ ] **Step 5: Add inspector section to render**

Insert a new inspector settings section in `render()`, between the "Server Configuration" section and "Preferences" section (after the `</div>` closing the server section card, around lines 330-331):

```typescript
<!-- Inspector -->
<div class="section">
  <div class="section-title">🔍 Inspector</div>
  <div class="card">
    <div class="card-padded">
      <p style="font-size:var(--font-xs);color:var(--text-muted);margin-bottom:12px;">
        ${t('inspectorSettingsDesc')}
      </p>
      <div class="form-group">
        <label class="form-label">${t('inspectorSettingsLabel')}</label>
        <input class="form-input" .value=${this._inspectorUrl}
          placeholder=${t('inspectorUrlPlaceholder')}
          @input=${(e: Event) => this._onInspectorUrlChange((e.target as HTMLInputElement).value)}
          @blur=${() => this._saveInspectorUrl()}>
        <p class="hint">Leave empty to disable traffic inspection.</p>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:var(--font-sm);padding-top:8px;">
        <span style="display:flex;align-items:center;gap:6px;color:var(--text-muted);">
          <span style="width:8px;height:8px;border-radius:50%;background:${this._inspectorConnected ? 'var(--green)' : 'var(--red)'};display:inline-block;"></span>
          ${this._inspectorConnected ? t('inspectorConnected') : this._inspectorUrl ? t('inspectorUnreachable') : '—'}
        </span>
        <button class="save-btn" style="width:auto;padding:6px 16px;margin:0;"
          @click=${() => this._checkLiveness()}>
          ${t('inspectorTest')}
        </button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 6: Build web**

```bash
make web
```

Expected: build succeeds.

---

### Task 6: Inspector Components

**Files:**
- Create: `web-src/src/components/inspector/protocol-tabs.ts`
- Create: `web-src/src/components/inspector/mode-toggle.ts`
- Create: `web-src/src/components/inspector/filter-bar.ts`
- Create: `web-src/src/components/inspector/record-list.ts`
- Create: `web-src/src/components/inspector/record-detail.ts`
- Create: `web-src/src/components/inspector/body-viewer.ts`
- Create: `web-src/src/components/inspector/live-indicator.ts`

- [ ] **Step 1: Create protocol-tabs component**

Create `web-src/src/components/inspector/protocol-tabs.ts`:

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ProtocolType } from '../../api/types';
import { t } from '../../i18n/i18n';

const PROTOCOLS: { type: ProtocolType; labelKey: string }[] = [
  { type: 'http', labelKey: 'inspectorProtocolHttp' },
  { type: 'websocket', labelKey: 'inspectorProtocolWs' },
  { type: 'tls', labelKey: 'inspectorProtocolTls' },
  { type: 'dns', labelKey: 'inspectorProtocolDns' },
];

@customElement('protocol-tabs')
export class ProtocolTabs extends LitElement {
  @property() active: ProtocolType = 'http';

  static styles = css`
    :host { display: block; }
    .tabs {
      display: flex; gap: 2px;
      background: var(--bg);
      border-radius: var(--radius-md);
      padding: 3px;
    }
    .tab {
      flex: 1; text-align: center; padding: 6px 4px;
      font-size: var(--font-xs); font-weight: 500;
      color: var(--text-dim, #8b949e);
      border-radius: 6px; cursor: pointer; border: none; background: none;
      font-family: inherit; transition: all 0.15s;
    }
    .tab.active { background: var(--accent); color: var(--accent-fg, #fff); }
    .tab:hover:not(.active) { color: var(--text); }
  `;

  render() {
    return html`
      <div class="tabs">
        ${PROTOCOLS.map(p => html`
          <button class="tab ${this.active === p.type ? 'active' : ''}"
            @click=${() => this.dispatchEvent(new CustomEvent('protocol-change', { detail: p.type, bubbles: true, composed: true }))}>
            ${t(p.labelKey)}
          </button>
        `)}
      </div>
    `;
  }
}
```

- [ ] **Step 2: Create mode-toggle component**

Create `web-src/src/components/inspector/mode-toggle.ts`:

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

export type InspectorMode = 'query' | 'live';

@customElement('mode-toggle')
export class ModeToggle extends LitElement {
  @property() mode: InspectorMode = 'query';

  static styles = css`
    :host { display: block; }
    .toggle {
      display: flex; background: var(--bg);
      border-radius: var(--radius-md); padding: 3px;
    }
    .btn {
      flex: 1; text-align: center; padding: 6px;
      font-size: var(--font-xs); cursor: pointer; border-radius: 6px;
      border: none; background: none; font-family: inherit;
      color: var(--text-dim, #8b949e); transition: all 0.15s;
    }
    .btn.active { background: var(--border-subtle, #21262d); color: var(--text); font-weight: 500; }
  `;

  render() {
    return html`
      <div class="toggle">
        <button class="btn ${this.mode === 'query' ? 'active' : ''}"
          @click=${() => this._setMode('query')}>${t('inspectorQuery')}</button>
        <button class="btn ${this.mode === 'live' ? 'active' : ''}"
          @click=${() => this._setMode('live')}>${t('inspectorLive')}</button>
      </div>
    `;
  }

  private _setMode(mode: InspectorMode) {
    this.mode = mode;
    this.dispatchEvent(new CustomEvent('mode-change', { detail: mode, bubbles: true, composed: true }));
  }
}
```

- [ ] **Step 3: Create filter-bar component**

Create `web-src/src/components/inspector/filter-bar.ts`:

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

@customElement('inspector-filter-bar')
export class InspectorFilterBar extends LitElement {
  @property() clientId = '';
  @property() service = '';
  @property() sid = '';

  static styles = css`
    :host { display: block; }
    .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
    input {
      flex: 1; min-width: 80px; padding: 8px 10px;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: var(--radius-sm); color: var(--text);
      font-size: var(--font-xs); font-family: var(--font-mono, 'SF Mono', monospace);
      outline: none; box-sizing: border-box;
    }
    input:focus { border-color: var(--accent); }
    input[readonly] { opacity: 0.6; }
  `;

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private _fireChange() {
    // Debounce 400ms — fire on pause, not every keystroke
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.dispatchEvent(new CustomEvent('filter-change', {
        detail: { service: this.service, sid: this.sid },
        bubbles: true, composed: true,
      }));
    }, 400);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  }

  render() {
    return html`
      <div class="filter-row">
        <input .value=${this.clientId} readonly title=${t('inspectorFieldTunnelId')}>
        <input .value=${this.service} placeholder=${t('inspectorFilterService')}
          @input=${(e: Event) => { this.service = (e.target as HTMLInputElement).value; this._fireChange(); }}>
        <input .value=${this.sid} placeholder=${t('inspectorFilterSid')}
          @input=${(e: Event) => { this.sid = (e.target as HTMLInputElement).value; this._fireChange(); }}>
      </div>
    `;
  }
}
```

- [ ] **Step 4: Create body-viewer component**

Create `web-src/src/components/inspector/body-viewer.ts`:

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { decodeBase64 } from '../../api/inspector';
import { t } from '../../i18n/i18n';

type BodyTab = 'text' | 'hex' | 'json';

@customElement('body-viewer')
export class BodyViewer extends LitElement {
  @property() body = '';       // base64-encoded
  @property() private _tab: BodyTab = 'text';

  static styles = css`
    :host { display: block; }
    .tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .tab {
      font-size: var(--font-xs); padding: 3px 8px; border-radius: 4px;
      cursor: pointer; color: var(--text-dim, #8b949e);
      background: var(--border-subtle, #21262d); border: none; font-family: inherit;
    }
    .tab.active { color: var(--text); background: var(--accent); }
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-xs); background: var(--bg);
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 300px;
      overflow-y: auto; margin: 0;
    }
    .toolbar { display: flex; justify-content: flex-end; margin-bottom: 4px; }
    .copy-btn {
      font-size: var(--font-xs); padding: 2px 8px; cursor: pointer;
      background: var(--border-subtle, #21262d); border: none; border-radius: 4px;
      color: var(--text-dim, #8b949e); font-family: inherit;
    }
  `;

  private _decode(): Uint8Array {
    if (!this.body) return new Uint8Array(0);
    try {
      return decodeBase64(this.body);
    } catch {
      return new TextEncoder().encode(this.body);
    }
  }

  private _renderContent(): string {
    const bytes = this._decode();
    switch (this._tab) {
      case 'hex':
        return Array.from(bytes.slice(0, 4096))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' ');
      case 'json':
        try {
          const text = new TextDecoder().decode(bytes);
          return JSON.stringify(JSON.parse(text), null, 2);
        } catch { return new TextDecoder().decode(bytes); }
      default:
        return new TextDecoder().decode(bytes);
    }
  }

  private _copyContent() {
    navigator.clipboard.writeText(this._renderContent());
  }

  render() {
    return html`
      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${this._tab === 'text' ? 'active' : ''}" @click=${() => { this._tab = 'text'; }}>${t('inspectorTabText')}</button>
          <button class="tab ${this._tab === 'hex' ? 'active' : ''}" @click=${() => { this._tab = 'hex'; }}>${t('inspectorTabHex')}</button>
          <button class="tab ${this._tab === 'json' ? 'active' : ''}" @click=${() => { this._tab = 'json'; }}>${t('inspectorTabJson')}</button>
        </div>
        <button class="copy-btn" @click=${() => this._copyContent()}>${t('inspectorBtnCopy')}</button>
      </div>
      <pre>${this._renderContent()}</pre>
    `;
  }
}
```

- [ ] **Step 5: Create live-indicator component**

Create `web-src/src/components/inspector/live-indicator.ts`:

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

@customElement('live-indicator')
export class LiveIndicator extends LitElement {
  @property({ type: Boolean }) connected = false;
  @property({ type: Number }) recordCount = 0;
  @property({ type: Boolean }) stopped = false;

  static styles = css`
    :host { display: block; }
    .bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px; background: var(--border-subtle, #21262d);
      border-radius: var(--radius-sm); font-size: var(--font-xs); gap: 8px;
    }
    .status { display: flex; align-items: center; gap: 6px; }
    .dot {
      width: 8px; height: 8px; border-radius: 50%; display: inline-block;
    }
    .dot.connected { background: var(--green); animation: pulse 1.5s ease-in-out infinite; }
    .dot.disconnected { background: var(--red); }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .actions { display: flex; gap: 6px; }
    .actions button {
      font-size: var(--font-xs); padding: 2px 10px; cursor: pointer;
      background: none; border: 1px solid var(--border);
      border-radius: var(--radius-pill); color: var(--text-dim, #8b949e);
      font-family: inherit;
    }
    .actions button:hover { color: var(--text); border-color: var(--text-dim, #8b949e); }
  `;

  render() {
    return html`
      <div class="bar">
        <span class="status">
          <span class="dot ${this.connected ? 'connected' : 'disconnected'}"></span>
          ${this.connected ? t('inspectorStatusConnected') : t('inspectorStatusDisconnected')}
        </span>
        <span style="color:var(--text-dim,#8b949e)">${t('inspectorRecordsCount', { count: String(this.recordCount) })}</span>
        <span class="actions">
          ${this.stopped
            ? html`<button @click=${() => this.dispatchEvent(new CustomEvent('live-reconnect', { bubbles: true, composed: true }))}>${t('inspectorBtnReconnect')}</button>`
            : html`<button @click=${() => this.dispatchEvent(new CustomEvent('live-stop', { bubbles: true, composed: true }))}>${t('inspectorBtnStop')}</button>`}
          <button @click=${() => this.dispatchEvent(new CustomEvent('live-clear', { bubbles: true, composed: true }))}>${t('inspectorBtnClear')}</button>
        </span>
      </div>
    `;
  }
}
```

- [ ] **Step 6: Create record-detail component**

Create `web-src/src/components/inspector/record-detail.ts`:

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { InspectorRecord } from '../../api/types';
import { t } from '../../i18n/i18n';
import './body-viewer';

@customElement('record-detail')
export class RecordDetail extends LitElement {
  @property({ attribute: false }) record: InspectorRecord | null = null;

  static styles = css`
    :host { display: block; }
    .panel {
      background: var(--bg); border-radius: var(--radius-md);
      padding: 12px; margin-top: 8px;
    }
    .section { margin-bottom: 10px; }
    .section-title {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--text-dim, #8b949e); margin-bottom: 4px; font-weight: 600;
    }
    .meta-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px;
      font-size: var(--font-xs);
    }
    .meta-item { display: flex; justify-content: space-between; padding: 2px 0; }
    .meta-label { color: var(--text-dim, #8b949e); }
    .meta-value { font-family: var(--font-mono, 'SF Mono', monospace); }
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-xs); background: #0d1117;
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 200px;
      overflow-y: auto; margin: 0;
    }
  `;

  render() {
    const r = this.record;
    if (!r) return html``;

    return html`
      <div class="panel">
        <!-- Meta -->
        <div class="section">
          <div class="section-title">Overview</div>
          <div class="meta-grid">
            <div class="meta-item"><span class="meta-label">Host</span><span class="meta-value">${r.host}</span></div>
            <div class="meta-item"><span class="meta-label">Remote</span><span class="meta-value">${r.remote}</span></div>
            <div class="meta-item"><span class="meta-label">Local</span><span class="meta-value">${r.local}</span></div>
            <div class="meta-item"><span class="meta-label">Client IP</span><span class="meta-value">${r.clientIP}</span></div>
            <div class="meta-item"><span class="meta-label">Service</span><span class="meta-value">${r.service}</span></div>
            <div class="meta-item"><span class="meta-label">Proto</span><span class="meta-value">${r.proto || '—'}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↓</span><span class="meta-value">${r.inputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↑</span><span class="meta-value">${r.outputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Duration</span><span class="meta-value">${(r.duration / 1e6).toFixed(1)}ms</span></div>
            <div class="meta-item"><span class="meta-label">Error</span><span class="meta-value">${r.err || '—'}</span></div>
          </div>
        </div>

        <!-- HTTP -->
        ${r.http ? html`
          <div class="section">
            <div class="section-title">${t('inspectorDetailHeaders')} — Request</div>
            <pre>${r.http.request.header}</pre>
          </div>
          <div class="section">
            <div class="section-title">${t('inspectorDetailHeaders')} — Response</div>
            <pre>${r.http.response.header}</pre>
          </div>
          ${r.http.request.body ? html`
            <div class="section">
              <div class="section-title">${t('inspectorDetailBody')} — Request</div>
              <body-viewer .body=${r.http.request.body}></body-viewer>
            </div>
          ` : ''}
          ${r.http.response.body ? html`
            <div class="section">
              <div class="section-title">${t('inspectorDetailBody')} — Response</div>
              <body-viewer .body=${r.http.response.body}></body-viewer>
            </div>
          ` : ''}
        ` : ''}

        <!-- TLS -->
        ${r.tls ? html`
          <div class="section">
            <div class="section-title">TLS</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">SNI</span><span class="meta-value">${r.tls.serverName}</span></div>
              <div class="meta-item"><span class="meta-label">ALPN</span><span class="meta-value">${r.tls.proto}</span></div>
              <div class="meta-item"><span class="meta-label">Version</span><span class="meta-value">${r.tls.version}</span></div>
              <div class="meta-item"><span class="meta-label">Cipher</span><span class="meta-value">${r.tls.cipherSuite}</span></div>
            </div>
            ${r.tls.clientHello ? html`
              <div class="section-title" style="margin-top:8px;">ClientHello</div>
              <pre>${r.tls.clientHello}</pre>
            ` : ''}
          </div>
        ` : ''}

        <!-- WebSocket -->
        ${r.websocket ? html`
          <div class="section">
            <div class="section-title">WebSocket</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">From</span><span class="meta-value">${r.websocket.from}</span></div>
              <div class="meta-item"><span class="meta-label">OpCode</span><span class="meta-value">${r.websocket.opcode}</span></div>
              <div class="meta-item"><span class="meta-label">Length</span><span class="meta-value">${r.websocket.length}</span></div>
              <div class="meta-item"><span class="meta-label">Masked</span><span class="meta-value">${r.websocket.masked}</span></div>
            </div>
            ${r.websocket.payload ? html`
              <div class="section-title" style="margin-top:8px;">Payload</div>
              <body-viewer .body=${r.websocket.payload}></body-viewer>
            ` : ''}
          </div>
        ` : ''}

        <!-- DNS -->
        ${r.dns ? html`
          <div class="section">
            <div class="section-title">DNS</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">Name</span><span class="meta-value">${r.dns.name}</span></div>
              <div class="meta-item"><span class="meta-label">Type</span><span class="meta-value">${r.dns.type}</span></div>
              <div class="meta-item"><span class="meta-label">Class</span><span class="meta-value">${r.dns.class}</span></div>
              <div class="meta-item"><span class="meta-label">Cached</span><span class="meta-value">${r.dns.cached ? 'Yes' : 'No'}</span></div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}
```

- [ ] **Step 7: Create record-list component**

Create `web-src/src/components/inspector/record-list.ts`:

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { InspectorRecord, ProtocolType } from '../../api/types';
import './record-detail';

/**
 * Record-row color helpers — return a CSS class for the method badge.
 */
function methodClass(method: string): string {
  const m = method.toUpperCase();
  if (m === 'GET') return 'method-green';
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') return 'method-blue';
  if (m === 'CONNECT') return 'method-yellow';
  if (m === 'DELETE') return 'method-red';
  return 'method-default';
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'var(--green)';
  if (code >= 400) return 'var(--red)';
  return 'var(--text-dim, #8b949e)';
}

@customElement('record-list')
export class RecordList extends LitElement {
  @property({ attribute: false }) records: InspectorRecord[] = [];
  @property() protocol: ProtocolType = 'http';
  @property({ type: Number }) selectedIndex = -1;
  /** Sentinel for infinite scroll — dispatch 'load-more' when visible */
  @property({ type: Boolean }) hasMore = false;

  private _sentinelEl: Element | null = null;
  private _observer: IntersectionObserver | null = null;

  static styles = css`
    :host { display: block; }
    .list { display: flex; flex-direction: column; gap: 4px; }
    .row {
      background: var(--border-subtle, #21262d); border-radius: var(--radius-sm);
      padding: 10px 12px; cursor: pointer; display: flex; align-items: center;
      gap: 10px; font-size: var(--font-xs); transition: background 0.1s;
    }
    .row:hover { background: #30363d; }
    .row.selected { border-left: 2px solid var(--accent); }
    .method-badge {
      padding: 2px 6px; border-radius: 4px; font-weight: 600;
      font-size: 10px; font-family: var(--font-mono, 'SF Mono', monospace);
      min-width: 38px; text-align: center;
    }
    .method-green { background: rgba(63,185,80,0.2); color: var(--green); }
    .method-blue { background: rgba(88,166,255,0.2); color: var(--accent); }
    .method-yellow { background: rgba(210,153,29,0.2); color: #d2991d; }
    .method-red { background: rgba(248,81,73,0.2); color: var(--red); }
    .method-default { background: rgba(139,148,158,0.15); color: var(--text-dim, #8b949e); }
    .details { flex: 1; min-width: 0; }
    .host { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { font-size: 10px; color: var(--text-dim, #8b949e); margin-top: 1px; display: flex; gap: 8px; }
    .right { text-align: right; font-size: 10px; color: var(--text-dim, #8b949e); }
    .sentinel { height: 1px; }
    .empty { text-align: center; padding: 40px 20px; color: var(--text-dim, #8b949e); font-size: var(--font-sm); }
  `;

  updated() {
    if (this._observer) this._observer.disconnect();
    this._observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && this.hasMore) {
        this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true }));
      }
    });
    // Observe sentinel element
    const sentinel = this.shadowRoot?.querySelector('.sentinel');
    if (sentinel) this._observer.observe(sentinel);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._observer?.disconnect();
  }

  private _renderRow(r: InspectorRecord, i: number) {
    const httpHost = r.http?.host || r.host;
    const httpMethod = r.http?.method || '';
    const httpUri = r.http?.uri || '';
    const httpStatus = r.http?.statusCode || 0;
    const wsOpcode = r.websocket?.opcode;

    return html`
      <div class="row ${this.selectedIndex === i ? 'selected' : ''}"
        @click=${() => this.dispatchEvent(new CustomEvent('record-select', { detail: i, bubbles: true, composed: true }))}>
        ${httpMethod ? html`
          <span class="method-badge ${methodClass(httpMethod)}">${httpMethod}</span>
        ` : wsOpcode !== undefined ? html`
          <span class="method-badge method-default">WS</span>
        ` : html`
          <span class="method-badge method-default">—</span>
        `}
        <div class="details">
          <div class="host">${httpHost || r.service}</div>
          <div class="meta">
            <span>${httpUri || r.dst || r.network}</span>
            <span>${r.proto || ''}</span>
          </div>
        </div>
        ${httpStatus ? html`
          <span style="color:${statusColor(httpStatus)};font-weight:600;font-size:var(--font-xs)">${httpStatus}</span>
        ` : ''}
        <div class="right">
          <div>↓${(r.inputBytes / 1024).toFixed(1)}K</div>
          <div>↑${(r.outputBytes / 1024).toFixed(1)}K</div>
        </div>
      </div>
    `;
  }

  render() {
    if (this.records.length === 0) {
      return html`<div class="empty">${t('inspectorNoRecords')}</div>`;
    }
    return html`
      <div class="list">
        ${this.records.map((r, i) => this._renderRow(r, i))}
        <div class="sentinel"></div>
      </div>
    `;
  }
}
```

- [ ] **Step 8: Import t in record-list.ts**

Add the missing import:

```typescript
import { t } from '../../i18n/i18n';
```

(Already included above — verify the import is present in the final file.)

- [ ] **Step 9: Verify TypeScript compilation**

```bash
cd /config/workspace/go-gost/wisper/web-src && npx tsc --noEmit
```

Expected: no type errors.

---

### Task 7: Inspector Page

**Files:**
- Create: `web-src/src/pages/inspector-page.ts`

- [ ] **Step 1: Create inspector page**

Create `web-src/src/pages/inspector-page.ts`:

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ProtocolType, InspectorRecord } from '../api/types';
import { InspectorApiClient } from '../api/inspector';
import { getSettings } from '../store/settings-store';
import { getTunnels } from '../store/tunnel-store';
import { getEntrypoints } from '../store/entrypoint-store';
import { t } from '../i18n/i18n';
import { icon } from '../components/icon';

import '../components/app-scaffold';
import '../components/inspector/protocol-tabs';
import '../components/inspector/mode-toggle';
import '../components/inspector/filter-bar';
import '../components/inspector/record-list';
import '../components/inspector/live-indicator';

type InspectorMode = 'query' | 'live';

@customElement('inspector-page')
export class InspectorPage extends LitElement {
  /** 'tunnel' or 'entrypoint' */
  @property() parentKind: 'tunnel' | 'entrypoint' = 'tunnel';
  @property() parentType = '';
  @property() parentId = '';

  @state() private _mode: InspectorMode = 'query';
  @state() private _protocol: ProtocolType = 'http';
  @state() private _records: InspectorRecord[] = [];
  @state() private _selectedIndex = -1;
  @state() private _service = '';
  @state() private _sid = '';
  @state() private _cursor: string | null = null;
  @state() private _hasMore = true;
  @state() private _loading = false;
  @state() private _liveConnected = false;
  @state() private _liveStopped = false;

  private _client: InspectorApiClient | null = null;
  private _ws: WebSocket | null = null;
  private _reconnectDelay = 1000;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    const s = getSettings();
    if (s.inspector_url) {
      this._client = new InspectorApiClient(s.inspector_url);
    }
    this._fetchRecords();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._closeWs();
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private _getClientId(): string {
    if (this.parentKind === 'tunnel') {
      return this.parentId;
    }
    // For entrypoints, look up the parent tunnel ID
    const eps = getEntrypoints();
    const ep = eps.find(e => e.id === this.parentId);
    return ep?.options?.tunnel_id || this.parentId;
  }

  private _getParentName(): string {
    if (this.parentKind === 'tunnel') {
      const ts = getTunnels();
      return ts.find(t => t.id === this.parentId)?.name || this.parentId;
    }
    const eps = getEntrypoints();
    return eps.find(e => e.id === this.parentId)?.name || this.parentId;
  }

  // ── Query mode ─────────────────────────────────────────────────────────

  private async _fetchRecords(after?: string) {
    if (!this._client || this._loading) return;
    this._loading = true;

    try {
      const resp = await this._client.query({
        client_id: this._getClientId(),
        type: this._protocol,
        service: this._service || undefined,
        sid: this._sid || undefined,
        after,
        limit: 100,
      });

      if (resp.code === 0 && resp.data) {
        const list = resp.data.list || [];
        if (after) {
          this._records = [...this._records, ...list];
        } else {
          this._records = list;
        }
        this._cursor = resp.data.before || null;
        this._hasMore = list.length >= 100;
      }
    } catch {
      // Inspector unreachable — silently handle
    }

    this._loading = false;
  }

  private _onLoadMore() {
    if (this._mode === 'query' && this._hasMore && this._cursor) {
      this._fetchRecords(this._cursor);
    }
  }

  // ── Live mode ──────────────────────────────────────────────────────────

  private _openWs() {
    if (!this._client) return;
    this._closeWs();
    this._liveStopped = false;
    this._reconnectDelay = 1000;

    try {
      this._ws = this._client.connectTail({
        client_id: this._getClientId(),
        type: this._protocol,
        service: this._service || undefined,
        sid: this._sid || undefined,
      });

      this._ws.onopen = () => {
        this._liveConnected = true;
      };

      this._ws.onmessage = (ev) => {
        try {
          const record = JSON.parse(ev.data) as InspectorRecord;
          this._records = [record, ...this._records].slice(0, 200);
        } catch { /* ignore malformed messages */ }
      };

      this._ws.onclose = () => {
        this._liveConnected = false;
        if (!this._liveStopped) {
          this._scheduleReconnect();
        }
      };

      this._ws.onerror = () => {
        this._ws?.close();
      };
    } catch { /* connection failed */ }
  }

  private _scheduleReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this._openWs();
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
    }, this._reconnectDelay);
  }

  private _closeWs() {
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.onmessage = null;
      this._ws.close();
      this._ws = null;
    }
    this._liveConnected = false;
  }

  // ── Event handlers ─────────────────────────────────────────────────────

  private _onModeChange(e: CustomEvent) {
    const mode = e.detail as InspectorMode;
    this._mode = mode;
    this._selectedIndex = -1;
    if (mode === 'live') {
      this._records = [];
      this._openWs();
    } else {
      this._closeWs();
      this._records = [];
      this._fetchRecords();
    }
  }

  private _onProtocolChange(e: CustomEvent) {
    this._protocol = e.detail as ProtocolType;
    this._selectedIndex = -1;
    if (this._mode === 'live') {
      this._records = [];
      this._openWs();
    } else {
      this._records = [];
      this._hasMore = true;
      this._cursor = null;
      this._fetchRecords();
    }
  }

  private _onFilterChange(e: CustomEvent) {
    const { service, sid } = e.detail;
    this._service = service;
    this._sid = sid;
    this._selectedIndex = -1;
    if (this._mode === 'live') {
      this._records = [];
      this._openWs();
    } else {
      this._records = [];
      this._hasMore = true;
      this._cursor = null;
      this._fetchRecords();
    }
  }

  private _onRecordSelect(e: CustomEvent) {
    this._selectedIndex = e.detail as number;
  }

  private _onLiveStop() {
    this._liveStopped = true;
    this._closeWs();
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
  }

  private _onLiveReconnect() {
    this._liveStopped = false;
    this._openWs();
  }

  private _onLiveClear() {
    this._records = [];
    this._selectedIndex = -1;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  // ── Render ─────────────────────────────────────────────────────────────

  static styles = css`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }
    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }
    .id-chip {
      font-size: 10px; padding: 2px 8px; border-radius: 10px;
      background: var(--border-subtle); color: var(--text-dim);
      font-family: var(--font-mono, 'SF Mono', monospace);
    }
    .spacer { height: 8px; }
  `;

  render() {
    const parentName = this._getParentName();
    const backPath = this.parentKind === 'tunnel'
      ? `/tunnel/${this.parentType}/${this.parentId}`
      : `/entrypoint/${this.parentType}/${this.parentId}`;
    const shortId = this._getClientId().slice(0, 8);

    // Not configured — show empty state
    if (!this._client) {
      return html`
        <app-scaffold>
          <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
            <button class="back-btn" @click=${() => this._navigate(backPath)}>
              ${icon('chevron-left')}
            </button>
            <span class="page-title">${t('inspectorTitle')}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 24px;text-align:center;color:var(--text-muted);gap:12px;">
            <div style="font-size:48px;">🔍</div>
            <div style="font-size:var(--font-md);color:var(--text-secondary);">${t('inspectorNotConfigured')}</div>
            <div style="font-size:var(--font-sm);">${t('inspectorNotConfiguredDesc')}</div>
            <a href="/settings" style="color:var(--accent);font-size:var(--font-sm);text-decoration:none;margin-top:8px;">→ Settings</a>
          </div>
        </app-scaffold>
      `;
    }

    return html`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate(backPath)}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">
            ← ${parentName || this.parentId} · ${t('inspectorTitle')}
          </span>
          <span class="id-chip">${shortId}</span>
        </div>

        <!-- Mode toggle -->
        <div style="padding:12px 16px 0;">
          <mode-toggle .mode=${this._mode} @mode-change=${this._onModeChange}></mode-toggle>
        </div>

        <!-- Protocol tabs -->
        <div style="padding:8px 16px 0;">
          <protocol-tabs .active=${this._protocol} @protocol-change=${this._onProtocolChange}></protocol-tabs>
        </div>

        <!-- Filter bar -->
        <div style="padding:8px 16px 0;">
          <inspector-filter-bar
            .clientId=${this._getClientId()}
            .service=${this._service}
            .sid=${this._sid}
            @filter-change=${this._onFilterChange}>
          </inspector-filter-bar>
        </div>

        <!-- Live indicator -->
        ${this._mode === 'live' ? html`
          <div style="padding:8px 16px 0;">
            <live-indicator
              .connected=${this._liveConnected}
              .recordCount=${this._records.length}
              .stopped=${this._liveStopped}
              @live-stop=${this._onLiveStop}
              @live-reconnect=${this._onLiveReconnect}
              @live-clear=${this._onLiveClear}>
            </live-indicator>
          </div>
        ` : ''}

        <div class="spacer"></div>

        <!-- Record list -->
        <div style="padding:0 16px;">
          <record-list
            .records=${this._records}
            .protocol=${this._protocol}
            .selectedIndex=${this._selectedIndex}
            .hasMore=${this._mode === 'query' && this._hasMore}
            @record-select=${this._onRecordSelect}
            @load-more=${() => this._onLoadMore()}>
          </record-list>
        </div>

        <!-- Selected record detail -->
        ${this._selectedIndex >= 0 && this._records[this._selectedIndex] ? html`
          <div style="padding:0 16px 16px;">
            <record-detail .record=${this._records[this._selectedIndex]}></record-detail>
          </div>
        ` : ''}
      </app-scaffold>
    `;
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /config/workspace/go-gost/wisper/web-src && npx tsc --noEmit
```

---

### Task 8: Routes — Inspector Pages

**Files:**
- Modify: `web-src/src/router/routes.ts`

- [ ] **Step 1: Add inspector routes**

Add a lazy import after the existing ones (around line 11):

```typescript
const inspectorPage = () => import('../pages/inspector-page');
```

Add two new route entries before the `/*` catchall (around line 80):

```typescript
{
  path: '/tunnel/:type/:id/inspector',
  render: (params: { type?: string; id?: string }) =>
    html`<inspector-page
      .parentKind=${'tunnel'}
      .parentType=${params.type ?? ''}
      .parentId=${params.id ?? ''}
    ></inspector-page>`,
  enter: async () => {
    await inspectorPage();
    return true;
  },
},
{
  path: '/entrypoint/:type/:id/inspector',
  render: (params: { type?: string; id?: string }) =>
    html`<inspector-page
      .parentKind=${'entrypoint'}
      .parentType=${params.type ?? ''}
      .parentId=${params.id ?? ''}
    ></inspector-page>`,
  enter: async () => {
    await inspectorPage();
    return true;
  },
},
```

Make sure these go BEFORE the `/*` catchall route and AFTER the `/entrypoint/:type/:id` route.

- [ ] **Step 2: Verify compilation**

```bash
cd /config/workspace/go-gost/wisper/web-src && npx tsc --noEmit
```

---

### Task 9: Tunnel & Entrypoint Detail Pages — Inspector Button

**Files:**
- Modify: `web-src/src/pages/tunnel-detail-page.ts`
- Modify: `web-src/src/pages/entrypoint-detail-page.ts`

- [ ] **Step 1: Add inspector button to tunnel detail page**

In `web-src/src/pages/tunnel-detail-page.ts`, add an import for `getSettings`:

```typescript
import { getSettings } from '../store/settings-store';
```

In the `render()` method, insert the inspector entry button between the stats grid section and the edit button section. After the closing `</div>` of the `.section` that contains the stats grid (around line 800, after `: ''}`), add:

```typescript
<!-- Inspector entry (only when inspector URL is configured) -->
${this.mode === 'view' && t2 && getSettings().inspector_url
  ? html`
    <div class="section">
      <div class="card" style="padding:0;">
        <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
          background:linear-gradient(135deg,var(--accent-bg-subtle, rgba(88,166,255,0.06)),rgba(163,113,247,0.04));
          border-radius:var(--radius-lg);cursor:pointer;"
          @click=${() => this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}/inspector`)}>
          <span style="font-size:20px;">🔍</span>
          <div style="flex:1;">
            <div style="font-size:var(--font-sm);font-weight:600;">${t('inspectorEntryTitle')}</div>
            <div style="font-size:var(--font-xs);color:var(--text-muted);">${t('inspectorEntryDesc')}</div>
          </div>
          <span style="color:var(--text-muted);">→</span>
        </div>
      </div>
    </div>
  `
  : ''}
```

- [ ] **Step 2: Add inspector button to entrypoint detail page**

In `web-src/src/pages/entrypoint-detail-page.ts`, add the same import and the same inspector entry button block. The navigation path should be:

```
/entrypoint/${this.entrypointType}/${this.entrypointId}/inspector
```

Everything else is identical to the tunnel version.

- [ ] **Step 3: Build web**

```bash
make web
```

Expected: build succeeds.

---

### Task 10: Integration Test — End-to-End Verification

- [ ] **Step 1: Build Go + web**

```bash
make web && go build -o wisper .
```

Expected: both succeed.

- [ ] **Step 2: Run existing Go tests**

```bash
go test ./... -v
```

Expected: 21/21 pass.

- [ ] **Step 3: Verify settings persistence**

1. Start wisper: `./wisper -addr :18900`
2. Open `http://localhost:18900` in browser
3. Go to Settings page
4. Verify the "Inspector" section exists with URL input and test button
5. Set `http://localhost:18000` as inspector URL
6. Verify connection indicator updates
7. Reload page — verify URL persists
8. Clear the URL and save — verify it stays empty

- [ ] **Step 4: Verify conditional button display**

1. With empty inspector URL: go to any tunnel detail page — no "Traffic Inspection" button
2. Set inspector URL in settings
3. Go to tunnel detail page — "Traffic Inspection" button appears below stats grid
4. Click it → navigates to `/tunnel/:type/:id/inspector`

- [ ] **Step 5: Verify inspector page works with real inspector**

1. Ensure inspector is running on `http://localhost:18000` (or wherever the user configured)
2. Navigate to an inspector page for a tunnel with active traffic
3. Verify Query mode: records load, protocol tabs switch correctly
4. Verify Live mode: WebSocket connects, records stream in
5. Verify record detail: click a record, detail panel shows with body viewer tabs
6. Verify body viewer: Text/Hex/JSON tabs work, Copy button works

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: integrate inspector traffic inspection into wisper

- Add InspectorURL to Go Settings struct + config API handlers
- Add TypeScript types for inspector records (HTTP/WS/TLS/DNS)
- Add InspectorApiClient for browser-direct inspector API calls
- Add inspector UI components: protocol-tabs, mode-toggle, filter-bar,
  record-list, record-detail, body-viewer, live-indicator
- Add inspector page with Query + Live mode, 4 protocol tabs
- Add inspector routes (/tunnel/:type/:id/inspector, /entrypoint/.../inspector)
- Add inspector entry button on tunnel/entrypoint detail pages
- Add inspector URL field + connection status to Settings page
- Add i18n strings (en + zh) for all inspector UI"
```

---

## Verification Summary

| # | Test | How to verify |
|---|------|---------------|
| 1 | Go build | `go build ./... && go vet ./...` |
| 2 | Go tests | `go test ./... -v` — 21/21 pass |
| 3 | TS compilation | `cd web-src && npx tsc --noEmit` |
| 4 | Web build | `make web` |
| 5 | Settings persistence | Set inspector URL → reload → still present |
| 6 | Conditional button | Empty URL → no button; set URL → button appears |
| 7 | Navigation | Click button → navigates to inspector page |
| 8 | Query mode | Records load from real inspector API |
| 9 | Live mode | WebSocket streams records in real-time |
| 10 | Theme | Inspector page respects dark/light theme |
| 11 | Empty state | No inspector URL → "Not configured" message |
