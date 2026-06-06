/// Platform service for managing the Go backend process.
///
/// On desktop platforms, this launches the Go binary as a child process.
/// On mobile, it may use a different mechanism (e.g., embedded library).
library;

import 'dart:io';

/// Manages the lifecycle of the Go backend process.
class PlatformService {
  Process? _process;

  /// Whether the Go backend process is currently running.
  bool get isRunning => _process != null;

  /// Start the Go backend process.
  ///
  /// [binaryPath] is the path to the compiled Go binary.
  /// [port] is the HTTP port to listen on.
  Future<void> start({
    required String binaryPath,
    int port = 18080,
  }) async {
    if (_process != null) return;

    _process = await Process.start(
      binaryPath,
      ['-port', port.toString()],
    );

    // Forward stdout/stderr for debugging.
    _process!.stdout.listen((data) {
      // ignore in production; useful for debug logging
    });
    _process!.stderr.listen((data) {
      // ignore in production; useful for debug logging
    });

    // Wait for the process to exit and clean up.
    _process!.exitCode.then((code) {
      _process = null;
    });
  }

  /// Stop the Go backend process gracefully.
  Future<void> stop() async {
    final proc = _process;
    if (proc == null) return;

    proc.kill();
    await proc.exitCode;
    _process = null;
  }
}
