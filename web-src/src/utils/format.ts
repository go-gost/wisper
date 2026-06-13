/**
 * Format bytes into a human-readable string (e.g., "1.5 KB", "10.2 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return '—';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  if (i === 0) return `${size} B`;
  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * Format bytes per second (e.g., "1.5 KB/s").
 */
export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '0 B/s';
  if (bytesPerSec < 0) return '—';

  return formatBytes(bytesPerSec) + '/s';
}

/**
 * Format a number with commas (e.g., "1,234").
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format HTTP headers (a map of name → values) into readable "Name: value" lines.
 * Accepts the `map[string][]string` shape serialized from Go's `http.Header`;
 * passes strings through unchanged so a raw header block also renders correctly.
 */
export function formatHeaders(header: Record<string, string[]> | string): string {
  if (!header) return '';
  if (typeof header === 'string') return header;
  return Object.entries(header)
    .map(([k, vs]) => `${k}: ${Array.isArray(vs) ? vs.join(', ') : String(vs)}`)
    .join('\n');
}
