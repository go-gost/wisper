/// Delete confirmation dialog.
library;

import 'package:flutter/material.dart';

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
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => DeleteConfirmDialog(
        title: title ?? 'Delete?',
        message: message ?? 'This action cannot be undone.',
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
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFE53935),
          ),
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Delete'),
        ),
      ],
    );
  }
}
