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
 * Format an ISO 8601 timestamp as "2026-01-02 15:04:05.000" in local time
 * with fixed 3-digit milliseconds — matches go-gost/inspector's fmtTime().
 */
export function formatTimestamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const base =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${base}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Format a nanosecond duration as "<1ms" / "Nµs" / "N.Nms" / "N.Ns" —
 * matches go-gost/inspector's fmtDuration().
 */
export function formatDuration(ns: number): string {
  if (!ns || ns <= 0) return '<1ms';
  if (ns < 1_000_000) return `${Math.round(ns / 1000)}µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(1)}ms`;
  return `${(ns / 1_000_000_000).toFixed(1)}s`;
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
