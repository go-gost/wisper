const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-nIq6Lu3g.js","assets/index-BPj8V9nW.css"])))=>i.map(i=>d[i]);
import{a as x,v as b,h as k,d as T,A as c,c as e,b as i,_ as f,w as S,l as D,n as R,x as N,u as I,i as P,t as z}from"./index-nIq6Lu3g.js";import{d as E,m,c as u,a as _,b as g,n as w,r}from"./format-B5cr20MP.js";import{i as p}from"./app-scaffold-BqEgUbmc.js";import{a as C}from"./transport-D7kkHWE-.js";import{t as y,a as $}from"./vpn-BwIXiC7v.js";import{c as A}from"./clipboard-C3x8_sid.js";var M=Object.defineProperty,L=Object.getOwnPropertyDescriptor,o=(t,s,l,d)=>{for(var a=d>1?void 0:d?L(s,l):s,h=t.length-1,v;h>=0;h--)(v=t[h])&&(a=(d?v(s,l,a):v(a))||a);return d&&a&&M(s,l,a),a};let n=class extends x{constructor(){super(...arguments),this.entrypointType="tcp",this.entrypointId="",this._poll=0,this.mode="view",this._entrypoint=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._tunnelId="",this._peer="",this._showPeer=!1,this._showTransportDetail=!1,this._formId="",this._protocol="tcp",this._keepalive=!0,this._probe=!1,this._net="",this._mtu=0,this._deviceName="",this._routes="",this._dns="",this._shareLAN="",this._shareMode="auto",this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._poll=window.setInterval(()=>{b()},5e3),this._unsubs.push(k(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){window.clearInterval(this._poll),this._poll=0,super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_load(){const t=this.entrypointId,s=window.location.search.includes("edit");if(t==="new"||!t){if(this.mode==="create")return;this.mode="create",this._entrypoint=null,this._resetForm();return}if(this.mode==="edit"&&this._entrypoint?.id===t)return;const l=T().find(d=>d.id===t);l&&(this._entrypoint=l,s?(this.mode="edit",this._populateForm(l)):(this.mode!=="edit"||this._entrypoint?.id!==t)&&(this.mode="view",this._populateForm(l)))}_resetForm(){this._name="",this._endpoint="",this._tunnelId="",this._peer="",this._formId="",this._showTransportDetail=!1,this._protocol="tcp",this._keepalive=!0,this._probe=!1,this._net="",this._mtu=0,this._deviceName="",this._routes="",this._dns="",this._shareLAN="",this._shareMode="auto"}_populateForm(t){this._name=t.name,this._endpoint=t.entrypoint,this._tunnelId=t.id??"",this._peer=t.options?.peer??"",this._formId!==t.id&&(this._formId=t.id??"",this._showTransportDetail=!1),this._protocol=t.options?.protocol==="udp"?"udp":"tcp",this._keepalive=t.options?.keepalive??!0,this._probe=t.options?.probe??!1,this._net=t.options?.net??"",this._mtu=t.options?.mtu??0,this._deviceName=t.options?.device_name??"",this._routes=t.options?.routes??"",this._dns=t.options?.dns??"",this._shareLAN=t.options?.share_lan??"",this._shareMode=t.options?.share_mode||"auto"}_renderTransport(t){const s=C(t.peer_transport);return s?i`
      <div class="info-row">
        <span class="info-label">${e("p2pTransport")}</span>
        <span class="info-value text transport-value">
          <span class="peer-badge ${s.tone}" title=${s.hint}>
            ${p(s.icon)}<span>${s.label}</span>
          </span>
          ${t.peer_kcp_live&&(t.peer_rtt_ms??0)>0?i`<span class="peer-rtt" title="${e("peersRTTHint")} · ${t.peer_transport??""}">${t.peer_rtt_ms}ms</span>`:c}
          <button class="detail-btn" title=${e("p2pTransportDetail")}
            aria-label=${e("p2pTransportDetail")} aria-expanded=${this._showTransportDetail?"true":"false"}
            @click=${()=>{this._showTransportDetail=!this._showTransportDetail}}>
            ${p("info")}
          </button>
        </span>
      </div>
      ${this._showTransportDetail?i`
          <div class="info-row detail-row">
            <span class="info-label"></span>
            <span class="info-value text detail-text">
              ${e("p2pTransportConnected")}${s.why?` · ${s.why}`:` · ${e("p2pTransportHint")}`}
            </span>
          </div>
          <!-- The round trip behind the inline number, in full. Only a live
               KCP session reports it. -->
          ${t.peer_kcp_live?i`
              <div class="info-row detail-row">
                <span class="info-label">${e("peersDiagSRTT")}</span>
                <span class="info-value text detail-text">${t.peer_rtt_ms??0}ms</span>
              </div>
              <div class="info-row detail-row">
                <span class="info-label">${e("peersDiagRTO")}</span>
                <span class="info-value text detail-text">${t.peer_rto_ms??0}ms</span>
              </div>
              <div class="info-row detail-row">
                <span class="info-label">${e("peersDiagRTTVar")}</span>
                <span class="info-value text detail-text">${t.peer_rttvar_ms??0}ms</span>
              </div>
            `:c}
        `:c}
    `:c}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_latestEventLine(t){const s=(t??[])[0];if(!s)return e("eventsEntryDesc");const l=s.count||1;return l>1?`${s.message} ×${l}`:s.message}_hubNoReflow(t){for(const s of t??[]){if(s.message.includes("uplink without downlink"))return!0;if(s.message.includes("downlink recovered"))return!1}return!1}_enterEdit(){this._entrypoint&&(this._populateForm(this._entrypoint),this.mode="edit")}_handleBack(){if(this.mode==="edit"&&this.entrypointId){this.mode="view",this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}`);return}this._navigate("/")}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleSave(){if(!this._name.trim()){this._showSnackbar(e("requiredField"));return}if(this.entrypointType==="tun"){const t=y(this.entrypointId);if(t){this._showSnackbar(`${e("tunDeviceBusy")}: ${t.name}`);return}if(!await $(this._net.trim(),this._routes.trim(),this._mtu||0,this._dns.trim())){this._showSnackbar(e("vpnNotReady"));return}}this._saving=!0;try{const t={name:this._name.trim(),type:this.entrypointType,endpoint:this.entrypointType==="tun"?"":this._endpoint.trim(),id:this._tunnelId.trim()||void 0,peer:this._peer.trim()||void 0,protocol:this.entrypointType==="p2p"?this._protocol:void 0,keepalive:this.entrypointType==="p2p"&&this._protocol==="udp"?this._keepalive:void 0,probe:this.entrypointType==="tun"?this._probe:void 0,net:this.entrypointType==="tun"&&this._net.trim()||void 0,mtu:this.entrypointType==="tun"&&this._mtu||void 0,device_name:this.entrypointType==="tun"&&this._deviceName.trim()||void 0,routes:this.entrypointType==="tun"&&this._routes.trim()||void 0,dns:this.entrypointType==="tun"&&this._dns.trim()||void 0,share_lan:this.entrypointType==="tun"&&this._shareLAN.trim()||void 0,share_mode:this.entrypointType==="tun"&&this._shareMode||void 0};this.mode==="create"?(await f(()=>import("./index-nIq6Lu3g.js").then(s=>s.H),__vite__mapDeps([0,1])).then(s=>s.create(t)),this._showSnackbar(e("saved")),this._navigate("/")):(await f(()=>import("./index-nIq6Lu3g.js").then(s=>s.H),__vite__mapDeps([0,1])).then(s=>s.update(this.entrypointId,t)),this._showSnackbar(e("saved")),this.mode="view",await b())}catch(t){const s=t instanceof Error?t.message:"";this._showSnackbar(`${e("saveFailed")}${s?": "+s:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await S(this.entrypointId),this._showSnackbar(e("deleted")),this._navigate("/")}catch{this._showSnackbar(e("deleteFailed"))}}async _handleStart(){if(this.entrypointType==="tun"){const t=y(this.entrypointId);if(t){this._showSnackbar(`${e("tunDeviceBusy")}: ${t.name}`);return}const s=this._entrypoint?.options;if(!await $(s?.net??"",s?.routes??"",s?.mtu??0,s?.dns??"")){this._showSnackbar(e("vpnNotReady"));return}}try{await D(this.entrypointId),this._showSnackbar(e("started"))}catch(t){const s=t instanceof Error?t.message:"";this._showSnackbar(`${e("startFailed")}${s?": "+s:""}`)}}async _handleStop(){try{await R(this.entrypointId),this._showSnackbar(e("stopped"))}catch{this._showSnackbar(e("stopFailed"))}}async _handleCopy(t){await A(t),this._showSnackbar(e("copiedToClipboard"))}_handleResetStats(t){this._resetKind=t,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await N(this.entrypointId,this._resetKind),this._entrypoint&&I(this.entrypointId,this._entrypoint.stats),this._showSnackbar(e("saved"))}catch{this._showSnackbar(e("saveFailed"))}}_typeLabel(){return this.entrypointType.toUpperCase()}_cycleOption(t,s){const l=s.indexOf(t);return s[(l+1)%s.length]}_shareModeLabel(t){switch(t){case"kernel":return e("shareModeKernel");case"userspace":return e("shareModeUserspace");default:return e("shareModeAuto")}}render(){const t=this._entrypoint,s=t?t.stats:null,l=this._typeLabel(),d=t?.options?.peer??"";return i`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._handleBack()}>
            ${p("chevron-left")}
          </button>
          <span class="page-title">
            ${this.mode==="create"?`${e("entrypointNewTitle")} — ${l}`:l+" Entrypoint"}
          </span>

          ${this.mode==="view"&&t?i`
              ${t.status==="running"?i`<button class="pill-btn danger appbar-action" @click=${()=>this._handleStop()}>
                  ■ ${e("btnStop")}
                </button>`:i`<button class="pill-btn primary appbar-action" @click=${()=>this._handleStart()}>
                  ▶ ${e("btnStart")}
                </button>`}
            `:i`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${()=>this._handleSave()}>
                ${p("check")} ${e("btnSave")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&t?i`
            <div class="status-banner ${t.status}">
              <span class="status-dot-mini"></span>
              ${t.status==="running"?e("statusRunning"):t.status==="error"?e("statusError"):e("statusStopped")}
              ${t.error?i` — ${t.error}`:""}
              <span class="status-spacer"></span>
            </div>
            <!-- Running yet one-way: uplink without downlink, still on. The
                 events derive it (see _hubNoReflow), so the banner survives
                 the instantaneous rates flickering and clears on recovery. -->
            ${this.entrypointType==="tun"&&t.status==="running"&&this._hubNoReflow(t.events)?i`
                <div class="status-banner degraded" @click=${()=>this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}/events`)}>
                  <span class="status-dot-mini"></span>
                  <div style="flex:1;">
                    <div>${e("hubNoReflowTitle")}</div>
                    <div class="degraded-hint">${e("hubNoReflowHint")}</div>
                  </div>
                  <span style="color:var(--text-muted);">&rarr;</span>
                </div>
              `:c}

            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${l} Entrypoint</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Created</span>
                  <span class="info-value text">${E(t.created_at)}</span>
                </div>
                ${this.entrypointType==="p2p"||this.entrypointType==="tun"?"":i`
                <div class="info-row">
                  <span class="info-label">Tunnel ID</span>
                  <span class="info-value uuid">${t.id??"—"}</span>
                  ${t.id?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(t.id)}>
                      ${p("copy")}
                    </button>`:""}
                </div>`}
                <div class="info-row">
                  <span class="info-label">Name</span>
                  <span class="info-value text">${t.name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">${this.entrypointType==="tun"?e("fieldNet"):"Bind Address"}</span>
                  <span class="info-value">${t.entrypoint}</span>
                </div>
                ${this.entrypointType==="tun"?i`
                    ${t.options?.mtu?i`<div class="info-row"><span class="info-label">${e("fieldMTU")}</span><span class="info-value text">${t.options.mtu}</span></div>`:""}
                    ${t.options?.device_name?i`<div class="info-row"><span class="info-label">${e("fieldDeviceName")}</span><span class="info-value text">${t.options.device_name}</span></div>`:""}
                    <!-- What this spoke asked to share, and what its hub
                         actually approved: the two are not the same value, and
                         only the second reaches the hub's peers. A hub that
                         approved nothing has no routes row at all. -->
                    ${t.options?.share_lan?i`<div class="info-row"><span class="info-label">${e("fieldShareLAN")}</span><span class="info-value text">${t.options.share_lan}</span></div>`:""}
                    ${t.lan_routes?.length?i`<div class="info-row"><span class="info-label">${e("fieldLANRoutes")}</span><span class="info-value text">${t.lan_routes.join(", ")}</span></div>`:""}
                    ${t.options?.routes?i`<div class="info-row"><span class="info-label">${e("fieldRoutes")}</span><span class="info-value text">${t.options.routes}</span></div>`:""}
                    ${t.options?.dns?i`<div class="info-row"><span class="info-label">${e("fieldDNS")}</span><span class="info-value text">${t.options.dns}</span></div>`:""}
                    <div class="info-row">
                      <span class="info-label">${e("entrypointPeerKey")}</span>
                      <span class="info-value ${this._showPeer?"":"masked"}">${this._showPeer?d:m(d)}</span>
                      ${d?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(d)}>
                          ${p("copy")}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer?e("hideKey"):e("revealKey")}"
                          @click=${()=>{this._showPeer=!this._showPeer}}>
                          ${p(this._showPeer?"eye-off":"eye")}
                        </button>`:""}
                    </div>
                    ${this._renderTransport(t)}
                    <div class="p2p-hint">${e("tunPeerHint")}</div>
                  `:this.entrypointType==="p2p"?i`
                    <div class="info-row">
                      <span class="info-label">${e("entrypointPeerKey")}</span>
                      <span class="info-value ${this._showPeer?"":"masked"}">${this._showPeer?d:m(d)}</span>
                      ${d?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(d)}>
                          ${p("copy")}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer?e("hideKey"):e("revealKey")}"
                          @click=${()=>{this._showPeer=!this._showPeer}}>
                          ${p(this._showPeer?"eye-off":"eye")}
                        </button>`:""}
                    </div>
                    ${this._renderTransport(t)}
                    <div class="info-row">
                      <span class="info-label">${e("fieldProtocol")}</span>
                      <span class="info-value text">
                        ${(t.options?.protocol==="udp"?"udp":"tcp").toUpperCase()}
                      </span>
                    </div>
                    <div class="p2p-hint">${e("p2pEntryHint")}</div>
                  `:""}
              </div>

              <!-- Stats grid -->
              ${s?i`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${()=>this._handleResetStats("conns")} title="${e("btnResetStats")}">${p("rotate-cw")}</span></div>
                      <div class="stat-value">${u(s.total_conns)}</div>
                      <div class="stat-rate">${u(s.current_conns)} active · ${s.request_rate.toFixed(2)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${()=>this._handleResetStats("errors")} title="${e("btnResetStats")}">${p("rotate-cw")}</span></div>
                      <div class="stat-value">${u(s.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${()=>this._handleResetStats("output")} title="${e("btnResetOutput")}">${p("rotate-cw")}</span></div>
                      <div class="stat-value">${_(s.output_bytes)}</div>
                      <div class="stat-rate">${g(s.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${()=>this._handleResetStats("input")} title="${e("btnResetInput")}">${p("rotate-cw")}</span></div>
                      <div class="stat-value">${_(s.input_bytes)}</div>
                      <div class="stat-rate">${g(s.input_rate_bytes)}</div>
                    </div>
                  </div>
                `:""}
            </div>

            ${this.mode==="view"&&this._entrypoint?i`
                <div class="section">
                  <div class="card" style="padding:0;">
                    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;"
                      @click=${()=>this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}/events`)}>
                      <span style="color:var(--accent);">${p("activity")}</span>
                      <div style="flex:1;">
                        <div style="font-size:var(--font-sm);font-weight:600;">${e("eventsEntryTitle")}</div>
                        <div style="font-size:var(--font-sm);color:var(--text-muted);">
                          ${this._latestEventLine(this._entrypoint.events)}
                        </div>
                      </div>
                      <span style="color:var(--text-muted);">&rarr;</span>
                    </div>
                  </div>
                </div>
              `:c}

            <div class="section">
              <button class="btn-edit-bottom" @click=${()=>this._enterEdit()}>
                ${p("edit")} ${e("btnEdit")}
              </button>
            </div>
          `:""}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode!=="view"?i`
            <div class="section">
              <div class="card" style="padding:16px;">
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <input class="form-input" readonly .value=${l+" Entrypoint"}>
                </div>

                <!-- What a tun entrypoint is and what it needs, before the fields
                     it implies: the device is the one thing here that can make
                     the save fail. -->
                ${this.entrypointType==="tun"?i`
                    <div class="p2p-hint warn">${e("tunPrivilegeHint")}</div>
                    <div class="p2p-hint">${e("tunPeerHint")}</div>
                  `:""}

                <!-- A p2p or tun entrypoint has no tunnel id to route by. -->
                ${this.entrypointType==="p2p"||this.entrypointType==="tun"?"":i`
                <div class="form-group">
                  <label class="form-label">Tunnel ID</label>
                  <input class="form-input"
                    ?readonly=${this.mode==="edit"}
                    .value=${this._tunnelId}
                    placeholder="Paste tunnel UUID"
                    @input=${a=>{this._tunnelId=a.target.value}}>
                </div>`}

                <div class="form-group">
                  <label class="form-label">${e("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Entrypoint"
                    @input=${a=>{this._name=a.target.value}}>
                </div>

                ${this.entrypointType==="tun"?i`
                    <div class="form-group">
                      <label class="form-label">${e("fieldNet")}</label>
                      <input class="form-input" .value=${this._net} placeholder="10.10.0.2/24"
                        @input=${a=>{this._net=a.target.value}}>
                      <!-- What makes the two ends agree. The hub's assignment
                           lives on the hub's own peers page, which this page has
                           no view of — it knows only the net being typed here and
                           the hub's key — so the hint points there rather than
                           restating a subnet it cannot know. -->
                      <div class="p2p-hint">${e("tunNetMatchesHub")}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${e("fieldMTU")}</label>
                      <input class="form-input" type="number" .value=${this._mtu?String(this._mtu):""} placeholder="1420"
                        @input=${a=>{this._mtu=parseInt(a.target.value,10)||0}}>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${e("fieldDeviceName")}</label>
                      <input class="form-input" .value=${this._deviceName} placeholder="wisper0"
                        @input=${a=>{this._deviceName=a.target.value}}>
                      <div class="p2p-hint">${e("fieldDeviceNameHint")}</div>
                    </div>
                    <!-- LAN sharing: the subnets of this node's own LAN that the
                         hub may let its peers reach, and the backend that would
                         run them. What actually reaches the peers is the hub's
                         decision, shown below the form on the routes row. -->
                    <div class="form-group">
                      <label class="form-label">${e("fieldShareLAN")}</label>
                      <input class="form-input" .value=${this._shareLAN} placeholder="192.168.1.0/24"
                        @input=${a=>{this._shareLAN=a.target.value}}>
                      <div class="p2p-hint">${e("fieldShareLANHint")}</div>
                    </div>
                    <div class="switch-row" @click=${()=>{this._shareMode=this._cycleOption(this._shareMode,[...n.SHARE_MODES]),this.requestUpdate()}}>
                      <span class="switch-label">${e("fieldShareMode")}</span>
                      <span class="protocol-value">
                        ${this._shareModeLabel(this._shareMode)}
                        ${p("chevron-right")}
                      </span>
                    </div>
                    <div class="p2p-hint">${e("fieldShareModeHint")}</div>
                    <div class="form-group">
                      <label class="form-label">${e("fieldRoutes")}</label>
                      <input class="form-input" .value=${this._routes} placeholder="0.0.0.0/0"
                        @input=${a=>{this._routes=a.target.value}}>
                      <div class="p2p-hint">${e("fieldRoutesHint")}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${e("fieldDNS")}</label>
                      <input class="form-input" .value=${this._dns} placeholder="10.10.0.1"
                        @input=${a=>{this._dns=a.target.value}}>
                    </div>
                    <div class="switch-row">
                      <span class="switch-label">${e("switchProbe")}</span>
                      <div class="switch ${this._probe?"on":""}"
                        @click=${()=>{this._probe=!this._probe}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                    <div class="p2p-hint">${e("probeHint")}</div>
                  `:i`
                <div class="form-group">
                  <label class="form-label">${e("fieldBindAddress")}</label>
                  <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                    @input=${a=>{this._endpoint=a.target.value}}>
                </div>`}

                ${this.entrypointType==="p2p"||this.entrypointType==="tun"?i`
                    <div class="form-group">
                      <label class="form-label">${e("entrypointPeerKey")}</label>
                      <input class="form-input" .value=${this._peer} placeholder="Base64 public key"
                        @input=${a=>{this._peer=a.target.value}}>
                    </div>
                    <!-- No keepalive, no ttl: this entrypoint reaches its hub
                         over p2p and nothing else, the handshake that registers
                         its address is sent either way, and a hub's route table
                         has no TTL to refresh. Both controls would set values
                         nothing reads. See tunnel/entrypoint/tun.go. -->
                    ${this.entrypointType==="p2p"?i`
                    <div class="switch-row" @click=${()=>{this._protocol=this._protocol==="tcp"?"udp":"tcp"}}>
                      <span class="switch-label">${e("fieldProtocol")}</span>
                      <span class="protocol-value">
                        ${this._protocol==="udp"?e("protocolUdp"):e("protocolTcp")}
                        ${p("chevron-right")}
                      </span>
                    </div>
                    ${this._protocol==="udp"?i`
                    <div class="switch-row">
                      <span class="switch-label">${e("switchKeepalive")}</span>
                      <div class="switch ${this._keepalive?"on":""}"
                        @click=${()=>{this._keepalive=!this._keepalive}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                    <div class="p2p-hint">${e("keepaliveHint")}</div>`:""}
                  `:""}
                  `:""}

                ${this.mode==="edit"?i`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${p("trash")} ${e("btnDelete")}
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
    `}};n.SHARE_MODES=["auto","kernel","userspace"];n.styles=P`
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
    /* Running yet one-way (see the degraded banner below the status): amber,
       not red — the entrypoint itself is healthy, it is the far side that is
       not returning traffic. */
    .status-banner.degraded {
      margin-top: 8px; cursor: pointer;
      background: color-mix(in srgb, var(--amber) 12%, transparent);
      color: var(--amber);
      border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent);
    }
    .degraded-hint {
      font-weight: 400; font-size: var(--font-xs); line-height: 1.5;
      opacity: 0.9; margin-top: 2px;
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
    .peer-badge.info {
      color: var(--info);
      background: var(--info-bg);
    }
    .peer-badge.warn {
      color: var(--amber);
    }

    /* The peer's measured round-trip time, beside the badge it was measured
       over: quiet, small — the same look the peer rows use. */
    .peer-rtt {
      font-size: var(--font-xs);
      color: var(--text-muted);
    }

    /* The badge and its ⓘ on one centered line. */
    .transport-value { display: flex; align-items: center; gap: 6px; }

    /* The badge's ⓘ: what the word means for the connection, shown on tap
       because a phone has no hover for the badge's own tooltip. */
    .detail-btn {
      background: none; border: none; cursor: pointer;
      padding: 2px; color: var(--text-muted);
      display: inline-flex; border-radius: 3px;
    }
    .detail-btn:hover { background: var(--border-subtle); color: var(--text); }
    .detail-btn svg { width: 14px; height: 14px; }
    .detail-row { padding-top: 0; border-bottom: none; }
    .detail-text { color: var(--text-muted); font-size: var(--font-xs); line-height: 1.5; }

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
    /* A hidden key stays one line however long it is (a masked key is as long as
       the key, which is three lines on a phone); revealed, it wraps in full.
       min-width:0 is what lets the flex item shrink enough to ellipsize. */
    .info-value.masked {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      min-width: 0;
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

    .p2p-hint {
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
      padding: 0 14px 10px;
    }

    /* Same as the tun hub form's, which is the only other place a privilege
       hint is shown: a warning that is not yet an error (the user may be root,
       or in a container with CAP_NET_ADMIN), so red rather than anything
       heavier. Identical rule on both pages on purpose. */
    .p2p-hint.warn {
      color: var(--red);
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
  `;o([w()],n.prototype,"entrypointType",2);o([w()],n.prototype,"entrypointId",2);o([r()],n.prototype,"mode",2);o([r()],n.prototype,"_entrypoint",2);o([r()],n.prototype,"_saving",2);o([r()],n.prototype,"_snackbar",2);o([r()],n.prototype,"_showDeleteDialog",2);o([r()],n.prototype,"_showResetDialog",2);o([r()],n.prototype,"_name",2);o([r()],n.prototype,"_endpoint",2);o([r()],n.prototype,"_tunnelId",2);o([r()],n.prototype,"_peer",2);o([r()],n.prototype,"_showPeer",2);o([r()],n.prototype,"_showTransportDetail",2);o([r()],n.prototype,"_protocol",2);o([r()],n.prototype,"_keepalive",2);o([r()],n.prototype,"_probe",2);o([r()],n.prototype,"_net",2);o([r()],n.prototype,"_mtu",2);o([r()],n.prototype,"_deviceName",2);o([r()],n.prototype,"_routes",2);o([r()],n.prototype,"_dns",2);o([r()],n.prototype,"_shareLAN",2);o([r()],n.prototype,"_shareMode",2);n=o([z("entrypoint-detail-page")],n);export{n as EntrypointDetailPage};
