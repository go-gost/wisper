/// Clipboard helper for web — uses execCommand fallback for HTTP contexts.
library;

import 'dart:html' as html;

/// Copies [text] to the clipboard.
///
/// Uses the async Clipboard API first (requires HTTPS/localhost).
/// Falls back to execCommand('copy') for plain HTTP access.
Future<void> copyToClipboard(String text) async {
  final clipboard = html.window.navigator.clipboard;
  if (clipboard != null) {
    try {
      await clipboard.writeText(text);
      return;
    } catch (_) {
      // Clipboard API failed (e.g., permission denied); fall through.
    }
  }
  // Fallback for non-secure contexts (plain HTTP) or API failure.
  _fallbackCopy(text);
}

void _fallbackCopy(String text) {
  final textarea = html.TextAreaElement();
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  html.document.body!.append(textarea);
  textarea.select();
  html.document.execCommand('copy');
  textarea.remove();
}
