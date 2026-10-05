import{i as m,a as y,A as o,b as a,c as s,t as $,G as P,s as D,g as T,B as E}from"./index-6GGaOmSL.js";import{n as g,r as c,m as k,c as z,a as v,b as _}from"./format-BOOtdwbt.js";import{i as l}from"./app-scaffold-rr7kKBLn.js";import{c as K}from"./clipboard-C3x8_sid.js";import{s as C}from"./save-error-CTyDOzES.js";import{a as S}from"./transport-BNUcpFmI.js";var A=Object.defineProperty,H=Object.getOwnPropertyDescriptor,b=(e,t,i,r)=>{for(var n=r>1?void 0:r?H(t,i):t,u=e.length-1,f;u>=0;u--)(f=e[u])&&(n=(r?f(t,i,n):f(n))||n);return r&&n&&A(t,i,n),n};let h=class extends y{constructor(){super(...arguments),this.peer=null,this.stat=null,this.disabled=!1,this.showKeys=!1,this._expanded=!1}_renderTransport(){const e=S(this.stat?.transport);return e?a`<span class="peer-badge ${e.tone}" title=${e.hint}>
      ${l(e.icon)}<span>${e.label}</span>
    </span>`:o}_renderDiag(){const e=this.stat;if(!e)return o;const t=e.caps&&e.caps.length>0?e.caps.join(", "):"",i=(r,n)=>a`
      <div class="diag-row">
        <span class="diag-label">${r}</span>
        <span class="diag-value">${n}</span>
      </div>`;return a`
      <div class="peer-diag">
        ${i(s("peersDiagPath"),e.transport??"—")}
        ${e.reason?i(s("peersDiagReason"),e.reason):o}
        ${i(s("peersDiagState"),e.state??"—")}
        ${e.failed?i(s("peersDiagFailed"),s("peersDiagYes")):o}
        ${e.last_error?i(s("peersDiagLastError"),e.last_error):o}
        ${i(s("peersDiagEndpoint"),e.peer_addr||"—")}
        ${i(s("peersDiagCandidates"),String(e.candidates??0))}
        ${t?i(s("peersDiagCaps"),t):o}
        ${i(s("peersDiagSession"),w(e.session_age_ms))}
        ${i(s("peersDiagSilence"),w(e.last_recv_age_ms))}
        ${e.trace&&e.trace.length>0?a`<div class="diag-trace">
              <span class="diag-label">${s("peersDiagTrace")}</span>
              <div class="trace-lines">
                ${e.trace.map(r=>a`<div class="trace-line">${r}</div>`)}
              </div>
            </div>`:o}
      </div>
    `}render(){const e=this.peer,t=this.stat,i=!!t?.transport;return a`
      <div class="peer-row ${this.disabled?"off":""}">
        <!-- Left to right: what the row is, then what it is doing, then the
             page's controls. The facts (alias, path word, the diagnostic
             expander) come before the buttons — the same order the tun
             entrypoint's row uses, and the order this row had before it was
             extracted here. Swapping them puts the controls in the middle and
             the badge at the far right, which reads as a different row. -->
        <div class="row-line">
          <span class="peer-alias">${t?.alias||e?.alias||s("peersNoAlias")}</span>
          ${this.disabled?a`<span class="peer-badge" title=${s("peersDisabledHint")}>${s("peersDisabled")}</span>`:this._renderTransport()}
          ${i?a`<button class="icon-btn" title="${s("peersDiagDetails")}"
                @click=${()=>{this._expanded=!this._expanded}}>
                ${l(this._expanded?"chevron-up":"chevron-down")}
              </button>`:o}
          ${this.rowActions}
        </div>
        <div class="peer-key">${this.showKeys?e?.key:k(e?.key??"")}</div>
        <!-- The address the hub assigned this peer on its device network. Only a
             hub's rows hold one (a p2p tunnel has no device network), so it is
             absent — and this line with it — everywhere else. -->
        ${e?.ip?a`<div class="peer-ip">${s("peersIP")}: ${e.ip}</div>`:o}
        ${t?a`<div class="peer-stats">
              <span>${z(t.current_conns)} ${s("p2pColConns")}</span>
              <span>↓ ${v(t.output_bytes)} <span class="rate">${_(t.output_rate_bytes)}</span></span>
              <span>↑ ${v(t.input_bytes)} <span class="rate">${_(t.input_rate_bytes)}</span></span>
            </div>`:a`<div class="peer-stats"><span class="muted">${s("peersNoTraffic")}</span></div>`}
        ${this._expanded&&i?this._renderDiag():o}
      </div>
    `}};h.styles=m`
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
  `;b([g({attribute:!1})],h.prototype,"peer",2);b([g({attribute:!1})],h.prototype,"stat",2);b([g({type:Boolean})],h.prototype,"disabled",2);b([g({type:Boolean})],h.prototype,"showKeys",2);b([g()],h.prototype,"rowActions",2);b([c()],h.prototype,"_expanded",2);h=b([$("peer-stats-row")],h);function w(e){if(!e||e<=0)return"—";const t=Math.floor(e/1e3);if(t<60)return`${t}s`;const i=Math.floor(t/60);return i<60?`${i}m ${t%60}s`:`${Math.floor(i/60)}h ${i%60}m`}var I=Object.defineProperty,O=Object.getOwnPropertyDescriptor,p=(e,t,i,r)=>{for(var n=r>1?void 0:r?O(t,i):t,u=e.length-1,f;u>=0;u--)(f=e[u])&&(n=(r?f(t,i,n):f(n))||n);return r&&n&&I(t,i,n),n};function R(e){if(!/^[A-Za-z0-9_-]{43}$/.test(e))return!1;try{const t=e+"=".repeat((4-e.length%4)%4);return atob(t.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function x(e){return(e?.options.peers??[]).map(t=>({key:t.key,alias:t.alias??"",disabled:t.disabled===!0,ip:t.ip??""}))}let d=class extends y{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:"",disabled:!1,ip:"",ipTouched:!1},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._snackbar="",this._backend=new P,this._pending=[],this._unsub=null,this._toggleRow=async e=>{const t=this._rows.map((i,r)=>r===e?{...i,disabled:!i.disabled}:i);await this._save(t)},this._addPending=async e=>{await this._save([...this._rows,{key:e,alias:"",disabled:!1,ip:""}])&&(this._pending=this._pending.filter(t=>t.key!==e))},this._dismissPending=async e=>{try{await this._backend.dismissPendingPeer(e),this._pending=this._pending.filter(t=>t.key!==e)}catch(t){const i=t instanceof Error?t.message:"";this._showSnackbar(`${s("saveFailed")}${i?": "+i:""}`)}},this._saveRow=async()=>{const e={key:this._draft.key.trim(),alias:this._draft.alias.trim(),disabled:this._draft.disabled===!0,ip:this._draft.ip.trim(),ipTouched:this._draft.ipTouched===!0};if(!R(e.key)){this._rowError=s("peersKeyInvalid");return}if(this._rows.filter((r,n)=>n!==this._editing).some(r=>r.key===e.key)){this._rowError=s("peersKeyDuplicate");return}const i=this._editing==="new"?[...this._rows,e]:this._rows.map((r,n)=>n===this._editing?e:r);await this._save(i)&&(this._editing=null,this._rowError="")},this._deleteRow=async e=>{this._confirmDelete=null,await this._save(this._rows.filter((t,i)=>i!==e))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=D(()=>this._load())}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const e=T().find(t=>t.id===this.tunnelId)??null;this._tunnel=e,this._rows=x(e),this._loadPending()}async _loadPending(){try{this._pending=(await this._backend.listPendingPeers()).peers??[]}catch{}}_startEdit(e){this._editing=e,this._draft={...this._rows[e],ipTouched:!1},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:"",disabled:!1,ip:"",ipTouched:!1},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}get _isHub(){return this._tunnel?.type==="tun"}_ago(e){const t=Math.max(0,(Date.now()-Date.parse(e))/1e3);return t<60?s("peersPendingJustNow"):s("peersPendingMinutes",{n:Math.floor(t/60)})}async _save(e){if(this._saving)return!1;this._saving=!0;try{const t=await E(this.tunnelId,e.map(i=>({key:i.key,alias:i.alias||void 0,disabled:i.disabled||void 0,...i.ipTouched?{ip:i.ip.trim()}:{}})));return this._tunnel=t,this._rows=x(t),this._showSnackbar(s("saved")),!0}catch(t){const i=C(t);return this._editing!==null?this._rowError=i:this._showSnackbar(i),!1}finally{this._saving=!1}}_showSnackbar(e){this._snackbar=e,setTimeout(()=>{this._snackbar=""},2500)}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(e){return(this._tunnel?.peer_stats??[]).find(t=>t.key===e)}_renderEditor(){return a`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${s("peersAliasPlaceholder")}
            @input=${e=>{this._draft={...this._draft,alias:e.target.value}}}>
          <button class="icon-btn" title="${s("btnCancel")}" @click=${()=>this._cancelEdit()}>
            ${l("close")}
          </button>
          <button class="icon-btn accent" title="${s("btnSave")}" ?disabled=${this._saving}
            @click=${this._saveRow}>
            ${l("check")}
          </button>
        </div>
        <input class="form-input key ${this._rowError?"invalid":""}" .value=${this._draft.key}
          placeholder=${s("peersKeyPlaceholder")}
          @input=${e=>{this._draft={...this._draft,key:e.target.value},this._rowError=""}}>
        <!-- The address this spoke may claim on the hub's network. The box is
             prefilled from the row, so it is the hub's allocation of record
             to read or change; any edit marks the draft, and only a marked
             draft ever sends the field (see ipTouched). Emptying it is an
             edit like any other, and it asks the hub for a new address. -->
        ${this._isHub?a`
            <input class="form-input ip" .value=${this._draft.ip}
              placeholder=${s("peersIPPlaceholder")}
              @input=${e=>{this._draft={...this._draft,ip:e.target.value,ipTouched:!0}}}>
            <div class="field-hint">${s("peersIPHint")}</div>
          `:o}
        ${this._rowError?a`<div class="row-error">${this._rowError}</div>`:o}
      </div>
    `}render(){const e=this._tunnel;return a`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${l("chevron-left")}
          </button>
          <span class="page-title">${s("peersTitle")}</span>
          <button class="pill-btn appbar-action" title="${this._showKeys?s("hideKey"):s("revealKey")}"
            @click=${()=>{this._showKeys=!this._showKeys}}>
            ${l(this._showKeys?"eye-off":"eye")}
          </button>
        </div>

        ${e?a`
            ${this._pending.length>0?a`
                <div class="section">
                  <div class="card">
                    <div class="pending-head">
                      ${s("peersPendingTitle")} (${this._pending.length})
                    </div>
                    ${this._pending.map(t=>a`
                      <div class="peer-row">
                        <div class="row-line">
                          <span class="peer-key">${this._showKeys?t.key:k(t.key)}</span>
                          <span class="peer-age">
                            ${s("peersPendingAttempts",{n:t.attempts})} · ${this._ago(t.last_seen)}
                          </span>
                          <span class="row-actions">
                            <button class="icon-btn accent" title="${s("peersPendingAdd")}"
                              ?disabled=${this._saving}
                              @click=${()=>this._addPending(t.key)}>
                              ${l("plus")}
                            </button>
                            <button class="icon-btn" title="${s("peersPendingDismiss")}"
                              @click=${()=>this._dismissPending(t.key)}>
                              ${l("close")}
                            </button>
                          </span>
                        </div>
                      </div>
                    `)}
                    <div class="hint">${s("peersPendingHint")}</div>
                  </div>
                </div>
              `:o}
            <div class="section">
              <div class="card">
                ${this._rows.length===0&&this._editing!=="new"?a`<div class="empty">${s("peersEmpty")}</div>`:o}
                ${this._rows.map((t,i)=>this._editing===i?this._renderEditor():a`
                    <peer-stats-row
                      .peer=${t}
                      .stat=${this._statFor(t.key)??null}
                      ?disabled=${t.disabled}
                      ?showKeys=${this._showKeys}
                      .rowActions=${a`
                        <span class="row-actions">
                          <button class="icon-btn" title="${t.disabled?s("peersEnable"):s("peersDisable")}"
                            ?disabled=${this._saving}
                            @click=${()=>this._toggleRow(i)}>
                            ${l(t.disabled?"play":"stop")}
                          </button>
                          <button class="icon-btn" title="${s("btnCopy")}" @click=${()=>K(t.key)}>
                            ${l("copy")}
                          </button>
                          <button class="icon-btn" title="${s("btnEdit")}" @click=${()=>this._startEdit(i)}>
                            ${l("edit")}
                          </button>
                          <button class="icon-btn danger" title="${s("btnDelete")}"
                            @click=${()=>{this._confirmDelete=i}}>
                            ${l("trash")}
                          </button>
                        </span>
                      `}></peer-stats-row>
                  `)}
                ${this._editing==="new"?this._renderEditor():o}

                ${this._editing===null?a`
                    <button class="add-row" @click=${()=>this._startAdd()}>
                      ${l("plus")} ${s("peersAdd")}
                    </button>`:o}
              </div>

              <div class="hint">${s("peersHint")}</div>
              <div class="hint">${s("tunHubPeersExclusiveHint")}</div>
              <div class="hint">${s("peersRestartHint")}</div>
              ${this._rows.length===0?a`<div class="hint">${s("peersNoneHint")}</div>`:o}
            </div>
          `:a`<div class="section"><div class="card"><div class="empty">${s("notFound")}</div></div></div>`}

        ${this._confirmDelete!==null?a`
            <div class="dialog-overlay" @click=${()=>{this._confirmDelete=null}}>
              <div class="dialog-box" @click=${t=>t.stopPropagation()}>
                <div class="dialog-title">${s("deleteConfirmTitle")}</div>
                <div class="dialog-message">${s("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._confirmDelete=null}}>
                    ${s("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" ?disabled=${this._saving}
                    @click=${()=>this._deleteRow(this._confirmDelete)}>
                    ${s("btnDelete")}
                  </button>
                </div>
              </div>
            </div>`:o}

        ${this._snackbar?a`<div class="toast">${this._snackbar}</div>`:o}
      </app-scaffold>
    `}};d.styles=m`
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
  `;p([g()],d.prototype,"tunnelType",2);p([g()],d.prototype,"tunnelId",2);p([c()],d.prototype,"_tunnel",2);p([c()],d.prototype,"_rows",2);p([c()],d.prototype,"_editing",2);p([c()],d.prototype,"_draft",2);p([c()],d.prototype,"_saving",2);p([c()],d.prototype,"_rowError",2);p([c()],d.prototype,"_confirmDelete",2);p([c()],d.prototype,"_showKeys",2);p([c()],d.prototype,"_snackbar",2);p([c()],d.prototype,"_pending",2);d=p([$("tunnel-peers-page")],d);export{d as TunnelPeersPage};
