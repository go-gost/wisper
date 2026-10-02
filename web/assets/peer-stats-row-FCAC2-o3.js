import{c as r,i as x,a as b,A as i,b as t,t as m}from"./index-7erqeHsR.js";import{n as d,r as y,m as $,c as w,a as g,b as u}from"./format-DT_YmQ4-.js";import{i as v}from"./app-scaffold-CijyBcD_.js";import{a as _}from"./transport-DrpTtcx8.js";function z(e){const a=e instanceof Error?e.message:"";return a.includes("is already used by another p2p tunnel")?`${r("saveFailed")}: ${r("peerKeyInUseHint")}`:`${r("saveFailed")}${a?": "+a:""}`}var D=Object.defineProperty,k=Object.getOwnPropertyDescriptor,l=(e,a,s,n)=>{for(var o=n>1?void 0:n?k(a,s):a,c=e.length-1,f;c>=0;c--)(f=e[c])&&(o=(n?f(a,s,o):f(o))||o);return n&&o&&D(a,s,o),o};let p=class extends b{constructor(){super(...arguments),this.peer=null,this.stat=null,this.disabled=!1,this.showKeys=!1,this._expanded=!1}_renderTransport(){const e=_(this.stat?.transport);return e?t`<span class="peer-badge ${e.tone}" title=${e.hint}>
      ${v(e.icon)}<span>${e.label}</span>
    </span>`:i}_renderDiag(){const e=this.stat;if(!e)return i;const a=e.caps&&e.caps.length>0?e.caps.join(", "):"",s=(n,o)=>t`
      <div class="diag-row">
        <span class="diag-label">${n}</span>
        <span class="diag-value">${o}</span>
      </div>`;return t`
      <div class="peer-diag">
        ${s(r("peersDiagPath"),e.transport??"—")}
        ${e.reason?s(r("peersDiagReason"),e.reason):i}
        ${s(r("peersDiagState"),e.state??"—")}
        ${e.failed?s(r("peersDiagFailed"),r("peersDiagYes")):i}
        ${e.last_error?s(r("peersDiagLastError"),e.last_error):i}
        ${s(r("peersDiagEndpoint"),e.peer_addr||"—")}
        ${s(r("peersDiagCandidates"),String(e.candidates??0))}
        ${a?s(r("peersDiagCaps"),a):i}
        ${s(r("peersDiagSession"),h(e.session_age_ms))}
        ${s(r("peersDiagSilence"),h(e.last_recv_age_ms))}
        ${e.trace&&e.trace.length>0?t`<div class="diag-trace">
              <span class="diag-label">${r("peersDiagTrace")}</span>
              <div class="trace-lines">
                ${e.trace.map(n=>t`<div class="trace-line">${n}</div>`)}
              </div>
            </div>`:i}
      </div>
    `}render(){const e=this.peer,a=this.stat,s=!!a?.transport;return t`
      <div class="peer-row ${this.disabled?"off":""}">
        <div class="row-line">
          <span class="peer-alias">${a?.alias||e?.alias||r("peersNoAlias")}</span>
          ${this.rowActions}
          ${this.disabled?t`<span class="peer-badge" title=${r("peersDisabledHint")}>${r("peersDisabled")}</span>`:this._renderTransport()}
          ${s?t`<button class="icon-btn" title="${r("peersDiagDetails")}"
                @click=${()=>{this._expanded=!this._expanded}}>
                ${v(this._expanded?"chevron-up":"chevron-down")}
              </button>`:i}
        </div>
        <div class="peer-key">${this.showKeys?e?.key:$(e?.key??"")}</div>
        ${a?t`<div class="peer-stats">
              <span>${w(a.current_conns)} ${r("p2pColConns")}</span>
              <span>↓ ${g(a.output_bytes)} <span class="rate">${u(a.output_rate_bytes)}</span></span>
              <span>↑ ${g(a.input_bytes)} <span class="rate">${u(a.input_rate_bytes)}</span></span>
            </div>`:t`<div class="peer-stats"><span class="muted">${r("peersNoTraffic")}</span></div>`}
        ${this._expanded&&s?this._renderDiag():i}
      </div>
    `}};p.styles=x`
    .peer-row {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .row-line {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .peer-alias {
      flex: 1;
      font-size: var(--font-sm);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .peer-badge {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 8px;
      border-radius: var(--radius-pill);
      background: var(--border-subtle);
      color: var(--text-muted);
      font-size: var(--font-sm);
    }
    .peer-badge svg {
      width: 12px;
      height: 12px;
    }
    .peer-badge.direct {
      color: var(--green-text);
      background: var(--green-bg);
    }
    .peer-badge.warn {
      color: var(--amber);
    }
    /* A switched-off peer keeps its place and its key, but nothing about it is
       live: the row reads dimmed. */
    .peer-row.off .peer-alias,
    .peer-row.off .peer-key,
    .peer-row.off .peer-stats {
      opacity: 0.5;
    }
    .row-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .peer-key {
      padding-top: 2px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
      color: var(--text-muted);
      overflow-wrap: anywhere;
      line-height: 1.4;
    }
    .peer-stats {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .peer-stats .muted {
      font-style: italic;
    }
    /* The rate sits on its own line under the byte count: on a narrow screen a
       single line of "↓ 400.2 KB 0 B/s" has no room and wraps awkwardly. */
    .peer-stats .rate {
      display: block;
      color: var(--text-muted);
      opacity: 0.8;
    }
    /* The row's expand: the raw per-peer state, one label/value line each. */
    .peer-diag {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      background: var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: var(--font-xs);
    }
    .diag-row {
      display: flex;
      gap: 8px;
    }
    .diag-label {
      flex: none;
      width: 84px;
      color: var(--text-muted);
    }
    .diag-value {
      color: var(--text-secondary);
      overflow-wrap: anywhere;
    }
    /* The peer's recent punch history: one monospace line per step, oldest
       first (newest last). */
    .diag-trace {
      display: flex;
      gap: 8px;
      margin-top: 2px;
    }
    .trace-lines {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      font-family: var(--font-mono, monospace);
      color: var(--text-secondary);
    }
    .trace-line {
      overflow-wrap: anywhere;
    }
    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 4px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
    }
    .icon-btn:hover {
      background: var(--border-subtle);
      color: var(--text);
    }
    .icon-btn svg {
      width: 14px;
      height: 14px;
    }
  `;l([d({attribute:!1})],p.prototype,"peer",2);l([d({attribute:!1})],p.prototype,"stat",2);l([d({type:Boolean})],p.prototype,"disabled",2);l([d({type:Boolean})],p.prototype,"showKeys",2);l([d()],p.prototype,"rowActions",2);l([y()],p.prototype,"_expanded",2);p=l([m("peer-stats-row")],p);function h(e){if(!e||e<=0)return"—";const a=Math.floor(e/1e3);if(a<60)return`${a}s`;const s=Math.floor(a/60);return s<60?`${s}m ${a%60}s`:`${Math.floor(s/60)}h ${s%60}m`}export{z as s};
