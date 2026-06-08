/// A read-only text field with a copy-to-clipboard button.
library;

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/clipboard_helper.dart';

/// Displays text in a monospace container with a copy button.
class CopyableText extends StatelessWidget {
  const CopyableText({
    super.key,
    required this.text,
  });

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 13,
                color: theme.textTheme.bodyMedium?.color,
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.copy, size: 18),
            tooltip: AppLocalizations.of(context)!.btnCopy,
            onPressed: () {
              copyToClipboard(text);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(AppLocalizations.of(context)!.copiedToClipboard),
                  duration: const Duration(seconds: 2),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
