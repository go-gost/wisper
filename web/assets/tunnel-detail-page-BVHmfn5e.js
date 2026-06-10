const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-DvIQLlSN.js","assets/index-NRZDUYqM.css"])))=>i.map(i=>d[i]);
import{i as g,a as w,c as a,b as n,t as x,s as S,g as T,_ as y,r as z,k as D,l as C,m as E,n as P,o as U}from"./index-DvIQLlSN.js";import{n as d,r as p}from"./app-scaffold-D-01mgFn.js";import{f as _,a as v,b as $}from"./format-DfcOH1_a.js";import{c as k}from"./stats-row-DhP0A-6Q.js";var A=Object.defineProperty,F=Object.getOwnPropertyDescriptor,f=(t,e,r,s)=>{for(var o=s>1?void 0:s?F(e,r):e,c=t.length-1,h;c>=0;c--)(h=t[c])&&(o=(s?h(e,r,o):h(o))||o);return s&&o&&A(e,r,o),o};let b=class extends w{constructor(){super(...arguments),this.directory="",this.basicAuth=!1,this.username="",this.password="",this.fileUpload=!1,this.disabled=!1}_fireChange(){this.dispatchEvent(new CustomEvent("field-change",{detail:{directory:this.directory,basicAuth:this.basicAuth,username:this.username,password:this.password,fileUpload:this.fileUpload},bubbles:!0,composed:!0}))}_togglePassword(t){const e=t.target,r=e.parentElement.querySelector(".form-input");r.type==="password"?(r.type="text",e.textContent="🙈"):(r.type="password",e.textContent="👁")}render(){return n`
      <div class="fields">
        <div class="form-group">
          <label class="form-label">${a("fieldDirectory")}</label>
          <input class="form-input" type="text" .value=${this.directory} ?disabled=${this.disabled}
            placeholder="Select directory"
            @input=${t=>{this.directory=t.target.value,this._fireChange()}}>
        </div>

        <div class="switch-row">
          <span class="switch-label">${a("switchBasicAuth")}</span>
          <div class="switch ${this.basicAuth?"on":""}" @click=${()=>{this.disabled||(this.basicAuth=!this.basicAuth,this._fireChange(),this.requestUpdate())}}>
            <div class="switch-knob"></div>
          </div>
        </div>

        <div class="auth-field ${this.basicAuth?"visible":"hidden"}">
          <div class="form-group">
            <label class="form-label">${a("fieldUsername")}</label>
            <input class="form-input" type="text" .value=${this.username} ?disabled=${this.disabled}
              placeholder="Enter username"
              @input=${t=>{this.username=t.target.value,this._fireChange()}}>
          </div>
          <div class="form-group">
            <label class="form-label">${a("fieldPassword")}</label>
            <div class="password-wrapper">
              <input class="form-input" type="password" .value=${this.password} ?disabled=${this.disabled}
                placeholder="Enter password"
                @input=${t=>{this.password=t.target.value,this._fireChange()}}>
              <button class="password-toggle" @click=${this._togglePassword}>👁</button>
            </div>
          </div>
        </div>

        <div class="switch-row">
          <span class="switch-label">${a("switchFileUpload")}</span>
          <div class="switch ${this.fileUpload?"on":""}" @click=${()=>{this.disabled||(this.fileUpload=!this.fileUpload,this._fireChange(),this.requestUpdate())}}>
            <div class="switch-knob"></div>
          </div>
        </div>
      </div>
    `}};b.styles=g`
    .fields {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .form-group { margin-bottom: 8px; }
    .form-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--color-stopped);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid var(--color-input-border);
      border-radius: var(--radius-md);
      background: var(--color-input-bg);
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color var(--transition-fast), background var(--transition-fast);
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--color-primary); }
    .form-input:disabled { opacity: 0.6; }

    /* ── Password wrapper ── */
    .password-wrapper {
      position: relative;
    }
    .password-wrapper .form-input { padding-right: 40px; }
    .password-toggle {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer;
      font-size: 1.1rem; color: var(--color-stopped);
    }

    /* ── Switch ── */
    .switch-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0;
    }
    .switch-label { font-size: 0.95rem; }
    .switch {
      width: 44px; height: 24px; border-radius: 12px;
      background: var(--color-stopped); position: relative;
      cursor: pointer; transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch.on { background: var(--color-primary); }
    .switch-knob {
      width: 20px; height: 20px; border-radius: 50%;
      background: white; position: absolute;
      top: 2px; left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .switch.on .switch-knob { left: 22px; }

    /* ── Auth fields show/hide ── */
    .auth-field {
      overflow: hidden;
      transition: max-height .3s ease, opacity .3s ease, margin .3s ease;
    }
    .auth-field.hidden {
      max-height: 0; opacity: 0; margin-bottom: 0; pointer-events: none;
    }
    .auth-field.visible {
      max-height: 100px; opacity: 1;
    }
  `;f([d()],b.prototype,"directory",2);f([d({type:Boolean})],b.prototype,"basicAuth",2);f([d()],b.prototype,"username",2);f([d()],b.prototype,"password",2);f([d({type:Boolean})],b.prototype,"fileUpload",2);f([d({type:Boolean})],b.prototype,"disabled",2);b=f([x("file-form-fields")],b);var H=Object.defineProperty,L=Object.getOwnPropertyDescriptor,m=(t,e,r,s)=>{for(var o=s>1?void 0:s?L(e,r):e,c=t.length-1,h;c>=0;c--)(h=t[c])&&(o=(s?h(e,r,o):h(o))||o);return s&&o&&H(e,r,o),o};let u=class extends w{constructor(){super(...arguments),this.hostname="",this.rewriteHost=!1,this.enableTLS=!1,this.disabled=!1}render(){return n`
      <div class="fields">
        <div class="switch-row">
          <span class="switch-label">${a("switchRewriteHost")}</span>
          <div class="switch ${this.rewriteHost?"on":""}" @click=${()=>{this.disabled||(this.rewriteHost=!this.rewriteHost,this.requestUpdate())}}>
            <div class="switch-knob"></div>
          </div>
        </div>

        ${this.rewriteHost?n`
          <div class="form-group">
            <label class="form-label">${a("fieldHostname")}</label>
            <input class="form-input" type="text" .value=${this.hostname} ?disabled=${this.disabled}
              @input=${t=>{this.hostname=t.target.value}}>
          </div>
        `:""}

        <div class="switch-row">
          <span class="switch-label">${a("switchEnableTLS")}</span>
          <div class="switch ${this.enableTLS?"on":""}" @click=${()=>{this.disabled||(this.enableTLS=!this.enableTLS)}}>
            <div class="switch-knob"></div>
          </div>
        </div>
      </div>
    `}};u.styles=g`
    .fields { display: flex; flex-direction: column; gap: 8px; }

    .form-group { margin-bottom: 8px; }
    .form-label {
      display: block;
      font-size: 0.8rem; font-weight: 500;
      color: var(--color-stopped);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid var(--color-input-border);
      border-radius: var(--radius-md);
      background: var(--color-input-bg);
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color var(--transition-fast), background var(--transition-fast);
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--color-primary); }
    .form-input:disabled { opacity: 0.6; }

    .switch-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0;
    }
    .switch-label { font-size: 0.95rem; }
    .switch {
      width: 44px; height: 24px; border-radius: 12px;
      background: var(--color-stopped); position: relative;
      cursor: pointer; transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch.on { background: var(--color-primary); }
    .switch-knob {
      width: 20px; height: 20px; border-radius: 50%;
      background: white; position: absolute;
      top: 2px; left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .switch.on .switch-knob { left: 22px; }
  `;m([d()],u.prototype,"hostname",2);m([d({type:Boolean})],u.prototype,"rewriteHost",2);m([d({type:Boolean})],u.prototype,"enableTLS",2);m([d({type:Boolean})],u.prototype,"disabled",2);u=m([x("http-form-fields")],u);var O=Object.defineProperty,B=Object.getOwnPropertyDescriptor,l=(t,e,r,s)=>{for(var o=s>1?void 0:s?B(e,r):e,c=t.length-1,h;c>=0;c--)(h=t[c])&&(o=(s?h(e,r,o):h(o))||o);return s&&o&&O(e,r,o),o};let i=class extends w{constructor(){super(...arguments),this.tunnelType="tcp",this.tunnelId="",this.mode="view",this._tunnel=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._name="",this._endpoint="",this._hostname="",this._username="",this._password="",this._basicAuth=!1,this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1,this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(S(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.tunnelId;if(t==="new"||!t){this.mode="create",this._tunnel=null,this._name="",this._endpoint="",this._hostname="",this._username="",this._password="",this._basicAuth=!1,this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1;return}const e=T().find(r=>r.id===t);e&&(this._tunnel=e,this.mode!=="edit"&&this._populateForm(e))}_populateForm(t){this._name=t.name,this._endpoint=t.endpoint,this._hostname=t.options.hostname??"",this._username=t.options.username??"",this._password=t.options.password??"",this._basicAuth=t.options.basic_auth??!1,this._enableTLS=t.options.enableTLS??!1,this._rewriteHost=t.options.rewriteHost??!1,this._fileUpload=t.options.file_upload??!1}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._tunnel&&this._populateForm(this._tunnel),this.mode="edit"}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},3e3)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(a("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.tunnelType,endpoint:this._endpoint.trim(),hostname:this._hostname.trim()||void 0,username:this._username.trim()||void 0,password:this._password||void 0,enableTLS:this._enableTLS,rewriteHost:this._rewriteHost,file_upload:this._fileUpload};this.mode==="create"?(await y(()=>import("./index-DvIQLlSN.js").then(e=>e.C),__vite__mapDeps([0,1])).then(e=>e.create(t)),this._showSnackbar(a("saved")),this._navigate("/")):(await y(()=>import("./index-DvIQLlSN.js").then(e=>e.C),__vite__mapDeps([0,1])).then(e=>e.update(this.tunnelId,t)),this._showSnackbar(a("saved")),this.mode="view",await z())}catch(t){const e=t instanceof Error?t.message:"";this._showSnackbar(`${a("saveFailed")}${e?": "+e:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await D(this.tunnelId),this._showSnackbar(a("deleted")),this._navigate("/")}catch{this._showSnackbar(a("deleteFailed"))}}async _handleStart(){try{await C(this.tunnelId),this._showSnackbar(a("started"))}catch{this._showSnackbar(a("startFailed"))}}async _handleStop(){try{await E(this.tunnelId),this._showSnackbar(a("stopped"))}catch{this._showSnackbar(a("stopFailed"))}}async _handleFavorite(){await P(this.tunnelId)}render(){const t=this._tunnel,e=t?U(t.id)??t.stats:null,r=this.tunnelType.charAt(0).toUpperCase()+this.tunnelType.slice(1);return n`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>←</button>
          <span class="page-title">${this.mode==="create"?`${a("tunnelNewTitle")} — ${r}`:r}</span>

          ${this.mode==="view"&&t?n`
            <button class="fav-btn ${t.favorite?"active":"inactive"}" @click=${this._handleFavorite}>★</button>
            ${t.status==="running"?n`<button class="stop-btn" @click=${this._handleStop}>■ ${a("btnStop")}</button>`:n`<button class="primary-btn" @click=${this._handleStart}>▶ ${a("btnStart")}</button>`}
            <button class="danger-btn" @click=${()=>{this._showDeleteDialog=!0}}>🗑</button>
            <button class="appbar-btn" @click=${this._enterEdit}>✏ ${a("btnEdit")}</button>
          `:n`
            <button class="primary-btn" ?disabled=${this._saving} @click=${this._handleSave}>
              ✓ ${a("btnSave")}
            </button>
          `}
        </div>

        ${this.mode==="view"&&t?n`
          <!-- Error banner -->
          ${t.error?n`<div class="error-banner">${t.error}</div>`:""}

          <!-- View mode -->
          <div class="detail-section">
            <div class="detail-card">
              <!-- Copyable ID -->
              <div class="copyable-row">
                <span class="copyable-text">${t.id}</span>
                <button class="copy-btn" @click=${async()=>{await k(t.id),this._showSnackbar("📋 "+a("copiedToClipboard"))}}>📋</button>
              </div>
              <!-- Copyable Entrypoint -->
              <div class="copyable-row">
                <span class="copyable-text">${t.entrypoint}</span>
                <button class="copy-btn" @click=${async()=>{await k(t.entrypoint),this._showSnackbar("📋 "+a("copiedToClipboard"))}}>📋</button>
              </div>

              <!-- Name (read-only) -->
              <div class="form-group">
                <label class="form-label">${a("fieldName")}</label>
                <input class="form-input" readonly .value=${t.name}>
              </div>
              <!-- Endpoint (read-only) -->
              ${this.tunnelType!=="file"?n`
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label">${a("fieldEndpoint")}</label>
                  <input class="form-input" readonly .value=${t.endpoint}>
                </div>
              `:""}
            </div>

            <!-- Stats -->
            ${e?n`
              <div class="stats-section">
                <div class="detail-card">
                  <div class="stats-title">${a("labelStatistics")}</div>
                  <div class="stats-badges">
                    <span class="stats-badge">↕ ${_(e.current_conns)} / ${_(e.total_conns)} connections</span>
                    <span class="stats-badge">⚡ ${v(e.request_rate)}</span>
                  </div>
                  <stats-row icon="↑" .value=${$(e.input_bytes)+" total"} .rate=${v(e.input_rate_bytes)}></stats-row>
                  <stats-row icon="↓" .value=${$(e.output_bytes)+" total"} .rate=${v(e.output_rate_bytes)}></stats-row>
                </div>
              </div>
            `:""}
          </div>
        `:n`
          <!-- Edit/Create mode -->
          <div class="detail-section">
            <div class="detail-card">
              <div class="form-group">
                <label class="form-label">${a("fieldName")}</label>
                <input class="form-input" .value=${this._name} placeholder="Enter tunnel name"
                  @input=${s=>{this._name=s.target.value}}>
              </div>
              ${this.tunnelType!=="file"?n`
                <div class="form-group">
                  <label class="form-label">${a("fieldEndpoint")}</label>
                  <input class="form-input" .value=${this._endpoint}
                    placeholder=${this.tunnelType==="http"?"http://host:port":"host:port"}
                    @input=${s=>{this._endpoint=s.target.value}}>
                </div>
              `:""}

              ${this.tunnelType==="file"?n`
                <file-form-fields
                  .directory=${this._endpoint}
                  .basicAuth=${this._basicAuth}
                  .username=${this._username}
                  .password=${this._password}
                  .fileUpload=${this._fileUpload}
                ></file-form-fields>
              `:""}

              ${this.tunnelType==="http"?n`
                <http-form-fields
                  .rewriteHost=${this._rewriteHost}
                  .hostname=${this._hostname}
                  .enableTLS=${this._enableTLS}
                ></http-form-fields>
              `:""}
            </div>
          </div>
        `}

        ${this._snackbar?n`<div class="toast">${this._snackbar}</div>`:""}

        ${this._showDeleteDialog?n`
          <div class="dialog-overlay" @click=${()=>{this._showDeleteDialog=!1}}>
            <div class="dialog-box" @click=${s=>{s.stopPropagation()}}>
              <div class="dialog-title">${a("deleteConfirmTitle")}</div>
              <div class="dialog-message">${a("deleteConfirmMessage")}</div>
              <div class="dialog-actions">
                <button class="dialog-btn cancel" @click=${()=>{this._showDeleteDialog=!1}}>${a("btnCancel")}</button>
                <button class="dialog-btn danger" @click=${this._handleDelete}>${a("btnDelete")}</button>
              </div>
            </div>
          </div>
        `:""}
      </app-scaffold>
    `}};i.styles=g`
    /* ── AppBar ── */
    .back-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.3rem; color: var(--color-text-primary); padding: 4px 8px;
      border-radius: 8px; display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--color-surface-variant); }

    .page-title { font-size: 1.15rem; font-weight: 600; flex: 1; }

    /* Buttons matching prototype */
    .appbar-btn {
      background: none; border: none; cursor: pointer;
      padding: 6px 10px; border-radius: 8px; color: var(--color-text-primary);
      font-size: 0.9rem; display: flex; align-items: center; gap: 4px;
      transition: background var(--transition-fast);
      font-family: inherit;
    }
    .appbar-btn:hover { background: var(--color-surface-variant); }

    .primary-btn {
      background: var(--color-primary); color: var(--color-primary-text);
      border-radius: 20px; padding: 6px 16px; font-weight: 500;
      border: none; cursor: pointer; font-size: 0.9rem; font-family: inherit;
      transition: background var(--transition-fast);
    }
    .primary-btn:hover { opacity: 0.9; }

    .stop-btn {
      background: var(--color-error); color: white;
      border-radius: 20px; padding: 6px 16px; font-weight: 500;
      border: none; cursor: pointer; font-size: 0.9rem; font-family: inherit;
      transition: background var(--transition-fast);
    }
    .stop-btn:hover { opacity: 0.9; }

    .danger-btn {
      color: var(--color-error);
      background: none; border: none; cursor: pointer;
      padding: 6px 10px; border-radius: 8px;
      font-size: 0.9rem; font-family: inherit;
    }
    .danger-btn:hover { background: var(--color-error-bg); }

    .fav-btn {
      font-size: 1.1rem; transition: color var(--transition-fast), transform 0.15s;
      background: none; border: none; cursor: pointer; padding: 6px 10px;
      border-radius: 8px; display: flex; align-items: center;
    }
    .fav-btn.active { color: var(--color-fav); }
    .fav-btn.inactive { color: var(--color-fav-off); }
    .fav-btn:active { transform: scale(1.3); }

    /* ── Detail Section ── */
    .detail-section {
      margin: 16px;
    }

    .detail-card {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-card);
      padding: 20px;
      transition: background var(--transition-fast);
    }

    /* ── Copyable rows ── */
    .copyable-row {
      display: flex; align-items: center;
      padding: 8px 12px;
      background: var(--color-surface-variant);
      border-radius: var(--radius-md);
      margin-bottom: 10px;
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.85rem;
      word-break: break-all;
      gap: 8px;
    }
    .copyable-text { flex: 1; }
    .copy-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1rem; color: var(--color-primary);
      padding: 4px; border-radius: 6px;
    }
    .copy-btn:hover { background: rgba(0,0,0,0.08); }

    /* ── Form fields ── */
    .form-group { margin-bottom: 16px; }
    .form-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--color-stopped);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid var(--color-input-border);
      border-radius: var(--radius-md);
      background: var(--color-input-bg);
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color var(--transition-fast), background var(--transition-fast);
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--color-primary); }
    .form-input[readonly] {
      background: transparent;
      border-color: transparent;
      cursor: default;
    }
    .form-input.error { border-color: var(--color-error); }
    .form-error {
      font-size: 0.8rem; color: var(--color-error); margin-top: 4px;
    }

    /* ── Stats ── */
    .stats-section { margin-top: 16px; }
    .stats-title { font-weight: 600; margin-bottom: 12px; font-size: 0.95rem; }

    .stats-badges {
      display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px;
    }
    .stats-badge {
      display: inline-flex; align-items: center; gap: 4px;
      background: var(--color-surface-variant);
      padding: 4px 10px; border-radius: 12px;
      font-size: 0.8rem; margin-right: 6px; margin-bottom: 4px;
    }

    /* ── Error banner ── */
    .error-banner {
      padding: 12px; background: var(--color-error-bg);
      border-radius: var(--radius-md); font-size: 0.85rem;
      color: var(--color-error); margin: 0 16px;
    }

    /* ── Toast (top, like prototype) ── */
    .toast {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: var(--color-toast-bg); color: var(--color-toast-fg);
      padding: 12px 24px; border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 0.9rem; z-index: 100;
      display: flex; align-items: center; gap: 8px;
      max-width: 400px; transition: background var(--transition-fast);
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* ── Delete Dialog Overlay ── */
    .dialog-overlay {
      position: fixed; inset: 0;
      background: var(--color-overlay);
      display: flex; align-items: center; justify-content: center;
      z-index: 200;
      animation: fade-in 0.2s ease;
    }
    @keyframes fade-in { from { opacity: 0; } }
    .dialog-box {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      padding: 24px; max-width: 340px; width: 90%;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .dialog-title { font-weight: 600; font-size: 1.1rem; margin-bottom: 12px; text-align: center; }
    .dialog-message { color: var(--color-stopped); font-size: 0.9rem; margin-bottom: 20px; text-align: center; line-height: 1.5; }
    .dialog-actions { display: flex; gap: 12px; justify-content: center; }
    .dialog-btn {
      padding: 10px 24px; border-radius: 20px; border: none;
      cursor: pointer; font-size: 0.9rem; font-weight: 500;
      transition: background var(--transition-fast);
      font-family: inherit;
    }
    .dialog-btn.cancel {
      background: var(--color-surface-variant); color: var(--color-text-primary);
    }
    .dialog-btn.danger {
      background: var(--color-error); color: white;
    }
    .dialog-btn:hover { opacity: 0.9; }
  `;l([d()],i.prototype,"tunnelType",2);l([d()],i.prototype,"tunnelId",2);l([p()],i.prototype,"mode",2);l([p()],i.prototype,"_tunnel",2);l([p()],i.prototype,"_saving",2);l([p()],i.prototype,"_snackbar",2);l([p()],i.prototype,"_showDeleteDialog",2);l([p()],i.prototype,"_name",2);l([p()],i.prototype,"_endpoint",2);l([p()],i.prototype,"_hostname",2);l([p()],i.prototype,"_username",2);l([p()],i.prototype,"_password",2);l([p()],i.prototype,"_basicAuth",2);l([p()],i.prototype,"_enableTLS",2);l([p()],i.prototype,"_rewriteHost",2);l([p()],i.prototype,"_fileUpload",2);i=l([x("tunnel-detail-page")],i);export{i as TunnelDetailPage};
