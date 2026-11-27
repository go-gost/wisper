import{a as T,G as z,c as r,C,b as n,A as c,i as P,t as I}from"./index-CYOSUTk3.js";import{a as b,h as S,i as D,n as $,r as h}from"./format-BMdjvVtd.js";import{i as u}from"./app-scaffold-jLAotM97.js";import{a as y,b as w}from"./entrypoint-request-BlTsP51B.js";var F=Object.defineProperty,H=Object.getOwnPropertyDescriptor,d=(e,t,i,a)=>{for(var s=a>1?void 0:a?H(t,i):t,p=e.length-1,o;p>=0;p--)(o=e[p])&&(s=(a?o(t,i,s):o(s))||s);return a&&s&&F(t,i,s),s};const L=2e3,j=200,K=[{value:"all",label:"requestsFilterAll"},{value:"direct",label:"requestsDirect"},{value:"tunneled",label:"requestsTunnel"},{value:"error",label:"requestsFlowError"}];let l=class extends T{constructor(){super(...arguments),this.parentType="",this.parentId="",this._requests=[],this._entrypoint=null,this._error="",this._auto=!0,this._loading=!1,this._pageHidden=document.visibilityState!=="visible",this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._query="",this._filter="all",this._backend=new z,this._timer=null,this._connected=!1,this._activeId="",this._loadToken=0,this._onVisibilityChange=()=>{this._pageHidden=document.visibilityState!=="visible",this._configurePolling(),!this._pageHidden&&this._auto&&this._load()}}connectedCallback(){super.connectedCallback(),this._connected=!0,this._activeId=this.parentId,this._pageHidden=document.visibilityState!=="visible",document.addEventListener("visibilitychange",this._onVisibilityChange),this._configurePolling(),this._load()}disconnectedCallback(){this._connected=!1,document.removeEventListener("visibilitychange",this._onVisibilityChange),this._clearTimer(),super.disconnectedCallback()}updated(e){!e.has("parentId")||!this._connected||this.parentId===this._activeId||(this._activeId=this.parentId,this._loadToken+=1,this._requests=[],this._entrypoint=null,this._error="",this._loading=!1,this._savingKey="",this._rowErrors=new Map,this._expanded=new Set,this._query="",this._filter="all",this._configurePolling(),this._load())}_clearTimer(){this._timer!==null&&clearTimeout(this._timer),this._timer=null}_configurePolling(){this._clearTimer(),!(!this._connected||!this._auto||this._pageHidden)&&(this._timer=window.setTimeout(()=>{this._timer=null,!(!this._connected||!this._auto||this._pageHidden)&&this._load().then(()=>this._configurePolling())},L))}async _load(e=!1){const t=this.parentId;if(!t||!this._connected||this._loading&&!e)return;const i=++this._loadToken;this._loading=!0;try{const[a,s]=await Promise.all([this._backend.getEntrypointRequests(t,500),this._backend.getEntrypoint(t)]);if(!this._connected||i!==this._loadToken||t!==this._activeId)return;this._requests=[...a.requests??[]].sort((p,o)=>Date.parse(o.time)-Date.parse(p.time)),this._entrypoint=s,this._error=""}catch(a){if(!this._connected||i!==this._loadToken||t!==this._activeId)return;const s=a instanceof Error?a.message:"";this._error=`${r("requestsError")}${s?`: ${s}`:""}`}finally{i===this._loadToken&&(this._loading=!1)}}_toggleAuto(){this._auto=!this._auto,this._configurePolling(),this._auto&&!this._pageHidden&&this._load()}_requestKey(e){return[e.time,e.host,e.dst,e.network,e.proto].join("|")}_onSearchInput(e){this._query=e.target.value}_matchesFilter(e){switch(this._filter){case"direct":return!e.tunneled;case"tunneled":return e.tunneled;case"error":return e.err!=="";default:return!0}}_matchesQuery(e){const t=this._query.trim().toLowerCase();return t?[e.host,e.dst].some(i=>i.toLowerCase().includes(t)):!0}get _filteredRequests(){return this._requests.filter(e=>this._matchesFilter(e)&&this._matchesQuery(e))}get _filtering(){return this._query.trim()!==""||this._filter!=="all"}_toggleExpanded(e){const t=this._requestKey(e),i=new Set(this._expanded);i.has(t)?i.delete(t):i.add(t),this._expanded=i}_setRowError(e,t){const i=new Map(this._rowErrors);t?i.set(e,t):i.delete(e),this._rowErrors=i}async _toggleRule(e){const t=this.parentId,{key:i}=y(e);if(!t||!i||this._savingKey)return;const a=this._entrypoint?.options?.rules??[],s=a.includes(i);if(!s&&a.some(o=>w(o,i)))return;const p=s?a.filter(o=>o!==i):[...new Set([...a,i])];this._savingKey=i,this._setRowError(i,"");try{const o=await C(t,p);if(!this._connected||t!==this._activeId)return;this._entrypoint=o,await this._load(!0)}catch(o){if(!this._connected||t!==this._activeId)return;const g=o instanceof Error?o.message:"";this._setRowError(i,`${r("requestsRuleError")}${g?`: ${g}`:""}`)}finally{this._connected&&t===this._activeId&&(this._savingKey="")}}_renderDetailChip(e,t,i=!1){return n`
      <span class="detail-chip ${i?"error":""}">
        <span class="detail-label">${e}:</span>
        <span class="detail-value">${t}</span>
      </span>
    `}_renderDetails(e,t){const i=e.path?.length?e.path.map(s=>s.chain&&s.node?`${s.chain}/${s.node}`:s.chain||s.node||s.addr).join(" → "):r("requestsRouteDirect"),a=r("requestsTrafficValue",{in:b(e.input_bytes),out:b(e.output_bytes)});return n`
      <div class="detail-chips">
        ${e.host&&e.host!==e.dst?this._renderDetailChip(r("requestsHost"),e.host):c}
        ${this._renderDetailChip(r("fieldTarget"),e.dst)}
        ${this._renderDetailChip(r("requestsRoute"),i)}
        ${this._renderDetailChip(r("requestsDuration"),t)}
        ${this._renderDetailChip(r("requestsBytes"),a)}
        ${e.err?this._renderDetailChip(r("requestsFlowError"),e.err,!0):c}
      </div>
    `}_renderRequest(e){const t=y(e),i=`${t.name}${t.port?`:${t.port}`:""}`,a=this._entrypoint?.options?.rules??[],s=a.includes(t.key),p=s?void 0:a.find(R=>w(R,t.key)),o=p?r("requestsRuleCoveredBy",{rule:p}):"",g=[e.network,e.proto].filter(Boolean).join(" · "),k=r("requestsTrafficValue",{in:b(e.input_bytes),out:b(e.output_bytes)}),x=[g,k].filter(Boolean).join(" · "),_=S(e.duration_ms*1e6),q=this._requestKey(e),f=this._expanded.has(q),m=this._rowErrors.get(t.key),v=s?r("requestsRemoveRuleFor",{destination:t.key}):r("requestsAddRuleFor",{destination:t.key}),E=n`
      <span class="destination" title=${i}>
        ${t.name}${t.port?n`<span class="destination-port">:${t.port}</span>`:c}
      </span>
      ${e.tunneled?n`<span class="tunnel-lock" role="img" title=${r("requestsTunnel")} aria-label=${r("requestsTunnel")}>
            ${u("lock")}
          </span>`:c}
      <span class="duration">${_}</span>
      <span class="path-chevron" aria-hidden="true">${u(f?"chevron-down":"chevron-right")}</span>
      <span class="sr-only">${f?r("requestsPathHide",{destination:i}):r("requestsPathShow",{destination:i})}</span>
    `;return n`
      <li class="request-row ${e.err?"error":""}">
        <div class="request-line">
          <button type="button" class="row-toggle"
            aria-expanded=${f}
            @click=${()=>this._toggleExpanded(e)}>${E}</button>
          ${t.key?s?n`<button type="button" class="rule-action"
                  title=${v}
                  aria-label=${v}
                  ?disabled=${this._savingKey!==""}
                  @click=${()=>this._toggleRule(e)}>
                  <span aria-hidden="true">${u("minus")}</span>
                </button>`:p?n`<span class="rule-covered" role="img" title=${o} aria-label=${o}>
                    <span aria-hidden="true">${u("check")}</span>
                  </span>`:n`<button type="button" class="rule-action"
                    title=${v}
                    aria-label=${v}
                    ?disabled=${this._savingKey!==""}
                    @click=${()=>this._toggleRule(e)}>
                    <span aria-hidden="true">${u("plus")}</span>
                  </button>`:c}
        </div>
        <div class="request-meta">
          <span class="meta-summary" title=${x}>${x}</span>
          <time class="meta-time" datetime=${e.time}>${D(e.time)}</time>
        </div>
        ${m?n`<div class="row-error" role="alert">${m}</div>`:c}
        ${f?this._renderDetails(e,_):c}
      </li>
    `}get _backPath(){return`/entrypoint/${this.parentType}/${this.parentId}`}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const e=this._filteredRequests,t=e.slice(0,j),i=this._filtering?r("requestsFilteredCount",{shown:e.length,total:this._requests.length}):r(this._requests.length===1?"requestsCountOne":"requestsCount",{n:this._requests.length});return n`
      <app-scaffold>
        <div slot="appBar" class="page-header">
          <button type="button" class="back-btn" aria-label=${r("requestsBack")}
            @click=${()=>this._navigate(this._backPath)}>
            <span aria-hidden="true">${u("chevron-left")}</span>
          </button>
          <h1 class="page-title">${r("requestsPageTitle")}</h1>
          <div class="controls">
            <button type="button" class="auto-toggle" aria-pressed=${this._auto}
              @click=${this._toggleAuto}>
              <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
              <span>${r("requestsAuto")}</span>
            </button>
            <button type="button" class="refresh-button" ?disabled=${this._loading}
              @click=${()=>this._load(!0)}>
              <span aria-hidden="true">${u("rotate-cw")}</span>
              <span>${r("requestsRefresh")}</span>
            </button>
          </div>
        </div>

        <div class="requests-panel">
          <div class="panel-header">
            <span class="requests-count">${i}</span>
            ${this._pageHidden?n`<div class="pause-indicator" role="status">${r("requestsPausedHidden")}</div>`:c}
          </div>
          ${this._requests.length>0?n`
              <div class="request-tools">
                <search class="requests-search">
                  <label class="sr-only" for="requests-search">${r("requestsSearchLabel")}</label>
                  <input id="requests-search" name="q" type="search" class="search-input"
                    .value=${this._query}
                    placeholder=${r("requestsSearchPlaceholder")}
                    autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
                    @input=${this._onSearchInput}>
                </search>
                <fieldset class="request-filters">
                  <legend class="sr-only">${r("requestsFilterLabel")}</legend>
                  ${K.map(a=>n`
                    <label class="filter-chip">
                      <input class="sr-only" type="radio" name="request-filter" value=${a.value}
                        .checked=${this._filter===a.value}
                        @change=${()=>{this._filter=a.value}}>
                      <span>${r(a.label)}</span>
                    </label>
                  `)}
                </fieldset>
              </div>
            `:c}
          ${this._error?n`<div class="requests-error" role="alert">${this._error}</div>`:c}
          ${this._requests.length===0?n`<div class="requests-empty">${r("requestsEmpty")}</div>`:e.length===0?n`<div class="requests-no-matches">${r("requestsNoMatches")}</div>`:n`
                <ol class="request-list" role="list" aria-label=${r("requestsPageTitle")}>
                  ${t.map(a=>this._renderRequest(a))}
                </ol>
                ${e.length>t.length?n`<div class="showing-count">${r("requestsShowing",{shown:t.length,total:e.length})}</div>`:c}
              `}
        </div>
      </app-scaffold>
    `}};l.styles=P`
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
    .requests-no-matches { padding: 32px 12px; text-align: center; color: var(--text-muted); font-size: var(--font-sm); }
    .request-tools {
      min-width: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .requests-search { min-width: 0; }
    .search-input {
      width: 100%; box-sizing: border-box; padding: 7px 10px;
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--surface); color: var(--text);
      font: inherit; font-size: max(1rem, 1em); outline: none;
      transition: border-color var(--transition-fast);
    }
    .search-input:focus { border-color: var(--accent); }
    .search-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .request-filters {
      min-width: 0; margin: 0; padding: 0; border: 0;
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .filter-chip {
      position: relative; min-height: 28px; box-sizing: border-box; padding: 3px 10px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--border-subtle); border-radius: 999px;
      background: var(--surface); color: var(--text-secondary);
      font-size: var(--font-xs); cursor: pointer;
    }
    .filter-chip:has(input:checked) {
      border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 600;
    }
    .filter-chip:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
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
      .filter-chip { min-height: 32px; }
    }
  `;d([$({attribute:"parent-type"})],l.prototype,"parentType",2);d([$({attribute:"parent-id"})],l.prototype,"parentId",2);d([h()],l.prototype,"_requests",2);d([h()],l.prototype,"_entrypoint",2);d([h()],l.prototype,"_error",2);d([h()],l.prototype,"_auto",2);d([h()],l.prototype,"_loading",2);d([h()],l.prototype,"_pageHidden",2);d([h()],l.prototype,"_savingKey",2);d([h()],l.prototype,"_rowErrors",2);d([h()],l.prototype,"_expanded",2);d([h()],l.prototype,"_query",2);d([h()],l.prototype,"_filter",2);l=d([I("entrypoint-requests-page")],l);export{l as EntrypointRequestsPage};
