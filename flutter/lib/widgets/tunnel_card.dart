/// Tunnel/Entrypoint card used in the home page list.
///
/// Two-column layout: left = name/type/endpoint, right = stats.
/// Left column expands to fill available space; right column takes natural width.
library;

import 'package:flutter/material.dart';

import '../config/format.dart';
import '../l10n/app_localizations.dart';
import 'stats_row.dart';

/// Status colour for the indicator dot.
Color _statusColor(String status) {
  return switch (status) {
    'running' => const Color(0xFF00C853), // Green A700
    'error' => const Color(0xFFE53935), // Red 600
    _ => const Color(0xFF757575), // Grey 600
  };
}

/// A card displaying tunnel or entrypoint summary info.
class TunnelCard extends StatelessWidget {
  const TunnelCard({
    super.key,
    required this.name,
    required this.type,
    required this.endpoint,
    required this.status,
    this.error = '',
    required this.currentConns,
    required this.totalConns,
    required this.requestRate,
    required this.inputBytes,
    required this.outputBytes,
    required this.inputRateBytes,
    required this.outputRateBytes,
    this.onTap,
  });

  final String name;
  final String type;
  final String endpoint;
  final String status;
  final String error;
  final int currentConns;
  final int totalConns;
  final double requestRate;
  final int inputBytes;
  final int outputBytes;
  final int inputRateBytes;
  final int outputRateBytes;
  final VoidCallback? onTap;

  /// Human-readable status line matching the HTML prototype.
  String _statusLabel(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return switch (status) {
      'running' => '$type · ${l10n.statusRunning}',
      'error' => '$type · ${error.isNotEmpty ? error : l10n.statusError}',
      _ => '$type · ${l10n.statusStopped}',
    };
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: _buildLeftColumn(context)),
                  const SizedBox(width: 24),
                  Padding(
                    padding: const EdgeInsets.only(top: 20),
                    child: _buildRightColumn(context),
                  ),
                ],
              ),
            ),
            // Status dot anchored at top-right for consistent positioning.
            Positioned(
              top: 16,
              right: 16,
              child: Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: _statusColor(status),
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLeftColumn(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          name,
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 4),
        Text(
          _statusLabel(context),
          style: TextStyle(
            color: Theme.of(context).disabledColor,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          endpoint,
          style: TextStyle(
            fontSize: 14,
            color: Theme.of(context).textTheme.bodySmall?.color,
          ),
        ),
      ],
    );
  }

  Widget _buildRightColumn(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        StatsRow(
          icon: Icons.swap_vert,
          value: '$currentConns / $totalConns',
          rate: '${requestRate.toStringAsFixed(1)} R/s',
        ),
        const SizedBox(height: 4),
        StatsRow(
          icon: Icons.arrow_upward,
          iconColor: const Color(0xFF4CAF50),
          value: formatBytes(inputBytes),
          rate: '${formatBytes(inputRateBytes)}/s',
        ),
        const SizedBox(height: 4),
        StatsRow(
          icon: Icons.arrow_downward,
          iconColor: const Color(0xFF2196F3),
          value: formatBytes(outputBytes),
          rate: '${formatBytes(outputRateBytes)}/s',
        ),
      ],
    );
  }

}
