import{a as f,x as b,h as x,y as m,z as v,j as e,b as g,i as _,t as y}from"./index-BxnSyTkH.js";import{r as n}from"./state-Bzr_HZxS.js";import{i as l}from"./app-scaffold-8MQz_NNd.js";var w=Object.defineProperty,k=Object.getOwnPropertyDescriptor,i=(t,s,o,c)=>{for(var r=c>1?void 0:c?k(s,o):s,p=t.length-1,d;p>=0;p--)(d=t[p])&&(r=(c?d(s,o,r):d(r))||r);return c&&r&&w(s,o,r),r};const h=[{value:"system",labelKey:"settingsThemeSystem"},{value:"light",labelKey:"settingsThemeLight"},{value:"dark",labelKey:"settingsThemeDark"}],u=[{value:"en",labelKey:"settingsLangEn"},{value:"zh",labelKey:"settingsLangZh"}];let a=class extends f{constructor(){super(...arguments),this._server="",this._entrypoint="",this._insecure=!1,this._theme="system",this._lang="en",this._snackbar="",this._saving=!1,this._unsubs=[]}connectedCallback(){super.connectedCallback();const t=b();this._server=t.server,this._entrypoint=t.entrypoint,this._insecure=t.insecure,this._theme=t.theme,this._lang=t.lang,this._unsubs.push(x(()=>{const s=b();this._server=s.server,this._entrypoint=s.entrypoint,this._insecure=s.insecure,this._theme=s.theme,this._lang=s.lang,this.requestUpdate()}),m(()=>this.requestUpdate()))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t()}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2e3)}async _saveSettings(){this._saving=!0;try{await v({server:this._server,entrypoint:this._entrypoint,insecure:this._insecure}),this._showSnackbar("✓ "+e("saved"))}catch{this._showSnackbar(e("saveFailed"))}this._saving=!1}async _setTheme(t){this._theme=t,this.requestUpdate(),this._showSnackbar("✓ "+e(h.find(s=>s.value===t)?.labelKey??"settingsThemeSystem"));try{await v({theme:t})}catch{}}async _setLang(t){this._lang=t,this.requestUpdate(),this._showSnackbar("✓ "+e(u.find(s=>s.value===t)?.labelKey??"settingsLangEn"));try{await v({lang:t})}catch{}}_cycleOption(t,s){const o=s.indexOf(t);return s[(o+1)%s.length]}render(){return g`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${l("chevron-left")}
          </button>
          <span class="page-title">${e("settingsTitle")}</span>
        </div>

        <!-- App Info -->
        <div class="app-info">
          <div class="app-logo">W</div>
          <div class="app-name">${e("appName")}</div>
          <div class="app-version">v1.0.0 · GOST Tunnel Manager</div>
        </div>

        <!-- Server Configuration -->
        <div class="section">
          <div class="section-title">Server Configuration</div>
          <div class="card">
            <div class="card-padded">
              <div class="form-group">
                <label class="form-label">${e("settingsServer")}</label>
                <input class="form-input" .value=${this._server}
                  placeholder=${e("settingsServerHint")}
                  @input=${t=>{this._server=t.target.value}}>
                <div class="hint">${e("settingsServerHint")}</div>
              </div>
              <div class="form-group">
                <label class="form-label">${e("settingsEntrypoint")}</label>
                <input class="form-input" .value=${this._entrypoint}
                  placeholder=${e("settingsEntrypointHint")}
                  @input=${t=>{this._entrypoint=t.target.value}}>
                <div class="hint">${e("settingsEntrypointHint")}</div>
              </div>
              <div class="switch-row" style="border-bottom:none;">
                <div>
                  <div class="switch-label">${e("settingsInsecure")}</div>
                  <div class="switch-desc">${e("settingsInsecureDesc")}</div>
                </div>
                <div class="switch ${this._insecure?"on":""}"
                  @click=${()=>{this._insecure=!this._insecure}}>
                  <div class="switch-knob"></div>
                </div>
              </div>
              <button class="save-btn" ?disabled=${this._saving} @click=${this._saveSettings}>
                ${l("check")} ${e("btnSave")}
              </button>
            </div>
          </div>
        </div>

        <!-- Preferences -->
        <div class="section">
          <div class="section-title">Preferences</div>
          <div class="card">
            <div class="selector-row" @click=${()=>this._setLang(this._cycleOption(this._lang,u.map(t=>t.value)))}>
              <span class="selector-label">${e("settingsLanguage")}</span>
              <span class="selector-value">
                ${e(u.find(t=>t.value===this._lang)?.labelKey??"settingsLangEn")}
                ${l("chevron-right")}
              </span>
            </div>
            <div class="selector-row" @click=${()=>this._setTheme(this._cycleOption(this._theme,h.map(t=>t.value)))}>
              <span class="selector-label">${e("settingsTheme")}</span>
              <span class="selector-value">
                ${e(h.find(t=>t.value===this._theme)?.labelKey??"settingsThemeSystem")}
                ${l("chevron-right")}
              </span>
            </div>
          </div>
        </div>

        ${this._snackbar?g`<div class="toast">${this._snackbar}</div>`:""}
      </app-scaffold>
    `}};a.styles=_`
    /* ── Back nav ── */
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: 13px; font-weight: 600; flex: 1; }

    /* ── App info ── */
    .app-info {
      text-align: center;
      padding: 28px 16px 20px;
    }
    .app-logo {
      width: 64px; height: 64px;
      background: var(--accent);
      border-radius: var(--radius-lg);
      margin: 0 auto 12px;
      display: flex; align-items: center; justify-content: center;
      color: var(--accent-fg);
      font-weight: 700; font-size: 24px;
    }
    .app-name {
      font-size: 16px; font-weight: 600;
      color: var(--text); margin-bottom: 2px;
    }
    .app-version {
      font-size: 11px; color: var(--text-muted);
    }

    /* ── Section ── */
    .section { padding: 0 16px 16px; }
    .section-title {
      font-size: 11px; font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    /* ── Card ── */
    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }
    .card-padded { padding: 16px; }

    /* ── Form ── */
    .form-group { margin-bottom: 12px; }
    .form-group:last-child { margin-bottom: 0; }
    .form-label {
      display: block;
      font-size: 8px; font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%; padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface); color: var(--text);
      font-size: 12px; font-family: inherit; outline: none;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }
    .form-input:focus { border-color: var(--accent); }
    .hint {
      font-size: 9px; color: var(--text-muted); margin-top: 2px;
    }

    /* ── Switch ── */
    .switch-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 0; border-bottom: 1px solid var(--border-subtle);
    }
    .switch-row:last-child { border-bottom: none; }
    .switch-label { font-size: 11px; color: var(--text); }
    .switch-desc { font-size: 9px; color: var(--text-muted); }
    .switch {
      width: 40px; height: 22px; border-radius: 11px;
      background: var(--border); position: relative;
      cursor: pointer; transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch.on { background: var(--accent); }
    .switch-knob {
      width: 18px; height: 18px; border-radius: 50%;
      background: #fff; position: absolute; top: 2px; left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    }
    .switch.on .switch-knob { left: 20px; }

    /* ── Selector rows ── */
    .selector-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
    }
    .selector-row:last-child { border-bottom: none; }
    .selector-row:hover { background: var(--border-subtle); }
    .selector-label { font-size: 11px; color: var(--text); }
    .selector-value {
      display: flex; align-items: center; gap: 4px;
      color: var(--text-muted); font-size: 10px;
    }

    /* ── Save button ── */
    .save-btn {
      width: 100%; padding: 10px;
      border-radius: var(--radius-md);
      border: none;
      background: var(--accent); color: var(--accent-fg);
      font-size: 12px; font-weight: 500; cursor: pointer;
      font-family: inherit;
      margin-top: 12px;
      transition: opacity var(--transition-fast);
    }
    .save-btn:hover { opacity: 0.85; }
    .save-btn:disabled { opacity: 0.5; cursor: default; }

    /* ── Toast ── */
    .toast {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: var(--surface); color: var(--text);
      padding: 10px 20px; border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 12px; z-index: 100;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;i([n()],a.prototype,"_server",2);i([n()],a.prototype,"_entrypoint",2);i([n()],a.prototype,"_insecure",2);i([n()],a.prototype,"_theme",2);i([n()],a.prototype,"_lang",2);i([n()],a.prototype,"_snackbar",2);i([n()],a.prototype,"_saving",2);a=i([y("settings-page")],a);export{a as SettingsPage};
