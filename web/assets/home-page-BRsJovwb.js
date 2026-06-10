import{i as x,a as f,b as p,t as y,c as i,g as w,d as _,e as $,f as k,s as I,h as P,j as L,k as T,l as j}from"./index-C17mvF4N.js";import{n as c,r as v}from"./state-k6skofj7.js";import"./app-scaffold-DRHJfar-.js";import{f as C,a as g,b as F}from"./stats-row-B4GZDSEi.js";var E=Object.defineProperty,O=Object.getOwnPropertyDescriptor,m=(t,s,a,e)=>{for(var r=e>1?void 0:e?O(s,a):s,o=t.length-1,n;o>=0;o--)(n=t[o])&&(r=(e?n(s,a,r):n(r))||r);return e&&r&&E(s,a,r),r};let b=class extends f{constructor(){super(...arguments),this.tabs=[],this.activeIndex=0}_handleClick(t){t!==this.activeIndex&&(this.activeIndex=t,this.dispatchEvent(new CustomEvent("tab-change",{detail:{index:t},bubbles:!0,composed:!0})))}render(){return p`
      ${this.tabs.map((t,s)=>p`
          <button class=${s===this.activeIndex?"active":""} @click=${()=>this._handleClick(s)}>
            ${t}
          </button>
        `)}
    `}};b.styles=x`
    :host {
      display: flex;
      gap: 4px;
      padding: 4px;
      background: var(--color-surface);
      border-radius: var(--radius-pill);
      border: 1px solid var(--color-border);
    }

    button {
      flex: 1;
      padding: 8px 16px;
      border: none;
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--color-text-secondary);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
      position: relative;
      white-space: nowrap;
    }

    button.active {
      background: var(--color-primary);
      color: var(--color-primary-text);
    }

    button:hover:not(.active) {
      color: var(--color-text-primary);
      background: var(--color-surface-hover);
    }
  `;m([c({type:Array})],b.prototype,"tabs",2);m([c({type:Number})],b.prototype,"activeIndex",2);b=m([y("nav-tabs")],b);var z=Object.defineProperty,D=Object.getOwnPropertyDescriptor,u=(t,s,a,e)=>{for(var r=e>1?void 0:e?D(s,a):s,o=t.length-1,n;o>=0;o--)(n=t[o])&&(r=(e?n(s,a,r):n(r))||r);return e&&r&&z(s,a,r),r};let l=class extends f{constructor(){super(...arguments),this.name="",this.type="",this.endpoint="",this.entrypoint="",this.status="stopped",this.stats=null,this.error=""}_statusLabel(t){switch(t){case"running":return i("statusRunning");case"stopped":return i("statusStopped");case"error":return i("statusError")}}render(){const t=this.stats;return p`
      <div class="card">
        <div class="top-row">
          <span class="name">${this.name}</span>
          <div class="status-row">
            <span class="status-label">${this._statusLabel(this.status)}</span>
            <span class="status-dot ${this.status}"></span>
          </div>
        </div>

        <div class="mid-row">
          <span class="type-badge">${this.type}</span>
          <span class="endpoint" title=${this.endpoint}>${this.endpoint}</span>
        </div>

        ${t?p`
          <div class="stats-grid">
            <stats-row icon="link" .value=${C(t.current_conns)} .label=${g(t.request_rate)}></stats-row>
            <stats-row icon="arrow_upward" .value=${F(t.input_bytes)} .label=${g(t.input_rate_bytes)}></stats-row>
            <stats-row icon="arrow_downward" .value=${F(t.output_bytes)} .label=${g(t.output_rate_bytes)}></stats-row>
          </div>
        `:""}

        ${this.error?p`<div class="error-banner">${this.error}</div>`:""}
      </div>
    `}};l.styles=x`
    :host {
      display: block;
    }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 16px;
      cursor: pointer;
      transition: all var(--transition-fast);
      box-shadow: var(--shadow-card);
    }

    .card:hover {
      box-shadow: var(--shadow-card-hover);
    }

    .card:active {
      transform: scale(0.99);
    }

    .top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .name {
      font-weight: 600;
      font-size: 15px;
      color: var(--color-text-primary);
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.running {
      background: var(--color-running);
      box-shadow: 0 0 6px var(--color-running);
    }

    .status-dot.stopped {
      background: var(--color-stopped);
    }

    .status-dot.error {
      background: var(--color-error);
      box-shadow: 0 0 6px var(--color-error);
    }

    .status-label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .mid-row {
      display: flex;
      gap: 16px;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--color-text-secondary);
    }

    .type-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      background: var(--color-surface-hover);
      font-size: 11px;
      font-weight: 500;
      color: var(--color-text-secondary);
    }

    .endpoint {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 4px;
      color: var(--color-text-muted);
    }

    .error-banner {
      margin-top: 8px;
      padding: 8px 12px;
      background: var(--color-error-bg);
      border-radius: var(--radius-sm);
      font-size: 12px;
      color: var(--color-error);
    }
  `;u([c()],l.prototype,"name",2);u([c()],l.prototype,"type",2);u([c()],l.prototype,"endpoint",2);u([c()],l.prototype,"entrypoint",2);u([c()],l.prototype,"status",2);u([c()],l.prototype,"stats",2);u([c()],l.prototype,"error",2);l=u([y("tunnel-card")],l);var q=Object.defineProperty,N=Object.getOwnPropertyDescriptor,h=(t,s,a,e)=>{for(var r=e>1?void 0:e?N(s,a):s,o=t.length-1,n;o>=0;o--)(n=t[o])&&(r=(e?n(s,a,r):n(r))||r);return e&&r&&q(s,a,r),r};let d=class extends f{constructor(){super(...arguments),this.tabIndex=0,this.showFavorites=!1,this._tunnels=w(),this._entrypoints=_(),this._tunnelsLoading=$(),this._entrypointsLoading=k(),this._unsubs=[]}connectedCallback(){super.connectedCallback(),this._unsubs.push(I(()=>{this._tunnels=w(),this._tunnelsLoading=$(),this.requestUpdate()}),P(()=>{this._entrypoints=_(),this._entrypointsLoading=k(),this.requestUpdate()}),L(()=>this.requestUpdate()))}disconnectedCallback(){super.disconnectedCallback();for(const t of this._unsubs)t();this._unsubs=[]}_handleTabChange(t){this.tabIndex=t.detail.index,this.showFavorites=!1}_toggleFavorites(){this.showFavorites=!this.showFavorites}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}get _filteredTunnels(){return this.showFavorites?this._tunnels.filter(t=>t.favorite):this._tunnels}get _filteredEntrypoints(){return this.showFavorites?this._entrypoints.filter(t=>t.favorite):this._entrypoints}get _list(){return this.tabIndex===0?this._filteredTunnels:this._filteredEntrypoints}get _isLoading(){return this.tabIndex===0?this._tunnelsLoading:this._entrypointsLoading}_handleToggleFavorite(t,s){t.stopPropagation(),this.tabIndex===0?T(s):j(s)}render(){const t=this._list,s=this.tabIndex===0?i("homeEmptyTunnels"):i("homeEmptyEntrypoints"),a=this.tabIndex===0?"/tunnel/new":"/entrypoint/new";return p`
      <app-scaffold>
        <div slot="appBar" class="header">
          <div class="brand">
            <div class="brand-icon">W</div>
            ${i("appName")}
          </div>
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
                <span>${s}</span>
              </div>
            `:p`
              <div class="list">
                ${t.map(e=>p`
                  <div @click=${()=>{const r=this.tabIndex===0?"/tunnel":"/entrypoint";this._navigate(`${r}/${e.type}/${e.id}`)}}>
                    <tunnel-card
                      .name=${e.name}
                      .type=${e.type.toUpperCase()}
                      .endpoint=${e.endpoint}
                      .status=${e.status}
                      .stats=${e.stats}
                      .error=${e.error}
                    ></tunnel-card>
                  </div>
                `)}
              </div>
            `}

        <div slot="fab">
          <button class="fab" title="+" @click=${()=>this._navigate(a)}>+</button>
        </div>
      </app-scaffold>
    `}};d.styles=x`
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 18px;
      color: var(--color-primary);
    }

    .brand-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--color-primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 16px;
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 20px;
      padding: 6px;
      border-radius: 50%;
      color: var(--color-text-secondary);
      transition: all var(--transition-fast);
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-btn:hover {
      background: var(--color-surface-hover);
      color: var(--color-text-primary);
    }

    .icon-btn.active {
      color: var(--color-primary);
    }

    .nav-wrapper {
      margin-bottom: 16px;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
      color: var(--color-text-muted);
      text-align: center;
    }

    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.4;
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    .fab {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: var(--color-primary);
      color: var(--color-primary-text);
      font-size: 28px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transition: all var(--transition-fast);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .fab:hover {
      background: var(--color-primary-hover);
      transform: scale(1.05);
    }
  `;h([v()],d.prototype,"tabIndex",2);h([v()],d.prototype,"showFavorites",2);h([v()],d.prototype,"_tunnels",2);h([v()],d.prototype,"_entrypoints",2);h([v()],d.prototype,"_tunnelsLoading",2);h([v()],d.prototype,"_entrypointsLoading",2);d=h([y("home-page")],d);export{d as HomePage};
