import{A as d,B as h,i as u,a as f,b as v,t as b}from"./index-DvIQLlSN.js";/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const g={attribute:!0,type:String,converter:h,reflect:!1,hasChanged:d},x=(t=g,a,r)=>{const{kind:s,metadata:e}=r;let o=globalThis.litPropertyMetadata.get(e);if(o===void 0&&globalThis.litPropertyMetadata.set(e,o=new Map),s==="setter"&&((t=Object.create(t)).wrapped=!0),o.set(r.name,t),s==="accessor"){const{name:n}=r;return{set(i){const l=a.get.call(this);a.set.call(this,i),this.requestUpdate(n,l,t,!0,i)},init(i){return i!==void 0&&this.C(n,void 0,t,i),i}}}if(s==="setter"){const{name:n}=r;return function(i){const l=this[n];a.call(this,i),this.requestUpdate(n,l,t,!0,i)}}throw Error("Unsupported decorator location: "+s)};function m(t){return(a,r)=>typeof r=="object"?x(t,a,r):((s,e,o)=>{const n=e.hasOwnProperty(o);return e.constructor.createProperty(o,s),n?Object.getOwnPropertyDescriptor(e,o):void 0})(t,a,r)}/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */function y(t){return m({...t,state:!0,attribute:!1})}var _=Object.defineProperty,w=Object.getOwnPropertyDescriptor,c=(t,a,r,s)=>{for(var e=s>1?void 0:s?w(a,r):a,o=t.length-1,n;o>=0;o--)(n=t[o])&&(e=(s?n(a,r,e):n(e))||e);return s&&e&&_(a,r,e),e};let p=class extends f{constructor(){super(...arguments),this._hasAppBar=!1}_onAppBarSlotChange(t){const a=t.target;this._hasAppBar=a.assignedNodes().length>0}render(){return v`
      <div class="shell">
        <div class="app-bar" style="${this._hasAppBar?"":"display:none;"}">
          <slot name="appBar" @slotchange=${this._onAppBarSlotChange}></slot>
        </div>
        <div class="content">
          <slot></slot>
        </div>
        <div class="fab-container">
          <slot name="fab"></slot>
        </div>
      </div>
    `}};p.styles=u`
    :host {
      display: block;
      min-height: 100vh;
    }

    .shell {
      max-width: var(--max-content-width, 1200px);
      margin: 0 auto;
      min-height: 100vh;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .app-bar {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: var(--color-appbar-bg);
      box-shadow: var(--color-appbar-shadow);
      position: sticky;
      top: 0;
      z-index: 10;
      gap: 8px;
      transition: background var(--transition-fast);
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .fab-container {
      position: absolute;
      bottom: 24px;
      right: 24px;
      z-index: 20;
    }
  `;c([y()],p.prototype,"_hasAppBar",2);p=c([b("app-scaffold")],p);export{m as n,y as r};
