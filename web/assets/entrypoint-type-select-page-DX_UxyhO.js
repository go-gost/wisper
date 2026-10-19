import{a as v,c as r,b as c,i as f,t as g}from"./index-Ji9QB8CQ.js";import{i as s}from"./app-scaffold-Csr5z4Yq.js";import{t as u}from"./type-icons-DsI-rt1W.js";import{E as b}from"./types-DwVOrt_K.js";var y=Object.getOwnPropertyDescriptor,x=(e,i,l,n)=>{for(var t=n>1?void 0:n?y(i,l):i,a=e.length-1,p;a>=0;a--)(p=e[a])&&(t=p(t)||t);return t};const d={tcp:{bg:"#fef2f2",fg:"#dc2626"},udp:{bg:"#fefce8",fg:"#d97706"},p2p:{bg:"#f5f3ff",fg:"#7c3aed"},tun:{bg:"#ecfeff",fg:"#0e7490"}};let o=class extends v{_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}render(){return c`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${s("chevron-left")}
          </button>
          <span class="page-title">${r("entrypointNewTitle")}</span>
        </div>

        <div class="list">
          ${b.map(e=>c`
            <div class="type-card" @click=${()=>this._navigate(`/entrypoint/${e.value}/new`)}>
              <div class="type-icon" style="background:${d[e.value].bg};color:${d[e.value].fg}">${s(u(e.value))}</div>
              <div class="type-content">
                <div class="type-title">
                  ${r(`type${e.value.charAt(0).toUpperCase()+e.value.slice(1)}`)} Entrypoint
                </div>
                <div class="type-desc">
                  ${r(`type${e.value.charAt(0).toUpperCase()+e.value.slice(1)}EntryDesc`)}
                </div>
              </div>
              <span class="type-arrow">${s("chevron-right")}</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `}};o.styles=f`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: var(--font-md); font-weight: 600; }

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
    .type-title { font-size: var(--font-md); font-weight: 600; color: var(--text); }
    .type-desc { font-size: var(--font-sm); color: var(--text-muted); margin-top: 2px; }

    .type-arrow {
      color: var(--text-muted); flex-shrink: 0;
    }
  `;o=x([g("entrypoint-type-select-page")],o);export{o as EntrypointTypeSelectPage};
