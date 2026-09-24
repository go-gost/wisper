const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-Dfc3VEzH.js","assets/index-nwYGvLm_.css"])))=>i.map(i=>d[i]);
import{a as _,f as y,c as $,A as x,j as t,b as s,_ as u,v as w,w as k,l as T,n as S,x as D,u as z,i as P,t as I}from"./index-Dfc3VEzH.js";import{d as R,m as b,c as v,a as f,b as m,n as g,r}from"./format-BNNKdwYE.js";import{i as p}from"./app-scaffold-DETw0TXR.js";import{a as C}from"./transport-DX2_pzO9.js";import{c as E}from"./clipboard-C3x8_sid.js";var N=Object.defineProperty,F=Object.getOwnPropertyDescriptor,n=(e,i,d,l)=>{for(var a=l>1?void 0:l?F(i,d):i,c=e.length-1,h;c>=0;c--)(h=e[c])&&(a=(l?h(i,d,a):h(a))||a);return l&&a&&N(i,d,a),a};let o=class extends _{constructor(){super(...arguments),this.entrypointType="tcp",this.entrypointId="",this.mode="view",this._entrypoint=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._tunnelId="",this._peer="",this._showPeer=!1,this._protocol="tcp",this._keepalive=!0,this._ttl=15,this._net="",this._mtu=0,this._deviceName="",this._routes="",this._dns="",this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._unsubs.push(y(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){super.disconnectedCallback();for(const e of this._unsubs)e();this._unsubs=[]}_load(){const e=this.entrypointId,i=window.location.search.includes("edit");if(e==="new"||!e){if(this.mode==="create")return;this.mode="create",this._entrypoint=null,this._resetForm();return}if(this.mode==="edit"&&this._entrypoint?.id===e)return;const d=$().find(l=>l.id===e);d&&(this._entrypoint=d,i?(this.mode="edit",this._populateForm(d)):(this.mode!=="edit"||this._entrypoint?.id!==e)&&(this.mode="view",this._populateForm(d)))}_resetForm(){this._name="",this._endpoint="",this._tunnelId="",this._peer="",this._protocol="tcp",this._keepalive=!0,this._ttl=15,this._net="",this._mtu=0,this._deviceName="",this._routes="",this._dns=""}_populateForm(e){this._name=e.name,this._endpoint=e.entrypoint,this._tunnelId=e.id??"",this._peer=e.options?.peer??"",this._protocol=e.options?.protocol==="udp"?"udp":"tcp",this._keepalive=e.options?.keepalive??!0,this._ttl=e.options?.ttl||15,this._net=e.options?.net??"",this._mtu=e.options?.mtu??0,this._deviceName=e.options?.device_name??"",this._routes=e.options?.routes??"",this._dns=e.options?.dns??""}_renderTransport(e){const i=C(e);return i?s`
      <div class="info-row">
        <span class="info-label">${t("p2pTransport")}</span>
        <span class="info-value text">
          <span class="peer-badge ${i.tone}" title=${i.hint}>
            ${p(i.icon)}<span>${i.label}</span>
          </span>
        </span>
      </div>
    `:x}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}_enterEdit(){this._entrypoint&&(this._populateForm(this._entrypoint),this.mode="edit")}_handleBack(){if(this.mode==="edit"&&this.entrypointId){this.mode="view",this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}`);return}this._navigate("/")}_showSnackbar(e){this._snackbar=e,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(t("requiredField"));return}this._saving=!0;try{const e={name:this._name.trim(),type:this.entrypointType,endpoint:this.entrypointType==="tun"?"":this._endpoint.trim(),id:this._tunnelId.trim()||void 0,peer:this._peer.trim()||void 0,protocol:this.entrypointType==="p2p"?this._protocol:void 0,keepalive:this.entrypointType==="tun"?this._keepalive:this.entrypointType==="p2p"&&this._protocol==="udp"?this._keepalive:void 0,ttl:this.entrypointType==="tun"?this._ttl:void 0,net:this.entrypointType==="tun"&&this._net.trim()||void 0,mtu:this.entrypointType==="tun"&&this._mtu||void 0,device_name:this.entrypointType==="tun"&&this._deviceName.trim()||void 0,routes:this.entrypointType==="tun"&&this._routes.trim()||void 0,dns:this.entrypointType==="tun"&&this._dns.trim()||void 0};this.mode==="create"?(await u(()=>import("./index-Dfc3VEzH.js").then(i=>i.H),__vite__mapDeps([0,1])).then(i=>i.create(e)),this._showSnackbar(t("saved")),this._navigate("/")):(await u(()=>import("./index-Dfc3VEzH.js").then(i=>i.H),__vite__mapDeps([0,1])).then(i=>i.update(this.entrypointId,e)),this._showSnackbar(t("saved")),this.mode="view",await w())}catch(e){const i=e instanceof Error?e.message:"";this._showSnackbar(`${t("saveFailed")}${i?": "+i:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await k(this.entrypointId),this._showSnackbar(t("deleted")),this._navigate("/")}catch{this._showSnackbar(t("deleteFailed"))}}async _handleStart(){try{await T(this.entrypointId),this._showSnackbar(t("started"))}catch{this._showSnackbar(t("startFailed"))}}async _handleStop(){try{await S(this.entrypointId),this._showSnackbar(t("stopped"))}catch{this._showSnackbar(t("stopFailed"))}}async _handleCopy(e){await E(e),this._showSnackbar(t("copiedToClipboard"))}_handleResetStats(e){this._resetKind=e,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await D(this.entrypointId,this._resetKind),this._entrypoint&&z(this.entrypointId,this._entrypoint.stats),this._showSnackbar(t("saved"))}catch{this._showSnackbar(t("saveFailed"))}}_typeLabel(){return this.entrypointType.toUpperCase()}render(){const e=this._entrypoint,i=e?e.stats:null,d=this._typeLabel(),l=e?.options?.peer??"";return s`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._handleBack()}>
            ${p("chevron-left")}
          </button>
          <span class="page-title">
            ${this.mode==="create"?`${t("entrypointNewTitle")} — ${d}`:d+" Entrypoint"}
          </span>

          ${this.mode==="view"&&e?s`
              ${e.status==="running"?s`<button class="pill-btn danger appbar-action" @click=${()=>this._handleStop()}>
                  ■ ${t("btnStop")}
                </button>`:s`<button class="pill-btn primary appbar-action" @click=${()=>this._handleStart()}>
                  ▶ ${t("btnStart")}
                </button>`}
            `:s`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${()=>this._handleSave()}>
                ${p("check")} ${t("btnSave")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&e?s`
            <div class="status-banner ${e.status}">
              <span class="status-dot-mini"></span>
              ${e.status==="running"?t("statusRunning"):e.status==="error"?t("statusError"):t("statusStopped")}
              ${e.error?s` — ${e.error}`:""}
              <span class="status-spacer"></span>
            </div>

            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${d} Entrypoint</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Created</span>
                  <span class="info-value text">${R(e.created_at)}</span>
                </div>
                ${this.entrypointType==="p2p"||this.entrypointType==="tun"?"":s`
                <div class="info-row">
                  <span class="info-label">Tunnel ID</span>
                  <span class="info-value uuid">${e.id??"—"}</span>
                  ${e.id?s`<button class="copy-btn-mini" @click=${()=>this._handleCopy(e.id)}>
                      ${p("copy")}
                    </button>`:""}
                </div>`}
                <div class="info-row">
                  <span class="info-label">Name</span>
                  <span class="info-value text">${e.name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">${this.entrypointType==="tun"?t("fieldNet"):"Bind Address"}</span>
                  <span class="info-value">${e.entrypoint}</span>
                </div>
                ${this.entrypointType==="tun"?s`
                    ${e.options?.mtu?s`<div class="info-row"><span class="info-label">${t("fieldMTU")}</span><span class="info-value text">${e.options.mtu}</span></div>`:""}
                    ${e.options?.device_name?s`<div class="info-row"><span class="info-label">${t("fieldDeviceName")}</span><span class="info-value text">${e.options.device_name}</span></div>`:""}
                    ${e.options?.routes?s`<div class="info-row"><span class="info-label">${t("fieldRoutes")}</span><span class="info-value text">${e.options.routes}</span></div>`:""}
                    ${e.options?.dns?s`<div class="info-row"><span class="info-label">${t("fieldDNS")}</span><span class="info-value text">${e.options.dns}</span></div>`:""}
                    <div class="info-row">
                      <span class="info-label">${t("entrypointPeerKey")}</span>
                      <span class="info-value">${this._showPeer?l:b(l)}</span>
                      ${l?s`<button class="copy-btn-mini" @click=${()=>this._handleCopy(l)}>
                          ${p("copy")}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer?t("hideKey"):t("revealKey")}"
                          @click=${()=>{this._showPeer=!this._showPeer}}>
                          ${p(this._showPeer?"eye-off":"eye")}
                        </button>`:""}
                    </div>
                    ${this._renderTransport(e.peer_transport)}
                    <div class="info-row">
                      <span class="info-label">${t("switchKeepalive")}</span>
                      <span class="info-value text">${e.options?.keepalive?t("statusRunning"):t("statusStopped")}${e.options?.ttl?` · ${e.options.ttl}s`:""}</span>
                    </div>
                    <div class="p2p-hint">${t("tunSpokeHint")}</div>
                  `:this.entrypointType==="p2p"?s`
                    <div class="info-row">
                      <span class="info-label">${t("entrypointPeerKey")}</span>
                      <span class="info-value">${this._showPeer?l:b(l)}</span>
                      ${l?s`<button class="copy-btn-mini" @click=${()=>this._handleCopy(l)}>
                          ${p("copy")}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer?t("hideKey"):t("revealKey")}"
                          @click=${()=>{this._showPeer=!this._showPeer}}>
                          ${p(this._showPeer?"eye-off":"eye")}
                        </button>`:""}
                    </div>
                    ${this._renderTransport(e.peer_transport)}
                    <div class="info-row">
                      <span class="info-label">${t("fieldProtocol")}</span>
                      <span class="info-value text">
                        ${(e.options?.protocol==="udp"?"udp":"tcp").toUpperCase()}
                      </span>
                    </div>
                    <div class="p2p-hint">${t("p2pEntryHint")}</div>
                  `:""}
              </div>

              <!-- Stats grid -->
              ${i?s`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${()=>this._handleResetStats("conns")} title="${t("btnResetStats")}">${p("rotate-cw")}</span></div>
                      <div class="stat-value">${v(i.total_conns)}</div>
                      <div class="stat-rate">${v(i.current_conns)} active · ${i.request_rate.toFixed(1)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${()=>this._handleResetStats("errors")} title="${t("btnResetStats")}">${p("rotate-cw")}</span></div>
                      <div class="stat-value">${v(i.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${()=>this._handleResetStats("output")} title="${t("btnResetOutput")}">${p("rotate-cw")}</span></div>
                      <div class="stat-value">${f(i.output_bytes)}</div>
                      <div class="stat-rate">${m(i.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${()=>this._handleResetStats("input")} title="${t("btnResetInput")}">${p("rotate-cw")}</span></div>
                      <div class="stat-value">${f(i.input_bytes)}</div>
                      <div class="stat-rate">${m(i.input_rate_bytes)}</div>
                    </div>
                  </div>
                `:""}
            </div>

            <div class="section">
              <button class="btn-edit-bottom" @click=${()=>this._enterEdit()}>
                ${p("edit")} ${t("btnEdit")}
              </button>
            </div>
          `:""}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode!=="view"?s`
            <div class="section">
              <div class="card" style="padding:16px;">
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <input class="form-input" readonly .value=${d+" Entrypoint"}>
                </div>

                <!-- What a tun entrypoint is and what it needs, before the fields
                     it implies: the device is the one thing here that can make
                     the save fail. -->
                ${this.entrypointType==="tun"?s`
                    <div class="p2p-hint warn">${t("tunPrivilegeHint")}</div>
                    <div class="p2p-hint">${t("tunSpokeHint")}</div>
                    <div class="p2p-hint">${t("tunKeepaliveHint")}</div>
                  `:""}

                <!-- A p2p or tun entrypoint has no tunnel id to route by. -->
                ${this.entrypointType==="p2p"||this.entrypointType==="tun"?"":s`
                <div class="form-group">
                  <label class="form-label">Tunnel ID</label>
                  <input class="form-input"
                    ?readonly=${this.mode==="edit"}
                    .value=${this._tunnelId}
                    placeholder="Paste tunnel UUID"
                    @input=${a=>{this._tunnelId=a.target.value}}>
                </div>`}

                <div class="form-group">
                  <label class="form-label">${t("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Entrypoint"
                    @input=${a=>{this._name=a.target.value}}>
                </div>

                ${this.entrypointType==="tun"?s`
                    <div class="form-group">
                      <label class="form-label">${t("fieldNet")}</label>
                      <input class="form-input" .value=${this._net} placeholder="10.10.0.2/24"
                        @input=${a=>{this._net=a.target.value}}>
                      <div class="p2p-hint">${t("fieldNetHint")}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t("fieldMTU")}</label>
                      <input class="form-input" type="number" .value=${this._mtu?String(this._mtu):""} placeholder="1420"
                        @input=${a=>{this._mtu=parseInt(a.target.value,10)||0}}>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t("fieldDeviceName")}</label>
                      <input class="form-input" .value=${this._deviceName} placeholder="wisper0"
                        @input=${a=>{this._deviceName=a.target.value}}>
                      <div class="p2p-hint">${t("fieldDeviceNameHint")}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t("fieldRoutes")}</label>
                      <input class="form-input" .value=${this._routes} placeholder="0.0.0.0/0"
                        @input=${a=>{this._routes=a.target.value}}>
                      <div class="p2p-hint">${t("fieldRoutesHint")}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t("fieldDNS")}</label>
                      <input class="form-input" .value=${this._dns} placeholder="10.10.0.1"
                        @input=${a=>{this._dns=a.target.value}}>
                    </div>
                  `:s`
                <div class="form-group">
                  <label class="form-label">${t("fieldBindAddress")}</label>
                  <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                    @input=${a=>{this._endpoint=a.target.value}}>
                </div>`}

                ${this.entrypointType==="p2p"||this.entrypointType==="tun"?s`
                    <div class="form-group">
                      <label class="form-label">${t("entrypointPeerKey")}</label>
                      <input class="form-input" .value=${this._peer} placeholder="Base64 public key"
                        @input=${a=>{this._peer=a.target.value}}>
                    </div>
                    ${this.entrypointType==="tun"?s`
                        <div class="switch-row">
                          <span class="switch-label">${t("switchKeepalive")}</span>
                          <div class="switch ${this._keepalive?"on":""}"
                            @click=${()=>{this._keepalive=!this._keepalive}}>
                            <div class="switch-knob"></div>
                          </div>
                        </div>
                        <div class="form-group">
                          <label class="form-label">${t("fieldTTL")}</label>
                          <input class="form-input" type="number" .value=${this._ttl?String(this._ttl):""} placeholder="15"
                            @input=${a=>{this._ttl=parseInt(a.target.value,10)||0}}>
                        </div>
                      `:""}
                    ${this.entrypointType==="p2p"?s`
                    <div class="switch-row" @click=${()=>{this._protocol=this._protocol==="tcp"?"udp":"tcp"}}>
                      <span class="switch-label">${t("fieldProtocol")}</span>
                      <span class="protocol-value">
                        ${this._protocol==="udp"?t("protocolUdp"):t("protocolTcp")}
                        ${p("chevron-right")}
                      </span>
                    </div>
                    ${this._protocol==="udp"?s`
                    <div class="switch-row">
                      <span class="switch-label">${t("switchKeepalive")}</span>
                      <div class="switch ${this._keepalive?"on":""}"
                        @click=${()=>{this._keepalive=!this._keepalive}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                    <div class="p2p-hint">${t("keepaliveHint")}</div>`:""}
                  `:""}
                  `:""}

                ${this.mode==="edit"?s`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${p("trash")} ${t("btnDelete")}
                      </button>
                    </div>
                  `:""}
              </div>
            </div>
          `:""}

        ${this._snackbar?s`<div class="toast">${this._snackbar}</div>`:""}

        ${this._showResetDialog?s`
            <div class="dialog-overlay" @click=${()=>{this._showResetDialog=!1}}>
              <div class="dialog-box" @click=${a=>a.stopPropagation()}>
                <div class="dialog-title">${t("resetStatsConfirmTitle")}</div>
                <div class="dialog-message">${t("resetStatsConfirm")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showResetDialog=!1}}>
                    ${t("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${()=>this._doResetStats()}>
                    ${t("btnResetStats")}
                  </button>
                </div>
              </div>
            </div>
          `:""}

        ${this._showDeleteDialog?s`
            <div class="dialog-overlay" @click=${()=>{this._showDeleteDialog=!1}}>
              <div class="dialog-box" @click=${a=>a.stopPropagation()}>
                <div class="dialog-title">${t("deleteConfirmTitle")}</div>
                <div class="dialog-message">${t("deleteConfirmMessage")}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${()=>{this._showDeleteDialog=!1}}>
                    ${t("btnCancel")}
                  </button>
                  <button class="dialog-btn danger" @click=${()=>this._handleDelete()}>
                    ${t("btnDelete")}
                  </button>
                </div>
              </div>
            </div>
          `:""}
      </app-scaffold>
    `}};o.styles=P`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }

    .appbar-btn {
      background: none; border: none; cursor: pointer;
      padding: 4px 8px; border-radius: var(--radius-sm);
      color: var(--text-secondary); font-size: var(--font-sm);
      display: flex; align-items: center; gap: 3px;
      font-family: inherit;
      transition: background var(--transition-fast);
    }
    .appbar-btn:hover { background: var(--border-subtle); }

    .pill-btn {
      padding: 5px 14px; border-radius: var(--radius-pill);
      border: none; cursor: pointer;
      font-size: var(--font-sm); font-weight: 500; font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pill-btn.primary { background: var(--accent); color: var(--accent-fg); }
    .pill-btn.danger { background: var(--red); color: #fff; }
    .pill-btn svg { width: 14px; height: 14px; }
    .pill-btn:hover { opacity: 0.85; }
    .pill-btn.appbar-action { margin-left: auto; }

    .section { padding: 16px; }

    .status-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; margin: 0 16px;
      border-radius: var(--radius-md); font-size: var(--font-sm); font-weight: 500;
    }
    .status-banner.running {
      background: var(--green-bg); color: var(--green-text);
      border: 1px solid var(--green-border);
    }
    .status-banner.stopped {
      background: var(--border-subtle); color: var(--text-muted);
    }
    .status-banner.error {
      background: var(--red-bg); color: var(--red-text);
      border: 1px solid var(--red-border);
    }

    .status-dot-mini {
      width: 6px; height: 6px; border-radius: 50%; background: currentColor;
    }
    .status-spacer { flex: 1; }

    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .info-row {
      display: flex; align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      gap: 16px;
    }
    .info-row:last-child { border-bottom: none; }

    /* Where a p2p entrypoint's peer traffic goes now. Same look as the peers page. */
    .peer-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 8px;
      border-radius: var(--radius-pill);
      background: var(--border-subtle);
      color: var(--text-muted);
      font-family: inherit;
      font-size: var(--font-sm);
    }
    .peer-badge svg {
      width: 12px;
      height: 12px;
    }
    .peer-badge.direct {
      color: var(--green-text);
      background: var(--green-bg);
    }
    .peer-badge.warn {
      color: var(--amber);
    }

    .info-label {
      font-size: var(--font-sm); font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px;
      width: 80px; flex-shrink: 0;
    }
    .info-value {
      font-size: var(--font-md); color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      flex: 1; word-break: break-all;
    }
    .info-value.text {
      font-family: inherit; font-size: var(--font-md);
    }
    .info-value.uuid {
      font-size: var(--font-sm);
    }

    .copy-btn-mini {
      background: none; border: none; cursor: pointer;
      padding: 2px; color: var(--text-muted); display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover { background: var(--border-subtle); color: var(--text); }

    .p2p-hint.warn {
      color: var(--red);
    }

    .p2p-hint {
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
      padding: 0 14px 10px;
    }

    /* ── Option rows (protocol, keepalive) ── */
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
    }
    .switch-label {
      font-size: var(--font-sm);
      color: var(--text);
    }
    .protocol-value {
      font-size: var(--font-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 4px;
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

    .form-group { margin-bottom: 14px; }
    .form-label {
      display: block;
      font-size: var(--font-sm); font-weight: 500; color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase; letter-spacing: 0.5px;
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
    .form-input[readonly] {
      background: var(--border-subtle); color: var(--text-muted);
    }

    .danger-zone {
      margin-top: 20px; padding: 14px;
      border: 1px solid var(--red-border);
      border-radius: var(--radius-md);
    }
    .danger-zone-label {
      font-size: var(--font-sm); font-weight: 600; color: var(--red-text);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
    }

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

    .dialog-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }
    @keyframes fade-in { from { opacity: 0; } }
    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px; max-width: 320px; width: 90%;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .dialog-title { font-weight: 600; font-size: var(--font-md); margin-bottom: 8px; text-align: center; }
    .dialog-message { color: var(--text-secondary); font-size: var(--font-sm); margin-bottom: 20px; text-align: center; line-height: 1.5; }
    .dialog-actions { display: flex; gap: 10px; justify-content: center; }
    .dialog-btn {
      padding: 8px 20px; border-radius: var(--radius-pill);
      border: none; cursor: pointer;
      font-size: var(--font-sm); font-weight: 500; font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .dialog-btn.cancel { background: var(--border-subtle); color: var(--text); }
    .dialog-btn.danger { background: var(--red); color: #fff; }
    .dialog-btn:hover { opacity: 0.85; }

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
  `;n([g()],o.prototype,"entrypointType",2);n([g()],o.prototype,"entrypointId",2);n([r()],o.prototype,"mode",2);n([r()],o.prototype,"_entrypoint",2);n([r()],o.prototype,"_saving",2);n([r()],o.prototype,"_snackbar",2);n([r()],o.prototype,"_showDeleteDialog",2);n([r()],o.prototype,"_showResetDialog",2);n([r()],o.prototype,"_name",2);n([r()],o.prototype,"_endpoint",2);n([r()],o.prototype,"_tunnelId",2);n([r()],o.prototype,"_peer",2);n([r()],o.prototype,"_showPeer",2);n([r()],o.prototype,"_protocol",2);n([r()],o.prototype,"_keepalive",2);n([r()],o.prototype,"_ttl",2);n([r()],o.prototype,"_net",2);n([r()],o.prototype,"_mtu",2);n([r()],o.prototype,"_deviceName",2);n([r()],o.prototype,"_routes",2);n([r()],o.prototype,"_dns",2);o=n([I("entrypoint-detail-page")],o);export{o as EntrypointDetailPage};
