const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-C17mvF4N.js","assets/index-NRZDUYqM.css"])))=>i.map(i=>d[i]);
import{i as m,a as x,c as i,b as n,t as g,h as $,d as w,_ as f,q as k,u as S,v as z,w as C,l as T,p as E}from"./index-C17mvF4N.js";import{n as h,r as d}from"./state-k6skofj7.js";import{f as y,a as u,b as _}from"./stats-row-B4GZDSEi.js";import{c as F}from"./clipboard-C3x8_sid.js";import"./app-scaffold-DRHJfar-.js";var I=Object.defineProperty,P=Object.getOwnPropertyDescriptor,b=(t,e,s,r)=>{for(var a=r>1?void 0:r?P(e,s):e,c=t.length-1,p;c>=0;c--)(p=t[c])&&(a=(r?p(e,s,a):p(a))||a);return r&&a&&I(e,s,a),a};let v=class extends x{constructor(){super(...arguments),this.keepalive=!1,this.ttl=0,this.disabled=!1}render(){return n`
      <div class="fields">
        <div class="switch-row">
          <span class="switch-label">${i("switchKeepalive")}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.keepalive} ?disabled=${this.disabled}
              @change=${t=>{this.keepalive=t.target.checked}}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="field">
          <label>${i("fieldTTL")}</label>
          <input type="text" .value=${this.ttl>0?`${this.ttl}s`:""} ?disabled=${this.disabled}
            placeholder=${i("fieldTTLHint")}
            @input=${t=>{const e=t.target.value;this.ttl=parseInt(e)||0}}>
          <span class="hint">${i("fieldTTLHint")}</span>
        </div>
      </div>
    `}};v.styles=m`
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
    .hint { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
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
  `;b([h({type:Boolean})],v.prototype,"keepalive",2);b([h({type:Number})],v.prototype,"ttl",2);b([h({type:Boolean})],v.prototype,"disabled",2);v=b([g("entrypoint-form-fields")],v);var D=Object.defineProperty,O=Object.getOwnPropertyDescriptor,l=(t,e,s,r)=>{for(var a=r>1?void 0:r?O(e,s):e,c=t.length-1,p;c>=0;c--)(p=t[c])&&(a=(r?p(e,s,a):p(a))||a);return r&&a&&D(e,s,a),a};let o=class extends x{constructor(){super(...arguments),this.entrypointType="tcp",this.entrypointId="",this.mode="view",this._entrypoint=null,this._saving=!1,this._snackbar="",this._name="",this._endpoint="",this._tunnelChain="",this._keepalive=!1,this._ttl=0,this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push($(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.entrypointId;if(t==="new"||!t){this.mode="create",this._entrypoint=null,this._name="",this._endpoint="",this._tunnelChain="",this._keepalive=!1,this._ttl=0;return}const e=w().find(s=>s.id===t);e&&(this._entrypoint=e,this.mode!=="edit"&&this._populateForm(e))}_populateForm(t){this._name=t.name,this._endpoint=t.endpoint,this._tunnelChain=t.entrypoint,this._keepalive=t.options.keepalive??!1,this._ttl=t.options.ttl??0}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._entrypoint&&this._populateForm(this._entrypoint),this.mode="edit"}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},3e3)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(i("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.entrypointType,endpoint:this._endpoint.trim(),hostname:this._tunnelChain.trim()||void 0,keepalive:this._keepalive,ttl:this._ttl>0?this._ttl:void 0};this.mode==="create"?(await f(()=>import("./index-C17mvF4N.js").then(e=>e.D),__vite__mapDeps([0,1])).then(e=>e.create(t)),this._showSnackbar(i("saved")),this._navigate("/")):(await f(()=>import("./index-C17mvF4N.js").then(e=>e.D),__vite__mapDeps([0,1])).then(e=>e.update(this.entrypointId,t)),this._showSnackbar(i("saved")),this.mode="view",await k())}catch(t){const e=t instanceof Error?t.message:"";this._showSnackbar(`${i("saveFailed")}${e?": "+e:""}`)}this._saving=!1}async _handleDelete(){if(confirm(i("deleteConfirmMessage")))try{await S(this.entrypointId),this._showSnackbar(i("deleted")),this._navigate("/")}catch{this._showSnackbar(i("deleteFailed"))}}async _handleStart(){try{await z(this.entrypointId),this._showSnackbar(i("started"))}catch{this._showSnackbar(i("startFailed"))}}async _handleStop(){try{await C(this.entrypointId),this._showSnackbar(i("stopped"))}catch{this._showSnackbar(i("stopFailed"))}}async _handleFavorite(){await T(this.entrypointId)}render(){const t=this._entrypoint,e=t?E(t.id)??t.stats:null,s=this.entrypointType.toUpperCase();return n`
      <app-scaffold>
        <div slot="appBar" class="title-row">
          <button class="back-btn" @click=${()=>this._navigate("/")}>←</button>
          <span class="page-title">${this.mode==="create"?`${i("entrypointNewTitle")} — ${s}`:s}</span>
          <div class="actions">
            ${this.mode==="view"&&t?n`
              <button class="btn" @click=${this._handleFavorite}>${t.favorite?"★":"☆"}</button>
              ${t.status==="running"?n`<button class="btn stop" @click=${this._handleStop}>${i("btnStop")}</button>`:n`<button class="btn start" @click=${this._handleStart}>${i("btnStart")}</button>`}
              <button class="btn" @click=${this._enterEdit}>${i("btnEdit")}</button>
              <button class="btn danger" @click=${this._handleDelete}>${i("btnDelete")}</button>
            `:n`
              <button class="btn primary" ?disabled=${this._saving} @click=${this._handleSave}>
                ${this._saving?"...":i("btnSave")}
              </button>
            `}
          </div>
        </div>

        ${this.mode==="view"&&t?n`
          ${t.error?n`<div class="error-banner">${t.error}</div>`:""}

          <div class="section">
            <div class="section-title">${i("fieldEndpoint")}</div>
            <div class="copy-field">
              <code>${t.id}</code>
              <button class="icon-btn" @click=${async()=>{await F(t.id),this._showSnackbar(i("copiedToClipboard"))}}>📋</button>
            </div>
          </div>

          <div class="section">
            <div class="section-title">${i("labelStatistics")}</div>
            ${e?n`
              <div class="stats-grid">
                <div class="stat-badge"><div class="val">${y(e.current_conns)}</div><div class="rate">${u(e.request_rate)}</div></div>
                <div class="stat-badge"><div class="val">${y(e.total_conns)}</div><div class="rate">total</div></div>
                <div class="stat-badge"><div class="val">${_(e.input_bytes)}</div><div class="rate">${u(e.input_rate_bytes)}</div></div>
                <div class="stat-badge"><div class="val">${_(e.output_bytes)}</div><div class="rate">${u(e.output_rate_bytes)}</div></div>
              </div>
            `:n`<div style="color:var(--color-text-muted);font-size:13px;">Loading...</div>`}
          </div>

          <div class="section">
            <div class="field"><label>${i("fieldName")}</label><input type="text" .value=${t.name} readonly></div>
            <div class="field"><label>${i("fieldBindAddress")}</label><input type="text" .value=${t.endpoint} readonly></div>
            <div class="field"><label>${i("fieldTunnelChain")}</label><input type="text" .value=${t.entrypoint} readonly></div>
          </div>
        `:n`
          <div class="section">
            <div class="field">
              <label>${i("fieldName")} *</label>
              <input type="text" .value=${this._name} @input=${r=>{this._name=r.target.value}}>
            </div>
            <div class="field">
              <label>${i("fieldBindAddress")}</label>
              <input type="text" .value=${this._endpoint} @input=${r=>{this._endpoint=r.target.value}}>
            </div>
            <div class="field">
              <label>${i("fieldTunnelChain")}</label>
              <input type="text" .value=${this._tunnelChain} @input=${r=>{this._tunnelChain=r.target.value}}>
            </div>
            <entrypoint-form-fields
              .keepalive=${this._keepalive}
              .ttl=${this._ttl}
            ></entrypoint-form-fields>
          </div>
        `}

        ${this._snackbar?n`<div class="snackbar">${this._snackbar}</div>`:""}
      </app-scaffold>
    `}};o.styles=m`
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
  `;l([h()],o.prototype,"entrypointType",2);l([h()],o.prototype,"entrypointId",2);l([d()],o.prototype,"mode",2);l([d()],o.prototype,"_entrypoint",2);l([d()],o.prototype,"_saving",2);l([d()],o.prototype,"_snackbar",2);l([d()],o.prototype,"_name",2);l([d()],o.prototype,"_endpoint",2);l([d()],o.prototype,"_tunnelChain",2);l([d()],o.prototype,"_keepalive",2);l([d()],o.prototype,"_ttl",2);o=l([g("entrypoint-detail-page")],o);export{o as EntrypointDetailPage};
