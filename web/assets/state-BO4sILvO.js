import{A as u,B as l}from"./index-kdEhv3kp.js";/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const p={attribute:!0,type:String,converter:l,reflect:!1,hasChanged:u},d=(t=p,s,r)=>{const{kind:a,metadata:i}=r;let n=globalThis.litPropertyMetadata.get(i);if(n===void 0&&globalThis.litPropertyMetadata.set(i,n=new Map),a==="setter"&&((t=Object.create(t)).wrapped=!0),n.set(r.name,t),a==="accessor"){const{name:o}=r;return{set(e){const c=s.get.call(this);s.set.call(this,e),this.requestUpdate(o,c,t,!0,e)},init(e){return e!==void 0&&this.C(o,void 0,t,e),e}}}if(a==="setter"){const{name:o}=r;return function(e){const c=this[o];s.call(this,e),this.requestUpdate(o,c,t,!0,e)}}throw Error("Unsupported decorator location: "+a)};function h(t){return(s,r)=>typeof r=="object"?d(t,s,r):((a,i,n)=>{const o=i.hasOwnProperty(n);return i.constructor.createProperty(n,a),o?Object.getOwnPropertyDescriptor(i,n):void 0})(t,s,r)}/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */function b(t){return h({...t,state:!0,attribute:!1})}export{h as n,b as r};
