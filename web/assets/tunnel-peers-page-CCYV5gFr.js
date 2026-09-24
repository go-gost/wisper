import{a as _,j as s,s as y,g as x,B as m,b as i,A as c,i as w,t as $}from"./index-BIk6eYxn.js";import{c as k,a as h,b as f,m as E,n as g,r as p}from"./format-CKevMQ8D.js";import{i as d}from"./app-scaffold-D4Cg2NeJ.js";import{c as z}from"./clipboard-C3x8_sid.js";import{a as D}from"./transport-tVXFPIke.js";var K=Object.defineProperty,C=Object.getOwnPropertyDescriptor,o=(e,t,r,a)=>{for(var l=a>1?void 0:a?C(t,r):t,u=e.length-1,b;u>=0;u--)(b=e[u])&&(l=(a?b(t,r,l):b(l))||l);return a&&l&&K(t,r,l),l};function P(e){if(!/^[A-Za-z0-9_-]{43}$/.test(e))return!1;try{const t=e+"=".repeat((4-e.length%4)%4);return atob(t.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function v(e){return(e?.options.peers??[]).map(t=>({key:t.key,alias:t.alias??"",disabled:t.disabled===!0}))}let n=class extends _{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:"",disabled:!1},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._snackbar="",this._unsub=null,this._toggleRow=async e=>{const t=this._rows.map((r,a)=>a===e?{...r,disabled:!r.disabled}:r);await this._save(t)},this._saveRow=async()=>{const e={key:this._draft.key.trim(),alias:this._draft.alias.trim(),disabled:this._draft.disabled===!0};if(!P(e.key)){this._rowError=s("peersKeyInvalid");return}if(this._rows.filter((a,l)=>l!==this._editing).some(a=>a.key===e.key)){this._rowError=s("peersKeyDuplicate");return}const r=this._editing==="new"?[...this._rows,e]:this._rows.map((a,l)=>l===this._editing?e:a);await this._save(r)&&(this._editing=null,this._rowError="")},this._deleteRow=async e=>{this._confirmDelete=null,await this._save(this._rows.filter((t,r)=>r!==e))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=y(()=>this._load())}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const e=x().find(t=>t.id===this.tunnelId)??null;this._tunnel=e,this._rows=v(e)}_startEdit(e){this._editing=e,this._draft={...this._rows[e]},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:"",disabled:!1},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}async _save(e){if(this._saving)return!1;this._saving=!0;try{const t=await m(this.tunnelId,e.map(r=>({key:r.key,alias:r.alias||void 0,disabled:r.disabled||void 0})));return this._tunnel=t,this._rows=v(t),this._showSnackbar(s("saved")),!0}catch(t){const r=t instanceof Error?t.message:"",a=`${s("saveFailed")}${r?": "+r:""}`;return this._editing!==null?this._rowError=a:this._showSnackbar(a),!1}finally{this._saving=!1}}_showSnackbar(e){this._snackbar=e,setTimeout(()=>{this._snackbar=""},2500)}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(e){return(this._tunnel?.peer_stats??[]).find(t=>t.key===e)}_renderStats(e){const t=this._statFor(e);return t?i`
      <span>${k(t.current_conns)} ${s("p2pColConns")}</span>
      <span>↓ ${h(t.output_bytes)} <span class="rate">${f(t.output_rate_bytes)}</span></span>
      <span>↑ ${h(t.input_bytes)} <span class="rate">${f(t.input_rate_bytes)}</span></span>
    `:i`<span class="muted">${s("peersNoTraffic")}</span>`}_renderTransport(e){const t=D(this._statFor(e)?.transport);return t?i`<span class="peer-badge ${t.tone}" title=${t.hint}>
      ${d(t.icon)}<span>${t.label}</span>
    </span>`:c}_renderEditor(){return i`
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
        ${this._rowError?i`<div class="row-error">${this._rowError}</div>`:c}
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
            <div class="section">
              <div class="card">
                ${this._rows.length===0&&this._editing!=="new"?i`<div class="empty">${s("peersEmpty")}</div>`:c}
                ${this._rows.map((t,r)=>this._editing===r?this._renderEditor():i`
                    <div class="peer-row ${t.disabled?"off":""}">
                      <div class="row-line">
                        <span class="peer-alias">${t.alias||s("peersNoAlias")}</span>
                        ${t.disabled?i`<span class="peer-badge" title=${s("peersDisabledHint")}>${s("peersDisabled")}</span>`:this._renderTransport(t.key)}
                        <span class="row-actions">
                          <button class="icon-btn" title="${t.disabled?s("peersEnable"):s("peersDisable")}"
                            ?disabled=${this._saving}
                            @click=${()=>this._toggleRow(r)}>
                            ${d(t.disabled?"play":"stop")}
                          </button>
                          <button class="icon-btn" title="${s("btnCopy")}" @click=${()=>z(t.key)}>
                            ${d("copy")}
                          </button>
                          <button class="icon-btn" title="${s("btnEdit")}" @click=${()=>this._startEdit(r)}>
                            ${d("edit")}
                          </button>
                          <button class="icon-btn danger" title="${s("btnDelete")}"
                            @click=${()=>{this._confirmDelete=r}}>
                            ${d("trash")}
                          </button>
                        </span>
                      </div>
                      <div class="peer-key">${this._showKeys?t.key:E(t.key)}</div>
                      <div class="peer-stats">${this._renderStats(t.key)}</div>
                    </div>
                  `)}
                ${this._editing==="new"?this._renderEditor():c}

                ${this._editing===null?i`
                    <button class="add-row" @click=${()=>this._startAdd()}>
                      ${d("plus")} ${s("peersAdd")}
                    </button>`:c}
              </div>

              <div class="hint">${s("peersHint")}</div>
              <div class="hint">${s("peersRestartHint")}</div>
              ${this._rows.length===0?i`<div class="hint">${s("peersNoneHint")}</div>`:c}
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
            </div>`:c}

        ${this._snackbar?i`<div class="toast">${this._snackbar}</div>`:c}
      </app-scaffold>
    `}};n.styles=w`
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
  `;o([g()],n.prototype,"tunnelType",2);o([g()],n.prototype,"tunnelId",2);o([p()],n.prototype,"_tunnel",2);o([p()],n.prototype,"_rows",2);o([p()],n.prototype,"_editing",2);o([p()],n.prototype,"_draft",2);o([p()],n.prototype,"_saving",2);o([p()],n.prototype,"_rowError",2);o([p()],n.prototype,"_confirmDelete",2);o([p()],n.prototype,"_showKeys",2);o([p()],n.prototype,"_snackbar",2);n=o([$("tunnel-peers-page")],n);export{n as TunnelPeersPage};
