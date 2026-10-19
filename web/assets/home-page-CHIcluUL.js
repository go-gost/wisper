const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-Ci5ud6jC.js","assets/index-BPj8V9nW.css"])))=>i.map(i=>d[i]);
import{i as x,a as y,b as o,t as m,A as $,c as e,g as w,d as k,e as T,f as C,s as D,h as S,j as z,k as I,l as L,m as R,n as F,_ as E,o as j}from"./index-Ci5ud6jC.js";import{n as l,f as B,a as q,b as P,c as N,r as b}from"./format-Ci7LI8Mr.js";import{i as u}from"./app-scaffold-CwdIh8Qy.js";import{t as A}from"./type-icons-DsI-rt1W.js";import{c as O}from"./clipboard-C3x8_sid.js";import{t as U}from"./transport-CsV_bRbg.js";import{t as H,a as Q}from"./vpn-iTvbRhre.js";import{r as V}from"./qr-B9waFAF2.js";var M=Object.defineProperty,X=Object.getOwnPropertyDescriptor,_=(t,r,n,a)=>{for(var s=a>1?void 0:a?X(r,n):r,c=t.length-1,i;c>=0;c--)(i=t[c])&&(s=(a?i(r,n,s):i(s))||s);return a&&s&&M(r,n,s),s};let g=class extends y{constructor(){super(...arguments),this.tabs=[],this.activeIndex=0}_handleClick(t){t!==this.activeIndex&&(this.activeIndex=t,this.dispatchEvent(new CustomEvent("tab-change",{detail:{index:t},bubbles:!0,composed:!0})))}render(){return o`
      <div class="pill-group">
        ${this.tabs.map((t,r)=>o`
            <button class=${r===this.activeIndex?"active":""} @click=${()=>this._handleClick(r)}>
              ${t}
            </button>
          `)}
      </div>
    `}};g.styles=x`
    :host {
      display: flex;
      justify-content: center;
      padding: 12px 16px;
    }

    .pill-group {
      display: inline-flex;
      background: var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 3px;
    }

    button {
      padding: 7px 18px;
      text-align: center;
      border-radius: var(--radius-pill);
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: var(--font-md);
      font-weight: 500;
      cursor: pointer;
      letter-spacing: 0.3px;
      transition: background var(--transition-fast), color var(--transition-fast);
      font-family: inherit;
      white-space: nowrap;
    }

    button.active {
      background: var(--surface);
      color: var(--text);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    }
  `;_([l({type:Array})],g.prototype,"tabs",2);_([l({type:Number})],g.prototype,"activeIndex",2);g=_([m("nav-tabs")],g);var W=Object.defineProperty,Y=Object.getOwnPropertyDescriptor,p=(t,r,n,a)=>{for(var s=a>1?void 0:a?Y(r,n):r,c=t.length-1,i;c>=0;c--)(i=t[c])&&(s=(a?i(r,n,s):i(s))||s);return a&&s&&W(r,n,s),s};let d=class extends y{constructor(){super(...arguments),this.name="",this.typeIcon="",this.meta="",this.status="stopped",this.endpoint="",this.currentConns=0,this.totalConns=0,this.requestRate=0,this.inputBytes=0,this.outputBytes=0,this.inputRate=0,this.outputRate=0,this.transport=null,this.createdAt="",this.expanded=!1,this.compact=!0,this.error="",this.secure=!1,this.rtt=0}_onRowClick(){this.dispatchEvent(new CustomEvent("card-click",{bubbles:!0,composed:!0}))}_onChevronClick(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("chevron-click",{bubbles:!0,composed:!0}))}render(){const t=this.status==="stopped";return o`
      <div class="row ${t?"stopped":""}" @click=${this._onRowClick}>
        <span class="dot ${this.status}"></span>

        <div class="info">
          <div class="name">${this.name}</div>
          ${this.typeIcon?o`<div class="type-icon">${u(this.typeIcon)}</div>`:""}
          ${this.meta?o`<div class="meta">${this.meta}</div>`:""}
        </div>

        <div class="right-col">
          <div class="right-top">
            ${this.rtt>0?o`<span class="peer-rtt" title=${e("peersRTTHint")}>${this.rtt}ms</span>`:$}
            ${this.transport?o`<span class="transport ${this.transport.tone}" title=${this.transport.hint}>
                  ${u(this.transport.icon)}
                </span>`:$}
            ${this.createdAt?o`<span class="created-at">${B(this.createdAt)}</span>`:""}
          </div>
          ${this.status==="running"?o`
            <div class="traffic">
              <div class="traffic-row">
                <span class="traffic-total">${q(this.inputBytes)}</span>
                <span>↑ ${P(this.inputRate)}</span>
              </div>
              <div class="traffic-row">
                <span class="traffic-total">${q(this.outputBytes)}</span>
                <span>↓ ${P(this.outputRate)}</span>
              </div>
            </div>
          `:""}
        </div>

        <span class="chevron ${this.expanded?"open":""}" @click=${this._onChevronClick}>
          ${u("chevron-right")}
        </span>
      </div>

      ${this.error?o`<div class="error-banner">${this.error}</div>`:""}
    `}};d.styles=x`
    :host {
      display: block;
    }

    .row {
      display: flex;
      align-items: flex-start;
      padding: 8px 12px;
      background: var(--border-subtle);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: background var(--transition-fast);
      gap: 10px;
    }

    .row:hover {
      background: var(--border);
    }

    .row.stopped {
      opacity: 0.55;
    }

    /* ── Status dot ── */
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--text-muted);
      align-self: center;
    }

    .dot.running {
      background: var(--green);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
    }

    .dot.error {
      background: var(--red);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
    }

    /* ── Info column ── */
    .info {
      flex: 1;
      min-width: 0;
      align-self: stretch;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
    }

    .name {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      font-size: var(--font-sm);
      color: var(--text-muted);
    }

    /* The service type as its icon, on its own line under the name: the same
       glyph a detail page's header draws, at the meta line's own scale. */
    .type-icon {
      display: flex;
      align-items: center;
      color: var(--text-muted);
    }
    .type-icon svg {
      width: 14px;
      height: 14px;
    }

    /* ── p2p transport: one small icon beside the created-at, the reason in
       its tooltip (a card has no room for the words) ── */
    .right-top {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .transport {
      display: inline-flex;
      align-items: center;
      color: var(--text-muted);
    }
    .transport svg {
      width: 12px;
      height: 12px;
    }
    .transport.direct {
      color: var(--green-text);
    }
    .transport.info {
      color: var(--info);
    }
    .transport.warn {
      color: var(--amber);
    }
    .secure {
      display: inline-flex;
      align-items: center;
      color: var(--green-text);
    }
    .secure svg {
      width: 12px;
      height: 12px;
    }
    .peer-rtt {
      font-size: var(--font-xs);
      color: var(--text-muted);
    }

    /* ── Right column: created-at + traffic ── */
    .right-col {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      min-width: 60px;
      align-self: center;
    }

    .created-at {
      font-size: var(--font-sm);
      color: var(--text-muted);
      text-align: right;
      line-height: 1.4;
    }

    /* ── Traffic stats ── */
    .traffic {
      text-align: right;
      font-size: var(--font-sm);
      color: var(--text);
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .traffic-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 2px;
    }

    .traffic-total {
      color: var(--text-secondary);
      font-size: var(--font-sm);
    }

    /* ── Chevron ── */
    .chevron {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform var(--transition-fast);
      display: flex;
      align-items: center;
      justify-content: center;
      align-self: stretch;
      padding: 0 8px;
      margin: -8px -12px;
      margin-left: 0;
    }

    .chevron.open {
      transform: rotate(90deg);
    }

    /* ── Error ── */
    .error-banner {
      padding: 5px 14px 5px 34px;
      background: var(--red-bg);
      border-radius: var(--radius-sm);
      margin-top: 2px;
      font-size: var(--font-sm);
      color: var(--red-text);
    }
  `;p([l()],d.prototype,"name",2);p([l()],d.prototype,"typeIcon",2);p([l()],d.prototype,"meta",2);p([l()],d.prototype,"status",2);p([l()],d.prototype,"endpoint",2);p([l({type:Number})],d.prototype,"currentConns",2);p([l({type:Number})],d.prototype,"totalConns",2);p([l({type:Number})],d.prototype,"requestRate",2);p([l({type:Number})],d.prototype,"inputBytes",2);p([l({type:Number})],d.prototype,"outputBytes",2);p([l({type:Number})],d.prototype,"inputRate",2);p([l({type:Number})],d.prototype,"outputRate",2);p([l({attribute:!1})],d.prototype,"transport",2);p([l()],d.prototype,"createdAt",2);p([l({type:Boolean})],d.prototype,"expanded",2);p([l({type:Boolean})],d.prototype,"compact",2);p([l()],d.prototype,"error",2);p([l({type:Boolean})],d.prototype,"secure",2);p([l({type:Number})],d.prototype,"rtt",2);d=p([m("tunnel-card")],d);var G=Object.defineProperty,J=Object.getOwnPropertyDescriptor,v=(t,r,n,a)=>{for(var s=a>1?void 0:a?J(r,n):r,c=t.length-1,i;c>=0;c--)(i=t[c])&&(s=(a?i(r,n,s):i(s))||s);return a&&s&&G(r,n,s),s};let f=0,h=class extends y{constructor(){super(...arguments),this._activeTab=f,this.showFavorites=!1,this._tunnels=[],this._entrypoints=[],this._tunnelsLoading=!1,this._entrypointsLoading=!1,this._expandedId=null,this._unsubs=[],this._snackbar="",this._deleteTarget=null,this._qrUrl=""}connectedCallback(){super.connectedCallback(),this._tunnels=w(),this._entrypoints=k(),this._tunnelsLoading=T(),this._entrypointsLoading=C(),this._unsubs.push(D(()=>{this._tunnels=w(),this._tunnelsLoading=T(),this.requestUpdate()}),S(()=>{this._entrypoints=k(),this._entrypointsLoading=C(),this.requestUpdate()}),z(()=>this.requestUpdate()))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_toggleFavorites(){this.showFavorites=!this.showFavorites,this._expandedId=null}_toggleExpand(t){this._expandedId=this._expandedId===t?null:t}get _filteredTunnels(){return[...this.showFavorites?this._tunnels.filter(r=>r.favorite):this._tunnels].sort((r,n)=>new Date(n.created_at).getTime()-new Date(r.created_at).getTime())}get _filteredEntrypoints(){return[...this.showFavorites?this._entrypoints.filter(r=>r.favorite):this._entrypoints].sort((r,n)=>new Date(n.created_at).getTime()-new Date(r.created_at).getTime())}get _items(){return this._activeTab===0?this._filteredTunnels.map(t=>({kind:"tunnel",data:t})):this._filteredEntrypoints.map(t=>({kind:"entrypoint",data:t}))}_isLoading(){return this._activeTab===0?this._tunnelsLoading:this._entrypointsLoading}_statusLabel(t){switch(t){case"running":return e("statusRunning");case"stopped":return e("statusStopped");case"error":return e("statusError")}}_metaLine(t){return t.data.status==="running"?`${N(t.data.stats.current_conns)} ${e("conns")}`:this._statusLabel(t.data.status)}_transport(t){return t.kind==="entrypoint"?U(t.data.peer_transport):null}_rtt(t){return t.kind==="entrypoint"?t.data.peer_rtt_ms??0:0}_typeIcon(t){return A(t.data.type)}_renderEmptyState(){const t=this._activeTab===0,r=t?this._tunnels.length===0:this._entrypoints.length===0;if(this.showFavorites)return o`
        <div class="empty">
          <div class="empty-icon-wrap">${u("star")}</div>
          <div class="empty-title">${e("homeNoFavorites")}</div>
          <div class="empty-desc">${t?e("homeNoFavTunnelHint"):e("homeNoFavEntryHint")}</div>
          <button class="empty-sub-link" @click=${this._toggleFavorites}>
            ${t?e("homeShowAllTunnels"):e("homeShowAllEntrypoints")}
          </button>
        </div>
      `;if(r){const n=t?"/tunnel/new":"/entrypoint/new";return o`
        <div class="empty">
          <div class="empty-icon-wrap">${u(t?"link":"broadcast")}</div>
          <div class="empty-title">${t?e("homeEmptyTunnels"):e("homeEmptyEntrypoints")}</div>
          <div class="empty-desc">${t?e("homeEmptyTunnelDesc"):e("homeEmptyEntryDesc")}</div>
          <button class="empty-action" @click=${()=>this._navigate(n)}>
            ${t?e("tunnelNewTitle"):e("entrypointNewTitle")}
          </button>
        </div>
      `}return o``}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleStart(t){if(t.kind==="entrypoint"&&t.data.type==="tun"){const r=H(t.data.id);if(r){this._showSnackbar(`${e("tunDeviceBusy")}: ${r.name}`);return}const n=t.data.options;if(!await Q(n?.net??"",n?.routes??"",n?.mtu??0,n?.dns??"")){this._showSnackbar(e("vpnNotReady"));return}}try{t.kind==="tunnel"?await I(t.data.id):await L(t.data.id),this._showSnackbar(e("started"))}catch{this._showSnackbar(e("startFailed"))}}async _handleStop(t){try{t.kind==="tunnel"?await R(t.data.id):await F(t.data.id),this._showSnackbar(e("stopped"))}catch{this._showSnackbar(e("stopFailed"))}}_confirmDelete(t,r,n){this._deleteTarget={kind:t,id:r,name:n}}async _handleDelete(){if(!this._deleteTarget)return;const{kind:t,id:r}=this._deleteTarget;this._deleteTarget=null;try{t==="tunnel"?await E(()=>import("./index-Ci5ud6jC.js").then(n=>n.F),__vite__mapDeps([0,1])).then(n=>n.remove(r)):await E(()=>import("./index-Ci5ud6jC.js").then(n=>n.H),__vite__mapDeps([0,1])).then(n=>n.remove(r)),this._expandedId=null,this._showSnackbar(e("deleted"))}catch{this._showSnackbar(e("deleteFailed"))}}_openQrDialog(t){this._qrUrl=t}_closeQrDialog(){this._qrUrl=""}updated(t){if(t.has("_qrUrl")&&this._qrUrl){const r=this.renderRoot.querySelector("#qrCanvas");V(r,this._qrUrl)}}render(){const t=this._items,r=this._isLoading(),n=this._activeTab===0?"/tunnel/new":"/entrypoint/new";return o`
      <app-scaffold>
        <!-- Appbar -->
        <div slot="appBar" class="home-header">
          <div class="app-icon">
            <img src="/logo.png" alt="Wisper" />
          </div>
          <span class="appbar-title">${e("appName")}</span>
          <span class="header-spacer"></span>
          <button class="icon-btn" @click=${()=>this._navigate("/settings")}>
            ${u("settings")}
          </button>
        </div>

        <!-- Tabs -->
        <nav-tabs
          .tabs=${[e("homeTabTunnel"),e("homeTabEntrypoint")]}
          .activeIndex=${this._activeTab}
          @tab-change=${a=>{f=a.detail.index,this._activeTab=f,this._expandedId=null}}
        ></nav-tabs>

        <!-- Body -->
        ${r?o`<div class="loading"><wisper-spinner></wisper-spinner></div>`:t.length===0?this._renderEmptyState():o`
              <div class="list">
                ${t.map(a=>{const s=a.kind==="tunnel"?`/tunnel/${a.data.type}/${a.data.id}`:`/entrypoint/${a.data.type}/${a.data.id}`,c=this._expandedId===a.data.id;return o`
                    <div data-item-id="${a.data.id}">
                      <tunnel-card
                        .name=${a.data.name}
                        .typeIcon=${this._typeIcon(a)}
                        .rtt=${this._rtt(a)}
                        .transport=${this._transport(a)}
                        .meta=${this._metaLine(a)}
                        .status=${a.data.status}
                        .endpoint=${a.data.endpoint}
                        .error=${a.data.error}
                        .createdAt=${a.data.created_at}
                        .currentConns=${a.data.stats.current_conns}
                        .totalConns=${a.data.stats.total_conns}
                        .requestRate=${a.data.stats.request_rate}
                        .inputBytes=${a.data.stats.input_bytes}
                        .outputBytes=${a.data.stats.output_bytes}
                        .inputRate=${a.data.stats.input_rate_bytes}
                        .outputRate=${a.data.stats.output_rate_bytes}
                        .expanded=${c}
                        .compact=${!0}
                        @card-click=${()=>this._navigate(s)}
                        @chevron-click=${()=>this._toggleExpand(a.data.id)}
                      ></tunnel-card>

                      ${c?o`
                          <div class="expand-panel">
                            <div class="detail-card">
                              <div class="detail-row">
                                <span class="dlabel">${a.kind==="tunnel"?"Entrypoint":"Endpoint"}</span>
                                <span class="dval">
                                  <a class="dval-link dval-mono" href="${a.data.entrypoint.startsWith("http")?a.data.entrypoint:"https://"+a.data.entrypoint}" target="_blank" rel="noopener">${a.data.entrypoint}</a>
                                  <button class="copy-btn-mini" @click=${async i=>{i.stopPropagation(),await O(a.data.entrypoint),this._showSnackbar(e("copiedToClipboard"))}}>
                                    ${u("copy")}
                                  </button>
                                </span>
                              </div>
                              <div class="detail-row">
                                <span class="dlabel">${a.kind==="tunnel"?"Target":"Bind"}</span>
                                <span class="dval"><span class="dval-mono">${a.data.endpoint}</span></span>
                              </div>
                              ${a.kind==="tunnel"&&a.data.options?.hostname?o`<div class="detail-row">
                                  <span class="dlabel">${e("switchRewriteHost")}</span>
                                  <span class="dval"><span class="dval-mono">${a.data.options.hostname}</span></span>
                                </div>`:""}
                              ${a.data.error?o`<div class="detail-row error"><span class="dlabel">${e("eventsLevelError")}</span><span class="dval error-text"><span class="dval-mono">${a.data.error}</span></span></div>`:""}
                            </div>
                            <div class="expand-actions">
                              ${a.data.status==="running"?o`
                                  <button class="action-btn stop" title="${e("btnStop")}" @click=${i=>{i.stopPropagation(),this._handleStop(a)}}>${u("stop")}</button>
                                `:o`
                                  <button class="action-btn start" title="${e("btnStart")}" @click=${i=>{i.stopPropagation(),this._handleStart(a)}}>${u("play")}</button>
                                `}
                              <button class="action-btn" title="${e("btnEdit")}" @click=${i=>{i.stopPropagation(),this._navigate(s+"?edit")}}>${u("edit")}</button>
                              <button class="action-btn danger" title="${e("btnDelete")}" @click=${i=>{i.stopPropagation(),this._confirmDelete(a.kind,a.data.id,a.data.name)}}>${u("trash")}</button>
                              ${a.data.entrypoint?o`<button class="action-btn qr" title="${e("qrCode")}" style="margin-left:auto;"
                                    @click=${i=>{i.stopPropagation(),this._openQrDialog(a.data.entrypoint)}}>
                                    ${u("qr")}
                                  </button>`:""}
                              ${a.kind==="tunnel"&&(a.data.type==="http"||a.data.type==="file")&&j().inspector_url?o`<button class="action-btn inspect" title="${e("inspectorEntryTitle")}"
                                    style="${a.data.entrypoint?"":"margin-left:auto;"}"
                                    @click=${i=>{i.stopPropagation(),this._navigate(`/tunnel/${a.data.type}/${a.data.id}/inspector`)}}>
                                    ${u("search")}
                                  </button>`:""}
                            </div>
                          </div>
                        `:""}
                    </div>
                  `})}
              </div>
            `}

        <!-- FAB -->
        <div slot="fab">
          <button class="fab" @click=${()=>this._navigate(n)}>
            ${u("plus")}
          </button>
        </div>
      </app-scaffold>

      ${this._snackbar?o`<div class="toast">${this._snackbar}</div>`:""}

      ${this._qrUrl?o`
          <div class="dialog-overlay" @click=${()=>this._closeQrDialog()}>
            <div class="dialog-box" @click=${a=>a.stopPropagation()}>
              <div class="dialog-title">${e("qrCode")}</div>
              <div class="qr-body">
                <canvas id="qrCanvas"></canvas>
                <div class="qr-url">${this._qrUrl}</div>
              </div>
              <div class="dialog-actions">
                <button class="dialog-btn cancel" @click=${()=>this._closeQrDialog()}>
                  ${e("btnClose")}
                </button>
              </div>
            </div>
          </div>
        `:""}

      ${this._deleteTarget?o`
          <div class="dialog-overlay" @click=${()=>{this._deleteTarget=null}}>
            <div class="dialog-box" @click=${a=>a.stopPropagation()}>
              <div class="dialog-title">${e("deleteConfirmTitle")}</div>
              <div class="dialog-message">${e("deleteConfirmMessage")}</div>
              <div class="dialog-actions">
                <button class="dialog-btn cancel" @click=${()=>{this._deleteTarget=null}}>
                  ${e("btnCancel")}
                </button>
                <button class="dialog-btn danger" @click=${this._handleDelete}>
                  ${e("btnDelete")}
                </button>
              </div>
            </div>
          </div>
        `:""}
    `}};h.styles=x`
    /* ── Home header (inside appbar slot) ── */
    .home-header {
      display: flex;
      align-items: center;
      width: 100%;
      gap: 8px;
    }

    .app-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .app-icon img {
      width: 16px;
      height: 16px;
      object-fit: contain;
      display: block;
    }

    .appbar-title {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--text);
    }

    .header-spacer {
      flex: 1;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast), color var(--transition-fast);
      width: 28px;
      height: 28px;
    }

    .icon-btn:hover {
      background: var(--border-subtle);
      color: var(--text);
    }

    .icon-btn.active {
      color: var(--amber);
    }

    /* ── List ── */
    .list {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 16px 80px 16px;
    }

    /* ── Expand panel ── */
    .expand-panel {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-anchor: none;
    }
    .expand-panel * {
      overflow-anchor: none;
    }

    .expand-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--font-sm);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      color: var(--text-secondary);
      word-break: break-all;
    }

    .expand-row .mono {
      flex: 1;
      color: var(--text);
    }

    .expand-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 4px;
    }

    .action-btn {
      padding: 5px 12px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      line-height: 1;
      cursor: pointer;
      font-family: inherit;
      transition: background var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .action-btn svg {
      width: 14px;
      height: 14px;
    }

    .action-btn:hover {
      background: var(--border-subtle);
    }

    .action-btn.start {
      background: var(--green);
      color: #fff;
      border-color: var(--green);
    }

    .action-btn.stop {
      background: var(--red);
      color: #fff;
      border-color: var(--red);
    }

    .action-btn.danger {
      color: var(--red);
      border-color: var(--red-border);
    }

    .expand-error {
      font-size: var(--font-sm);
      color: var(--red-text);
      padding: 4px 8px;
      background: var(--red-bg);
      border-radius: var(--radius-sm);
    }

    /* ── Expand detail card ── */
    .detail-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .detail-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-row .dlabel {
      color: var(--text-muted);
      font-size: var(--font-sm);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .detail-row .dval {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: var(--font-sm);
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .dval-mono {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-row.error {
      background: var(--red-bg);
    }
    .detail-row .error-text {
      color: var(--red-text);
    }
    .copy-btn-mini {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: var(--text-muted);
      display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover {
      background: var(--border-subtle);
      color: var(--text);
    }

    .dval-link {
      color: var(--accent);
      text-decoration: none;
    }
    .dval-link:hover {
      text-decoration: underline;
    }

    .action-btn.qr {
      color: var(--accent);
      border-color: var(--accent);
    }
    .action-btn.inspect {
      color: var(--accent);
      border-color: var(--accent);
    }

    .qr-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      margin: 16px 0;
    }
    .qr-body canvas {
      width: 200px;
      height: 200px;
      background: #fff;
      border-radius: var(--radius-sm);
      padding: 8px;
      box-sizing: border-box;
      image-rendering: pixelated;
    }
    .qr-url {
      font-size: var(--font-xs);
      color: var(--text-secondary);
      text-align: center;
      word-break: break-all;
      line-height: 1.4;
      max-width: 100%;
    }

    /* ── Empty state ── */
    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 40px;
      color: var(--text-muted);
      gap: 8px;
      text-align: center;
    }

    .empty-icon-wrap {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--surface);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
      color: var(--text-muted);
    }

    .empty-title {
      font-weight: 600;
      font-size: var(--font-md);
      color: var(--text);
    }

    .empty-desc {
      font-size: var(--font-md);
      color: var(--text-secondary);
      max-width: 240px;
      line-height: 1.5;
      margin-bottom: 4px;
    }

    .empty-action {
      padding: 7px 18px;
      border-radius: var(--radius-md);
      border: none;
      background: var(--accent);
      color: var(--accent-fg);
      font-size: var(--font-md);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity var(--transition-fast);
    }

    .empty-action:hover {
      opacity: 0.85;
    }

    .empty-sub-link {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: var(--font-sm);
      cursor: pointer;
      font-family: inherit;
      text-decoration: underline;
      padding: 4px 8px;
    }

    .empty-sub-link:hover {
      color: var(--text);
    }

    /* ── Loading ── */
    .loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    /* ── FAB ── */
    .fab {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.1s, opacity var(--transition-fast);
    }

    .fab:hover {
      opacity: 0.9;
    }

    .fab:active {
      transform: scale(0.96);
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface);
      color: var(--text);
      padding: 10px 20px;
      border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: var(--font-sm);
      z-index: 100;
      animation: toast-in 0.3s ease;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-12px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    /* ── Delete dialog ── */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }

    @keyframes fade-in {
      from { opacity: 0; }
    }

    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      max-width: 320px;
      width: 90%;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }

    .dialog-title {
      font-weight: 600;
      font-size: var(--font-md);
      margin-bottom: 8px;
      text-align: center;
    }

    .dialog-message {
      color: var(--text-secondary);
      font-size: var(--font-sm);
      margin-bottom: 20px;
      text-align: center;
      line-height: 1.5;
    }

    .dialog-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .dialog-btn {
      padding: 8px 20px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-weight: 500;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .dialog-btn.cancel {
      background: var(--border-subtle);
      color: var(--text);
    }

    .dialog-btn.danger {
      background: var(--red);
      color: #fff;
    }

    .dialog-btn:hover {
      opacity: 0.85;
    }
  `;v([b()],h.prototype,"_activeTab",2);v([b()],h.prototype,"showFavorites",2);v([b()],h.prototype,"_tunnels",2);v([b()],h.prototype,"_entrypoints",2);v([b()],h.prototype,"_tunnelsLoading",2);v([b()],h.prototype,"_entrypointsLoading",2);v([b()],h.prototype,"_expandedId",2);v([b()],h.prototype,"_snackbar",2);v([b()],h.prototype,"_deleteTarget",2);v([b()],h.prototype,"_qrUrl",2);h=v([m("home-page")],h);export{h as HomePage};
