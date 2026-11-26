import{a as P,G as R,c as s,C as T,A as c,b as r,i as I,t as z}from"./index-DKlL-Ne9.js";import{h as C,e as S,a as m,n as $,r as h}from"./format-3VhiqMmU.js";import{i as u}from"./app-scaffold-B5c3pcMo.js";import{a as y,b as w}from"./entrypoint-request-BlTsP51B.js";var H=Object.defineProperty,K=Object.getOwnPropertyDescriptor,d=(t,e,i,o)=>{for(var n=o>1?void 0:o?K(e,i):e,p=t.length-1,a;p>=0;p--)(a=t[p])&&(n=(o?a(e,i,n):a(n))||n);return o&&n&&H(e,i,n),n};const D=2e3,j=200;let l=class extends P{constructor(){super(...arguments),this.parentType="",this.parentId="",this._requests=[],this._entrypoint=null,this._error="",this._auto=!0,this._loading=!1,this._pageHidden=document.visibilityState!=="visible",this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._backend=new R,this._timer=null,this._connected=!1,this._activeId="",this._loadToken=0,this._onVisibilityChange=()=>{this._pageHidden=document.visibilityState!=="visible",this._configurePolling(),!this._pageHidden&&this._auto&&this._load()}}connectedCallback(){super.connectedCallback(),this._connected=!0,this._activeId=this.parentId,this._pageHidden=document.visibilityState!=="visible",document.addEventListener("visibilitychange",this._onVisibilityChange),this._configurePolling(),this._load()}disconnectedCallback(){this._connected=!1,document.removeEventListener("visibilitychange",this._onVisibilityChange),this._clearTimer(),super.disconnectedCallback()}updated(t){!t.has("parentId")||!this._connected||this.parentId===this._activeId||(this._activeId=this.parentId,this._loadToken+=1,this._requests=[],this._entrypoint=null,this._error="",this._loading=!1,this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._configurePolling(),this._load())}_clearTimer(){this._timer!==null&&clearTimeout(this._timer),this._timer=null}_configurePolling(){this._clearTimer(),!(!this._connected||!this._auto||this._pageHidden)&&(this._timer=window.setTimeout(()=>{this._timer=null,!(!this._connected||!this._auto||this._pageHidden)&&this._load().then(()=>this._configurePolling())},D))}async _load(t=!1){const e=this.parentId;if(!e||!this._connected||this._loading&&!t)return;const i=++this._loadToken;this._loading=!0;try{const[o,n]=await Promise.all([this._backend.getEntrypointRequests(e,500),this._backend.getEntrypoint(e)]);if(!this._connected||i!==this._loadToken||e!==this._activeId)return;this._requests=[...o.requests??[]].sort((p,a)=>Date.parse(a.time)-Date.parse(p.time)),this._entrypoint=n,this._error=""}catch(o){if(!this._connected||i!==this._loadToken||e!==this._activeId)return;const n=o instanceof Error?o.message:"";this._error=`${s("requestsError")}${n?`: ${n}`:""}`}finally{i===this._loadToken&&(this._loading=!1)}}_toggleAuto(){this._auto=!this._auto,this._configurePolling(),this._auto&&!this._pageHidden&&this._load()}_requestKey(t){return[t.time,t.host,t.dst,t.network,t.proto].join("|")}_toggleExpanded(t){const e=this._requestKey(t),i=new Set(this._expanded);i.has(e)?i.delete(e):i.add(e),this._expanded=i}_setRowError(t,e){const i=new Map(this._rowErrors);e?i.set(t,e):i.delete(t),this._rowErrors=i}async _toggleRule(t){const e=this.parentId,{key:i}=y(t);if(!e||!i||this._savingKey)return;const o=this._entrypoint?.options?.rules??[],n=o.includes(i);if(!n&&o.some(a=>w(a,i)))return;const p=n?o.filter(a=>a!==i):[...new Set([...o,i])];this._savingKey=i,this._setRowError(i,"");try{const a=await T(e,p);if(!this._connected||e!==this._activeId)return;this._entrypoint=a,await this._load(!0)}catch(a){if(!this._connected||e!==this._activeId)return;const g=a instanceof Error?a.message:"";this._setRowError(i,`${s("requestsRuleError")}${g?`: ${g}`:""}`)}finally{this._connected&&e===this._activeId&&(this._savingKey="")}}_renderPath(t){return r`
      <div class="path-heading">${s("requestsPath")}</div>
      <ol class="request-path" role="list">
        ${(t.path??[]).map(e=>r`
          <li>
            <span>${s("requestsHop",{n:e.hop})} · ${e.chain||"—"} · ${e.node||"—"}</span>
            <span class="path-address" title=${e.addr}>${e.addr}</span>
            <span>${C(e.connect_ms*1e6)}</span>
            ${e.err?r`<span class="request-error">${s("requestsFlowError")}: ${e.err}</span>`:c}
          </li>
        `)}
      </ol>
    `}_renderRequest(t){const e=y(t),i=`${e.name}${e.port?`:${e.port}`:""}`,o=this._entrypoint?.options?.rules??[],n=o.includes(e.key),p=n?void 0:o.find(E=>w(E,e.key)),a=p?s("requestsRuleCoveredBy",{rule:p}):"",g=[t.network,t.proto].filter(Boolean).join(" · "),k=`${(t.duration_ms/1e3).toFixed(1)} s`,q=this._requestKey(t),v=this._expanded.has(q),_=!!t.path?.length,x=this._rowErrors.get(e.key),f=n?s("requestsRemoveRuleFor",{destination:e.key}):s("requestsAddRuleFor",{destination:e.key}),b=r`
      <time datetime=${t.time}>${S(Date.parse(t.time))}</time>
      <span class="destination" title=${i}>
        ${e.name}${e.port?r`<span class="destination-port">:${e.port}</span>`:c}
      </span>
      <span class="route-badge ${t.tunneled?"tunnel":"direct"}">
        ${t.tunneled?s("requestsTunnel"):s("requestsDirect")}
      </span>
      ${_?r`
          <span class="path-chevron" aria-hidden="true">${u(v?"chevron-down":"chevron-right")}</span>
          <span class="sr-only">${v?s("requestsPathHide",{destination:i}):s("requestsPathShow",{destination:i})}</span>
        `:c}
    `;return r`
      <li class="request-row">
        <div class="request-line">
          ${_?r`<button type="button" class="row-toggle"
                aria-expanded=${v}
                @click=${()=>this._toggleExpanded(t)}>${b}</button>`:r`<div class="row-content">${b}</div>`}
          ${e.key?n?r`<button type="button" class="rule-action"
                  title=${f}
                  aria-label=${f}
                  ?disabled=${this._savingKey!==""}
                  @click=${()=>this._toggleRule(t)}>
                  <span aria-hidden="true">${u("minus")}</span>
                </button>`:p?r`<span class="rule-covered" role="img" title=${a} aria-label=${a}>
                    <span aria-hidden="true">${u("check")}</span>
                  </span>`:r`<button type="button" class="rule-action"
                    title=${f}
                    aria-label=${f}
                    ?disabled=${this._savingKey!==""}
                    @click=${()=>this._toggleRule(t)}>
                    <span aria-hidden="true">${u("plus")}</span>
                  </button>`:c}
        </div>
        <div class="request-meta">
          ${g?r`<span class="protocol">${g}</span><span class="meta-separator">·</span>`:c}
          <span class="traffic">${s("requestsTrafficValue",{in:m(t.input_bytes),out:m(t.output_bytes)})}</span>
          <span class="meta-separator">·</span>
          <span class="duration">${k}</span>
          ${t.err?r`<span class="request-error" title=${t.err}>${t.err}</span>`:c}
        </div>
        ${x?r`<div class="row-error" role="alert">${x}</div>`:c}
        ${_&&v?this._renderPath(t):c}
      </li>
    `}get _backPath(){return`/entrypoint/${this.parentType}/${this.parentId}`}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const t=this._requests.slice(0,j);return r`
      <app-scaffold>
        <div slot="appBar" class="page-header">
          <button type="button" class="back-btn" aria-label=${s("requestsBack")}
            @click=${()=>this._navigate(this._backPath)}>
            <span aria-hidden="true">${u("chevron-left")}</span>
          </button>
          <h1 class="page-title">${s("requestsPageTitle")}</h1>
          <div class="controls">
            <button type="button" class="auto-toggle" aria-pressed=${this._auto}
              @click=${this._toggleAuto}>
              <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
              <span>${s("requestsAuto")}</span>
            </button>
            <button type="button" class="refresh-button" ?disabled=${this._loading}
              @click=${()=>this._load(!0)}>
              <span aria-hidden="true">${u("rotate-cw")}</span>
              <span>${s("requestsRefresh")}</span>
            </button>
          </div>
        </div>

        <div class="requests-panel">
          <div class="panel-header">
            <span class="requests-count">${s(this._requests.length===1?"requestsCountOne":"requestsCount",{n:this._requests.length})}</span>
            ${this._pageHidden?r`<div class="pause-indicator" role="status">${s("requestsPausedHidden")}</div>`:c}
          </div>
          ${this._error?r`<div class="requests-error" role="alert">${this._error}</div>`:c}
          ${this._requests.length===0?r`<div class="requests-empty">${s("requestsEmpty")}</div>`:r`
              <ol class="request-list" role="list" aria-label=${s("requestsPageTitle")}>
                ${t.map(e=>this._renderRequest(e))}
              </ol>
              ${this._requests.length>t.length?r`<div class="showing-count">${s("requestsShowing",{shown:t.length,total:this._requests.length})}</div>`:c}
            `}
        </div>
      </app-scaffold>
    `}};l.styles=I`
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
    .rule-action > span, .rule-covered > span { display: inline-flex; }
    .rule-action svg, .rule-covered svg { width: 12px; height: 12px; }
    .rule-covered {
      flex: 0 0 24px; width: 24px; height: 24px; min-height: 24px; box-sizing: border-box;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--text-muted); cursor: default; flex-shrink: 0;
    }
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
  `;d([$({attribute:"parent-type"})],l.prototype,"parentType",2);d([$({attribute:"parent-id"})],l.prototype,"parentId",2);d([h()],l.prototype,"_requests",2);d([h()],l.prototype,"_entrypoint",2);d([h()],l.prototype,"_error",2);d([h()],l.prototype,"_auto",2);d([h()],l.prototype,"_loading",2);d([h()],l.prototype,"_pageHidden",2);d([h()],l.prototype,"_savingKey",2);d([h()],l.prototype,"_rowErrors",2);d([h()],l.prototype,"_expanded",2);l=d([z("entrypoint-requests-page")],l);export{l as EntrypointRequestsPage};
