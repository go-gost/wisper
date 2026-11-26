import{a as y,G as w,c as i,C as $,A as p,b as r,i as k,t as q}from"./index-0vfIyfny.js";import{h as v,e as E,a as x,n as m,r as h}from"./format-DAHM04dM.js";import{i as g}from"./app-scaffold-C_F3aZAQ.js";import{a as b}from"./entrypoint-request-StVOFSv4.js";var P=Object.defineProperty,R=Object.getOwnPropertyDescriptor,d=(t,e,s,n)=>{for(var a=n>1?void 0:n?R(e,s):e,c=t.length-1,o;c>=0;c--)(o=t[c])&&(a=(n?o(e,s,a):o(a))||a);return n&&a&&P(e,s,a),a};const T=2e3,I=200;let l=class extends y{constructor(){super(...arguments),this.parentType="",this.parentId="",this._requests=[],this._entrypoint=null,this._error="",this._auto=!0,this._loading=!1,this._pageHidden=document.visibilityState!=="visible",this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._backend=new w,this._timer=null,this._connected=!1,this._activeId="",this._loadToken=0,this._onVisibilityChange=()=>{this._pageHidden=document.visibilityState!=="visible",this._configurePolling(),!this._pageHidden&&this._auto&&this._load()}}connectedCallback(){super.connectedCallback(),this._connected=!0,this._activeId=this.parentId,this._pageHidden=document.visibilityState!=="visible",document.addEventListener("visibilitychange",this._onVisibilityChange),this._configurePolling(),this._load()}disconnectedCallback(){this._connected=!1,document.removeEventListener("visibilitychange",this._onVisibilityChange),this._clearTimer(),super.disconnectedCallback()}updated(t){!t.has("parentId")||!this._connected||this.parentId===this._activeId||(this._activeId=this.parentId,this._loadToken+=1,this._requests=[],this._entrypoint=null,this._error="",this._loading=!1,this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._configurePolling(),this._load())}_clearTimer(){this._timer!==null&&clearTimeout(this._timer),this._timer=null}_configurePolling(){this._clearTimer(),!(!this._connected||!this._auto||this._pageHidden)&&(this._timer=window.setTimeout(()=>{this._timer=null,!(!this._connected||!this._auto||this._pageHidden)&&this._load().then(()=>this._configurePolling())},T))}async _load(t=!1){const e=this.parentId;if(!e||!this._connected||this._loading&&!t)return;const s=++this._loadToken;this._loading=!0;try{const[n,a]=await Promise.all([this._backend.getEntrypointRequests(e,500),this._backend.getEntrypoint(e)]);if(!this._connected||s!==this._loadToken||e!==this._activeId)return;this._requests=[...n.requests??[]].sort((c,o)=>Date.parse(o.time)-Date.parse(c.time)),this._entrypoint=a,this._error=""}catch(n){if(!this._connected||s!==this._loadToken||e!==this._activeId)return;const a=n instanceof Error?n.message:"";this._error=`${i("requestsError")}${a?`: ${a}`:""}`}finally{s===this._loadToken&&(this._loading=!1)}}_toggleAuto(){this._auto=!this._auto,this._configurePolling(),this._auto&&!this._pageHidden&&this._load()}_requestKey(t){return[t.time,t.host,t.dst,t.network,t.proto].join("|")}_toggleExpanded(t){const e=this._requestKey(t),s=new Set(this._expanded);s.has(e)?s.delete(e):s.add(e),this._expanded=s}_setRowError(t,e){const s=new Map(this._rowErrors);e?s.set(t,e):s.delete(t),this._rowErrors=s}async _toggleRule(t){const e=this.parentId,{key:s}=b(t);if(!e||!s||this._savingKey)return;const n=this._entrypoint?.options?.rules??[],c=n.includes(s)?n.filter(o=>o!==s):[...n,s];this._savingKey=s,this._setRowError(s,"");try{const o=await $(e,c);if(!this._connected||e!==this._activeId)return;this._entrypoint=o,await this._load(!0)}catch(o){if(!this._connected||e!==this._activeId)return;const u=o instanceof Error?o.message:"";this._setRowError(s,`${i("requestsRuleError")}${u?`: ${u}`:""}`)}finally{this._connected&&e===this._activeId&&(this._savingKey="")}}_renderPath(t){return r`
      <div class="path-heading">${i("requestsPath")}</div>
      <ol class="request-path" role="list">
        ${(t.path??[]).map(e=>r`
          <li>
            <span>${i("requestsHop",{n:e.hop})} · ${e.chain||"—"} · ${e.node||"—"}</span>
            <span>${e.addr}</span>
            <span>${v(e.connect_ms*1e6)}</span>
            ${e.err?r`<span class="request-error">${i("requestsFlowError")}: ${e.err}</span>`:p}
          </li>
        `)}
      </ol>
    `}_renderRequest(t){const e=b(t),n=(this._entrypoint?.options?.rules??[]).includes(e.key),a=[t.network,t.proto].filter(Boolean).join("/"),c=this._requestKey(t),o=this._expanded.has(c),u=!!t.path?.length,_=this._rowErrors.get(e.key),f=r`
      <time datetime=${t.time}>${E(Date.parse(t.time))}</time>
      <span class="destination" title=${e.name}>
        ${e.name}${e.port?r`<span class="destination-port">:${e.port}</span>`:p}
      </span>
      <span class="route-badge ${t.tunneled?"tunnel":"direct"}">
        ${t.tunneled?i("requestsTunnel"):i("requestsDirect")}
      </span>
      ${a?r`<span class="protocol">${a}</span>`:p}
      <span class="traffic">${i("requestsTrafficValue",{in:x(t.input_bytes),out:x(t.output_bytes)})}</span>
      <span class="duration">${v(t.duration_ms*1e6)}</span>
      ${t.err?r`<span class="request-error" title=${t.err}>${t.err}</span>`:p}
      ${u?r`
          <span class="path-chevron" aria-hidden="true">${g(o?"chevron-down":"chevron-right")}</span>
          <span class="sr-only">${o?i("requestsPathHide",{destination:e.name}):i("requestsPathShow",{destination:e.name})}</span>
        `:p}
    `;return r`
      <li class="request-row">
        <div class="request-line">
          ${u?r`<button type="button" class="row-toggle"
                aria-expanded=${o}
                @click=${()=>this._toggleExpanded(t)}>${f}</button>`:r`<div class="row-content">${f}</div>`}
          ${e.key?r`<button type="button" class="rule-action"
                aria-label=${n?i("requestsRemoveRuleFor",{destination:e.key}):i("requestsAddRuleFor",{destination:e.key})}
                ?disabled=${this._savingKey!==""}
                @click=${()=>this._toggleRule(t)}>
                <span aria-hidden="true">${g(n?"close":"plus")}</span>
                <span>${n?i("requestsRemoveRule"):i("requestsAddRule")}</span>
              </button>`:p}
        </div>
        ${_?r`<div class="row-error" role="alert">${_}</div>`:p}
        ${u&&o?this._renderPath(t):p}
      </li>
    `}get _backPath(){return`/entrypoint/${this.parentType}/${this.parentId}`}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const t=this._requests.slice(0,I);return r`
      <app-scaffold>
        <div slot="appBar" class="page-header">
          <button type="button" class="back-btn" aria-label=${i("requestsBack")}
            @click=${()=>this._navigate(this._backPath)}>
            <span aria-hidden="true">${g("chevron-left")}</span>
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
              <span aria-hidden="true">${g("rotate-cw")}</span>
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
    `}};l.styles=k`
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
      margin: 16px; background: var(--surface); border: 1px solid var(--border-subtle);
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
    .request-list { list-style: none; margin: 0; padding: 0; overflow-x: auto; }
    .request-row { padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-sm); }
    .request-row:last-child { border-bottom: none; }
    .request-row:hover { background: var(--border-subtle); }
    .request-line { display: flex; align-items: center; gap: 7px; min-width: max-content; }
    .row-toggle, .row-content {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
      border: 0; padding: 0; background: none; color: inherit; font: inherit; text-align: left;
      white-space: nowrap;
    }
    .row-toggle { cursor: pointer; }
    .row-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
    .request-row time, .traffic, .duration, .protocol {
      color: var(--text-muted); font-family: var(--font-mono, 'SF Mono', monospace); flex-shrink: 0;
    }
    .destination {
      max-width: 190px; overflow: hidden; text-overflow: ellipsis; color: var(--text); flex-shrink: 0;
    }
    .destination-port { color: var(--text-muted); }
    .route-badge {
      display: inline-flex; align-items: center; justify-content: center; padding: 1px 6px;
      border-radius: var(--radius-pill); font-size: var(--font-xs); font-weight: 600; flex-shrink: 0;
    }
    .route-badge.tunnel { color: var(--info); background: var(--info-bg); }
    .route-badge.direct { color: var(--green-text); background: var(--green-bg); }
    .request-error {
      max-width: 170px; overflow: hidden; text-overflow: ellipsis; color: var(--red-text); flex-shrink: 0;
    }
    .path-chevron { display: inline-flex; color: var(--text-muted); flex-shrink: 0; }
    .path-chevron svg { width: 12px; height: 12px; }
    .rule-action {
      min-height: 26px; margin-left: 8px; padding: 2px 7px; display: inline-flex; align-items: center; gap: 4px;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--accent); font-family: inherit; font-size: var(--font-xs);
      font-weight: 600; white-space: nowrap; cursor: pointer; flex-shrink: 0;
    }
    .rule-action svg { width: 12px; height: 12px; }
    .row-error { margin-top: 5px; color: var(--red-text); font-size: var(--font-xs); line-height: 1.4; }
    .path-heading { margin-top: 6px; color: var(--text-muted); font-size: var(--font-xs); font-weight: 600; }
    .request-path {
      margin: 2px 0 0; padding: 0; list-style: none; color: var(--text-muted); font-size: var(--font-xs);
    }
    .request-path li { display: flex; align-items: center; gap: 8px; min-width: 0; line-height: 1.6; }
    .request-path li > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .request-path .request-error { color: var(--red-text); }
    .showing-count { padding: 8px 12px; border-top: 1px solid var(--border-subtle); color: var(--text-muted); font-size: var(--font-xs); }
    @media (pointer: coarse) {
      .back-btn, .auto-toggle, .refresh-button, .rule-action { min-height: 36px; }
    }
  `;d([m({attribute:"parent-type"})],l.prototype,"parentType",2);d([m({attribute:"parent-id"})],l.prototype,"parentId",2);d([h()],l.prototype,"_requests",2);d([h()],l.prototype,"_entrypoint",2);d([h()],l.prototype,"_error",2);d([h()],l.prototype,"_auto",2);d([h()],l.prototype,"_loading",2);d([h()],l.prototype,"_pageHidden",2);d([h()],l.prototype,"_savingKey",2);d([h()],l.prototype,"_rowErrors",2);d([h()],l.prototype,"_expanded",2);l=d([q("entrypoint-requests-page")],l);export{l as EntrypointRequestsPage};
