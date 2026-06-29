import{i as b,a as m,j as l,b as o,t as _,h as U,u as F,c as j,g as N}from"./index-CSZRsDz3.js";import{n as c,r as h}from"./state-CKooRXpi.js";import{i as q}from"./app-scaffold-CgR6eh8Q.js";import{e as z,d as W,a as R,g as H}from"./format-BcWb47bn.js";class A{constructor(t){this.baseUrl=t.replace(/\/$/,"")}async liveness(){try{return(await fetch(`${this.baseUrl}/liveness`)).ok}catch{return!1}}async query(t){const i=new URLSearchParams;i.set("client_id",t.client_id),t.type&&i.set("type",t.type),t.service&&i.set("service",t.service),t.sid&&i.set("sid",t.sid),t.start!==void 0&&i.set("start",String(t.start)),t.end!==void 0&&i.set("end",String(t.end)),t.before&&i.set("before",t.before),t.after&&i.set("after",t.after),t.limit!==void 0&&i.set("limit",String(t.limit));const r=await fetch(`${this.baseUrl}/api/records/query?${i.toString()}`);if(!r.ok)throw new Error(`Inspector query failed: ${r.status}`);return r.json()}connectTail(t){const i=new URLSearchParams;i.set("client_id",t.client_id),t.type&&i.set("type",t.type),t.service&&i.set("service",t.service),t.sid&&i.set("sid",t.sid);const r=this.baseUrl.replace(/^http/,"ws");return new WebSocket(`${r}/api/records/tail?${i.toString()}`)}async getRecord(t){const i=await fetch(`${this.baseUrl}/api/records/${encodeURIComponent(t)}`);if(!i.ok)throw new Error(`Inspector record detail failed: ${i.status}`);const r=await i.json();if(r.code!==0)throw new Error(r.msg||r.error||"Unknown error");return r.data}}function K(e){const t=atob(e),i=new Uint8Array(t.length);for(let r=0;r<t.length;r++)i[r]=t.charCodeAt(r);return i}var G=Object.defineProperty,J=Object.getOwnPropertyDescriptor,B=(e,t,i,r)=>{for(var s=r>1?void 0:r?J(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=(r?a(t,i,s):a(s))||s);return r&&s&&G(t,i,s),s};const X=[{type:"http",labelKey:"inspectorProtocolHttp"},{type:"websocket",labelKey:"inspectorProtocolWs"}];let I=class extends m{constructor(){super(...arguments),this.active="http"}render(){return o`
      <div class="tabs">
        ${X.map(e=>o`
          <button class="tab ${this.active===e.type?"active":""}"
            @click=${()=>this.dispatchEvent(new CustomEvent("protocol-change",{detail:e.type,bubbles:!0,composed:!0}))}>
            ${l(e.labelKey)}
          </button>
        `)}
      </div>
    `}};I.styles=b`
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
  `;B([c()],I.prototype,"active",2);I=B([_("protocol-tabs")],I);var Q=Object.defineProperty,V=Object.getOwnPropertyDescriptor,L=(e,t,i,r)=>{for(var s=r>1?void 0:r?V(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=(r?a(t,i,s):a(s))||s);return r&&s&&Q(t,i,s),s};let T=class extends m{constructor(){super(...arguments),this.mode="query"}render(){return o`
      <div class="toggle">
        <button class="btn ${this.mode==="query"?"active":""}"
          @click=${()=>this._setMode("query")}>${l("inspectorQuery")}</button>
        <button class="btn ${this.mode==="live"?"active":""}"
          @click=${()=>this._setMode("live")}>${l("inspectorLive")}</button>
      </div>
    `}_setMode(e){this.mode=e,this.dispatchEvent(new CustomEvent("mode-change",{detail:e,bubbles:!0,composed:!0}))}};T.styles=b`
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
  `;L([c()],T.prototype,"mode",2);T=L([_("mode-toggle")],T);var Y=Object.defineProperty,Z=Object.getOwnPropertyDescriptor,O=(e,t,i,r)=>{for(var s=r>1?void 0:r?Z(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=(r?a(t,i,s):a(s))||s);return r&&s&&Y(t,i,s),s};const ee=[{minutes:5,label:"5m"},{minutes:15,label:"15m"},{minutes:60,label:"1h"},{minutes:360,label:"6h"},{minutes:1440,label:"24h"}];let $=class extends m{constructor(){super(...arguments),this.sid="",this.mode="query",this.range="all",this._debounceTimer=null}_fireChange(){this._debounceTimer&&clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(()=>{this.dispatchEvent(new CustomEvent("filter-change",{detail:{sid:this.sid},bubbles:!0,composed:!0}))},400)}disconnectedCallback(){super.disconnectedCallback(),this._debounceTimer&&clearTimeout(this._debounceTimer)}render(){return o`
      <div class="filter-row">
        <input .value=${this.sid} placeholder=${l("inspectorFilterSid")}
          @input=${e=>{this.sid=e.target.value,this._fireChange()}}>
      </div>
      ${this.mode==="query"?o`
        <div class="range-row">
          <span class="range-label">${l("inspectorTime")}</span>
          <div class="pills">
            ${ee.map(e=>o`
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
    `}};$.styles=b`
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
  `;O([c()],$.prototype,"sid",2);O([c()],$.prototype,"mode",2);O([c()],$.prototype,"range",2);$=O([_("inspector-filter-bar")],$);var te=Object.defineProperty,se=Object.getOwnPropertyDescriptor,M=(e,t,i,r)=>{for(var s=r>1?void 0:r?se(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=(r?a(t,i,s):a(s))||s);return r&&s&&te(t,i,s),s};const S=4096;let k=class extends m{constructor(){super(...arguments),this.body="",this._tab="text"}_decode(){if(!this.body)return new Uint8Array(0);try{return K(this.body)}catch{return new TextEncoder().encode(this.body)}}_renderContent(){const e=this._decode();switch(this._tab){case"hex":return this._renderHexdump(e);case"json":try{const t=new TextDecoder().decode(e);return JSON.stringify(JSON.parse(t),null,2)}catch{return new TextDecoder().decode(e)}default:return new TextDecoder().decode(e)}}_renderHexdump(e){const t=e.length>S?e.slice(0,S):e,i=[];for(let r=0;r<t.length;r+=16){let s="",n="";for(let a=0;a<16;a++){a===8&&(s+=" ");const C=r+a;if(C>=t.length)s+="   ";else{const u=t[C];s+=u.toString(16).padStart(2,"0")+" ",n+=u>=32&&u<=126?String.fromCharCode(u):"."}}i.push(`${r.toString(16).padStart(8,"0")}  ${s} |${n}|`)}return e.length>S&&i.push(`... (${(e.length-S).toLocaleString()} more bytes not shown)`),i.join(`
`)}_copyContent(){navigator.clipboard.writeText(this._renderContent())}render(){return o`
      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${this._tab==="text"?"active":""}" @click=${()=>{this._tab="text"}}>${l("inspectorTabText")}</button>
          <button class="tab ${this._tab==="hex"?"active":""}" @click=${()=>{this._tab="hex"}}>${l("inspectorTabHex")}</button>
          <button class="tab ${this._tab==="json"?"active":""}" @click=${()=>{this._tab="json"}}>${l("inspectorTabJson")}</button>
        </div>
        <button class="copy-btn" @click=${()=>this._copyContent()}>${l("inspectorBtnCopy")}</button>
      </div>
      <pre class="${this._tab==="hex"?"hex":""}">${this._renderContent()}</pre>
    `}};k.styles=b`
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
    .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
    .copy-btn {
      font-size: var(--font-sm); padding: 2px 8px; cursor: pointer;
      background: var(--border-subtle); border: none; border-radius: 4px;
      color: var(--text-muted); font-family: inherit; margin-left: auto;
    }
  `;M([c()],k.prototype,"body",2);M([h()],k.prototype,"_tab",2);k=M([_("body-viewer")],k);var ie=Object.getOwnPropertyDescriptor,re=(e,t,i,r)=>{for(var s=r>1?void 0:r?ie(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=a(s)||s);return s};let E=class extends m{render(){return o`<div class="spinner"></div>`}};E.styles=b`
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
  `;E=re([_("wisper-spinner")],E);var oe=Object.defineProperty,ne=Object.getOwnPropertyDescriptor,P=(e,t,i,r)=>{for(var s=r>1?void 0:r?ne(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=(r?a(t,i,s):a(s))||s);return r&&s&&oe(t,i,s),s};let g=class extends m{constructor(){super(...arguments),this.record=null,this.client=null,this._fullRecord=null,this._loadingDetail=!1,this._fetchedId=""}willUpdate(e){if(e.has("record")){const t=this.record;t?.id!==this._fetchedId&&(this._fullRecord=null,this._fetchedId=""),t&&this.client&&this._maybeFetchDetail(t)}if(e.has("client")){const t=this.record;t&&this.client&&this._maybeFetchDetail(t)}}_needsDetail(e){return e.id?e.http?e.http.request.body==null||e.http.request.header==null:e.websocket?e.websocket.payload==null:!1:!1}async _maybeFetchDetail(e){if(!this._needsDetail(e)||e.id===this._fetchedId)return;const t=e.id;this._fetchedId=t,this._loadingDetail=!0;try{const i=await this.client.getRecord(t);this._fetchedId===t&&(this._fullRecord=i)}catch(i){console.warn("[inspector] fetch detail failed:",i)}this._fetchedId===t&&(this._loadingDetail=!1)}render(){const e=this._fullRecord||this.record;return e?o`
      <div class="panel">
        ${this._loadingDetail?o`
          <div class="loading-detail"><wisper-spinner></wisper-spinner> Loading details...</div>
        `:""}

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

        ${e.http?o`
          <div class="section">
            <div class="section-title">Request</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">Method</span><span class="meta-value">${e.http.method||"—"}</span></div>
              <div class="meta-item"><span class="meta-label">Host</span><span class="meta-value">${e.http.host||"—"}</span></div>
              <div class="meta-item uri-item"><span class="meta-label">URI</span><span class="meta-value uri-text">${e.http.uri||"—"}</span></div>
            </div>
          </div>
          ${e.http.request.header?o`
            <div class="section">
              <div class="section-title">${l("inspectorDetailHeaders")} — Request</div>
              <pre>${z(e.http.request.header)}</pre>
            </div>
          `:""}
          ${e.http.response.header?o`
            <div class="section">
              <div class="section-title">${l("inspectorDetailHeaders")} — Response</div>
              <pre>${z(e.http.response.header)}</pre>
            </div>
          `:""}
          ${e.http.request.body?o`
            <div class="section">
              <div class="section-title">${l("inspectorDetailBody")} — Request</div>
              <body-viewer .body=${e.http.request.body}></body-viewer>
            </div>
          `:""}
          ${e.http.response.body?o`
            <div class="section">
              <div class="section-title">${l("inspectorDetailBody")} — Response</div>
              <body-viewer .body=${e.http.response.body}></body-viewer>
            </div>
          `:""}
        `:""}

        ${e.websocket?o`
          <div class="section">
            <div class="section-title">WebSocket</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">From</span><span class="meta-value">${e.websocket.from}</span></div>
              <div class="meta-item"><span class="meta-label">OpCode</span><span class="meta-value">${e.websocket.opcode}</span></div>
              <div class="meta-item"><span class="meta-label">Length</span><span class="meta-value">${e.websocket.length}</span></div>
            </div>
            ${e.websocket.payload?o`
              <div class="section-title" style="margin-top:8px;">Payload</div>
              <body-viewer .body=${e.websocket.payload}></body-viewer>
            `:""}
          </div>
        `:""}
      </div>
    `:o``}};g.styles=b`
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
    .meta-item { display: flex; justify-content: space-between; padding: 2px 0; min-width: 0; }
    .meta-label { color: var(--text-muted); flex-shrink: 0; margin-right: 8px; }
    .meta-value { font-family: var(--font-mono, 'SF Mono', monospace); min-width: 0; word-break: break-word; text-align: right; }
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
    .loading-detail {
      display: flex; align-items: center; gap: 6px;
      color: var(--text-muted); font-size: var(--font-sm); padding: 8px 0;
    }
  `;P([c({attribute:!1})],g.prototype,"record",2);P([c({attribute:!1})],g.prototype,"client",2);P([h()],g.prototype,"_fullRecord",2);P([h()],g.prototype,"_loadingDetail",2);g=P([_("record-detail")],g);var ae=Object.defineProperty,le=Object.getOwnPropertyDescriptor,x=(e,t,i,r)=>{for(var s=r>1?void 0:r?le(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=(r?a(t,i,s):a(s))||s);return r&&s&&ae(t,i,s),s};function ce(e){const t=e.toUpperCase();return t==="GET"?"method-green":t==="POST"||t==="PUT"||t==="PATCH"?"method-blue":t==="CONNECT"?"method-yellow":t==="DELETE"?"method-red":"method-default"}function de(e){return e>0&&e<300?"status-green":e>=300&&e<400?"status-yellow":e>=400?"status-red":"status-muted"}function pe(e){if(e==null)return null;switch(e){case 1:return{label:"TEXT",cls:"op-text"};case 2:return{label:"BINARY",cls:"op-binary"};case 8:return{label:"CLOSE",cls:"op-close"};case 9:return{label:"PING",cls:"op-default"};case 10:return{label:"PONG",cls:"op-default"};default:return{label:`#${e}`,cls:"op-default"}}}let f=class extends m{constructor(){super(...arguments),this.records=[],this.protocol="http",this.selectedIndex=-1,this.hasMore=!1,this.loading=!1,this.client=null,this._observer=null}updated(){this._observer&&this._observer.disconnect(),this._observer=new IntersectionObserver(t=>{t[0]?.isIntersecting&&this.hasMore&&this.dispatchEvent(new CustomEvent("load-more",{bubbles:!0,composed:!0}))});const e=this.shadowRoot?.querySelector(".sentinel");e&&this._observer.observe(e)}disconnectedCallback(){super.disconnectedCallback(),this._observer?.disconnect()}_renderRow(e,t){const i=e.http?.host||e.host||e.service,r=e.http?.uri||"",s=e.time?W(e.time):"",n=e.http?.proto||e.proto||"",a=o`<span class="muted">↓${R(e.inputBytes)} ↑${R(e.outputBytes)}</span>`,C=H(e.duration);let u;if(e.http){const v=e.http.method||"",y=e.http.statusCode||0;u=o`
        <div class="line">
          <span class="status ${de(y)}">${y||"—"}</span>
          ${v?o`<span class="method-badge ${ce(v)}">${v}</span>`:""}
          <span class="host">${i}</span>
          <span class="muted">${C}</span>
        </div>
        ${r?o`<div class="uri">${r}</div>`:""}
        <div class="line">
          ${a}
          ${n?o`<span class="muted">${n}</span>`:""}
          ${s?o`<span class="time">${s}</span>`:""}
        </div>
      `}else if(e.websocket){const v=e.websocket.from,y=pe(e.websocket.opcode);u=o`
        <div class="line">
          <span class="dir ${v==="client"?"dir-in":"dir-out"}">${v==="client"?"→":"←"}</span>
          <span class="host">${i}</span>
          ${y?o`<span class="opcode ${y.cls}">${y.label}</span>`:""}
        </div>
        ${r?o`<div class="uri">${r}</div>`:""}
        <div class="line">
          <span class="muted">${R(e.websocket.length??0)}</span>
          ${s?o`<span class="time">${s}</span>`:""}
        </div>
      `}else{const v=r||e.dst||e.network;u=o`
        <div class="line">
          <span class="host">${i}</span>
          <span class="muted">${C}</span>
        </div>
        ${v?o`<div class="uri">${v}</div>`:""}
        <div class="line">
          ${a}
          ${n?o`<span class="muted">${n}</span>`:""}
          ${s?o`<span class="time">${s}</span>`:""}
        </div>
      `}return o`
      <div class="row ${this.selectedIndex===t?"selected":""}"
        @click=${()=>this.dispatchEvent(new CustomEvent("record-select",{detail:t,bubbles:!0,composed:!0}))}>
        ${u}
      </div>
      ${this.selectedIndex===t?o`<record-detail .record=${e} .client=${this.client}></record-detail>`:""}
    `}render(){return this.records.length===0?this.loading?o`<div class="loading"><wisper-spinner></wisper-spinner></div>`:o`<div class="empty">${l("inspectorNoRecords")}</div>`:o`
      <div class="list">
        ${this.records.map((e,t)=>this._renderRow(e,t))}
        <div class="sentinel"></div>
      </div>
    `}};f.styles=b`
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
  `;x([c({attribute:!1})],f.prototype,"records",2);x([c()],f.prototype,"protocol",2);x([c({type:Number})],f.prototype,"selectedIndex",2);x([c({type:Boolean})],f.prototype,"hasMore",2);x([c({type:Boolean})],f.prototype,"loading",2);x([c({attribute:!1})],f.prototype,"client",2);f=x([_("record-list")],f);var he=Object.defineProperty,ue=Object.getOwnPropertyDescriptor,D=(e,t,i,r)=>{for(var s=r>1?void 0:r?ue(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=(r?a(t,i,s):a(s))||s);return r&&s&&he(t,i,s),s};let w=class extends m{constructor(){super(...arguments),this.connected=!1,this.recordCount=0,this.stopped=!1}render(){return o`
      <div class="bar">
        <span class="status">
          <span class="dot ${this.connected?"connected":"disconnected"}"></span>
          ${this.connected?l("inspectorStatusConnected"):l("inspectorStatusDisconnected")}
        </span>
        <span style="color:var(--text-muted)">${l("inspectorRecordsCount",{count:String(this.recordCount)})}</span>
        <span class="actions">
          ${this.stopped?o`<button @click=${()=>this.dispatchEvent(new CustomEvent("live-reconnect",{bubbles:!0,composed:!0}))}>${l("inspectorBtnReconnect")}</button>`:o`<button @click=${()=>this.dispatchEvent(new CustomEvent("live-stop",{bubbles:!0,composed:!0}))}>${l("inspectorBtnStop")}</button>`}
          <button @click=${()=>this.dispatchEvent(new CustomEvent("live-clear",{bubbles:!0,composed:!0}))}>${l("inspectorBtnClear")}</button>
        </span>
      </div>
    `}};w.styles=b`
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
  `;D([c({type:Boolean})],w.prototype,"connected",2);D([c({type:Number})],w.prototype,"recordCount",2);D([c({type:Boolean})],w.prototype,"stopped",2);w=D([_("live-indicator")],w);var ve=Object.defineProperty,fe=Object.getOwnPropertyDescriptor,p=(e,t,i,r)=>{for(var s=r>1?void 0:r?fe(t,i):t,n=e.length-1,a;n>=0;n--)(a=e[n])&&(s=(r?a(t,i,s):a(s))||s);return r&&s&&ve(t,i,s),s};let d=class extends m{constructor(){super(...arguments),this.parentKind="tunnel",this.parentType="",this.parentId="",this._mode="query",this._protocol="http",this._records=[],this._selectedIndex=-1,this._sid="",this._range="all",this._cursor=null,this._hasMore=!0,this._loading=!1,this._liveConnected=!1,this._liveStopped=!1,this._error="",this._client=null,this._clientUrl="",this._unsub=null,this._ws=null,this._reconnectDelay=1e3,this._reconnectTimer=null}connectedCallback(){super.connectedCallback(),this._initClient(),this._fetchRecords(),this._unsub=U(()=>this._onSettings())}disconnectedCallback(){super.disconnectedCallback(),this._closeWs(),this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._unsub?.(),this._unsub=null}_initClient(){const e=F().inspector_url||"";return e&&e!==this._clientUrl?(this._client=new A(e),this._clientUrl=e,!0):!1}_onSettings(){const e=!this._client;this._initClient()&&e&&(this._mode==="query"?(this._hasMore=!0,this._cursor=null,this._fetchRecords()):this._openWs())}_getClientId(){return this.parentKind==="tunnel"?this.parentId:j().find(i=>i.id===this.parentId)?.options?.tunnel_id||this.parentId}_getParentName(){return this.parentKind==="tunnel"?N().find(i=>i.id===this.parentId)?.name||this.parentId:j().find(t=>t.id===this.parentId)?.name||this.parentId}async _fetchRecords(e){if(!(!this._client||this._loading)){this._loading=!0,this._error="";try{const t=await this._client.query({client_id:this._getClientId(),type:this._protocol,sid:this._sid||void 0,start:this._range!=="all"?Math.floor(Date.now()/1e3)-this._range*60:void 0,before:e,limit:50});if(t.code===0&&t.data){const i=t.data.list||[];e?this._records=[...this._records,...i]:this._records=i,this._cursor=t.data.before||null,this._hasMore=i.length>=50}else this._error=t.msg||t.error||`query failed (code ${t.code})`}catch(t){this._error=t instanceof Error?t.message:String(t),console.error("[inspector] query failed:",t)}this._loading=!1}}_onLoadMore(){this._mode==="query"&&this._hasMore&&this._cursor&&this._fetchRecords(this._cursor)}_openWs(){if(this._client){this._closeWs(),this._liveStopped=!1,this._reconnectDelay=1e3;try{this._ws=this._client.connectTail({client_id:this._getClientId(),type:this._protocol,sid:this._sid||void 0}),this._ws.onopen=()=>{this._liveConnected=!0},this._ws.onmessage=e=>{try{const t=JSON.parse(e.data);this._records=[t,...this._records].slice(0,200)}catch{}},this._ws.onclose=()=>{this._liveConnected=!1,this._liveStopped||this._scheduleReconnect()},this._ws.onerror=()=>{this._ws?.close()}}catch{}}}_scheduleReconnect(){this._reconnectTimer&&clearTimeout(this._reconnectTimer),this._reconnectTimer=setTimeout(()=>{this._openWs(),this._reconnectDelay=Math.min(this._reconnectDelay*2,3e4)},this._reconnectDelay)}_closeWs(){this._ws&&(this._ws.onclose=null,this._ws.onmessage=null,this._ws.close(),this._ws=null),this._liveConnected=!1}_onModeChange(e){const t=e.detail;this._mode=t,this._selectedIndex=-1,t==="live"?(this._records=[],this._openWs()):(this._closeWs(),this._records=[],this._fetchRecords())}_onProtocolChange(e){this._protocol=e.detail,this._selectedIndex=-1,this._mode==="live"?(this._records=[],this._openWs()):(this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords())}_onFilterChange(e){const{sid:t}=e.detail;this._sid=t,this._selectedIndex=-1,this._mode==="live"?(this._records=[],this._openWs()):(this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords())}_onRangeChange(e){this._range=e.detail,this._selectedIndex=-1,this._records=[],this._hasMore=!0,this._cursor=null,this._fetchRecords()}_onRecordSelect(e){const t=e.detail;this._selectedIndex=this._selectedIndex===t?-1:t}_onLiveStop(){this._liveStopped=!0,this._closeWs(),this._reconnectTimer&&clearTimeout(this._reconnectTimer)}_onLiveReconnect(){this._liveStopped=!1,this._openWs()}_onLiveClear(){this._records=[],this._selectedIndex=-1}_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const e=this._getParentName(),t=this.parentKind==="tunnel"?`/tunnel/${this.parentType}/${this.parentId}`:`/entrypoint/${this.parentType}/${this.parentId}`,i=this._getClientId().slice(0,8);return this._client?o`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(t)}>
            ${q("chevron-left")}
          </button>
          <span class="page-title">
            &larr; ${e||this.parentId} &middot; ${l("inspectorTitle")}
          </span>
          <span class="id-chip">${i}</span>
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

        ${this._mode==="live"?o`
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
          ${this._error?o`<div style="color:var(--red);font-size:var(--font-sm);padding:6px 0;">⚠ ${this._error}</div>`:""}
          <record-list
            .records=${this._records}
            .protocol=${this._protocol}
            .selectedIndex=${this._selectedIndex}
            .loading=${this._mode==="query"&&this._loading}
            .hasMore=${this._mode==="query"&&this._hasMore}
            .client=${this._client}
            @record-select=${this._onRecordSelect}
            @load-more=${()=>this._onLoadMore()}>
          </record-list>
        </div>
      </app-scaffold>
    `:o`
        <app-scaffold>
          <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
            <button class="back-btn" @click=${()=>this._navigate(t)}>
              ${q("chevron-left")}
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
      `}};d.styles=b`
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
  `;p([c()],d.prototype,"parentKind",2);p([c()],d.prototype,"parentType",2);p([c()],d.prototype,"parentId",2);p([h()],d.prototype,"_mode",2);p([h()],d.prototype,"_protocol",2);p([h()],d.prototype,"_records",2);p([h()],d.prototype,"_selectedIndex",2);p([h()],d.prototype,"_sid",2);p([h()],d.prototype,"_range",2);p([h()],d.prototype,"_cursor",2);p([h()],d.prototype,"_hasMore",2);p([h()],d.prototype,"_loading",2);p([h()],d.prototype,"_liveConnected",2);p([h()],d.prototype,"_liveStopped",2);p([h()],d.prototype,"_error",2);d=p([_("inspector-page")],d);export{d as InspectorPage};
