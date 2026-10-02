import{a as v,G as f,c as i,s as _,g as w,B as y,A as p,b as r,i as m,t as x}from"./index-7erqeHsR.js";import{m as $,n as g,r as c}from"./format-DT_YmQ4-.js";import{i as l}from"./app-scaffold-CijyBcD_.js";import{c as k}from"./clipboard-C3x8_sid.js";import{s as P}from"./peer-stats-row-FCAC2-o3.js";import"./transport-DrpTtcx8.js";var E=Object.defineProperty,z=Object.getOwnPropertyDescriptor,a=(e,t,s,o)=>{for(var d=o>1?void 0:o?z(t,s):t,h=e.length-1,b;h>=0;h--)(b=e[h])&&(d=(o?b(t,s,d):b(d))||d);return o&&d&&E(t,s,d),d};function D(e){if(!/^[A-Za-z0-9_-]{43}$/.test(e))return!1;try{const t=e+"=".repeat((4-e.length%4)%4);return atob(t.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}function u(e){return(e?.options.peers??[]).map(t=>({key:t.key,alias:t.alias??"",disabled:t.disabled===!0}))}let n=class extends v{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._editing=null,this._draft={key:"",alias:"",disabled:!1},this._saving=!1,this._rowError="",this._confirmDelete=null,this._showKeys=!1,this._snackbar="",this._backend=new f,this._pending=[],this._unsub=null,this._toggleRow=async e=>{const t=this._rows.map((s,o)=>o===e?{...s,disabled:!s.disabled}:s);await this._save(t)},this._addPending=async e=>{await this._save([...this._rows,{key:e,alias:"",disabled:!1}])&&(this._pending=this._pending.filter(t=>t.key!==e))},this._dismissPending=async e=>{try{await this._backend.dismissPendingPeer(e),this._pending=this._pending.filter(t=>t.key!==e)}catch(t){const s=t instanceof Error?t.message:"";this._showSnackbar(`${i("saveFailed")}${s?": "+s:""}`)}},this._saveRow=async()=>{const e={key:this._draft.key.trim(),alias:this._draft.alias.trim(),disabled:this._draft.disabled===!0};if(!D(e.key)){this._rowError=i("peersKeyInvalid");return}if(this._rows.filter((o,d)=>d!==this._editing).some(o=>o.key===e.key)){this._rowError=i("peersKeyDuplicate");return}const s=this._editing==="new"?[...this._rows,e]:this._rows.map((o,d)=>d===this._editing?e:o);await this._save(s)&&(this._editing=null,this._rowError="")},this._deleteRow=async e=>{this._confirmDelete=null,await this._save(this._rows.filter((t,s)=>s!==e))}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=_(()=>this._load())}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const e=w().find(t=>t.id===this.tunnelId)??null;this._tunnel=e,this._rows=u(e),this._loadPending()}async _loadPending(){try{this._pending=(await this._backend.listPendingPeers()).peers??[]}catch{}}_startEdit(e){this._editing=e,this._draft={...this._rows[e]},this._rowError=""}_startAdd(){this._editing="new",this._draft={key:"",alias:"",disabled:!1},this._rowError=""}_cancelEdit(){this._editing=null,this._rowError=""}_ago(e){const t=Math.max(0,(Date.now()-Date.parse(e))/1e3);return t<60?i("peersPendingJustNow"):i("peersPendingMinutes",{n:Math.floor(t/60)})}async _save(e){if(this._saving)return!1;this._saving=!0;try{const t=await y(this.tunnelId,e.map(s=>({key:s.key,alias:s.alias||void 0,disabled:s.disabled||void 0})));return this._tunnel=t,this._rows=u(t),this._showSnackbar(i("saved")),!0}catch(t){const s=P(t);return this._editing!==null?this._rowError=s:this._showSnackbar(s),!1}finally{this._saving=!1}}_showSnackbar(e){this._snackbar=e,setTimeout(()=>{this._snackbar=""},2500)}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}_statFor(e){return(this._tunnel?.peer_stats??[]).find(t=>t.key===e)}_renderEditor(){return r`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${i("peersAliasPlaceholder")}
            @input=${e=>{this._draft={...this._draft,alias:e.target.value}}}>
          <button class="icon-btn" title="${i("btnCancel")}" @click=${()=>this._cancelEdit()}>
            ${l("close")}
          </button>
          <button class="icon-btn accent" title="${i("btnSave")}" ?disabled=${this._saving}
            @click=${this._saveRow}>
            ${l("check")}
          </button>
        </div>
        <input class="form-input key ${this._rowError?"invalid":""}" .value=${this._draft.key}
          placeholder=${i("peersKeyPlaceholder")}
          @input=${e=>{this._draft={...this._draft,key:e.target.value},this._rowError=""}}>
        ${this._rowError?r`<div class="row-error">${this._rowError}</div>`:p}
      </div>
    `}render(){const e=this._tunnel;return r`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${l("chevron-left")}
          </button>
          <span class="page-title">${i("peersTitle")}</span>
          <button class="pill-btn appbar-action" title="${this._showKeys?i("hideKey"):i("revealKey")}"
            @click=${()=>{this._showKeys=!this._showKeys}}>
            ${l(this._showKeys?"eye-off":"eye")}
          </button>
        </div>

        ${e?r`
            ${this._pending.length>0?r`
                <div class="section">
                  <div class="card">
                    <div class="pending-head">
                      ${i("peersPendingTitle")} (${this._pending.length})
                    </div>
                    ${this._pending.map(t=>r`
                      <div class="peer-row">
                        <div class="row-line">
                          <span class="peer-key">${this._showKeys?t.key:$(t.key)}</span>
                          <span class="peer-age">
                            ${i("peersPendingAttempts",{n:t.attempts})} · ${this._ago(t.last_seen)}
                          </span>
                          <span class="row-actions">
                            <button class="icon-btn accent" title="${i("peersPendingAdd")}"
                              ?disabled=${this._saving}
                              @click=${()=>this._addPending(t.key)}>
                              ${l("plus")}
                            </button>
                            <button class="icon-btn" title="${i("peersPendingDismiss")}"
                              @click=${()=>this._dismissPending(t.key)}>
                              ${l("close")}
                            </button>
                          </span>
                        </div>
                      </div>
                    `)}
                    <div class="hint">${i("peersPendingHint")}</div>
                  </div>
                </div>
              `:p}
            <div class="section">
              <div class="card">
                ${this._rows.length===0&&this._editing!=="new"?r`<div class="empty">${i("peersEmpty")}</div>`:p}
                ${this._rows.map((t,s)=>this._editing===s?this._renderEditor():r`
                    <peer-stats-row
                      .peer=${t}
                      .stat=${this._statFor(t.key)??null}
                      ?disabled=${t.disabled}
                      ?showKeys=${this._showKeys}
                      .rowActions=${r`
                        <span class="row-actions">
                          <button class="icon-btn" title="${t.disabled?i("peersEnable"):i("peersDisable")}"
                            ?disabled=${this._saving}
                            @click=${()=>this._toggleRow(s)}>
                            ${l(t.disabled?"play":"stop")}
                          </button>
                          <button class="icon-btn" title="${i("btnCopy")}" @click=${()=>k(t.key)}>
                            ${l("copy")}
                          </button>
                          <button class="icon-btn" title="${i("btnEdit")}" @click=${()=>this._startEdit(s)}>
                            ${l("edit")}
                          </button>
                          <button class="icon-btn danger" title="${i("btnDelete")}"
                            @click=${()=>{this._confirmDelete=s}}>
                            ${l("trash")}
                          </button>
                        </span>
                      `}></peer-stats-row>
                  `)}
                ${this._editing==="new"?this._renderEditor():p}

                ${this._editing===null?r`
                    <button class="add-row" @click=${()=>this._startAdd()}>
                      ${l("plus")} ${i("peersAdd")}
                    </button>`:p}
              </div>

              <div class="hint">${i("peersHint")}</div>
              <div class="hint">${i("peersRestartHint")}</div>
              ${this._rows.length===0?r`<div class="hint">${i("peersNoneHint")}</div>`:p}
            </div>
          `:r`<div class="section"><div class="card"><div class="empty">${i("notFound")}</div></div></div>`}

        ${this._confirmDelete!==null?r`
            <div class="dialog-overlay" @click=${()=>{this._confirmDelete=null}}>
              <div class="dialog-box" @click=${t=>t.stopPropagation()}>
                <div class="dialog-title">${i("deleteConfirmTitle")}</div>
                <div class="dialog-message">${i("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._confirmDelete=null}}>
                    ${i("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" ?disabled=${this._saving}
                    @click=${()=>this._deleteRow(this._confirmDelete)}>
                    ${i("btnDelete")}
                  </button>
                </div>
              </div>
            </div>`:p}

        ${this._snackbar?r`<div class="toast">${this._snackbar}</div>`:p}
      </app-scaffold>
    `}};n.styles=m`
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
  `;a([g()],n.prototype,"tunnelType",2);a([g()],n.prototype,"tunnelId",2);a([c()],n.prototype,"_tunnel",2);a([c()],n.prototype,"_rows",2);a([c()],n.prototype,"_editing",2);a([c()],n.prototype,"_draft",2);a([c()],n.prototype,"_saving",2);a([c()],n.prototype,"_rowError",2);a([c()],n.prototype,"_confirmDelete",2);a([c()],n.prototype,"_showKeys",2);a([c()],n.prototype,"_snackbar",2);a([c()],n.prototype,"_pending",2);n=a([x("tunnel-peers-page")],n);export{n as TunnelPeersPage};
