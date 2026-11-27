import{a as T,G as P,c as s,C,b as o,A as c,i as D,t as I}from"./index-BV5MD0R3.js";import{a as _,h as z,i as S,n as $,r as h}from"./format-CQwwV_7H.js";import{i as u}from"./app-scaffold-E4RdUWBi.js";import{a as y,b as w}from"./entrypoint-request-BlTsP51B.js";var H=Object.defineProperty,K=Object.getOwnPropertyDescriptor,d=(e,t,i,n)=>{for(var r=n>1?void 0:n?K(t,i):t,p=e.length-1,a;p>=0;p--)(a=e[p])&&(r=(n?a(t,i,r):a(r))||r);return n&&r&&H(t,i,r),r};const j=2e3,M=200;let l=class extends T{constructor(){super(...arguments),this.parentType="",this.parentId="",this._requests=[],this._entrypoint=null,this._error="",this._auto=!0,this._loading=!1,this._pageHidden=document.visibilityState!=="visible",this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._backend=new P,this._timer=null,this._connected=!1,this._activeId="",this._loadToken=0,this._onVisibilityChange=()=>{this._pageHidden=document.visibilityState!=="visible",this._configurePolling(),!this._pageHidden&&this._auto&&this._load()}}connectedCallback(){super.connectedCallback(),this._connected=!0,this._activeId=this.parentId,this._pageHidden=document.visibilityState!=="visible",document.addEventListener("visibilitychange",this._onVisibilityChange),this._configurePolling(),this._load()}disconnectedCallback(){this._connected=!1,document.removeEventListener("visibilitychange",this._onVisibilityChange),this._clearTimer(),super.disconnectedCallback()}updated(e){!e.has("parentId")||!this._connected||this.parentId===this._activeId||(this._activeId=this.parentId,this._loadToken+=1,this._requests=[],this._entrypoint=null,this._error="",this._loading=!1,this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._configurePolling(),this._load())}_clearTimer(){this._timer!==null&&clearTimeout(this._timer),this._timer=null}_configurePolling(){this._clearTimer(),!(!this._connected||!this._auto||this._pageHidden)&&(this._timer=window.setTimeout(()=>{this._timer=null,!(!this._connected||!this._auto||this._pageHidden)&&this._load().then(()=>this._configurePolling())},j))}async _load(e=!1){const t=this.parentId;if(!t||!this._connected||this._loading&&!e)return;const i=++this._loadToken;this._loading=!0;try{const[n,r]=await Promise.all([this._backend.getEntrypointRequests(t,500),this._backend.getEntrypoint(t)]);if(!this._connected||i!==this._loadToken||t!==this._activeId)return;this._requests=[...n.requests??[]].sort((p,a)=>Date.parse(a.time)-Date.parse(p.time)),this._entrypoint=r,this._error=""}catch(n){if(!this._connected||i!==this._loadToken||t!==this._activeId)return;const r=n instanceof Error?n.message:"";this._error=`${s("requestsError")}${r?`: ${r}`:""}`}finally{i===this._loadToken&&(this._loading=!1)}}_toggleAuto(){this._auto=!this._auto,this._configurePolling(),this._auto&&!this._pageHidden&&this._load()}_requestKey(e){return[e.time,e.host,e.dst,e.network,e.proto].join("|")}_toggleExpanded(e){const t=this._requestKey(e),i=new Set(this._expanded);i.has(t)?i.delete(t):i.add(t),this._expanded=i}_setRowError(e,t){const i=new Map(this._rowErrors);t?i.set(e,t):i.delete(e),this._rowErrors=i}async _toggleRule(e){const t=this.parentId,{key:i}=y(e);if(!t||!i||this._savingKey)return;const n=this._entrypoint?.options?.rules??[],r=n.includes(i);if(!r&&n.some(a=>w(a,i)))return;const p=r?n.filter(a=>a!==i):[...new Set([...n,i])];this._savingKey=i,this._setRowError(i,"");try{const a=await C(t,p);if(!this._connected||t!==this._activeId)return;this._entrypoint=a,await this._load(!0)}catch(a){if(!this._connected||t!==this._activeId)return;const g=a instanceof Error?a.message:"";this._setRowError(i,`${s("requestsRuleError")}${g?`: ${g}`:""}`)}finally{this._connected&&t===this._activeId&&(this._savingKey="")}}_renderDetailChip(e,t,i=!1){return o`
      <span class="detail-chip ${i?"error":""}">
        <span class="detail-label">${e}:</span>
        <span class="detail-value">${t}</span>
      </span>
    `}_renderDetails(e,t){const i=e.path?.length?e.path.map(r=>r.chain&&r.node?`${r.chain}/${r.node}`:r.chain||r.node||r.addr).join(" → "):s("requestsRouteDirect"),n=s("requestsTrafficValue",{in:_(e.input_bytes),out:_(e.output_bytes)});return o`
      <div class="detail-chips">
        ${e.host&&e.host!==e.dst?this._renderDetailChip(s("requestsHost"),e.host):c}
        ${this._renderDetailChip(s("fieldTarget"),e.dst)}
        ${this._renderDetailChip(s("requestsRoute"),i)}
        ${this._renderDetailChip(s("requestsDuration"),t)}
        ${this._renderDetailChip(s("requestsBytes"),n)}
        ${e.err?this._renderDetailChip(s("requestsFlowError"),e.err,!0):c}
      </div>
    `}_renderRequest(e){const t=y(e),i=`${t.name}${t.port?`:${t.port}`:""}`,n=this._entrypoint?.options?.rules??[],r=n.includes(t.key),p=r?void 0:n.find(R=>w(R,t.key)),a=p?s("requestsRuleCoveredBy",{rule:p}):"",g=[e.network,e.proto].filter(Boolean).join(" · "),k=s("requestsTrafficValue",{in:_(e.input_bytes),out:_(e.output_bytes)}),x=[g,k].filter(Boolean).join(" · "),b=z(e.duration_ms*1e6),q=this._requestKey(e),f=this._expanded.has(q),m=this._rowErrors.get(t.key),v=r?s("requestsRemoveRuleFor",{destination:t.key}):s("requestsAddRuleFor",{destination:t.key}),E=o`
      <span class="destination" title=${i}>
        ${t.name}${t.port?o`<span class="destination-port">:${t.port}</span>`:c}
      </span>
      ${e.tunneled?o`<span class="tunnel-lock" role="img" title=${s("requestsTunnel")} aria-label=${s("requestsTunnel")}>
            ${u("lock")}
          </span>`:c}
      <span class="duration">${b}</span>
      <span class="path-chevron" aria-hidden="true">${u(f?"chevron-down":"chevron-right")}</span>
      <span class="sr-only">${f?s("requestsPathHide",{destination:i}):s("requestsPathShow",{destination:i})}</span>
    `;return o`
      <li class="request-row ${e.err?"error":""}">
        <div class="request-line">
          <button type="button" class="row-toggle"
            aria-expanded=${f}
            @click=${()=>this._toggleExpanded(e)}>${E}</button>
          ${t.key?r?o`<button type="button" class="rule-action"
                  title=${v}
                  aria-label=${v}
                  ?disabled=${this._savingKey!==""}
                  @click=${()=>this._toggleRule(e)}>
                  <span aria-hidden="true">${u("minus")}</span>
                </button>`:p?o`<span class="rule-covered" role="img" title=${a} aria-label=${a}>
                    <span aria-hidden="true">${u("check")}</span>
                  </span>`:o`<button type="button" class="rule-action"
                    title=${v}
                    aria-label=${v}
                    ?disabled=${this._savingKey!==""}
                    @click=${()=>this._toggleRule(e)}>
                    <span aria-hidden="true">${u("plus")}</span>
                  </button>`:c}
        </div>
        <div class="request-meta">
          <span class="meta-summary" title=${x}>${x}</span>
          <time class="meta-time" datetime=${e.time}>${S(e.time)}</time>
        </div>
        ${m?o`<div class="row-error" role="alert">${m}</div>`:c}
        ${f?this._renderDetails(e,b):c}
      </li>
    `}get _backPath(){return`/entrypoint/${this.parentType}/${this.parentId}`}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const e=this._requests.slice(0,M);return o`
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
            ${this._pageHidden?o`<div class="pause-indicator" role="status">${s("requestsPausedHidden")}</div>`:c}
          </div>
          ${this._error?o`<div class="requests-error" role="alert">${this._error}</div>`:c}
          ${this._requests.length===0?o`<div class="requests-empty">${s("requestsEmpty")}</div>`:o`
              <ol class="request-list" role="list" aria-label=${s("requestsPageTitle")}>
                ${e.map(t=>this._renderRequest(t))}
              </ol>
              ${this._requests.length>e.length?o`<div class="showing-count">${s("requestsShowing",{shown:e.length,total:this._requests.length})}</div>`:c}
            `}
        </div>
      </app-scaffold>
    `}};l.styles=D`
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
    .request-list {
      list-style: none; min-width: 0; margin: 0; padding: 8px;
      display: flex; flex-direction: column; gap: 4px; overflow-x: hidden;
    }
    .request-row {
      min-width: 0; box-sizing: border-box; padding: 8px 12px;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
      background: var(--surface); font-size: var(--font-sm);
    }
    .request-row.error { border-left: 2px solid var(--red); }
    .request-row:hover { background: var(--border-subtle); }
    .request-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .row-toggle {
      flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px;
      border: 0; padding: 0; background: none; color: inherit; font: inherit; text-align: left;
      white-space: nowrap; cursor: pointer;
    }
    .row-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 2px; }
    .destination {
      flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--text); font-family: var(--font-mono, 'SF Mono', monospace);
      font-weight: 500;
    }
    .destination-port { color: var(--text-muted); }
    .tunnel-lock { display: inline-flex; color: var(--accent); flex-shrink: 0; }
    .tunnel-lock svg { width: 13px; height: 13px; }
    .duration {
      margin-left: auto; flex-shrink: 0; color: var(--text-muted);
      font-family: var(--font-mono, 'SF Mono', monospace);
    }
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
      min-width: 0; margin-top: 2px; display: flex; align-items: center; gap: 8px;
      color: var(--text-muted); font-size: var(--font-xs); line-height: 1.4;
    }
    .meta-summary {
      flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .meta-time {
      margin-left: auto; flex: 0 0 auto; color: var(--text-muted);
      font-family: var(--font-mono, 'SF Mono', monospace); white-space: nowrap;
    }
    .detail-chips {
      min-width: 0; margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;
    }
    .detail-chip {
      min-width: 0; max-width: 100%; box-sizing: border-box; padding: 2px 8px;
      display: inline-flex; align-items: baseline; gap: 5px; border-radius: var(--radius-sm);
      background: var(--border); color: var(--text);
      font-size: var(--font-xs); line-height: 1.5; overflow-wrap: anywhere;
    }
    .detail-label { flex-shrink: 0; color: var(--text-muted); }
    .detail-value {
      min-width: 0; font-family: var(--font-mono, 'SF Mono', monospace); overflow-wrap: anywhere;
    }
    .detail-chip.error { background: var(--red-bg); color: var(--red-text); }
    .detail-chip.error .detail-label { color: var(--red-text); }
    .row-error {
      min-width: 0; margin-top: 5px; color: var(--red-text); font-size: var(--font-xs);
      line-height: 1.4; overflow-wrap: anywhere;
    }
    .showing-count { padding: 8px 12px; border-top: 1px solid var(--border-subtle); color: var(--text-muted); font-size: var(--font-xs); }
    @media (pointer: coarse) {
      .back-btn, .auto-toggle, .refresh-button { min-height: 36px; }
    }
  `;d([$({attribute:"parent-type"})],l.prototype,"parentType",2);d([$({attribute:"parent-id"})],l.prototype,"parentId",2);d([h()],l.prototype,"_requests",2);d([h()],l.prototype,"_entrypoint",2);d([h()],l.prototype,"_error",2);d([h()],l.prototype,"_auto",2);d([h()],l.prototype,"_loading",2);d([h()],l.prototype,"_pageHidden",2);d([h()],l.prototype,"_savingKey",2);d([h()],l.prototype,"_rowErrors",2);d([h()],l.prototype,"_expanded",2);l=d([I("entrypoint-requests-page")],l);export{l as EntrypointRequestsPage};
