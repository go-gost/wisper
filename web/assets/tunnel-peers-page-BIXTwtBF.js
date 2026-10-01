import{a as y,G as x,c as t,s as $,g as m,B as w,b as i,A as r,i as k,t as D}from"./index-C6DHg4MC.js";import{c as E,a as v,b as u,m as b,n as _,r as c}from"./format-KdCqoWfE.js";import{i as l}from"./app-scaffold-iRJjnjLT.js";import{c as P}from"./clipboard-C3x8_sid.js";import{a as z}from"./transport-Bb6A82xL.js";var K=Object.defineProperty,T=Object.getOwnPropertyDescriptor,d=(s,e,a,n)=>{for(var p=n>1?void 0:n?T(e,a):e,g=s.length-1,h;g>=0;g--)(h=s[g])&&(p=(n?h(e,a,p):h(p))||p);return n&&p&&K(e,a,p),p};function C(s){if(!/^[A-Za-z0-9_-]{43}$/.test(s))return!1;try{const e=s+"=".repeat((4-s.length%4)%4);return atob(e.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function f(s){return(s?.options.peers??[]).map(e=>({key:e.key,alias:e.alias??"",disabled:e.disabled===!0}))}let o=class extends y{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:"",disabled:!1},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._expandedKey=null,this._snackbar="",this._backend=new x,this._pending=[],this._unsub=null,this._toggleRow=async s=>{const e=this._rows.map((a,n)=>n===s?{...a,disabled:!a.disabled}:a);await this._save(e)},this._addPending=async s=>{await this._save([...this._rows,{key:s,alias:"",disabled:!1}])&&(this._pending=this._pending.filter(e=>e.key!==s))},this._dismissPending=async s=>{try{await this._backend.dismissPendingPeer(s),this._pending=this._pending.filter(e=>e.key!==s)}catch(e){const a=e instanceof Error?e.message:"";this._showSnackbar(`${t("saveFailed")}${a?": "+a:""}`)}},this._saveRow=async()=>{const s={key:this._draft.key.trim(),alias:this._draft.alias.trim(),disabled:this._draft.disabled===!0};if(!C(s.key)){this._rowError=t("peersKeyInvalid");return}if(this._rows.filter((n,p)=>p!==this._editing).some(n=>n.key===s.key)){this._rowError=t("peersKeyDuplicate");return}const a=this._editing==="new"?[...this._rows,s]:this._rows.map((n,p)=>p===this._editing?s:n);await this._save(a)&&(this._editing=null,this._rowError="")},this._deleteRow=async s=>{this._confirmDelete=null,await this._save(this._rows.filter((e,a)=>a!==s))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=$(()=>this._load())}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const s=m().find(e=>e.id===this.tunnelId)??null;this._tunnel=s,this._rows=f(s),this._loadPending()}async _loadPending(){try{this._pending=(await this._backend.listPendingPeers()).peers??[]}catch{}}_startEdit(s){this._editing=s,this._draft={...this._rows[s]},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:"",disabled:!1},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}_ago(s){const e=Math.max(0,(Date.now()-Date.parse(s))/1e3);return e<60?t("peersPendingJustNow"):t("peersPendingMinutes",{n:Math.floor(e/60)})}async _save(s){if(this._saving)return!1;this._saving=!0;try{const e=await w(this.tunnelId,s.map(a=>({key:a.key,alias:a.alias||void 0,disabled:a.disabled||void 0})));return this._tunnel=e,this._rows=f(e),this._showSnackbar(t("saved")),!0}catch(e){const a=e instanceof Error?e.message:"",n=`${t("saveFailed")}${a?": "+a:""}`;return this._editing!==null?this._rowError=n:this._showSnackbar(n),!1}finally{this._saving=!1}}_showSnackbar(s){this._snackbar=s,setTimeout(()=>{this._snackbar=""},2500)}_navigate(s){window.history.pushState({},"",s),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(s){return(this._tunnel?.peer_stats??[]).find(e=>e.key===s)}_renderStats(s){const e=this._statFor(s);return e?i`
      <span>${E(e.current_conns)} ${t("p2pColConns")}</span>
      <span>↓ ${v(e.output_bytes)} <span class="rate">${u(e.output_rate_bytes)}</span></span>
      <span>↑ ${v(e.input_bytes)} <span class="rate">${u(e.input_rate_bytes)}</span></span>
    `:i`<span class="muted">${t("peersNoTraffic")}</span>`}_renderTransport(s){const e=z(this._statFor(s)?.transport);return e?i`<span class="peer-badge ${e.tone}" title=${e.hint}>
      ${l(e.icon)}<span>${e.label}</span>
    </span>`:r}_canExpand(s){return!!this._statFor(s)?.transport}_toggleExpand(s){this._expandedKey=this._expandedKey===s?null:s}_ageMs(s){if(!s||s<=0)return"—";const e=Math.floor(s/1e3);if(e<60)return`${e}s`;const a=Math.floor(e/60);return a<60?`${a}m ${e%60}s`:`${Math.floor(a/60)}h ${a%60}m`}_renderDiag(s){const e=this._statFor(s);if(!e)return r;const a=e.caps&&e.caps.length>0?e.caps.join(", "):"";return i`
      <div class="peer-diag">
        <div class="diag-row">
          <span class="diag-label">${t("peersDiagPath")}</span>
          <span class="diag-value">${e.transport??"—"}</span>
        </div>
        ${e.reason?i`<div class="diag-row">
              <span class="diag-label">${t("peersDiagReason")}</span>
              <span class="diag-value">${e.reason}</span>
            </div>`:r}
        <div class="diag-row">
          <span class="diag-label">${t("peersDiagState")}</span>
          <span class="diag-value">${e.state??"—"}</span>
        </div>
        ${e.failed?i`<div class="diag-row">
              <span class="diag-label">${t("peersDiagFailed")}</span>
              <span class="diag-value">${t("peersDiagYes")}</span>
            </div>`:r}
        ${e.last_error?i`<div class="diag-row">
              <span class="diag-label">${t("peersDiagLastError")}</span>
              <span class="diag-value">${e.last_error}</span>
            </div>`:r}
        <div class="diag-row">
          <span class="diag-label">${t("peersDiagEndpoint")}</span>
          <span class="diag-value">${e.peer_addr||"—"}</span>
        </div>
        <div class="diag-row">
          <span class="diag-label">${t("peersDiagCandidates")}</span>
          <span class="diag-value">${e.candidates??0}</span>
        </div>
        ${a?i`<div class="diag-row">
              <span class="diag-label">${t("peersDiagCaps")}</span>
              <span class="diag-value">${a}</span>
            </div>`:r}
        <div class="diag-row">
          <span class="diag-label">${t("peersDiagSession")}</span>
          <span class="diag-value">${this._ageMs(e.session_age_ms)}</span>
        </div>
        <div class="diag-row">
          <span class="diag-label">${t("peersDiagSilence")}</span>
          <span class="diag-value">${this._ageMs(e.last_recv_age_ms)}</span>
        </div>
        ${e.trace&&e.trace.length>0?i`<div class="diag-trace">
              <span class="diag-label">${t("peersDiagTrace")}</span>
              <div class="trace-lines">
                ${e.trace.map(n=>i`<div class="trace-line">${n}</div>`)}
              </div>
            </div>`:r}
      </div>
    `}_renderEditor(){return i`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${t("peersAliasPlaceholder")}
            @input=${s=>{this._draft={...this._draft,alias:s.target.value}}}>
          <button class="icon-btn" title="${t("btnCancel")}" @click=${()=>this._cancelEdit()}>
            ${l("close")}
          </button>
          <button class="icon-btn accent" title="${t("btnSave")}" ?disabled=${this._saving}
            @click=${this._saveRow}>
            ${l("check")}
          </button>
        </div>
        <input class="form-input key ${this._rowError?"invalid":""}" .value=${this._draft.key}
          placeholder=${t("peersKeyPlaceholder")}
          @input=${s=>{this._draft={...this._draft,key:s.target.value},this._rowError=""}}>
        ${this._rowError?i`<div class="row-error">${this._rowError}</div>`:r}
      </div>
    `}render(){const s=this._tunnel;return i`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${l("chevron-left")}
          </button>
          <span class="page-title">${t("peersTitle")}</span>
          <button class="pill-btn appbar-action" title="${this._showKeys?t("hideKey"):t("revealKey")}"
            @click=${()=>{this._showKeys=!this._showKeys}}>
            ${l(this._showKeys?"eye-off":"eye")}
          </button>
        </div>

        ${s?i`
            ${this._pending.length>0?i`
                <div class="section">
                  <div class="card">
                    <div class="pending-head">
                      ${t("peersPendingTitle")} (${this._pending.length})
                    </div>
                    ${this._pending.map(e=>i`
                      <div class="peer-row">
                        <div class="row-line">
                          <span class="peer-key">${this._showKeys?e.key:b(e.key)}</span>
                          <span class="peer-age">
                            ${t("peersPendingAttempts",{n:e.attempts})} · ${this._ago(e.last_seen)}
                          </span>
                          <span class="row-actions">
                            <button class="icon-btn accent" title="${t("peersPendingAdd")}"
                              ?disabled=${this._saving}
                              @click=${()=>this._addPending(e.key)}>
                              ${l("plus")}
                            </button>
                            <button class="icon-btn" title="${t("peersPendingDismiss")}"
                              @click=${()=>this._dismissPending(e.key)}>
                              ${l("close")}
                            </button>
                          </span>
                        </div>
                      </div>
                    `)}
                    <div class="hint">${t("peersPendingHint")}</div>
                  </div>
                </div>
              `:r}
            <div class="section">
              <div class="card">
                ${this._rows.length===0&&this._editing!=="new"?i`<div class="empty">${t("peersEmpty")}</div>`:r}
                ${this._rows.map((e,a)=>this._editing===a?this._renderEditor():i`
                    <div class="peer-row ${e.disabled?"off":""}">
                      <div class="row-line">
                        <span class="peer-alias">${e.alias||t("peersNoAlias")}</span>
                        ${e.disabled?i`<span class="peer-badge" title=${t("peersDisabledHint")}>${t("peersDisabled")}</span>`:this._renderTransport(e.key)}
                        ${this._canExpand(e.key)?i`<button class="icon-btn" title="${t("peersDiagDetails")}"
                              @click=${()=>this._toggleExpand(e.key)}>
                              ${l(this._expandedKey===e.key?"chevron-up":"chevron-down")}
                            </button>`:r}
                        <span class="row-actions">
                          <button class="icon-btn" title="${e.disabled?t("peersEnable"):t("peersDisable")}"
                            ?disabled=${this._saving}
                            @click=${()=>this._toggleRow(a)}>
                            ${l(e.disabled?"play":"stop")}
                          </button>
                          <button class="icon-btn" title="${t("btnCopy")}" @click=${()=>P(e.key)}>
                            ${l("copy")}
                          </button>
                          <button class="icon-btn" title="${t("btnEdit")}" @click=${()=>this._startEdit(a)}>
                            ${l("edit")}
                          </button>
                          <button class="icon-btn danger" title="${t("btnDelete")}"
                            @click=${()=>{this._confirmDelete=a}}>
                            ${l("trash")}
                          </button>
                        </span>
                      </div>
                      <div class="peer-key">${this._showKeys?e.key:b(e.key)}</div>
                      <div class="peer-stats">${this._renderStats(e.key)}</div>
                      ${this._expandedKey===e.key?this._renderDiag(e.key):r}
                    </div>
                  `)}
                ${this._editing==="new"?this._renderEditor():r}

                ${this._editing===null?i`
                    <button class="add-row" @click=${()=>this._startAdd()}>
                      ${l("plus")} ${t("peersAdd")}
                    </button>`:r}
              </div>

              <div class="hint">${t("peersHint")}</div>
              <div class="hint">${t("peersRestartHint")}</div>
              ${this._rows.length===0?i`<div class="hint">${t("peersNoneHint")}</div>`:r}
            </div>
          `:i`<div class="section"><div class="card"><div class="empty">${t("notFound")}</div></div></div>`}

        ${this._confirmDelete!==null?i`
            <div class="dialog-overlay" @click=${()=>{this._confirmDelete=null}}>
              <div class="dialog-box" @click=${e=>e.stopPropagation()}>
                <div class="dialog-title">${t("deleteConfirmTitle")}</div>
                <div class="dialog-message">${t("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._confirmDelete=null}}>
                    ${t("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" ?disabled=${this._saving}
                    @click=${()=>this._deleteRow(this._confirmDelete)}>
                    ${t("btnDelete")}
                  </button>
                </div>
              </div>
            </div>`:r}

        ${this._snackbar?i`<div class="toast">${this._snackbar}</div>`:r}
      </app-scaffold>
    `}};o.styles=k`
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
    .pending-head {
      font-weight: 600;
      padding: 4px 12px 8px;
    }
    .peer-age {
      color: var(--text-secondary);
      font-size: var(--font-xs);
      white-space: nowrap;
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
  `;d([_()],o.prototype,"tunnelType",2);d([_()],o.prototype,"tunnelId",2);d([c()],o.prototype,"_tunnel",2);d([c()],o.prototype,"_rows",2);d([c()],o.prototype,"_editing",2);d([c()],o.prototype,"_draft",2);d([c()],o.prototype,"_saving",2);d([c()],o.prototype,"_rowError",2);d([c()],o.prototype,"_confirmDelete",2);d([c()],o.prototype,"_showKeys",2);d([c()],o.prototype,"_expandedKey",2);d([c()],o.prototype,"_snackbar",2);d([c()],o.prototype,"_pending",2);o=d([D("tunnel-peers-page")],o);export{o as TunnelPeersPage};
