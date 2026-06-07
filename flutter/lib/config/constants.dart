/// Application-wide constants for Wisper.
library;

/// Maximum content width for the app layout.
const kMaxContentWidth = 800.0;

/// Default Go backend HTTP port.
const kDefaultBackendPort = 8900;

/// Stats polling interval in milliseconds.
const kStatsPollIntervalMs = 1000;

/// Tunnel types supported by the application.
enum TunnelType {
  file('file', '📁 File', 'Share files from a local directory'),
  http('http', '🌐 HTTP', 'Share a local HTTP server'),
  tcp('tcp', '🔌 TCP', 'Forward a local TCP port'),
  udp('udp', '📡 UDP', 'Forward a local UDP port');

  const TunnelType(this.value, this.label, this.description);
  final String value;
  final String label;
  final String description;
}

/// Entrypoint types supported by the application.
enum EntrypointType {
  tcp('tcp', '🔌 TCP', 'Expose a TCP service through the tunnel'),
  udp('udp', '📡 UDP', 'Expose a UDP service through the tunnel');

  const EntrypointType(this.value, this.label, this.description);
  final String value;
  final String label;
  final String description;
}

/// Tunnel/entrypoint status values returned by the Go backend.
enum ServiceStatus { running, stopped, error }
