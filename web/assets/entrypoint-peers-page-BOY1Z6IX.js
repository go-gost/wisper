import{a as h,G as y,c as e,A as d,b as s,i as f,t as u}from"./index-CEUsOWja.js";import{m as x,n as v,r as c}from"./format-dBntRaRm.js";import{i as g}from"./app-scaffold-DLIWzTpn.js";var m=Object.defineProperty,_=Object.getOwnPropertyDescriptor,l=(t,n,o,r)=>{for(var i=r>1?void 0:r?_(n,o):n,p=t.length-1,b;p>=0;p--)(b=t[p])&&(i=(r?b(n,o,i):b(i))||i);return r&&i&&m(n,o,i),i};let a=class extends h{constructor(){super(...arguments),this.entrypointType="",this.entrypointId="",this._peers=[],this._error="",this._savingKey="",this._snackbar="",this._backend=new y,this._poll=0}connectedCallback(){super.connectedCallback(),this._load(),this._poll=window.setInterval(()=>void this._load(),5e3)}disconnectedCallback(){window.clearInterval(this._poll),this._poll=0,super.disconnectedCallback()}async _load(){try{const t=await this._backend.listEntrypointPeers(this.entrypointId);this._peers=t.peers??[],this._error=""}catch(t){this._error=t instanceof Error?t.message:""}}async _toggle(t){if(t.state==="hub"||this._savingKey)return;const n=this._peers.filter(r=>r.blocked).map(r=>r.key),o=t.blocked?n.filter(r=>r!==t.key):[...n,t.key];this._savingKey=t.key,this._error="";try{const r=await this._backend.updateEntrypointPeers(this.entrypointId,o);this._peers=r.peers??[],this._showSnackbar(e("saved"))}catch(r){this._error=r instanceof Error?r.message:""}finally{this._savingKey=""}}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar=""},2500)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_stateLabel(t){switch(t.state){case"hub":return e("entrypointPeersStateHub");case"blocked":return e("entrypointPeersStateBlocked");case"disabled":return e("entrypointPeersStateDisabled");case"direct-off":return e("entrypointPeersStateDirectOff");case"direct":return e("entrypointPeersStateDirect");case"connecting":return e("entrypointPeersStateConnecting");default:return t.state}}_renderPeer(t){const n=t.state!=="hub",o=t.name||e("peersNoAlias");return s`
      <div class="peer-row">
        <div class="row-line">
          <div class="peer-main">
            <div class="peer-name">${o}</div>
            <div class="peer-key">${x(t.key)}</div>
          </div>
          <span class="state ${t.state}">${this._stateLabel(t)}</span>
          ${n?s`
              <button class="block-btn ${t.blocked?"on":""}"
                ?disabled=${this._savingKey!==""}
                @click=${()=>this._toggle(t)}>
                ${t.blocked?e("entrypointPeersUnblock"):e("entrypointPeersBlock")}
              </button>`:d}
        </div>
        ${t.ips?.length||t.lans?.length?s`
            <div class="meta">
              ${t.ips?.length?s`<span>${e("entrypointPeersIPs")} ${t.ips.join(", ")}</span>`:d}
              ${t.lans?.length?s`<span>${e("entrypointPeersLANs")} ${t.lans.join(", ")}</span>`:d}
            </div>`:d}
        ${t.disabled?s`<div class="meta warn">${e("entrypointPeersDisabledHint")}</div>`:d}
      </div>
    `}render(){return s`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}`)}>
            ${g("chevron-left")}
          </button>
          <span class="page-title">${e("entrypointPeersTitle")}</span>
        </div>

        <div class="section">
          <div class="card">
            ${this._peers.length===0?s`<div class="empty">${e("entrypointPeersEmpty")}</div>`:this._peers.map(t=>this._renderPeer(t))}
          </div>
          <div class="hint">${e("entrypointPeersHint")}</div>
          <div class="hint">${e("entrypointPeersLocalHint")}</div>
          ${this._error?s`<div class="error">${this._error}</div>`:d}
        </div>

        ${this._snackbar?s`<div class="toast">${this._snackbar}</div>`:d}
      </app-scaffold>
    `}};a.styles=f`
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
  `;l([v()],a.prototype,"entrypointType",2);l([v()],a.prototype,"entrypointId",2);l([c()],a.prototype,"_peers",2);l([c()],a.prototype,"_error",2);l([c()],a.prototype,"_savingKey",2);l([c()],a.prototype,"_snackbar",2);a=l([u("entrypoint-peers-page")],a);export{a as EntrypointPeersPage};
