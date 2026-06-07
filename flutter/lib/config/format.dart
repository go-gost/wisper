/// Shared formatting utilities for Wisper.
library;

/// Format a byte count as a human-readable string.
///
/// Examples: `0 B`, `512 B`, `1.5 KB`, `3.2 MB`.
String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}
