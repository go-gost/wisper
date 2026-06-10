import{a as d,c as r,b as p,i as l,t as v}from"./index-DvIQLlSN.js";import{E as y}from"./types-yEFWF7Vr.js";import"./app-scaffold-D-01mgFn.js";var f=Object.getOwnPropertyDescriptor,g=(a,o,c,i)=>{for(var t=i>1?void 0:i?f(o,c):o,e=a.length-1,n;e>=0;e--)(n=a[e])&&(t=n(t)||t);return t};let s=class extends d{_navigate(a){window.history.pushState({},"",a),window.dispatchEvent(new PopStateEvent("popstate"))}render(){return p`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>←</button>
          <span class="page-title">${r("entrypointNewTitle")}</span>
        </div>

        <div class="list">
          ${y.map(a=>p`
            <div class="type-card" @click=${()=>this._navigate(`/entrypoint/${a.value}/new`)}>
              <div class="type-card-content">
                <div class="type-card-title">${a.value==="tcp"?"🔌":"📡"} ${r(`type${a.value.charAt(0).toUpperCase()+a.value.slice(1)}`)}</div>
                <div class="type-card-desc">${r(`type${a.value.charAt(0).toUpperCase()+a.value.slice(1)}EntryDesc`)}</div>
              </div>
              <span class="type-card-arrow">→</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `}};s.styles=l`
    .back-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.3rem; color: var(--color-text-primary); padding: 4px 8px;
      border-radius: 8px; display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--color-surface-variant); }
    .page-title { font-size: 1.15rem; font-weight: 600; }

    .list {
      display: flex; flex-direction: column; gap: 0;
      padding: 8px 16px 0;
    }

    .type-card {
      display: flex; align-items: center;
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-card);
      margin-bottom: 16px;
      padding: 16px 24px;
      cursor: pointer;
      transition: background var(--transition-fast), box-shadow var(--transition-fast), transform 0.1s;
    }
    .type-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-card-hover); }
    .type-card:active { transform: translateY(0); }

    .type-card-content { flex: 1; }
    .type-card-title { font-weight: 600; font-size: 1rem; margin-bottom: 4px; }
    .type-card-desc { color: var(--color-stopped); font-size: 0.85rem; }
    .type-card-arrow { font-size: 1.2rem; color: var(--color-stopped); }
  `;s=g([v("entrypoint-type-select-page")],s);export{s as EntrypointTypeSelectPage};
