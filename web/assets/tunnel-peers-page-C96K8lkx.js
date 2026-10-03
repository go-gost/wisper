import{i as y,a as m,A as o,b as i,c as s,t as $,G as D,s as P,g as E,B as z}from"./index-m6XZ2FEM.js";import{n as b,r as c,m as k,c as K,a as f,b as _}from"./format-T399x7Wh.js";import{i as d}from"./app-scaffold-CyGUv19U.js";import{c as T}from"./clipboard-C3x8_sid.js";import{s as C}from"./save-error-8HfwdD4m.js";import{a as A}from"./transport-DbMsedIq.js";var S=Object.defineProperty,R=Object.getOwnPropertyDescriptor,v=(e,t,a,r)=>{for(var n=r>1?void 0:r?R(t,a):t,g=e.length-1,u;g>=0;g--)(u=e[g])&&(n=(r?u(t,a,n):u(n))||n);return r&&n&&S(t,a,n),n};let h=class extends m{constructor(){super(...arguments),this.peer=null,this.stat=null,this.disabled=!1,this.showKeys=!1,this._expanded=!1}_renderTransport(){const e=A(this.stat?.transport);return e?i`<span class="peer-badge ${e.tone}" title=${e.hint}>
      ${d(e.icon)}<span>${e.label}</span>
    </span>`:o}_renderDiag(){const e=this.stat;if(!e)return o;const t=e.caps&&e.caps.length>0?e.caps.join(", "):"",a=(r,n)=>i`
      <div class="diag-row">
        <span class="diag-label">${r}</span>
        <span class="diag-value">${n}</span>
      </div>`;return i`
      <div class="peer-diag">
        ${a(s("peersDiagPath"),e.transport??"—")}
        ${e.reason?a(s("peersDiagReason"),e.reason):o}
        ${a(s("peersDiagState"),e.state??"—")}
        ${e.failed?a(s("peersDiagFailed"),s("peersDiagYes")):o}
        ${e.last_error?a(s("peersDiagLastError"),e.last_error):o}
        ${a(s("peersDiagEndpoint"),e.peer_addr||"—")}
        ${a(s("peersDiagCandidates"),String(e.candidates??0))}
        ${t?a(s("peersDiagCaps"),t):o}
        ${a(s("peersDiagSession"),x(e.session_age_ms))}
        ${a(s("peersDiagSilence"),x(e.last_recv_age_ms))}
        ${e.trace&&e.trace.length>0?i`<div class="diag-trace">
              <span class="diag-label">${s("peersDiagTrace")}</span>
              <div class="trace-lines">
                ${e.trace.map(r=>i`<div class="trace-line">${r}</div>`)}
              </div>
            </div>`:o}
      </div>
    `}render(){const e=this.peer,t=this.stat,a=!!t?.transport;return i`
      <div class="peer-row ${this.disabled?"off":""}">
        <div class="row-line">
          <span class="peer-alias">${t?.alias||e?.alias||s("peersNoAlias")}</span>
          ${this.rowActions}
          ${this.disabled?i`<span class="peer-badge" title=${s("peersDisabledHint")}>${s("peersDisabled")}</span>`:this._renderTransport()}
          ${a?i`<button class="icon-btn" title="${s("peersDiagDetails")}"
                @click=${()=>{this._expanded=!this._expanded}}>
                ${d(this._expanded?"chevron-up":"chevron-down")}
              </button>`:o}
        </div>
        <div class="peer-key">${this.showKeys?e?.key:k(e?.key??"")}</div>
        ${t?i`<div class="peer-stats">
              <span>${K(t.current_conns)} ${s("p2pColConns")}</span>
              <span>↓ ${f(t.output_bytes)} <span class="rate">${_(t.output_rate_bytes)}</span></span>
              <span>↑ ${f(t.input_bytes)} <span class="rate">${_(t.input_rate_bytes)}</span></span>
            </div>`:i`<div class="peer-stats"><span class="muted">${s("peersNoTraffic")}</span></div>`}
        ${this._expanded&&a?this._renderDiag():o}
      </div>
    `}};h.styles=y`
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
  `;v([b({attribute:!1})],h.prototype,"peer",2);v([b({attribute:!1})],h.prototype,"stat",2);v([b({type:Boolean})],h.prototype,"disabled",2);v([b({type:Boolean})],h.prototype,"showKeys",2);v([b()],h.prototype,"rowActions",2);v([c()],h.prototype,"_expanded",2);h=v([$("peer-stats-row")],h);function x(e){if(!e||e<=0)return"—";const t=Math.floor(e/1e3);if(t<60)return`${t}s`;const a=Math.floor(t/60);return a<60?`${a}m ${t%60}s`:`${Math.floor(a/60)}h ${a%60}m`}var O=Object.defineProperty,B=Object.getOwnPropertyDescriptor,p=(e,t,a,r)=>{for(var n=r>1?void 0:r?B(t,a):t,g=e.length-1,u;g>=0;g--)(u=e[g])&&(n=(r?u(t,a,n):u(n))||n);return r&&n&&O(t,a,n),n};function M(e){if(!/^[A-Za-z0-9_-]{43}$/.test(e))return!1;try{const t=e+"=".repeat((4-e.length%4)%4);return atob(t.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function w(e){return(e?.options.peers??[]).map(t=>({key:t.key,alias:t.alias??"",disabled:t.disabled===!0}))}let l=class extends m{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:"",disabled:!1},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._snackbar="",this._backend=new D,this._pending=[],this._unsub=null,this._toggleRow=async e=>{const t=this._rows.map((a,r)=>r===e?{...a,disabled:!a.disabled}:a);await this._save(t)},this._addPending=async e=>{await this._save([...this._rows,{key:e,alias:"",disabled:!1}])&&(this._pending=this._pending.filter(t=>t.key!==e))},this._dismissPending=async e=>{try{await this._backend.dismissPendingPeer(e),this._pending=this._pending.filter(t=>t.key!==e)}catch(t){const a=t instanceof Error?t.message:"";this._showSnackbar(`${s("saveFailed")}${a?": "+a:""}`)}},this._saveRow=async()=>{const e={key:this._draft.key.trim(),alias:this._draft.alias.trim(),disabled:this._draft.disabled===!0};if(!M(e.key)){this._rowError=s("peersKeyInvalid");return}if(this._rows.filter((r,n)=>n!==this._editing).some(r=>r.key===e.key)){this._rowError=s("peersKeyDuplicate");return}const a=this._editing==="new"?[...this._rows,e]:this._rows.map((r,n)=>n===this._editing?e:r);await this._save(a)&&(this._editing=null,this._rowError="")},this._deleteRow=async e=>{this._confirmDelete=null,await this._save(this._rows.filter((t,a)=>a!==e))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=P(()=>this._load())}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const e=E().find(t=>t.id===this.tunnelId)??null;this._tunnel=e,this._rows=w(e),this._loadPending()}async _loadPending(){try{this._pending=(await this._backend.listPendingPeers()).peers??[]}catch{}}_startEdit(e){this._editing=e,this._draft={...this._rows[e]},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:"",disabled:!1},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}_ago(e){const t=Math.max(0,(Date.now()-Date.parse(e))/1e3);return t<60?s("peersPendingJustNow"):s("peersPendingMinutes",{n:Math.floor(t/60)})}async _save(e){if(this._saving)return!1;this._saving=!0;try{const t=await z(this.tunnelId,e.map(a=>({key:a.key,alias:a.alias||void 0,disabled:a.disabled||void 0})));return this._tunnel=t,this._rows=w(t),this._showSnackbar(s("saved")),!0}catch(t){const a=C(t);return this._editing!==null?this._rowError=a:this._showSnackbar(a),!1}finally{this._saving=!1}}_showSnackbar(e){this._snackbar=e,setTimeout(()=>{this._snackbar=""},2500)}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(e){return(this._tunnel?.peer_stats??[]).find(t=>t.key===e)}_renderEditor(){return i`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${s("peersAliasPlaceholder")}
            @input=${e=>{this._draft={...this._draft,alias:e.target.value}}}>
          <button class="icon-btn" title="${s("btnCancel")}" @click=${()=>this._cancelEdit()}>
            ${d("close")}
          </button>
          <button class="icon-btn accent" title="${s("btnSave")}" ?disabled=${this._saving}
            @click=${this._saveRow}>
            ${d("check")}
          </button>
        </div>
        <input class="form-input key ${this._rowError?"invalid":""}" .value=${this._draft.key}
          placeholder=${s("peersKeyPlaceholder")}
          @input=${e=>{this._draft={...this._draft,key:e.target.value},this._rowError=""}}>
        ${this._rowError?i`<div class="row-error">${this._rowError}</div>`:o}
      </div>
    `}render(){const e=this._tunnel;return i`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${d("chevron-left")}
          </button>
          <span class="page-title">${s("peersTitle")}</span>
          <button class="pill-btn appbar-action" title="${this._showKeys?s("hideKey"):s("revealKey")}"
            @click=${()=>{this._showKeys=!this._showKeys}}>
            ${d(this._showKeys?"eye-off":"eye")}
          </button>
        </div>

        ${e?i`
            ${this._pending.length>0?i`
                <div class="section">
                  <div class="card">
                    <div class="pending-head">
                      ${s("peersPendingTitle")} (${this._pending.length})
                    </div>
                    ${this._pending.map(t=>i`
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
                              ${d("plus")}
                            </button>
                            <button class="icon-btn" title="${s("peersPendingDismiss")}"
                              @click=${()=>this._dismissPending(t.key)}>
                              ${d("close")}
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
                ${this._rows.length===0&&this._editing!=="new"?i`<div class="empty">${s("peersEmpty")}</div>`:o}
                ${this._rows.map((t,a)=>this._editing===a?this._renderEditor():i`
                    <peer-stats-row
                      .peer=${t}
                      .stat=${this._statFor(t.key)??null}
                      ?disabled=${t.disabled}
                      ?showKeys=${this._showKeys}
                      .rowActions=${i`
                        <span class="row-actions">
                          <button class="icon-btn" title="${t.disabled?s("peersEnable"):s("peersDisable")}"
                            ?disabled=${this._saving}
                            @click=${()=>this._toggleRow(a)}>
                            ${d(t.disabled?"play":"stop")}
                          </button>
                          <button class="icon-btn" title="${s("btnCopy")}" @click=${()=>T(t.key)}>
                            ${d("copy")}
                          </button>
                          <button class="icon-btn" title="${s("btnEdit")}" @click=${()=>this._startEdit(a)}>
                            ${d("edit")}
                          </button>
                          <button class="icon-btn danger" title="${s("btnDelete")}"
                            @click=${()=>{this._confirmDelete=a}}>
                            ${d("trash")}
                          </button>
                        </span>
                      `}></peer-stats-row>
                  `)}
                ${this._editing==="new"?this._renderEditor():o}

                ${this._editing===null?i`
                    <button class="add-row" @click=${()=>this._startAdd()}>
                      ${d("plus")} ${s("peersAdd")}
                    </button>`:o}
              </div>

              <div class="hint">${s("peersHint")}</div>
              <div class="hint">${s("tunHubPeersExclusiveHint")}</div>
              <div class="hint">${s("peersRestartHint")}</div>
              ${this._rows.length===0?i`<div class="hint">${s("peersNoneHint")}</div>`:o}
            </div>
          `:i`<div class="section"><div class="card"><div class="empty">${s("notFound")}</div></div></div>`}

        ${this._confirmDelete!==null?i`
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

        ${this._snackbar?i`<div class="toast">${this._snackbar}</div>`:o}
      </app-scaffold>
    `}};l.styles=y`
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
  `;p([b()],l.prototype,"tunnelType",2);p([b()],l.prototype,"tunnelId",2);p([c()],l.prototype,"_tunnel",2);p([c()],l.prototype,"_rows",2);p([c()],l.prototype,"_editing",2);p([c()],l.prototype,"_draft",2);p([c()],l.prototype,"_saving",2);p([c()],l.prototype,"_rowError",2);p([c()],l.prototype,"_confirmDelete",2);p([c()],l.prototype,"_showKeys",2);p([c()],l.prototype,"_snackbar",2);p([c()],l.prototype,"_pending",2);l=p([$("tunnel-peers-page")],l);export{l as TunnelPeersPage};
