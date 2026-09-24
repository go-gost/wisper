import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { transportStyle } from '../utils/transport';
import { getEntrypoints, refresh, remove, start, stop, subscribe, resetStats } from '../store/entrypoint-store';
import { setItemStats } from '../store/stats-store';
import { copyToClipboard } from '../utils/clipboard';
import { formatBytes, formatRate, formatNumber, formatTimestamp, maskKey } from '../utils/format';
import type { Entrypoint, EntrypointType } from '../api/types';
import '../components/app-scaffold';

type PageMode = 'view' | 'edit' | 'create';

@customElement('entrypoint-detail-page')
export class EntrypointDetailPage extends LitElement {
  @property() entrypointType: EntrypointType = 'tcp';
  @property() entrypointId = '';

  // ── State ────────────────────────────────────────────────────────────

  @state() private mode: PageMode = 'view';
  @state() private _entrypoint: Entrypoint | null = null;
  @state() private _saving = false;
  @state() private _snackbar = '';
  @state() private _showDeleteDialog = false;
  @state() private _showResetDialog = false;
  private _resetKind = '';

  // Form fields
  @state() private _name = '';
  @state() private _endpoint = '';
  @state() private _tunnelId = '';
  @state() private _peer = '';
  @state() private _showPeer = false;
  /** A p2p entrypoint's inner protocol: 'tcp' (default) or 'udp'. */
  @state() private _protocol = 'tcp';
  /** A udp p2p entrypoint's listener keepalive: hold a client's session
   *  (and so its tunnel) between datagrams instead of per-datagram dials. */
  @state() private _keepalive = true;
  /** A tun entrypoint's keepalive period in seconds (x reads ttl as an int). */
  @state() private _ttl = 15;

  // tun spoke fields: this node's own device (see tunSpokeHint)
  @state() private _net = '';
  @state() private _mtu = 0;
  @state() private _deviceName = '';
  @state() private _routes = '';
  @state() private _dns = '';

  private _unsubs: (() => void)[] = [];

  // ── Lifecycle ────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    this._load();

    this._unsubs.push(
      subscribe(() => {
        this._load();
        this.requestUpdate();
      }),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const fn of this._unsubs) fn();
    this._unsubs = [];
  }

  private _load() {
    const id = this.entrypointId;
    const isEdit = window.location.search.includes('edit');

    if (id === 'new' || !id) {
      if (this.mode === 'create') return;
      this.mode = 'create';
      this._entrypoint = null;
      this._resetForm();
      return;
    }

    if (this.mode === 'edit' && this._entrypoint?.id === id) return;

    const existing = getEntrypoints().find(e => e.id === id);
    if (existing) {
      this._entrypoint = existing;
      if (isEdit) {
        this.mode = 'edit';
        this._populateForm(existing);
      } else {
        if (this.mode !== 'edit' || this._entrypoint?.id !== id) {
          this.mode = 'view';
          this._populateForm(existing);
        }
      }
    }
  }

  private _resetForm() {
    this._name = '';
    this._endpoint = '';
    this._tunnelId = '';
    this._peer = '';
    this._protocol = 'tcp';
    this._keepalive = true;
    this._ttl = 15;
    this._net = '';
    this._mtu = 0;
    this._deviceName = '';
    this._routes = '';
    this._dns = '';
  }

  private _populateForm(ep: Entrypoint) {
    this._name = ep.name;
    this._endpoint = ep.entrypoint;
    this._tunnelId = ep.id ?? '';
    this._peer = ep.options?.peer ?? '';
    this._protocol = ep.options?.protocol === 'udp' ? 'udp' : 'tcp';
    this._keepalive = ep.options?.keepalive ?? true;
    this._ttl = ep.options?.ttl || 15;
    this._net = ep.options?.net ?? '';
    this._mtu = ep.options?.mtu ?? 0;
    this._deviceName = ep.options?.device_name ?? '';
    this._routes = ep.options?.routes ?? '';
    this._dns = ep.options?.dns ?? '';

    // An existing tun entrypoint's device may not be up yet (a fresh app
    // start): arm it now, so editing and saving works.
    void this._armVpn();
  }

  /**
   * Ask the Android app to bring the VPN up for these tun values, and resolve
   * once its device exists: the entrypoint cannot be created before that, and
   * only the app can create the device. A no-op elsewhere (desktop, browser) —
   * there is no bridge, and nothing to arm.
   */
  private _armVpn(): Promise<boolean> {
    const bridge = (window as any).WisperNative;
    if (this.entrypointType !== 'tun' || !bridge?.armVpn) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const cb = `__wisperArmVpn_${Date.now()}`;
      const done = (ok: boolean) => {
        delete (window as any)[cb];
        resolve(ok);
      };
      (window as any)[cb] = done;
      try {
        bridge.armVpn(
          this._net.trim(),
          this._routes.trim(),
          this._mtu || 0,
          this._dns.trim(),
          cb,
        );
      } catch (e) {
        console.warn('armVpn failed', e);
        done(true); // no bridge to wait for: let the save report the real error
      }
    });
  }

  /** _renderTransport is the peer's path: one word, with the reason on hover. */
  private _renderTransport(value?: string) {
    const st = transportStyle(value);
    if (!st) return nothing;
    return html`
      <div class="info-row">
        <span class="info-label">${t('p2pTransport')}</span>
        <span class="info-value text">
          <span class="peer-badge ${st.tone}" title=${st.hint}>
            ${icon(st.icon)}<span>${st.label}</span>
          </span>
        </span>
      </div>
    `;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _enterEdit() {
    if (this._entrypoint) {
      this._populateForm(this._entrypoint);
      this.mode = 'edit';
    }
  }

  /** Back steps out of the editor before it leaves the page: from edit mode it
   *  returns to this entrypoint's own page (whose URL carries no ?edit), and
   *  only the view — or a create, which has no page behind it — goes to the
   *  list. */
  private _handleBack() {
    if (this.mode === 'edit' && this.entrypointId) {
      this.mode = 'view';
      this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}`);
      return;
    }
    this._navigate('/');
  }

  private _showSnackbar(msg: string) {
    this._snackbar = msg;
    setTimeout(() => {
      this._snackbar = '';
      this.requestUpdate();
    }, 2500);
  }

  private async _handleSave() {
    if (!this._name.trim()) {
      this._showSnackbar(t('requiredField'));
      return;
    }

    // A tun entrypoint's device must exist before it can be created, and only
    // the app can create it: arm the VPN with these values and wait for it.
    if (this.entrypointType === 'tun' && !(await this._armVpn())) {
      this._showSnackbar(t('vpnNotReady'));
      return;
    }

    this._saving = true;
    try {
      const body = {
        name: this._name.trim(),
        type: this.entrypointType,
        // A tun entrypoint binds no local socket: its device address is the net
        // field below, and the endpoint is meaningless.
        endpoint: this.entrypointType === 'tun' ? '' : this._endpoint.trim(),
        id: this._tunnelId.trim() || undefined,
        peer: this._peer.trim() || undefined,
        protocol: this.entrypointType === 'p2p' ? this._protocol : undefined,
        keepalive:
          this.entrypointType === 'tun'
            ? this._keepalive
            : this.entrypointType === 'p2p' && this._protocol === 'udp'
              ? this._keepalive
              : undefined,
        ttl: this.entrypointType === 'tun' ? this._ttl : undefined,
        net: this.entrypointType === 'tun' ? this._net.trim() || undefined : undefined,
        mtu: this.entrypointType === 'tun' ? this._mtu || undefined : undefined,
        device_name: this.entrypointType === 'tun' ? this._deviceName.trim() || undefined : undefined,
        routes: this.entrypointType === 'tun' ? this._routes.trim() || undefined : undefined,
        dns: this.entrypointType === 'tun' ? this._dns.trim() || undefined : undefined,
      };

      if (this.mode === 'create') {
        await import('../store/entrypoint-store').then(m => m.create(body));
        this._showSnackbar(t('saved'));
        this._navigate('/');
      } else {
        await import('../store/entrypoint-store').then(m => m.update(this.entrypointId, body));
        this._showSnackbar(t('saved'));
        this.mode = 'view';
        await refresh();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      this._showSnackbar(`${t('saveFailed')}${msg ? ': ' + msg : ''}`);
    }
    this._saving = false;
  }

  private async _handleDelete() {
    this._showDeleteDialog = false;
    try {
      await remove(this.entrypointId);
      this._showSnackbar(t('deleted'));
      this._navigate('/');
    } catch {
      this._showSnackbar(t('deleteFailed'));
    }
  }

  private async _handleStart() {
    try {
      await start(this.entrypointId);
      this._showSnackbar(t('started'));
    } catch {
      this._showSnackbar(t('startFailed'));
    }
  }

  private async _handleStop() {
    try {
      await stop(this.entrypointId);
      this._showSnackbar(t('stopped'));
    } catch {
      this._showSnackbar(t('stopFailed'));
    }
  }

  private async _handleCopy(text: string) {
    await copyToClipboard(text);
    this._showSnackbar(t('copiedToClipboard'));
  }

  private _handleResetStats(kind: string) {
    this._resetKind = kind;
    this._showResetDialog = true;
  }

  private async _doResetStats() {
    this._showResetDialog = false;
    try {
      await resetStats(this.entrypointId, this._resetKind);
      // Immediately sync the stats cache from the refreshed entrypoint data.
      if (this._entrypoint) {
        setItemStats(this.entrypointId, this._entrypoint.stats);
      }
      this._showSnackbar(t('saved'));
    } catch {
      this._showSnackbar(t('saveFailed'));
    }
  }

  private _typeLabel(): string {
    return this.entrypointType.toUpperCase();
  }

  // ── Styles ───────────────────────────────────────────────────────────

  static styles = css`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }

    .appbar-btn {
      background: none; border: none; cursor: pointer;
      padding: 4px 8px; border-radius: var(--radius-sm);
      color: var(--text-secondary); font-size: var(--font-sm);
      display: flex; align-items: center; gap: 3px;
      font-family: inherit;
      transition: background var(--transition-fast);
    }
    .appbar-btn:hover { background: var(--border-subtle); }

    .pill-btn {
      padding: 5px 14px; border-radius: var(--radius-pill);
      border: none; cursor: pointer;
      font-size: var(--font-sm); font-weight: 500; font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pill-btn.primary { background: var(--accent); color: var(--accent-fg); }
    .pill-btn.danger { background: var(--red); color: #fff; }
    .pill-btn svg { width: 14px; height: 14px; }
    .pill-btn:hover { opacity: 0.85; }
    .pill-btn.appbar-action { margin-left: auto; }

    .section { padding: 16px; }

    .status-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; margin: 0 16px;
      border-radius: var(--radius-md); font-size: var(--font-sm); font-weight: 500;
    }
    .status-banner.running {
      background: var(--green-bg); color: var(--green-text);
      border: 1px solid var(--green-border);
    }
    .status-banner.stopped {
      background: var(--border-subtle); color: var(--text-muted);
    }
    .status-banner.error {
      background: var(--red-bg); color: var(--red-text);
      border: 1px solid var(--red-border);
    }

    .status-dot-mini {
      width: 6px; height: 6px; border-radius: 50%; background: currentColor;
    }
    .status-spacer { flex: 1; }

    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .info-row {
      display: flex; align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      gap: 16px;
    }
    .info-row:last-child { border-bottom: none; }

    /* Where a p2p entrypoint's peer traffic goes now. Same look as the peers page. */
    .peer-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 8px;
      border-radius: var(--radius-pill);
      background: var(--border-subtle);
      color: var(--text-muted);
      font-family: inherit;
      font-size: var(--font-sm);
    }
    .peer-badge svg {
      width: 12px;
      height: 12px;
    }
    .peer-badge.direct {
      color: var(--green-text);
      background: var(--green-bg);
    }
    .peer-badge.warn {
      color: var(--amber);
    }

    .info-label {
      font-size: var(--font-sm); font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px;
      width: 80px; flex-shrink: 0;
    }
    .info-value {
      font-size: var(--font-md); color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      flex: 1; word-break: break-all;
    }
    .info-value.text {
      font-family: inherit; font-size: var(--font-md);
    }
    .info-value.uuid {
      font-size: var(--font-sm);
    }

    .copy-btn-mini {
      background: none; border: none; cursor: pointer;
      padding: 2px; color: var(--text-muted); display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover { background: var(--border-subtle); color: var(--text); }

    .p2p-hint.warn {
      color: var(--red);
    }

    .p2p-hint {
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
      padding: 0 14px 10px;
    }

    /* ── Option rows (protocol, keepalive) ── */
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
    }
    .switch-label {
      font-size: var(--font-sm);
      color: var(--text);
    }
    .protocol-value {
      font-size: var(--font-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .switch {
      width: 40px;
      height: 22px;
      border-radius: 11px;
      background: var(--border);
      position: relative;
      cursor: pointer;
      transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch.on {
      background: var(--accent);
    }
    .switch-knob {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      position: absolute;
      top: 2px;
      left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    }
    .switch.on .switch-knob {
      left: 20px;
    }

    /* ── Stats grid ── */
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 12px;
    }

    .stat-box {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 12px;
    }

    .stat-value {
      font-size: var(--font-lg);
      font-weight: 700;
      color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    }

    .stat-rate {
      font-size: var(--font-sm);
      color: var(--green-text);
      margin-top: 2px;
    }

    .stat-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-sm);
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .stat-reset-mini {
      display: inline-flex;
      align-items: center;
      margin-left: auto;
      opacity: 0;
      transition: opacity 0.15s;
      cursor: pointer;
      color: var(--text-muted);
    }
    .stat-box:hover .stat-reset-mini { opacity: 1; }
    .stat-reset-mini:hover { color: var(--accent); }

    .form-group { margin-bottom: 14px; }
    .form-label {
      display: block;
      font-size: var(--font-sm); font-weight: 500; color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%; padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface); color: var(--text);
      font-size: var(--font-sm); font-family: inherit; outline: none;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }
    .form-input:focus { border-color: var(--accent); }
    .form-input[readonly] {
      background: var(--border-subtle); color: var(--text-muted);
    }

    .danger-zone {
      margin-top: 20px; padding: 14px;
      border: 1px solid var(--red-border);
      border-radius: var(--radius-md);
    }
    .danger-zone-label {
      font-size: var(--font-sm); font-weight: 600; color: var(--red-text);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
    }

    .toast {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: var(--surface); color: var(--text);
      padding: 10px 20px; border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: var(--font-sm); z-index: 100;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .dialog-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }
    @keyframes fade-in { from { opacity: 0; } }
    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px; max-width: 320px; width: 90%;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .dialog-title { font-weight: 600; font-size: var(--font-md); margin-bottom: 8px; text-align: center; }
    .dialog-message { color: var(--text-secondary); font-size: var(--font-sm); margin-bottom: 20px; text-align: center; line-height: 1.5; }
    .dialog-actions { display: flex; gap: 10px; justify-content: center; }
    .dialog-btn {
      padding: 8px 20px; border-radius: var(--radius-pill);
      border: none; cursor: pointer;
      font-size: var(--font-sm); font-weight: 500; font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .dialog-btn.cancel { background: var(--border-subtle); color: var(--text); }
    .dialog-btn.danger { background: var(--red); color: #fff; }
    .dialog-btn:hover { opacity: 0.85; }

    .btn-edit-bottom {
      width: 100%;
      padding: 8px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      line-height: 1;
    }
    .btn-edit-bottom svg {
      width: 14px;
      height: 14px;
    }
    .btn-edit-bottom:hover { opacity: 0.8; }
  `;

  // ── Render ───────────────────────────────────────────────────────────

  render() {
    const ep = this._entrypoint;
    const stats = ep ? ep.stats : null;
    const typeLabel = this._typeLabel();
    const peer = ep?.options?.peer ?? '';

    return html`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._handleBack()}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">
            ${this.mode === 'create'
              ? `${t('entrypointNewTitle')} — ${typeLabel}`
              : typeLabel + ' Entrypoint'}
          </span>

          ${this.mode === 'view' && ep
            ? html`
              ${ep.status === 'running'
                ? html`<button class="pill-btn danger appbar-action" @click=${() => this._handleStop()}>
                  ■ ${t('btnStop')}
                </button>`
                : html`<button class="pill-btn primary appbar-action" @click=${() => this._handleStart()}>
                  ▶ ${t('btnStart')}
                </button>`}
            `
            : html`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${() => this._handleSave()}>
                ${icon('check')} ${t('btnSave')}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode === 'view' && ep
          ? html`
            <div class="status-banner ${ep.status}">
              <span class="status-dot-mini"></span>
              ${ep.status === 'running'
                ? t('statusRunning')
                : ep.status === 'error'
                  ? t('statusError')
                  : t('statusStopped')}
              ${ep.error ? html` — ${ep.error}` : ''}
              <span class="status-spacer"></span>
            </div>

            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${typeLabel} Entrypoint</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Created</span>
                  <span class="info-value text">${formatTimestamp(ep.created_at)}</span>
                </div>
                ${this.entrypointType === 'p2p' || this.entrypointType === 'tun'
                  ? ''
                  : html`
                <div class="info-row">
                  <span class="info-label">Tunnel ID</span>
                  <span class="info-value uuid">${ep.id ?? '—'}</span>
                  ${ep.id
                    ? html`<button class="copy-btn-mini" @click=${() => this._handleCopy(ep.id)}>
                      ${icon('copy')}
                    </button>`
                    : ''}
                </div>`}
                <div class="info-row">
                  <span class="info-label">Name</span>
                  <span class="info-value text">${ep.name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">${this.entrypointType === 'tun' ? t('fieldNet') : 'Bind Address'}</span>
                  <span class="info-value">${ep.entrypoint}</span>
                </div>
                ${this.entrypointType === 'tun'
                  ? html`
                    ${ep.options?.mtu
                      ? html`<div class="info-row"><span class="info-label">${t('fieldMTU')}</span><span class="info-value text">${ep.options.mtu}</span></div>`
                      : ''}
                    ${ep.options?.device_name
                      ? html`<div class="info-row"><span class="info-label">${t('fieldDeviceName')}</span><span class="info-value text">${ep.options.device_name}</span></div>`
                      : ''}
                    ${ep.options?.routes
                      ? html`<div class="info-row"><span class="info-label">${t('fieldRoutes')}</span><span class="info-value text">${ep.options.routes}</span></div>`
                      : ''}
                    ${ep.options?.dns
                      ? html`<div class="info-row"><span class="info-label">${t('fieldDNS')}</span><span class="info-value text">${ep.options.dns}</span></div>`
                      : ''}
                    <div class="info-row">
                      <span class="info-label">${t('entrypointPeerKey')}</span>
                      <span class="info-value">${this._showPeer ? peer : maskKey(peer)}</span>
                      ${peer
                        ? html`<button class="copy-btn-mini" @click=${() => this._handleCopy(peer)}>
                          ${icon('copy')}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer ? t('hideKey') : t('revealKey')}"
                          @click=${() => { this._showPeer = !this._showPeer; }}>
                          ${icon(this._showPeer ? 'eye-off' : 'eye')}
                        </button>`
                        : ''}
                    </div>
                    ${this._renderTransport(ep.peer_transport)}
                    <div class="info-row">
                      <span class="info-label">${t('switchKeepalive')}</span>
                      <span class="info-value text">${ep.options?.keepalive ? t('statusRunning') : t('statusStopped')}${ep.options?.ttl ? ` · ${ep.options.ttl}s` : ''}</span>
                    </div>
                    <div class="p2p-hint">${t('tunSpokeHint')}</div>
                  `
                  : this.entrypointType === 'p2p'
                  ? html`
                    <div class="info-row">
                      <span class="info-label">${t('entrypointPeerKey')}</span>
                      <span class="info-value">${this._showPeer ? peer : maskKey(peer)}</span>
                      ${peer
                        ? html`<button class="copy-btn-mini" @click=${() => this._handleCopy(peer)}>
                          ${icon('copy')}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer ? t('hideKey') : t('revealKey')}"
                          @click=${() => { this._showPeer = !this._showPeer; }}>
                          ${icon(this._showPeer ? 'eye-off' : 'eye')}
                        </button>`
                        : ''}
                    </div>
                    ${this._renderTransport(ep.peer_transport)}
                    <div class="info-row">
                      <span class="info-label">${t('fieldProtocol')}</span>
                      <span class="info-value text">
                        ${(ep.options?.protocol === 'udp' ? 'udp' : 'tcp').toUpperCase()}
                      </span>
                    </div>
                    <div class="p2p-hint">${t('p2pEntryHint')}</div>
                  `
                  : ''}
              </div>

              <!-- Stats grid -->
              ${stats
                ? html`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${() => this._handleResetStats('conns')} title="${t('btnResetStats')}">${icon('rotate-cw')}</span></div>
                      <div class="stat-value">${formatNumber(stats.total_conns)}</div>
                      <div class="stat-rate">${formatNumber(stats.current_conns)} active · ${stats.request_rate.toFixed(1)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${() => this._handleResetStats('errors')} title="${t('btnResetStats')}">${icon('rotate-cw')}</span></div>
                      <div class="stat-value">${formatNumber(stats.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${() => this._handleResetStats('output')} title="${t('btnResetOutput')}">${icon('rotate-cw')}</span></div>
                      <div class="stat-value">${formatBytes(stats.output_bytes)}</div>
                      <div class="stat-rate">${formatRate(stats.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${() => this._handleResetStats('input')} title="${t('btnResetInput')}">${icon('rotate-cw')}</span></div>
                      <div class="stat-value">${formatBytes(stats.input_bytes)}</div>
                      <div class="stat-rate">${formatRate(stats.input_rate_bytes)}</div>
                    </div>
                  </div>
                `
                : ''}
            </div>

            <div class="section">
              <button class="btn-edit-bottom" @click=${() => this._enterEdit()}>
                ${icon('edit')} ${t('btnEdit')}
              </button>
            </div>
          `
          : ''}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode !== 'view'
          ? html`
            <div class="section">
              <div class="card" style="padding:16px;">
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <input class="form-input" readonly .value=${typeLabel + ' Entrypoint'}>
                </div>

                <!-- What a tun entrypoint is and what it needs, before the fields
                     it implies: the device is the one thing here that can make
                     the save fail. -->
                ${this.entrypointType === 'tun'
                  ? html`
                    <div class="p2p-hint warn">${t('tunPrivilegeHint')}</div>
                    <div class="p2p-hint">${t('tunSpokeHint')}</div>
                    <div class="p2p-hint">${t('tunKeepaliveHint')}</div>
                  `
                  : ''}

                <!-- A p2p or tun entrypoint has no tunnel id to route by. -->
                ${this.entrypointType === 'p2p' || this.entrypointType === 'tun'
                  ? ''
                  : html`
                <div class="form-group">
                  <label class="form-label">Tunnel ID</label>
                  <input class="form-input"
                    ?readonly=${this.mode === 'edit'}
                    .value=${this._tunnelId}
                    placeholder="Paste tunnel UUID"
                    @input=${(e: Event) => { this._tunnelId = (e.target as HTMLInputElement).value; }}>
                </div>`}

                <div class="form-group">
                  <label class="form-label">${t('fieldName')}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Entrypoint"
                    @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}>
                </div>

                ${this.entrypointType === 'tun'
                  ? html`
                    <div class="form-group">
                      <label class="form-label">${t('fieldNet')}</label>
                      <input class="form-input" .value=${this._net} placeholder="10.10.0.2/24"
                        @input=${(e: Event) => { this._net = (e.target as HTMLInputElement).value; }}>
                      <div class="p2p-hint">${t('fieldNetHint')}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t('fieldMTU')}</label>
                      <input class="form-input" type="number" .value=${this._mtu ? String(this._mtu) : ''} placeholder="1420"
                        @input=${(e: Event) => { this._mtu = parseInt((e.target as HTMLInputElement).value, 10) || 0; }}>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t('fieldDeviceName')}</label>
                      <input class="form-input" .value=${this._deviceName} placeholder="wisper0"
                        @input=${(e: Event) => { this._deviceName = (e.target as HTMLInputElement).value; }}>
                      <div class="p2p-hint">${t('fieldDeviceNameHint')}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t('fieldRoutes')}</label>
                      <input class="form-input" .value=${this._routes} placeholder="0.0.0.0/0"
                        @input=${(e: Event) => { this._routes = (e.target as HTMLInputElement).value; }}>
                      <div class="p2p-hint">${t('fieldRoutesHint')}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t('fieldDNS')}</label>
                      <input class="form-input" .value=${this._dns} placeholder="10.10.0.1"
                        @input=${(e: Event) => { this._dns = (e.target as HTMLInputElement).value; }}>
                    </div>
                  `
                  : html`
                <div class="form-group">
                  <label class="form-label">${t('fieldBindAddress')}</label>
                  <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                    @input=${(e: Event) => { this._endpoint = (e.target as HTMLInputElement).value; }}>
                </div>`}

                ${this.entrypointType === 'p2p' || this.entrypointType === 'tun'
                  ? html`
                    <div class="form-group">
                      <label class="form-label">${t('entrypointPeerKey')}</label>
                      <input class="form-input" .value=${this._peer} placeholder="Base64 public key"
                        @input=${(e: Event) => { this._peer = (e.target as HTMLInputElement).value; }}>
                    </div>
                    ${this.entrypointType === 'tun'
                      ? html`
                        <div class="switch-row">
                          <span class="switch-label">${t('switchKeepalive')}</span>
                          <div class="switch ${this._keepalive ? 'on' : ''}"
                            @click=${() => { this._keepalive = !this._keepalive; }}>
                            <div class="switch-knob"></div>
                          </div>
                        </div>
                        <div class="form-group">
                          <label class="form-label">${t('fieldTTL')}</label>
                          <input class="form-input" type="number" .value=${this._ttl ? String(this._ttl) : ''} placeholder="15"
                            @input=${(e: Event) => { this._ttl = parseInt((e.target as HTMLInputElement).value, 10) || 0; }}>
                        </div>
                      `
                      : ''}
                    ${this.entrypointType === 'p2p'
                      ? html`
                    <div class="switch-row" @click=${() => {
                      this._protocol = this._protocol === 'tcp' ? 'udp' : 'tcp';
                    }}>
                      <span class="switch-label">${t('fieldProtocol')}</span>
                      <span class="protocol-value">
                        ${this._protocol === 'udp' ? t('protocolUdp') : t('protocolTcp')}
                        ${icon('chevron-right')}
                      </span>
                    </div>
                    ${this._protocol === 'udp'
                      ? html`
                    <div class="switch-row">
                      <span class="switch-label">${t('switchKeepalive')}</span>
                      <div class="switch ${this._keepalive ? 'on' : ''}"
                        @click=${() => { this._keepalive = !this._keepalive; }}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                    <div class="p2p-hint">${t('keepaliveHint')}</div>`
                      : ''}
                  `
                      : ''}
                  `
                  : ''}

                ${this.mode === 'edit'
                  ? html`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" @click=${() => { this._showDeleteDialog = true; }}>
                        ${icon('trash')} ${t('btnDelete')}
                      </button>
                    </div>
                  `
                  : ''}
              </div>
            </div>
          `
          : ''}

        ${this._snackbar ? html`<div class="toast">${this._snackbar}</div>` : ''}

        ${this._showResetDialog
          ? html`
            <div class="dialog-overlay" @click=${() => { this._showResetDialog = false; }}>
              <div class="dialog-box" @click=${(e: Event) => e.stopPropagation()}>
                <div class="dialog-title">${t('resetStatsConfirmTitle')}</div>
                <div class="dialog-message">${t('resetStatsConfirm')}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${() => { this._showResetDialog = false; }}>
                    ${t('btnCancel')}
                  </button>
                  <button class="dialog-btn danger" @click=${() => this._doResetStats()}>
                    ${t('btnResetStats')}
                  </button>
                </div>
              </div>
            </div>
          `
          : ''}

        ${this._showDeleteDialog
          ? html`
            <div class="dialog-overlay" @click=${() => { this._showDeleteDialog = false; }}>
              <div class="dialog-box" @click=${(e: Event) => e.stopPropagation()}>
                <div class="dialog-title">${t('deleteConfirmTitle')}</div>
                <div class="dialog-message">${t('deleteConfirmMessage')}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${() => { this._showDeleteDialog = false; }}>
                    ${t('btnCancel')}
                  </button>
                  <button class="dialog-btn danger" @click=${() => this._handleDelete()}>
                    ${t('btnDelete')}
                  </button>
                </div>
              </div>
            </div>
          `
          : ''}
      </app-scaffold>
    `;
  }

}
