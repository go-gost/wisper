import{a as y,G as m,c as s,s as x,g as w,B as $,b as a,A as c,i as k,t as P}from"./index-Cb218_Bi.js";import{c as E,a as u,b as g,m as f,n as _,r as p}from"./format-BR2vJd1b.js";import{i as d}from"./app-scaffold-BiPWu6nn.js";import{c as z}from"./clipboard-C3x8_sid.js";import{a as D}from"./transport-D6HXzMHU.js";var K=Object.defineProperty,C=Object.getOwnPropertyDescriptor,o=(t,e,i,n)=>{for(var l=n>1?void 0:n?C(e,i):e,h=t.length-1,b;h>=0;h--)(b=t[h])&&(l=(n?b(e,i,l):b(l))||l);return n&&l&&K(e,i,l),l};function T(t){if(!/^[A-Za-z0-9_-]{43}$/.test(t))return!1;try{const e=t+"=".repeat((4-t.length%4)%4);return atob(e.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function v(t){return(t?.options.peers??[]).map(e=>({key:e.key,alias:e.alias??"",disabled:e.disabled===!0}))}let r=class extends y{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:"",disabled:!1},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._snackbar="",this._backend=new m,this._pending=[],this._unsub=null,this._toggleRow=async t=>{const e=this._rows.map((i,n)=>n===t?{...i,disabled:!i.disabled}:i);await this._save(e)},this._addPending=async t=>{await this._save([...this._rows,{key:t,alias:"",disabled:!1}])&&(this._pending=this._pending.filter(e=>e.key!==t))},this._dismissPending=async t=>{try{await this._backend.dismissPendingPeer(t),this._pending=this._pending.filter(e=>e.key!==t)}catch(e){const i=e instanceof Error?e.message:"";this._showSnackbar(`${s("saveFailed")}${i?": "+i:""}`)}},this._saveRow=async()=>{const t={key:this._draft.key.trim(),alias:this._draft.alias.trim(),disabled:this._draft.disabled===!0};if(!T(t.key)){this._rowError=s("peersKeyInvalid");return}if(this._rows.filter((n,l)=>l!==this._editing).some(n=>n.key===t.key)){this._rowError=s("peersKeyDuplicate");return}const i=this._editing==="new"?[...this._rows,t]:this._rows.map((n,l)=>l===this._editing?t:n);await this._save(i)&&(this._editing=null,this._rowError="")},this._deleteRow=async t=>{this._confirmDelete=null,await this._save(this._rows.filter((e,i)=>i!==t))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=x(()=>this._load())}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const t=w().find(e=>e.id===this.tunnelId)??null;this._tunnel=t,this._rows=v(t),this._loadPending()}async _loadPending(){try{this._pending=(await this._backend.listPendingPeers()).peers??[]}catch{}}_startEdit(t){this._editing=t,this._draft={...this._rows[t]},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:"",disabled:!1},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}_ago(t){const e=Math.max(0,(Date.now()-Date.parse(t))/1e3);return e<60?s("peersPendingJustNow"):s("peersPendingMinutes",{n:Math.floor(e/60)})}async _save(t){if(this._saving)return!1;this._saving=!0;try{const e=await $(this.tunnelId,t.map(i=>({key:i.key,alias:i.alias||void 0,disabled:i.disabled||void 0})));return this._tunnel=e,this._rows=v(e),this._showSnackbar(s("saved")),!0}catch(e){const i=e instanceof Error?e.message:"",n=`${s("saveFailed")}${i?": "+i:""}`;return this._editing!==null?this._rowError=n:this._showSnackbar(n),!1}finally{this._saving=!1}}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar=""},2500)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(t){return(this._tunnel?.peer_stats??[]).find(e=>e.key===t)}_renderStats(t){const e=this._statFor(t);return e?a`
      <span>${E(e.current_conns)} ${s("p2pColConns")}</span>
      <span>↓ ${u(e.output_bytes)} <span class="rate">${g(e.output_rate_bytes)}</span></span>
      <span>↑ ${u(e.input_bytes)} <span class="rate">${g(e.input_rate_bytes)}</span></span>
    `:a`<span class="muted">${s("peersNoTraffic")}</span>`}_renderTransport(t){const e=D(this._statFor(t)?.transport);return e?a`<span class="peer-badge ${e.tone}" title=${e.hint}>
      ${d(e.icon)}<span>${e.label}</span>
    </span>`:c}_renderEditor(){return a`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${s("peersAliasPlaceholder")}
            @input=${t=>{this._draft={...this._draft,alias:t.target.value}}}>
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
          @input=${t=>{this._draft={...this._draft,key:t.target.value},this._rowError=""}}>
        ${this._rowError?a`<div class="row-error">${this._rowError}</div>`:c}
      </div>
    `}render(){const t=this._tunnel;return a`
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

        ${t?a`
            ${this._pending.length>0?a`
                <div class="section">
                  <div class="card">
                    <div class="pending-head">
                      ${s("peersPendingTitle")} (${this._pending.length})
                    </div>
                    ${this._pending.map(e=>a`
                      <div class="peer-row">
                        <div class="row-line">
                          <span class="peer-key">${this._showKeys?e.key:f(e.key)}</span>
                          <span class="peer-age">
                            ${s("peersPendingAttempts",{n:e.attempts})} · ${this._ago(e.last_seen)}
                          </span>
                          <span class="row-actions">
                            <button class="icon-btn accent" title="${s("peersPendingAdd")}"
                              ?disabled=${this._saving}
                              @click=${()=>this._addPending(e.key)}>
                              ${d("plus")}
                            </button>
                            <button class="icon-btn" title="${s("peersPendingDismiss")}"
                              @click=${()=>this._dismissPending(e.key)}>
                              ${d("close")}
                            </button>
                          </span>
                        </div>
                      </div>
                    `)}
                    <div class="hint">${s("peersPendingHint")}</div>
                  </div>
                </div>
              `:c}
            <div class="section">
              <div class="card">
                ${this._rows.length===0&&this._editing!=="new"?a`<div class="empty">${s("peersEmpty")}</div>`:c}
                ${this._rows.map((e,i)=>this._editing===i?this._renderEditor():a`
                    <div class="peer-row ${e.disabled?"off":""}">
                      <div class="row-line">
                        <span class="peer-alias">${e.alias||s("peersNoAlias")}</span>
                        ${e.disabled?a`<span class="peer-badge" title=${s("peersDisabledHint")}>${s("peersDisabled")}</span>`:this._renderTransport(e.key)}
                        <span class="row-actions">
                          <button class="icon-btn" title="${e.disabled?s("peersEnable"):s("peersDisable")}"
                            ?disabled=${this._saving}
                            @click=${()=>this._toggleRow(i)}>
                            ${d(e.disabled?"play":"stop")}
                          </button>
                          <button class="icon-btn" title="${s("btnCopy")}" @click=${()=>z(e.key)}>
                            ${d("copy")}
                          </button>
                          <button class="icon-btn" title="${s("btnEdit")}" @click=${()=>this._startEdit(i)}>
                            ${d("edit")}
                          </button>
                          <button class="icon-btn danger" title="${s("btnDelete")}"
                            @click=${()=>{this._confirmDelete=i}}>
                            ${d("trash")}
                          </button>
                        </span>
                      </div>
                      <div class="peer-key">${this._showKeys?e.key:f(e.key)}</div>
                      <div class="peer-stats">${this._renderStats(e.key)}</div>
                    </div>
                  `)}
                ${this._editing==="new"?this._renderEditor():c}

                ${this._editing===null?a`
                    <button class="add-row" @click=${()=>this._startAdd()}>
                      ${d("plus")} ${s("peersAdd")}
                    </button>`:c}
              </div>

              <div class="hint">${s("peersHint")}</div>
              <div class="hint">${s("peersRestartHint")}</div>
              ${this._rows.length===0?a`<div class="hint">${s("peersNoneHint")}</div>`:c}
            </div>
          `:a`<div class="section"><div class="card"><div class="empty">${s("notFound")}</div></div></div>`}

        ${this._confirmDelete!==null?a`
            <div class="dialog-overlay" @click=${()=>{this._confirmDelete=null}}>
              <div class="dialog-box" @click=${e=>e.stopPropagation()}>
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
            </div>`:c}

        ${this._snackbar?a`<div class="toast">${this._snackbar}</div>`:c}
      </app-scaffold>
    `}};r.styles=k`
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
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .peer-stats .muted {
      font-style: italic;
    }
    .peer-stats .rate {
      color: var(--text-muted);
      opacity: 0.8;
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
  `;o([_()],r.prototype,"tunnelType",2);o([_()],r.prototype,"tunnelId",2);o([p()],r.prototype,"_tunnel",2);o([p()],r.prototype,"_rows",2);o([p()],r.prototype,"_editing",2);o([p()],r.prototype,"_draft",2);o([p()],r.prototype,"_saving",2);o([p()],r.prototype,"_rowError",2);o([p()],r.prototype,"_confirmDelete",2);o([p()],r.prototype,"_showKeys",2);o([p()],r.prototype,"_snackbar",2);o([p()],r.prototype,"_pending",2);r=o([P("tunnel-peers-page")],r);export{r as TunnelPeersPage};
