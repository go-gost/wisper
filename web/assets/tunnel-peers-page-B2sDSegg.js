import{a as y,j as r,s as x,g as f,B as m,b as a,A as p,i as w,t as $}from"./index-CrMDH7WK.js";import{c as k,a as v,b,m as E,n as g,r as d}from"./format-BStqaCbO.js";import{i as c}from"./app-scaffold-B_jlWuvT.js";import{c as z}from"./clipboard-C3x8_sid.js";var K=Object.defineProperty,C=Object.getOwnPropertyDescriptor,o=(t,e,i,n)=>{for(var l=n>1?void 0:n?C(e,i):e,u=t.length-1,h;u>=0;u--)(h=t[u])&&(l=(n?h(e,i,l):h(l))||l);return n&&l&&K(e,i,l),l};function D(t){if(!/^[A-Za-z0-9_-]{43}$/.test(t))return!1;try{const e=t+"=".repeat((4-t.length%4)%4);return atob(e.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function _(t){return(t?.options.peers??[]).map(e=>({key:e.key,alias:e.alias??""}))}let s=class extends y{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:""},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._snackbar="",this._unsub=null,this._saveRow=async()=>{const t={key:this._draft.key.trim(),alias:this._draft.alias.trim()};if(!D(t.key)){this._rowError=r("peersKeyInvalid");return}if(this._rows.filter((n,l)=>l!==this._editing).some(n=>n.key===t.key)){this._rowError=r("peersKeyDuplicate");return}const i=this._editing==="new"?[...this._rows,t]:this._rows.map((n,l)=>l===this._editing?t:n);await this._save(i)&&(this._editing=null,this._rowError="")},this._deleteRow=async t=>{this._confirmDelete=null,await this._save(this._rows.filter((e,i)=>i!==t))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=x(()=>{const t=f().find(e=>e.id===this.tunnelId);t&&(this._tunnel=t)})}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const t=f().find(e=>e.id===this.tunnelId)??null;this._tunnel=t,this._rows=_(t)}_startEdit(t){this._editing=t,this._draft={...this._rows[t]},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:""},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}async _save(t){if(this._saving)return!1;this._saving=!0;try{const e=await m(this.tunnelId,t.map(i=>({key:i.key,alias:i.alias||void 0})));return this._tunnel=e,this._rows=_(e),this._showSnackbar(r("saved")),!0}catch(e){const i=e instanceof Error?e.message:"",n=`${r("saveFailed")}${i?": "+i:""}`;return this._editing!==null?this._rowError=n:this._showSnackbar(n),!1}finally{this._saving=!1}}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar=""},2500)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(t){return(this._tunnel?.peer_stats??[]).find(e=>e.key===t)}_renderStats(t){const e=this._statFor(t);return e?a`
      <span>${k(e.current_conns)} ${r("p2pColConns")}</span>
      <span>↓ ${v(e.output_bytes)} <span class="rate">${b(e.output_rate_bytes)}</span></span>
      <span>↑ ${v(e.input_bytes)} <span class="rate">${b(e.input_rate_bytes)}</span></span>
    `:a`<span class="muted">${r("peersNoTraffic")}</span>`}_renderEditor(){return a`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${r("peersAliasPlaceholder")}
            @input=${t=>{this._draft={...this._draft,alias:t.target.value}}}>
          <button class="icon-btn" title="${r("btnCancel")}" @click=${()=>this._cancelEdit()}>
            ${c("close")}
          </button>
          <button class="icon-btn accent" title="${r("btnSave")}" ?disabled=${this._saving}
            @click=${this._saveRow}>
            ${c("check")}
          </button>
        </div>
        <input class="form-input key ${this._rowError?"invalid":""}" .value=${this._draft.key}
          placeholder=${r("peersKeyPlaceholder")}
          @input=${t=>{this._draft={...this._draft,key:t.target.value},this._rowError=""}}>
        ${this._rowError?a`<div class="row-error">${this._rowError}</div>`:p}
      </div>
    `}render(){const t=this._tunnel;return a`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${c("chevron-left")}
          </button>
          <span class="page-title">${r("peersTitle")}</span>
          <button class="pill-btn appbar-action" title="${this._showKeys?r("hideKey"):r("revealKey")}"
            @click=${()=>{this._showKeys=!this._showKeys}}>
            ${c(this._showKeys?"eye-off":"eye")}
          </button>
        </div>

        ${t?a`
            <div class="section">
              <div class="card">
                ${this._rows.length===0&&this._editing!=="new"?a`<div class="empty">${r("peersEmpty")}</div>`:p}
                ${this._rows.map((e,i)=>this._editing===i?this._renderEditor():a`
                    <div class="peer-row">
                      <div class="row-line">
                        <span class="peer-alias">${e.alias||r("peersNoAlias")}</span>
                        <span class="row-actions">
                          <button class="icon-btn" title="${r("btnCopy")}" @click=${()=>z(e.key)}>
                            ${c("copy")}
                          </button>
                          <button class="icon-btn" title="${r("btnEdit")}" @click=${()=>this._startEdit(i)}>
                            ${c("edit")}
                          </button>
                          <button class="icon-btn danger" title="${r("btnDelete")}"
                            @click=${()=>{this._confirmDelete=i}}>
                            ${c("trash")}
                          </button>
                        </span>
                      </div>
                      <div class="peer-key">${this._showKeys?e.key:E(e.key)}</div>
                      <div class="peer-stats">${this._renderStats(e.key)}</div>
                    </div>
                  `)}
                ${this._editing==="new"?this._renderEditor():p}

                ${this._editing===null?a`
                    <button class="add-row" @click=${()=>this._startAdd()}>
                      ${c("plus")} ${r("peersAdd")}
                    </button>`:p}
              </div>

              <div class="hint">${r("peersHint")}</div>
              <div class="hint">${r("peersRestartHint")}</div>
              ${this._rows.length===0?a`<div class="hint">${r("peersNoneHint")}</div>`:p}
            </div>
          `:a`<div class="section"><div class="card"><div class="empty">${r("notFound")}</div></div></div>`}

        ${this._confirmDelete!==null?a`
            <div class="dialog-overlay" @click=${()=>{this._confirmDelete=null}}>
              <div class="dialog-box" @click=${e=>e.stopPropagation()}>
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
            </div>`:p}

        ${this._snackbar?a`<div class="toast">${this._snackbar}</div>`:p}
      </app-scaffold>
    `}};s.styles=w`
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
  `;o([g()],s.prototype,"tunnelType",2);o([g()],s.prototype,"tunnelId",2);o([d()],s.prototype,"_tunnel",2);o([d()],s.prototype,"_rows",2);o([d()],s.prototype,"_editing",2);o([d()],s.prototype,"_draft",2);o([d()],s.prototype,"_saving",2);o([d()],s.prototype,"_rowError",2);o([d()],s.prototype,"_confirmDelete",2);o([d()],s.prototype,"_showKeys",2);o([d()],s.prototype,"_snackbar",2);s=o([$("tunnel-peers-page")],s);export{s as TunnelPeersPage};
