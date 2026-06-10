import{i as f,a as x,b as p,t as m,c as i,g as _,d as w,e as $,f as L,s as I,h as P,j}from"./index-DvIQLlSN.js";import{n as c,r as v}from"./app-scaffold-D-01mgFn.js";import{f as k,a as g,b as T}from"./format-DfcOH1_a.js";var C=Object.defineProperty,E=Object.getOwnPropertyDescriptor,y=(t,r,n,s)=>{for(var e=s>1?void 0:s?E(r,n):r,a=t.length-1,o;a>=0;a--)(o=t[a])&&(e=(s?o(r,n,e):o(e))||e);return s&&e&&C(r,n,e),e};let b=class extends x{constructor(){super(...arguments),this.tabs=[],this.activeIndex=0}_handleClick(t){t!==this.activeIndex&&(this.activeIndex=t,this.dispatchEvent(new CustomEvent("tab-change",{detail:{index:t},bubbles:!0,composed:!0})))}render(){return p`
      ${this.tabs.map((t,r)=>p`
          <button class=${r===this.activeIndex?"active":""} @click=${()=>this._handleClick(r)}>
            ${t}
          </button>
        `)}
    `}};b.styles=f`
    :host {
      display: flex;
      background: var(--color-nav-bg);
      border-radius: 24px;
      padding: 4px;
      transition: background var(--transition-fast);
    }

    button {
      flex: 1;
      padding: 10px 0;
      text-align: center;
      border-radius: 20px;
      border: none;
      background: transparent;
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: background var(--transition-fast);
      font-family: inherit;
    }

    button.active {
      background: var(--color-nav-active-bg);
      font-weight: 600;
    }
  `;y([c({type:Array})],b.prototype,"tabs",2);y([c({type:Number})],b.prototype,"activeIndex",2);b=y([m("nav-tabs")],b);var F=Object.defineProperty,O=Object.getOwnPropertyDescriptor,u=(t,r,n,s)=>{for(var e=s>1?void 0:s?O(r,n):r,a=t.length-1,o;a>=0;a--)(o=t[a])&&(e=(s?o(r,n,e):o(e))||e);return s&&e&&F(r,n,e),e};let d=class extends x{constructor(){super(...arguments),this.name="",this.type="",this.endpoint="",this.status="stopped",this.stats=null,this.error=""}_statusLabel(t){switch(t){case"running":return i("statusRunning");case"stopped":return i("statusStopped");case"error":return i("statusError")}}render(){const t=this.stats;return p`
      <div class="card">
        <span class="status-dot ${this.status}"></span>

        <div class="tunnel-card-body">
          <!-- Left: info -->
          <div class="tunnel-card-left">
            <div class="tunnel-card-header">
              <span class="tunnel-name">${this.name}</span>
            </div>
            <div class="tunnel-meta">${this.type} · ${this._statusLabel(this.status)}</div>
            <div class="tunnel-endpoint">${this.endpoint}</div>
          </div>

          <!-- Right: stats -->
          ${t?p`
            <div class="tunnel-card-right">
              <stats-row icon="↕" .value=${`${k(t.current_conns)} / ${k(t.total_conns)}`} .rate=${g(t.request_rate)}></stats-row>
              <stats-row icon="↑" .value=${T(t.input_bytes)} .rate=${g(t.input_rate_bytes)}></stats-row>
              <stats-row icon="↓" .value=${T(t.output_bytes)} .rate=${g(t.output_rate_bytes)}></stats-row>
            </div>
          `:""}
        </div>

        ${this.error?p`<div class="error-banner">${this.error}</div>`:""}
      </div>
    `}};d.styles=f`
    :host {
      display: block;
    }

    .card {
      position: relative;
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-card);
      padding: 20px 24px;
      margin: 0 16px 16px;
      cursor: pointer;
      transition: background var(--transition-fast), box-shadow var(--transition-fast), transform 0.1s;
    }

    .card:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-card-hover);
    }

    .card:active {
      transform: translateY(0);
    }

    /* ── Two-column body ── */
    .tunnel-card-body {
      display: flex;
      gap: 24px;
      align-items: flex-start;
    }

    .tunnel-card-left {
      flex: 1;
      min-width: 0;
    }

    .tunnel-card-right {
      flex-shrink: 0;
      text-align: right;
      padding-top: 20px;
      --stats-justify: flex-end;
    }

    /* ── Header ── */
    .tunnel-card-header {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }

    .tunnel-name {
      font-weight: 600;
      font-size: 1.1rem;
    }

    /* ── Status dot — absolute top-right ── */
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      position: absolute;
      top: 20px;
      right: 24px;
    }

    .status-dot.running {
      background: var(--color-running);
    }

    .status-dot.stopped {
      background: var(--color-stopped);
    }

    .status-dot.error {
      background: var(--color-error);
    }

    /* ── Meta ── */
    .tunnel-meta {
      color: var(--color-stopped);
      font-size: 0.9rem;
      margin-bottom: 4px;
    }

    .tunnel-endpoint {
      font-size: 0.95rem;
      color: var(--color-text-primary);
      opacity: 0.8;
    }

    /* ── Error banner ── */
    .error-banner {
      margin-top: 12px;
      padding: 8px 12px;
      background: var(--color-error-bg);
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      color: var(--color-error);
    }

    /* ── Responsive ── */
    @media (max-width: 600px) {
      .tunnel-card-body {
        flex-direction: column;
        gap: 12px;
      }

      .tunnel-card-right {
        text-align: left;
        padding-top: 0;
        --stats-justify: flex-start;
      }
    }
  `;u([c()],d.prototype,"name",2);u([c()],d.prototype,"type",2);u([c()],d.prototype,"endpoint",2);u([c()],d.prototype,"status",2);u([c()],d.prototype,"stats",2);u([c()],d.prototype,"error",2);d=u([m("tunnel-card")],d);var z=Object.defineProperty,D=Object.getOwnPropertyDescriptor,h=(t,r,n,s)=>{for(var e=s>1?void 0:s?D(r,n):r,a=t.length-1,o;a>=0;a--)(o=t[a])&&(e=(s?o(r,n,e):o(e))||e);return s&&e&&z(r,n,e),e};let l=class extends x{constructor(){super(...arguments),this.tabIndex=0,this.showFavorites=!1,this._tunnels=_(),this._entrypoints=w(),this._tunnelsLoading=$(),this._entrypointsLoading=L(),this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._unsubs.push(I(()=>{this._tunnels=_(),this._tunnelsLoading=$(),this.requestUpdate()}),P(()=>{this._entrypoints=w(),this._entrypointsLoading=L(),this.requestUpdate()}),j(()=>this.requestUpdate()))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_handleTabChange(t){this.tabIndex=t.detail.index,this.showFavorites=!1}_toggleFavorites(){this.showFavorites=!this.showFavorites}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}get _filteredTunnels(){return this.showFavorites?this._tunnels.filter(t=>t.favorite):this._tunnels}get _filteredEntrypoints(){return this.showFavorites?this._entrypoints.filter(t=>t.favorite):this._entrypoints}get _list(){return this.tabIndex===0?this._filteredTunnels:this._filteredEntrypoints}get _isLoading(){return this.tabIndex===0?this._tunnelsLoading:this._entrypointsLoading}render(){const t=this._list,r=this.tabIndex===0?i("homeEmptyTunnels"):i("homeEmptyEntrypoints"),n=this.tabIndex===0?"/tunnel/new":"/entrypoint/new";return p`
      <app-scaffold>
        <!-- Home Header (NOT in appBar slot — renders as page content) -->
        <div class="home-header">
          <div class="app-icon">W</div>
          <div class="header-actions">
            <button
              class="icon-btn ${this.showFavorites?"active":""}"
              title=${this.showFavorites?i("homeAllTooltip"):i("homeFavoritesTooltip")}
              @click=${this._toggleFavorites}
            >${this.showFavorites?"★":"☆"}</button>
            <button class="icon-btn" title=${i("settingsTitle")} @click=${()=>this._navigate("/settings")}>⚙</button>
          </div>
        </div>

        <div class="nav-wrapper">
          <nav-tabs
            .tabs=${[i("homeTabTunnel"),i("homeTabEntrypoint")]}
            .activeIndex=${this.tabIndex}
            @tab-change=${this._handleTabChange}
          ></nav-tabs>
        </div>

        ${this._isLoading?p`<div class="loading"><wisper-spinner></wisper-spinner></div>`:t.length===0?p`
              <div class="empty">
                <span class="empty-icon">☁️</span>
                <span class="empty-text">${r}</span>
              </div>
            `:p`
              <div class="list">
                ${t.map(s=>p`
                  <div @click=${()=>{const e=this.tabIndex===0?"/tunnel":"/entrypoint";this._navigate(`${e}/${s.type}/${s.id}`)}}>
                    <tunnel-card
                      .name=${s.name}
                      .type=${s.type.toUpperCase()}
                      .endpoint=${s.endpoint}
                      .status=${s.status}
                      .stats=${s.stats}
                      .error=${s.error}
                    ></tunnel-card>
                  </div>
                `)}
              </div>
            `}

        <div slot="fab">
          <button class="fab" @click=${()=>this._navigate(n)}>+</button>
        </div>
      </app-scaffold>
    `}};l.styles=f`
    /* ── Home Header ── */
    .home-header {
      display: flex;
      align-items: center;
      padding: 16px;
      gap: 12px;
    }

    .app-icon {
      width: 42px;
      height: 42px;
      background: var(--color-primary);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 1.1rem;
    }

    .header-actions {
      margin-left: auto;
      display: flex;
      gap: 4px;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 8px;
      color: var(--color-text-primary);
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast);
      width: 36px;
      height: 36px;
    }

    .icon-btn:hover {
      background: var(--color-surface-variant);
    }

    .icon-btn.active {
      color: var(--color-fav);
    }

    /* ── Nav wrapper ── */
    .nav-wrapper {
      margin: 0 16px 12px;
    }

    /* ── List ── */
    .list {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding-bottom: 80px;
    }

    /* ── Empty state ── */
    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: var(--color-stopped);
    }

    .empty-icon {
      font-size: 3rem;
      margin-bottom: 12px;
      opacity: 0.4;
    }

    .empty-text {
      font-size: 1rem;
    }

    /* ── Loading ── */
    .loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    /* ── FAB (rounded square, like prototype) ── */
    .fab {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      border: none;
      background: var(--color-primary);
      color: var(--color-primary-text);
      font-size: 1.5rem;
      cursor: pointer;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.1s, background var(--transition-fast);
    }

    .fab:hover {
      transform: scale(1.05);
    }

    .fab:active {
      transform: scale(0.97);
    }
  `;h([v()],l.prototype,"tabIndex",2);h([v()],l.prototype,"showFavorites",2);h([v()],l.prototype,"_tunnels",2);h([v()],l.prototype,"_entrypoints",2);h([v()],l.prototype,"_tunnelsLoading",2);h([v()],l.prototype,"_entrypointsLoading",2);l=h([m("home-page")],l);export{l as HomePage};
