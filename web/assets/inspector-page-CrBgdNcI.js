import{i as b,a as f,j as l,b as a,t as m,h as N,w as U,c as M,g as W}from"./index-DHFyIU0B.js";import{n as d,r as h}from"./state-DJflkmra.js";import{i as j}from"./app-scaffold-DZA-22_E.js";import{c as z,d as F,f as D,e as H}from"./format-CsvuTgp2.js";class A{constructor(t){this.baseUrl=t.replace(/\/$/,"")}async liveness(){try{return(await fetch(`${this.baseUrl}/liveness`)).ok}catch{return!1}}async query(t){const r=new URLSearchParams;r.set("client_id",t.client_id),t.type&&r.set("type",t.type),t.service&&r.set("service",t.service),t.sid&&r.set("sid",t.sid),t.start!==void 0&&r.set("start",String(t.start)),t.end!==void 0&&r.set("end",String(t.end)),t.before&&r.set("before",t.before),t.after&&r.set("after",t.after),t.limit!==void 0&&r.set("limit",String(t.limit));const o=await fetch(`${this.baseUrl}/api/records/query?${r.toString()}`);if(!o.ok)throw new Error(`Inspector query failed: ${o.status}`);return o.json()}connectTail(t){const r=new URLSearchParams;r.set("client_id",t.client_id),t.type&&r.set("type",t.type),t.service&&r.set("service",t.service),t.sid&&r.set("sid",t.sid);const o=this.baseUrl.replace(/^http/,"ws");return new WebSocket(`${o}/api/records/tail?${r.toString()}`)}}function K(e){const t=atob(e),r=new Uint8Array(t.length);for(let o=0;o<t.length;o++)r[o]=t.charCodeAt(o);return r}var G=Object.defineProperty,J=Object.getOwnPropertyDescriptor,q=(e,t,r,o)=>{for(var s=o>1?void 0:o?J(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=(o?n(t,r,s):n(s))||s);return o&&s&&G(t,r,s),s};const X=[{type:"http",labelKey:"inspectorProtocolHttp"},{type:"websocket",labelKey:"inspectorProtocolWs"}];let P=class extends f{constructor(){super(...arguments),this.active="http"}render(){return a`
      <div class="tabs">
        ${X.map(e=>a`
          <button class="tab ${this.active===e.type?"active":""}"
            @click=${()=>this.dispatchEvent(new CustomEvent("protocol-change",{detail:e.type,bubbles:!0,composed:!0}))}>
            ${l(e.labelKey)}
          </button>
        `)}
      </div>
    `}};P.styles=b`
    :host { display: block; }
    .tabs {
      display: flex; gap: 2px;
      background: var(--bg);
      border-radius: var(--radius-md);
      padding: 3px;
    }
    .tab {
      flex: 1; text-align: center; padding: 6px 4px;
      font-size: var(--font-sm); font-weight: 500;
      color: var(--text-muted);
      border-radius: 6px; cursor: pointer; border: none; background: none;
      font-family: inherit; transition: all 0.15s;
    }
    .tab.active { background: var(--accent); color: var(--accent-fg, #fff); }
    .tab:hover:not(.active) { color: var(--text); }
  `;q([d()],P.prototype,"active",2);P=q([m("protocol-tabs")],P);var Q=Object.defineProperty,V=Object.getOwnPropertyDescriptor,B=(e,t,r,o)=>{for(var s=o>1?void 0:o?V(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=(o?n(t,r,s):n(s))||s);return o&&s&&Q(t,r,s),s};let S=class extends f{constructor(){super(...arguments),this.mode="query"}render(){return a`
      <div class="toggle">
        <button class="btn ${this.mode==="query"?"active":""}"
          @click=${()=>this._setMode("query")}>${l("inspectorQuery")}</button>
        <button class="btn ${this.mode==="live"?"active":""}"
          @click=${()=>this._setMode("live")}>${l("inspectorLive")}</button>
      </div>
    `}_setMode(e){this.mode=e,this.dispatchEvent(new CustomEvent("mode-change",{detail:e,bubbles:!0,composed:!0}))}};S.styles=b`
    :host { display: block; }
    .toggle {
      display: flex; background: var(--bg);
      border-radius: var(--radius-md); padding: 3px;
    }
    .btn {
      flex: 1; text-align: center; padding: 6px;
      font-size: var(--font-sm); cursor: pointer; border-radius: 6px;
      border: none; background: none; font-family: inherit;
      color: var(--text-muted); transition: all 0.15s;
    }
    .btn.active { background: var(--border-subtle); color: var(--text); font-weight: 500; }
  `;B([d()],S.prototype,"mode",2);S=B([m("mode-toggle")],S);var Y=Object.defineProperty,Z=Object.getOwnPropertyDescriptor,O=(e,t,r,o)=>{for(var s=o>1?void 0:o?Z(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=(o?n(t,r,s):n(s))||s);return o&&s&&Y(t,r,s),s};const ee=[{minutes:5,label:"5m"},{minutes:15,label:"15m"},{minutes:60,label:"1h"},{minutes:360,label:"6h"},{minutes:1440,label:"24h"}];let x=class extends f{constructor(){super(...arguments),this.sid="",this.mode="query",this.range="all",this._debounceTimer=null}_fireChange(){this._debounceTimer&&clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(()=>{this.dispatchEvent(new CustomEvent("filter-change",{detail:{sid:this.sid},bubbles:!0,composed:!0}))},400)}disconnectedCallback(){super.disconnectedCallback(),this._debounceTimer&&clearTimeout(this._debounceTimer)}render(){return a`
      <div class="filter-row">
        <input .value=${this.sid} placeholder=${l("inspectorFilterSid")}
          @input=${e=>{this.sid=e.target.value,this._fireChange()}}>
      </div>
      ${this.mode==="query"?a`
        <div class="range-row">
          <span class="range-label">${l("inspectorTime")}</span>
          <div class="pills">
            ${ee.map(e=>a`
              <button class="pill ${this.range===e.minutes?"active":""}"
                @click=${()=>this.dispatchEvent(new CustomEvent("range-change",{detail:e.minutes,bubbles:!0,composed:!0}))}>
                ${e.label}
              </button>
            `)}
            <button class="pill ${this.range==="all"?"active":""}"
              @click=${()=>this.dispatchEvent(new CustomEvent("range-change",{detail:"all",bubbles:!0,composed:!0}))}>
              ${l("inspectorRangeAll")}
            </button>
          </div>
        </div>
      `:""}
    `}};x.styles=b`
    :host { display: block; }
    .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
    input {
      flex: 1; min-width: 80px; padding: 8px 10px;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: var(--radius-sm); color: var(--text);
      font-size: var(--font-sm); font-family: var(--font-mono, 'SF Mono', monospace);
      outline: none; box-sizing: border-box;
    }
    input:focus { border-color: var(--accent); }
    .range-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .range-label { font-size: var(--font-sm); color: var(--text-muted); flex-shrink: 0; }
    .pills { display: flex; gap: 2px; background: var(--bg); border-radius: var(--radius-md); padding: 3px; }
    .pill {
      padding: 4px 10px; font-size: var(--font-sm); font-weight: 500;
      color: var(--text-muted); border-radius: 6px; cursor: pointer;
      border: none; background: none; font-family: inherit; transition: all 0.15s;
    }
    .pill.active { background: var(--accent); color: var(--accent-fg, #fff); }
    .pill:hover:not(.active) { color: var(--text); }
  `;O([d()],x.prototype,"sid",2);O([d()],x.prototype,"mode",2);O([d()],x.prototype,"range",2);x=O([m("inspector-filter-bar")],x);var te=Object.defineProperty,se=Object.getOwnPropertyDescriptor,E=(e,t,r,o)=>{for(var s=o>1?void 0:o?se(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=(o?n(t,r,s):n(s))||s);return o&&s&&te(t,r,s),s};const k=4096;let C=class extends f{constructor(){super(...arguments),this.body="",this._tab="text"}_decode(){if(!this.body)return new Uint8Array(0);try{return K(this.body)}catch{return new TextEncoder().encode(this.body)}}_renderContent(){const e=this._decode();switch(this._tab){case"hex":return this._renderHexdump(e);case"json":try{const t=new TextDecoder().decode(e);return JSON.stringify(JSON.parse(t),null,2)}catch{return new TextDecoder().decode(e)}default:return new TextDecoder().decode(e)}}_renderHexdump(e){const t=e.length>k?e.slice(0,k):e,r=[];for(let o=0;o<t.length;o+=16){let s="",i="";for(let n=0;n<16;n++){n===8&&(s+=" ");const w=o+n;if(w>=t.length)s+="   ";else{const u=t[w];s+=u.toString(16).padStart(2,"0")+" ",i+=u>=32&&u<=126?String.fromCharCode(u):"."}}r.push(`${o.toString(16).padStart(8,"0")}  ${s} |${i}|`)}return e.length>k&&r.push(`... (${(e.length-k).toLocaleString()} more bytes not shown)`),r.join(`
`)}_copyContent(){navigator.clipboard.writeText(this._renderContent())}render(){return a`
      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${this._tab==="text"?"active":""}" @click=${()=>{this._tab="text"}}>${l("inspectorTabText")}</button>
          <button class="tab ${this._tab==="hex"?"active":""}" @click=${()=>{this._tab="hex"}}>${l("inspectorTabHex")}</button>
          <button class="tab ${this._tab==="json"?"active":""}" @click=${()=>{this._tab="json"}}>${l("inspectorTabJson")}</button>
        </div>
        <button class="copy-btn" @click=${()=>this._copyContent()}>${l("inspectorBtnCopy")}</button>
      </div>
      <pre class="${this._tab==="hex"?"hex":""}">${this._renderContent()}</pre>
    `}};C.styles=b`
    :host { display: block; }
    .tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .tab {
      font-size: var(--font-sm); padding: 3px 8px; border-radius: 4px;
      cursor: pointer; color: var(--text-muted);
      background: var(--border-subtle); border: none; font-family: inherit;
    }
    .tab.active { color: var(--text); background: var(--accent); }
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-sm); background: var(--bg);
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 300px;
      overflow-y: auto; margin: 0;
    }
    /* Hex columns are fixed-width; never wrap (scroll horizontally instead). */
    pre.hex { white-space: pre; word-break: normal; }
    .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .copy-btn {
      font-size: var(--font-sm); padding: 2px 8px; cursor: pointer;
      background: var(--border-subtle); border: none; border-radius: 4px;
      color: var(--text-muted); font-family: inherit; margin-left: auto;
    }
  `;E([d()],C.prototype,"body",2);E([h()],C.prototype,"_tab",2);C=E([m("body-viewer")],C);var re=Object.defineProperty,oe=Object.getOwnPropertyDescriptor,L=(e,t,r,o)=>{for(var s=o>1?void 0:o?oe(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=(o?n(t,r,s):n(s))||s);return o&&s&&re(t,r,s),s};let T=class extends f{constructor(){super(...arguments),this.record=null}render(){const e=this.record;return e?a`
      <div class="panel">
        <div class="section">
          <div class="section-title">Overview</div>
          <div class="meta-grid">
            <div class="meta-item"><span class="meta-label">Host</span><span class="meta-value">${e.host}</span></div>
            <div class="meta-item"><span class="meta-label">Remote</span><span class="meta-value">${e.remote}</span></div>
            <div class="meta-item"><span class="meta-label">Local</span><span class="meta-value">${e.local}</span></div>
            <div class="meta-item"><span class="meta-label">Client IP</span><span class="meta-value">${e.clientIP}</span></div>
            <div class="meta-item"><span class="meta-label">Service</span><span class="meta-value">${e.service}</span></div>
            <div class="meta-item"><span class="meta-label">Proto</span><span class="meta-value">${e.http?.proto||e.proto||"—"}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↓</span><span class="meta-value">${e.inputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↑</span><span class="meta-value">${e.outputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Duration</span><span class="meta-value">${(e.duration/1e6).toFixed(1)}ms</span></div>
            <div class="meta-item"><span class="meta-label">Error</span><span class="meta-value">${e.err||"—"}</span></div>
          </div>
        </div>

        ${e.http?a`
          <div class="section">
            <div class="section-title">Request</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">Method</span><span class="meta-value">${e.http.method||"—"}</span></div>
              <div class="meta-item"><span class="meta-label">Host</span><span class="meta-value">${e.http.host||"—"}</span></div>
              <div class="meta-item uri-item"><span class="meta-label">URI</span><span class="meta-value uri-text">${e.http.uri||"—"}</span></div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">${l("inspectorDetailHeaders")} — Request</div>
            <pre>${z(e.http.request.header)}</pre>
          </div>
          <div class="section">
            <div class="section-title">${l("inspectorDetailHeaders")} — Response</div>
            <pre>${z(e.http.response.header)}</pre>
          </div>
          ${e.http.request.body?a`
            <div class="section">
              <div class="section-title">${l("inspectorDetailBody")} — Request</div>
              <body-viewer .body=${e.http.request.body}></body-viewer>
            </div>
          `:""}
          ${e.http.response.body?a`
            <div class="section">
              <div class="section-title">${l("inspectorDetailBody")} — Response</div>
              <body-viewer .body=${e.http.response.body}></body-viewer>
            </div>
          `:""}
        `:""}

        ${e.websocket?a`
          <div class="section">
            <div class="section-title">WebSocket</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">From</span><span class="meta-value">${e.websocket.from}</span></div>
              <div class="meta-item"><span class="meta-label">OpCode</span><span class="meta-value">${e.websocket.opcode}</span></div>
              <div class="meta-item"><span class="meta-label">Length</span><span class="meta-value">${e.websocket.length}</span></div>
            </div>
            ${e.websocket.payload?a`
              <div class="section-title" style="margin-top:8px;">Payload</div>
              <body-viewer .body=${e.websocket.payload}></body-viewer>
            `:""}
          </div>
        `:""}
      </div>
    `:a``}};T.styles=b`
    :host { display: block; }
    .panel {
      background: var(--bg); border-radius: var(--radius-md);
      padding: 12px; margin-top: 8px;
    }
    .section { margin-bottom: 10px; }
    .section-title {
      font-size: var(--font-sm); text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--text-muted); margin-bottom: 4px; font-weight: 600;
    }
    .meta-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px;
      font-size: var(--font-sm);
    }
    .meta-item { display: flex; justify-content: space-between; padding: 2px 0; }
    .meta-label { color: var(--text-muted); }
    .meta-value { font-family: var(--font-mono, 'SF Mono', monospace); }
    .uri-item { grid-column: 1 / -1; justify-content: flex-start; gap: 8px; }
    .uri-item .meta-label { flex-shrink: 0; }
    .uri-text { word-break: break-all; min-width: 0; flex: 1; }
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-sm); background: #0d1117;
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 200px;
      overflow-y: auto; margin: 0;
    }
  `;L([d({attribute:!1})],T.prototype,"record",2);T=L([m("record-detail")],T);var ie=Object.getOwnPropertyDescriptor,ne=(e,t,r,o)=>{for(var s=o>1?void 0:o?ie(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=n(s)||s);return s};let R=class extends f{render(){return a`<div class="spinner"></div>`}};R.styles=b`
    :host {
      display: inline-block;
      width: 32px;
      height: 32px;
    }

    .spinner {
      width: 100%;
      height: 100%;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;R=ne([m("wisper-spinner")],R);var ae=Object.defineProperty,le=Object.getOwnPropertyDescriptor,$=(e,t,r,o)=>{for(var s=o>1?void 0:o?le(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=(o?n(t,r,s):n(s))||s);return o&&s&&ae(t,r,s),s};function ce(e){const t=e.toUpperCase();return t==="GET"?"method-green":t==="POST"||t==="PUT"||t==="PATCH"?"method-blue":t==="CONNECT"?"method-yellow":t==="DELETE"?"method-red":"method-default"}function de(e){return e>0&&e<300?"status-green":e>=300&&e<400?"status-yellow":e>=400?"status-red":"status-muted"}function pe(e){if(e==null)return null;switch(e){case 1:return{label:"TEXT",cls:"op-text"};case 2:return{label:"BINARY",cls:"op-binary"};case 8:return{label:"CLOSE",cls:"op-close"};case 9:return{label:"PING",cls:"op-default"};case 10:return{label:"PONG",cls:"op-default"};default:return{label:`#${e}`,cls:"op-default"}}}let _=class extends f{constructor(){super(...arguments),this.records=[],this.protocol="http",this.selectedIndex=-1,this.hasMore=!1,this.loading=!1,this._observer=null}updated(){this._observer&&this._observer.disconnect(),this._observer=new IntersectionObserver(t=>{t[0]?.isIntersecting&&this.hasMore&&this.dispatchEvent(new CustomEvent("load-more",{bubbles:!0,composed:!0}))});const e=this.shadowRoot?.querySelector(".sentinel");e&&this._observer.observe(e)}disconnectedCallback(){super.disconnectedCallback(),this._observer?.disconnect()}_renderRow(e,t){const r=e.http?.host||e.host||e.service,o=e.http?.uri||"",s=e.time?F(e.time):"",i=e.http?.proto||e.proto||"",n=a`<span class="muted">↓${D(e.inputBytes)} ↑${D(e.outputBytes)}</span>`,w=H(e.duration);let u;if(e.http){const v=e.http.method||"",g=e.http.statusCode||0;u=a`
        <div class="line">
          <span class="status ${de(g)}">${g||"—"}</span>
          ${v?a`<span class="method-badge ${ce(v)}">${v}</span>`:""}
          <span class="host">${r}</span>
          <span class="muted">${w}</span>
        </div>
        ${o?a`<div class="uri">${o}</div>`:""}
        <div class="line">
          ${n}
          ${i?a`<span class="muted">${i}</span>`:""}
          ${s?a`<span class="time">${s}</span>`:""}
        </div>
      `}else if(e.websocket){const v=e.websocket.from,g=pe(e.websocket.opcode);u=a`
        <div class="line">
          <span class="dir ${v==="client"?"dir-in":"dir-out"}">${v==="client"?"→":"←"}</span>
          <span class="host">${r}</span>
          ${g?a`<span class="opcode ${g.cls}">${g.label}</span>`:""}
        </div>
        ${o?a`<div class="uri">${o}</div>`:""}
        <div class="line">
          <span class="muted">${D(e.websocket.length??0)}</span>
          ${s?a`<span class="time">${s}</span>`:""}
        </div>
      `}else{const v=o||e.dst||e.network;u=a`
        <div class="line">
          <span class="host">${r}</span>
          <span class="muted">${w}</span>
        </div>
        ${v?a`<div class="uri">${v}</div>`:""}
        <div class="line">
          ${n}
          ${i?a`<span class="muted">${i}</span>`:""}
          ${s?a`<span class="time">${s}</span>`:""}
        </div>
      `}return a`
      <div class="row ${this.selectedIndex===t?"selected":""}"
        @click=${()=>this.dispatchEvent(new CustomEvent("record-select",{detail:t,bubbles:!0,composed:!0}))}>
        ${u}
      </div>
      ${this.selectedIndex===t?a`<record-detail .record=${e}></record-detail>`:""}
    `}render(){return this.records.length===0?this.loading?a`<div class="loading"><wisper-spinner></wisper-spinner></div>`:a`<div class="empty">${l("inspectorNoRecords")}</div>`:a`
      <div class="list">
        ${this.records.map((e,t)=>this._renderRow(e,t))}
        <div class="sentinel"></div>
      </div>
    `}};_.styles=b`
    :host { display: block; }
    .list { display: flex; flex-direction: column; gap: 4px; }
    .row {
      background: var(--border-subtle); border-radius: var(--radius-sm);
      padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column;
      gap: 2px; transition: background 0.1s;
    }
    .row:hover { background: #30363d; }
    .row.selected { border-left: 2px solid var(--accent); }
    .line { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--font-sm); }
    .host {
      font-weight: 500; flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .uri {
      font-family: var(--font-mono, 'SF Mono', monospace); color: var(--text-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
    }
    .muted { color: var(--text-muted); flex-shrink: 0; }
    .time {
      margin-left: auto; font-family: var(--font-mono, 'SF Mono', monospace);
      color: var(--text-muted); white-space: nowrap; flex-shrink: 0;
    }
    .status { font-weight: 700; flex-shrink: 0; min-width: 28px; }
    .status-green { color: var(--green); }
    .status-yellow { color: #d2991d; }
    .status-red { color: var(--red); }
    .status-muted { color: var(--text-muted); }
    .method-badge {
      padding: 1px 6px; border-radius: 4px; font-weight: 600;
      font-family: var(--font-mono, 'SF Mono', monospace); flex-shrink: 0;
    }
    .method-green { background: rgba(63,185,80,0.2); color: var(--green); }
    .method-blue { background: rgba(88,166,255,0.2); color: var(--accent); }
    .method-yellow { background: rgba(210,153,29,0.2); color: #d2991d; }
    .method-red { background: rgba(248,81,73,0.2); color: var(--red); }
    .method-default { background: rgba(139,148,158,0.15); color: var(--text-muted); }
    .dir { font-weight: 700; flex-shrink: 0; }
    .dir-in { color: var(--green); }
    .dir-out { color: #d2991d; }
    .opcode { padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
    .op-text { background: rgba(63,185,80,0.2); color: var(--green); }
    .op-binary { background: rgba(188,140,255,0.2); color: #bc8cff; }
    .op-close { background: rgba(210,153,29,0.2); color: #d2991d; }
    .op-default { background: rgba(139,148,158,0.15); color: var(--text-muted); }
    .sentinel { height: 1px; }
    .empty { text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: var(--font-sm); }
    .loading { display: flex; justify-content: center; padding: 24px; }
  `;$([d({attribute:!1})],_.prototype,"records",2);$([d()],_.prototype,"protocol",2);$([d({type:Number})],_.prototype,"selectedIndex",2);$([d({type:Boolean})],_.prototype,"hasMore",2);$([d({type:Boolean})],_.prototype,"loading",2);_=$([m("record-list")],_);var he=Object.defineProperty,ue=Object.getOwnPropertyDescriptor,I=(e,t,r,o)=>{for(var s=o>1?void 0:o?ue(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=(o?n(t,r,s):n(s))||s);return o&&s&&he(t,r,s),s};let y=class extends f{constructor(){super(...arguments),this.connected=!1,this.recordCount=0,this.stopped=!1}render(){return a`
      <div class="bar">
        <span class="status">
          <span class="dot ${this.connected?"connected":"disconnected"}"></span>
          ${this.connected?l("inspectorStatusConnected"):l("inspectorStatusDisconnected")}
        </span>
        <span style="color:var(--text-muted)">${l("inspectorRecordsCount",{count:String(this.recordCount)})}</span>
        <span class="actions">
          ${this.stopped?a`<button @click=${()=>this.dispatchEvent(new CustomEvent("live-reconnect",{bubbles:!0,composed:!0}))}>${l("inspectorBtnReconnect")}</button>`:a`<button @click=${()=>this.dispatchEvent(new CustomEvent("live-stop",{bubbles:!0,composed:!0}))}>${l("inspectorBtnStop")}</button>`}
          <button @click=${()=>this.dispatchEvent(new CustomEvent("live-clear",{bubbles:!0,composed:!0}))}>${l("inspectorBtnClear")}</button>
        </span>
      </div>
    `}};y.styles=b`
    :host { display: block; }
    .bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px; background: var(--border-subtle);
      border-radius: var(--radius-sm); font-size: var(--font-sm); gap: 8px;
    }
    .status { display: flex; align-items: center; gap: 6px; }
    .dot {
      width: 8px; height: 8px; border-radius: 50%; display: inline-block;
    }
    .dot.connected { background: var(--green); animation: pulse 1.5s ease-in-out infinite; }
    .dot.disconnected { background: var(--red); }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .actions { display: flex; gap: 6px; }
    .actions button {
      font-size: var(--font-sm); padding: 2px 10px; cursor: pointer;
      background: none; border: 1px solid var(--border);
      border-radius: var(--radius-pill); color: var(--text-muted);
      font-family: inherit;
    }
    .actions button:hover { color: var(--text); border-color: var(--text-muted); }
  `;I([d({type:Boolean})],y.prototype,"connected",2);I([d({type:Number})],y.prototype,"recordCount",2);I([d({type:Boolean})],y.prototype,"stopped",2);y=I([m("live-indicator")],y);var ve=Object.defineProperty,be=Object.getOwnPropertyDescriptor,p=(e,t,r,o)=>{for(var s=o>1?void 0:o?be(t,r):t,i=e.length-1,n;i>=0;i--)(n=e[i])&&(s=(o?n(t,r,s):n(s))||s);return o&&s&&ve(t,r,s),s};let c=class extends f{constructor(){super(...arguments),this.parentKind="tunnel",this.parentType="",this.parentId="",this._mode="query",this._protocol="http",this._records=[],this._selectedIndex=-1,this._sid="",this._range="all",this._cursor=null,this._hasMore=!0,this._loading=!1,this._liveConnected=!1,this._liveStopped=!1,this._error="",this._client=null,this._clientUrl="",this._unsub=null,this._ws=null,this._reconnectDelay=1e3,this._reconnectTimer=null}connectedCallback(){super.connectedCallback(),this._initClient(),this._fetchRecords(),this._unsub=N(()=>this._onSettings())}disconnectedCallback(){super.disconnectedCallback(),this._closeWs(),this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._unsub?.(),this._unsub=null}_initClient(){const e=U().inspector_url||"";return e&&e!==this._clientUrl?(this._client=new A(e),this._clientUrl=e,!0):!1}_onSettings(){const e=!this._client;this._initClient()&&e&&(this._mode==="query"?(this._hasMore=!0,this._cursor=null,this._fetchRecords()):this._openWs())}_getClientId(){return this.parentKind==="tunnel"?this.parentId:M().find(r=>r.id===this.parentId)?.options?.tunnel_id||this.parentId}_getParentName(){return this.parentKind==="tunnel"?W().find(r=>r.id===this.parentId)?.name||this.parentId:M().find(t=>t.id===this.parentId)?.name||this.parentId}async _fetchRecords(e){if(!(!this._client||this._loading)){this._loading=!0,this._error="";try{const t=await this._client.query({client_id:this._getClientId(),type:this._protocol,sid:this._sid||void 0,start:this._range!=="all"?Math.floor(Date.now()/1e3)-this._range*60:void 0,before:e,limit:50});if(t.code===0&&t.data){const r=t.data.list||[];e?this._records=[...this._records,...r]:this._records=r,this._cursor=t.data.before||null,this._hasMore=r.length>=50}else this._error=t.msg||t.error||`query failed (code ${t.code})`}catch(t){this._error=t instanceof Error?t.message:String(t),console.error("[inspector] query failed:",t)}this._loading=!1}}_onLoadMore(){this._mode==="query"&&this._hasMore&&this._cursor&&this._fetchRecords(this._cursor)}_openWs(){if(this._client){this._closeWs(),this._liveStopped=!1,this._reconnectDelay=1e3;try{this._ws=this._client.connectTail({client_id:this._getClientId(),type:this._protocol,sid:this._sid||void 0}),this._ws.onopen=()=>{this._liveConnected=!0},this._ws.onmessage=e=>{try{const t=JSON.parse(e.data);this._records=[t,...this._records].slice(0,200)}catch{}},this._ws.onclose=()=>{this._liveConnected=!1,this._liveStopped||this._scheduleReconnect()},this._ws.onerror=()=>{this._ws?.close()}}catch{}}}_scheduleReconnect(){this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._reconnectTimer=setTimeout(()=>{this._openWs(),this._reconnectDelay=Math.min(this._reconnectDelay*2,3e4)},this._reconnectDelay)}_closeWs(){this._ws&&(this._ws.onclose=null,this._ws.onmessage=null,this._ws.close(),this._ws=null),this._liveConnected=!1}_onModeChange(e){const t=e.detail;this._mode=t,this._selectedIndex=-1,t==="live"?(this._records=[],this._openWs()):(this._closeWs(),this._records=[],this._fetchRecords())}_onProtocolChange(e){this._protocol=e.detail,this._selectedIndex=-1,this._mode==="live"?(this._records=[],this._openWs()):(this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords())}_onFilterChange(e){const{sid:t}=e.detail;this._sid=t,this._selectedIndex=-1,this._mode==="live"?(this._records=[],this._openWs()):(this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords())}_onRangeChange(e){this._range=e.detail,this._selectedIndex=-1,this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords()}_onRecordSelect(e){const t=e.detail;this._selectedIndex=this._selectedIndex===t?-1:t}_onLiveStop(){this._liveStopped=!0,this._closeWs(),this._reconnectTimer&&clearTimeout(this._reconnectTimer)}_onLiveReconnect(){this._liveStopped=!1,this._openWs()}_onLiveClear(){this._records=[],this._selectedIndex=-1}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const e=this._getParentName(),t=this.parentKind==="tunnel"?`/tunnel/${this.parentType}/${this.parentId}`:`/entrypoint/${this.parentType}/${this.parentId}`,r=this._getClientId().slice(0,8);return this._client?a`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(t)}>
            ${j("chevron-left")}
          </button>
          <span class="page-title">
            &larr; ${e||this.parentId} &middot; ${l("inspectorTitle")}
          </span>
          <span class="id-chip">${r}</span>
        </div>

        <div style="padding:12px 16px 0;">
          <mode-toggle .mode=${this._mode} @mode-change=${this._onModeChange}></mode-toggle>
        </div>

        <div style="padding:8px 16px 0;">
          <protocol-tabs .active=${this._protocol} @protocol-change=${this._onProtocolChange}></protocol-tabs>
        </div>

        <div style="padding:8px 16px 0;">
          <inspector-filter-bar
            .sid=${this._sid}
            .mode=${this._mode}
            .range=${this._range}
            @filter-change=${this._onFilterChange}
            @range-change=${this._onRangeChange}>
          </inspector-filter-bar>
        </div>

        ${this._mode==="live"?a`
          <div style="padding:8px 16px 0;">
            <live-indicator
              .connected=${this._liveConnected}
              .recordCount=${this._records.length}
              .stopped=${this._liveStopped}
              @live-stop=${this._onLiveStop}
              @live-reconnect=${this._onLiveReconnect}
              @live-clear=${this._onLiveClear}>
            </live-indicator>
          </div>
        `:""}

        <div class="spacer"></div>

        <div style="padding:0 16px;">
          ${this._error?a`<div style="color:var(--red);font-size:var(--font-sm);padding:6px 0;">⚠ ${this._error}</div>`:""}
          <record-list
            .records=${this._records}
            .protocol=${this._protocol}
            .selectedIndex=${this._selectedIndex}
            .loading=${this._mode==="query"&&this._loading}
            .hasMore=${this._mode==="query"&&this._hasMore}
            @record-select=${this._onRecordSelect}
            @load-more=${()=>this._onLoadMore()}>
          </record-list>
        </div>
      </app-scaffold>
    `:a`
        <app-scaffold>
          <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
            <button class="back-btn" @click=${()=>this._navigate(t)}>
              ${j("chevron-left")}
            </button>
            <span class="page-title">${l("inspectorTitle")}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 24px;text-align:center;color:var(--text-muted);gap:12px;">
            <div style="font-size:48px;">🔍</div>
            <div style="font-size:var(--font-md);color:var(--text-secondary);">${l("inspectorNotConfigured")}</div>
            <div style="font-size:var(--font-sm);">${l("inspectorNotConfiguredDesc")}</div>
            <a href="/settings" style="color:var(--accent);font-size:var(--font-sm);text-decoration:none;margin-top:8px;">&rarr; ${l("settingsTitle")}</a>
          </div>
        </app-scaffold>
      `}};c.styles=b`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }
    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }
    .id-chip {
      font-size: var(--font-sm); padding: 2px 8px; border-radius: 10px;
      background: var(--border-subtle); color: var(--text-muted);
      font-family: var(--font-mono, 'SF Mono', monospace);
    }
    .spacer { height: 8px; }
  `;p([d()],c.prototype,"parentKind",2);p([d()],c.prototype,"parentType",2);p([d()],c.prototype,"parentId",2);p([h()],c.prototype,"_mode",2);p([h()],c.prototype,"_protocol",2);p([h()],c.prototype,"_records",2);p([h()],c.prototype,"_selectedIndex",2);p([h()],c.prototype,"_sid",2);p([h()],c.prototype,"_range",2);p([h()],c.prototype,"_cursor",2);p([h()],c.prototype,"_hasMore",2);p([h()],c.prototype,"_loading",2);p([h()],c.prototype,"_liveConnected",2);p([h()],c.prototype,"_liveStopped",2);p([h()],c.prototype,"_error",2);c=p([m("inspector-page")],c);export{c as InspectorPage};
