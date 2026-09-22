const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-DlxCGyZp.js","assets/index-nwYGvLm_.css"])))=>i.map(i=>d[i]);
import{a as m,f as y,c as _,j as e,_ as v,v as x,w as $,l as w,n as k,x as S,u as D,b as i,i as z,t as E}from"./index-DlxCGyZp.js";import{d as C,e as I,c as h,a as u,b as f,n as g,r as p}from"./format-B7il8fZf.js";import{i as d}from"./app-scaffold-BTGpmsrN.js";import{c as T}from"./clipboard-C3x8_sid.js";var R=Object.defineProperty,P=Object.getOwnPropertyDescriptor,o=(t,a,r,l)=>{for(var s=l>1?void 0:l?P(a,r):a,c=t.length-1,b;c>=0;c--)(b=t[c])&&(s=(l?b(a,r,s):b(s))||s);return l&&s&&R(a,r,s),s};let n=class extends m{constructor(){super(...arguments),this.entrypointType="tcp",this.entrypointId="",this.mode="view",this._entrypoint=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._tunnelId="",this._peer="",this._showPeer=!1,this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(y(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.entrypointId,a=window.location.search.includes("edit");if(t==="new"||!t){if(this.mode==="create")return;this.mode="create",this._entrypoint=null,this._resetForm();return}if(this.mode==="edit"&&this._entrypoint?.id===t)return;const r=_().find(l=>l.id===t);r&&(this._entrypoint=r,a?(this.mode="edit",this._populateForm(r)):(this.mode!=="edit"||this._entrypoint?.id!==t)&&(this.mode="view",this._populateForm(r)))}_resetForm(){this._name="",this._endpoint="",this._tunnelId="",this._peer=""}_populateForm(t){this._name=t.name,this._endpoint=t.entrypoint,this._tunnelId=t.id??"",this._peer=t.options?.peer??""}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._entrypoint&&(this._populateForm(this._entrypoint),this.mode="edit")}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(e("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.entrypointType,endpoint:this._endpoint.trim(),id:this._tunnelId.trim()||void 0,peer:this._peer.trim()||void 0};this.mode==="create"?(await v(()=>import("./index-DlxCGyZp.js").then(a=>a.F),__vite__mapDeps([0,1])).then(a=>a.create(t)),this._showSnackbar(e("saved")),this._navigate("/")):(await v(()=>import("./index-DlxCGyZp.js").then(a=>a.F),__vite__mapDeps([0,1])).then(a=>a.update(this.entrypointId,t)),this._showSnackbar(e("saved")),this.mode="view",await x())}catch(t){const a=t instanceof Error?t.message:"";this._showSnackbar(`${e("saveFailed")}${a?": "+a:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await $(this.entrypointId),this._showSnackbar(e("deleted")),this._navigate("/")}catch{this._showSnackbar(e("deleteFailed"))}}async _handleStart(){try{await w(this.entrypointId),this._showSnackbar(e("started"))}catch{this._showSnackbar(e("startFailed"))}}async _handleStop(){try{await k(this.entrypointId),this._showSnackbar(e("stopped"))}catch{this._showSnackbar(e("stopFailed"))}}async _handleCopy(t){await T(t),this._showSnackbar(e("copiedToClipboard"))}_handleResetStats(t){this._resetKind=t,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await S(this.entrypointId,this._resetKind),this._entrypoint&&D(this.entrypointId,this._entrypoint.stats),this._showSnackbar(e("saved"))}catch{this._showSnackbar(e("saveFailed"))}}_typeLabel(){return this.entrypointType.toUpperCase()}render(){const t=this._entrypoint,a=t?t.stats:null,r=this._typeLabel(),l=t?.options?.peer??"";return i`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${d("chevron-left")}
          </button>
          <span class="page-title">
            ${this.mode==="create"?`${e("entrypointNewTitle")} — ${r}`:r+" Entrypoint"}
          </span>

          ${this.mode==="view"&&t?i`
              ${t.status==="running"?i`<button class="pill-btn danger appbar-action" @click=${()=>this._handleStop()}>
                  ■ ${e("btnStop")}
                </button>`:i`<button class="pill-btn primary appbar-action" @click=${()=>this._handleStart()}>
                  ▶ ${e("btnStart")}
                </button>`}
            `:i`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${()=>this._handleSave()}>
                ${d("check")} ${e("btnSave")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&t?i`
            <div class="status-banner ${t.status}">
              <span class="status-dot-mini"></span>
              ${t.status==="running"?e("statusRunning"):t.status==="error"?e("statusError"):e("statusStopped")}
              ${t.error?i` — ${t.error}`:""}
              <span class="status-spacer"></span>
            </div>

            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${r} Entrypoint</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Created</span>
                  <span class="info-value text">${C(t.created_at)}</span>
                </div>
                ${this.entrypointType==="p2p"?"":i`
                <div class="info-row">
                  <span class="info-label">Tunnel ID</span>
                  <span class="info-value uuid">${t.id??"—"}</span>
                  ${t.id?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(t.id)}>
                      ${d("copy")}
                    </button>`:""}
                </div>`}
                <div class="info-row">
                  <span class="info-label">Name</span>
                  <span class="info-value text">${t.name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Bind Address</span>
                  <span class="info-value">${t.entrypoint}</span>
                </div>
                ${this.entrypointType==="p2p"?i`
                    <div class="info-row">
                      <span class="info-label">${e("entrypointPeerKey")}</span>
                      <span class="info-value">${this._showPeer?l:I(l)}</span>
                      ${l?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(l)}>
                          ${d("copy")}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer?e("hideKey"):e("revealKey")}"
                          @click=${()=>{this._showPeer=!this._showPeer}}>
                          ${d(this._showPeer?"eye-off":"eye")}
                        </button>`:""}
                    </div>
                    <div class="p2p-hint">${e("p2pEntryHint")}</div>
                  `:""}
              </div>

              <!-- Stats grid -->
              ${a?i`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${()=>this._handleResetStats("conns")} title="${e("btnResetStats")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${h(a.total_conns)}</div>
                      <div class="stat-rate">${h(a.current_conns)} active · ${a.request_rate.toFixed(1)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${()=>this._handleResetStats("errors")} title="${e("btnResetStats")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${h(a.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${()=>this._handleResetStats("output")} title="${e("btnResetOutput")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${u(a.output_bytes)}</div>
                      <div class="stat-rate">${f(a.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${()=>this._handleResetStats("input")} title="${e("btnResetInput")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${u(a.input_bytes)}</div>
                      <div class="stat-rate">${f(a.input_rate_bytes)}</div>
                    </div>
                  </div>
                `:""}
            </div>

            <div class="section">
              <button class="btn-edit-bottom" @click=${()=>this._enterEdit()}>
                ${d("edit")} ${e("btnEdit")}
              </button>
            </div>
          `:""}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode!=="view"?i`
            <div class="section">
              <div class="card" style="padding:16px;">
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <input class="form-input" readonly .value=${r+" Entrypoint"}>
                </div>

                <!-- A p2p entrypoint dials the peer directly: no tunnel id. -->
                ${this.entrypointType==="p2p"?"":i`
                <div class="form-group">
                  <label class="form-label">Tunnel ID</label>
                  <input class="form-input"
                    ?readonly=${this.mode==="edit"}
                    .value=${this._tunnelId}
                    placeholder="Paste tunnel UUID"
                    @input=${s=>{this._tunnelId=s.target.value}}>
                </div>`}

                <div class="form-group">
                  <label class="form-label">${e("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Entrypoint"
                    @input=${s=>{this._name=s.target.value}}>
                </div>

                <div class="form-group">
                  <label class="form-label">${e("fieldBindAddress")}</label>
                  <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                    @input=${s=>{this._endpoint=s.target.value}}>
                </div>

                ${this.entrypointType==="p2p"?i`
                    <div class="form-group">
                      <label class="form-label">${e("entrypointPeerKey")}</label>
                      <input class="form-input" .value=${this._peer} placeholder="Base64 public key"
                        @input=${s=>{this._peer=s.target.value}}>
                    </div>
                  `:""}

                ${this.mode==="edit"?i`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${d("trash")} ${e("btnDelete")}
                      </button>
                    </div>
                  `:""}
              </div>
            </div>
          `:""}

        ${this._snackbar?i`<div class="toast">${this._snackbar}</div>`:""}

        ${this._showResetDialog?i`
            <div class="dialog-overlay" @click=${()=>{this._showResetDialog=!1}}>
              <div class="dialog-box" @click=${s=>s.stopPropagation()}>
                <div class="dialog-title">${e("resetStatsConfirmTitle")}</div>
                <div class="dialog-message">${e("resetStatsConfirm")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showResetDialog=!1}}>
                    ${e("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${()=>this._doResetStats()}>
                    ${e("btnResetStats")}
                  </button>
                </div>
              </div>
            </div>
          `:""}

        ${this._showDeleteDialog?i`
            <div class="dialog-overlay" @click=${()=>{this._showDeleteDialog=!1}}>
              <div class="dialog-box" @click=${s=>s.stopPropagation()}>
                <div class="dialog-title">${e("deleteConfirmTitle")}</div>
                <div class="dialog-message">${e("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showDeleteDialog=!1}}>
                    ${e("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${()=>this._handleDelete()}>
                    ${e("btnDelete")}
                  </button>
                </div>
              </div>
            </div>
          `:""}
      </app-scaffold>
    `}};n.styles=z`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }

    .appbar-btn {
      background: none; border: none; cursor: pointer;
      padding: 4px 8px; border-radius: var(--radius-sm);
      color: var(--text-secondary); font-size: var(--font-sm);
      display: flex; align-items: center; gap: 3px;
      font-family: inherit;
      transition: background var(--transition-fast);
    }
    .appbar-btn:hover { background: var(--border-subtle); }

    .pill-btn {
      padding: 5px 14px; border-radius: var(--radius-pill);
      border: none; cursor: pointer;
      font-size: var(--font-sm); font-weight: 500; font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pill-btn.primary { background: var(--accent); color: var(--accent-fg); }
    .pill-btn.danger { background: var(--red); color: #fff; }
    .pill-btn svg { width: 14px; height: 14px; }
    .pill-btn:hover { opacity: 0.85; }
    .pill-btn.appbar-action { margin-left: auto; }

    .section { padding: 16px; }

    .status-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; margin: 0 16px;
      border-radius: var(--radius-md); font-size: var(--font-sm); font-weight: 500;
    }
    .status-banner.running {
      background: var(--green-bg); color: var(--green-text);
      border: 1px solid var(--green-border);
    }
    .status-banner.stopped {
      background: var(--border-subtle); color: var(--text-muted);
    }
    .status-banner.error {
      background: var(--red-bg); color: var(--red-text);
      border: 1px solid var(--red-border);
    }

    .status-dot-mini {
      width: 6px; height: 6px; border-radius: 50%; background: currentColor;
    }
    .status-spacer { flex: 1; }

    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .info-row {
      display: flex; align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      gap: 16px;
    }
    .info-row:last-child { border-bottom: none; }

    .info-label {
      font-size: var(--font-sm); font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px;
      width: 80px; flex-shrink: 0;
    }
    .info-value {
      font-size: var(--font-md); color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      flex: 1; word-break: break-all;
    }
    .info-value.text {
      font-family: inherit; font-size: var(--font-md);
    }
    .info-value.uuid {
      font-size: var(--font-sm);
    }

    .copy-btn-mini {
      background: none; border: none; cursor: pointer;
      padding: 2px; color: var(--text-muted); display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover { background: var(--border-subtle); color: var(--text); }

    .p2p-hint {
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
      padding: 0 14px 10px;
    }

    /* ── Stats grid ── */
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 12px;
    }

    .stat-box {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 12px;
    }

    .stat-value {
      font-size: var(--font-lg);
      font-weight: 700;
      color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    }

    .stat-rate {
      font-size: var(--font-sm);
      color: var(--green-text);
      margin-top: 2px;
    }

    .stat-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-sm);
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .stat-reset-mini {
      display: inline-flex;
      align-items: center;
      margin-left: auto;
      opacity: 0;
      transition: opacity 0.15s;
      cursor: pointer;
      color: var(--text-muted);
    }
    .stat-box:hover .stat-reset-mini { opacity: 1; }
    .stat-reset-mini:hover { color: var(--accent); }

    .form-group { margin-bottom: 14px; }
    .form-label {
      display: block;
      font-size: var(--font-sm); font-weight: 500; color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%; padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface); color: var(--text);
      font-size: var(--font-sm); font-family: inherit; outline: none;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }
    .form-input:focus { border-color: var(--accent); }
    .form-input[readonly] {
      background: var(--border-subtle); color: var(--text-muted);
    }

    .danger-zone {
      margin-top: 20px; padding: 14px;
      border: 1px solid var(--red-border);
      border-radius: var(--radius-md);
    }
    .danger-zone-label {
      font-size: var(--font-sm); font-weight: 600; color: var(--red-text);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
    }

    .toast {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: var(--surface); color: var(--text);
      padding: 10px 20px; border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: var(--font-sm); z-index: 100;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .dialog-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }
    @keyframes fade-in { from { opacity: 0; } }
    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px; max-width: 320px; width: 90%;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .dialog-title { font-weight: 600; font-size: var(--font-md); margin-bottom: 8px; text-align: center; }
    .dialog-message { color: var(--text-secondary); font-size: var(--font-sm); margin-bottom: 20px; text-align: center; line-height: 1.5; }
    .dialog-actions { display: flex; gap: 10px; justify-content: center; }
    .dialog-btn {
      padding: 8px 20px; border-radius: var(--radius-pill);
      border: none; cursor: pointer;
      font-size: var(--font-sm); font-weight: 500; font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .dialog-btn.cancel { background: var(--border-subtle); color: var(--text); }
    .dialog-btn.danger { background: var(--red); color: #fff; }
    .dialog-btn:hover { opacity: 0.85; }

    .btn-edit-bottom {
      width: 100%;
      padding: 8px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      line-height: 1;
    }
    .btn-edit-bottom svg {
      width: 14px;
      height: 14px;
    }
    .btn-edit-bottom:hover { opacity: 0.8; }
  `;o([g()],n.prototype,"entrypointType",2);o([g()],n.prototype,"entrypointId",2);o([p()],n.prototype,"mode",2);o([p()],n.prototype,"_entrypoint",2);o([p()],n.prototype,"_saving",2);o([p()],n.prototype,"_snackbar",2);o([p()],n.prototype,"_showDeleteDialog",2);o([p()],n.prototype,"_showResetDialog",2);o([p()],n.prototype,"_name",2);o([p()],n.prototype,"_endpoint",2);o([p()],n.prototype,"_tunnelId",2);o([p()],n.prototype,"_peer",2);o([p()],n.prototype,"_showPeer",2);n=o([E("entrypoint-detail-page")],n);export{n as EntrypointDetailPage};
