/// Tunnel/Entrypoint card used in the home page list.
///
/// Two-column layout: left = name/type/endpoint, right = stats.
/// Stacks vertically on narrow screens (≤600px).
library;

import 'package:flutter/material.dart';

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
  final int currentConns;
  final int totalConns;
  final double requestRate;
  final int inputBytes;
  final int outputBytes;
  final int inputRateBytes;
  final int outputRateBytes;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final narrow = constraints.maxWidth <= 600;
              if (narrow) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildLeftColumn(context),
                    const SizedBox(height: 12),
                    _buildRightColumn(context, narrow: true),
                  ],
                );
              }
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: 3, child: _buildLeftColumn(context)),
                  Expanded(
                    flex: 2,
                    child: _buildRightColumn(context, narrow: false),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildLeftColumn(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Flexible(
              child: Text(
                name,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: _statusColor(status),
                shape: BoxShape.circle,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          '$type · $status',
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

  Widget _buildRightColumn(BuildContext context, {required bool narrow}) {
    final align = narrow ? CrossAxisAlignment.start : CrossAxisAlignment.end;
    return Column(
      crossAxisAlignment: align,
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
          value: _formatBytes(inputBytes),
          rate: '${_formatBytes(inputRateBytes)}/s',
        ),
        const SizedBox(height: 4),
        StatsRow(
          icon: Icons.arrow_downward,
          iconColor: const Color(0xFF2196F3),
          value: _formatBytes(outputBytes),
          rate: '${_formatBytes(outputRateBytes)}/s',
        ),
      ],
    );
  }

  static String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}
