import{a as l,c as s,b as p,i as d,t as v}from"./index-DvIQLlSN.js";import{T as u}from"./types-yEFWF7Vr.js";import"./app-scaffold-D-01mgFn.js";var f=Object.getOwnPropertyDescriptor,g=(a,t,c,n)=>{for(var e=n>1?void 0:n?f(t,c):t,r=a.length-1,i;r>=0;r--)(i=a[r])&&(e=i(e)||e);return e};let o=class extends l{_navigate(a){window.history.pushState({},"",a),window.dispatchEvent(new PopStateEvent("popstate"))}_iconFor(a){return{file:"📁",http:"🌐",tcp:"🔌",udp:"📡"}[a]??"🔧"}render(){return p`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>←</button>
          <span class="page-title">${s("tunnelNewTitle")}</span>
        </div>

        <div class="list">
          ${u.map(a=>p`
            <div class="type-card" @click=${()=>this._navigate(`/tunnel/${a.value}/new`)}>
              <div class="type-card-content">
                <div class="type-card-title">${this._iconFor(a.value)} ${s(`type${a.value.charAt(0).toUpperCase()+a.value.slice(1)}`)}</div>
                <div class="type-card-desc">${s(`type${a.value.charAt(0).toUpperCase()+a.value.slice(1)}Desc`)}</div>
              </div>
              <span class="type-card-arrow">→</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `}};o.styles=d`
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

    /* Type card matching prototype */
    .type-card {
      display: flex; align-items: center;
      padding: 16px 0;
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
  `;o=g([v("tunnel-type-select-page")],o);export{o as TunnelTypeSelectPage};
