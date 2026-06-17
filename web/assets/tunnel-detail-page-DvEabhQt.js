const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-DHFyIU0B.js","assets/index-D7Ke4sE9.css"])))=>i.map(i=>d[i]);
import{a as g,s as _,g as w,j as e,_ as b,r as x,q as y,k as $,m as k,u as T,v as S,b as a,w as D,i as z,t as E}from"./index-DHFyIU0B.js";import{n as m,r}from"./state-DJflkmra.js";import{i as d}from"./app-scaffold-DZA-22_E.js";import{c as C}from"./clipboard-C3x8_sid.js";import{b as c,f as v,a as f}from"./format-CsvuTgp2.js";var R=Object.defineProperty,F=Object.getOwnPropertyDescriptor,o=(t,s,l,i)=>{for(var p=i>1?void 0:i?F(s,l):s,h=t.length-1,u;h>=0;h--)(u=t[h])&&(p=(i?u(s,l,p):u(p))||p);return i&&p&&R(s,l,p),p};let n=class extends g{constructor(){super(...arguments),this.tunnelType="tcp",this.tunnelId="",this.mode="view",this._tunnel=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._hostname="",this._username="",this._password="",this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1,this._showAuth=!1,this._unsubs=[]}get _isNativeDirPicker(){return!!window.WisperNative?.pickDir}_browseDir(){const t="__wisper_dir_callback__";window[t]=s=>{this._endpoint=s,this.requestUpdate(),delete window[t]},window.WisperNative.pickDir(t)}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(_(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.tunnelId,s=window.location.search.includes("edit");if(t==="new"||!t){if(this.mode==="create")return;this.mode="create",this._tunnel=null,this._resetForm();return}if(this.mode==="edit"&&this._tunnel?.id===t)return;const l=w().find(i=>i.id===t);l&&(this._tunnel=l,s?(this.mode="edit",this._populateForm(l)):(this.mode!=="edit"||this._tunnel?.id!==t)&&(this.mode="view",this._populateForm(l)))}_resetForm(){this._name="",this._endpoint="",this._hostname="",this._username="",this._password="",this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1,this._showAuth=!1}_populateForm(t){this._name=t.name,this._endpoint=t.endpoint,this._hostname=t.options.hostname??"",this._username=t.options.username??"",this._password=t.options.password??"",this._enableTLS=t.options.enableTLS??!1,this._rewriteHost=t.options.rewriteHost??!1,this._fileUpload=t.options.file_upload??!1,this._showAuth=!!(t.options.username||t.options.basic_auth)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._tunnel&&(this._populateForm(this._tunnel),this.mode="edit")}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(e("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.tunnelType,endpoint:this._endpoint.trim(),hostname:this._hostname.trim()||void 0,enableTLS:this._enableTLS,rewriteHost:this._rewriteHost,file_upload:this._fileUpload};this._showAuth&&(t.username=this._username.trim()||void 0,t.password=this._password||void 0),this.mode==="create"?(await b(()=>import("./index-DHFyIU0B.js").then(s=>s.F),__vite__mapDeps([0,1])).then(s=>s.create(t)),this._showSnackbar(e("saved")),this._navigate("/")):(await b(()=>import("./index-DHFyIU0B.js").then(s=>s.F),__vite__mapDeps([0,1])).then(s=>s.update(this.tunnelId,t)),this._showSnackbar(e("saved")),this.mode="view",await x())}catch(t){const s=t instanceof Error?t.message:"";this._showSnackbar(`${e("saveFailed")}${s?": "+s:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await y(this.tunnelId),this._showSnackbar(e("deleted")),this._navigate("/")}catch{this._showSnackbar(e("deleteFailed"))}}async _handleStart(){try{await $(this.tunnelId),this._showSnackbar(e("started"))}catch{this._showSnackbar(e("startFailed"))}}async _handleStop(){try{await k(this.tunnelId),this._showSnackbar(e("stopped"))}catch{this._showSnackbar(e("stopFailed"))}}async _handleCopy(t){await C(t),this._showSnackbar(e("copiedToClipboard"))}_handleResetStats(t){this._resetKind=t,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await T(this.tunnelId,this._resetKind),this._tunnel&&S(this.tunnelId,this._tunnel.stats),this._showSnackbar(e("saved"))}catch{this._showSnackbar(e("saveFailed"))}}_typeLabel(){return e(`type${this.tunnelType.charAt(0).toUpperCase()+this.tunnelType.slice(1)}`)}render(){const t=this._tunnel,s=t?t.stats:null,l=this._typeLabel();return a`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${d("chevron-left")}
          </button>
          <span class="page-title">
            ${this.mode==="create"?`${e("tunnelNewTitle")} — ${l}`:l+" Tunnel"}
          </span>

          ${this.mode==="view"&&t?a`
              ${t.status==="running"?a`<button class="pill-btn danger appbar-action" @click=${()=>this._handleStop()}>
                  ■ ${e("btnStop")}
                </button>`:a`<button class="pill-btn primary appbar-action" @click=${()=>this._handleStart()}>
                  ▶ ${e("btnStart")}
                </button>`}
            `:a`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${()=>this._handleSave()}>
                ${d("check")} ${e("btnSave")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&t?a`
            <!-- Status banner -->
            <div class="status-banner ${t.status}">
              <span class="status-dot-mini"></span>
              ${t.status==="running"?e("statusRunning")+" · "+c(t.stats.current_conns)+" "+e("activeConnections"):t.status==="error"?e("statusError"):e("statusStopped")}
              ${t.error?a` — ${t.error}`:""}
              <span class="status-spacer"></span>
            </div>

            <!-- Info card -->
            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${l} Tunnel</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Target</span>
                  <span class="info-value">${t.endpoint}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Entrypoint</span>
                  <span class="info-value">${t.entrypoint}</span>
                  <button class="copy-btn-mini" @click=${()=>this._handleCopy(t.entrypoint)}>
                    ${d("copy")}
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
                    ${d("copy")}
                  </button>
                </div>
              </div>

              <!-- Stats grid -->
              ${s?a`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${()=>this._handleResetStats("conns")} title="${e("btnResetStats")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${c(s.total_conns)}</div>
                      <div class="stat-rate">${c(s.current_conns)} active · ${s.request_rate.toFixed(1)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${()=>this._handleResetStats("errors")} title="${e("btnResetStats")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${c(s.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${()=>this._handleResetStats("output")} title="${e("btnResetOutput")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${v(s.output_bytes)}</div>
                      <div class="stat-rate">${f(s.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${()=>this._handleResetStats("input")} title="${e("btnResetInput")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${v(s.input_bytes)}</div>
                      <div class="stat-rate">${f(s.input_rate_bytes)}</div>
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
                      <span style="color:var(--accent);">${d("search")}</span>
                      <div style="flex:1;">
                        <div style="font-size:var(--font-sm);font-weight:600;">${e("inspectorEntryTitle")}</div>
                        <div style="font-size:var(--font-sm);color:var(--text-muted);">${e("inspectorEntryDesc")}</div>
                      </div>
                      <span style="color:var(--text-muted);">&rarr;</span>
                    </div>
                  </div>
                </div>
              `:""}

            <!-- Edit button (view mode only) -->
            ${this.mode==="view"&&t?a`
                <div class="section">
                  <button class="btn-edit-bottom" @click=${()=>this._enterEdit()}>
                    ${d("edit")} ${e("btnEdit")}
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
                  <input class="form-input" readonly .value=${l+" Tunnel"}>
                </div>

                <!-- Name -->
                <div class="form-group">
                  <label class="form-label">${e("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Tunnel"
                    @input=${i=>{this._name=i.target.value}}>
                </div>

                <!-- Target / Directory -->
                <div class="form-group">
                  <label class="form-label">
                    ${this.tunnelType==="file"?e("fieldDirectory"):e("fieldEndpoint")}
                  </label>
                  <div class="dir-input-row">
                    <input class="form-input dir-input" .value=${this._endpoint}
                      placeholder=${this.tunnelType==="http"?"http://localhost:3000":this.tunnelType==="file"?"/path/to/dir":"host:port"}
                      @input=${i=>{this._endpoint=i.target.value}}>
                    ${this.tunnelType==="file"&&this._isNativeDirPicker?a`<button type="button" class="browse-btn"
                          @click=${this._browseDir}>📁 ${e("browseDirectory")}</button>`:""}
                  </div>
                </div>

                <!-- Hostname (HTTP/File) -->
                ${this.tunnelType==="http"||this.tunnelType==="file"?a`
                    <div class="form-group">
                      <label class="form-label">${e("fieldHostname")}</label>
                      <input class="form-input" .value=${this._hostname} placeholder="example.com"
                        @input=${i=>{this._hostname=i.target.value}}>
                    </div>
                  `:""}

                <!-- TLS toggle (HTTP only) -->
                ${this.tunnelType==="http"?a`
                    <div class="switch-row">
                      <span class="switch-label">${e("switchEnableTLS")}</span>
                      <div class="switch ${this._enableTLS?"on":""}"
                        @click=${()=>{this._enableTLS=!this._enableTLS}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                  `:""}

                <!-- Auth section (HTTP/File) -->
                ${this.tunnelType==="http"||this.tunnelType==="file"?a`
                    <div class="switch-row" style="border-bottom:none;">
                      <span class="switch-label">${e("switchBasicAuth")}</span>
                      <div class="switch ${this._showAuth?"on":""}"
                        @click=${()=>{this._showAuth=!this._showAuth,this._showAuth||(this._username="",this._password="")}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>

                    ${this._showAuth?a`
                        <div class="form-group" style="margin-top:12px;">
                          <label class="form-label">${e("fieldUsername")}</label>
                          <input class="form-input" .value=${this._username} placeholder="admin"
                            @input=${i=>{this._username=i.target.value}}>
                        </div>
                        <div class="form-group">
                          <label class="form-label">${e("fieldPassword")}</label>
                          <input class="form-input" type="password" .value=${this._password} placeholder="••••"
                            @input=${i=>{this._password=i.target.value}}>
                        </div>
                      `:""}

                    ${this.tunnelType==="file"?a`
                        <div class="switch-row">
                          <span class="switch-label">${e("switchFileUpload")}</span>
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
                      <button class="pill-btn danger" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${d("trash")} ${e("btnDelete")}
                      </button>
                    </div>
                  `:""}
              </div>
            </div>
          `:""}

        ${this._snackbar?a`<div class="toast">${this._snackbar}</div>`:""}

        ${this._showResetDialog?a`
            <div class="dialog-overlay" @click=${()=>{this._showResetDialog=!1}}>
              <div class="dialog-box" @click=${i=>i.stopPropagation()}>
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

        ${this._showDeleteDialog?a`
            <div class="dialog-overlay" @click=${()=>{this._showDeleteDialog=!1}}>
              <div class="dialog-box" @click=${i=>i.stopPropagation()}>
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
      gap: 8px;
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
    }
    .btn-edit-bottom:hover { opacity: 0.8; }
  `;o([m()],n.prototype,"tunnelType",2);o([m()],n.prototype,"tunnelId",2);o([r()],n.prototype,"mode",2);o([r()],n.prototype,"_tunnel",2);o([r()],n.prototype,"_saving",2);o([r()],n.prototype,"_snackbar",2);o([r()],n.prototype,"_showDeleteDialog",2);o([r()],n.prototype,"_showResetDialog",2);o([r()],n.prototype,"_name",2);o([r()],n.prototype,"_endpoint",2);o([r()],n.prototype,"_hostname",2);o([r()],n.prototype,"_username",2);o([r()],n.prototype,"_password",2);o([r()],n.prototype,"_enableTLS",2);o([r()],n.prototype,"_rewriteHost",2);o([r()],n.prototype,"_fileUpload",2);o([r()],n.prototype,"_showAuth",2);n=o([E("tunnel-detail-page")],n);export{n as TunnelDetailPage};
