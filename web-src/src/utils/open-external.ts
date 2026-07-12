/**
 * Open external links in the system browser.
 *
 * The app ships three shells that embed the web UI, and each handles
 * cross-origin links differently:
 *  - Android (run.gost.wisper): a custom WebView whose WebViewClient never
 *    launches the system browser, so we hand URLs to the native bridge
 *    (window.WisperNative.openExternal → ACTION_VIEW intent).
 *  - Desktop (Tauri 2): the WebView drops target="_blank" links (it neither
 *    spawns a new in-app window nor opens the OS browser), so we route them
 *    through a Tauri command that delegates to the OS default handler. As a
 *    belt-and-suspenders fallback, the Rust side also intercepts any
 *    new-window request via WebviewWindowBuilder::on_new_window.
 *  - Plain browser: neither bridge exists, so we leave the event alone and
 *    let the normal <a> behavior open the link in a new tab.
 *
 * Only cross-origin http(s) anchors are intercepted; same-origin links are
 * handled in-app by the router, and modifier-clicks keep their native
 * behavior (open-in-new-tab, etc.).
 *
 * Tauri communication uses window.__TAURI_INTERNALS__.invoke directly rather
 * than importing @tauri-apps/api. __TAURI_INTERNALS__ is injected into every
 * Tauri webview unconditionally (Tauri's manager injects it into the main
 * frame of all webviews), so the invoke function is always present — no
 * dynamic module import, no capability permission, no runtime race.
 */
export function initExternalLinkInterceptor(): void {
  const handler = resolveHandler();
  if (!handler) return;

  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }

      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href') ?? '';
      if (!isExternal(href)) return;

      // Stop the WebView from trying to open an in-app window for this link.
      // (If we didn't preventDefault, Tauri's on_new_window fallback would
      // still catch the request, but doing it here avoids a double-open.)
      e.preventDefault();
      void handler(href);
    },
    // Capture phase so we act before the WebView's own link handling.
    true
  );
}

type LinkHandler = (href: string) => void | Promise<void>;

/** Pick the right external-link handler for the current shell, or null. */
function resolveHandler(): LinkHandler | null {
  // Android: native JsBridge (highest priority — only exists there).
  const bridge = (window as any).WisperNative;
  if (bridge?.openExternal) {
    return (href) => bridge.openExternal(href);
  }

  // Desktop Tauri: the webview's injected __TAURI_INTERNALS__ exposes invoke
  // unconditionally (no import, no permission). It routes to our open_external
  // command, which opens the URL via the OS default handler.
  if (isTauri()) {
    const internals = (window as any).__TAURI_INTERNALS__;
    if (internals?.invoke) {
      return (href) => internals.invoke('open_external', { url: href });
    }
  }

  return null;
}

/** True when running inside a Tauri WebView (injected on every Tauri window). */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isExternal(href: string): boolean {
  try {
    const u = new URL(href, location.href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Only open links pointing off the app's own origin (the Go backend).
    // Same-origin links are handled in-app by the router.
    return u.host !== location.host;
  } catch {
    return false;
  }
}
