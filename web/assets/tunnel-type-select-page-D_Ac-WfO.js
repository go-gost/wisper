import{a as f,c as r,b as l,i as v,t as g}from"./index-hTjUfwUS.js";import{i as s}from"./app-scaffold-CVcSx0W_.js";import{t as u}from"./type-icons-DsI-rt1W.js";import{T as b}from"./types-DwVOrt_K.js";var y=Object.getOwnPropertyDescriptor,x=(e,o,d,i)=>{for(var t=i>1?void 0:i?y(o,d):o,a=e.length-1,c;a>=0;a--)(c=e[a])&&(t=c(t)||t);return t};const p={file:{bg:"#ecfdf5",fg:"#059669"},http:{bg:"#eff6ff",fg:"#3b82f6"},tcp:{bg:"#fef2f2",fg:"#dc2626"},udp:{bg:"#fefce8",fg:"#d97706"},p2p:{bg:"#f5f3ff",fg:"#7c3aed"},tun:{bg:"#ecfeff",fg:"#0e7490"}};let n=class extends f{_navigate(e){window.history.pushState({},"",e),window.dispatchEvent(new PopStateEvent("popstate"))}render(){return l`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${()=>this._navigate("/")}>
            ${s("chevron-left")}
          </button>
          <span class="page-title">${r("tunnelNewTitle")}</span>
        </div>

        <div class="list">
          ${b.map(e=>l`
            <div class="type-card" @click=${()=>this._navigate(`/tunnel/${e.value}/new`)}>
              <div class="type-icon" style="background:${p[e.value].bg};color:${p[e.value].fg}">${s(u(e.value))}</div>
              <div class="type-content">
                <div class="type-title">
                  ${r(`type${e.value.charAt(0).toUpperCase()+e.value.slice(1)}`)} Tunnel
                </div>
                <div class="type-desc">
                  ${r(`type${e.value.charAt(0).toUpperCase()+e.value.slice(1)}Desc`)}
                </div>
              </div>
              <span class="type-arrow">${s("chevron-right")}</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `}};n.styles=v`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: var(--font-md); font-weight: 600; }

    /* ── Type cards ── */
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
  `;n=x([g("tunnel-type-select-page")],n);export{n as TunnelTypeSelectPage};
