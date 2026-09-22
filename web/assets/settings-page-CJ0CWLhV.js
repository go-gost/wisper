import{a as f,G as m,o as _,h as y,y as x,j as e,z as c,b as h,i as w,t as k}from"./index-CgUgRvVD.js";import{r}from"./state-48zrcT2l.js";import{i as o}from"./app-scaffold-DbfbAqpF.js";import{c as $}from"./clipboard-C3x8_sid.js";var S=Object.defineProperty,P=Object.getOwnPropertyDescriptor,a=(t,s,l,p)=>{for(var n=p>1?void 0:p?P(s,l):s,d=t.length-1,v;d>=0;d--)(v=t[d])&&(n=(p?v(s,l,n):v(n))||n);return p&&n&&S(s,l,n),n};const u=[{value:"system",labelKey:"settingsThemeSystem"},{value:"light",labelKey:"settingsThemeLight"},{value:"dark",labelKey:"settingsThemeDark"}],b=[{value:"en",labelKey:"settingsLangEn"},{value:"zh",labelKey:"settingsLangZh"}],g=[{value:1,labelKey:"settingsInterval1s"},{value:2,labelKey:"settingsInterval2s"},{value:3,labelKey:"settingsInterval3s"},{value:5,labelKey:"settingsInterval5s"},{value:10,labelKey:"settingsInterval10s"},{value:30,labelKey:"settingsInterval30s"}];let i=class extends f{constructor(){super(...arguments),this._server="",this._entrypoint="",this._insecure=!1,this._p2pDerp="",this._p2pSecure=!0,this._p2pCaFile="",this._p2pPublicKey="",this._theme="system",this._lang="en",this._statsInterval=3,this._inspectorUrl="",this._inspectorConnected=!1,this._inspectorTested=!1,this._snackbar="",this._saving=!1,this._version="",this._unsubs=[],this._backend=new m,this._livenessTimer=null}connectedCallback(){super.connectedCallback();const t=_();this._server=t.server,this._entrypoint=t.entrypoint,this._insecure=t.insecure,this._p2pDerp=t.p2p?.derp||"",this._p2pSecure=t.p2p?.secure??!0,this._p2pCaFile=t.p2p?.ca_file||"",this._theme=t.theme,this._lang=t.lang,this._statsInterval=t.stats_interval||1,this._inspectorUrl=t.inspector_url||"",this._unsubs.push(y(()=>{const s=_();this._server=s.server,this._entrypoint=s.entrypoint,this._insecure=s.insecure,this._p2pDerp=s.p2p?.derp||"",this._p2pSecure=s.p2p?.secure??!0,this._p2pCaFile=s.p2p?.ca_file||"",this._theme=s.theme,this._lang=s.lang,this._statsInterval=s.stats_interval||1,this._inspectorUrl=s.inspector_url||"",this.requestUpdate(),this._fetchP2PIdentity()}),x(()=>this.requestUpdate())),this._fetchVersion(),this._fetchP2PIdentity()}async _fetchVersion(){try{const t=await this._backend.getVersion();this._version=t.version}catch{this._version=""}}async _fetchP2PIdentity(){try{this._p2pPublicKey=(await this._backend.getP2PIdentity()).public_key}catch{this._p2pPublicKey=""}}async _copyP2PKey(){await $(this._p2pPublicKey),this._showSnackbar(e("copiedToClipboard"))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._livenessTimer&&clearTimeout(this._livenessTimer)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2e3)}async _saveSettings(){this._saving=!0;try{await c({server:this._server,entrypoint:this._entrypoint,insecure:this._insecure,p2p:{derp:this._p2pDerp,secure:this._p2pSecure,ca_file:this._p2pCaFile}}),this._showSnackbar("✓ "+e("saved"))}catch{this._showSnackbar(e("saveFailed"))}this._saving=!1}async _setTheme(t){this._theme=t,this.requestUpdate(),this._showSnackbar("✓ "+e(u.find(s=>s.value===t)?.labelKey??"settingsThemeSystem"));try{await c({theme:t})}catch{}}async _setLang(t){this._lang=t,this.requestUpdate(),this._showSnackbar("✓ "+e(b.find(s=>s.value===t)?.labelKey??"settingsLangEn"));try{await c({lang:t})}catch{}}async _setInterval(t){this._statsInterval=t,this.requestUpdate(),this._showSnackbar("✓ "+e(g.find(s=>s.value===t)?.labelKey??"settingsInterval1s"));try{await c({stats_interval:t})}catch{}}_onInspectorUrlChange(t){this._inspectorUrl=t,this._livenessTimer&&clearTimeout(this._livenessTimer),this._livenessTimer=setTimeout(()=>this._checkLiveness(),500)}async _checkLiveness(){if(!this._inspectorUrl){this._inspectorConnected=!1,this._inspectorTested=!1;return}try{const t=await fetch(`${this._inspectorUrl.replace(/\/$/,"")}/liveness`);this._inspectorConnected=t.ok,this._inspectorTested=!0}catch{this._inspectorConnected=!1,this._inspectorTested=!0}this.requestUpdate()}async _saveInspectorUrl(){try{await c({inspector_url:this._inspectorUrl}),this._showSnackbar("✓ "+e("saved"))}catch{this._showSnackbar(e("saveFailed"))}}_cycleOption(t,s){const l=s.indexOf(t);return s[(l+1)%s.length]}render(){return h`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${o("chevron-left")}
          </button>
          <span class="page-title">${e("settingsTitle")}</span>
        </div>

        <!-- App Info -->
        <div class="app-info">
          <div class="app-logo">
            <img src="/logo.png" alt="Wisper" />
          </div>
          <div class="app-name">${e("appName")}</div>
          <div class="app-tagline">${e("appSubtitle")}</div>
          <div class="app-version">${this._version?`v${this._version}`:""}</div>
          <div class="settings-links">
            <a href="https://wisper.gost.run/" target="_blank" rel="noopener" title="Home">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <span>Home</span>
            </a>
            <a href="https://github.com/go-gost/wisper" target="_blank" rel="noopener" title="GitHub">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              <span>GitHub</span>
            </a>
            <a href="https://t.me/gogost" target="_blank" rel="noopener" title="Telegram">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.94 4.6L3.2 11.37c-1.06.43-1.05 1.95.02 2.36l4.46 1.7 1.72 5.45c.36 1.13 1.78 1.31 2.4.31l2.45-3.87 4.36 3.23c.83.61 2.01.13 2.13-.92l1.9-13.94c.13-1-.76-1.77-1.7-1.42z"/></svg>
              <span>Telegram</span>
            </a>
          </div>
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
                ${o("check")} ${e("btnSave")}
              </button>
            </div>
          </div>
        </div>

        <!-- P2P Identity -->
        <div class="section">
          <div class="section-title">${e("p2pIdentity")}</div>
          <div class="card">
            <div class="card-padded">
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="identity-key ${this._p2pPublicKey?"":"muted"}">
                  ${this._p2pPublicKey||e("p2pIdentityIdle")}
                </span>
                ${this._p2pPublicKey?h`<button class="copy-btn-mini" title="${e("btnCopy")}" @click=${()=>this._copyP2PKey()}>
                    ${o("copy")}
                  </button>`:""}
              </div>
              <p class="hint">${e("p2pIdentityHint")}</p>
            </div>
          </div>
        </div>

        <!-- P2P -->
        <div class="section">
          <div class="section-title">${e("settingsP2P")}</div>
          <div class="card">
            <div class="card-padded">
              <div class="form-group">
                <label class="form-label">${e("settingsP2PDerp")}</label>
                <input class="form-input" .value=${this._p2pDerp}
                  placeholder="wss://derp.gost.run/derp"
                  @input=${t=>{this._p2pDerp=t.target.value}}>
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-label">${e("settingsP2PSecure")}</div>
                </div>
                <div class="switch ${this._p2pSecure?"on":""}"
                  @click=${()=>{this._p2pSecure=!this._p2pSecure}}>
                  <div class="switch-knob"></div>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">${e("settingsP2PCAFile")}</label>
                <input class="form-input" .value=${this._p2pCaFile}
                  @input=${t=>{this._p2pCaFile=t.target.value}}>
              </div>
              <button class="save-btn" ?disabled=${this._saving} @click=${this._saveSettings}>
                ${o("check")} ${e("btnSave")}
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
                  <span style="width:8px;height:8px;border-radius:50%;background:${this._inspectorTested?this._inspectorConnected?"var(--green)":"var(--red)":"var(--text-muted)"};display:inline-block;"></span>
                  ${this._inspectorTested?this._inspectorConnected?e("inspectorConnected"):e("inspectorUnreachable"):e("inspectorUntested")}
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
            <div class="selector-row" @click=${()=>this._setLang(this._cycleOption(this._lang,b.map(t=>t.value)))}>
              <span class="selector-label">${e("settingsLanguage")}</span>
              <span class="selector-value">
                ${e(b.find(t=>t.value===this._lang)?.labelKey??"settingsLangEn")}
                ${o("chevron-right")}
              </span>
            </div>
            <div class="selector-row" @click=${()=>this._setTheme(this._cycleOption(this._theme,u.map(t=>t.value)))}>
              <span class="selector-label">${e("settingsTheme")}</span>
              <span class="selector-value">
                ${e(u.find(t=>t.value===this._theme)?.labelKey??"settingsThemeSystem")}
                ${o("chevron-right")}
              </span>
            </div>
            <div class="selector-row" @click=${()=>this._setInterval(this._cycleOption(this._statsInterval,g.map(t=>t.value)))}>
              <span class="selector-label">${e("settingsStatsInterval")}</span>
              <span class="selector-value">
                ${e(g.find(t=>t.value===this._statsInterval)?.labelKey??"settingsInterval1s")}
                ${o("chevron-right")}
              </span>
            </div>
          </div>
        </div>

        ${this._snackbar?h`<div class="toast">${this._snackbar}</div>`:""}
      </app-scaffold>
    `}};i.styles=w`
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
      border-radius: 50%;
      background: #000;
      margin: 0 auto 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .app-logo img {
      width: 36px;
      height: 36px;
      object-fit: contain;
      display: block;
    }
    .app-name {
      font-size: var(--font-md); font-weight: 600;
      color: var(--text); margin-bottom: 2px;
    }
    .app-version {
      font-size: var(--font-sm); color: var(--text-muted);
      margin-top: 4px;
    }
    .settings-links {
      display: flex;
      justify-content: center;
      gap: 18px;
      margin-top: 12px;
    }
    .settings-links a {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-sm);
      color: var(--accent);
      text-decoration: none;
      transition: opacity var(--transition-fast);
    }
    .settings-links a:hover {
      opacity: 0.75;
    }
    .settings-links svg {
      width: 15px;
      height: 15px;
    }
    .app-tagline {
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

    /* ── P2P identity ── */
    .identity-key {
      flex: 1;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: var(--font-sm);
      color: var(--text);
      word-break: break-all;
    }
    .identity-key.muted { color: var(--text-muted); }
    .copy-btn-mini {
      background: none; border: none; cursor: pointer;
      padding: 2px; color: var(--text-muted); display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover { background: var(--border-subtle); color: var(--text); }

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
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
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
  `;a([r()],i.prototype,"_server",2);a([r()],i.prototype,"_entrypoint",2);a([r()],i.prototype,"_insecure",2);a([r()],i.prototype,"_p2pDerp",2);a([r()],i.prototype,"_p2pSecure",2);a([r()],i.prototype,"_p2pCaFile",2);a([r()],i.prototype,"_p2pPublicKey",2);a([r()],i.prototype,"_theme",2);a([r()],i.prototype,"_lang",2);a([r()],i.prototype,"_statsInterval",2);a([r()],i.prototype,"_inspectorUrl",2);a([r()],i.prototype,"_inspectorConnected",2);a([r()],i.prototype,"_inspectorTested",2);a([r()],i.prototype,"_snackbar",2);a([r()],i.prototype,"_saving",2);a([r()],i.prototype,"_version",2);i=a([k("settings-page")],i);export{i as SettingsPage};
