const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-DZ8zfe64.js","assets/index-DIq3FqVg.css"])))=>i.map(i=>d[i]);
import{i as g,a as x,b as i,t as y,g as _,c as $,d as w,e as k,s as F,f as P,h as I,j as e,k as S,l as z,m as L,n as j,_ as E,o as R,p as D}from"./index-DZ8zfe64.js";import{n as p,r as v}from"./state-BwcQ29OT.js";import{i as h}from"./app-scaffold-BLUID3o2.js";import{c as B}from"./clipboard-C3x8_sid.js";import{f as C,a as T,b as N}from"./format-Dx8b12gY.js";var O=Object.defineProperty,q=Object.getOwnPropertyDescriptor,m=(t,n,r,a)=>{for(var s=a>1?void 0:a?q(n,r):n,c=t.length-1,o;c>=0;c--)(o=t[c])&&(s=(a?o(n,r,s):o(s))||s);return a&&s&&O(n,r,s),s};let f=class extends x{constructor(){super(...arguments),this.tabs=[],this.activeIndex=0}_handleClick(t){t!==this.activeIndex&&(this.activeIndex=t,this.dispatchEvent(new CustomEvent("tab-change",{detail:{index:t},bubbles:!0,composed:!0})))}render(){return i`
      <div class="pill-group">
        ${this.tabs.map((t,n)=>i`
            <button class=${n===this.activeIndex?"active":""} @click=${()=>this._handleClick(n)}>
              ${t}
            </button>
          `)}
      </div>
    `}};f.styles=g`
    :host {
      display: flex;
      justify-content: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
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
      font-size: var(--font-lg);
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
  `;m([p({type:Array})],f.prototype,"tabs",2);m([p({type:Number})],f.prototype,"activeIndex",2);f=m([y("nav-tabs")],f);var A=Object.defineProperty,H=Object.getOwnPropertyDescriptor,l=(t,n,r,a)=>{for(var s=a>1?void 0:a?H(n,r):n,c=t.length-1,o;c>=0;c--)(o=t[c])&&(s=(a?o(n,r,s):o(s))||s);return a&&s&&A(n,r,s),s};let d=class extends x{constructor(){super(...arguments),this.name="",this.meta="",this.status="stopped",this.endpoint="",this.currentConns=0,this.totalConns=0,this.requestRate=0,this.inputBytes=0,this.outputBytes=0,this.inputRate=0,this.outputRate=0,this.expanded=!1,this.compact=!0,this.error=""}_onRowClick(t){this.dispatchEvent(new CustomEvent("card-click",{bubbles:!0,composed:!0}))}_onChevronClick(t){t.stopPropagation(),this.dispatchEvent(new CustomEvent("chevron-click",{bubbles:!0,composed:!0}))}render(){const t=this.status==="stopped";return i`
      <div class="row ${t?"stopped":""}" @click=${this._onRowClick}>
        <span class="dot ${this.status}"></span>

        <div class="info">
          <div class="name">${this.name}</div>
          <div class="meta">${this.meta}</div>
        </div>

        ${this.status==="running"?i`
          <div class="traffic">
            <div class="traffic-row">
              <span class="traffic-total">${C(this.inputBytes)}</span>
              <span>↑ ${T(this.inputRate)}</span>
            </div>
            <div class="traffic-row">
              <span class="traffic-total">${C(this.outputBytes)}</span>
              <span>↓ ${T(this.outputRate)}</span>
            </div>
          </div>
        `:""}

        <span class="chevron ${this.expanded?"open":""}" @click=${this._onChevronClick}>
          ${h("chevron-right")}
        </span>
      </div>

      ${this.error?i`<div class="error-banner">${this.error}</div>`:""}
    `}};d.styles=g`
    :host {
      display: block;
    }

    .row {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: background var(--transition-fast);
      gap: 10px;
    }

    .row:hover {
      background: var(--border-subtle);
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
      margin-top: 1px;
    }

    /* ── Traffic column ── */
    .traffic {
      flex-shrink: 0;
      text-align: right;
      font-size: var(--font-sm);
      color: var(--text);
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      min-width: 60px;
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
    }

    .chevron.open {
      transform: rotate(90deg);
    }

    /* ── Error ── */
    .error-banner {
      margin: 0 16px 8px 34px;
      padding: 6px 10px;
      background: var(--red-bg);
      border: 1px solid var(--red-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-xs);
      color: var(--red-text);
    }
  `;l([p()],d.prototype,"name",2);l([p()],d.prototype,"meta",2);l([p()],d.prototype,"status",2);l([p()],d.prototype,"endpoint",2);l([p({type:Number})],d.prototype,"currentConns",2);l([p({type:Number})],d.prototype,"totalConns",2);l([p({type:Number})],d.prototype,"requestRate",2);l([p({type:Number})],d.prototype,"inputBytes",2);l([p({type:Number})],d.prototype,"outputBytes",2);l([p({type:Number})],d.prototype,"inputRate",2);l([p({type:Number})],d.prototype,"outputRate",2);l([p({type:Boolean})],d.prototype,"expanded",2);l([p({type:Boolean})],d.prototype,"compact",2);l([p()],d.prototype,"error",2);d=l([y("tunnel-card")],d);var U=Object.defineProperty,M=Object.getOwnPropertyDescriptor,b=(t,n,r,a)=>{for(var s=a>1?void 0:a?M(n,r):n,c=t.length-1,o;c>=0;c--)(o=t[c])&&(s=(a?o(n,r,s):o(s))||s);return a&&s&&U(n,r,s),s};let u=class extends x{constructor(){super(...arguments),this.tabIndex=0,this.showFavorites=!1,this._tunnels=[],this._entrypoints=[],this._tunnelsLoading=!1,this._entrypointsLoading=!1,this._expandedId=null,this._unsubs=[],this._snackbar="",this._deleteTarget=null}connectedCallback(){super.connectedCallback(),this._tunnels=_(),this._entrypoints=$(),this._tunnelsLoading=w(),this._entrypointsLoading=k(),this._unsubs.push(F(()=>{this._tunnels=_(),this._tunnelsLoading=w(),this.requestUpdate()}),P(()=>{this._entrypoints=$(),this._entrypointsLoading=k(),this.requestUpdate()}),I(()=>this.requestUpdate()))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_toggleFavorites(){this.showFavorites=!this.showFavorites,this._expandedId=null}_toggleExpand(t){this._expandedId=this._expandedId===t?null:t}get _filteredTunnels(){return this.showFavorites?this._tunnels.filter(t=>t.favorite):this._tunnels}get _filteredEntrypoints(){return this.showFavorites?this._entrypoints.filter(t=>t.favorite):this._entrypoints}get _items(){return this.tabIndex===0?this._filteredTunnels.map(t=>({kind:"tunnel",data:t})):this._filteredEntrypoints.map(t=>({kind:"entrypoint",data:t}))}_isLoading(){return this.tabIndex===0?this._tunnelsLoading:this._entrypointsLoading}_statusLabel(t){switch(t){case"running":return e("statusRunning");case"stopped":return e("statusStopped");case"error":return e("statusError")}}_metaLine(t){const n=t.data.type.toUpperCase(),r=this._statusLabel(t.data.status);return t.data.status==="running"?`${n} · ${N(t.data.stats.current_conns)} conns`:`${n} · ${r}`}_renderEmptyState(){const t=this.tabIndex===0,n=t?this._tunnels.length===0:this._entrypoints.length===0;if(this.showFavorites)return i`
        <div class="empty">
          <div class="empty-icon-wrap">${h("star")}</div>
          <div class="empty-title">${e("homeNoFavorites")}</div>
          <div class="empty-desc">${t?e("homeNoFavTunnelHint"):e("homeNoFavEntryHint")}</div>
          <button class="empty-sub-link" @click=${this._toggleFavorites}>
            ${t?e("homeShowAllTunnels"):e("homeShowAllEntrypoints")}
          </button>
        </div>
      `;if(n){const r=t?"/tunnel/new":"/entrypoint/new";return i`
        <div class="empty">
          <div class="empty-icon-wrap">${h(t?"link":"broadcast")}</div>
          <div class="empty-title">${t?e("homeEmptyTunnels"):e("homeEmptyEntrypoints")}</div>
          <div class="empty-desc">${t?e("homeEmptyTunnelDesc"):e("homeEmptyEntryDesc")}</div>
          <button class="empty-action" @click=${()=>this._navigate(r)}>
            ${t?e("tunnelNewTitle"):e("entrypointNewTitle")}
          </button>
        </div>
      `}return i``}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar="",this.requestUpdate()},2500)}async _handleStart(t){try{t.kind==="tunnel"?await S(t.data.id):await z(t.data.id),this._showSnackbar(e("started"))}catch{this._showSnackbar(e("startFailed"))}}async _handleStop(t){try{t.kind==="tunnel"?await L(t.data.id):await j(t.data.id),this._showSnackbar(e("stopped"))}catch{this._showSnackbar(e("stopFailed"))}}_confirmDelete(t,n,r){this._deleteTarget={kind:t,id:n,name:r}}async _handleDelete(){if(!this._deleteTarget)return;const{kind:t,id:n}=this._deleteTarget;this._deleteTarget=null;try{t==="tunnel"?await E(()=>import("./index-DZ8zfe64.js").then(r=>r.F),__vite__mapDeps([0,1])).then(r=>r.remove(n)):await E(()=>import("./index-DZ8zfe64.js").then(r=>r.G),__vite__mapDeps([0,1])).then(r=>r.remove(n)),this._expandedId=null,this._showSnackbar(e("deleted"))}catch{this._showSnackbar(e("deleteFailed"))}}async _handleFavorite(t){t.kind==="tunnel"?await R(t.data.id):await D(t.data.id)}render(){const t=this._items,n=this._isLoading();this.tabIndex===0?e("homeEmptyTunnels"):e("homeEmptyEntrypoints");const r=this.tabIndex===0?"/tunnel/new":"/entrypoint/new";return i`
      <app-scaffold>
        <!-- Appbar -->
        <div slot="appBar" class="home-header">
          <div class="app-icon">W</div>
          <span class="appbar-title">${e("appName")}</span>
          <span class="header-spacer"></span>
          <button
            class="icon-btn ${this.showFavorites?"active":""}"
            @click=${this._toggleFavorites}
          >
            ${h(this.showFavorites?"star-filled":"star")}
          </button>
          <button class="icon-btn" @click=${()=>this._navigate("/settings")}>
            ${h("settings")}
          </button>
        </div>

        <!-- Tabs -->
        <nav-tabs
          .tabs=${[e("homeTabTunnel"),e("homeTabEntrypoint")]}
          .activeIndex=${this.tabIndex}
          @tab-change=${a=>{this.tabIndex=a.detail.index,this._expandedId=null}}
        ></nav-tabs>

        <!-- Body -->
        ${n?i`<div class="loading"><wisper-spinner></wisper-spinner></div>`:t.length===0?this._renderEmptyState():i`
              <div class="list">
                ${t.map(a=>{const s=a.kind==="tunnel"?`/tunnel/${a.data.type}/${a.data.id}`:`/entrypoint/${a.data.type}/${a.data.id}`,c=this._expandedId===a.data.id;return i`
                    <div>
                      <tunnel-card
                        .name=${a.data.name}
                        .meta=${this._metaLine(a)}
                        .status=${a.data.status}
                        .endpoint=${a.data.endpoint}
                        .error=${a.data.error}
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

                      ${c?i`
                          <div class="expand-panel">
                            <div class="detail-card">
                              <div class="detail-row">
                                <span class="dlabel">${a.kind==="tunnel"?"Entrypoint":"Endpoint"}</span>
                                <span class="dval">${a.data.entrypoint}
                                  <button class="copy-btn-mini" @click=${async o=>{o.stopPropagation(),await B(a.data.entrypoint),this._showSnackbar(e("copiedToClipboard"))}}>
                                    ${h("copy")}
                                  </button>
                                </span>
                              </div>
                              <div class="detail-row">
                                <span class="dlabel">${a.kind==="tunnel"?"Target":"Bind"}</span>
                                <span class="dval">${a.data.endpoint}</span>
                              </div>
                              ${a.kind==="tunnel"&&a.data.options?.hostname?i`<div class="detail-row">
                                  <span class="dlabel">Host Rewrite</span>
                                  <span class="dval">${a.data.options.hostname}</span>
                                </div>`:""}
                              ${a.data.error?i`<div class="detail-row error"><span class="dlabel">Error</span><span class="dval error-text">${a.data.error}</span></div>`:""}
                            </div>
                            <div class="expand-actions">
                              ${a.data.status==="running"?i`
                                  <button class="action-btn stop" @click=${o=>{o.stopPropagation(),this._handleStop(a)}}>■ ${e("btnStop")}</button>
                                `:i`
                                  <button class="action-btn start" @click=${o=>{o.stopPropagation(),this._handleStart(a)}}>▶ ${e("btnStart")}</button>
                                `}
                              <button class="action-btn" @click=${o=>{o.stopPropagation(),this._navigate(s+"?edit")}}>${h("edit")} ${e("btnEdit")}</button>
                              <button class="action-btn danger" @click=${o=>{o.stopPropagation(),this._confirmDelete(a.kind,a.data.id,a.data.name)}}>${h("trash")} ${e("btnDelete")}</button>
                            </div>
                          </div>
                        `:""}
                    </div>
                  `})}
              </div>
            `}

        <!-- FAB -->
        <div slot="fab">
          <button class="fab" @click=${()=>this._navigate(r)}>
            ${h("plus")}
          </button>
        </div>
      </app-scaffold>

      ${this._snackbar?i`<div class="toast">${this._snackbar}</div>`:""}

      ${this._deleteTarget?i`
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
    `}};u.styles=g`
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
      background: var(--accent);
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-fg);
      font-weight: 700;
      font-size: var(--font-sm);
      flex-shrink: 0;
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
      padding-bottom: 80px;
    }

    /* ── Expand panel ── */
    .expand-panel {
      padding: 12px 16px 12px 30px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .expand-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--font-xs);
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
      gap: 8px;
      margin-top: 4px;
    }

    .action-btn {
      padding: 5px 12px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-xs);
      cursor: pointer;
      font-family: inherit;
      transition: background var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
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
      font-size: var(--font-xs);
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
    }
    .detail-row .dval {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: var(--font-md);
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 4px;
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
      font-size: var(--font-lg);
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
      border-radius: var(--radius-lg);
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
  `;b([v()],u.prototype,"tabIndex",2);b([v()],u.prototype,"showFavorites",2);b([v()],u.prototype,"_tunnels",2);b([v()],u.prototype,"_entrypoints",2);b([v()],u.prototype,"_tunnelsLoading",2);b([v()],u.prototype,"_entrypointsLoading",2);b([v()],u.prototype,"_expandedId",2);b([v()],u.prototype,"_snackbar",2);b([v()],u.prototype,"_deleteTarget",2);u=b([y("home-page")],u);export{u as HomePage};
