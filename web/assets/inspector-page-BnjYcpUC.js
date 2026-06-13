import{i as u,a as v,j as c,b as a,t as b,h as q,w as L,c as I,g as W}from"./index-DvQYVtD8.js";import{n as l,r as h}from"./state-C1UvBj5T.js";import{i as D}from"./app-scaffold-CU6KxGiW.js";import{c as E,f as R}from"./format-CZNH9DXL.js";class U{constructor(e){this.baseUrl=e.replace(/\/$/,"")}async liveness(){try{return(await fetch(`${this.baseUrl}/liveness`)).ok}catch{return!1}}async query(e){const r=new URLSearchParams;r.set("client_id",e.client_id),e.type&&r.set("type",e.type),e.service&&r.set("service",e.service),e.sid&&r.set("sid",e.sid),e.start!==void 0&&r.set("start",String(e.start)),e.end!==void 0&&r.set("end",String(e.end)),e.before&&r.set("before",e.before),e.after&&r.set("after",e.after),e.limit!==void 0&&r.set("limit",String(e.limit));const o=await fetch(`${this.baseUrl}/api/records/query?${r.toString()}`);if(!o.ok)throw new Error(`Inspector query failed: ${o.status}`);return o.json()}connectTail(e){const r=new URLSearchParams;r.set("client_id",e.client_id),e.type&&r.set("type",e.type),e.service&&r.set("service",e.service),e.sid&&r.set("sid",e.sid);const o=this.baseUrl.replace(/^http/,"ws");return new WebSocket(`${o}/api/records/tail?${r.toString()}`)}}function N(t){const e=atob(t),r=new Uint8Array(e.length);for(let o=0;o<e.length;o++)r[o]=e.charCodeAt(o);return r}var F=Object.defineProperty,H=Object.getOwnPropertyDescriptor,M=(t,e,r,o)=>{for(var s=o>1?void 0:o?H(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=(o?n(e,r,s):n(s))||s);return o&&s&&F(e,r,s),s};const K=[{type:"http",labelKey:"inspectorProtocolHttp"},{type:"websocket",labelKey:"inspectorProtocolWs"}];let $=class extends v{constructor(){super(...arguments),this.active="http"}render(){return a`
      <div class="tabs">
        ${K.map(t=>a`
          <button class="tab ${this.active===t.type?"active":""}"
            @click=${()=>this.dispatchEvent(new CustomEvent("protocol-change",{detail:t.type,bubbles:!0,composed:!0}))}>
            ${c(t.labelKey)}
          </button>
        `)}
      </div>
    `}};$.styles=u`
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
  `;M([l()],$.prototype,"active",2);$=M([b("protocol-tabs")],$);var A=Object.defineProperty,J=Object.getOwnPropertyDescriptor,j=(t,e,r,o)=>{for(var s=o>1?void 0:o?J(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=(o?n(e,r,s):n(s))||s);return o&&s&&A(e,r,s),s};let w=class extends v{constructor(){super(...arguments),this.mode="query"}render(){return a`
      <div class="toggle">
        <button class="btn ${this.mode==="query"?"active":""}"
          @click=${()=>this._setMode("query")}>${c("inspectorQuery")}</button>
        <button class="btn ${this.mode==="live"?"active":""}"
          @click=${()=>this._setMode("live")}>${c("inspectorLive")}</button>
      </div>
    `}_setMode(t){this.mode=t,this.dispatchEvent(new CustomEvent("mode-change",{detail:t,bubbles:!0,composed:!0}))}};w.styles=u`
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
  `;j([l()],w.prototype,"mode",2);w=j([b("mode-toggle")],w);var G=Object.defineProperty,Q=Object.getOwnPropertyDescriptor,z=(t,e,r,o)=>{for(var s=o>1?void 0:o?Q(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=(o?n(e,r,s):n(s))||s);return o&&s&&G(e,r,s),s};let C=class extends v{constructor(){super(...arguments),this.sid="",this._debounceTimer=null}_fireChange(){this._debounceTimer&&clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(()=>{this.dispatchEvent(new CustomEvent("filter-change",{detail:{sid:this.sid},bubbles:!0,composed:!0}))},400)}disconnectedCallback(){super.disconnectedCallback(),this._debounceTimer&&clearTimeout(this._debounceTimer)}render(){return a`
      <div class="filter-row">
        <input .value=${this.sid} placeholder=${c("inspectorFilterSid")}
          @input=${t=>{this.sid=t.target.value,this._fireChange()}}>
      </div>
    `}};C.styles=u`
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
  `;z([l()],C.prototype,"sid",2);C=z([b("inspector-filter-bar")],C);var V=Object.defineProperty,X=Object.getOwnPropertyDescriptor,O=(t,e,r,o)=>{for(var s=o>1?void 0:o?X(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=(o?n(e,r,s):n(s))||s);return o&&s&&V(e,r,s),s};const x=4096;let g=class extends v{constructor(){super(...arguments),this.body="",this._tab="text"}_decode(){if(!this.body)return new Uint8Array(0);try{return N(this.body)}catch{return new TextEncoder().encode(this.body)}}_renderContent(){const t=this._decode();switch(this._tab){case"hex":return this._renderHexdump(t);case"json":try{const e=new TextDecoder().decode(t);return JSON.stringify(JSON.parse(e),null,2)}catch{return new TextDecoder().decode(t)}default:return new TextDecoder().decode(t)}}_renderHexdump(t){const e=t.length>x?t.slice(0,x):t,r=[];for(let o=0;o<e.length;o+=16){let s="",i="";for(let n=0;n<16;n++){n===8&&(s+=" ");const k=o+n;if(k>=e.length)s+="   ";else{const y=e[k];s+=y.toString(16).padStart(2,"0")+" ",i+=y>=32&&y<=126?String.fromCharCode(y):"."}}r.push(`${o.toString(16).padStart(8,"0")}  ${s} |${i}|`)}return t.length>x&&r.push(`... (${(t.length-x).toLocaleString()} more bytes not shown)`),r.join(`
`)}_copyContent(){navigator.clipboard.writeText(this._renderContent())}render(){return a`
      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${this._tab==="text"?"active":""}" @click=${()=>{this._tab="text"}}>${c("inspectorTabText")}</button>
          <button class="tab ${this._tab==="hex"?"active":""}" @click=${()=>{this._tab="hex"}}>${c("inspectorTabHex")}</button>
          <button class="tab ${this._tab==="json"?"active":""}" @click=${()=>{this._tab="json"}}>${c("inspectorTabJson")}</button>
        </div>
        <button class="copy-btn" @click=${()=>this._copyContent()}>${c("inspectorBtnCopy")}</button>
      </div>
      <pre class="${this._tab==="hex"?"hex":""}">${this._renderContent()}</pre>
    `}};g.styles=u`
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
  `;O([l()],g.prototype,"body",2);O([h()],g.prototype,"_tab",2);g=O([b("body-viewer")],g);var Y=Object.defineProperty,Z=Object.getOwnPropertyDescriptor,B=(t,e,r,o)=>{for(var s=o>1?void 0:o?Z(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=(o?n(e,r,s):n(s))||s);return o&&s&&Y(e,r,s),s};let P=class extends v{constructor(){super(...arguments),this.record=null}render(){const t=this.record;return t?a`
      <div class="panel">
        <div class="section">
          <div class="section-title">Overview</div>
          <div class="meta-grid">
            <div class="meta-item"><span class="meta-label">Host</span><span class="meta-value">${t.host}</span></div>
            <div class="meta-item"><span class="meta-label">Remote</span><span class="meta-value">${t.remote}</span></div>
            <div class="meta-item"><span class="meta-label">Local</span><span class="meta-value">${t.local}</span></div>
            <div class="meta-item"><span class="meta-label">Client IP</span><span class="meta-value">${t.clientIP}</span></div>
            <div class="meta-item"><span class="meta-label">Service</span><span class="meta-value">${t.service}</span></div>
            <div class="meta-item"><span class="meta-label">Proto</span><span class="meta-value">${t.proto||"—"}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↓</span><span class="meta-value">${t.inputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↑</span><span class="meta-value">${t.outputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Duration</span><span class="meta-value">${(t.duration/1e6).toFixed(1)}ms</span></div>
            <div class="meta-item"><span class="meta-label">Error</span><span class="meta-value">${t.err||"—"}</span></div>
          </div>
        </div>

        ${t.http?a`
          <div class="section">
            <div class="section-title">${c("inspectorDetailHeaders")} — Request</div>
            <pre>${E(t.http.request.header)}</pre>
          </div>
          <div class="section">
            <div class="section-title">${c("inspectorDetailHeaders")} — Response</div>
            <pre>${E(t.http.response.header)}</pre>
          </div>
          ${t.http.request.body?a`
            <div class="section">
              <div class="section-title">${c("inspectorDetailBody")} — Request</div>
              <body-viewer .body=${t.http.request.body}></body-viewer>
            </div>
          `:""}
          ${t.http.response.body?a`
            <div class="section">
              <div class="section-title">${c("inspectorDetailBody")} — Response</div>
              <body-viewer .body=${t.http.response.body}></body-viewer>
            </div>
          `:""}
        `:""}

        ${t.websocket?a`
          <div class="section">
            <div class="section-title">WebSocket</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">From</span><span class="meta-value">${t.websocket.from}</span></div>
              <div class="meta-item"><span class="meta-label">OpCode</span><span class="meta-value">${t.websocket.opcode}</span></div>
              <div class="meta-item"><span class="meta-label">Length</span><span class="meta-value">${t.websocket.length}</span></div>
            </div>
            ${t.websocket.payload?a`
              <div class="section-title" style="margin-top:8px;">Payload</div>
              <body-viewer .body=${t.websocket.payload}></body-viewer>
            `:""}
          </div>
        `:""}
      </div>
    `:a``}};P.styles=u`
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
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-sm); background: #0d1117;
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 200px;
      overflow-y: auto; margin: 0;
    }
  `;B([l({attribute:!1})],P.prototype,"record",2);P=B([b("record-detail")],P);var ee=Object.getOwnPropertyDescriptor,te=(t,e,r,o)=>{for(var s=o>1?void 0:o?ee(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=n(s)||s);return s};let T=class extends v{render(){return a`<div class="spinner"></div>`}};T.styles=u`
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
  `;T=te([b("wisper-spinner")],T);var se=Object.defineProperty,re=Object.getOwnPropertyDescriptor,m=(t,e,r,o)=>{for(var s=o>1?void 0:o?re(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=(o?n(e,r,s):n(s))||s);return o&&s&&se(e,r,s),s};function oe(t){const e=t.toUpperCase();return e==="GET"?"method-green":e==="POST"||e==="PUT"||e==="PATCH"?"method-blue":e==="CONNECT"?"method-yellow":e==="DELETE"?"method-red":"method-default"}function ie(t){return t>=200&&t<300?"var(--green)":t>=400?"var(--red)":"var(--text-muted)"}let f=class extends v{constructor(){super(...arguments),this.records=[],this.protocol="http",this.selectedIndex=-1,this.hasMore=!1,this.loading=!1,this._observer=null}updated(){this._observer&&this._observer.disconnect(),this._observer=new IntersectionObserver(e=>{e[0]?.isIntersecting&&this.hasMore&&this.dispatchEvent(new CustomEvent("load-more",{bubbles:!0,composed:!0}))});const t=this.shadowRoot?.querySelector(".sentinel");t&&this._observer.observe(t)}disconnectedCallback(){super.disconnectedCallback(),this._observer?.disconnect()}_renderRow(t,e){const r=t.http?.host||t.host,o=t.http?.method||"",s=t.http?.uri||"",i=t.http?.statusCode||0,n=t.websocket?.opcode;return a`
      <div class="row ${this.selectedIndex===e?"selected":""}"
        @click=${()=>this.dispatchEvent(new CustomEvent("record-select",{detail:e,bubbles:!0,composed:!0}))}>
        ${o?a`
          <span class="method-badge ${oe(o)}">${o}</span>
        `:n!==void 0?a`
          <span class="method-badge method-default">WS</span>
        `:a`
          <span class="method-badge method-default">—</span>
        `}
        <div class="details">
          <div class="host">${r||t.service}</div>
          <div class="meta">
            <span>${s||t.dst||t.network}</span>
            <span>${t.proto||""}</span>
          </div>
        </div>
        ${i?a`
          <span style="color:${ie(i)};font-weight:600;font-size:var(--font-sm)">${i}</span>
        `:""}
        <div class="right">
          <div>↓${R(t.inputBytes)}</div>
          <div>↑${R(t.outputBytes)}</div>
        </div>
      </div>
      ${this.selectedIndex===e?a`<record-detail .record=${t}></record-detail>`:""}
    `}render(){return this.records.length===0?this.loading?a`<div class="loading"><wisper-spinner></wisper-spinner></div>`:a`<div class="empty">${c("inspectorNoRecords")}</div>`:a`
      <div class="list">
        ${this.records.map((t,e)=>this._renderRow(t,e))}
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
    .meta { font-size: var(--font-sm); color: var(--text-muted); margin-top: 1px; display: flex; gap: 8px; }
    .right { text-align: right; font-size: var(--font-sm); color: var(--text-muted); }
    .sentinel { height: 1px; }
    .empty { text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: var(--font-sm); }
    .loading { display: flex; justify-content: center; padding: 24px; }
  `;m([l({attribute:!1})],f.prototype,"records",2);m([l()],f.prototype,"protocol",2);m([l({type:Number})],f.prototype,"selectedIndex",2);m([l({type:Boolean})],f.prototype,"hasMore",2);m([l({type:Boolean})],f.prototype,"loading",2);f=m([b("record-list")],f);var ne=Object.defineProperty,ae=Object.getOwnPropertyDescriptor,S=(t,e,r,o)=>{for(var s=o>1?void 0:o?ae(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=(o?n(e,r,s):n(s))||s);return o&&s&&ne(e,r,s),s};let _=class extends v{constructor(){super(...arguments),this.connected=!1,this.recordCount=0,this.stopped=!1}render(){return a`
      <div class="bar">
        <span class="status">
          <span class="dot ${this.connected?"connected":"disconnected"}"></span>
          ${this.connected?c("inspectorStatusConnected"):c("inspectorStatusDisconnected")}
        </span>
        <span style="color:var(--text-muted)">${c("inspectorRecordsCount",{count:String(this.recordCount)})}</span>
        <span class="actions">
          ${this.stopped?a`<button @click=${()=>this.dispatchEvent(new CustomEvent("live-reconnect",{bubbles:!0,composed:!0}))}>${c("inspectorBtnReconnect")}</button>`:a`<button @click=${()=>this.dispatchEvent(new CustomEvent("live-stop",{bubbles:!0,composed:!0}))}>${c("inspectorBtnStop")}</button>`}
          <button @click=${()=>this.dispatchEvent(new CustomEvent("live-clear",{bubbles:!0,composed:!0}))}>${c("inspectorBtnClear")}</button>
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
  `;S([l({type:Boolean})],_.prototype,"connected",2);S([l({type:Number})],_.prototype,"recordCount",2);S([l({type:Boolean})],_.prototype,"stopped",2);_=S([b("live-indicator")],_);var ce=Object.defineProperty,de=Object.getOwnPropertyDescriptor,p=(t,e,r,o)=>{for(var s=o>1?void 0:o?de(e,r):e,i=t.length-1,n;i>=0;i--)(n=t[i])&&(s=(o?n(e,r,s):n(s))||s);return o&&s&&ce(e,r,s),s};let d=class extends v{constructor(){super(...arguments),this.parentKind="tunnel",this.parentType="",this.parentId="",this._mode="query",this._protocol="http",this._records=[],this._selectedIndex=-1,this._sid="",this._cursor=null,this._hasMore=!0,this._loading=!1,this._liveConnected=!1,this._liveStopped=!1,this._error="",this._client=null,this._clientUrl="",this._unsub=null,this._ws=null,this._reconnectDelay=1e3,this._reconnectTimer=null}connectedCallback(){super.connectedCallback(),this._initClient(),this._fetchRecords(),this._unsub=q(()=>this._onSettings())}disconnectedCallback(){super.disconnectedCallback(),this._closeWs(),this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._unsub?.(),this._unsub=null}_initClient(){const t=L().inspector_url||"";return t&&t!==this._clientUrl?(this._client=new U(t),this._clientUrl=t,!0):!1}_onSettings(){const t=!this._client;this._initClient()&&t&&(this._mode==="query"?(this._hasMore=!0,this._cursor=null,this._fetchRecords()):this._openWs())}_getClientId(){return this.parentKind==="tunnel"?this.parentId:I().find(r=>r.id===this.parentId)?.options?.tunnel_id||this.parentId}_getParentName(){return this.parentKind==="tunnel"?W().find(r=>r.id===this.parentId)?.name||this.parentId:I().find(e=>e.id===this.parentId)?.name||this.parentId}async _fetchRecords(t){if(!(!this._client||this._loading)){this._loading=!0,this._error="";try{const e=await this._client.query({client_id:this._getClientId(),type:this._protocol,sid:this._sid||void 0,before:t,limit:100});if(e.code===0&&e.data){const r=e.data.list||[];t?this._records=[...this._records,...r]:this._records=r,this._cursor=e.data.before||null,this._hasMore=r.length>=100}else this._error=e.msg||e.error||`query failed (code ${e.code})`}catch(e){this._error=e instanceof Error?e.message:String(e),console.error("[inspector] query failed:",e)}this._loading=!1}}_onLoadMore(){this._mode==="query"&&this._hasMore&&this._cursor&&this._fetchRecords(this._cursor)}_openWs(){if(this._client){this._closeWs(),this._liveStopped=!1,this._reconnectDelay=1e3;try{this._ws=this._client.connectTail({client_id:this._getClientId(),type:this._protocol,sid:this._sid||void 0}),this._ws.onopen=()=>{this._liveConnected=!0},this._ws.onmessage=t=>{try{const e=JSON.parse(t.data);this._records=[e,...this._records].slice(0,200)}catch{}},this._ws.onclose=()=>{this._liveConnected=!1,this._liveStopped||this._scheduleReconnect()},this._ws.onerror=()=>{this._ws?.close()}}catch{}}}_scheduleReconnect(){this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._reconnectTimer=setTimeout(()=>{this._openWs(),this._reconnectDelay=Math.min(this._reconnectDelay*2,3e4)},this._reconnectDelay)}_closeWs(){this._ws&&(this._ws.onclose=null,this._ws.onmessage=null,this._ws.close(),this._ws=null),this._liveConnected=!1}_onModeChange(t){const e=t.detail;this._mode=e,this._selectedIndex=-1,e==="live"?(this._records=[],this._openWs()):(this._closeWs(),this._records=[],this._fetchRecords())}_onProtocolChange(t){this._protocol=t.detail,this._selectedIndex=-1,this._mode==="live"?(this._records=[],this._openWs()):(this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords())}_onFilterChange(t){const{sid:e}=t.detail;this._sid=e,this._selectedIndex=-1,this._mode==="live"?(this._records=[],this._openWs()):(this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords())}_onRecordSelect(t){const e=t.detail;this._selectedIndex=this._selectedIndex===e?-1:e}_onLiveStop(){this._liveStopped=!0,this._closeWs(),this._reconnectTimer&&clearTimeout(this._reconnectTimer)}_onLiveReconnect(){this._liveStopped=!1,this._openWs()}_onLiveClear(){this._records=[],this._selectedIndex=-1}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const t=this._getParentName(),e=this.parentKind==="tunnel"?`/tunnel/${this.parentType}/${this.parentId}`:`/entrypoint/${this.parentType}/${this.parentId}`,r=this._getClientId().slice(0,8);return this._client?a`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(e)}>
            ${D("chevron-left")}
          </button>
          <span class="page-title">
            &larr; ${t||this.parentId} &middot; ${c("inspectorTitle")}
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
            @filter-change=${this._onFilterChange}>
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
            <button class="back-btn" @click=${()=>this._navigate(e)}>
              ${D("chevron-left")}
            </button>
            <span class="page-title">${c("inspectorTitle")}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 24px;text-align:center;color:var(--text-muted);gap:12px;">
            <div style="font-size:48px;">🔍</div>
            <div style="font-size:var(--font-md);color:var(--text-secondary);">${c("inspectorNotConfigured")}</div>
            <div style="font-size:var(--font-sm);">${c("inspectorNotConfiguredDesc")}</div>
            <a href="/settings" style="color:var(--accent);font-size:var(--font-sm);text-decoration:none;margin-top:8px;">&rarr; ${c("settingsTitle")}</a>
          </div>
        </app-scaffold>
      `}};d.styles=u`
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
  `;p([l()],d.prototype,"parentKind",2);p([l()],d.prototype,"parentType",2);p([l()],d.prototype,"parentId",2);p([h()],d.prototype,"_mode",2);p([h()],d.prototype,"_protocol",2);p([h()],d.prototype,"_records",2);p([h()],d.prototype,"_selectedIndex",2);p([h()],d.prototype,"_sid",2);p([h()],d.prototype,"_cursor",2);p([h()],d.prototype,"_hasMore",2);p([h()],d.prototype,"_loading",2);p([h()],d.prototype,"_liveConnected",2);p([h()],d.prototype,"_liveStopped",2);p([h()],d.prototype,"_error",2);d=p([b("inspector-page")],d);export{d as InspectorPage};
