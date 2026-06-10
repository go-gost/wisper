import{i as f,a as u,b as c,t as h}from"./index-C17mvF4N.js";import{n as p}from"./state-k6skofj7.js";function v(t){if(t===0)return"0 B";if(t<0)return"—";const a=["B","KB","MB","GB","TB"],r=Math.floor(Math.log(t)/Math.log(1024)),o=t/Math.pow(1024,r);return r===0?`${o} B`:`${o.toFixed(1)} ${a[r]}`}function $(t){return t===0?"0 B/s":t<0?"—":v(t)+"/s"}function w(t){return t.toLocaleString()}var x=Object.defineProperty,m=Object.getOwnPropertyDescriptor,n=(t,a,r,o)=>{for(var e=o>1?void 0:o?m(a,r):a,l=t.length-1,i;l>=0;l--)(i=t[l])&&(e=(o?i(a,r,e):i(e))||e);return o&&e&&x(a,r,e),e};let s=class extends u{constructor(){super(...arguments),this.icon="",this.value="",this.label=""}render(){return c`
      <span class="icon">${this.icon}</span>
      <span class="value">${this.value}</span>
      ${this.label?c`<span class="label">${this.label}</span>`:""}
    `}};s.styles=f`
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .icon {
      font-size: 18px;
      color: var(--color-text-muted);
      flex-shrink: 0;
      width: 20px;
      text-align: center;
    }

    .value {
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .label {
      font-size: 11px;
      color: var(--color-text-muted);
    }
  `;n([p()],s.prototype,"icon",2);n([p()],s.prototype,"value",2);n([p()],s.prototype,"label",2);s=n([h("stats-row")],s);export{$ as a,v as b,w as f};
