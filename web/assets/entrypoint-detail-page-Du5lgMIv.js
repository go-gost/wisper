const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-CYOSUTk3.js","assets/index-BPj8V9nW.css"])))=>i.map(i=>d[i]);
import{a as w,G as k,v as f,h as T,d as D,c as t,A as h,b as i,_ as b,w as R,l as S,n as E,x as I,u as z,i as P,t as q}from"./index-CYOSUTk3.js";import{e as C,d as A,m,c as v,a as g,b as _,n as $,r as l}from"./format-BMdjvVtd.js";import{i as d}from"./app-scaffold-jLAotM97.js";import{t as N}from"./type-icons-DvFgXXJ2.js";import{a as L}from"./transport-DhmjNL1Z.js";import{t as y,a as x}from"./vpn-C5ZdLyR6.js";import{c as F}from"./clipboard-C3x8_sid.js";import{r as M}from"./entrypoint-request-BlTsP51B.js";var O=Object.defineProperty,H=Object.getOwnPropertyDescriptor,o=(e,s,n,p)=>{for(var c=p>1?void 0:p?H(s,n):s,a=e.length-1,u;a>=0;a--)(u=e[a])&&(c=(p?u(s,n,c):u(c))||c);return p&&c&&O(s,n,c),c};let r=class extends w{constructor(){super(...arguments),this.entrypointType="tcp",this.entrypointId="",this._poll=0,this._requestBackend=new k,this._latestRequestFor="",this.mode="view",this._entrypoint=null,this._latestRequest=null,this._saving=!1,this._snackbar="",this._showDeleteDialog=!1,this._showResetDialog=!1,this._resetKind="",this._name="",this._endpoint="",this._tunnelId="",this._peer="",this._showPeer=!1,this._showTransportDetail=!1,this._formId="",this._protocol="tcp",this._keepalive=!0,this._net="",this._mtu=0,this._deviceName="",this._routes="",this._dns="",this._rules="",this._rulesSearch="",this._newRule="",this._rulesEditorOpen=!1,this._rulesDraft="",this._rulesEditorTrigger=null,this._shareLAN="",this._shareMode="auto",this._direct=!1,this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._load(),this._poll=window.setInterval(()=>{f()},5e3),this._unsubs.push(T(()=>{this._load(),this.requestUpdate()}))}disconnectedCallback(){window.clearInterval(this._poll),this._poll=0,this._setRulesBackgroundInert(!1),super.disconnectedCallback();for(const e of this._unsubs)e();this._unsubs=[]}updated(e){e.has("_rulesEditorOpen")&&(this._setRulesBackgroundInert(this._rulesEditorOpen),this._rulesEditorOpen?this.renderRoot.querySelector(".rules-bulk-textarea")?.focus():(this._rulesEditorTrigger?.focus(),this._rulesEditorTrigger=null))}_load(){const e=this.entrypointId,s=window.location.search.includes("edit");if(e==="new"||!e){if(this.mode==="create")return;this.mode="create",this._entrypoint=null,this._latestRequest=null,this._latestRequestFor="",this._resetForm();return}if(this.mode==="edit"&&this._entrypoint?.id===e)return;const n=D().find(p=>p.id===e);n&&(this._entrypoint=n,this._loadLatestRequest(n),s?(this.mode="edit",this._populateForm(n)):(this.mode!=="edit"||this._entrypoint?.id!==e)&&(this.mode="view",this._populateForm(n)))}_loadLatestRequest(e){this.entrypointType!=="tungo"||this._latestRequestFor===e.id||(this._latestRequestFor=e.id,this._latestRequest=null,this._requestBackend.getEntrypointRequests(e.id,1).then(s=>{this._latestRequestFor===e.id&&(this._latestRequest=s.requests?.[0]??null)}).catch(()=>{this._latestRequestFor===e.id&&(this._latestRequest=null)}))}_resetForm(){this._name="",this._endpoint="",this._tunnelId="",this._peer="",this._formId="",this._showTransportDetail=!1,this._protocol="tcp",this._keepalive=!0,this._net="",this._mtu=0,this._deviceName="",this._routes="",this._dns="",this._rules="",this._rulesSearch="",this._newRule="",this._rulesEditorOpen=!1,this._rulesDraft="",this._rulesEditorTrigger=null,this._shareLAN="",this._shareMode="auto",this._direct=!1}_populateForm(e){this._name=e.name,this._endpoint=e.entrypoint,this._tunnelId=e.id??"",this._peer=e.options?.peer??"",this._formId!==e.id&&(this._formId=e.id??"",this._showTransportDetail=!1),this._protocol=e.options?.protocol==="udp"?"udp":"tcp",this._keepalive=e.options?.keepalive??!0,this._net=e.options?.net??"",this._mtu=e.options?.mtu??0,this._deviceName=e.options?.device_name??"",this._routes=e.options?.routes??"",this._dns=e.options?.dns??"",this._rules=(e.options?.rules??[]).join(`
`),this._shareLAN=e.options?.share_lan??"",this._shareMode=e.options?.share_mode||"auto",this._direct=e.options?.direct===!0}_ruleLines(){return this._rules.split(`
`).map((e,s)=>({line:s,value:e.trim()})).filter(e=>e.value!=="")}_ruleCountLabel(e=this._rules){const s=e.split(`
`).map(n=>n.trim()).filter(Boolean).length;return s?t("rulesCount",{n:s}):t("rulesEmptyDirect")}_matchingRules(){const e=this._rulesSearch.trim().toLocaleLowerCase();return e?this._ruleLines().filter(s=>s.value.toLocaleLowerCase().includes(e)).slice(0,50):[]}_removeRule(e){const s=this._rules.split(`
`);s.splice(e,1),this._rules=s.join(`
`)}_addRule(){const e=this._newRule.trim();if(!e||this._ruleLines().some(n=>n.value===e)){this._newRule="";return}const s=this._rules.trimEnd();this._rules=s?`${s}
${e}`:e,this._newRule=""}_openRulesEditor(e){this._rulesEditorTrigger=e.currentTarget,this._rulesDraft=this._rules,this._rulesEditorOpen=!0}_closeRulesEditor(e){e&&(this._rules=this._rulesDraft),this._rulesEditorOpen=!1}_setRulesBackgroundInert(e){this.renderRoot.querySelector("app-scaffold")?.toggleAttribute("inert",e)}_handleRulesEditorKeydown(e){if(e.key==="Escape"){e.preventDefault(),this._closeRulesEditor(!1);return}if(e.key!=="Tab")return;const s=this.renderRoot.querySelector(".rules-editor-panel");if(!s)return;const n=Array.from(s.querySelectorAll('textarea:not([disabled]), input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'));if(!n.length)return;const p=s.getRootNode().activeElement,c=n[0],a=n[n.length-1];e.shiftKey&&p===c?(e.preventDefault(),a.focus()):!e.shiftKey&&p===a&&(e.preventDefault(),c.focus())}_renderTransport(e){if(e.status!=="running")return h;const s=L(e.peer_transport);return s?i`
      <div class="info-row">
        <span class="info-label">${t("p2pTransport")}</span>
        <span class="info-value text transport-value">
          <span class="peer-badge ${s.tone}" title=${s.hint}>
            ${d(s.icon)}<span>${s.label}</span>
          </span>
          ${(e.peer_rtt_live??e.peer_kcp_live)&&(e.peer_rtt_ms??0)>0?i`<span class="peer-rtt" title="${t("peersRTTHint")} · ${e.peer_transport??""}">${e.peer_rtt_ms}ms</span>`:h}
          <button class="detail-btn" title=${t("p2pTransportDetail")}
            aria-label=${t("p2pTransportDetail")} aria-expanded=${this._showTransportDetail?"true":"false"}
            @click=${()=>{this._showTransportDetail=!this._showTransportDetail}}>
            ${d("info")}
          </button>
        </span>
      </div>
      ${this._showTransportDetail?i`
          <div class="info-row detail-row">
            <span class="info-label"></span>
            <span class="info-value text detail-text">
              ${s.lead}${s.why?` · ${s.why}`:` · ${t("p2pTransportHint")}`}
            </span>
          </div>
          <!-- The round trip behind the inline number, in full. QUIC reports
               only the RTT; the KCP-only retransmit timeout and variance stay
               with a live KCP session so QUIC is not shown a false zero. -->
          ${(e.peer_rtt_live??e.peer_kcp_live)&&(e.peer_rtt_ms??0)>0?i`
              <div class="info-row detail-row">
                <span class="info-label">${t("peersDiagRTT")}</span>
                <span class="info-value text detail-text">${e.peer_rtt_ms}ms</span>
              </div>
            `:h}
          ${e.peer_kcp_live?i`
              <div class="info-row detail-row">
                <span class="info-label">${t("peersDiagRTO")}</span>
                <span class="info-value text detail-text">${e.peer_rto_ms??0}ms</span>
              </div>
              <div class="info-row detail-row">
                <span class="info-label">${t("peersDiagRTTVar")}</span>
                <span class="info-value text detail-text">${e.peer_rttvar_ms??0}ms</span>
              </div>
            `:h}
        `:h}
    `:h}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}_latestEventLine(e){const s=(e??[])[0];if(!s)return t("eventsEntryDesc");const n=s.count||1;return n>1?`${s.message} ×${n}`:s.message}_latestRequestLine(){const e=this._latestRequest;return e?t("requestsEntryLatest",{time:C(Date.parse(e.time)),destination:M(e),route:e.tunneled?t("requestsTunnel"):t("requestsDirect")}):t("requestsEntryDesc")}_hubNoReflow(e){for(const s of e??[]){if(s.message.includes("uplink without downlink"))return!0;if(s.message.includes("downlink recovered"))return!1}return!1}_enterEdit(){this._entrypoint&&(this._populateForm(this._entrypoint),this.mode="edit")}_handleBack(){if(this.mode==="edit"&&this.entrypointId){this.mode="view",this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}`);return}this._navigate("/")}_showSnackbar(e){this._snackbar=e,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}get _usesDevice(){return this.entrypointType==="tun"||this.entrypointType==="tungo"}async _handleSave(){if(!this._name.trim()){this._showSnackbar(t("requiredField"));return}if((this.entrypointType==="p2p"||this._usesDevice)&&!this._peer.trim()){this._showSnackbar(`${t("entrypointPeerKey")}: ${t("requiredField")}`);return}if(this._usesDevice){const e=y(this.entrypointId);if(e){this._showSnackbar(`${t("tunDeviceBusy")}: ${e.name}`);return}if(!await x(this._net.trim(),this._routes.trim(),this._mtu||0,this._dns.trim())){this._showSnackbar(t("vpnNotReady"));return}}this._saving=!0;try{const e={name:this._name.trim(),type:this.entrypointType,endpoint:this._usesDevice?"":this._endpoint.trim(),id:this._tunnelId.trim()||void 0,peer:this._peer.trim()||void 0,protocol:this.entrypointType==="p2p"?this._protocol:void 0,keepalive:this.entrypointType==="p2p"&&this._protocol==="udp"?this._keepalive:void 0,net:this._usesDevice&&this._net.trim()||void 0,mtu:this._usesDevice&&this._mtu||void 0,device_name:this._usesDevice&&this._deviceName.trim()||void 0,routes:this._usesDevice&&this._routes.trim()||void 0,dns:this._usesDevice&&this._dns.trim()||void 0,share_lan:this.entrypointType==="tun"&&this._shareLAN.trim()||void 0,share_mode:this.entrypointType==="tun"&&this._shareMode||void 0,direct:this.entrypointType==="tun"?this._direct:void 0,rules:this.entrypointType==="tungo"?this._rules.split(`
`).map(s=>s.trim()).filter(Boolean):void 0};this.mode==="create"?(await b(()=>import("./index-CYOSUTk3.js").then(s=>s.I),__vite__mapDeps([0,1])).then(s=>s.create(e)),this._showSnackbar(t("saved")),this._navigate("/")):(await b(()=>import("./index-CYOSUTk3.js").then(s=>s.I),__vite__mapDeps([0,1])).then(s=>s.update(this.entrypointId,e)),this._showSnackbar(t("saved")),this.mode="view",await f())}catch(e){const s=e instanceof Error?e.message:"";this._showSnackbar(`${t("saveFailed")}${s?": "+s:""}`)}this._saving=!1}async _handleDelete(){this._showDeleteDialog=!1;try{await R(this.entrypointId),this._showSnackbar(t("deleted")),this._navigate("/")}catch{this._showSnackbar(t("deleteFailed"))}}async _handleStart(){if(this._usesDevice){const e=y(this.entrypointId);if(e){this._showSnackbar(`${t("tunDeviceBusy")}: ${e.name}`);return}const s=this._entrypoint?.options;if(!await x(s?.net??"",s?.routes??"",s?.mtu??0,s?.dns??"")){this._showSnackbar(t("vpnNotReady"));return}}try{await S(this.entrypointId),this._showSnackbar(t("started"))}catch(e){const s=e instanceof Error?e.message:"";this._showSnackbar(`${t("startFailed")}${s?": "+s:""}`)}}async _handleStop(){try{await E(this.entrypointId),this._showSnackbar(t("stopped"))}catch{this._showSnackbar(t("stopFailed"))}}async _handleCopy(e){await F(e),this._showSnackbar(t("copiedToClipboard"))}_handleResetStats(e){this._resetKind=e,this._showResetDialog=!0}async _doResetStats(){this._showResetDialog=!1;try{await I(this.entrypointId,this._resetKind),this._entrypoint&&z(this.entrypointId,this._entrypoint.stats),this._showSnackbar(t("saved"))}catch{this._showSnackbar(t("saveFailed"))}}_cycleOption(e,s){const n=s.indexOf(e);return s[(n+1)%s.length]}_shareModeLabel(e){switch(e){case"kernel":return t("shareModeKernel");case"userspace":return t("shareModeUserspace");default:return t("shareModeAuto")}}render(){const e=this._entrypoint,s=e?e.stats:null,n=e?.options?.peer??"",p=e?.options?.rules??[],c=this._matchingRules();return i`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._handleBack()}>
            ${d("chevron-left")}
          </button>
          <span class="page-title">${d(N(this.entrypointType))}</span>

          ${this.mode==="view"&&e?i`
              ${e.status==="running"?i`<button class="pill-btn danger appbar-action" @click=${()=>this._handleStop()}>
                  ■ ${t("btnStop")}
                </button>`:i`<button class="pill-btn primary appbar-action" @click=${()=>this._handleStart()}>
                  ▶ ${t("btnStart")}
                </button>`}
            `:i`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${()=>this._handleSave()}>
                ${d("check")} ${t("btnSave")}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode==="view"&&e?i`
            <div class="status-banner ${e.status}">
              <span class="status-dot-mini"></span>
              ${e.status==="running"?t("statusRunning"):e.status==="error"?t("statusError"):t("statusStopped")}
              ${e.error?i` — ${e.error}`:""}
              <span class="status-spacer"></span>
            </div>
            <!-- Running yet one-way: uplink without downlink, still on. The
                 events derive it (see _hubNoReflow), so the banner survives
                 the instantaneous rates flickering and clears on recovery. -->
            ${this.entrypointType==="tun"&&e.status==="running"&&this._hubNoReflow(e.events)?i`
                <div class="status-banner degraded" @click=${()=>this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}/events`)}>
                  <span class="status-dot-mini"></span>
                  <div style="flex:1;">
                    <div>${t("hubNoReflowTitle")}</div>
                    <div class="degraded-hint">${t("hubNoReflowHint")}</div>
                  </div>
                  <span style="color:var(--text-muted);">&rarr;</span>
                </div>
              `:h}
            ${this.entrypointType==="tun"&&e.status==="running"&&e.peer_transport==="server-unreachable"?i`
                <div class="status-banner degraded">
                  <span class="status-dot-mini"></span>
                  <div style="flex:1;">
                    <div>${t("serverUnreachableTitle")}</div>
                    <div class="degraded-hint">${t("serverUnreachableHint")}</div>
                  </div>
                </div>
              `:h}

            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">${t("fieldName")}</span>
                  <span class="info-value text">${e.name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">${t("fieldCreated")}</span>
                  <span class="info-value text">${A(e.created_at)}</span>
                </div>
                ${this.entrypointType==="p2p"||this._usesDevice?"":i`
                <div class="info-row">
                  <span class="info-label">${t("fieldTunnelId")}</span>
                  <span class="info-value uuid">${e.id??"—"}</span>
                  ${e.id?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(e.id)}>
                      ${d("copy")}
                    </button>`:""}
                </div>`}
                <div class="info-row">
                  <span class="info-label">${this._usesDevice?t("fieldNet"):t("fieldBindAddress")}</span>
                  <span class="info-value">${e.entrypoint}</span>
                </div>
                ${this._usesDevice?i`
                    ${e.options?.mtu?i`<div class="info-row"><span class="info-label">${t("fieldMTU")}</span><span class="info-value text">${e.options.mtu}</span></div>`:""}
                    ${e.options?.device_name?i`<div class="info-row"><span class="info-label">${t("fieldDeviceName")}</span><span class="info-value text">${e.options.device_name}</span></div>`:""}
                    <!-- What this spoke asked to share, and what its hub
                         actually approved: the two are not the same value, and
                         only the second reaches the hub's peers. A hub that
                         approved nothing has no routes row at all. A tungo split
                         shares nothing at all, so neither row is its business. -->
                    ${this.entrypointType==="tun"&&e.options?.share_lan?i`<div class="info-row"><span class="info-label">${t("fieldShareLAN")}</span><span class="info-value text">${e.options.share_lan}</span></div>`:""}
                    ${this.entrypointType==="tun"?i`
                    <div class="info-row">
                      <span class="info-label">${t("fieldDirect")}</span>
                      <span class="info-value text">${e.options?.direct?t("directOn"):t("directOff")}</span>
                    </div>
                    ${e.lan_routes?.length?i`<div class="info-row"><span class="info-label">${t("fieldLANRoutes")}</span><span class="info-value text">${e.lan_routes.join(", ")}</span></div>`:""}`:""}
                    ${e.options?.routes?i`<div class="info-row"><span class="info-label">${t("fieldRoutes")}</span><span class="info-value text">${e.options.routes}</span></div>`:""}
                    ${e.options?.dns?i`<div class="info-row"><span class="info-label">${t("fieldDNS")}</span><span class="info-value text">${e.options.dns}</span></div>`:""}
                    <!-- The split itself. An empty list is a working split
                         (everything direct), so it is shown rather than
                         hidden as "not configured". -->
                    ${this.entrypointType==="tungo"?i`
                        <div class="info-row">
                          <span class="info-label">${t("fieldRules")}</span>
                          <span class="info-value text">
                            ${p.length===0?t("rulesEmptyDirect"):p.length<=8?p.join(", "):t("rulesCount",{n:p.length})}
                          </span>
                        </div>
                        ${p.length>8?i`
                            <details class="rules-disclosure">
                              <summary>
                                <span class="rules-show">${t("rulesShowAll",{n:p.length})}</span>
                                <span class="rules-hide">${t("rulesHideAll",{n:p.length})}</span>
                              </summary>
                              <pre class="rules-pre" role="region" tabindex="0" aria-label=${t("fieldRules")}>${p.join(`
`)}</pre>
                            </details>
                          `:h}
                      `:""}
                    <div class="info-row">
                      <span class="info-label">${t("entrypointPeerKey")}</span>
                      <span class="info-value ${this._showPeer?"":"masked"}">${this._showPeer?n:m(n)}</span>
                      ${n?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(n)}>
                          ${d("copy")}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer?t("hideKey"):t("revealKey")}"
                          @click=${()=>{this._showPeer=!this._showPeer}}>
                          ${d(this._showPeer?"eye-off":"eye")}
                        </button>`:""}
                    </div>
                    ${this._renderTransport(e)}
                    <div class="p2p-hint">${this.entrypointType==="tun"?t("tunPeerHint"):t("tungoPeerHint")}</div>
                  `:this.entrypointType==="p2p"?i`
                    <div class="info-row">
                      <span class="info-label">${t("entrypointPeerKey")}</span>
                      <span class="info-value ${this._showPeer?"":"masked"}">${this._showPeer?n:m(n)}</span>
                      ${n?i`<button class="copy-btn-mini" @click=${()=>this._handleCopy(n)}>
                          ${d("copy")}
                        </button>
                        <button class="copy-btn-mini" title="${this._showPeer?t("hideKey"):t("revealKey")}"
                          @click=${()=>{this._showPeer=!this._showPeer}}>
                          ${d(this._showPeer?"eye-off":"eye")}
                        </button>`:""}
                    </div>
                    ${this._renderTransport(e)}
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
              ${s?i`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">${t("statTotalConns")} <span class="stat-reset-mini" @click=${()=>this._handleResetStats("conns")} title="${t("btnResetStats")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${v(s.total_conns)}</div>
                      <div class="stat-rate">${v(s.current_conns)} active · ${s.request_rate.toFixed(2)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">${t("statTotalErrors")} <span class="stat-reset-mini" @click=${()=>this._handleResetStats("errors")} title="${t("btnResetStats")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${v(s.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">${t("p2pColDown")} <span class="stat-reset-mini" @click=${()=>this._handleResetStats("output")} title="${t("btnResetOutput")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${g(s.output_bytes)}</div>
                      <div class="stat-rate">${_(s.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">${t("p2pColUp")} <span class="stat-reset-mini" @click=${()=>this._handleResetStats("input")} title="${t("btnResetInput")}">${d("rotate-cw")}</span></div>
                      <div class="stat-value">${g(s.input_bytes)}</div>
                      <div class="stat-rate">${_(s.input_rate_bytes)}</div>
                    </div>
                  </div>
                `:""}
            </div>

            ${this.mode==="view"&&e&&this.entrypointType==="tungo"?i`
                <div class="section">
                  <a class="entry-card requests-entry"
                    href=${`/entrypoint/${this.entrypointType}/${this.entrypointId}/requests`}
                    @click=${a=>{a.preventDefault(),this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}/requests`)}}>
                    <span class="entry-icon" aria-hidden="true">${d("branch")}</span>
                    <span class="entry-copy">
                      <span class="entry-title">${t("requestsEntryTitle")}</span>
                      <span class="entry-desc">${this._latestRequestLine()}</span>
                    </span>
                    <span class="entry-chevron" aria-hidden="true">${d("chevron-right")}</span>
                  </a>
                </div>
              `:h}

            ${this.mode==="view"&&this._entrypoint&&this.entrypointType==="tun"?i`
                <div class="section">
                  <div class="card" style="padding:0;">
                    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;"
                      @click=${()=>this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}/peers`)}>
                      <span style="color:var(--accent);">${d("users")}</span>
                      <div style="flex:1;">
                        <div style="font-size:var(--font-sm);font-weight:600;">${t("entrypointPeersTitle")}</div>
                        <div style="font-size:var(--font-sm);color:var(--text-muted);">
                          ${this._entrypoint.options?.blocked_peers?.length?t("entrypointPeersBlockedCount",{n:this._entrypoint.options.blocked_peers.length}):t("entrypointPeersDesc")}
                        </div>
                      </div>
                      <span style="color:var(--text-muted);">&rarr;</span>
                    </div>
                  </div>
                </div>
              `:h}

            ${this.mode==="view"&&this._entrypoint?i`
                <div class="section">
                  <a class="entry-card"
                    href=${`/entrypoint/${this.entrypointType}/${this.entrypointId}/events`}
                    @click=${a=>{a.preventDefault(),this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}/events`)}}>
                    <span class="entry-icon" aria-hidden="true">${d("activity")}</span>
                    <span class="entry-copy">
                      <span class="entry-title">${t("eventsEntryTitle")}</span>
                      <span class="entry-desc">${this._latestEventLine(this._entrypoint.events)}</span>
                    </span>
                    <span class="entry-chevron" aria-hidden="true">${d("chevron-right")}</span>
                  </a>
                </div>
              `:h}

            <div class="section">
              <button class="btn-edit-bottom" @click=${()=>this._enterEdit()}>
                ${d("edit")} ${t("btnEdit")}
              </button>
            </div>
          `:""}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode!=="view"?i`
            <div class="section">
              <div class="card" style="padding:16px;">
                <!-- What a device entrypoint is and what it needs, before the
                     fields it implies: the device is the one thing here that can
                     make the save fail. -->
                ${this._usesDevice?i`
                    <div class="p2p-hint warn">${t("tunPrivilegeHint")}</div>
                    <div class="p2p-hint">${this.entrypointType==="tun"?t("tunPeerHint"):t("tungoPeerHint")}</div>
                  `:""}

                <!-- A p2p or device entrypoint has no tunnel id to route by. -->
                ${this.entrypointType==="p2p"||this._usesDevice?"":i`
                <div class="form-group">
                  <label class="form-label">${t("fieldTunnelId")}</label>
                  <input class="form-input"
                    ?readonly=${this.mode==="edit"}
                    .value=${this._tunnelId}
                    placeholder="${t("tunnelIdPlaceholder")}"
                    @input=${a=>{this._tunnelId=a.target.value}}>
                </div>`}

                <div class="form-group">
                  <label class="form-label">${t("fieldName")}</label>
                  <input class="form-input" .value=${this._name} placeholder="${t("entrypointNamePlaceholder")}"
                    @input=${a=>{this._name=a.target.value}}>
                </div>

                ${this._usesDevice?i`
                    <div class="form-group">
                      <label class="form-label">${t("fieldNet")}</label>
                      <input class="form-input" .value=${this._net} placeholder="10.10.0.2/24"
                        @input=${a=>{this._net=a.target.value}}>
                      <!-- What makes the two ends agree. The hub's assignment
                           lives on the hub's own peers page, which this page has
                           no view of — it knows only the net being typed here and
                           the hub's key — so the hint points there rather than
                           restating a subnet it cannot know. A tungo split's
                           address is not assigned by anyone: its peer is a p2p
                           tunnel, not a tun hub. -->
                      ${this.entrypointType==="tun"?i`<div class="p2p-hint">${t("tunNetMatchesHub")}</div>`:""}
                    </div>
                    <!-- The hub this device dials. It belongs with the device
                         address above, not at the bottom of the form: the two
                         together are "which side of the tunnel is this node".
                         Required — a device entrypoint with no peer has nobody to
                         reach, and the host refuses to start it. -->
                    <div class="form-group">
                      <label class="form-label">
                        ${t("entrypointPeerKey")}<span class="required-mark" title="${t("requiredField")}">*</span>
                      </label>
                      <input class="form-input" .value=${this._peer} placeholder="${t("peersKeyPlaceholder")}"
                        @input=${a=>{this._peer=a.target.value}}>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t("fieldMTU")}</label>
                      <input class="form-input" type="number" .value=${this._mtu?String(this._mtu):""} placeholder="1300"
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
                      <!-- The split's safe value is both catch-alls: a v4-only
                           list leaves every IPv6 flow on the phone's own
                           network, which is the leak this device exists to
                           prevent. The API appends ::/0 to a v4 catch-all and
                           refuses an empty list, so the example is what the
                           stored value ends up as. -->
                      <input class="form-input" .value=${this._routes}
                        placeholder="${this.entrypointType==="tungo"?"0.0.0.0/0, ::/0":"0.0.0.0/0"}"
                        @input=${a=>{this._routes=a.target.value}}>
                      <!-- A split has no hub subnet to fall back to: what it
                           carries is decided by the rules below, not by the
                           net it was assigned. -->
                      <div class="p2p-hint">${t(this.entrypointType==="tungo"?"fieldTungoRoutesHint":"fieldRoutesHint")}</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label">${t("fieldDNS")}</label>
                      <!-- A tun spoke asks its hub (10.10.0.1); a split has no
                           hub DNS, so its example is the home gateway whose
                           split DNS answers the listed names. -->
                      <input class="form-input" .value=${this._dns}
                        placeholder="${this.entrypointType==="tungo"?"192.168.100.100":"10.10.0.1"}"
                        @input=${a=>{this._dns=a.target.value}}>
                    </div>
                    ${this.entrypointType==="tungo"?i`
                    <!-- The split: one destination per line, because the list is
                         read and edited as a list of hosts, not as a sentence.
                         Listed traffic rides the tunnel to the peer above; the
                         rest leaves through this device's own network. -->
                    <div class="form-group">
                      <label class="form-label">${t("fieldRules")}</label>
                      <div class="rules-editor-header">
                        <span class="rules-count">${this._ruleCountLabel()}</span>
                        <button type="button" class="rules-link-btn" @click=${this._openRulesEditor}>
                          ${t("rulesEditAll")}
                        </button>
                      </div>
                      <label class="rules-control-label" for="rules-search">${t("rulesSearchLabel")}</label>
                      <search>
                        <input id="rules-search" name="q" type="search" class="form-input"
                          .value=${this._rulesSearch} placeholder=${t("rulesSearchPlaceholder")}
                          @input=${a=>{this._rulesSearch=a.target.value}}>
                      </search>
                      ${this._rulesSearch.trim()?i`
                          <ul class="rules-match-list" aria-label=${t("rulesSearchLabel")}>
                            ${c.map(a=>i`
                              <li class="rules-match">
                                <span class="rules-match-text">${a.value}</span>
                                <button type="button" class="rules-remove-btn"
                                  aria-label=${t("rulesRemove",{rule:a.value})}
                                  title=${t("rulesRemove",{rule:a.value})}
                                  @click=${()=>this._removeRule(a.line)}>✕</button>
                              </li>
                            `)}
                          </ul>
                          ${c.length===0?i`<div class="rules-no-matches">${t("rulesNoMatches")}</div>`:h}
                        `:h}
                      <form @submit=${a=>{a.preventDefault(),this._addRule()}}>
                        <label class="rules-control-label" for="rules-add">${t("rulesAddLabel")}</label>
                        <div class="rules-add-row">
                          <input id="rules-add" name="rule" class="form-input"
                            .value=${this._newRule} placeholder=${t("rulesAddPlaceholder")}
                            @input=${a=>{this._newRule=a.target.value}}>
                          <button type="submit" class="pill-btn primary rules-add-btn">${t("rulesAdd")}</button>
                        </div>
                      </form>
                      <div class="p2p-hint">${t("fieldRulesHint")}</div>
                    </div>`:""}
                    ${this.entrypointType==="tun"?i`
                    <!-- LAN sharing, last: the subnets of this node's own LAN the
                         hub may let its peers reach, and the backend that runs
                         them. Opt-in and decided by the hub (its peers page shows
                         what was approved), so a spoke that shares nothing never
                         has to read it. -->
                    <div class="form-group">
                      <label class="form-label">${t("fieldShareLAN")}</label>
                      <input class="form-input" .value=${this._shareLAN} placeholder="192.168.1.0/24"
                        @input=${a=>{this._shareLAN=a.target.value}}>
                      <div class="p2p-hint">${t("fieldShareLANHint")}</div>
                    </div>
                    <div class="switch-row" @click=${()=>{this._shareMode=this._cycleOption(this._shareMode,[...r.SHARE_MODES]),this.requestUpdate()}}>
                      <span class="switch-label">${t("fieldShareMode")}</span>
                      <span class="protocol-value">
                        ${this._shareModeLabel(this._shareMode)}
                        ${d("chevron-right")}
                      </span>
                    </div>
                    <div class="p2p-hint">${t("fieldShareModeHint")}</div>
                    <div class="switch-row">
                      <span class="switch-label">${t("fieldDirect")}</span>
                      <div class="switch ${this._direct?"on":""}"
                        @click=${()=>{this._direct=!this._direct}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                    <div class="p2p-hint">${t("fieldDirectHint")}</div>`:""}
                  `:i`
                <div class="form-group">
                  <label class="form-label">${t("fieldBindAddress")}</label>
                  <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                    @input=${a=>{this._endpoint=a.target.value}}>
                </div>`}

                <!-- The peer key and the controls only a p2p entrypoint has. A
                     device entrypoint's key sits above, with the device it
                     dials from. -->
                ${this.entrypointType==="p2p"?i`
                    <div class="form-group">
                      <label class="form-label">
                        ${t("entrypointPeerKey")}<span class="required-mark" title="${t("requiredField")}">*</span>
                      </label>
                      <input class="form-input" .value=${this._peer} placeholder="${t("peersKeyPlaceholder")}"
                        @input=${a=>{this._peer=a.target.value}}>
                    </div>
                    <!-- No keepalive, no ttl: this entrypoint reaches its hub
                         over p2p and nothing else, the handshake that registers
                         its address is sent either way, and a hub's route table
                         has no TTL to refresh. Both controls would set values
                         nothing reads. See tunnel/entrypoint/tun.go. -->
                    <div class="switch-row" @click=${()=>{this._protocol=this._protocol==="tcp"?"udp":"tcp"}}>
                      <span class="switch-label">${t("fieldProtocol")}</span>
                      <span class="protocol-value">
                        ${this._protocol==="udp"?t("protocolUdp"):t("protocolTcp")}
                        ${d("chevron-right")}
                      </span>
                    </div>
                    ${this._protocol==="udp"?i`
                    <div class="switch-row">
                      <span class="switch-label">${t("switchKeepalive")}</span>
                      <div class="switch ${this._keepalive?"on":""}"
                        @click=${()=>{this._keepalive=!this._keepalive}}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                    <div class="p2p-hint">${t("keepaliveHint")}</div>`:""}
                  `:""}

                ${this.mode==="edit"?i`
                    <div class="danger-zone">
                      <div class="danger-zone-label">${t("dangerZone")}</div>
                      <button class="pill-btn danger" @click=${()=>{this._showDeleteDialog=!0}}>
                        ${d("trash")} ${t("btnDelete")}
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

        ${this._showDeleteDialog?i`
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

      ${this._rulesEditorOpen?i`
          <div class="rules-editor-overlay" @keydown=${this._handleRulesEditorKeydown}>
            <div class="rules-editor-panel" role="dialog" aria-modal="true" aria-labelledby="rules-editor-title">
              <div class="rules-editor-panel-head">
                <h2 id="rules-editor-title" class="rules-editor-title">${t("fieldRules")}</h2>
                <span class="rules-count">${this._ruleCountLabel(this._rulesDraft)}</span>
              </div>
              <textarea id="rules-bulk-editor" class="form-input rules-bulk-textarea"
                aria-label=${t("fieldRules")} spellcheck="false"
                .value=${this._rulesDraft}
                @input=${a=>{this._rulesDraft=a.target.value}}></textarea>
              <div class="rules-editor-actions">
                <button type="button" class="dialog-btn cancel" @click=${()=>this._closeRulesEditor(!1)}>
                  ${t("rulesCancel")}
                </button>
                <button type="button" class="pill-btn primary" @click=${()=>this._closeRulesEditor(!0)}>
                  ${t("rulesDone")}
                </button>
              </div>
            </div>
          </div>
        `:h}
    `}};r.SHARE_MODES=["auto","kernel","userspace"];r.styles=P`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    /* A bare type glyph in the app bar: centre the SVG as a flex item rather
       than letting it sit on the text baseline. */
    .page-title {
      font-size: var(--font-md); font-weight: 600; flex: 1;
      display: flex; align-items: center; line-height: 1;
    }

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

    .entry-card {
      min-height: 44px; display: flex; align-items: center; gap: 12px; padding: 14px 16px;
      background: var(--surface); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg); color: inherit; text-decoration: none; cursor: pointer;
    }
    .entry-card:hover { background: var(--border-subtle); }
    .entry-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .entry-icon { display: inline-flex; color: var(--accent); flex: none; }
    .entry-copy { flex: 1; min-width: 0; }
    .entry-title { display: block; font-size: var(--font-sm); font-weight: 600; color: var(--text); }
    .entry-desc {
      display: block; margin-top: 2px; font-size: var(--font-sm); color: var(--text-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .entry-chevron { display: inline-flex; color: var(--text-muted); flex: none; }
    .entry-chevron svg { width: 16px; height: 16px; }

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
    /* A hint inside a field group is that field's caption: it hugs the input
       above it, and the group's own margin supplies the gap to the next field.
       The 10px bottom padding above is for standalone hints (the leading block),
       which have no group margin under them — leaving it on captions added 10px
       to every second field, so the form read 14/24/14 rather than evenly. */
    .form-group > .p2p-hint {
      padding: 4px 14px 0;
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
    /* Marks a field the backend will refuse to start without, so the form
       says so before the save. The asterisk carries the explanation in its
       title for a pointer, and the snackbar repeats it on submit. */
    .required-mark {
      color: var(--red);
      margin-left: 3px;
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
    /* A list typed one entry per line (the split rules): monospace so the
       entries line up, and room for a pasted list rather than one line. */
    textarea.form-input {
      min-height: 96px;
      resize: vertical;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      line-height: 1.5;
    }

    .rules-disclosure {
      margin: 0 14px 12px 110px;
      padding: 8px 10px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .rules-disclosure summary {
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      font-weight: 500;
    }
    .rules-disclosure .rules-hide { display: none; }
    .rules-disclosure[open] .rules-show { display: none; }
    .rules-disclosure[open] .rules-hide { display: inline; }
    .rules-pre {
      margin: 8px 0 0;
      padding: 10px;
      max-height: 320px;
      overflow: auto;
      background: var(--border-subtle);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: var(--font-xs);
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .rules-editor-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .rules-count {
      color: var(--text-muted);
      font-size: var(--font-sm);
      font-variant-numeric: tabular-nums;
    }
    .rules-link-btn {
      min-height: 24px;
      padding: 2px 0;
      border: none;
      background: none;
      color: var(--accent);
      cursor: pointer;
      font: inherit;
      font-size: var(--font-sm);
      font-weight: 600;
    }
    .rules-control-label {
      display: block;
      margin: 8px 0 4px;
      color: var(--text-muted);
      font-size: var(--font-xs);
    }
    .rules-match-list {
      max-height: 240px;
      overflow: auto;
      list-style: none;
      margin: 6px 0;
      padding: 0;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .rules-match {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .rules-match:last-child { border-bottom: none; }
    .rules-match-text {
      flex: 1;
      min-width: 0;
      color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: var(--font-xs);
      overflow-wrap: anywhere;
    }
    .rules-remove-btn {
      flex-shrink: 0;
      min-width: 24px;
      min-height: 24px;
      padding: 2px 6px;
      border: none;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-muted);
      cursor: pointer;
    }
    .rules-remove-btn:hover { background: var(--red-bg); color: var(--red-text); }
    .rules-no-matches {
      margin: 6px 0;
      color: var(--text-muted);
      font-size: var(--font-xs);
    }
    .rules-add-row { display: flex; align-items: center; gap: 8px; }
    .rules-add-row .form-input { flex: 1; min-width: 0; }
    .rules-add-btn { flex-shrink: 0; }

    .rules-editor-overlay {
      position: fixed;
      inset: 0;
      z-index: 300;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      overflow: auto;
      padding: 16px;
      background: rgba(0,0,0,0.5);
      overscroll-behavior: contain;
      animation: fade-in 0.15s ease;
    }
    .rules-editor-panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: min(1100px, 100%);
      max-height: calc(100dvh - 32px);
      overflow: auto;
      box-sizing: border-box;
      padding: 16px;
      border-radius: var(--radius-lg);
      background: var(--surface);
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
    .rules-editor-panel-head { display: flex; align-items: center; gap: 12px; }
    .rules-editor-title { flex: 1; margin: 0; font-size: var(--font-md); font-weight: 600; }
    .rules-bulk-textarea { min-height: 60vh; resize: vertical; flex: 1; }
    .rules-editor-actions { display: flex; justify-content: flex-end; gap: 10px; }

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
  `;o([$()],r.prototype,"entrypointType",2);o([$()],r.prototype,"entrypointId",2);o([l()],r.prototype,"mode",2);o([l()],r.prototype,"_entrypoint",2);o([l()],r.prototype,"_latestRequest",2);o([l()],r.prototype,"_saving",2);o([l()],r.prototype,"_snackbar",2);o([l()],r.prototype,"_showDeleteDialog",2);o([l()],r.prototype,"_showResetDialog",2);o([l()],r.prototype,"_name",2);o([l()],r.prototype,"_endpoint",2);o([l()],r.prototype,"_tunnelId",2);o([l()],r.prototype,"_peer",2);o([l()],r.prototype,"_showPeer",2);o([l()],r.prototype,"_showTransportDetail",2);o([l()],r.prototype,"_protocol",2);o([l()],r.prototype,"_keepalive",2);o([l()],r.prototype,"_net",2);o([l()],r.prototype,"_mtu",2);o([l()],r.prototype,"_deviceName",2);o([l()],r.prototype,"_routes",2);o([l()],r.prototype,"_dns",2);o([l()],r.prototype,"_rules",2);o([l()],r.prototype,"_rulesSearch",2);o([l()],r.prototype,"_newRule",2);o([l()],r.prototype,"_rulesEditorOpen",2);o([l()],r.prototype,"_rulesDraft",2);o([l()],r.prototype,"_shareLAN",2);o([l()],r.prototype,"_shareMode",2);o([l()],r.prototype,"_direct",2);r=o([q("entrypoint-detail-page")],r);export{r as EntrypointDetailPage};
