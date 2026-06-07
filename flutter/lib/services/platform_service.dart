/// Platform service for managing the Go backend process.
///
/// On desktop platforms (Linux, macOS, Windows), this launches the compiled
/// Go binary as a child process. On mobile (Android, iOS), the Go backend
/// must be managed externally — this class provides a health-check interface
/// that works on all platforms.
library;

import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:flutter/foundation.dart';

import '../config/constants.dart';

/// Manages the lifecycle of the Go backend process.
///
/// The backend binary is expected at one of:
/// 1. Next to the Flutter executable (release mode)
/// 2. In the app's assets directory (bundled via build script)
class PlatformService {
  Process? _process;
  int _port = kDefaultBackendPort;

  /// Whether the Go backend process was started by this instance.
  bool get isRunning => _process != null;

  /// The port the backend is listening on.
  int get port => _port;

  /// Check if the backend is reachable (works on all platforms).
  Future<bool> isHealthy({Duration timeout = const Duration(seconds: 2)}) async {
    try {
      final resp = await http
          .get(Uri.parse('http://127.0.0.1:$_port/api/config'))
          .timeout(timeout);
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Start the Go backend process (desktop only).
  ///
  /// Discovers the binary by searching:
  /// 1. Next to the current executable
  /// 2. In the application support directory
  ///
  /// After starting, waits for the health check to pass up to [readyTimeout].
  Future<bool> start({
    int port = kDefaultBackendPort,
    Duration readyTimeout = const Duration(seconds: 5),
  }) async {
    if (!Platform.isLinux && !Platform.isMacOS && !Platform.isWindows) {
      return false;
    }

    _port = port;

    // Already running?
    if (await isHealthy()) {
      return true;
    }

    final binaryPath = await _findBinary();
    if (binaryPath == null) {
      debugPrint('PlatformService: Go backend binary not found');
      return false;
    }

    debugPrint('PlatformService: starting $binaryPath -addr 127.0.0.1:$port');

    _process = await Process.start(
      binaryPath,
      ['-addr', '127.0.0.1:$port'],
    );

    // Drain stdout/stderr to prevent pipe buffer from blocking the process.
    _process!.stdout.drain<void>();
    _process!.stderr.drain<void>();

    _process!.exitCode.then((code) {
      debugPrint('PlatformService: backend exited with code $code');
      _process = null;
    });

    // Wait for the backend to become healthy.
    final deadline = DateTime.now().add(readyTimeout);
    while (DateTime.now().isBefore(deadline)) {
      if (await isHealthy()) {
        debugPrint('PlatformService: backend is healthy');
        return true;
      }
      await Future<void>.delayed(const Duration(milliseconds: 200));
    }

    debugPrint('PlatformService: backend did not become healthy in time');
    await stop();
    return false;
  }

  /// Stop the Go backend process gracefully.
  Future<void> stop() async {
    final proc = _process;
    if (proc == null) return;

    // Send SIGTERM for graceful shutdown.
    proc.kill(ProcessSignal.sigterm);
    await proc.exitCode.timeout(
      const Duration(seconds: 3),
      onTimeout: () {
        // Force kill if graceful shutdown takes too long.
        proc.kill(ProcessSignal.sigkill);
        return -1;
      },
    );
    _process = null;
  }

  /// Attempt to find the Go backend binary.
  Future<String?> _findBinary() async {
    const binaryName = 'wisper';
    const binaryNameWin = 'wisper.exe';

    // 1. Next to the current executable (release builds placed by build.sh).
    final exeDir = File(Platform.resolvedExecutable).parent;
    final nextToExe = Platform.isWindows
        ? File('${exeDir.path}/$binaryNameWin')
        : File('${exeDir.path}/$binaryName');
    if (await nextToExe.exists()) return nextToExe.path;

    // 2. In the application support directory.
    try {
      final appDir = await getApplicationSupportDirectory();
      final inAppDir = Platform.isWindows
          ? File('${appDir.path}/$binaryNameWin')
          : File('${appDir.path}/$binaryName');
      if (await inAppDir.exists()) return inAppDir.path;
    } catch (_) {
      // path_provider may not be available on all platforms.
    }

    // 3. Relative to project root during development (dist/ directory).
    if (Platform.isLinux || Platform.isMacOS) {
      final devPath = File('${exeDir.path}/../../dist/linux-amd64/$binaryName');
      if (await devPath.exists()) return devPath.absolute.path;
    }

    return null;
  }
}
