import{a as y,B as x,j as a,s as $,g as h,A as b,b as l,i as w,t as k}from"./index-D6GjmlYl.js";import{c as z,a as f,b as g,n as _,r as v}from"./format-BCzS5NTS.js";import{i as c}from"./app-scaffold-DBPpxDiz.js";import{c as P}from"./clipboard-C3x8_sid.js";var C=Object.defineProperty,T=Object.getOwnPropertyDescriptor,d=(t,e,r,s)=>{for(var n=s>1?void 0:s?T(e,r):e,i=t.length-1,o;i>=0;i--)(o=t[i])&&(n=(s?o(e,r,n):o(n))||n);return s&&n&&C(e,r,n),n};function S(t){if(!/^[A-Za-z0-9_-]{43}$/.test(t))return!1;try{const e=t+"=".repeat((4-t.length%4)%4);return atob(e.replace(/-/g,"+").replace(/_/g,"/")).length===32}catch{return!1}}let p=class extends y{constructor(){super(...arguments),this.tunnelType="",this.tunnelId="",this._tunnel=null,this._rows=[],this._saved=[],this._saving=!1,this._snackbar="",this._unsub=null,this._handleSave=async()=>{if(!(this._errors().size>0||this._saving)){this._saving=!0;try{const e=await x(this.tunnelId,this._rows.map(s=>({key:s.key.trim(),alias:s.alias.trim()||void 0})));this._tunnel=e;const r=(e.options.peers??[]).map(s=>({key:s.key,alias:s.alias??""}));this._rows=r,this._saved=r.map(s=>({...s})),this._showSnackbar(a("saved"))}catch(e){const r=e instanceof Error?e.message:"";this._showSnackbar(`${a("saveFailed")}${r?": "+r:""}`)}this._saving=!1}}}connectedCallback(){super.connectedCallback(),this._load(),this._unsub=$(()=>{const t=h().find(e=>e.id===this.tunnelId);t&&(this._tunnel=t)})}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.()}_load(){const t=h().find(r=>r.id===this.tunnelId)??null;this._tunnel=t;const e=(t?.options.peers??[]).map(r=>({key:r.key,alias:r.alias??""}));this._rows=e,this._saved=e.map(r=>({...r}))}get _dirty(){return this._rows.length!==this._saved.length?!0:this._rows.some((t,e)=>t.key!==this._saved[e].key||t.alias!==this._saved[e].alias)}_errors(){const t=new Map,e=new Map;return this._rows.forEach((r,s)=>{const n=r.key.trim();if(!n){t.set(s,a("peersKeyRequired"));return}if(!S(n)){t.set(s,a("peersKeyInvalid"));return}const i=e.get(n);if(i!==void 0){t.set(s,a("peersKeyDuplicate")),t.set(i,a("peersKeyDuplicate"));return}e.set(n,s)}),t}_statFor(t){return(this._tunnel?.peer_stats??[]).find(e=>e.key===t)}_showSnackbar(t){this._snackbar=t,setTimeout(()=>{this._snackbar=""},2500)}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}render(){const t=this._errors(),e=this._tunnel?.options.peers??[],r=this._tunnel;return l`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${c("chevron-left")}
          </button>
          <span class="page-title">${a("peersTitle")}</span>
          <button class="pill-btn primary appbar-action" title="${a("btnSave")}"
            ?disabled=${this._saving||!this._dirty||t.size>0}
            @click=${this._handleSave}>
            ${c("check")}
          </button>
        </div>

        ${r?l`
            <div class="section">
              <div class="card">
                ${this._rows.length===0?l`<div class="empty">${a("peersEmpty")}</div>`:this._rows.map((s,n)=>{const i=t.get(n),o=this._statFor(s.key.trim());return l`
                        <div class="peer-row">
                          <div class="peer-inputs">
                            <input class="form-input alias" .value=${s.alias}
                              placeholder=${a("peersAliasPlaceholder")}
                              @input=${u=>{this._rows[n]={...s,alias:u.target.value},this._rows=[...this._rows]}}>
                            <input class="form-input key ${i?"invalid":""}" .value=${s.key}
                              placeholder=${a("peersKeyPlaceholder")}
                              @input=${u=>{this._rows[n]={...s,key:u.target.value},this._rows=[...this._rows]}}>
                            <button class="icon-btn" title="${a("btnCopy")}"
                              @click=${()=>P(s.key)}>
                              ${c("copy")}
                            </button>
                            <button class="icon-btn danger" title="${a("btnDelete")}"
                              @click=${()=>{this._rows=this._rows.filter((u,m)=>m!==n)}}>
                              ${c("trash")}
                            </button>
                          </div>
                          ${i?l`<div class="row-error">${i}</div>`:o?l`
                                <div class="peer-stats">
                                  <span>${z(o.current_conns)} ${a("p2pColConns")}</span>
                                  <span>↓ ${f(o.output_bytes)}
                                    <span class="rate">${g(o.output_rate_bytes)}</span></span>
                                  <span>↑ ${f(o.input_bytes)}
                                    <span class="rate">${g(o.input_rate_bytes)}</span></span>
                                </div>`:l`<div class="peer-stats muted">${a("peersNoTraffic")}</div>`}
                        </div>
                      `})}

                <button class="add-row" @click=${()=>{this._rows=[...this._rows,{key:"",alias:""}]}}>
                  ${c("plus")} ${a("peersAdd")}
                </button>
              </div>

              <div class="hint">${a("peersHint")}</div>
              <div class="hint">${a("peersRestartHint")}</div>
              ${e.length===0?l`<div class="hint">${a("peersNoneHint")}</div>`:b}
            </div>
          `:l`<div class="section"><div class="card"><div class="empty">${a("notFound")}</div></div></div>`}

        ${this._snackbar?l`<div class="toast">${this._snackbar}</div>`:b}
      </app-scaffold>
    `}};p.styles=w`
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
    .pill-btn {
      padding: 5px 14px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-weight: 500;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pill-btn.primary {
      background: var(--accent);
      color: var(--accent-fg);
    }
    .pill-btn svg {
      width: 14px;
      height: 14px;
    }
    .pill-btn:hover {
      opacity: 0.85;
    }
    .pill-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .pill-btn.appbar-action {
      margin-left: auto;
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
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .peer-inputs {
      display: grid;
      grid-template-columns: 1fr 2fr auto auto;
      gap: 8px;
      align-items: center;
    }
    .form-input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-subtle);
      background: var(--bg);
      color: var(--text);
      font-size: var(--font-sm);
      font-family: inherit;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--accent);
    }
    .form-input.key {
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
    }
    .form-input.invalid {
      border-color: var(--red);
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
    .icon-btn.danger:hover {
      color: var(--red);
    }
    .icon-btn svg {
      width: 14px;
      height: 14px;
    }
    .row-error {
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--red);
    }
    .peer-stats {
      display: flex;
      gap: 16px;
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .peer-stats.muted {
      font-style: italic;
    }
    .peer-stats .rate {
      color: var(--text-muted);
      opacity: 0.8;
    }

    .add-row {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 12px 14px;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      font-family: inherit;
    }
    .add-row:hover {
      background: var(--border-subtle);
    }
    .add-row svg {
      width: 14px;
      height: 14px;
    }

    .hint {
      padding: 10px 4px 0;
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
    }

    .toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 8px 16px;
      font-size: var(--font-sm);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }
  `;d([_()],p.prototype,"tunnelType",2);d([_()],p.prototype,"tunnelId",2);d([v()],p.prototype,"_tunnel",2);d([v()],p.prototype,"_rows",2);d([v()],p.prototype,"_saving",2);d([v()],p.prototype,"_snackbar",2);p=d([k("tunnel-peers-page")],p);export{p as TunnelPeersPage};
