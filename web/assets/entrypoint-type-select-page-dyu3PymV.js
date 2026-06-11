import{a as v,j as r,b as c,i as u,t as g}from"./index-BxnSyTkH.js";import{i as s}from"./app-scaffold-8MQz_NNd.js";import{E as b}from"./types-yEFWF7Vr.js";var f=Object.getOwnPropertyDescriptor,y=(t,o,l,n)=>{for(var e=n>1?void 0:n?f(o,l):o,a=t.length-1,p;a>=0;a--)(p=t[a])&&(e=p(e)||e);return e};const x={tcp:"link",udp:"broadcast"},d={tcp:{bg:"#fef2f2",fg:"#dc2626"},udp:{bg:"#fefce8",fg:"#d97706"}};let i=class extends v{_navigate(t){window.history.pushState({},"",t),window.dispatchEvent(new PopStateEvent("popstate"))}render(){return c`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${s("chevron-left")}
          </button>
          <span class="page-title">${r("entrypointNewTitle")}</span>
        </div>

        <div class="list">
          ${b.map(t=>c`
            <div class="type-card" @click=${()=>this._navigate(`/entrypoint/${t.value}/new`)}>
              <div class="type-icon" style="background:${d[t.value].bg};color:${d[t.value].fg}">${s(x[t.value])}</div>
              <div class="type-content">
                <div class="type-title">
                  ${r(`type${t.value.charAt(0).toUpperCase()+t.value.slice(1)}`)} Entrypoint
                </div>
                <div class="type-desc">
                  ${r(`type${t.value.charAt(0).toUpperCase()+t.value.slice(1)}EntryDesc`)}
                </div>
              </div>
              <span class="type-arrow">${s("chevron-right")}</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `}};i.styles=u`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: 13px; font-weight: 600; }

    .list {
      padding: 8px 16px 0;
      display: flex; flex-direction: column;
    }

    .type-card {
      display: flex; align-items: center;
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      margin-bottom: 12px;
      padding: 16px;
      cursor: pointer;
      transition: background var(--transition-fast), box-shadow var(--transition-fast);
      gap: 12px;
    }
    .type-card:hover {
      background: var(--border-subtle);
      box-shadow: var(--shadow-card-hover);
    }
    .type-card:active { transform: scale(0.99); }

    .type-icon {
      width: 36px; height: 36px;
      border-radius: var(--radius-md);
      background: var(--border-subtle);
      display: flex; align-items: center; justify-content: center;
      color: var(--text-secondary); flex-shrink: 0;
    }

    .type-content { flex: 1; min-width: 0; }
    .type-title { font-size: 13px; font-weight: 600; color: var(--text); }
    .type-desc { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

    .type-arrow {
      color: var(--text-muted); flex-shrink: 0;
    }
  `;i=y([g("entrypoint-type-select-page")],i);export{i as EntrypointTypeSelectPage};
