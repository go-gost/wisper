const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-C17mvF4N.js","assets/index-NRZDUYqM.css"])))=>i.map(i=>d[i]);
import{i as _,a as y,c as s,b as a,t as x,s as S,g as T,_ as g,r as z,m as C,n as U,o as L,k as P,p as A}from"./index-C17mvF4N.js";import{n as c,r as d}from"./state-k6skofj7.js";import{f as w,a as m,b as $}from"./stats-row-B4GZDSEi.js";import{c as k}from"./clipboard-C3x8_sid.js";import"./app-scaffold-DRHJfar-.js";var E=Object.defineProperty,F=Object.getOwnPropertyDescriptor,v=(t,e,n,r)=>{for(var i=r>1?void 0:r?F(e,n):e,p=t.length-1,h;p>=0;p--)(h=t[p])&&(i=(r?h(e,n,i):h(i))||i);return r&&i&&E(e,n,i),i};let b=class extends y{constructor(){super(...arguments),this.directory="",this.basicAuth=!1,this.username="",this.password="",this.fileUpload=!1,this.disabled=!1}_fireChange(){this.dispatchEvent(new CustomEvent("field-change",{detail:{directory:this.directory,basicAuth:this.basicAuth,username:this.username,password:this.password,fileUpload:this.fileUpload},bubbles:!0,composed:!0}))}render(){return a`
      <div class="fields">
        <div class="field">
          <label>${s("fieldDirectory")}</label>
          <input type="text" .value=${this.directory} ?disabled=${this.disabled}
            @input=${t=>{this.directory=t.target.value,this._fireChange()}}>
        </div>
        <div class="switch-row">
          <span class="switch-label">${s("switchBasicAuth")}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.basicAuth} ?disabled=${this.disabled}
              @change=${t=>{this.basicAuth=t.target.checked,this._fireChange(),this.requestUpdate()}}>
            <span class="slider"></span>
          </label>
        </div>
        ${this.basicAuth?a`
          <div class="field">
            <label>${s("fieldUsername")}</label>
            <input type="text" .value=${this.username} ?disabled=${this.disabled}
              @input=${t=>{this.username=t.target.value,this._fireChange()}}>
          </div>
          <div class="field">
            <label>${s("fieldPassword")}</label>
            <input type="password" .value=${this.password} ?disabled=${this.disabled}
              @input=${t=>{this.password=t.target.value,this._fireChange()}}>
          </div>
        `:""}
        <div class="switch-row">
          <span class="switch-label">${s("switchFileUpload")}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.fileUpload} ?disabled=${this.disabled}
              @change=${t=>{this.fileUpload=t.target.checked,this._fireChange()}}>
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `}};b.styles=_`
    .fields {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .field { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 13px; font-weight: 500; color: var(--color-text-secondary); }
    input {
      padding: 10px 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text-primary);
      font-size: 14px;
      font-family: inherit;
      transition: border-color var(--transition-fast);
    }
    input:focus { border-color: var(--color-primary); outline: none; }
    input:disabled { opacity: 0.6; }

    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .switch-label { font-size: 14px; color: var(--color-text-primary); }
    .switch {
      position: relative;
      width: 44px;
      height: 24px;
    }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute;
      inset: 0;
      background: var(--color-border);
      border-radius: 12px;
      cursor: pointer;
      transition: var(--transition-fast);
    }
    .slider::before {
      content: '';
      position: absolute;
      width: 18px;
      height: 18px;
      left: 3px;
      bottom: 3px;
      background: white;
      border-radius: 50%;
      transition: var(--transition-fast);
    }
    input:checked + .slider { background: var(--color-primary); }
    input:checked + .slider::before { transform: translateX(20px); }
    input:disabled + .slider { opacity: 0.5; cursor: not-allowed; }
  `;v([c()],b.prototype,"directory",2);v([c({type:Boolean})],b.prototype,"basicAuth",2);v([c()],b.prototype,"username",2);v([c()],b.prototype,"password",2);v([c({type:Boolean})],b.prototype,"fileUpload",2);v([c({type:Boolean})],b.prototype,"disabled",2);b=v([x("file-form-fields")],b);var H=Object.defineProperty,O=Object.getOwnPropertyDescriptor,f=(t,e,n,r)=>{for(var i=r>1?void 0:r?O(e,n):e,p=t.length-1,h;p>=0;p--)(h=t[p])&&(i=(r?h(e,n,i):h(i))||i);return r&&i&&H(e,n,i),i};let u=class extends y{constructor(){super(...arguments),this.hostname="",this.rewriteHost=!1,this.enableTLS=!1,this.disabled=!1}render(){return a`
      <div class="fields">
        <div class="switch-row">
          <span class="switch-label">${s("switchRewriteHost")}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.rewriteHost} ?disabled=${this.disabled}
              @change=${t=>{this.rewriteHost=t.target.checked,this.requestUpdate()}}>
            <span class="slider"></span>
          </label>
        </div>
        ${this.rewriteHost?a`
          <div class="field">
            <label>${s("fieldHostname")}</label>
            <input type="text" .value=${this.hostname} ?disabled=${this.disabled}
              @input=${t=>{this.hostname=t.target.value}}>
          </div>
        `:""}
        <div class="switch-row">
          <span class="switch-label">${s("switchEnableTLS")}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.enableTLS} ?disabled=${this.disabled}
              @change=${t=>{this.enableTLS=t.target.checked}}>
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `}};u.styles=_`
    .fields { display: flex; flex-direction: column; gap: 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 13px; font-weight: 500; color: var(--color-text-secondary); }
    input {
      padding: 10px 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text-primary);
      font-size: 14px;
      font-family: inherit;
      transition: border-color var(--transition-fast);
    }
    input:focus { border-color: var(--color-primary); outline: none; }
    input:disabled { opacity: 0.6; }
    .switch-row { display: flex; align-items: center; justify-content: space-between; }
    .switch-label { font-size: 14px; color: var(--color-text-primary); }
    .switch { position: relative; width: 44px; height: 24px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; inset: 0; background: var(--color-border);
      border-radius: 12px; cursor: pointer; transition: var(--transition-fast);
    }
    .slider::before {
      content: ''; position: absolute; width: 18px; height: 18px;
      left: 3px; bottom: 3px; background: white; border-radius: 50%;
      transition: var(--transition-fast);
    }
    input:checked + .slider { background: var(--color-primary); }
    input:checked + .slider::before { transform: translateX(20px); }
    input:disabled + .slider { opacity: 0.5; cursor: not-allowed; }
  `;f([c()],u.prototype,"hostname",2);f([c({type:Boolean})],u.prototype,"rewriteHost",2);f([c({type:Boolean})],u.prototype,"enableTLS",2);f([c({type:Boolean})],u.prototype,"disabled",2);u=f([x("http-form-fields")],u);var D=Object.defineProperty,I=Object.getOwnPropertyDescriptor,l=(t,e,n,r)=>{for(var i=r>1?void 0:r?I(e,n):e,p=t.length-1,h;p>=0;p--)(h=t[p])&&(i=(r?h(e,n,i):h(i))||i);return r&&i&&D(e,n,i),i};let o=class extends y{constructor(){super(...arguments),this.tunnelType="tcp",this.tunnelId="",this.mode="view",this._tunnel=null,this._saving=!1,this._snackbar="",this._name="",this._endpoint="",this._hostname="",this._username="",this._password="",this._basicAuth=!1,this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1,this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(S(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.tunnelId;if(t==="new"||!t){this.mode="create",this._tunnel=null,this._name="",this._endpoint="",this._hostname="",this._username="",this._password="",this._basicAuth=!1,this._enableTLS=!1,this._rewriteHost=!1,this._fileUpload=!1;return}const e=T().find(n=>n.id===t);e&&(this._tunnel=e,this.mode!=="edit"&&this._populateForm(e))}_populateForm(t){this._name=t.name,this._endpoint=t.endpoint,this._hostname=t.options.hostname??"",this._username=t.options.username??"",this._password=t.options.password??"",this._basicAuth=t.options.basic_auth??!1,this._enableTLS=t.options.enableTLS??!1,this._rewriteHost=t.options.rewriteHost??!1,this._fileUpload=t.options.file_upload??!1}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._tunnel&&this._populateForm(this._tunnel),this.mode="edit"}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},3e3)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(s("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.tunnelType,endpoint:this._endpoint.trim(),hostname:this._hostname.trim()||void 0,username:this._username.trim()||void 0,password:this._password||void 0,enableTLS:this._enableTLS,rewriteHost:this._rewriteHost,file_upload:this._fileUpload};this.mode==="create"?(await g(()=>import("./index-C17mvF4N.js").then(e=>e.C),__vite__mapDeps([0,1])).then(e=>e.create(t)),this._showSnackbar(s("saved")),this._navigate("/")):(await g(()=>import("./index-C17mvF4N.js").then(e=>e.C),__vite__mapDeps([0,1])).then(e=>e.update(this.tunnelId,t)),this._showSnackbar(s("saved")),this.mode="view",await z())}catch(t){const e=t instanceof Error?t.message:"";this._showSnackbar(`${s("saveFailed")}${e?": "+e:""}`)}this._saving=!1}async _handleDelete(){if(confirm(s("deleteConfirmMessage")))try{await C(this.tunnelId),this._showSnackbar(s("deleted")),this._navigate("/")}catch{this._showSnackbar(s("deleteFailed"))}}async _handleStart(){try{await U(this.tunnelId),this._showSnackbar(s("started"))}catch{this._showSnackbar(s("startFailed"))}}async _handleStop(){try{await L(this.tunnelId),this._showSnackbar(s("stopped"))}catch{this._showSnackbar(s("stopFailed"))}}async _handleFavorite(){await P(this.tunnelId)}render(){const t=this._tunnel,e=t?A(t.id)??t.stats:null,n=this.tunnelType.charAt(0).toUpperCase()+this.tunnelType.slice(1);return a`
      <app-scaffold>
        <div slot="appBar" class="title-row">
          <button class="back-btn" @click=${()=>this._navigate("/")}>←</button>
          <span class="page-title">${this.mode==="create"?`${s("tunnelNewTitle")} — ${n}`:n}</span>
          <div class="actions">
            ${this.mode==="view"&&t?a`
              <button class="btn" @click=${this._handleFavorite}>${t.favorite?"★":"☆"}</button>
              ${t.status==="running"?a`<button class="btn stop" @click=${this._handleStop}>${s("btnStop")}</button>`:a`<button class="btn start" @click=${this._handleStart}>${s("btnStart")}</button>`}
              <button class="btn" @click=${this._enterEdit}>${s("btnEdit")}</button>
              <button class="btn danger" @click=${this._handleDelete}>${s("btnDelete")}</button>
            `:a`
              <button class="btn primary" ?disabled=${this._saving} @click=${this._handleSave}>
                ${this._saving?"...":s("btnSave")}
              </button>
            `}
          </div>
        </div>

        ${this.mode==="view"&&t?a`
          <!-- View mode -->
          ${t.error?a`<div class="error-banner">${t.error}</div>`:""}

          <div class="section">
            <div class="section-title">${s("fieldEndpoint")}</div>
            <div class="copy-field">
              <code>${t.id}</code>
              <button class="icon-btn" @click=${async()=>{await k(t.id),this._showSnackbar(s("copiedToClipboard"))}}>📋</button>
            </div>
            <div class="copy-field">
              <code>${t.entrypoint}</code>
              <button class="icon-btn" @click=${async()=>{await k(t.entrypoint),this._showSnackbar(s("copiedToClipboard"))}}>📋</button>
            </div>
          </div>

          <div class="section">
            <div class="section-title">${s("labelStatistics")}</div>
            ${e?a`
              <div class="stats-grid">
                <div class="stat-badge"><div class="val">${w(e.current_conns)}</div><div class="rate">${m(e.request_rate)}</div></div>
                <div class="stat-badge"><div class="val">${w(e.total_conns)}</div><div class="rate">total</div></div>
                <div class="stat-badge"><div class="val">${$(e.input_bytes)}</div><div class="rate">${m(e.input_rate_bytes)}</div></div>
                <div class="stat-badge"><div class="val">${$(e.output_bytes)}</div><div class="rate">${m(e.output_rate_bytes)}</div></div>
              </div>
            `:a`<div style="color:var(--color-text-muted);font-size:13px;">Loading...</div>`}
          </div>

          <!-- Read-only fields -->
          <div class="section">
            <div class="field"><label>${s("fieldName")}</label><input type="text" .value=${t.name} readonly></div>
            ${this.tunnelType!=="file"?a`<div class="field"><label>${s("fieldEndpoint")}</label><input type="text" .value=${t.endpoint} readonly></div>`:""}
          </div>
        `:a`
          <!-- Edit/Create mode -->
          <div class="section">
            <div class="field">
              <label>${s("fieldName")} *</label>
              <input type="text" .value=${this._name} @input=${r=>{this._name=r.target.value}}>
            </div>
            ${this.tunnelType!=="file"?a`
              <div class="field">
                <label>${s("fieldEndpoint")}</label>
                <input type="text" .value=${this._endpoint} @input=${r=>{this._endpoint=r.target.value}}>
              </div>
            `:""}

            ${this.tunnelType==="file"?a`
              <file-form-fields
                .directory=${this._name}
                .basicAuth=${this._basicAuth}
                .username=${this._username}
                .password=${this._password}
                .fileUpload=${this._fileUpload}
              ></file-form-fields>
            `:""}

            ${this.tunnelType==="http"?a`
              <http-form-fields
                .rewriteHost=${this._rewriteHost}
                .hostname=${this._hostname}
                .enableTLS=${this._enableTLS}
              ></http-form-fields>
            `:""}
          </div>
        `}

        ${this._snackbar?a`<div class="snackbar">${this._snackbar}</div>`:""}
      </app-scaffold>
    `}};o.styles=_`
    .title-row { display: flex; align-items: center; gap: 8px; }
    .back-btn {
      background: none; border: none; cursor: pointer; font-size: 18px;
      padding: 4px; color: var(--color-text-secondary); border-radius: 50%;
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
    }
    .back-btn:hover { background: var(--color-surface-hover); }
    .page-title { font-size: 18px; font-weight: 600; flex: 1; }
    .actions { display: flex; gap: 6px; }

    .btn {
      padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-pill);
      font-size: 13px; font-weight: 500; cursor: pointer; transition: all var(--transition-fast);
      background: var(--color-surface); color: var(--color-text-primary);
    }
    .btn:hover { background: var(--color-surface-hover); }
    .btn.primary { background: var(--color-primary); color: var(--color-primary-text); border-color: var(--color-primary); }
    .btn.primary:hover { background: var(--color-primary-hover); }
    .btn.danger { color: var(--color-error); border-color: var(--color-error); }
    .btn.danger:hover { background: var(--color-error-bg); }
    .btn.start { color: var(--color-running); border-color: var(--color-running); }
    .btn.stop { color: var(--color-error); border-color: var(--color-error); }

    .section { margin-top: 20px; }
    .section-title { font-size: 14px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 10px; }

    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 13px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 4px; }
    .field input {
      width: 100%; padding: 10px 12px; border: 1px solid var(--color-border);
      border-radius: var(--radius-sm); background: var(--color-surface);
      color: var(--color-text-primary); font-size: 14px; font-family: inherit;
      box-sizing: border-box; transition: border-color var(--transition-fast);
    }
    .field input:focus { border-color: var(--color-primary); outline: none; }
    .field input:read-only { background: var(--color-surface-hover); color: var(--color-text-secondary); }

    .copy-field {
      display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
    }
    .copy-field code {
      flex: 1; padding: 8px 12px; background: var(--color-surface-hover);
      border-radius: var(--radius-sm); font-size: 13px; font-family: monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--color-text-primary);
    }
    .icon-btn {
      background: none; border: none; cursor: pointer; font-size: 16px;
      padding: 6px; border-radius: var(--radius-sm); color: var(--color-text-muted);
    }
    .icon-btn:hover { background: var(--color-surface-hover); color: var(--color-text-primary); }

    .stats-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 12px; margin-top: 12px;
    }
    .stat-badge {
      padding: 10px 12px; background: var(--color-surface);
      border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      font-size: 12px; color: var(--color-text-secondary);
    }
    .stat-badge .val { font-weight: 600; color: var(--color-text-primary); font-size: 15px; }
    .stat-badge .rate { font-size: 11px; color: var(--color-text-muted); }

    .error-banner {
      padding: 12px; background: var(--color-error-bg); border-radius: var(--radius-sm);
      font-size: 13px; color: var(--color-error); margin-top: 12px;
    }

    .snackbar {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      padding: 10px 20px; background: #333; color: white;
      border-radius: var(--radius-pill); font-size: 13px;
      z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: snackIn 0.3s ease;
    }
    @keyframes snackIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } }
  `;l([c()],o.prototype,"tunnelType",2);l([c()],o.prototype,"tunnelId",2);l([d()],o.prototype,"mode",2);l([d()],o.prototype,"_tunnel",2);l([d()],o.prototype,"_saving",2);l([d()],o.prototype,"_snackbar",2);l([d()],o.prototype,"_name",2);l([d()],o.prototype,"_endpoint",2);l([d()],o.prototype,"_hostname",2);l([d()],o.prototype,"_username",2);l([d()],o.prototype,"_password",2);l([d()],o.prototype,"_basicAuth",2);l([d()],o.prototype,"_enableTLS",2);l([d()],o.prototype,"_rewriteHost",2);l([d()],o.prototype,"_fileUpload",2);o=l([x("tunnel-detail-page")],o);export{o as TunnelDetailPage};
