import{i as s,a as d,b as l,t as c}from"./index-C17mvF4N.js";var x=Object.getOwnPropertyDescriptor,v=(n,e,p,r)=>{for(var a=r>1?void 0:r?x(e,p):e,t=n.length-1,o;t>=0;t--)(o=n[t])&&(a=o(a)||a);return a};let i=class extends d{render(){return l`
      <div class="app-bar">
        <div class="app-bar-inner">
          <slot name="appBar"></slot>
        </div>
      </div>
      <div class="container">
        <slot></slot>
      </div>
      <div class="fab-container">
        <slot name="fab"></slot>
      </div>
    `}};i.styles=s`
    :host {
      display: block;
      min-height: 100vh;
    }

    .container {
      max-width: var(--max-content-width, 800px);
      margin: 0 auto;
      padding: 0 16px 24px;
    }

    .app-bar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-divider);
      padding: 12px 0;
    }

    .app-bar-inner {
      max-width: var(--max-content-width, 800px);
      margin: 0 auto;
      padding: 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .fab-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 20;
    }

    @media (min-width: 832px) {
      .fab-container {
        right: calc(50% - 400px + 24px);
      }
    }
  `;i=v([c("app-scaffold")],i);
