/// Delete confirmation dialog.
library;

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';

/// A dialog that asks the user to confirm a delete action.
class DeleteConfirmDialog extends StatelessWidget {
  const DeleteConfirmDialog({
    super.key,
    this.title = 'Delete?',
    this.message = 'This action cannot be undone.',
  });

  final String title;
  final String message;

  /// Show the dialog and return true if the user confirms.
  static Future<bool> show(BuildContext context, {
    String? title,
    String? message,
  }) async {
    final l10n = AppLocalizations.of(context)!;
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => DeleteConfirmDialog(
        title: title ?? l10n.deleteConfirmTitle,
        message: message ?? l10n.deleteConfirmMessage,
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(title, textAlign: TextAlign.center),
      content: Text(message, textAlign: TextAlign.center),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(AppLocalizations.of(context)!.btnCancel),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFE53935),
          ),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(AppLocalizations.of(context)!.btnDelete),
        ),
      ],
    );
  }
}
