import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { formatBytes, formatRate, formatNumber, formatClockTime, maskKey } from '../utils/format';
import { transportStyle } from '../utils/transport';
import type { Peer, PeerStats } from '../api/types';
import type { LANRefusalGroup } from '../utils/lan-refusal';

/**
 * One allowlist row of a p2p object, drawn read-only: the peer's name and
 * live traffic, its path word, and the host's per-peer diagnostics behind an
 * expander.
 *
 * Two pages draw this row — a p2p tunnel's peers page and a tun hub's own
 * detail page — and they must not drift apart, so it lives here rather than in
 * either of them. What a page owns is the row *around* it: the editor, the
 * enable/disable switch, copy, add, remove. Those are handed in as rowActions;
 * a page with no controls leaves it unset.
 *
 * The row is a fact about a peer, not a control, so this component never
 * mutates anything — the API fills a hub's allowlist rows from the same two
 * interfaces a p2p tunnel's are filled from, and the two read the same way.
 *
 * @attr peer      - The allowlist entry this row is: the key (a credential, so
 *                   masked by default) and its alias. Required — the allowlist
 *                   is what names a peer, and it says so whether or not the
 *                   peer has connected.
 * @attr stat      - The peer's live report, if the object has one: its traffic
 *                   and the host's diagnostics for it. Absent renders the "no
 *                   traffic" line, which is what a peer that has never dialled
 *                   gets.
 * @attr disabled  - A switched-off peer: it keeps its place and its key but has
 *                   no route, so the row reads dimmed and says so in place of
 *                   the path word rather than alongside it.
 * @attr showKeys  - Draw the key in full. A key is a credential, so masking is
 *                   the default and a page reveals it on demand.
 * @attr rowActions - The page's own controls for this row, as a template
 *                   (edit, disable, copy, remove). Passed as a property, not a
 *                   slot: a slotted element lives outside this shadow root, so
 *                   it could not be styled or laid out with the row, and a
 *                   caller reaching for the row would not reach its buttons.
 *                   A page with no controls leaves it unset.
 */
@customElement('peer-stats-row')
export class PeerStatsRow extends LitElement {
  @property({ attribute: false }) peer: Peer | null = null;
  @property({ attribute: false }) stat: PeerStats | null = null;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) showKeys = false;
  /** The page's own controls for this row, rendered inside it. */
  @property() rowActions?: unknown;
  /** The LANs this peer may claim on the hub's device network — its row of the
   *  hub's lan_allow policy, as the row holds them. It is not the same fact as
   *  the peer's claimed LANs below: a spoke may be allowed to claim a LAN it has
   *  not (yet), and a hub that allows nothing refuses every assertion. Empty
   *  everywhere except a hub's peers page. */
  @property() peersLAN = '';
  /** LAN claims this peer is still making that the hub refuses. They are a
   *  live state, not the run's history: a claim the hub has since installed is
   *  filtered out before it gets here. Only a hub's peers page fills this. */
  @property({ attribute: false }) lanRefused: LANRefusalGroup[] = [];
  /** The page's own way to answer those refusals (open the LAN editor with
   *  the refused prefixes filled in), rendered beside them. Absent when the
   *  refusal is one an allow row cannot fix. */
  @property() lanRefusedAction?: unknown;

  @state() private _expanded = false;

  /** The path word, the only place a difference between peers shows. One word
   *  per state; the reason (a STUN server that does not answer, a punch that
   *  failed, ...) is in the tooltip. Nothing when the peer has no session. */
  private _renderTransport() {
    const st = transportStyle(this.stat?.transport);
    if (!st) return nothing;
    return html`<span class="peer-badge ${st.tone}" title=${st.hint}>
      ${icon(st.icon)}<span>${st.label}</span>
    </span>`;
  }

  /** The row's expand: the raw per-peer state the host reports, verbatim
   *  (p2p's own values), so the badge's one word is explained — which endpoint
   *  was dialled, why the last round failed, how long the session and the
   *  silence have been. Only a live session has one: the host reports nothing
   *  for a peer that has never dialled. */
  private _renderDiag() {
    const s = this.stat;
    if (!s) return nothing;
    const caps = s.caps && s.caps.length > 0 ? s.caps.join(', ') : '';
    const row = (label: string, value: string) => html`
      <div class="diag-row">
        <span class="diag-label">${label}</span>
        <span class="diag-value">${value}</span>
      </div>`;
    return html`
      <div class="peer-diag">
        ${row(t('peersDiagPath'), s.transport ?? '—')}
        ${s.reason ? row(t('peersDiagReason'), s.reason) : nothing}
        ${row(t('peersDiagState'), s.state ?? '—')}
        ${s.failed ? row(t('peersDiagFailed'), t('peersDiagYes')) : nothing}
        ${s.last_error ? row(t('peersDiagLastError'), s.last_error) : nothing}
        ${row(t('peersDiagEndpoint'), s.peer_addr || '—')}
        ${row(t('peersDiagCandidates'), String(s.candidates ?? 0))}
        ${caps ? row(t('peersDiagCaps'), caps) : nothing}
        ${row(t('peersDiagSession'), ageMs(s.session_age_ms))}
        ${row(t('peersDiagSilence'), ageMs(s.last_recv_age_ms))}
        <!-- The inline value in full: the smoothed RTT, the variance around it,
             and the resend timeout the pair's KCP settled on. Only a live
             session reports them. -->
        ${s.kcp_live
          ? html`
              ${row(t('peersDiagSRTT'), `${s.srtt_ms ?? 0}ms`)}
              ${row(t('peersDiagRTO'), `${s.rto_ms ?? 0}ms`)}
              ${row(t('peersDiagRTTVar'), `${s.rttvar_ms ?? 0}ms`)}
            `
          : nothing}
        ${s.trace && s.trace.length > 0
          ? html`<div class="diag-trace">
              <span class="diag-label">${t('peersDiagTrace')}</span>
              <div class="trace-lines">
                <!-- Each step carries when it happened: the line is short and
                     the ring holds minutes of history, so a bare list cannot
                     say how long ago a round ran. The stamp is zipped by index
                     from trace_times, parallel to trace. -->
                ${s.trace.map((line, i) => html`<div class="trace-line">${line}${
                  s.trace_times?.[i]
                    ? html`<span class="trace-time">${formatClockTime(s.trace_times[i])}</span>`
                    : nothing
                }</div>`)}
              </div>
            </div>`
          : nothing}
      </div>
    `;
  }

  render() {
    const p = this.peer;
    const s = this.stat;
    // Only a live session has a diagnostic to show: the host reports nothing
    // for a peer that has never dialled.
    const expandable = !!s?.transport;
    return html`
      <div class="peer-row ${this.disabled ? 'off' : ''}">
        <!-- Left to right: what the row is, then what it is doing, then the
             page's controls. The facts (alias, RTT, path word, the diagnostic
             expander) come before the buttons — the same order the tun
             entrypoint's row uses, and the order this row had before it was
             extracted here. Swapping them puts the controls in the middle and
             the badge at the far right, which reads as a different row. -->
        <div class="row-line">
          <span class="peer-alias">${s?.alias || p?.alias || t('peersNoAlias')}</span>
          <!-- The peer's measured round-trip time, ahead of the path badge so
               the badge keeps a fixed place: the alias above flexes, and a
               variable-width RTT to the badge's right would shift it as the
               number changes. Only a live session has one: a peer whose KCP
               never answered yet shows nothing rather than a zero. -->
          ${s && s.kcp_live && (s.srtt_ms ?? 0) > 0
            ? html`<span class="peer-rtt" title="${t('peersRTTHint')} · ${s.transport ?? ''}">${s.srtt_ms}ms</span>`
            : nothing}
          ${this.disabled
            ? html`<span class="peer-badge" title=${t('peersDisabledHint')}>${t('peersDisabled')}</span>`
            : this._renderTransport()}
          ${expandable
            ? html`<button class="icon-btn" title="${t('peersDiagDetails')}"
                @click=${() => { this._expanded = !this._expanded; }}>
                ${icon(this._expanded ? 'chevron-up' : 'chevron-down')}
              </button>`
            : nothing}
          ${this.rowActions}
        </div>
        <div class="peer-key">${this.showKeys ? p?.key : maskKey(p?.key ?? '')}</div>
        <!-- The address the hub assigned this peer on its device network. Only a
             hub's rows hold one (a p2p tunnel has no device network), so it is
             absent — and this line with it — everywhere else. -->
        ${p?.ip ? html`<div class="peer-ip">${t('peersIP')}: ${p.ip}</div>` : nothing}
        <!-- What the hub lets this spoke claim, rather than what it claimed: a
             hub with no row for a spoke refuses every assertion it makes, and a
             row on the peers page is how it is given one. Absent, with this
             line, for a spoke no policy row covers. -->
        ${this.peersLAN ? html`<div class="peer-ip">${t('peersLAN')}: ${this.peersLAN}</div>` : nothing}
        <!-- The LANs this peer holds on the hub's network: the CIDRs it claimed
             and the hub installed. Read the same way the address above it is
             (same class, so the two stack as one block of row facts), and
             absent — with this line — for a peer that claimed none. -->
        ${s?.lan && s.lan.length > 0
          ? html`<div class="peer-ip">${t('peersLAN')}: ${s.lan.join(', ')}</div>`
          : nothing}
        <!-- What the peer keeps asking for and the hub keeps refusing. This is
             the one row fact that asks the operator to do something, so it is
             drawn apart from the quiet grey lines above it: the prefix, the
             hub's reason code, and the page's action when an allow row can
             answer the refusal. -->
        ${this.lanRefused.length > 0
          ? html`
            <div class="lan-refused">
              <div class="lan-refused-head">${t('peersLANRefused')}</div>
              ${this.lanRefused.map(g => html`
                <div class="lan-refused-line">
                  <span class="lan-refused-prefix">${g.prefix}</span>
                  <span class="lan-refused-reason">${g.reason}</span>
                </div>`)}
              <div class="lan-refused-hint">${t('peersLANRefusedHint')}</div>
              ${this.lanRefusedAction
                ? html`<div class="lan-refused-action">${this.lanRefusedAction}</div>`
                : nothing}
            </div>`
          : nothing}
        ${s
          ? html`<div class="peer-stats">
              <span>${formatNumber(s.current_conns)} ${t('p2pColConns')}</span>
              <span>↓ ${formatBytes(s.output_bytes)} <span class="rate">${formatRate(s.output_rate_bytes)}</span></span>
              <span>↑ ${formatBytes(s.input_bytes)} <span class="rate">${formatRate(s.input_rate_bytes)}</span></span>
            </div>`
          : html`<div class="peer-stats"><span class="muted">${t('peersNoTraffic')}</span></div>`}
        ${this._expanded && expandable ? this._renderDiag() : nothing}
      </div>
    `;
  }

  static styles = css`
    .peer-row {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .row-line {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .peer-alias {
      flex: 1;
      font-size: var(--font-sm);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .peer-badge {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 8px;
      border-radius: var(--radius-pill);
      background: var(--border-subtle);
      color: var(--text-muted);
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
    .peer-badge.info {
      color: var(--info);
      background: var(--info-bg);
    }
    .peer-badge.warn {
      color: var(--amber);
    }
    /* A switched-off peer keeps its place and its key, but nothing about it is
       live: the row reads dimmed. */
    .peer-row.off .peer-alias,
    .peer-row.off .peer-key,
    .peer-row.off .peer-stats {
      opacity: 0.5;
    }
    .row-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .peer-key {
      padding-top: 2px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
      color: var(--text-muted);
      overflow-wrap: anywhere;
      line-height: 1.4;
    }
    /* The hub's assignment, read the way the key above it is (monospace), so the
       two stack as one block of row facts. */
    .peer-ip {
      padding-top: 2px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
      color: var(--text-muted);
      overflow-wrap: anywhere;
      line-height: 1.4;
    }
    /* The peer's measured round-trip time, beside the path badge it was
       measured over: as quiet as the row's traffic line below it. */
    .peer-rtt {
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .peer-stats {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .peer-stats .muted {
      font-style: italic;
    }
    /* The rate sits on its own line under the byte count: on a narrow screen a
       single line of "↓ 400.2 KB 0 B/s" has no room and wraps awkwardly. */
    .peer-stats .rate {
      display: block;
      color: var(--text-muted);
      opacity: 0.8;
    }
    /* A refused LAN claim: amber, like the refusal count on the hub's LAN
       section — the peer is fine, the policy is what says no. */
    .lan-refused {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--amber) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent);
      color: var(--amber);
      font-size: var(--font-xs);
      line-height: 1.5;
    }
    .lan-refused-head {
      font-weight: 600;
    }
    .lan-refused-line {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .lan-refused-prefix {
      font-family: var(--font-mono, monospace);
    }
    .lan-refused-reason {
      opacity: 0.9;
    }
    .lan-refused-hint {
      opacity: 0.9;
    }
    .lan-refused-action {
      margin-top: 6px;
    }
    .lan-refused-action button {
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--amber);
      background: transparent;
      color: var(--amber);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .lan-refused-action button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    /* The row's expand: the raw per-peer state, one label/value line each. */
    .peer-diag {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      background: var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: var(--font-xs);
    }
    .diag-row {
      display: flex;
      gap: 8px;
    }
    .diag-label {
      flex: none;
      width: 84px;
      color: var(--text-muted);
    }
    .diag-value {
      color: var(--text-secondary);
      overflow-wrap: anywhere;
    }
    /* The peer's recent punch history: one monospace line per step, oldest
       first (newest last). */
    .diag-trace {
      display: flex;
      gap: 8px;
      margin-top: 2px;
    }
    .trace-lines {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      font-family: var(--font-mono, monospace);
      color: var(--text-secondary);
    }
    .trace-line {
      overflow-wrap: anywhere;
    }
    /* The step's wall-clock stamp, set off from the line text and as quiet as
       the rest of the diagnostic. */
    .trace-time {
      margin-left: 6px;
      color: var(--text-muted);
    }
    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 4px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
    }
    .icon-btn:hover {
      background: var(--border-subtle);
      color: var(--text);
    }
    .icon-btn svg {
      width: 14px;
      height: 14px;
    }
  `;
}

/** ageMs renders a millisecond age compactly; an em dash when unset (0). */
function ageMs(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
