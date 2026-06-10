import{i as u,a as f,b as p,t as m}from"./index-DvIQLlSN.js";import{n as l}from"./app-scaffold-D-01mgFn.js";async function x(a){try{return await navigator.clipboard.writeText(a),!0}catch{const t=document.createElement("textarea");t.value=a,t.style.position="fixed",t.style.opacity="0",document.body.appendChild(t),t.select();try{return document.execCommand("copy"),!0}catch{return!1}finally{document.body.removeChild(t)}}}var y=Object.defineProperty,v=Object.getOwnPropertyDescriptor,s=(a,t,n,o)=>{for(var e=o>1?void 0:o?v(t,n):t,i=a.length-1,c;i>=0;i--)(c=a[i])&&(e=(o?c(t,n,e):c(e))||e);return o&&e&&y(t,n,e),e};let r=class extends f{constructor(){super(...arguments),this.icon="",this.value="",this.rate=""}render(){return p`
      <span class="icon">${this.icon}</span>
      <span class="value">${this.value}</span>
      ${this.rate?p`<span class="rate">${this.rate}</span>`:""}
    `}};r.styles=u`
    :host {
      display: flex;
      align-items: center;
      justify-content: var(--stats-justify, flex-start);
      gap: 8px;
      font-size: 0.9rem;
      margin-bottom: 5px;
      color: var(--color-text-primary);
      opacity: 0.85;
    }

    .icon {
      font-size: 0.95rem;
      width: 22px;
      text-align: center;
      flex-shrink: 0;
    }

    .value {
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    .rate {
      color: var(--color-stopped);
      font-size: 0.85rem;
      flex-shrink: 0;
    }
  `;s([l()],r.prototype,"icon",2);s([l()],r.prototype,"value",2);s([l()],r.prototype,"rate",2);r=s([m("stats-row")],r);export{x as c};
