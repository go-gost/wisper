/// Clipboard helper stub (non-web platforms).
library;

import 'package:flutter/services.dart';

/// Copies [text] to the system clipboard.
Future<void> copyToClipboard(String text) async {
  await Clipboard.setData(ClipboardData(text: text));
}
