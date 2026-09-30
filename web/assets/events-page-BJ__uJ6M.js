import{a as h,G as f,o as m,c as e,A as b,b as s,i as u,t as _}from"./index-DxovVP7w.js";import{d as g,f as x,n as p,r as v}from"./format-Drw40smI.js";import{i as k}from"./app-scaffold-BlWqbruY.js";var y=Object.defineProperty,$=Object.getOwnPropertyDescriptor,o=(t,n,a,l)=>{for(var i=l>1?void 0:l?$(n,a):n,d=t.length-1,c;d>=0;d--)(c=t[d])&&(i=(l?c(n,a,i):c(i))||i);return l&&i&&y(n,a,i),i};let r=class extends h{constructor(){super(...arguments),this.kind="tunnel",this.parentType="",this.parentId="",this._events=[],this._error="",this._confirmClear=!1,this._backend=new f,this._timer=null}connectedCallback(){super.connectedCallback(),this._load(),this._arm()}disconnectedCallback(){super.disconnectedCallback(),this._timer!==null&&(clearTimeout(this._timer),this._timer=null)}_arm(){const t=m().stats_interval||3;this._timer=setTimeout(()=>{this._load(),this._arm()},t*1e3)}async _load(){try{if(this.kind==="global")this._events=(await this._backend.getEvents()).events??[];else{const t=this.kind==="tunnel"?await this._backend.getTunnel(this.parentId):await this._backend.getEntrypoint(this.parentId);this._events=t.events??[]}this._error=""}catch(t){this._error=t instanceof Error?t.message:String(t)}}async _clear(){this._confirmClear=!1;try{await this._backend.clearEvents(),this._events=[]}catch(t){this._error=t instanceof Error?t.message:String(t)}}get _title(){return this.kind==="global"?e("eventsGlobalTitle"):this.kind==="entrypoint"?e("eventsEntrypointTitle"):e("eventsTunnelTitle")}get _backPath(){return this.kind==="global"?"/settings":`/${this.kind}/${this.parentType}/${this.parentId}`}_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}_levelLabel(t){return t==="error"?e("eventsLevelError"):t==="warn"?e("eventsLevelWarn"):e("eventsLevelInfo")}_timeLabel(t){const n=g(t.time),a=x(t.time);return n?a?`${n} · ${a}`:n:a}render(){return s`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate(this._backPath)}>
            ${k("chevron-left")}
          </button>
          <span class="page-title">${this._title}</span>
          ${this.kind==="global"&&this._events.length?s`<button class="clear-btn" @click=${()=>this._confirmClear=!0}>
                ${e("eventsClear")}
              </button>`:b}
        </div>

        ${this._error?s`<div class="empty">${this._error}</div>`:this._events.length===0?s`<div class="empty">${e("eventsEmpty")}</div>`:s`${this._renderRows()}`}
      </app-scaffold>
    `}_renderRows(){return s`
      ${this._confirmClear?s`<div class="confirm">
            <span>${e("eventsClearConfirm")}</span>
            <button @click=${()=>this._clear()}>${e("eventsClear")}</button>
            <button @click=${()=>this._confirmClear=!1}>${e("btnCancel")}</button>
          </div>`:b}
      ${this._events.map(t=>s`
          <div class="row">
            <span class="dot ${t.level}" title=${this._levelLabel(t.level)}></span>
            <div class="body">
              <div class="message">${t.message}</div>
              <div class="time">${this._timeLabel(t)}</div>
            </div>
          </div>
        `)}
    `}};r.styles=u`
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
  `;o([p()],r.prototype,"kind",2);o([p()],r.prototype,"parentType",2);o([p()],r.prototype,"parentId",2);o([v()],r.prototype,"_events",2);o([v()],r.prototype,"_error",2);o([v()],r.prototype,"_confirmClear",2);r=o([_("events-page")],r);export{r as EventsPage};
