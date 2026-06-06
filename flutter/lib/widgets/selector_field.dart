/// Tappable selector row (used for Language, Theme in Settings).
library;

import 'package:flutter/material.dart';

/// A settings row that cycles through options on tap.
class SelectorField extends StatelessWidget {
  const SelectorField({
    super.key,
    required this.label,
    required this.options,
    required this.selectedIndex,
    required this.onChanged,
  });

  final String label;
  final List<String> options;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: () => onChanged((selectedIndex + 1) % options.length),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Text(label, style: const TextStyle(fontSize: 15)),
            const Spacer(),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  options[selectedIndex],
                  style: TextStyle(
                    color: theme.disabledColor,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(width: 4),
                Icon(Icons.chevron_right, color: theme.disabledColor, size: 20),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
