import{i as u,a as v,j as l,b as a,t as b,h as B,w as L,c as D,g as U}from"./index-DHPLTGL-.js";import{n as d,r as h}from"./state-BabtTR2u.js";import{i as R}from"./app-scaffold-DlOclPUo.js";import{c as E,f as M}from"./format-CZNH9DXL.js";class W{constructor(t){this.baseUrl=t.replace(/\/$/,"")}async liveness(){try{return(await fetch(`${this.baseUrl}/liveness`)).ok}catch{return!1}}async query(t){const r=new URLSearchParams;r.set("client_id",t.client_id),t.type&&r.set("type",t.type),t.service&&r.set("service",t.service),t.sid&&r.set("sid",t.sid),t.start!==void 0&&r.set("start",String(t.start)),t.end!==void 0&&r.set("end",String(t.end)),t.before&&r.set("before",t.before),t.after&&r.set("after",t.after),t.limit!==void 0&&r.set("limit",String(t.limit));const i=await fetch(`${this.baseUrl}/api/records/query?${r.toString()}`);if(!i.ok)throw new Error(`Inspector query failed: ${i.status}`);return i.json()}connectTail(t){const r=new URLSearchParams;r.set("client_id",t.client_id),t.type&&r.set("type",t.type),t.service&&r.set("service",t.service),t.sid&&r.set("sid",t.sid);const i=this.baseUrl.replace(/^http/,"ws");return new WebSocket(`${i}/api/records/tail?${r.toString()}`)}}function N(e){const t=atob(e),r=new Uint8Array(t.length);for(let i=0;i<t.length;i++)r[i]=t.charCodeAt(i);return r}var H=Object.defineProperty,F=Object.getOwnPropertyDescriptor,j=(e,t,r,i)=>{for(var s=i>1?void 0:i?F(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=(i?n(t,r,s):n(s))||s);return i&&s&&H(t,r,s),s};const A=[{type:"http",labelKey:"inspectorProtocolHttp"},{type:"websocket",labelKey:"inspectorProtocolWs"}];let w=class extends v{constructor(){super(...arguments),this.active="http"}render(){return a`
      <div class="tabs">
        ${A.map(e=>a`
          <button class="tab ${this.active===e.type?"active":""}"
            @click=${()=>this.dispatchEvent(new CustomEvent("protocol-change",{detail:e.type,bubbles:!0,composed:!0}))}>
            ${l(e.labelKey)}
          </button>
        `)}
      </div>
    `}};w.styles=u`
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
  `;j([d()],w.prototype,"active",2);w=j([b("protocol-tabs")],w);var K=Object.defineProperty,J=Object.getOwnPropertyDescriptor,z=(e,t,r,i)=>{for(var s=i>1?void 0:i?J(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=(i?n(t,r,s):n(s))||s);return i&&s&&K(t,r,s),s};let C=class extends v{constructor(){super(...arguments),this.mode="query"}render(){return a`
      <div class="toggle">
        <button class="btn ${this.mode==="query"?"active":""}"
          @click=${()=>this._setMode("query")}>${l("inspectorQuery")}</button>
        <button class="btn ${this.mode==="live"?"active":""}"
          @click=${()=>this._setMode("live")}>${l("inspectorLive")}</button>
      </div>
    `}_setMode(e){this.mode=e,this.dispatchEvent(new CustomEvent("mode-change",{detail:e,bubbles:!0,composed:!0}))}};C.styles=u`
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
  `;z([d()],C.prototype,"mode",2);C=z([b("mode-toggle")],C);var G=Object.defineProperty,Q=Object.getOwnPropertyDescriptor,P=(e,t,r,i)=>{for(var s=i>1?void 0:i?Q(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=(i?n(t,r,s):n(s))||s);return i&&s&&G(t,r,s),s};const V=[{minutes:5,label:"5m"},{minutes:15,label:"15m"},{minutes:60,label:"1h"},{minutes:360,label:"6h"},{minutes:1440,label:"24h"}];let m=class extends v{constructor(){super(...arguments),this.sid="",this.mode="query",this.range="all",this._debounceTimer=null}_fireChange(){this._debounceTimer&&clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(()=>{this.dispatchEvent(new CustomEvent("filter-change",{detail:{sid:this.sid},bubbles:!0,composed:!0}))},400)}disconnectedCallback(){super.disconnectedCallback(),this._debounceTimer&&clearTimeout(this._debounceTimer)}render(){return a`
      <div class="filter-row">
        <input .value=${this.sid} placeholder=${l("inspectorFilterSid")}
          @input=${e=>{this.sid=e.target.value,this._fireChange()}}>
      </div>
      ${this.mode==="query"?a`
        <div class="range-row">
          <span class="range-label">${l("inspectorTime")}</span>
          <div class="pills">
            ${V.map(e=>a`
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
    `}};m.styles=u`
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
  `;P([d()],m.prototype,"sid",2);P([d()],m.prototype,"mode",2);P([d()],m.prototype,"range",2);m=P([b("inspector-filter-bar")],m);var X=Object.defineProperty,Y=Object.getOwnPropertyDescriptor,O=(e,t,r,i)=>{for(var s=i>1?void 0:i?Y(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=(i?n(t,r,s):n(s))||s);return i&&s&&X(t,r,s),s};const $=4096;let x=class extends v{constructor(){super(...arguments),this.body="",this._tab="text"}_decode(){if(!this.body)return new Uint8Array(0);try{return N(this.body)}catch{return new TextEncoder().encode(this.body)}}_renderContent(){const e=this._decode();switch(this._tab){case"hex":return this._renderHexdump(e);case"json":try{const t=new TextDecoder().decode(e);return JSON.stringify(JSON.parse(t),null,2)}catch{return new TextDecoder().decode(e)}default:return new TextDecoder().decode(e)}}_renderHexdump(e){const t=e.length>$?e.slice(0,$):e,r=[];for(let i=0;i<t.length;i+=16){let s="",o="";for(let n=0;n<16;n++){n===8&&(s+=" ");const I=i+n;if(I>=t.length)s+="   ";else{const y=t[I];s+=y.toString(16).padStart(2,"0")+" ",o+=y>=32&&y<=126?String.fromCharCode(y):"."}}r.push(`${i.toString(16).padStart(8,"0")}  ${s} |${o}|`)}return e.length>$&&r.push(`... (${(e.length-$).toLocaleString()} more bytes not shown)`),r.join(`
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
    `}};x.styles=u`
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
  `;O([d()],x.prototype,"body",2);O([h()],x.prototype,"_tab",2);x=O([b("body-viewer")],x);var Z=Object.defineProperty,ee=Object.getOwnPropertyDescriptor,q=(e,t,r,i)=>{for(var s=i>1?void 0:i?ee(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=(i?n(t,r,s):n(s))||s);return i&&s&&Z(t,r,s),s};let S=class extends v{constructor(){super(...arguments),this.record=null}render(){const e=this.record;return e?a`
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
            <pre>${E(e.http.request.header)}</pre>
          </div>
          <div class="section">
            <div class="section-title">${l("inspectorDetailHeaders")} — Response</div>
            <pre>${E(e.http.response.header)}</pre>
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
    `:a``}};S.styles=u`
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
  `;q([d({attribute:!1})],S.prototype,"record",2);S=q([b("record-detail")],S);var te=Object.getOwnPropertyDescriptor,se=(e,t,r,i)=>{for(var s=i>1?void 0:i?te(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=n(s)||s);return s};let T=class extends v{render(){return a`<div class="spinner"></div>`}};T.styles=u`
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
  `;T=se([b("wisper-spinner")],T);var re=Object.defineProperty,ie=Object.getOwnPropertyDescriptor,g=(e,t,r,i)=>{for(var s=i>1?void 0:i?ie(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=(i?n(t,r,s):n(s))||s);return i&&s&&re(t,r,s),s};function oe(e){const t=e.toUpperCase();return t==="GET"?"method-green":t==="POST"||t==="PUT"||t==="PATCH"?"method-blue":t==="CONNECT"?"method-yellow":t==="DELETE"?"method-red":"method-default"}function ne(e){return e>=200&&e<300?"var(--green)":e>=400?"var(--red)":"var(--text-muted)"}let f=class extends v{constructor(){super(...arguments),this.records=[],this.protocol="http",this.selectedIndex=-1,this.hasMore=!1,this.loading=!1,this._observer=null}updated(){this._observer&&this._observer.disconnect(),this._observer=new IntersectionObserver(t=>{t[0]?.isIntersecting&&this.hasMore&&this.dispatchEvent(new CustomEvent("load-more",{bubbles:!0,composed:!0}))});const e=this.shadowRoot?.querySelector(".sentinel");e&&this._observer.observe(e)}disconnectedCallback(){super.disconnectedCallback(),this._observer?.disconnect()}_renderRow(e,t){const r=e.http?.host||e.host,i=e.http?.method||"",s=e.http?.uri||"",o=e.http?.statusCode||0,n=e.websocket?.opcode;return a`
      <div class="row ${this.selectedIndex===t?"selected":""}"
        @click=${()=>this.dispatchEvent(new CustomEvent("record-select",{detail:t,bubbles:!0,composed:!0}))}>
        ${i?a`
          <span class="method-badge ${oe(i)}">${i}</span>
        `:n!==void 0?a`
          <span class="method-badge method-default">WS</span>
        `:a`
          <span class="method-badge method-default">—</span>
        `}
        <div class="details">
          <div class="host">${r||e.service}</div>
          <div class="meta">
            <span class="uri">${s||e.dst||e.network}</span>
            <span class="proto">${e.proto||""}</span>
          </div>
        </div>
        ${o?a`
          <span style="color:${ne(o)};font-weight:600;font-size:var(--font-sm)">${o}</span>
        `:""}
        <div class="right">
          <div>↓${M(e.inputBytes)}</div>
          <div>↑${M(e.outputBytes)}</div>
        </div>
      </div>
      ${this.selectedIndex===t?a`<record-detail .record=${e}></record-detail>`:""}
    `}render(){return this.records.length===0?this.loading?a`<div class="loading"><wisper-spinner></wisper-spinner></div>`:a`<div class="empty">${l("inspectorNoRecords")}</div>`:a`
      <div class="list">
        ${this.records.map((e,t)=>this._renderRow(e,t))}
        <div class="sentinel"></div>
      </div>
    `}};f.styles=u`
    :host { display: block; }
    .list { display: flex; flex-direction: column; gap: 4px; }
    .row {
      background: var(--border-subtle); border-radius: var(--radius-sm);
      padding: 10px 12px; cursor: pointer; display: flex; align-items: center;
      gap: 10px; font-size: var(--font-sm); transition: background 0.1s;
    }
    .row:hover { background: #30363d; }
    .row.selected { border-left: 2px solid var(--accent); }
    .method-badge {
      padding: 2px 6px; border-radius: 4px; font-weight: 600;
      font-size: var(--font-sm); font-family: var(--font-mono, 'SF Mono', monospace);
      min-width: 38px; text-align: center;
    }
    .method-green { background: rgba(63,185,80,0.2); color: var(--green); }
    .method-blue { background: rgba(88,166,255,0.2); color: var(--accent); }
    .method-yellow { background: rgba(210,153,29,0.2); color: #d2991d; }
    .method-red { background: rgba(248,81,73,0.2); color: var(--red); }
    .method-default { background: rgba(139,148,158,0.15); color: var(--text-muted); }
    .details { flex: 1; min-width: 0; }
    .host { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { font-size: var(--font-sm); color: var(--text-muted); margin-top: 1px; display: flex; gap: 8px; min-width: 0; }
    .uri { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .proto { flex-shrink: 0; }
    .right { text-align: right; font-size: var(--font-sm); color: var(--text-muted); }
    .sentinel { height: 1px; }
    .empty { text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: var(--font-sm); }
    .loading { display: flex; justify-content: center; padding: 24px; }
  `;g([d({attribute:!1})],f.prototype,"records",2);g([d()],f.prototype,"protocol",2);g([d({type:Number})],f.prototype,"selectedIndex",2);g([d({type:Boolean})],f.prototype,"hasMore",2);g([d({type:Boolean})],f.prototype,"loading",2);f=g([b("record-list")],f);var ae=Object.defineProperty,le=Object.getOwnPropertyDescriptor,k=(e,t,r,i)=>{for(var s=i>1?void 0:i?le(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=(i?n(t,r,s):n(s))||s);return i&&s&&ae(t,r,s),s};let _=class extends v{constructor(){super(...arguments),this.connected=!1,this.recordCount=0,this.stopped=!1}render(){return a`
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
    `}};_.styles=u`
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
  `;k([d({type:Boolean})],_.prototype,"connected",2);k([d({type:Number})],_.prototype,"recordCount",2);k([d({type:Boolean})],_.prototype,"stopped",2);_=k([b("live-indicator")],_);var ce=Object.defineProperty,de=Object.getOwnPropertyDescriptor,p=(e,t,r,i)=>{for(var s=i>1?void 0:i?de(t,r):t,o=e.length-1,n;o>=0;o--)(n=e[o])&&(s=(i?n(t,r,s):n(s))||s);return i&&s&&ce(t,r,s),s};let c=class extends v{constructor(){super(...arguments),this.parentKind="tunnel",this.parentType="",this.parentId="",this._mode="query",this._protocol="http",this._records=[],this._selectedIndex=-1,this._sid="",this._range="all",this._cursor=null,this._hasMore=!0,this._loading=!1,this._liveConnected=!1,this._liveStopped=!1,this._error="",this._client=null,this._clientUrl="",this._unsub=null,this._ws=null,this._reconnectDelay=1e3,this._reconnectTimer=null}connectedCallback(){super.connectedCallback(),this._initClient(),this._fetchRecords(),this._unsub=B(()=>this._onSettings())}disconnectedCallback(){super.disconnectedCallback(),this._closeWs(),this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._unsub?.(),this._unsub=null}_initClient(){const e=L().inspector_url||"";return e&&e!==this._clientUrl?(this._client=new W(e),this._clientUrl=e,!0):!1}_onSettings(){const e=!this._client;this._initClient()&&e&&(this._mode==="query"?(this._hasMore=!0,this._cursor=null,this._fetchRecords()):this._openWs())}_getClientId(){return this.parentKind==="tunnel"?this.parentId:D().find(r=>r.id===this.parentId)?.options?.tunnel_id||this.parentId}_getParentName(){return this.parentKind==="tunnel"?U().find(r=>r.id===this.parentId)?.name||this.parentId:D().find(t=>t.id===this.parentId)?.name||this.parentId}async _fetchRecords(e){if(!(!this._client||this._loading)){this._loading=!0,this._error="";try{const t=await this._client.query({client_id:this._getClientId(),type:this._protocol,sid:this._sid||void 0,start:this._range!=="all"?Math.floor(Date.now()/1e3)-this._range*60:void 0,before:e,limit:50});if(t.code===0&&t.data){const r=t.data.list||[];e?this._records=[...this._records,...r]:this._records=r,this._cursor=t.data.before||null,this._hasMore=r.length>=50}else this._error=t.msg||t.error||`query failed (code ${t.code})`}catch(t){this._error=t instanceof Error?t.message:String(t),console.error("[inspector] query failed:",t)}this._loading=!1}}_onLoadMore(){this._mode==="query"&&this._hasMore&&this._cursor&&this._fetchRecords(this._cursor)}_openWs(){if(this._client){this._closeWs(),this._liveStopped=!1,this._reconnectDelay=1e3;try{this._ws=this._client.connectTail({client_id:this._getClientId(),type:this._protocol,sid:this._sid||void 0}),this._ws.onopen=()=>{this._liveConnected=!0},this._ws.onmessage=e=>{try{const t=JSON.parse(e.data);this._records=[t,...this._records].slice(0,200)}catch{}},this._ws.onclose=()=>{this._liveConnected=!1,this._liveStopped||this._scheduleReconnect()},this._ws.onerror=()=>{this._ws?.close()}}catch{}}}_scheduleReconnect(){this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._reconnectTimer=setTimeout(()=>{this._openWs(),this._reconnectDelay=Math.min(this._reconnectDelay*2,3e4)},this._reconnectDelay)}_closeWs(){this._ws&&(this._ws.onclose=null,this._ws.onmessage=null,this._ws.close(),this._ws=null),this._liveConnected=!1}_onModeChange(e){const t=e.detail;this._mode=t,this._selectedIndex=-1,t==="live"?(this._records=[],this._openWs()):(this._closeWs(),this._records=[],this._fetchRecords())}_onProtocolChange(e){this._protocol=e.detail,this._selectedIndex=-1,this._mode==="live"?(this._records=[],this._openWs()):(this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords())}_onFilterChange(e){const{sid:t}=e.detail;this._sid=t,this._selectedIndex=-1,this._mode==="live"?(this._records=[],this._openWs()):(this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords())}_onRangeChange(e){this._range=e.detail,this._selectedIndex=-1,this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords()}_onRecordSelect(e){const t=e.detail;this._selectedIndex=this._selectedIndex===t?-1:t}_onLiveStop(){this._liveStopped=!0,this._closeWs(),this._reconnectTimer&&clearTimeout(this._reconnectTimer)}_onLiveReconnect(){this._liveStopped=!1,this._openWs()}_onLiveClear(){this._records=[],this._selectedIndex=-1}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const e=this._getParentName(),t=this.parentKind==="tunnel"?`/tunnel/${this.parentType}/${this.parentId}`:`/entrypoint/${this.parentType}/${this.parentId}`,r=this._getClientId().slice(0,8);return this._client?a`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(t)}>
            ${R("chevron-left")}
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
              ${R("chevron-left")}
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
      `}};c.styles=u`
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
  `;p([d()],c.prototype,"parentKind",2);p([d()],c.prototype,"parentType",2);p([d()],c.prototype,"parentId",2);p([h()],c.prototype,"_mode",2);p([h()],c.prototype,"_protocol",2);p([h()],c.prototype,"_records",2);p([h()],c.prototype,"_selectedIndex",2);p([h()],c.prototype,"_sid",2);p([h()],c.prototype,"_range",2);p([h()],c.prototype,"_cursor",2);p([h()],c.prototype,"_hasMore",2);p([h()],c.prototype,"_loading",2);p([h()],c.prototype,"_liveConnected",2);p([h()],c.prototype,"_liveStopped",2);p([h()],c.prototype,"_error",2);c=p([b("inspector-page")],c);export{c as InspectorPage};
