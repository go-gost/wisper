/// Single row of traffic statistics: icon + value + rate.
library;

import 'package:flutter/material.dart';

/// A compact row showing a traffic statistic with an icon, value, and rate.
class StatsRow extends StatelessWidget {
  const StatsRow({
    super.key,
    required this.icon,
    this.iconColor,
    required this.value,
    required this.rate,
  });

  final IconData icon;
  final Color? iconColor;
  final String value;
  final String rate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dimColor = theme.disabledColor;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: iconColor ?? theme.iconTheme.color),
        const SizedBox(width: 6),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
        const SizedBox(width: 6),
        Text(rate, style: TextStyle(color: dimColor, fontSize: 12)),
      ],
    );
  }
}
