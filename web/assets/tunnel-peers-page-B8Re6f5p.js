import{a as x,j as r,s as y,g as f,B as m,b as i,A as c,i as w,t as $}from"./index-25_IJhrY.js";import{c as k,a as b,b as v,m as E,n as _,r as p}from"./format-CpnZ499G.js";import{i as d}from"./app-scaffold-BlDKkfYv.js";import{c as z}from"./clipboard-C3x8_sid.js";import{a as K}from"./transport-B5KjKhDX.js";var C=Object.defineProperty,D=Object.getOwnPropertyDescriptor,o=(e,t,s,n)=>{for(var l=n>1?void 0:n?D(t,s):t,u=e.length-1,h;u>=0;u--)(h=e[u])&&(l=(n?h(t,s,l):h(l))||l);return n&&l&&C(t,s,l),l};function P(e){if(!/^[A-Za-z0-9_-]{43}$/.test(e))return!1;try{const t=e+"=".repeat((4-e.length%4)%4);return atob(t.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function g(e){return(e?.options.peers??[]).map(t=>({key:t.key,alias:t.alias??""}))}let a=class extends x{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:""},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._snackbar="",this._unsub=null,this._saveRow=async()=>{const e={key:this._draft.key.trim(),alias:this._draft.alias.trim()};if(!P(e.key)){this._rowError=r("peersKeyInvalid");return}if(this._rows.filter((n,l)=>l!==this._editing).some(n=>n.key===e.key)){this._rowError=r("peersKeyDuplicate");return}const s=this._editing==="new"?[...this._rows,e]:this._rows.map((n,l)=>l===this._editing?e:n);await this._save(s)&&(this._editing=null,this._rowError="")},this._deleteRow=async e=>{this._confirmDelete=null,await this._save(this._rows.filter((t,s)=>s!==e))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=y(()=>{const e=f().find(t=>t.id===this.tunnelId);e&&(this._tunnel=e)})}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const e=f().find(t=>t.id===this.tunnelId)??null;this._tunnel=e,this._rows=g(e)}_startEdit(e){this._editing=e,this._draft={...this._rows[e]},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:""},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}async _save(e){if(this._saving)return!1;this._saving=!0;try{const t=await m(this.tunnelId,e.map(s=>({key:s.key,alias:s.alias||void 0})));return this._tunnel=t,this._rows=g(t),this._showSnackbar(r("saved")),!0}catch(t){const s=t instanceof Error?t.message:"",n=`${r("saveFailed")}${s?": "+s:""}`;return this._editing!==null?this._rowError=n:this._showSnackbar(n),!1}finally{this._saving=!1}}_showSnackbar(e){this._snackbar=e,setTimeout(()=>{this._snackbar=""},2500)}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(e){return(this._tunnel?.peer_stats??[]).find(t=>t.key===e)}_renderStats(e){const t=this._statFor(e);return t?i`
      <span>${k(t.current_conns)} ${r("p2pColConns")}</span>
      <span>↓ ${b(t.output_bytes)} <span class="rate">${v(t.output_rate_bytes)}</span></span>
      <span>↑ ${b(t.input_bytes)} <span class="rate">${v(t.input_rate_bytes)}</span></span>
    `:i`<span class="muted">${r("peersNoTraffic")}</span>`}_renderTransport(e){const t=K(this._statFor(e)?.transport);return t?i`<span class="peer-badge ${t.tone}" title=${t.hint}>
      ${d(t.icon)}<span>${t.label}</span>
    </span>`:c}_renderEditor(){return i`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${r("peersAliasPlaceholder")}
            @input=${e=>{this._draft={...this._draft,alias:e.target.value}}}>
          <button class="icon-btn" title="${r("btnCancel")}" @click=${()=>this._cancelEdit()}>
            ${d("close")}
          </button>
          <button class="icon-btn accent" title="${r("btnSave")}" ?disabled=${this._saving}
            @click=${this._saveRow}>
            ${d("check")}
          </button>
        </div>
        <input class="form-input key ${this._rowError?"invalid":""}" .value=${this._draft.key}
          placeholder=${r("peersKeyPlaceholder")}
          @input=${e=>{this._draft={...this._draft,key:e.target.value},this._rowError=""}}>
        ${this._rowError?i`<div class="row-error">${this._rowError}</div>`:c}
      </div>
    `}render(){const e=this._tunnel;return i`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${d("chevron-left")}
          </button>
          <span class="page-title">${r("peersTitle")}</span>
          <button class="pill-btn appbar-action" title="${this._showKeys?r("hideKey"):r("revealKey")}"
            @click=${()=>{this._showKeys=!this._showKeys}}>
            ${d(this._showKeys?"eye-off":"eye")}
          </button>
        </div>

        ${e?i`
            <div class="section">
              <div class="card">
                ${this._rows.length===0&&this._editing!=="new"?i`<div class="empty">${r("peersEmpty")}</div>`:c}
                ${this._rows.map((t,s)=>this._editing===s?this._renderEditor():i`
                    <div class="peer-row">
                      <div class="row-line">
                        <span class="peer-alias">${t.alias||r("peersNoAlias")}</span>
                        ${this._renderTransport(t.key)}
                        <span class="row-actions">
                          <button class="icon-btn" title="${r("btnCopy")}" @click=${()=>z(t.key)}>
                            ${d("copy")}
                          </button>
                          <button class="icon-btn" title="${r("btnEdit")}" @click=${()=>this._startEdit(s)}>
                            ${d("edit")}
                          </button>
                          <button class="icon-btn danger" title="${r("btnDelete")}"
                            @click=${()=>{this._confirmDelete=s}}>
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
                      ${d("plus")} ${r("peersAdd")}
                    </button>`:c}
              </div>

              <div class="hint">${r("peersHint")}</div>
              <div class="hint">${r("peersRestartHint")}</div>
              ${this._rows.length===0?i`<div class="hint">${r("peersNoneHint")}</div>`:c}
            </div>
          `:i`<div class="section"><div class="card"><div class="empty">${r("notFound")}</div></div></div>`}

        ${this._confirmDelete!==null?i`
            <div class="dialog-overlay" @click=${()=>{this._confirmDelete=null}}>
              <div class="dialog-box" @click=${t=>t.stopPropagation()}>
                <div class="dialog-title">${r("deleteConfirmTitle")}</div>
                <div class="dialog-message">${r("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._confirmDelete=null}}>
                    ${r("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" ?disabled=${this._saving}
                    @click=${()=>this._deleteRow(this._confirmDelete)}>
                    ${r("btnDelete")}
                  </button>
                </div>
              </div>
            </div>`:c}

        ${this._snackbar?i`<div class="toast">${this._snackbar}</div>`:c}
      </app-scaffold>
    `}};a.styles=w`
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
      font-size: var(--font-xs);
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
  `;o([_()],a.prototype,"tunnelType",2);o([_()],a.prototype,"tunnelId",2);o([p()],a.prototype,"_tunnel",2);o([p()],a.prototype,"_rows",2);o([p()],a.prototype,"_editing",2);o([p()],a.prototype,"_draft",2);o([p()],a.prototype,"_saving",2);o([p()],a.prototype,"_rowError",2);o([p()],a.prototype,"_confirmDelete",2);o([p()],a.prototype,"_showKeys",2);o([p()],a.prototype,"_snackbar",2);a=o([$("tunnel-peers-page")],a);export{a as TunnelPeersPage};
