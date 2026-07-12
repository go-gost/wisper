/**
 * Open external links in the system browser on Android.
 *
 * The Android app renders the web UI inside a custom WebView (run.gost.wisper)
 * whose WebViewClient never launches the system browser for external links.
 * Links with target="_blank" are silently dropped by the WebView. We intercept
 * clicks on cross-origin http(s) anchors and hand the URL to the native bridge
 * (window.WisperNative.openExternal), which starts an ACTION_VIEW intent.
 *
 * This is a no-op in every other context (desktop Tauri shell, plain browser):
 * window.WisperNative only exists in the Android shell, so when it's absent we
 * leave the event alone and let the normal <a> behavior open the link.
 */
export function initExternalLinkInterceptor(): void {
  const bridge = (window as any).WisperNative;
  if (!bridge?.openExternal) return;

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

      e.preventDefault();
      bridge.openExternal(href);
    },
    // Capture phase so we act before the WebView's own link handling.
    true
  );
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
