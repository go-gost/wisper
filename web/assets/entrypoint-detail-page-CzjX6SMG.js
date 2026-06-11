const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-CTGHrmHL.js","assets/index-DIq3FqVg.css"])))=>i.map(i=>d[i]);
import{a as v,f,c as g,j as e,_ as u,w as m,x as y,l as _,n as x,y as w,b as s,i as $,t as k}from"./index-CTGHrmHL.js";import{n as h,r}from"./state-BZBTxrJb.js";import{i as p}from"./app-scaffold-DoLCQb2f.js";import{c as D}from"./clipboard-C3x8_sid.js";var S=Object.defineProperty,E=Object.getOwnPropertyDescriptor,o=(t,a,i,l)=>{for(var d=l>1?void 0:l?E(a,i):a,c=t.length-1,b;c>=0;c--)(b=t[c])&&(d=(l?b(a,i,d):b(d))||d);return l&&d&&S(a,i,d),d};let n=class extends v{constructor(){super(...arguments),this.entrypointType="tcp",this.entrypointId="",this.mode="view",this._entrypoint=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._tunnelId="",this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(f(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.entrypointId,a=window.location.search.includes("edit");if(t==="new"||!t){if(this.mode==="create")return;this.mode="create",this._entrypoint=null,this._resetForm();return}if(this.mode==="edit"&&this._entrypoint?.id===t)return;const i=g().find(l=>l.id===t);i&&(this._entrypoint=i,a?(this.mode="edit",this._populateForm(i)):(this.mode!=="edit"||this._entrypoint?.id!==t)&&(this.mode="view",this._populateForm(i)))}_resetForm(){this._name="",this._endpoint="",this._tunnelId=""}_populateForm(t){this._name=t.name,this._endpoint=t.entrypoint,this._tunnelId=t.id??""}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._entrypoint&&(this._populateForm(this._entrypoint),this.mode="edit")}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(e("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.entrypointType,endpoint:this._endpoint.trim(),id:this._tunnelId.trim()||void 0};this.mode==="create"?(await u(()=>import("./index-CTGHrmHL.js").then(a=>a.G),__vite__mapDeps([0,1])).then(a=>a.create(t)),this._showSnackbar(e("saved")),this._navigate("/")):(await u(()=>import("./index-CTGHrmHL.js").then(a=>a.G),__vite__mapDeps([0,1])).then(a=>a.update(this.entrypointId,t)),this._showSnackbar(e("saved")),this.mode="view",await m())}catch(t){const a=t instanceof Error?t.message:"";this._showSnackbar(`${e("saveFailed")}${a?": "+a:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await y(this.entrypointId),this._showSnackbar(e("deleted")),this._navigate("/")}catch{this._showSnackbar(e("deleteFailed"))}}async _handleStart(){try{await _(this.entrypointId),this._showSnackbar(e("started"))}catch{this._showSnackbar(e("startFailed"))}}async _handleStop(){try{await x(this.entrypointId),this._showSnackbar(e("stopped"))}catch{this._showSnackbar(e("stopFailed"))}}async _handleCopy(t){await D(t),this._showSnackbar(e("copiedToClipboard"))}_handleResetStats(t){this._resetKind=t,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await w(this.entrypointId,this._resetKind),this._showSnackbar(e("saved"))}catch{this._showSnackbar(e("saveFailed"))}}_typeLabel(){return this.entrypointType.toUpperCase()}render(){const t=this._entrypoint,a=this._typeLabel();return s`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${p("chevron-left")}
          </button>
          <span class="page-title">
            ${this.mode==="create"?`${e("entrypointNewTitle")} — ${a}`:a+" Entrypoint"}
          </span>

          ${this.mode==="view"&&t?s`
              ${t.status==="running"?s`<button class="pill-btn danger appbar-action" @click=${this._handleStop}>
                  ■ ${e("btnStop")}
                </button>`:s`<button class="pill-btn primary appbar-action" @click=${this._handleStart}>
                  ▶ ${e("btnStart")}
                </button>`}
            `:s`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${this._handleSave}>
                ${p("check")} ${e("btnSave")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&t?s`
            <!-- Status banner -->
            <div class="status-banner ${t.status}">
              <span class="status-dot-mini"></span>
              ${t.status==="running"?e("statusRunning"):t.status==="error"?e("statusError"):e("statusStopped")}
              ${t.error?s` — ${t.error}`:""}
              <span class="status-spacer"></span>
            </div>

            <!-- Info card -->
            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${a} Entrypoint</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Tunnel ID</span>
                  <span class="info-value uuid">${t.id??"—"}</span>
                  ${t.id?s`<button class="copy-btn-mini" @click=${()=>this._handleCopy(t.id)}>
                      ${p("copy")}
                    </button>`:""}
                </div>
                <div class="info-row">
                  <span class="info-label">Name</span>
                  <span class="info-value text">${t.name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Bind Address</span>
                  <span class="info-value">${t.entrypoint}</span>
                </div>
              </div>
            </div>

            <!-- Edit button (view mode only) -->
            <div class="section">
              <button class="btn-edit-bottom" @click=${this._enterEdit}>
                ${p("edit")} ${e("btnEdit")}
              </button>
            </div>
          `:""}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode!=="view"?s`
            <div class="section">
              <div class="card" style="padding:16px;">
                <!-- Type (readonly) -->
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <input class="form-input" readonly .value=${a+" Entrypoint"}>
                </div>

                <!-- Tunnel ID -->
                <div class="form-group">
                  <label class="form-label">Tunnel ID</label>
                  <input class="form-input"
                    ?readonly=${this.mode==="edit"}
                    .value=${this._tunnelId}
                    placeholder="Paste tunnel UUID"
                    @input=${i=>{this._tunnelId=i.target.value}}>
                </div>

                <!-- Name -->
                <div class="form-group">
                  <label class="form-label">${e("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Entrypoint"
                    @input=${i=>{this._name=i.target.value}}>
                </div>

                <!-- Bind Address -->
                <div class="form-group">
                  <label class="form-label">${e("fieldBindAddress")}</label>
                  <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                    @input=${i=>{this._endpoint=i.target.value}}>
                </div>

                <!-- Danger Zone (edit only) -->
                ${this.mode==="edit"?s`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${p("trash")} ${e("btnDelete")}
                      </button>
                    </div>
                  `:""}
              </div>
            </div>
          `:""}

        ${this._snackbar?s`<div class="toast">${this._snackbar}</div>`:""}

        ${this._showResetDialog?s`
            <div class="dialog-overlay" @click=${()=>{this._showResetDialog=!1}}>
              <div class="dialog-box" @click=${i=>i.stopPropagation()}>
                <div class="dialog-title">${e("resetStatsConfirmTitle")}</div>
                <div class="dialog-message">${e("resetStatsConfirm")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showResetDialog=!1}}>
                    ${e("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${this._doResetStats}>
                    ${e("btnResetStats")}
                  </button>
                </div>
              </div>
            </div>
          `:""}

        ${this._showDeleteDialog?s`
            <div class="dialog-overlay" @click=${()=>{this._showDeleteDialog=!1}}>
              <div class="dialog-box" @click=${i=>i.stopPropagation()}>
                <div class="dialog-title">${e("deleteConfirmTitle")}</div>
                <div class="dialog-message">${e("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showDeleteDialog=!1}}>
                    ${e("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${this._handleDelete}>
                    ${e("btnDelete")}
                  </button>
                </div>
              </div>
            </div>
          `:""}
      </app-scaffold>
    `}};n.styles=$`
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
    .pill-btn:hover { opacity: 0.85; }
    .pill-btn.appbar-action { margin-left: auto; }

    /* ── Layout ── */
    .section { padding: 16px; }

    /* ── Status banner ── */
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

    /* ── Info card ── */
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
      gap: 8px;
    }
    .info-row:last-child { border-bottom: none; }

    .info-label {
      font-size: var(--font-sm); font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px;
      width: 80px; flex-shrink: 0;
    }
    .info-value {
      font-size: var(--font-lg); color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      flex: 1; word-break: break-all;
    }
    .info-value.text {
      font-family: inherit; font-size: var(--font-lg);
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

    /* ── Form ── */
    .form-group { margin-bottom: 14px; }
    .form-label {
      display: block;
      font-size: var(--font-xs); font-weight: 500; color: var(--text-muted);
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

    /* ── Danger zone ── */
    .danger-zone {
      margin-top: 20px; padding: 14px;
      border: 1px solid var(--red-border);
      border-radius: var(--radius-md);
    }
    .danger-zone-label {
      font-size: var(--font-xs); font-weight: 600; color: var(--red-text);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
    }

    /* ── Toast ── */
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

    /* ── Delete dialog ── */
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

    /* ── Edit button at bottom ── */
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
    }
    .btn-edit-bottom:hover { opacity: 0.8; }
  `;o([h()],n.prototype,"entrypointType",2);o([h()],n.prototype,"entrypointId",2);o([r()],n.prototype,"mode",2);o([r()],n.prototype,"_entrypoint",2);o([r()],n.prototype,"_saving",2);o([r()],n.prototype,"_snackbar",2);o([r()],n.prototype,"_showDeleteDialog",2);o([r()],n.prototype,"_showResetDialog",2);o([r()],n.prototype,"_name",2);o([r()],n.prototype,"_endpoint",2);o([r()],n.prototype,"_tunnelId",2);n=o([k("entrypoint-detail-page")],n);export{n as EntrypointDetailPage};
