import { Router } from '@lit-labs/router';
import type { ReactiveControllerHost } from 'lit';
import { html } from 'lit';

// Lazy imports — Vite code-splits these automatically.
const homePage = () => import('../pages/home-page');
const tunnelTypeSelectPage = () => import('../pages/tunnel-type-select-page');
const tunnelDetailPage = () => import('../pages/tunnel-detail-page');
const entrypointTypeSelectPage = () => import('../pages/entrypoint-type-select-page');
const entrypointDetailPage = () => import('../pages/entrypoint-detail-page');
const settingsPage = () => import('../pages/settings-page');

/**
 * Create the Lit router with all application routes.
 * Each route renders a placeholder element that activates the corresponding
 * page component. The pages handle their own data fetching.
 *
 * @param host - The Lit element that hosts the router (must be a ReactiveControllerHost).
 */
export function createRouter(host: ReactiveControllerHost) {
  return new Router(
    host,
    [
      {
        path: '/',
        render: () => html`<home-page></home-page>`,
        enter: async () => {
          await homePage();
          return true;
        },
      },
      {
        path: '/tunnel/new',
        render: () => html`<tunnel-type-select-page></tunnel-type-select-page>`,
        enter: async () => {
          await tunnelTypeSelectPage();
          return true;
        },
      },
      {
        path: '/tunnel/:type/:id',
        render: (params: { type?: string; id?: string }) =>
          html`<tunnel-detail-page
            .tunnelType=${params.type ?? ''}
            .tunnelId=${params.id ?? ''}
          ></tunnel-detail-page>`,
        enter: async () => {
          await tunnelDetailPage();
          return true;
        },
      },
      {
        path: '/entrypoint/new',
        render: () => html`<entrypoint-type-select-page></entrypoint-type-select-page>`,
        enter: async () => {
          await entrypointTypeSelectPage();
          return true;
        },
      },
      {
        path: '/entrypoint/:type/:id',
        render: (params: { type?: string; id?: string }) =>
          html`<entrypoint-detail-page
            .entrypointType=${params.type ?? ''}
            .entrypointId=${params.id ?? ''}
          ></entrypoint-detail-page>`,
        enter: async () => {
          await entrypointDetailPage();
          return true;
        },
      },
      {
        path: '/settings',
        render: () => html`<settings-page></settings-page>`,
        enter: async () => {
          await settingsPage();
          return true;
        },
      },
    ],
  );
}
