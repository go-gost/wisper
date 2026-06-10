const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-DvIQLlSN.js","assets/index-NRZDUYqM.css"])))=>i.map(i=>d[i]);
import{i as y,a as x,c as e,b as l,t as _,h as w,d as k,_ as f,p as $,q as D,u as S,v as z,w as C,o as T}from"./index-DvIQLlSN.js";import{n as h,r as p}from"./app-scaffold-D-01mgFn.js";import{f as m,a as v,b as g}from"./format-DfcOH1_a.js";import{c as E}from"./stats-row-DhP0A-6Q.js";var F=Object.defineProperty,P=Object.getOwnPropertyDescriptor,u=(t,a,n,i)=>{for(var o=i>1?void 0:i?P(a,n):a,d=t.length-1,c;d>=0;d--)(c=t[d])&&(o=(i?c(a,n,o):c(o))||o);return i&&o&&F(a,n,o),o};let b=class extends x{constructor(){super(...arguments),this.keepalive=!1,this.ttl=0,this.disabled=!1}render(){return l`
      <div class="fields">
        <div class="switch-row">
          <span class="switch-label">${e("switchKeepalive")}</span>
          <div class="switch ${this.keepalive?"on":""}" @click=${()=>{this.disabled||(this.keepalive=!this.keepalive,this.requestUpdate())}}>
            <div class="switch-knob"></div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${e("fieldTTL")}</label>
          <input class="form-input" type="text" .value=${this.ttl>0?`${this.ttl}s`:""}
            ?disabled=${this.disabled}
            placeholder=${e("fieldTTLHint")}
            @input=${t=>{const a=t.target.value;this.ttl=parseInt(a)||0}}>
          <span class="hint">${e("fieldTTLHint")}</span>
        </div>
      </div>
    `}};b.styles=y`
    .fields { display: flex; flex-direction: column; gap: 8px; }

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
    .hint { font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }
  `;u([h({type:Boolean})],b.prototype,"keepalive",2);u([h({type:Number})],b.prototype,"ttl",2);u([h({type:Boolean})],b.prototype,"disabled",2);b=u([_("entrypoint-form-fields")],b);var I=Object.defineProperty,O=Object.getOwnPropertyDescriptor,s=(t,a,n,i)=>{for(var o=i>1?void 0:i?O(a,n):a,d=t.length-1,c;d>=0;d--)(c=t[d])&&(o=(i?c(a,n,o):c(o))||o);return i&&o&&I(a,n,o),o};let r=class extends x{constructor(){super(...arguments),this.entrypointType="tcp",this.entrypointId="",this.mode="view",this._entrypoint=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._name="",this._endpoint="",this._tunnelChain="",this._keepalive=!1,this._ttl=0,this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(w(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.entrypointId;if(t==="new"||!t){this.mode="create",this._entrypoint=null,this._name="",this._endpoint="",this._tunnelChain="",this._keepalive=!1,this._ttl=0;return}const a=k().find(n=>n.id===t);a&&(this._entrypoint=a,this.mode!=="edit"&&this._populateForm(a))}_populateForm(t){this._name=t.name,this._endpoint=t.endpoint,this._tunnelChain=t.entrypoint,this._keepalive=t.options.keepalive??!1,this._ttl=t.options.ttl??0}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._entrypoint&&this._populateForm(this._entrypoint),this.mode="edit"}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},3e3)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(e("requiredField"));return}this._saving=!0;try{const t={name:this._name.trim(),type:this.entrypointType,endpoint:this._endpoint.trim(),hostname:this._tunnelChain.trim()||void 0,keepalive:this._keepalive,ttl:this._ttl>0?this._ttl:void 0};this.mode==="create"?(await f(()=>import("./index-DvIQLlSN.js").then(a=>a.D),__vite__mapDeps([0,1])).then(a=>a.create(t)),this._showSnackbar(e("saved")),this._navigate("/")):(await f(()=>import("./index-DvIQLlSN.js").then(a=>a.D),__vite__mapDeps([0,1])).then(a=>a.update(this.entrypointId,t)),this._showSnackbar(e("saved")),this.mode="view",await $())}catch(t){const a=t instanceof Error?t.message:"";this._showSnackbar(`${e("saveFailed")}${a?": "+a:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await D(this.entrypointId),this._showSnackbar(e("deleted")),this._navigate("/")}catch{this._showSnackbar(e("deleteFailed"))}}async _handleStart(){try{await S(this.entrypointId),this._showSnackbar(e("started"))}catch{this._showSnackbar(e("startFailed"))}}async _handleStop(){try{await z(this.entrypointId),this._showSnackbar(e("stopped"))}catch{this._showSnackbar(e("stopFailed"))}}async _handleFavorite(){await C(this.entrypointId)}render(){const t=this._entrypoint,a=t?T(t.id)??t.stats:null,n=this.entrypointType.toUpperCase();return l`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>←</button>
          <span class="page-title">${this.mode==="create"?`${e("entrypointNewTitle")} — ${n}`:n+" Entrypoint"}</span>

          ${this.mode==="view"&&t?l`
            <button class="fav-btn ${t.favorite?"active":"inactive"}" @click=${this._handleFavorite}>★</button>
            ${t.status==="running"?l`<button class="stop-btn" @click=${this._handleStop}>■ ${e("btnStop")}</button>`:l`<button class="primary-btn" @click=${this._handleStart}>▶ ${e("btnStart")}</button>`}
            <button class="danger-btn" @click=${()=>{this._showDeleteDialog=!0}}>🗑</button>
            <button class="appbar-btn" @click=${this._enterEdit}>✏ ${e("btnEdit")}</button>
          `:l`
            <button class="primary-btn" ?disabled=${this._saving} @click=${this._handleSave}>
              ✓ ${e("btnSave")}
            </button>
          `}
        </div>

        ${this.mode==="view"&&t?l`
          ${t.error?l`<div class="error-banner">${t.error}</div>`:""}

          <div class="detail-section">
            <div class="detail-card">
              <!-- Copyable ID -->
              <div class="copyable-row">
                <span class="copyable-text">${t.id}</span>
                <button class="copy-btn" @click=${async()=>{await E(t.id),this._showSnackbar("📋 "+e("copiedToClipboard"))}}>📋</button>
              </div>

              <!-- Name (read-only) -->
              <div class="form-group">
                <label class="form-label">${e("fieldName")}</label>
                <input class="form-input" readonly .value=${t.name}>
              </div>
              <!-- Bind Address (read-only) -->
              <div class="form-group">
                <label class="form-label">${e("fieldBindAddress")}</label>
                <input class="form-input" readonly .value=${t.endpoint}>
              </div>
              <!-- Tunnel Chain (read-only) -->
              <div class="form-group">
                <label class="form-label">${e("fieldTunnelChain")}</label>
                <input class="form-input" readonly .value=${t.entrypoint}>
              </div>

              <!-- Keepalive + TTL (read-only display) -->
              <div class="switch-row">
                <span class="switch-label">${e("switchKeepalive")}</span>
                <div class="switch ${t.options.keepalive?"on":""}" style="pointer-events:none;">
                  <div class="switch-knob"></div>
                </div>
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">${e("fieldTTL")}</label>
                <input class="form-input" readonly .value=${t.options.ttl?t.options.ttl+"s":"30s"}>
              </div>
            </div>

            <!-- Stats -->
            ${a?l`
              <div class="stats-section">
                <div class="detail-card">
                  <div class="stats-title">${e("labelStatistics")}</div>
                  <div class="stats-badges">
                    <span class="stats-badge">↕ ${m(a.current_conns)} / ${m(a.total_conns)} connections</span>
                    <span class="stats-badge">⚡ ${v(a.request_rate)}</span>
                  </div>
                  <stats-row icon="↑" .value=${g(a.input_bytes)+" total"} .rate=${v(a.input_rate_bytes)}></stats-row>
                  <stats-row icon="↓" .value=${g(a.output_bytes)+" total"} .rate=${v(a.output_rate_bytes)}></stats-row>
                </div>
              </div>
            `:""}
          </div>
        `:l`
          <!-- Edit/Create mode -->
          <div class="detail-section">
            <div class="detail-card">
              <div class="form-group">
                <label class="form-label">${e("fieldName")}</label>
                <input class="form-input" .value=${this._name} placeholder="Enter name"
                  @input=${i=>{this._name=i.target.value}}>
              </div>
              <div class="form-group">
                <label class="form-label">${e("fieldBindAddress")}</label>
                <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                  @input=${i=>{this._endpoint=i.target.value}}>
              </div>
              <div class="form-group">
                <label class="form-label">${e("fieldTunnelChain")}</label>
                <input class="form-input" .value=${this._tunnelChain} placeholder="tunnel.wisper.app:443 → abc123"
                  @input=${i=>{this._tunnelChain=i.target.value}}>
              </div>
              <entrypoint-form-fields
                .keepalive=${this._keepalive}
                .ttl=${this._ttl}
              ></entrypoint-form-fields>
            </div>
          </div>
        `}

        ${this._snackbar?l`<div class="toast">${this._snackbar}</div>`:""}

        ${this._showDeleteDialog?l`
          <div class="dialog-overlay" @click=${()=>{this._showDeleteDialog=!1}}>
            <div class="dialog-box" @click=${i=>{i.stopPropagation()}}>
              <div class="dialog-title">${e("deleteConfirmTitle")}</div>
              <div class="dialog-message">${e("deleteConfirmMessage")}</div>
              <div class="dialog-actions">
                <button class="dialog-btn cancel" @click=${()=>{this._showDeleteDialog=!1}}>${e("btnCancel")}</button>
                <button class="dialog-btn danger" @click=${this._handleDelete}>${e("btnDelete")}</button>
              </div>
            </div>
          </div>
        `:""}
      </app-scaffold>
    `}};r.styles=y`
    /* ── AppBar ── */
    .back-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.3rem; color: var(--color-text-primary); padding: 4px 8px;
      border-radius: 8px; display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--color-surface-variant); }

    .page-title { font-size: 1.15rem; font-weight: 600; flex: 1; }

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
    .detail-section { margin: 16px; }
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
      font-size: 0.95rem; font-family: inherit;
      outline: none;
      transition: border-color var(--transition-fast), background var(--transition-fast);
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--color-primary); }
    .form-input[readonly] {
      background: transparent; border-color: transparent; cursor: default;
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

    /* ── Toast ── */
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

    /* ── Delete Dialog ── */
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
    .dialog-btn.cancel { background: var(--color-surface-variant); color: var(--color-text-primary); }
    .dialog-btn.danger { background: var(--color-error); color: white; }
    .dialog-btn:hover { opacity: 0.9; }

    /* ── Switch row ── */
    .switch-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0;
    }
    .switch-label { font-size: 0.95rem; }
    .switch {
      width: 44px; height: 24px; border-radius: 12px;
      background: var(--color-stopped); position: relative;
      cursor: pointer; transition: background var(--transition-fast);
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
  `;s([h()],r.prototype,"entrypointType",2);s([h()],r.prototype,"entrypointId",2);s([p()],r.prototype,"mode",2);s([p()],r.prototype,"_entrypoint",2);s([p()],r.prototype,"_saving",2);s([p()],r.prototype,"_snackbar",2);s([p()],r.prototype,"_showDeleteDialog",2);s([p()],r.prototype,"_name",2);s([p()],r.prototype,"_endpoint",2);s([p()],r.prototype,"_tunnelChain",2);s([p()],r.prototype,"_keepalive",2);s([p()],r.prototype,"_ttl",2);r=s([_("entrypoint-detail-page")],r);export{r as EntrypointDetailPage};
