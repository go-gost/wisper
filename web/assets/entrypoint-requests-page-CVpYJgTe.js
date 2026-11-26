import{a as $,G as k,c as i,C as q,A as p,b as r,i as E,t as P}from"./index-DdZaFbSL.js";import{h as T,e as I,a as m,n as y,r as h}from"./format-2yko4YxR.js";import{i as f}from"./app-scaffold-Dd7MaZJL.js";import{a as w}from"./entrypoint-request-C4_Gtjn5.js";var R=Object.defineProperty,z=Object.getOwnPropertyDescriptor,d=(t,e,s,o)=>{for(var n=o>1?void 0:o?z(e,s):e,c=t.length-1,a;c>=0;c--)(a=t[c])&&(n=(o?a(e,s,n):a(n))||n);return o&&n&&R(e,s,n),n};const S=2e3,C=200;let l=class extends ${constructor(){super(...arguments),this.parentType="",this.parentId="",this._requests=[],this._entrypoint=null,this._error="",this._auto=!0,this._loading=!1,this._pageHidden=document.visibilityState!=="visible",this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._backend=new k,this._timer=null,this._connected=!1,this._activeId="",this._loadToken=0,this._onVisibilityChange=()=>{this._pageHidden=document.visibilityState!=="visible",this._configurePolling(),!this._pageHidden&&this._auto&&this._load()}}connectedCallback(){super.connectedCallback(),this._connected=!0,this._activeId=this.parentId,this._pageHidden=document.visibilityState!=="visible",document.addEventListener("visibilitychange",this._onVisibilityChange),this._configurePolling(),this._load()}disconnectedCallback(){this._connected=!1,document.removeEventListener("visibilitychange",this._onVisibilityChange),this._clearTimer(),super.disconnectedCallback()}updated(t){!t.has("parentId")||!this._connected||this.parentId===this._activeId||(this._activeId=this.parentId,this._loadToken+=1,this._requests=[],this._entrypoint=null,this._error="",this._loading=!1,this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._configurePolling(),this._load())}_clearTimer(){this._timer!==null&&clearTimeout(this._timer),this._timer=null}_configurePolling(){this._clearTimer(),!(!this._connected||!this._auto||this._pageHidden)&&(this._timer=window.setTimeout(()=>{this._timer=null,!(!this._connected||!this._auto||this._pageHidden)&&this._load().then(()=>this._configurePolling())},S))}async _load(t=!1){const e=this.parentId;if(!e||!this._connected||this._loading&&!t)return;const s=++this._loadToken;this._loading=!0;try{const[o,n]=await Promise.all([this._backend.getEntrypointRequests(e,500),this._backend.getEntrypoint(e)]);if(!this._connected||s!==this._loadToken||e!==this._activeId)return;this._requests=[...o.requests??[]].sort((c,a)=>Date.parse(a.time)-Date.parse(c.time)),this._entrypoint=n,this._error=""}catch(o){if(!this._connected||s!==this._loadToken||e!==this._activeId)return;const n=o instanceof Error?o.message:"";this._error=`${i("requestsError")}${n?`: ${n}`:""}`}finally{s===this._loadToken&&(this._loading=!1)}}_toggleAuto(){this._auto=!this._auto,this._configurePolling(),this._auto&&!this._pageHidden&&this._load()}_requestKey(t){return[t.time,t.host,t.dst,t.network,t.proto].join("|")}_toggleExpanded(t){const e=this._requestKey(t),s=new Set(this._expanded);s.has(e)?s.delete(e):s.add(e),this._expanded=s}_setRowError(t,e){const s=new Map(this._rowErrors);e?s.set(t,e):s.delete(t),this._rowErrors=s}async _toggleRule(t){const e=this.parentId,{key:s}=w(t);if(!e||!s||this._savingKey)return;const o=this._entrypoint?.options?.rules??[],c=o.includes(s)?o.filter(a=>a!==s):[...o,s];this._savingKey=s,this._setRowError(s,"");try{const a=await q(e,c);if(!this._connected||e!==this._activeId)return;this._entrypoint=a,await this._load(!0)}catch(a){if(!this._connected||e!==this._activeId)return;const u=a instanceof Error?a.message:"";this._setRowError(s,`${i("requestsRuleError")}${u?`: ${u}`:""}`)}finally{this._connected&&e===this._activeId&&(this._savingKey="")}}_renderPath(t){return r`
      <div class="path-heading">${i("requestsPath")}</div>
      <ol class="request-path" role="list">
        ${(t.path??[]).map(e=>r`
          <li>
            <span>${i("requestsHop",{n:e.hop})} · ${e.chain||"—"} · ${e.node||"—"}</span>
            <span class="path-address" title=${e.addr}>${e.addr}</span>
            <span>${T(e.connect_ms*1e6)}</span>
            ${e.err?r`<span class="request-error">${i("requestsFlowError")}: ${e.err}</span>`:p}
          </li>
        `)}
      </ol>
    `}_renderRequest(t){const e=w(t),s=`${e.name}${e.port?`:${e.port}`:""}`,n=(this._entrypoint?.options?.rules??[]).includes(e.key),c=[t.network,t.proto].filter(Boolean).join(" · "),a=`${(t.duration_ms/1e3).toFixed(1)} s`,u=this._requestKey(t),g=this._expanded.has(u),_=!!t.path?.length,v=this._rowErrors.get(e.key),x=n?i("requestsRemoveRuleFor",{destination:e.key}):i("requestsAddRuleFor",{destination:e.key}),b=r`
      <time datetime=${t.time}>${I(Date.parse(t.time))}</time>
      <span class="destination" title=${s}>
        ${e.name}${e.port?r`<span class="destination-port">:${e.port}</span>`:p}
      </span>
      <span class="route-badge ${t.tunneled?"tunnel":"direct"}">
        ${t.tunneled?i("requestsTunnel"):i("requestsDirect")}
      </span>
      ${_?r`
          <span class="path-chevron" aria-hidden="true">${f(g?"chevron-down":"chevron-right")}</span>
          <span class="sr-only">${g?i("requestsPathHide",{destination:s}):i("requestsPathShow",{destination:s})}</span>
        `:p}
    `;return r`
      <li class="request-row">
        <div class="request-line">
          ${_?r`<button type="button" class="row-toggle"
                aria-expanded=${g}
                @click=${()=>this._toggleExpanded(t)}>${b}</button>`:r`<div class="row-content">${b}</div>`}
          ${e.key?r`<button type="button" class="rule-action"
                title=${x}
                aria-label=${x}
                ?disabled=${this._savingKey!==""}
                @click=${()=>this._toggleRule(t)}>
                <span aria-hidden="true">${f(n?"minus":"plus")}</span>
              </button>`:p}
        </div>
        <div class="request-meta">
          ${c?r`<span class="protocol">${c}</span><span class="meta-separator">·</span>`:p}
          <span class="traffic">${i("requestsTrafficValue",{in:m(t.input_bytes),out:m(t.output_bytes)})}</span>
          <span class="meta-separator">·</span>
          <span class="duration">${a}</span>
          ${t.err?r`<span class="request-error" title=${t.err}>${t.err}</span>`:p}
        </div>
        ${v?r`<div class="row-error" role="alert">${v}</div>`:p}
        ${_&&g?this._renderPath(t):p}
      </li>
    `}get _backPath(){return`/entrypoint/${this.parentType}/${this.parentId}`}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const t=this._requests.slice(0,C);return r`
      <app-scaffold>
        <div slot="appBar" class="page-header">
          <button type="button" class="back-btn" aria-label=${i("requestsBack")}
            @click=${()=>this._navigate(this._backPath)}>
            <span aria-hidden="true">${f("chevron-left")}</span>
          </button>
          <h1 class="page-title">${i("requestsPageTitle")}</h1>
          <div class="controls">
            <button type="button" class="auto-toggle" aria-pressed=${this._auto}
              @click=${this._toggleAuto}>
              <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
              <span>${i("requestsAuto")}</span>
            </button>
            <button type="button" class="refresh-button" ?disabled=${this._loading}
              @click=${()=>this._load(!0)}>
              <span aria-hidden="true">${f("rotate-cw")}</span>
              <span>${i("requestsRefresh")}</span>
            </button>
          </div>
        </div>

        <div class="requests-panel">
          <div class="panel-header">
            <span class="requests-count">${i(this._requests.length===1?"requestsCountOne":"requestsCount",{n:this._requests.length})}</span>
            ${this._pageHidden?r`<div class="pause-indicator" role="status">${i("requestsPausedHidden")}</div>`:p}
          </div>
          ${this._error?r`<div class="requests-error" role="alert">${this._error}</div>`:p}
          ${this._requests.length===0?r`<div class="requests-empty">${i("requestsEmpty")}</div>`:r`
              <ol class="request-list" role="list" aria-label=${i("requestsPageTitle")}>
                ${t.map(e=>this._renderRequest(e))}
              </ol>
              ${this._requests.length>t.length?r`<div class="showing-count">${i("requestsShowing",{shown:t.length,total:this._requests.length})}</div>`:p}
            `}
        </div>
      </app-scaffold>
    `}};l.styles=E`
    :host { display: block; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .page-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .back-btn, .auto-toggle, .refresh-button {
      min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--text-secondary); font-family: inherit; font-size: var(--font-sm);
      cursor: pointer;
    }
    .back-btn { padding: 4px 8px; }
    .back-btn svg { width: 15px; height: 15px; }
    .page-title { flex: 1; min-width: 120px; margin: 0; font-size: var(--font-md); font-weight: 600; color: var(--text); }
    .controls { display: flex; align-items: center; gap: 6px; }
    .auto-toggle, .refresh-button { padding: 4px 8px; }
    .refresh-button svg { width: 13px; height: 13px; }
    button:disabled { cursor: default; opacity: 0.55; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .toggle-track {
      width: 28px; height: 16px; padding: 2px; box-sizing: border-box;
      border-radius: 8px; background: var(--border); transition: background var(--transition-fast);
    }
    .toggle-knob {
      display: block; width: 12px; height: 12px; border-radius: 50%; background: #fff;
      transition: transform var(--transition-fast);
    }
    .auto-toggle[aria-pressed='true'] .toggle-track { background: var(--accent); }
    .auto-toggle[aria-pressed='true'] .toggle-knob { transform: translateX(12px); }
    .requests-panel {
      min-width: 0; margin: 16px; background: var(--surface); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg); overflow: hidden; container-type: inline-size;
    }
    .panel-header {
      min-height: 32px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;
      gap: 12px; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-sm);
    }
    .requests-count { color: var(--text-muted); white-space: nowrap; }
    .pause-indicator { color: var(--amber); font-size: var(--font-xs); }
    .requests-error {
      padding: 8px 12px; color: var(--red-text); background: var(--red-bg);
      font-size: var(--font-sm); line-height: 1.4;
    }
    .requests-empty { padding: 32px 12px; text-align: center; color: var(--text-muted); font-size: var(--font-sm); }
    .request-list { list-style: none; min-width: 0; margin: 0; padding: 0; overflow-x: hidden; }
    .request-row {
      min-width: 0; padding: 6px 12px; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-sm);
    }
    .request-row:last-child { border-bottom: none; }
    .request-row:hover { background: var(--border-subtle); }
    .request-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .row-toggle, .row-content {
      flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px;
      border: 0; padding: 0; background: none; color: inherit; font: inherit; text-align: left;
      white-space: nowrap;
    }
    .row-toggle { cursor: pointer; }
    .row-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 2px; }
    .request-row time {
      color: var(--text-muted); font-family: var(--font-mono, 'SF Mono', monospace); flex-shrink: 0;
    }
    .destination {
      flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--text);
    }
    .destination-port { color: var(--text-muted); }
    .route-badge {
      display: inline-flex; align-items: center; justify-content: center; padding: 1px 6px;
      border-radius: var(--radius-pill); font-size: var(--font-xs); font-weight: 600; flex-shrink: 0;
    }
    .route-badge.tunnel { color: var(--info); background: var(--info-bg); }
    .route-badge.direct { color: var(--green-text); background: var(--green-bg); }
    .path-chevron { display: inline-flex; color: var(--text-muted); flex-shrink: 0; }
    .path-chevron svg { width: 12px; height: 12px; }
    .rule-action {
      flex: 0 0 24px; width: 24px; height: 24px; min-height: 24px; box-sizing: border-box;
      padding: 0; display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--accent); cursor: pointer; flex-shrink: 0;
    }
    .rule-action > span { display: inline-flex; }
    .rule-action svg { width: 12px; height: 12px; }
    .request-meta {
      min-width: 0; margin-top: 2px; color: var(--text-muted); font-size: var(--font-xs);
      line-height: 1.4; overflow-wrap: anywhere;
    }
    .protocol, .traffic, .duration {
      color: var(--text-muted); font-family: var(--font-mono, 'SF Mono', monospace);
    }
    .meta-separator { color: var(--text-muted); }
    .request-error {
      display: block; min-width: 0; max-width: 100%; margin-top: 2px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; color: var(--red-text);
    }
    .row-error {
      min-width: 0; margin-top: 5px; color: var(--red-text); font-size: var(--font-xs);
      line-height: 1.4; overflow-wrap: anywhere;
    }
    .path-heading { margin-top: 6px; color: var(--text-muted); font-size: var(--font-xs); font-weight: 600; }
    .request-path {
      min-width: 0; margin: 2px 0 0; padding: 0; list-style: none; color: var(--text-muted); font-size: var(--font-xs);
    }
    .request-path li {
      display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0; line-height: 1.5;
    }
    .request-path li > span { min-width: 0; overflow-wrap: anywhere; }
    .request-path .path-address { flex: 1 1 100%; }
    .request-path .request-error { color: var(--red-text); }
    .showing-count { padding: 8px 12px; border-top: 1px solid var(--border-subtle); color: var(--text-muted); font-size: var(--font-xs); }
    @media (pointer: coarse) {
      .back-btn, .auto-toggle, .refresh-button { min-height: 36px; }
    }
  `;d([y({attribute:"parent-type"})],l.prototype,"parentType",2);d([y({attribute:"parent-id"})],l.prototype,"parentId",2);d([h()],l.prototype,"_requests",2);d([h()],l.prototype,"_entrypoint",2);d([h()],l.prototype,"_error",2);d([h()],l.prototype,"_auto",2);d([h()],l.prototype,"_loading",2);d([h()],l.prototype,"_pageHidden",2);d([h()],l.prototype,"_savingKey",2);d([h()],l.prototype,"_rowErrors",2);d([h()],l.prototype,"_expanded",2);l=d([P("entrypoint-requests-page")],l);export{l as EntrypointRequestsPage};
