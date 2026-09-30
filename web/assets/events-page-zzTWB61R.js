import{a as u,G as h,o as f,c as r,A as p,b as n,i as m,t as _}from"./index-L3Lxevst.js";import{d as g,f as x,n as v,r as b}from"./format-DKxhd83r.js";import{i as k}from"./app-scaffold-BwBTwIN2.js";var y=Object.defineProperty,$=Object.getOwnPropertyDescriptor,o=(t,e,a,l)=>{for(var i=l>1?void 0:l?$(e,a):e,d=t.length-1,c;d>=0;d--)(c=t[d])&&(i=(l?c(e,a,i):c(i))||i);return l&&i&&y(e,a,i),i};let s=class extends u{constructor(){super(...arguments),this.kind="tunnel",this.parentType="",this.parentId="",this._events=[],this._error="",this._confirmClear=!1,this._backend=new h,this._timer=null}connectedCallback(){super.connectedCallback(),this._load(),this._arm()}disconnectedCallback(){super.disconnectedCallback(),this._timer!==null&&(clearTimeout(this._timer),this._timer=null)}_arm(){const t=f().stats_interval||3;this._timer=setTimeout(()=>{this._load(),this._arm()},t*1e3)}async _load(){try{if(this.kind==="global")this._events=(await this._backend.getEvents()).events??[];else{const t=this.kind==="tunnel"?await this._backend.getTunnel(this.parentId):await this._backend.getEntrypoint(this.parentId);this._events=t.events??[]}this._error=""}catch(t){this._error=t instanceof Error?t.message:String(t)}}async _clear(){this._confirmClear=!1;try{await this._backend.clearEvents(),this._events=[]}catch(t){this._error=t instanceof Error?t.message:String(t)}}get _title(){return this.kind==="global"?r("eventsGlobalTitle"):this.kind==="entrypoint"?r("eventsEntrypointTitle"):r("eventsTunnelTitle")}get _backPath(){return this.kind==="global"?"/settings":`/${this.kind}/${this.parentType}/${this.parentId}`}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_levelLabel(t){return t==="error"?r("eventsLevelError"):t==="warn"?r("eventsLevelWarn"):r("eventsLevelInfo")}_timeLabel(t){const e=g(t.time),a=x(t.time);return e?a?`${e} · ${a}`:e:a}_renderCount(t){const e=t.count||1;return e<=1?p:n`<span class="count">×${e}</span>`}render(){return n`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(this._backPath)}>
            ${k("chevron-left")}
          </button>
          <span class="page-title">${this._title}</span>
          ${this.kind==="global"&&this._events.length?n`<button class="clear-btn" @click=${()=>this._confirmClear=!0}>
                ${r("eventsClear")}
              </button>`:p}
        </div>

        ${this._error?n`<div class="empty">${this._error}</div>`:this._events.length===0?n`<div class="empty">${r("eventsEmpty")}</div>`:n`${this._renderRows()}`}
      </app-scaffold>
    `}_renderRows(){return n`
      ${this._confirmClear?n`<div class="confirm">
            <span>${r("eventsClearConfirm")}</span>
            <button @click=${()=>this._clear()}>${r("eventsClear")}</button>
            <button @click=${()=>this._confirmClear=!1}>${r("btnCancel")}</button>
          </div>`:p}
      ${this._events.map(t=>n`
          <div class="row">
            <span class="dot ${t.level}" title=${this._levelLabel(t.level)}></span>
            <div class="body">
              <div class="message">${t.message}${this._renderCount(t)}</div>
              <div class="time">${this._timeLabel(t)}</div>
            </div>
          </div>
        `)}
    `}};s.styles=m`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }
    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }
    .clear-btn {
      background: none; border: none; cursor: pointer; color: var(--accent);
      font-family: inherit; font-size: var(--font-sm); padding: 4px 8px;
      border-radius: var(--radius-sm);
    }
    .clear-btn:hover { background: var(--border-subtle); }
    .row {
      display: flex; align-items: baseline; gap: 10px; padding: 10px 16px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; margin-top: 5px; }
    .dot.info { background: var(--text-muted); }
    .dot.warn { background: #d29922; }
    .dot.error { background: #f85149; }
    .body { flex: 1; min-width: 0; }
    .message { font-size: var(--font-sm); color: var(--text); word-break: break-word; }
    .count {
      margin-left: 6px; padding: 1px 6px; border-radius: var(--radius-pill);
      background: var(--border-subtle); color: var(--text-muted);
      font-size: var(--font-xs); white-space: nowrap;
    }
    .time { font-size: var(--font-xs); color: var(--text-muted); white-space: nowrap; }
    .empty {
      display: flex; align-items: center; justify-content: center;
      padding: 64px 24px; color: var(--text-muted); font-size: var(--font-md);
    }
    .confirm {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px;
      background: var(--border-subtle); font-size: var(--font-sm);
    }
    .confirm button {
      font-family: inherit; font-size: var(--font-sm); padding: 4px 10px;
      border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);
      background: var(--surface); color: var(--text); cursor: pointer;
    }
  `;o([v()],s.prototype,"kind",2);o([v()],s.prototype,"parentType",2);o([v()],s.prototype,"parentId",2);o([b()],s.prototype,"_events",2);o([b()],s.prototype,"_error",2);o([b()],s.prototype,"_confirmClear",2);s=o([_("events-page")],s);export{s as EventsPage};
