const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-BqGzV4nu.js","assets/index-B3f8Rhiy.css"])))=>i.map(i=>d[i]);
import{a as g,s as _,g as w,j as s,_ as b,r as x,p as y,k as $,m as k,q as T,u as S,b as a,o as D,i as z,t as P}from"./index-BqGzV4nu.js";import{n as m,r}from"./state-rlIIs7f7.js";import{i as l}from"./app-scaffold-CoPMcydK.js";import{c as E}from"./clipboard-C3x8_sid.js";import{c,d as C,a as v,b as f}from"./format-BcWb47bn.js";var R=Object.defineProperty,F=Object.getOwnPropertyDescriptor,n=(t,e,d,o)=>{for(var p=o>1?void 0:o?F(e,d):e,h=t.length-1,u;h>=0;h--)(u=t[h])&&(p=(o?u(e,d,p):u(p))||p);return o&&p&&R(e,d,p),p};let i=class extends g{constructor(){super(...arguments),this.tunnelType="tcp",this.tunnelId="",this.mode="view",this._tunnel=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._hostname="",this._username="",this._password="",this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1,this._showAuth=!1,this._showPassword=!1,this._unsubs=[]}get _isNativeDirPicker(){return!!window.WisperNative?.pickDir}_browseDir(){const t="__wisper_dir_callback__";window[t]=e=>{this._endpoint=e,this.requestUpdate(),delete window[t]},window.WisperNative.pickDir(t)}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(_(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.tunnelId,e=window.location.search.includes("edit");if(t==="new"||!t){if(this.mode==="create")return;this.mode="create",this._tunnel=null,this._resetForm();return}if(this.mode==="edit"&&this._tunnel?.id===t)return;const d=w().find(o=>o.id===t);d&&(this._tunnel=d,e?(this.mode="edit",this._populateForm(d)):(this.mode!=="edit"||this._tunnel?.id!==t)&&(this.mode="view",this._populateForm(d)))}_resetForm(){this._name="",this._endpoint="",this._hostname="",this._username="",this._password="",this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1,this._showAuth=!1}_populateForm(t){this._name=t.name,this._endpoint=t.endpoint,this._hostname=t.options.hostname??"",this._username=t.options.username??"",this._password=t.options.password??"",this._enableTLS=t.options.enableTLS??!1,this._rewriteHost=t.options.rewriteHost??!1,this._fileUpload=t.options.file_upload??!1,this._showAuth=!!(t.options.username||t.options.basic_auth)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._tunnel&&(this._populateForm(this._tunnel),this.mode="edit")}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(s("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.tunnelType,endpoint:this._endpoint.trim(),hostname:this._hostname.trim()||void 0,enableTLS:this._enableTLS,rewriteHost:this._rewriteHost,file_upload:this._fileUpload};this._showAuth&&(t.username=this._username.trim()||void 0,t.password=this._password||void 0),this.mode==="create"?(await b(()=>import("./index-BqGzV4nu.js").then(e=>e.D),__vite__mapDeps([0,1])).then(e=>e.create(t)),this._showSnackbar(s("saved")),this._navigate("/")):(await b(()=>import("./index-BqGzV4nu.js").then(e=>e.D),__vite__mapDeps([0,1])).then(e=>e.update(this.tunnelId,t)),this._showSnackbar(s("saved")),this.mode="view",await x())}catch(t){const e=t instanceof Error?t.message:"";this._showSnackbar(`${s("saveFailed")}${e?": "+e:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await y(this.tunnelId),this._showSnackbar(s("deleted")),this._navigate("/")}catch{this._showSnackbar(s("deleteFailed"))}}async _handleStart(){try{await $(this.tunnelId),this._showSnackbar(s("started"))}catch{this._showSnackbar(s("startFailed"))}}async _handleStop(){try{await k(this.tunnelId),this._showSnackbar(s("stopped"))}catch{this._showSnackbar(s("stopFailed"))}}async _handleCopy(t){await E(t),this._showSnackbar(s("copiedToClipboard"))}_handleResetStats(t){this._resetKind=t,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await T(this.tunnelId,this._resetKind),this._tunnel&&S(this.tunnelId,this._tunnel.stats),this._showSnackbar(s("saved"))}catch{this._showSnackbar(s("saveFailed"))}}_typeLabel(){return s(`type${this.tunnelType.charAt(0).toUpperCase()+this.tunnelType.slice(1)}`)}render(){const t=this._tunnel,e=t?t.stats:null,d=this._typeLabel();return a`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${l("chevron-left")}
          </button>
          <span class="page-title">
            ${this.mode==="create"?`${s("tunnelNewTitle")} — ${d}`:d+" Tunnel"}
          </span>

          ${this.mode==="view"&&t?a`
              ${t.status==="running"?a`<button class="pill-btn danger appbar-action" title="${s("btnStop")}" @click=${()=>this._handleStop()}>
                  ${l("stop")}
                </button>`:a`<button class="pill-btn primary appbar-action" title="${s("btnStart")}" @click=${()=>this._handleStart()}>
                  ${l("play")}
                </button>`}
            `:a`
              <button class="pill-btn primary appbar-action" title="${s("btnSave")}" ?disabled=${this._saving} @click=${()=>this._handleSave()}>
                ${l("check")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&t?a`
            <!-- Status banner -->
            <div class="status-banner ${t.status}">
              <span class="status-dot-mini"></span>
              ${t.status==="running"?s("statusRunning")+" · "+c(t.stats.current_conns)+" "+s("activeConnections"):t.status==="error"?s("statusError"):s("statusStopped")}
              ${t.error?a` — ${t.error}`:""}
              <span class="status-spacer"></span>
            </div>

            <!-- Info card -->
            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${d} Tunnel</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Created</span>
                  <span class="info-value text">${C(t.created_at)}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Target</span>
                  <span class="info-value">${t.endpoint}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Entrypoint</span>
                  <span class="info-value">${t.entrypoint}</span>
                  <button class="copy-btn-mini" @click=${()=>this._handleCopy(t.entrypoint)}>
                    ${l("copy")}
                  </button>
                </div>
                ${t.options.hostname?a`
                    <div class="info-row">
                      <span class="info-label">Hostname</span>
                      <span class="info-value text">${t.options.hostname}</span>
                    </div>
                  `:""}
                ${this.tunnelType==="http"?a`
                    <div class="info-row">
                      <span class="info-label">TLS</span>
                      <span class="info-value text">${t.options.enableTLS?"Enabled":"Disabled"}</span>
                    </div>
                  `:""}
                ${t.options.username?a`
                    <div class="info-row">
                      <span class="info-label">Auth</span>
                      <span class="info-value text">Basic · ${t.options.username}</span>
                    </div>
                  `:""}
                ${this.tunnelType==="file"?a`
                    <div class="info-row">
                      <span class="info-label">Upload</span>
                      <span class="info-value text">${t.options.file_upload?"Enabled":"Disabled"}</span>
                    </div>
                  `:""}
                <div class="info-row">
                  <span class="info-label">ID</span>
                  <span class="info-value uuid">${t.id}</span>
                  <button class="copy-btn-mini" @click=${()=>this._handleCopy(t.id)}>
                    ${l("copy")}
                  </button>
                </div>
              </div>

              <!-- Stats grid -->
              ${e?a`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${()=>this._handleResetStats("conns")} title="${s("btnResetStats")}">${l("rotate-cw")}</span></div>
                      <div class="stat-value">${c(e.total_conns)}</div>
                      <div class="stat-rate">${c(e.current_conns)} active · ${e.request_rate.toFixed(1)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${()=>this._handleResetStats("errors")} title="${s("btnResetStats")}">${l("rotate-cw")}</span></div>
                      <div class="stat-value">${c(e.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${()=>this._handleResetStats("output")} title="${s("btnResetOutput")}">${l("rotate-cw")}</span></div>
                      <div class="stat-value">${v(e.output_bytes)}</div>
                      <div class="stat-rate">${f(e.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${()=>this._handleResetStats("input")} title="${s("btnResetInput")}">${l("rotate-cw")}</span></div>
                      <div class="stat-value">${v(e.input_bytes)}</div>
                      <div class="stat-rate">${f(e.input_rate_bytes)}</div>
                    </div>
                  </div>
                `:""}
            </div>

            <!-- Inspector entry — only HTTP/File tunnels carry HTTP traffic worth
                 inspecting, and only when an inspector URL is configured. -->
            ${this.mode==="view"&&t&&(this.tunnelType==="http"||this.tunnelType==="file")&&D().inspector_url?a`
                <div class="section">
                  <div class="card" style="padding:0;">
                    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
                      background:linear-gradient(135deg,var(--accent-bg-subtle, rgba(88,166,255,0.06)),rgba(163,113,247,0.04));
                      border-radius:var(--radius-lg);cursor:pointer;"
                      @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}/inspector`)}>
                      <span style="color:var(--accent);">${l("search")}</span>
                      <div style="flex:1;">
                        <div style="font-size:var(--font-sm);font-weight:600;">${s("inspectorEntryTitle")}</div>
                        <div style="font-size:var(--font-sm);color:var(--text-muted);">${s("inspectorEntryDesc")}</div>
                      </div>
                      <span style="color:var(--text-muted);">&rarr;</span>
                    </div>
                  </div>
                </div>
              `:""}

            <!-- Edit button (view mode only) -->
            ${this.mode==="view"&&t?a`
                <div class="section">
                  <button class="btn-edit-bottom" title="${s("btnEdit")}" @click=${()=>this._enterEdit()}>
                    ${l("edit")}
                  </button>
                </div>
              `:""}
          `:""}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode!=="view"?a`
            <div class="section">
              <div class="card" style="padding:16px;">
                <!-- Type (readonly) -->
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <input class="form-input" readonly .value=${d+" Tunnel"}>
                </div>

                <!-- Name -->
                <div class="form-group">
                  <label class="form-label">${s("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Tunnel"
                    @input=${o=>{this._name=o.target.value}}>
                </div>

                <!-- Target / Directory -->
                <div class="form-group">
                  <label class="form-label">
                    ${this.tunnelType==="file"?s("fieldDirectory"):s("fieldEndpoint")}
                  </label>
                  <div class="dir-input-row">
                    <input class="form-input dir-input" .value=${this._endpoint}
                      placeholder=${this.tunnelType==="http"?"host:port":this.tunnelType==="file"?"/path/to/dir":"host:port"}
                      @input=${o=>{this._endpoint=o.target.value}}>
                    ${this.tunnelType==="file"&&this._isNativeDirPicker?a`<button type="button" class="browse-btn"
                          @click=${this._browseDir}>📁 ${s("browseDirectory")}</button>`:""}
                  </div>
                </div>

                <!-- Hostname (HTTP only) -->
                ${this.tunnelType==="http"?a`
                    <div class="form-group">
                      <label class="form-label">${s("fieldHostname")}</label>
                      <input class="form-input" .value=${this._hostname} placeholder="example.com"
                        @input=${o=>{this._hostname=o.target.value}}>
                    </div>
                  `:""}

                <!-- TLS toggle (HTTP only) -->
                ${this.tunnelType==="http"?a`
                    <div class="switch-row">
                      <span class="switch-label">${s("switchEnableTLS")}</span>
                      <div class="switch ${this._enableTLS?"on":""}"
                        @click=${()=>{this._enableTLS=!this._enableTLS}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                  `:""}

                <!-- Auth section (HTTP/File) -->
                ${this.tunnelType==="http"||this.tunnelType==="file"?a`
                    <div class="switch-row" style="border-bottom:none;">
                      <span class="switch-label">${s("switchBasicAuth")}</span>
                      <div class="switch ${this._showAuth?"on":""}"
                        @click=${()=>{this._showAuth=!this._showAuth,this._showAuth||(this._username="",this._password="")}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>

                    ${this._showAuth?a`
                        <div class="form-group" style="margin-top:12px;">
                          <label class="form-label">${s("fieldUsername")}</label>
                          <input class="form-input" .value=${this._username} placeholder="admin"
                            @input=${o=>{this._username=o.target.value}}>
                        </div>
                        <div class="form-group">
                          <label class="form-label">${s("fieldPassword")}</label>
                          <div class="password-wrapper">
                            <input class="form-input" type=${this._showPassword?"text":"password"}
                              .value=${this._password} placeholder="••••"
                              @input=${o=>{this._password=o.target.value}}>
                            <button type="button" class="password-toggle"
                              @click=${()=>{this._showPassword=!this._showPassword}}
                              title=${this._showPassword?s("hidePassword"):s("showPassword")}>
                              ${l(this._showPassword?"eye-off":"eye")}
                            </button>
                          </div>
                        </div>
                      `:""}

                    ${this.tunnelType==="file"?a`
                        <div class="switch-row">
                          <span class="switch-label">${s("switchFileUpload")}</span>
                          <div class="switch ${this._fileUpload?"on":""}"
                            @click=${()=>{this._fileUpload=!this._fileUpload}}>
                            <div class="switch-knob"></div>
                          </div>
                        </div>
                      `:""}
                  `:""}

                <!-- Danger Zone (edit only) -->
                ${this.mode==="edit"?a`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" title="${s("btnDelete")}" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${l("trash")}
                      </button>
                    </div>
                  `:""}
              </div>
            </div>
          `:""}

        ${this._snackbar?a`<div class="toast">${this._snackbar}</div>`:""}

        ${this._showResetDialog?a`
            <div class="dialog-overlay" @click=${()=>{this._showResetDialog=!1}}>
              <div class="dialog-box" @click=${o=>o.stopPropagation()}>
                <div class="dialog-title">${s("resetStatsConfirmTitle")}</div>
                <div class="dialog-message">${s("resetStatsConfirm")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showResetDialog=!1}}>
                    ${s("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${()=>this._doResetStats()}>
                    ${s("btnResetStats")}
                  </button>
                </div>
              </div>
            </div>
          `:""}

        ${this._showDeleteDialog?a`
            <div class="dialog-overlay" @click=${()=>{this._showDeleteDialog=!1}}>
              <div class="dialog-box" @click=${o=>o.stopPropagation()}>
                <div class="dialog-title">${s("deleteConfirmTitle")}</div>
                <div class="dialog-message">${s("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showDeleteDialog=!1}}>
                    ${s("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${()=>this._handleDelete()}>
                    ${s("btnDelete")}
                  </button>
                </div>
              </div>
            </div>
          `:""}
      </app-scaffold>
    `}};i.styles=z`
    /* ── AppBar ── */
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

    .appbar-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: var(--font-sm);
      display: flex;
      align-items: center;
      gap: 3px;
      font-family: inherit;
      transition: background var(--transition-fast);
    }
    .appbar-btn:hover {
      background: var(--border-subtle);
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
    }
    .pill-btn.primary {
      background: var(--accent);
      color: var(--accent-fg);
    }
    .pill-btn.danger {
      background: var(--red);
      color: #fff;
    }
    .pill-btn svg {
      width: 14px;
      height: 14px;
    }
    .pill-btn:hover {
      opacity: 0.85;
    }
    .pill-btn.appbar-action {
      margin-left: auto;
    }

    /* ── Layout ── */
    .section {
      padding: 16px;
    }

    /* ── Status banner ── */
    .status-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      margin: 0 16px;
      border-radius: var(--radius-md);
      font-size: var(--font-sm);
      font-weight: 500;
    }
    .status-banner.running {
      background: var(--green-bg);
      color: var(--green-text);
      border: 1px solid var(--green-border);
    }
    .status-banner.stopped {
      background: var(--border-subtle);
      color: var(--text-muted);
    }
    .status-banner.error {
      background: var(--red-bg);
      color: var(--red-text);
      border: 1px solid var(--red-border);
    }

    .status-dot-mini {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .status-spacer {
      flex: 1;
    }

    /* ── Info card ── */
    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .info-row {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      gap: 16px;
    }
    .info-row:last-child {
      border-bottom: none;
    }

    .info-label {
      font-size: var(--font-sm);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      width: 80px;
      flex-shrink: 0;
    }

    .info-value {
      font-size: var(--font-md);
      color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      flex: 1;
      word-break: break-all;
    }

    .info-value.text {
      font-family: inherit;
      font-size: var(--font-md);
    }

    .info-value.uuid {
      font-size: var(--font-sm);
    }

    .copy-btn-mini {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: var(--text-muted);
      display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover {
      background: var(--border-subtle);
      color: var(--text);
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

    .stat-icon {
      font-size: var(--font-md);
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

    /* ── Form ── */
    .form-group {
      margin-bottom: 14px;
    }
    .form-label {
      display: block;
      font-size: var(--font-sm);
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }
    .form-input:focus {
      border-color: var(--accent);
    }
    .form-input[readonly] {
      background: var(--border-subtle);
      color: var(--text-muted);
    }

    /* ── Password field ── */
    .password-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .password-wrapper .form-input {
      padding-right: 36px;
    }
    .password-toggle {
      position: absolute;
      right: 6px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
    }
    .password-toggle:hover {
      color: var(--text);
    }

    /* ── Directory picker ── */
    .dir-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .dir-input {
      flex: 1;
    }
    .browse-btn {
      white-space: nowrap;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      font-family: inherit;
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .browse-btn:hover {
      background: var(--border-subtle);
      border-color: var(--accent);
    }

    /* ── Switch ── */
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .switch-label {
      font-size: var(--font-sm);
      color: var(--text);
    }
    .switch {
      width: 40px;
      height: 22px;
      border-radius: 11px;
      background: var(--border);
      position: relative;
      cursor: pointer;
      transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch.on {
      background: var(--accent);
    }
    .switch-knob {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      position: absolute;
      top: 2px;
      left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    }
    .switch.on .switch-knob {
      left: 20px;
    }

    /* ── Danger zone ── */
    .danger-zone {
      margin-top: 20px;
      padding: 14px;
      border: 1px solid var(--red-border);
      border-radius: var(--radius-md);
    }
    .danger-zone-label {
      font-size: var(--font-sm);
      font-weight: 600;
      color: var(--red-text);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface);
      color: var(--text);
      padding: 10px 20px;
      border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: var(--font-sm);
      z-index: 100;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* ── Delete dialog ── */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }
    @keyframes fade-in { from { opacity: 0; } }
    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      max-width: 320px;
      width: 90%;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }
    .dialog-title {
      font-weight: 600;
      font-size: var(--font-md);
      margin-bottom: 8px;
      text-align: center;
    }
    .dialog-message {
      color: var(--text-secondary);
      font-size: var(--font-sm);
      margin-bottom: 20px;
      text-align: center;
      line-height: 1.5;
    }
    .dialog-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .dialog-btn {
      padding: 8px 20px;
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
    }
    .dialog-btn.cancel {
      background: var(--border-subtle);
      color: var(--text);
    }
    .dialog-btn.danger {
      background: var(--red);
      color: #fff;
    }
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
      line-height: 1;
    }
    .btn-edit-bottom svg {
      width: 14px;
      height: 14px;
    }
    .btn-edit-bottom:hover { opacity: 0.8; }
  `;n([m()],i.prototype,"tunnelType",2);n([m()],i.prototype,"tunnelId",2);n([r()],i.prototype,"mode",2);n([r()],i.prototype,"_tunnel",2);n([r()],i.prototype,"_saving",2);n([r()],i.prototype,"_snackbar",2);n([r()],i.prototype,"_showDeleteDialog",2);n([r()],i.prototype,"_showResetDialog",2);n([r()],i.prototype,"_name",2);n([r()],i.prototype,"_endpoint",2);n([r()],i.prototype,"_hostname",2);n([r()],i.prototype,"_username",2);n([r()],i.prototype,"_password",2);n([r()],i.prototype,"_enableTLS",2);n([r()],i.prototype,"_rewriteHost",2);n([r()],i.prototype,"_fileUpload",2);n([r()],i.prototype,"_showAuth",2);n([r()],i.prototype,"_showPassword",2);i=n([P("tunnel-detail-page")],i);export{i as TunnelDetailPage};
