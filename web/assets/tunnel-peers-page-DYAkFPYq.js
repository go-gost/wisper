import{i as x,a as y,A as o,b as n,c as a,t as $,G as T,s as P,g as D,B as A}from"./index-BUqLOfsH.js";import{n as f,r as u,h as R,m as k,c as E,a as v,b as m}from"./format-CjTD33Pr.js";import{i as d}from"./app-scaffold-DFFXLJfc.js";import{c as z}from"./clipboard-C3x8_sid.js";import{l as N,s as K}from"./lan-refusal-YZ4OGfEX.js";import{a as C}from"./transport-DT8HXPGf.js";var L=Object.defineProperty,H=Object.getOwnPropertyDescriptor,b=(e,t,s,i)=>{for(var r=i>1?void 0:i?H(t,s):t,c=e.length-1,g;c>=0;c--)(g=e[c])&&(r=(i?g(t,s,r):g(r))||r);return i&&r&&L(t,s,r),r};let h=class extends y{constructor(){super(...arguments),this.peer=null,this.stat=null,this.disabled=!1,this.showKeys=!1,this.peersLAN="",this.lanRefused=[],this._expanded=!1}_renderTransport(){const e=C(this.stat?.transport);return e?n`<span class="peer-badge ${e.tone}" title=${e.hint}>
      ${d(e.icon)}<span>${e.label}</span>
    </span>`:o}_renderDiag(){const e=this.stat;if(!e)return o;const t=e.caps&&e.caps.length>0?e.caps.join(", "):"",s=(i,r)=>n`
      <div class="diag-row">
        <span class="diag-label">${i}</span>
        <span class="diag-value">${r}</span>
      </div>`;return n`
      <div class="peer-diag">
        ${s(a("peersDiagPath"),e.transport??"—")}
        ${e.reason?s(a("peersDiagReason"),e.reason):o}
        ${s(a("peersDiagState"),e.state??"—")}
        ${e.failed?s(a("peersDiagFailed"),a("peersDiagYes")):o}
        ${e.last_error?s(a("peersDiagLastError"),e.last_error):o}
        ${s(a("peersDiagEndpoint"),e.peer_addr||"—")}
        ${s(a("peersDiagCandidates"),String(e.candidates??0))}
        ${t?s(a("peersDiagCaps"),t):o}
        ${s(a("peersDiagSession"),w(e.session_age_ms))}
        ${s(a("peersDiagSilence"),w(e.last_recv_age_ms))}
        <!-- The inline value in full: the smoothed RTT, the variance around it,
             and the resend timeout the pair's KCP settled on. Only a live
             session reports them. -->
        ${e.kcp_live?n`
              ${s(a("peersDiagSRTT"),`${e.srtt_ms??0}ms`)}
              ${s(a("peersDiagRTO"),`${e.rto_ms??0}ms`)}
              ${s(a("peersDiagRTTVar"),`${e.rttvar_ms??0}ms`)}
            `:o}
        ${e.trace&&e.trace.length>0?n`<div class="diag-trace">
              <span class="diag-label">${a("peersDiagTrace")}</span>
              <div class="trace-lines">
                <!-- Each step carries when it happened: the line is short and
                     the ring holds minutes of history, so a bare list cannot
                     say how long ago a round ran. The stamp is zipped by index
                     from trace_times, parallel to trace. -->
                ${e.trace.map((i,r)=>n`<div class="trace-line">${i}${e.trace_times?.[r]?n`<span class="trace-time">${R(e.trace_times[r])}</span>`:o}</div>`)}
              </div>
            </div>`:o}
      </div>
    `}render(){const e=this.peer,t=this.stat,s=!!t?.transport;return n`
      <div class="peer-row ${this.disabled?"off":""}">
        <!-- Left to right: what the row is, then what it is doing, then the
             page's controls. The facts (alias, RTT, path word, the diagnostic
             expander) come before the buttons — the same order the tun
             entrypoint's row uses, and the order this row had before it was
             extracted here. Swapping them puts the controls in the middle and
             the badge at the far right, which reads as a different row. -->
        <div class="row-line">
          <span class="peer-alias">${t?.alias||e?.alias||a("peersNoAlias")}</span>
          <!-- The peer's measured round-trip time, ahead of the path badge so
               the badge keeps a fixed place: the alias above flexes, and a
               variable-width RTT to the badge's right would shift it as the
               number changes. Only a live session has one: a peer whose KCP
               never answered yet shows nothing rather than a zero. -->
          ${t&&t.kcp_live&&(t.srtt_ms??0)>0?n`<span class="peer-rtt" title="${a("peersRTTHint")} · ${t.transport??""}">${t.srtt_ms}ms</span>`:o}
          ${this.disabled?n`<span class="peer-badge" title=${a("peersDisabledHint")}>${a("peersDisabled")}</span>`:this._renderTransport()}
          ${s?n`<button class="icon-btn" title="${a("peersDiagDetails")}"
                @click=${()=>{this._expanded=!this._expanded}}>
                ${d(this._expanded?"chevron-up":"chevron-down")}
              </button>`:o}
          ${this.rowActions}
        </div>
        <div class="peer-key">${this.showKeys?e?.key:k(e?.key??"")}</div>
        <!-- The address the hub assigned this peer on its device network. Only a
             hub's rows hold one (a p2p tunnel has no device network), so it is
             absent — and this line with it — everywhere else. -->
        ${e?.ip?n`<div class="peer-ip">${a("peersIP")}: ${e.ip}</div>`:o}
        <!-- What the hub lets this spoke claim, rather than what it claimed: a
             hub with no row for a spoke refuses every assertion it makes, and a
             row on the peers page is how it is given one. Absent, with this
             line, for a spoke no policy row covers. -->
        ${this.peersLAN?n`<div class="peer-ip">${a("peersLAN")}: ${this.peersLAN}</div>`:o}
        <!-- The LANs this peer holds on the hub's network: the CIDRs it claimed
             and the hub installed. Read the same way the address above it is
             (same class, so the two stack as one block of row facts), and
             absent — with this line — for a peer that claimed none. -->
        ${t?.lan&&t.lan.length>0?n`<div class="peer-ip">${a("peersLAN")}: ${t.lan.join(", ")}</div>`:o}
        <!-- What the peer keeps asking for and the hub keeps refusing. This is
             the one row fact that asks the operator to do something, so it is
             drawn apart from the quiet grey lines above it: the prefix, the
             hub's reason code, and the page's action when an allow row can
             answer the refusal. -->
        ${this.lanRefused.length>0?n`
            <div class="lan-refused">
              <div class="lan-refused-head">${a("peersLANRefused")}</div>
              ${this.lanRefused.map(i=>n`
                <div class="lan-refused-line">
                  <span class="lan-refused-prefix">${i.prefix}</span>
                  <span class="lan-refused-reason">${i.reason}</span>
                </div>`)}
              <div class="lan-refused-hint">${a("peersLANRefusedHint")}</div>
              ${this.lanRefusedAction?n`<div class="lan-refused-action">${this.lanRefusedAction}</div>`:o}
            </div>`:o}
        ${t?n`<div class="peer-stats">
              <span>${E(t.current_conns)} ${a("p2pColConns")}</span>
              <span>↓ ${v(t.output_bytes)} <span class="rate">${m(t.output_rate_bytes)}</span></span>
              <span>↑ ${v(t.input_bytes)} <span class="rate">${m(t.input_rate_bytes)}</span></span>
            </div>`:n`<div class="peer-stats"><span class="muted">${a("peersNoTraffic")}</span></div>`}
        ${this._expanded&&s?this._renderDiag():o}
      </div>
    `}};h.styles=x`
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
  `;b([f({attribute:!1})],h.prototype,"peer",2);b([f({attribute:!1})],h.prototype,"stat",2);b([f({type:Boolean})],h.prototype,"disabled",2);b([f({type:Boolean})],h.prototype,"showKeys",2);b([f()],h.prototype,"rowActions",2);b([f()],h.prototype,"peersLAN",2);b([f({attribute:!1})],h.prototype,"lanRefused",2);b([f()],h.prototype,"lanRefusedAction",2);b([u()],h.prototype,"_expanded",2);h=b([$("peer-stats-row")],h);function w(e){if(!e||e<=0)return"—";const t=Math.floor(e/1e3);if(t<60)return`${t}s`;const s=Math.floor(t/60);return s<60?`${s}m ${t%60}s`:`${Math.floor(s/60)}h ${s%60}m`}var O=Object.defineProperty,S=Object.getOwnPropertyDescriptor,p=(e,t,s,i)=>{for(var r=i>1?void 0:i?S(t,s):t,c=e.length-1,g;c>=0;c--)(g=e[c])&&(r=(i?g(t,s,r):g(r))||r);return i&&r&&O(t,s,r),r};function I(e){if(!/^[A-Za-z0-9_-]{43}$/.test(e))return!1;try{const t=e+"=".repeat((4-e.length%4)%4);return atob(t.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function j(e){const t=new Map;for(const s of(e??"").split(/[\s,]+/)){const i=s.indexOf("=");if(i<0)continue;const r=s.slice(0,i);if(!r)continue;const c=s.slice(i+1);c&&t.set(r,[...t.get(r)??[],c])}return t}function _(e){const t=j(e?.options.lan_allow);return(e?.options.peers??[]).map(s=>({key:s.key,alias:s.alias??"",disabled:s.disabled===!0,ip:s.ip??"",lan:(t.get(s.key)??[]).join(", ")}))}function B(e){const t={};for(const s of e)!s.lanTouched&&!s.lan||(t[s.key]=s.lan.split(",").map(i=>i.trim()).filter(i=>i!==""));return t}let l=class extends y{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:"",disabled:!1,ip:"",lan:"",ipTouched:!1,lanTouched:!1},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._snackbar="",this._backend=new T,this._pending=[],this._unsub=null,this._toggleRow=async e=>{const t=this._rows.map((s,i)=>i===e?{...s,disabled:!s.disabled}:s);await this._save(t)},this._addPending=async e=>{await this._save([...this._rows,{key:e,alias:"",disabled:!1,ip:"",lan:""}])&&(this._pending=this._pending.filter(t=>t.key!==e))},this._dismissPending=async e=>{try{await this._backend.dismissPendingPeer(e),this._pending=this._pending.filter(t=>t.key!==e)}catch(t){const s=t instanceof Error?t.message:"";this._showSnackbar(`${a("saveFailed")}${s?": "+s:""}`)}},this._saveRow=async()=>{const e={key:this._draft.key.trim(),alias:this._draft.alias.trim(),disabled:this._draft.disabled===!0,ip:this._draft.ip.trim(),ipTouched:this._draft.ipTouched===!0,lan:this._draft.lan.trim(),lanTouched:this._draft.lanTouched===!0};if(!I(e.key)){this._rowError=a("peersKeyInvalid");return}if(this._rows.filter((i,r)=>r!==this._editing).some(i=>i.key===e.key)){this._rowError=a("peersKeyDuplicate");return}const s=this._editing==="new"?[...this._rows,e]:this._rows.map((i,r)=>r===this._editing?e:i);await this._save(s)&&(this._editing=null,this._rowError="")},this._deleteRow=async e=>{this._confirmDelete=null,await this._save(this._rows.filter((t,s)=>s!==e))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=P(()=>this._load())}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const e=D().find(t=>t.id===this.tunnelId)??null;this._tunnel=e,this._rows=_(e),this._loadPending()}async _loadPending(){try{this._pending=(await this._backend.listPendingPeers()).peers??[]}catch{}}_startEdit(e){this._editing=e,this._draft={...this._rows[e],ipTouched:!1,lanTouched:!1},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:"",disabled:!1,ip:"",lan:"",ipTouched:!1,lanTouched:!1},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}get _isHub(){return this._tunnel?.type==="tun"}_refusedFor(e){return N(this._tunnel?.lan).filter(t=>!t.resolved&&t.peer===e)}_allowRefused(e,t){const s=this._rows[e],i=s.lan.split(",").map(r=>r.trim()).filter(r=>r!=="");for(const r of t)r.fixableByAllow&&!i.includes(r.prefix)&&i.push(r.prefix);this._editing=e,this._draft={...s,lan:i.join(", "),lanTouched:!0},this._rowError=""}_ago(e){const t=Math.max(0,(Date.now()-Date.parse(e))/1e3);return t<60?a("peersPendingJustNow"):a("peersPendingMinutes",{n:Math.floor(t/60)})}async _save(e){if(this._saving)return!1;this._saving=!0;try{const t=await A(this.tunnelId,e.map(s=>({key:s.key,alias:s.alias||void 0,disabled:s.disabled||void 0,...s.ipTouched?{ip:s.ip.trim()}:{}})),this._isHub?B(e):void 0);return this._tunnel=t,this._rows=_(t),this._showSnackbar(a("saved")),!0}catch(t){const s=K(t);return this._editing!==null?this._rowError=s:this._showSnackbar(s),!1}finally{this._saving=!1}}_showSnackbar(e){this._snackbar=e,setTimeout(()=>{this._snackbar=""},2500)}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(e){return(this._tunnel?.peer_stats??[]).find(t=>t.key===e)}_renderEditor(){return n`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${a("peersAliasPlaceholder")}
            @input=${e=>{this._draft={...this._draft,alias:e.target.value}}}>
          <button class="icon-btn" title="${a("btnCancel")}" @click=${()=>this._cancelEdit()}>
            ${d("close")}
          </button>
          <button class="icon-btn accent" title="${a("btnSave")}" ?disabled=${this._saving}
            @click=${this._saveRow}>
            ${d("check")}
          </button>
        </div>
        <input class="form-input key ${this._rowError?"invalid":""}" .value=${this._draft.key}
          placeholder=${a("peersKeyPlaceholder")}
          @input=${e=>{this._draft={...this._draft,key:e.target.value},this._rowError=""}}>
        <!-- The address this spoke may claim on the hub's network. The box is
             prefilled from the row, so it is the hub's allocation of record
             to read or change; any edit marks the draft, and only a marked
             draft ever sends the field (see ipTouched). Emptying it is an
             edit like any other, and it asks the hub for a new address. -->
        ${this._isHub?n`
            <input class="form-input ip" .value=${this._draft.ip}
              placeholder=${a("peersIPPlaceholder")}
              @input=${e=>{this._draft={...this._draft,ip:e.target.value,ipTouched:!0}}}>
            <div class="field-hint">${a("peersIPHint")}</div>
          `:o}
        <!-- The LANs this spoke may claim on the hub's network, prefilled from
             the hub's policy. A hub that was never told about a spoke's LAN is
             the "no-allow-row" refusal: the spoke dials in fine, shares nothing,
             and the hub's rejected-claims list fills with the same assertion
             every 20s. Typing a CIDR here is what answers it. -->
        ${this._isHub?n`
            <input class="form-input ip" .value=${this._draft.lan}
              placeholder=${a("peersLANPlaceholder")}
              @input=${e=>{this._draft={...this._draft,lan:e.target.value,lanTouched:!0}}}>
            <div class="field-hint">${a("peersLANHint")}</div>
          `:o}
        ${this._rowError?n`<div class="row-error">${this._rowError}</div>`:o}
      </div>
    `}render(){const e=this._tunnel;return n`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${d("chevron-left")}
          </button>
          <span class="page-title">${a("peersTitle")}</span>
          <button class="pill-btn appbar-action" title="${this._showKeys?a("hideKey"):a("revealKey")}"
            @click=${()=>{this._showKeys=!this._showKeys}}>
            ${d(this._showKeys?"eye-off":"eye")}
          </button>
        </div>

        ${e?n`
            ${this._pending.length>0?n`
                <div class="section">
                  <div class="card">
                    <div class="pending-head">
                      ${a("peersPendingTitle")} (${this._pending.length})
                    </div>
                    ${this._pending.map(t=>n`
                      <div class="peer-row">
                        <div class="row-line">
                          <span class="peer-key">${this._showKeys?t.key:k(t.key)}</span>
                          <span class="peer-age">
                            ${a("peersPendingAttempts",{n:t.attempts})} · ${this._ago(t.last_seen)}
                          </span>
                          <span class="row-actions">
                            <button class="icon-btn accent" title="${a("peersPendingAdd")}"
                              ?disabled=${this._saving}
                              @click=${()=>this._addPending(t.key)}>
                              ${d("plus")}
                            </button>
                            <button class="icon-btn" title="${a("peersPendingDismiss")}"
                              @click=${()=>this._dismissPending(t.key)}>
                              ${d("close")}
                            </button>
                          </span>
                        </div>
                      </div>
                    `)}
                    <div class="hint">${a("peersPendingHint")}</div>
                  </div>
                </div>
              `:o}
            <div class="section">
              <div class="card">
                ${this._rows.length===0&&this._editing!=="new"?n`<div class="empty">${a("peersEmpty")}</div>`:o}
                ${this._rows.map((t,s)=>{if(this._editing===s)return this._renderEditor();const i=this._isHub?this._refusedFor(t.key):[],r=i.filter(c=>c.fixableByAllow);return n`
                    <peer-stats-row
                      .peer=${t}
                      .stat=${this._statFor(t.key)??null}
                      .peersLAN=${this._isHub?t.lan:""}
                      .lanRefused=${i}
                      .lanRefusedAction=${r.length>0?n`<button ?disabled=${this._saving}
                            @click=${()=>this._allowRefused(s,i)}>
                            ${a("peersLANRefusedFix")}
                          </button>`:o}
                      ?disabled=${t.disabled}
                      ?showKeys=${this._showKeys}
                      .rowActions=${n`
                        <span class="row-actions">
                          <button class="icon-btn" title="${t.disabled?a("peersEnable"):a("peersDisable")}"
                            ?disabled=${this._saving}
                            @click=${()=>this._toggleRow(s)}>
                            ${d(t.disabled?"play":"stop")}
                          </button>
                          <button class="icon-btn" title="${a("btnCopy")}" @click=${()=>z(t.key)}>
                            ${d("copy")}
                          </button>
                          <button class="icon-btn" title="${a("btnEdit")}" @click=${()=>this._startEdit(s)}>
                            ${d("edit")}
                          </button>
                          <button class="icon-btn danger" title="${a("btnDelete")}"
                            @click=${()=>{this._confirmDelete=s}}>
                            ${d("trash")}
                          </button>
                        </span>
                      `}></peer-stats-row>
                  `})}
                ${this._editing==="new"?this._renderEditor():o}

                ${this._editing===null?n`
                    <button class="add-row" @click=${()=>this._startAdd()}>
                      ${d("plus")} ${a("peersAdd")}
                    </button>`:o}
              </div>

              <div class="hint">${a("peersHint")}</div>
              <div class="hint">${a("tunHubPeersExclusiveHint")}</div>
              <div class="hint">${a("peersRestartHint")}</div>
              ${this._rows.length===0?n`<div class="hint">${a("peersNoneHint")}</div>`:o}
            </div>
          `:n`<div class="section"><div class="card"><div class="empty">${a("notFound")}</div></div></div>`}

        ${this._confirmDelete!==null?n`
            <div class="dialog-overlay" @click=${()=>{this._confirmDelete=null}}>
              <div class="dialog-box" @click=${t=>t.stopPropagation()}>
                <div class="dialog-title">${a("deleteConfirmTitle")}</div>
                <div class="dialog-message">${a("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._confirmDelete=null}}>
                    ${a("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" ?disabled=${this._saving}
                    @click=${()=>this._deleteRow(this._confirmDelete)}>
                    ${a("btnDelete")}
                  </button>
                </div>
              </div>
            </div>`:o}

        ${this._snackbar?n`<div class="toast">${this._snackbar}</div>`:o}
      </app-scaffold>
    `}};l.styles=x`
    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text);
      padding: 4px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
    }
    .back-btn:hover {
      background: var(--border-subtle);
    }
    .page-title {
      font-size: var(--font-md);
      font-weight: 600;
      flex: 1;
    }
    .pill-btn {
      padding: 5px 14px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-weight: 500;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--border-subtle);
      color: var(--text);
    }
    .pill-btn:hover {
      opacity: 0.85;
    }
    .pill-btn svg {
      width: 14px;
      height: 14px;
    }
    .pill-btn.appbar-action {
      margin-left: auto;
    }

    .section {
      padding: 16px;
    }
    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }
    .empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: var(--font-sm);
    }

    /* The editor and the pending rows; the allowlist rows themselves are
       <peer-stats-row>, which owns that presentation. */
    .peer-row {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .row-line {
      display: flex;
      align-items: center;
      gap: 8px;
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
    .pending-head {
      font-weight: 600;
      padding: 4px 12px 8px;
    }
    .peer-age {
      color: var(--text-secondary);
      font-size: var(--font-xs);
      white-space: nowrap;
    }

    .form-input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-subtle);
      background: var(--bg);
      color: var(--text);
      font-size: var(--font-sm);
      font-family: inherit;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--accent);
    }
    .form-input.alias.grow {
      flex: 1;
    }
    .form-input.key {
      margin-top: 6px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
    }
    /* The address field. Not a credential, but it is read and compared as
       text, so it gets the key field's monospace. */
    .form-input.ip {
      margin-top: 6px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
    }
    .form-input.invalid {
      border-color: var(--red);
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
    .icon-btn.danger:hover {
      color: var(--red);
    }
    .icon-btn.accent {
      color: var(--accent);
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .icon-btn svg {
      width: 14px;
      height: 14px;
    }
    .row-error {
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--red);
    }

    /* The address field's explanation. It is about the field above it rather
       than about the page, so it sits inside the row and hugs it. */
    .field-hint {
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
    }

    .add-row {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 12px 14px;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      font-family: inherit;
    }
    .add-row:hover {
      background: var(--border-subtle);
    }
    .add-row svg {
      width: 14px;
      height: 14px;
    }

    .hint {
      padding: 10px 4px 0;
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
    }

    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .dialog-box {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 20px;
      width: min(90vw, 360px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .dialog-title {
      font-size: var(--font-md);
      font-weight: 600;
    }
    .dialog-message {
      font-size: var(--font-sm);
      color: var(--text-muted);
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .dialog-btn {
      padding: 6px 14px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-family: inherit;
    }
    .dialog-btn.cancel {
      background: var(--border-subtle);
      color: var(--text);
    }
    .dialog-btn.danger {
      background: var(--red);
      color: #fff;
    }
    .dialog-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 8px 16px;
      font-size: var(--font-sm);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      z-index: 100;
    }
  `;p([f()],l.prototype,"tunnelType",2);p([f()],l.prototype,"tunnelId",2);p([u()],l.prototype,"_tunnel",2);p([u()],l.prototype,"_rows",2);p([u()],l.prototype,"_editing",2);p([u()],l.prototype,"_draft",2);p([u()],l.prototype,"_saving",2);p([u()],l.prototype,"_rowError",2);p([u()],l.prototype,"_confirmDelete",2);p([u()],l.prototype,"_showKeys",2);p([u()],l.prototype,"_snackbar",2);p([u()],l.prototype,"_pending",2);l=p([$("tunnel-peers-page")],l);export{l as TunnelPeersPage};
