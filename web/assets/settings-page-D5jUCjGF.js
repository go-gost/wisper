import{a as _,w as g,h as m,A as y,B as l,j as e,b as f,i as x,t as w}from"./index--zb5Z7nE.js";import{r}from"./state-D3BSW4Rm.js";import{i as c}from"./app-scaffold-BE4q86e5.js";var k=Object.defineProperty,$=Object.getOwnPropertyDescriptor,i=(t,s,o,p)=>{for(var n=p>1?void 0:p?$(s,o):s,d=t.length-1,v;d>=0;d--)(v=t[d])&&(n=(p?v(s,o,n):v(n))||n);return p&&n&&k(s,o,n),n};const h=[{value:"system",labelKey:"settingsThemeSystem"},{value:"light",labelKey:"settingsThemeLight"},{value:"dark",labelKey:"settingsThemeDark"}],u=[{value:"en",labelKey:"settingsLangEn"},{value:"zh",labelKey:"settingsLangZh"}],b=[{value:1,labelKey:"settingsInterval1s"},{value:2,labelKey:"settingsInterval2s"},{value:5,labelKey:"settingsInterval5s"},{value:10,labelKey:"settingsInterval10s"},{value:30,labelKey:"settingsInterval30s"}];let a=class extends _{constructor(){super(...arguments),this._server="",this._entrypoint="",this._insecure=!1,this._theme="system",this._lang="en",this._statsInterval=1,this._inspectorUrl="",this._inspectorConnected=!1,this._snackbar="",this._saving=!1,this._unsubs=[],this._livenessTimer=null}connectedCallback(){super.connectedCallback();const t=g();this._server=t.server,this._entrypoint=t.entrypoint,this._insecure=t.insecure,this._theme=t.theme,this._lang=t.lang,this._statsInterval=t.stats_interval||1,this._inspectorUrl=t.inspector_url||"",this._unsubs.push(m(()=>{const s=g();this._server=s.server,this._entrypoint=s.entrypoint,this._insecure=s.insecure,this._theme=s.theme,this._lang=s.lang,this._statsInterval=s.stats_interval||1,this._inspectorUrl=s.inspector_url||"",this.requestUpdate()}),y(()=>this.requestUpdate()))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._livenessTimer&&clearTimeout(this._livenessTimer)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2e3)}async _saveSettings(){this._saving=!0;try{await l({server:this._server,entrypoint:this._entrypoint,insecure:this._insecure}),this._showSnackbar("✓ "+e("saved"))}catch{this._showSnackbar(e("saveFailed"))}this._saving=!1}async _setTheme(t){this._theme=t,this.requestUpdate(),this._showSnackbar("✓ "+e(h.find(s=>s.value===t)?.labelKey??"settingsThemeSystem"));try{await l({theme:t})}catch{}}async _setLang(t){this._lang=t,this.requestUpdate(),this._showSnackbar("✓ "+e(u.find(s=>s.value===t)?.labelKey??"settingsLangEn"));try{await l({lang:t})}catch{}}async _setInterval(t){this._statsInterval=t,this.requestUpdate(),this._showSnackbar("✓ "+e(b.find(s=>s.value===t)?.labelKey??"settingsInterval1s"));try{await l({stats_interval:t})}catch{}}_onInspectorUrlChange(t){this._inspectorUrl=t,this._livenessTimer&&clearTimeout(this._livenessTimer),this._livenessTimer=setTimeout(()=>this._checkLiveness(),500)}async _checkLiveness(){if(!this._inspectorUrl){this._inspectorConnected=!1;return}try{const t=await fetch(`${this._inspectorUrl.replace(/\/$/,"")}/liveness`);this._inspectorConnected=t.ok}catch{this._inspectorConnected=!1}this.requestUpdate()}async _saveInspectorUrl(){try{await l({inspector_url:this._inspectorUrl}),this._showSnackbar("✓ "+e("saved"))}catch{this._showSnackbar(e("saveFailed"))}}_cycleOption(t,s){const o=s.indexOf(t);return s[(o+1)%s.length]}render(){return f`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${c("chevron-left")}
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
              </div>
              <div class="form-group">
                <label class="form-label">${e("settingsEntrypoint")}</label>
                <input class="form-input" .value=${this._entrypoint}
                  placeholder=${e("settingsEntrypointHint")}
                  @input=${t=>{this._entrypoint=t.target.value}}>
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
                ${c("check")} ${e("btnSave")}
              </button>
            </div>
          </div>
        </div>

        <!-- Inspector -->
        <div class="section">
          <div class="section-title">🔍 Inspector</div>
          <div class="card">
            <div class="card-padded">
              <p style="font-size:var(--font-sm);color:var(--text-muted);margin-bottom:12px;">
                ${e("inspectorSettingsDesc")}
              </p>
              <div class="form-group">
                <label class="form-label">${e("inspectorSettingsLabel")}</label>
                <input class="form-input" .value=${this._inspectorUrl}
                  placeholder=${e("inspectorUrlPlaceholder")}
                  @input=${t=>this._onInspectorUrlChange(t.target.value)}
                  @blur=${()=>this._saveInspectorUrl()}>
                <p class="hint">Leave empty to disable traffic inspection.</p>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;font-size:var(--font-sm);padding-top:8px;">
                <span style="display:flex;align-items:center;gap:6px;color:var(--text-muted);">
                  <span style="width:8px;height:8px;border-radius:50%;background:${this._inspectorConnected?"var(--green)":"var(--red)"};display:inline-block;"></span>
                  ${this._inspectorConnected?e("inspectorConnected"):this._inspectorUrl?e("inspectorUnreachable"):"—"}
                </span>
                <button class="save-btn" style="width:auto;padding:6px 16px;margin:0;"
                  @click=${()=>this._checkLiveness()}>
                  ${e("inspectorTest")}
                </button>
              </div>
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
                ${c("chevron-right")}
              </span>
            </div>
            <div class="selector-row" @click=${()=>this._setTheme(this._cycleOption(this._theme,h.map(t=>t.value)))}>
              <span class="selector-label">${e("settingsTheme")}</span>
              <span class="selector-value">
                ${e(h.find(t=>t.value===this._theme)?.labelKey??"settingsThemeSystem")}
                ${c("chevron-right")}
              </span>
            </div>
            <div class="selector-row" @click=${()=>this._setInterval(this._cycleOption(this._statsInterval,b.map(t=>t.value)))}>
              <span class="selector-label">${e("settingsStatsInterval")}</span>
              <span class="selector-value">
                ${e(b.find(t=>t.value===this._statsInterval)?.labelKey??"settingsInterval1s")}
                ${c("chevron-right")}
              </span>
            </div>
          </div>
        </div>

        ${this._snackbar?f`<div class="toast">${this._snackbar}</div>`:""}
      </app-scaffold>
    `}};a.styles=x`
    /* ── Back nav ── */
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }

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
      font-weight: 700; font-size: var(--font-lg);
    }
    .app-name {
      font-size: var(--font-md); font-weight: 600;
      color: var(--text); margin-bottom: 2px;
    }
    .app-version {
      font-size: var(--font-sm); color: var(--text-muted);
    }

    /* ── Section ── */
    .section { padding: 0 16px 16px; }
    .section-title {
      font-size: var(--font-sm); font-weight: 600;
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
      font-size: var(--font-sm); font-weight: 500;
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
      font-size: var(--font-sm); font-family: inherit; outline: none;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }
    .form-input:focus { border-color: var(--accent); }
    .hint {
      font-size: var(--font-sm); color: var(--text-muted); margin-top: 2px;
    }

    /* ── Switch ── */
    .switch-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 0; border-bottom: 1px solid var(--border-subtle);
    }
    .switch-row:last-child { border-bottom: none; }
    .switch-label { font-size: var(--font-sm); color: var(--text); }
    .switch-desc { font-size: var(--font-sm); color: var(--text-muted); }
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
    .selector-label { font-size: var(--font-sm); color: var(--text); }
    .selector-value {
      display: flex; align-items: center; gap: 4px;
      color: var(--text-muted); font-size: var(--font-sm);
    }

    /* ── Save button ── */
    .save-btn {
      width: 100%; padding: 10px;
      border-radius: var(--radius-md);
      border: none;
      background: var(--accent); color: var(--accent-fg);
      font-size: var(--font-sm); font-weight: 500; cursor: pointer;
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
      font-size: var(--font-sm); z-index: 100;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;i([r()],a.prototype,"_server",2);i([r()],a.prototype,"_entrypoint",2);i([r()],a.prototype,"_insecure",2);i([r()],a.prototype,"_theme",2);i([r()],a.prototype,"_lang",2);i([r()],a.prototype,"_statsInterval",2);i([r()],a.prototype,"_inspectorUrl",2);i([r()],a.prototype,"_inspectorConnected",2);i([r()],a.prototype,"_snackbar",2);i([r()],a.prototype,"_saving",2);a=i([w("settings-page")],a);export{a as SettingsPage};
