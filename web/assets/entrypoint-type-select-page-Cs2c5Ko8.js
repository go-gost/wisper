import{a as l,c as r,b as p,i as d,t as v}from"./index-C17mvF4N.js";import{E as y}from"./types-yEFWF7Vr.js";import"./app-scaffold-DRHJfar-.js";var x=Object.getOwnPropertyDescriptor,f=(e,i,c,s)=>{for(var t=s>1?void 0:s?x(i,c):i,a=e.length-1,n;a>=0;a--)(n=e[a])&&(t=n(t)||t);return t};let o=class extends l{_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}render(){return p`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>←</button>
          <span class="page-title">${r("entrypointNewTitle")}</span>
        </div>

        <div class="list">
          ${y.map(e=>p`
            <div class="type-card" @click=${()=>this._navigate(`/entrypoint/${e.value}/new`)}>
              <div class="type-info">
                <div class="type-icon">${e.value==="tcp"?"🔌":"📡"}</div>
                <div>
                  <div class="type-label">${r(`type${e.value.charAt(0).toUpperCase()+e.value.slice(1)}`)}</div>
                  <div class="type-desc">${r(`type${e.value.charAt(0).toUpperCase()+e.value.slice(1)}EntryDesc`)}</div>
                </div>
              </div>
              <span class="chevron">›</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `}};o.styles=d`
    .page-title {
      font-size: 18px;
      font-weight: 600;
    }

    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
      color: var(--color-text-secondary);
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .back-btn:hover {
      background: var(--color-surface-hover);
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }

    .type-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all var(--transition-fast);
      box-shadow: var(--shadow-card);
    }

    .type-card:hover {
      box-shadow: var(--shadow-card-hover);
    }

    .type-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .type-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      background: var(--color-surface-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .type-label {
      font-weight: 600;
      font-size: 15px;
      color: var(--color-text-primary);
    }

    .type-desc {
      font-size: 13px;
      color: var(--color-text-muted);
      margin-top: 2px;
    }

    .chevron {
      color: var(--color-text-muted);
      font-size: 18px;
    }
  `;o=f([v("entrypoint-type-select-page")],o);export{o as EntrypointTypeSelectPage};
