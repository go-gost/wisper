const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-CNQdID4l.js","assets/index-DIq3FqVg.css"])))=>i.map(i=>d[i]);
import{a as m,f as y,c as x,j as a,_ as u,x as _,y as $,l as w,n as k,z as S,v as D,b as i,w as z,i as E,t as I}from"./index-CNQdID4l.js";import{n as g,r as d}from"./state-D-pgx_bz.js";import{i as l}from"./app-scaffold-BBO6Vp7v.js";import{c as R}from"./clipboard-C3x8_sid.js";import{b as v,f as h,a as f}from"./format-CZNH9DXL.js";var C=Object.defineProperty,T=Object.getOwnPropertyDescriptor,o=(t,e,r,s)=>{for(var p=s>1?void 0:s?T(e,r):e,c=t.length-1,b;c>=0;c--)(b=t[c])&&(p=(s?b(e,r,p):b(p))||p);return s&&p&&C(e,r,p),p};let n=class extends m{constructor(){super(...arguments),this.entrypointType="tcp",this.entrypointId="",this.mode="view",this._entrypoint=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._tunnelId="",this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(y(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.entrypointId,e=window.location.search.includes("edit");if(t==="new"||!t){if(this.mode==="create")return;this.mode="create",this._entrypoint=null,this._resetForm();return}if(this.mode==="edit"&&this._entrypoint?.id===t)return;const r=x().find(s=>s.id===t);r&&(this._entrypoint=r,e?(this.mode="edit",this._populateForm(r)):(this.mode!=="edit"||this._entrypoint?.id!==t)&&(this.mode="view",this._populateForm(r)))}_resetForm(){this._name="",this._endpoint="",this._tunnelId=""}_populateForm(t){this._name=t.name,this._endpoint=t.entrypoint,this._tunnelId=t.id??""}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._entrypoint&&(this._populateForm(this._entrypoint),this.mode="edit")}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(a("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.entrypointType,endpoint:this._endpoint.trim(),id:this._tunnelId.trim()||void 0};this.mode==="create"?(await u(()=>import("./index-CNQdID4l.js").then(e=>e.G),__vite__mapDeps([0,1])).then(e=>e.create(t)),this._showSnackbar(a("saved")),this._navigate("/")):(await u(()=>import("./index-CNQdID4l.js").then(e=>e.G),__vite__mapDeps([0,1])).then(e=>e.update(this.entrypointId,t)),this._showSnackbar(a("saved")),this.mode="view",await _())}catch(t){const e=t instanceof Error?t.message:"";this._showSnackbar(`${a("saveFailed")}${e?": "+e:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await $(this.entrypointId),this._showSnackbar(a("deleted")),this._navigate("/")}catch{this._showSnackbar(a("deleteFailed"))}}async _handleStart(){try{await w(this.entrypointId),this._showSnackbar(a("started"))}catch{this._showSnackbar(a("startFailed"))}}async _handleStop(){try{await k(this.entrypointId),this._showSnackbar(a("stopped"))}catch{this._showSnackbar(a("stopFailed"))}}async _handleCopy(t){await R(t),this._showSnackbar(a("copiedToClipboard"))}_handleResetStats(t){this._resetKind=t,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await S(this.entrypointId,this._resetKind),this._entrypoint&&D(this.entrypointId,this._entrypoint.stats),this._showSnackbar(a("saved"))}catch{this._showSnackbar(a("saveFailed"))}}_typeLabel(){return this.entrypointType.toUpperCase()}render(){const t=this._entrypoint,e=t?t.stats:null,r=this._typeLabel();return i`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${l("chevron-left")}
          </button>
          <span class="page-title">
            ${this.mode==="create"?`${a("entrypointNewTitle")} — ${r}`:r+" Entrypoint"}
          </span>

          ${this.mode==="view"&&t?i`
              ${t.status==="running"?i`<button class="pill-btn danger appbar-action" @click=${()=>this._handleStop()}>
                  ■ ${a("btnStop")}
                </button>`:i`<button class="pill-btn primary appbar-action" @click=${()=>this._handleStart()}>
                  ▶ ${a("btnStart")}
                </button>`}
            `:i`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${()=>this._handleSave()}>
                ${l("check")} ${a("btnSave")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&t?i`
            <div class="status-banner ${t.status}">
              <span class="status-dot-mini"></span>
              ${t.status==="running"?a("statusRunning"):t.status==="error"?a("statusError"):a("statusStopped")}
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
                  <span class="info-label">Tunnel ID</span>
                  <span class="info-value uuid">${t.id??"—"}</span>
                  ${t.id?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(t.id)}>
                      ${l("copy")}
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

              <!-- Stats grid -->
              ${e?i`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${()=>this._handleResetStats("conns")} title="${a("btnResetStats")}">${l("rotate-cw")}</span></div>
                      <div class="stat-value">${v(e.total_conns)}</div>
                      <div class="stat-rate">${v(e.current_conns)} active · ${e.request_rate.toFixed(1)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${()=>this._handleResetStats("errors")} title="${a("btnResetStats")}">${l("rotate-cw")}</span></div>
                      <div class="stat-value">${v(e.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${()=>this._handleResetStats("output")} title="${a("btnResetOutput")}">${l("rotate-cw")}</span></div>
                      <div class="stat-value">${h(e.output_bytes)}</div>
                      <div class="stat-rate">${f(e.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${()=>this._handleResetStats("input")} title="${a("btnResetInput")}">${l("rotate-cw")}</span></div>
                      <div class="stat-value">${h(e.input_bytes)}</div>
                      <div class="stat-rate">${f(e.input_rate_bytes)}</div>
                    </div>
                  </div>
                `:""}
            </div>

            <!-- Inspector entry (only when inspector URL is configured) -->
            ${this.mode==="view"&&t&&z().inspector_url?i`
                <div class="section">
                  <div class="card" style="padding:0;">
                    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
                      background:linear-gradient(135deg,var(--accent-bg-subtle, rgba(88,166,255,0.06)),rgba(163,113,247,0.04));
                      border-radius:var(--radius-lg);cursor:pointer;"
                      @click=${()=>this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}/inspector`)}>
                      <span style="font-size:20px;">&#128269;</span>
                      <div style="flex:1;">
                        <div style="font-size:var(--font-sm);font-weight:600;">${a("inspectorEntryTitle")}</div>
                        <div style="font-size:var(--font-xs);color:var(--text-muted);">${a("inspectorEntryDesc")}</div>
                      </div>
                      <span style="color:var(--text-muted);">&rarr;</span>
                    </div>
                  </div>
                </div>
              `:""}

            <div class="section">
              <button class="btn-edit-bottom" @click=${()=>this._enterEdit()}>
                ${l("edit")} ${a("btnEdit")}
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

                <div class="form-group">
                  <label class="form-label">Tunnel ID</label>
                  <input class="form-input"
                    ?readonly=${this.mode==="edit"}
                    .value=${this._tunnelId}
                    placeholder="Paste tunnel UUID"
                    @input=${s=>{this._tunnelId=s.target.value}}>
                </div>

                <div class="form-group">
                  <label class="form-label">${a("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Entrypoint"
                    @input=${s=>{this._name=s.target.value}}>
                </div>

                <div class="form-group">
                  <label class="form-label">${a("fieldBindAddress")}</label>
                  <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                    @input=${s=>{this._endpoint=s.target.value}}>
                </div>

                ${this.mode==="edit"?i`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${l("trash")} ${a("btnDelete")}
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
                <div class="dialog-title">${a("resetStatsConfirmTitle")}</div>
                <div class="dialog-message">${a("resetStatsConfirm")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showResetDialog=!1}}>
                    ${a("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${()=>this._doResetStats()}>
                    ${a("btnResetStats")}
                  </button>
                </div>
              </div>
            </div>
          `:""}

        ${this._showDeleteDialog?i`
            <div class="dialog-overlay" @click=${()=>{this._showDeleteDialog=!1}}>
              <div class="dialog-box" @click=${s=>s.stopPropagation()}>
                <div class="dialog-title">${a("deleteConfirmTitle")}</div>
                <div class="dialog-message">${a("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showDeleteDialog=!1}}>
                    ${a("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${()=>this._handleDelete()}>
                    ${a("btnDelete")}
                  </button>
                </div>
              </div>
            </div>
          `:""}
      </app-scaffold>
    `}};n.styles=E`
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
      font-size: var(--font-xl);
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

    .danger-zone {
      margin-top: 20px; padding: 14px;
      border: 1px solid var(--red-border);
      border-radius: var(--radius-md);
    }
    .danger-zone-label {
      font-size: var(--font-xs); font-weight: 600; color: var(--red-text);
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
    }
    .btn-edit-bottom:hover { opacity: 0.8; }
  `;o([g()],n.prototype,"entrypointType",2);o([g()],n.prototype,"entrypointId",2);o([d()],n.prototype,"mode",2);o([d()],n.prototype,"_entrypoint",2);o([d()],n.prototype,"_saving",2);o([d()],n.prototype,"_snackbar",2);o([d()],n.prototype,"_showDeleteDialog",2);o([d()],n.prototype,"_showResetDialog",2);o([d()],n.prototype,"_name",2);o([d()],n.prototype,"_endpoint",2);o([d()],n.prototype,"_tunnelId",2);n=o([I("entrypoint-detail-page")],n);export{n as EntrypointDetailPage};
