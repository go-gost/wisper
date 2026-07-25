const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-DFQXH03L.js","assets/index-B3f8Rhiy.css"])))=>i.map(i=>d[i]);
import{a as w,s as x,g as y,j as e,_ as f,r as $,p as k,k as T,m as S,q as D,u as R,b as i,o as z,i as P,t as E}from"./index-DFQXH03L.js";import{n as _,r as l}from"./state-B98pw_DR.js";import{i as d}from"./app-scaffold-Cr_-f6md.js";import{c as C}from"./clipboard-C3x8_sid.js";import{c as h,d as F,a as b,b as g}from"./format-BcWb47bn.js";var L=Object.defineProperty,M=Object.getOwnPropertyDescriptor,r=(t,s,o,a)=>{for(var p=a>1?void 0:a?M(s,o):s,u=t.length-1,v;u>=0;u--)(v=t[u])&&(p=(a?v(s,o,p):v(p))||p);return a&&p&&L(s,o,p),p};const c=[{value:"off",labelKey:"settingsRecordOff",descKey:"settingsRecordOffDesc"},{value:"headers",labelKey:"settingsRecordHeaders",descKey:"settingsRecordHeadersDesc",warn:!0},{value:"full",labelKey:"settingsRecordFull",descKey:"settingsRecordFullDesc",warn:!0}];function m(t){return c.find(s=>s.value===t)??c[2]}let n=class extends w{constructor(){super(...arguments),this.tunnelType="tcp",this.tunnelId="",this.mode="view",this._tunnel=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._hostname="",this._prefix="",this._username="",this._password="",this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1,this._showAuth=!1,this._showPassword=!1,this._recordMode="off",this._unsubs=[]}get _isNativeDirPicker(){return!!window.WisperNative?.pickDir}_browseDir(){const t="__wisper_dir_callback__";window[t]=s=>{this._endpoint=s,this.requestUpdate(),delete window[t]},window.WisperNative.pickDir(t)}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(x(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.tunnelId,s=window.location.search.includes("edit");if(t==="new"||!t){if(this.mode==="create")return;this.mode="create",this._tunnel=null,this._resetForm();return}if(this.mode==="edit"&&this._tunnel?.id===t)return;const o=y().find(a=>a.id===t);o&&(this._tunnel=o,s?(this.mode="edit",this._populateForm(o)):(this.mode!=="edit"||this._tunnel?.id!==t)&&(this.mode="view",this._populateForm(o)))}_resetForm(){this._name="",this._endpoint="",this._hostname="",this._prefix="",this._username="",this._password="",this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1,this._showAuth=!1,this._recordMode="off"}_populateForm(t){this._name=t.name,this._endpoint=t.endpoint,this._hostname=t.options.hostname??"",this._prefix=t.options.prefix??"",this._username=t.options.username??"",this._password=t.options.password??"",this._enableTLS=t.options.enableTLS??!1,this._rewriteHost=t.options.rewriteHost??!1,this._fileUpload=t.options.file_upload??!1,this._showAuth=!!(t.options.username||t.options.basic_auth),this._recordMode=t.options.record_mode||"off"}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._tunnel&&(this._populateForm(this._tunnel),this.mode="edit")}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(e("requiredField"));return}const t=this._prefix.trim().toLowerCase();if(t&&(t.length<8||t.length>63||!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(t))){this._showSnackbar(e("invalidPrefix"));return}this._saving=!0;try{const s={name:this._name.trim(),type:this.tunnelType,endpoint:this._endpoint.trim(),prefix:t||void 0,hostname:this._hostname.trim()||void 0,enableTLS:this._enableTLS,rewriteHost:this._rewriteHost,file_upload:this._fileUpload,record_mode:this._recordMode};this._showAuth&&(s.username=this._username.trim()||void 0,s.password=this._password||void 0),this.mode==="create"?(await f(()=>import("./index-DFQXH03L.js").then(o=>o.D),__vite__mapDeps([0,1])).then(o=>o.create(s)),this._showSnackbar(e("saved")),this._navigate("/")):(await f(()=>import("./index-DFQXH03L.js").then(o=>o.D),__vite__mapDeps([0,1])).then(o=>o.update(this.tunnelId,s)),this._showSnackbar(e("saved")),this.mode="view",await $())}catch(s){const o=s instanceof Error?s.message:"";this._showSnackbar(`${e("saveFailed")}${o?": "+o:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await k(this.tunnelId),this._showSnackbar(e("deleted")),this._navigate("/")}catch{this._showSnackbar(e("deleteFailed"))}}async _handleStart(){try{await T(this.tunnelId),this._showSnackbar(e("started"))}catch{this._showSnackbar(e("startFailed"))}}async _handleStop(){try{await S(this.tunnelId),this._showSnackbar(e("stopped"))}catch{this._showSnackbar(e("stopFailed"))}}async _handleCopy(t){await C(t),this._showSnackbar(e("copiedToClipboard"))}_handleResetStats(t){this._resetKind=t,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await D(this.tunnelId,this._resetKind),this._tunnel&&R(this.tunnelId,this._tunnel.stats),this._showSnackbar(e("saved"))}catch{this._showSnackbar(e("saveFailed"))}}_typeLabel(){return e(`type${this.tunnelType.charAt(0).toUpperCase()+this.tunnelType.slice(1)}`)}_cycleOption(t,s){const o=s.indexOf(t);return s[(o+1)%s.length]}_setRecordMode(t){this._recordMode=t,this.requestUpdate()}render(){const t=this._tunnel,s=t?t.stats:null,o=this._typeLabel();return i`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${d("chevron-left")}
          </button>
          <span class="page-title">
            ${this.mode==="create"?`${e("tunnelNewTitle")} — ${o}`:o+" Tunnel"}
          </span>

          ${this.mode==="view"&&t?i`
              ${t.status==="running"?i`<button class="pill-btn danger appbar-action" title="${e("btnStop")}" @click=${()=>this._handleStop()}>
                  ${d("stop")}
                </button>`:i`<button class="pill-btn primary appbar-action" title="${e("btnStart")}" @click=${()=>this._handleStart()}>
                  ${d("play")}
                </button>`}
            `:i`
              <button class="pill-btn primary appbar-action" title="${e("btnSave")}" ?disabled=${this._saving} @click=${()=>this._handleSave()}>
                ${d("check")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&t?i`
            <!-- Status banner -->
            <div class="status-banner ${t.status}">
              <span class="status-dot-mini"></span>
              ${t.status==="running"?e("statusRunning")+" · "+h(t.stats.current_conns)+" "+e("activeConnections"):t.status==="error"?e("statusError"):e("statusStopped")}
              ${t.error?i` — ${t.error}`:""}
              <span class="status-spacer"></span>
            </div>

            <!-- Info card -->
            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${o} Tunnel</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Created</span>
                  <span class="info-value text">${F(t.created_at)}</span>
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
                ${t.options.prefix?i`
                    <div class="info-row">
                      <span class="info-label">${e("fieldPrefix")}</span>
                      <span class="info-value text">${t.options.prefix}</span>
                    </div>
                  `:""}
                ${t.options.hostname?i`
                    <div class="info-row">
                      <span class="info-label">Hostname</span>
                      <span class="info-value text">${t.options.hostname}</span>
                    </div>
                  `:""}
                ${this.tunnelType==="http"?i`
                    <div class="info-row">
                      <span class="info-label">TLS</span>
                      <span class="info-value text">${t.options.enableTLS?"Enabled":"Disabled"}</span>
                    </div>
                  `:""}
                ${t.options.username?i`
                    <div class="info-row">
                      <span class="info-label">Auth</span>
                      <span class="info-value text">Basic · ${t.options.username}</span>
                    </div>
                  `:""}
                ${this.tunnelType==="file"?i`
                    <div class="info-row">
                      <span class="info-label">Upload</span>
                      <span class="info-value text">${t.options.file_upload?"Enabled":"Disabled"}</span>
                    </div>
                  `:""}
                <div class="info-row">
                  <span class="info-label">Recording</span>
                  <span class="info-value text">${e(c.find(a=>a.value===this._recordMode)?.labelKey??"settingsRecordFull")}</span>
                </div>
                <div class="info-row" style="margin-top:-8px;">
                  <span class="info-label"></span>
                  <span class="info-value text ${this._recordMode!=="off"?"record-warn":""}" style="font-size:var(--font-xs);line-height:1.5;">
                    ${e(m(this._recordMode).descKey)}
                  </span>
                </div>
                <div class="info-row">
                  <span class="info-label">ID</span>
                  <span class="info-value uuid">${t.id}</span>
                  <button class="copy-btn-mini" @click=${()=>this._handleCopy(t.id)}>
                    ${d("copy")}
                  </button>
                </div>
              </div>

              <!-- Stats grid -->
              ${s?i`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${()=>this._handleResetStats("conns")} title="${e("btnResetStats")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${h(s.total_conns)}</div>
                      <div class="stat-rate">${h(s.current_conns)} active · ${s.request_rate.toFixed(1)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${()=>this._handleResetStats("errors")} title="${e("btnResetStats")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${h(s.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${()=>this._handleResetStats("output")} title="${e("btnResetOutput")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${b(s.output_bytes)}</div>
                      <div class="stat-rate">${g(s.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${()=>this._handleResetStats("input")} title="${e("btnResetInput")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${b(s.input_bytes)}</div>
                      <div class="stat-rate">${g(s.input_rate_bytes)}</div>
                    </div>
                  </div>
                `:""}
            </div>

            <!-- Inspector entry — only HTTP/File tunnels carry HTTP traffic worth
                 inspecting, and only when an inspector URL is configured. -->
            ${this.mode==="view"&&t&&(this.tunnelType==="http"||this.tunnelType==="file")&&z().inspector_url?i`
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
            ${this.mode==="view"&&t?i`
                <div class="section">
                  <button class="btn-edit-bottom" title="${e("btnEdit")}" @click=${()=>this._enterEdit()}>
                    ${d("edit")}
                  </button>
                </div>
              `:""}
          `:""}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode!=="view"?i`
            <div class="section">
              <div class="card" style="padding:16px;">
                <!-- Type (readonly) -->
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <input class="form-input" readonly .value=${o+" Tunnel"}>
                </div>

                <!-- Name -->
                <div class="form-group">
                  <label class="form-label">${e("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Tunnel"
                    @input=${a=>{this._name=a.target.value}}>
                </div>

                <!-- Target / Directory -->
                <div class="form-group">
                  <label class="form-label">
                    ${this.tunnelType==="file"?e("fieldDirectory"):e("fieldEndpoint")}
                  </label>
                  <div class="dir-input-row">
                    <input class="form-input dir-input" .value=${this._endpoint}
                      placeholder=${this.tunnelType==="http"?"host:port":this.tunnelType==="file"?"/path/to/dir":"host:port"}
                      @input=${a=>{this._endpoint=a.target.value}}>
                    ${this.tunnelType==="file"&&this._isNativeDirPicker?i`<button type="button" class="browse-btn"
                          @click=${this._browseDir}>📁 ${e("browseDirectory")}</button>`:""}
                  </div>
                </div>

                <!-- URL Prefix (HTTP + file) -->
                ${this.tunnelType==="http"||this.tunnelType==="file"?i`
                    <div class="form-group">
                      <label class="form-label">${e("fieldPrefix")}</label>
                      <input class="form-input" .value=${this._prefix} placeholder="my-app-name"
                        @input=${a=>{this._prefix=a.target.value}}>
                      <div style="font-size:var(--font-xs);color:var(--text-muted);line-height:1.5;padding-top:4px;">
                        ${e("fieldPrefixHint")}
                      </div>
                    </div>
                  `:""}

                <!-- Hostname (HTTP only) -->
                ${this.tunnelType==="http"?i`
                    <div class="form-group">
                      <label class="form-label">${e("fieldHostname")}</label>
                      <input class="form-input" .value=${this._hostname} placeholder="example.com"
                        @input=${a=>{this._hostname=a.target.value}}>
                    </div>
                  `:""}

                <!-- TLS toggle (HTTP only) -->
                ${this.tunnelType==="http"?i`
                    <div class="switch-row">
                      <span class="switch-label">${e("switchEnableTLS")}</span>
                      <div class="switch ${this._enableTLS?"on":""}"
                        @click=${()=>{this._enableTLS=!this._enableTLS}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                  `:""}

                <!-- Recording mode -->
                <div class="switch-row" @click=${()=>this._setRecordMode(this._cycleOption(this._recordMode,c.map(a=>a.value)))}>
                  <span class="switch-label">${e("settingsRecordMode")}</span>
                  <span style="font-size:var(--font-sm);color:var(--text-muted);display:flex;align-items:center;gap:4px;">
                    ${e(c.find(a=>a.value===this._recordMode)?.labelKey??"settingsRecordFull")}
                    ${d("chevron-right")}
                  </span>
                </div>
                <div class="record-desc ${this._recordMode!=="off"?"record-warn":""}"
                  style="font-size:var(--font-xs);color:var(--text-muted);line-height:1.5;padding:0 16px 14px;">
                  ${e(m(this._recordMode).descKey)}
                </div>

                <!-- Auth section (HTTP/File) -->
                ${this.tunnelType==="http"||this.tunnelType==="file"?i`
                    <div class="switch-row" style="border-bottom:none;">
                      <span class="switch-label">${e("switchBasicAuth")}</span>
                      <div class="switch ${this._showAuth?"on":""}"
                        @click=${()=>{this._showAuth=!this._showAuth,this._showAuth||(this._username="",this._password="")}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>

                    ${this._showAuth?i`
                        <div class="form-group" style="margin-top:12px;">
                          <label class="form-label">${e("fieldUsername")}</label>
                          <input class="form-input" .value=${this._username} placeholder="admin"
                            @input=${a=>{this._username=a.target.value}}>
                        </div>
                        <div class="form-group">
                          <label class="form-label">${e("fieldPassword")}</label>
                          <div class="password-wrapper">
                            <input class="form-input" type=${this._showPassword?"text":"password"}
                              .value=${this._password} placeholder="••••"
                              @input=${a=>{this._password=a.target.value}}>
                            <button type="button" class="password-toggle"
                              @click=${()=>{this._showPassword=!this._showPassword}}
                              title=${this._showPassword?e("hidePassword"):e("showPassword")}>
                              ${d(this._showPassword?"eye-off":"eye")}
                            </button>
                          </div>
                        </div>
                      `:""}

                    ${this.tunnelType==="file"?i`
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
                ${this.mode==="edit"?i`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" title="${e("btnDelete")}" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${d("trash")}
                      </button>
                    </div>
                  `:""}
              </div>
            </div>
          `:""}

        ${this._snackbar?i`<div class="toast">${this._snackbar}</div>`:""}

        ${this._showResetDialog?i`
            <div class="dialog-overlay" @click=${()=>{this._showResetDialog=!1}}>
              <div class="dialog-box" @click=${a=>a.stopPropagation()}>
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
              <div class="dialog-box" @click=${a=>a.stopPropagation()}>
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
    `}};n.styles=P`
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

    .record-warn {
      color: var(--red) !important;
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
  `;r([_()],n.prototype,"tunnelType",2);r([_()],n.prototype,"tunnelId",2);r([l()],n.prototype,"mode",2);r([l()],n.prototype,"_tunnel",2);r([l()],n.prototype,"_saving",2);r([l()],n.prototype,"_snackbar",2);r([l()],n.prototype,"_showDeleteDialog",2);r([l()],n.prototype,"_showResetDialog",2);r([l()],n.prototype,"_name",2);r([l()],n.prototype,"_endpoint",2);r([l()],n.prototype,"_hostname",2);r([l()],n.prototype,"_prefix",2);r([l()],n.prototype,"_username",2);r([l()],n.prototype,"_password",2);r([l()],n.prototype,"_enableTLS",2);r([l()],n.prototype,"_rewriteHost",2);r([l()],n.prototype,"_fileUpload",2);r([l()],n.prototype,"_showAuth",2);r([l()],n.prototype,"_showPassword",2);r([l()],n.prototype,"_recordMode",2);n=r([E("tunnel-detail-page")],n);export{n as TunnelDetailPage};
