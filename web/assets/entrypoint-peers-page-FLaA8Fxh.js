import{a as f,G as u,c as e,A as n,b as s,i as g,t as x}from"./index-CdTQTsR8.js";import{m as _,a as v,n as h,r as p}from"./format-DhoiFF4n.js";import{i as y}from"./app-scaffold-_iq4zLbF.js";var m=Object.defineProperty,k=Object.getOwnPropertyDescriptor,l=(t,a,i,r)=>{for(var d=r>1?void 0:r?k(a,i):a,c=t.length-1,b;c>=0;c--)(b=t[c])&&(d=(r?b(a,i,d):b(d))||d);return r&&d&&m(a,i,d),d};let o=class extends f{constructor(){super(...arguments),this.entrypointType="",this.entrypointId="",this._peers=[],this._error="",this._savingKey="",this._snackbar="",this._backend=new u,this._poll=0}connectedCallback(){super.connectedCallback(),this._load(),this._poll=window.setInterval(()=>void this._load(),5e3)}disconnectedCallback(){window.clearInterval(this._poll),this._poll=0,super.disconnectedCallback()}async _load(){try{const t=await this._backend.listEntrypointPeers(this.entrypointId);this._peers=t.peers??[],this._error=""}catch(t){this._error=t instanceof Error?t.message:""}}async _toggle(t){if(t.state==="hub"||this._savingKey)return;const a=this._peers.filter(r=>r.blocked).map(r=>r.key),i=t.blocked?a.filter(r=>r!==t.key):[...a,t.key];this._savingKey=t.key,this._error="";try{const r=await this._backend.updateEntrypointPeers(this.entrypointId,i);this._peers=r.peers??[],this._showSnackbar(e("saved"))}catch(r){this._error=r instanceof Error?r.message:""}finally{this._savingKey=""}}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar=""},2500)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_stateLabel(t){switch(t.state){case"hub":return e("entrypointPeersStateHub");case"blocked":return e("entrypointPeersStateBlocked");case"disabled":return e("entrypointPeersStateDisabled");case"direct-off":return e("entrypointPeersStateDirectOff");case"direct":return e("entrypointPeersStateDirect");case"connecting":return e("entrypointPeersStateConnecting");default:return t.state}}_renderPeer(t){const a=t.state!=="hub",i=t.name||e("peersNoAlias");return s`
      <div class="peer-row">
        <div class="row-line">
          <div class="peer-main">
            <div class="peer-name">${i}</div>
            <div class="peer-key">${_(t.key)}</div>
          </div>
          <span class="state ${t.state}">
            ${t.state==="direct"?y("zap"):n}${this._stateLabel(t)}
          </span>
          ${a?s`
              <button class="block-btn ${t.blocked?"on":""}"
                ?disabled=${this._savingKey!==""}
                @click=${()=>this._toggle(t)}>
                ${t.blocked?e("entrypointPeersUnblock"):e("entrypointPeersBlock")}
              </button>`:n}
        </div>
        ${t.ips?.length||t.lans?.length||t.transport||t.input_bytes||t.output_bytes?s`
            <div class="meta">
              ${t.ips?.length?s`<span>${e("entrypointPeersIPs")} ${t.ips.join(", ")}</span>`:n}
              ${t.lans?.length?s`<span>${e("entrypointPeersLANs")} ${t.lans.join(", ")}</span>`:n}
              ${t.transport?s`<span>${e("entrypointPeersTransport")} ${t.transport}</span>`:n}
              ${t.input_bytes||t.output_bytes?s`<span>${e("entrypointPeersTraffic",{in:v(t.input_bytes??0),out:v(t.output_bytes??0)})}</span>`:n}
            </div>`:n}
        ${t.disabled?s`<div class="meta warn">${e("entrypointPeersDisabledHint")}</div>`:n}
      </div>
    `}render(){return s`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}`)}>
            ${y("chevron-left")}
          </button>
          <span class="page-title">${e("entrypointPeersTitle")}</span>
        </div>

        <div class="section">
          <div class="card">
            ${this._peers.length===0?s`<div class="empty">${e("entrypointPeersEmpty")}</div>`:this._peers.map(t=>this._renderPeer(t))}
          </div>
          <div class="hint">${e("entrypointPeersHint")}</div>
          <div class="hint">${e("entrypointPeersLocalHint")}</div>
          ${this._error?s`<div class="error">${this._error}</div>`:n}
        </div>

        ${this._snackbar?s`<div class="toast">${this._snackbar}</div>`:n}
      </app-scaffold>
    `}};o.styles=g`
    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text);
      padding: 4px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
    }
    .back-btn:hover {
      background: var(--border-subtle);
    }
    .page-title {
      font-size: var(--font-md);
      font-weight: 600;
      flex: 1;
    }
    .section {
      padding: 16px;
    }
    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }
    .empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: var(--font-sm);
    }
    .peer-row {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .peer-row:last-child {
      border-bottom: none;
    }
    .row-line {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .peer-main {
      flex: 1;
      min-width: 0;
    }
    .peer-name {
      font-size: var(--font-sm);
      font-weight: 600;
    }
    .peer-key {
      margin-top: 2px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
      color: var(--text-muted);
      overflow-wrap: anywhere;
    }
    .state {
      flex: none;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      background: var(--border-subtle);
      color: var(--text-secondary);
      font-size: var(--font-xs);
    }
    .state.hub {
      color: var(--accent);
    }
    .state.blocked {
      color: var(--red);
    }
    .state.disabled {
      color: var(--text-muted);
    }
    .state.direct {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--green-text);
      background: var(--green-bg);
    }
    .state.direct svg {
      width: 12px;
      height: 12px;
    }
    .block-btn {
      flex: none;
      padding: 4px 10px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-pill);
      background: none;
      color: var(--text);
      font: inherit;
      font-size: var(--font-xs);
      cursor: pointer;
    }
    .block-btn:hover {
      background: var(--border-subtle);
    }
    .block-btn.on {
      border-color: var(--red);
      color: var(--red);
    }
    .block-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin-top: 6px;
      color: var(--text-muted);
      font-size: var(--font-xs);
      font-family: var(--font-mono, monospace);
    }
    .meta.warn {
      color: var(--text-secondary);
      font-family: inherit;
    }
    .hint {
      padding: 10px 4px 0;
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
    }
    .error {
      padding: 8px 4px 0;
      font-size: var(--font-xs);
      color: var(--red);
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      background: var(--text);
      color: var(--bg);
      padding: 8px 14px;
      border-radius: var(--radius-pill);
      font-size: var(--font-sm);
      z-index: 100;
    }
  `;l([h()],o.prototype,"entrypointType",2);l([h()],o.prototype,"entrypointId",2);l([p()],o.prototype,"_peers",2);l([p()],o.prototype,"_error",2);l([p()],o.prototype,"_savingKey",2);l([p()],o.prototype,"_snackbar",2);o=l([x("entrypoint-peers-page")],o);export{o as EntrypointPeersPage};
