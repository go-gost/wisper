import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:wisper/l10n/app_localizations.dart';
import 'package:wisper/widgets/delete_confirm_dialog.dart';
import 'package:wisper/widgets/stats_row.dart';
import 'package:wisper/config/format.dart';

/// Wraps a widget with MaterialApp + localization delegates.
Widget wrapWithL10n(Widget child) {
  return MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    locale: const Locale('en'),
    home: Scaffold(body: child),
  );
}

void main() {
  // ---------------------------------------------------------------------------
  // StatsRow widget
  // ---------------------------------------------------------------------------

  testWidgets('StatsRow renders value and rate', (tester) async {
    await tester.pumpWidget(wrapWithL10n(
      StatsRow(
        icon: Icons.swap_vert,
        value: '12 / 120',
        rate: '5.2 R/s',
      ),
    ));

    expect(find.text('12 / 120'), findsOneWidget);
    expect(find.text('5.2 R/s'), findsOneWidget);
    expect(find.byIcon(Icons.swap_vert), findsOneWidget);
  });

  testWidgets('StatsRow applies custom icon color', (tester) async {
    await tester.pumpWidget(wrapWithL10n(
      StatsRow(
        icon: Icons.arrow_upward,
        iconColor: const Color(0xFF4CAF50),
        value: '1.5 KB',
        rate: '800 B/s',
      ),
    ));

    final icon = tester.widget<Icon>(find.byIcon(Icons.arrow_upward));
    expect(icon.color, const Color(0xFF4CAF50));
  });

  // ---------------------------------------------------------------------------
  // DeleteConfirmDialog
  // ---------------------------------------------------------------------------

  testWidgets('DeleteConfirmDialog shows title and message', (tester) async {
    await tester.pumpWidget(wrapWithL10n(
      Builder(
        builder: (context) => ElevatedButton(
          onPressed: () {
            showDialog(
              context: context,
              builder: (_) => const DeleteConfirmDialog(
                title: 'Delete Item?',
                message: 'This will remove the item permanently.',
              ),
            );
          },
          child: const Text('Show Dialog'),
        ),
      ),
    ));

    await tester.tap(find.text('Show Dialog'));
    await tester.pumpAndSettle();

    expect(find.text('Delete Item?'), findsOneWidget);
    expect(find.text('This will remove the item permanently.'), findsOneWidget);
  });

  testWidgets('DeleteConfirmDialog returns true on confirm', (tester) async {
    bool? result;
    await tester.pumpWidget(wrapWithL10n(
      Builder(
        builder: (context) => ElevatedButton(
          onPressed: () async {
            result = await DeleteConfirmDialog.show(
              context,
              title: 'Confirm?',
            );
          },
          child: const Text('Show'),
        ),
      ),
    ));

    await tester.tap(find.text('Show'));
    await tester.pumpAndSettle();

    // Find the "Delete" button (from l10n btnDelete).
    expect(find.text('Delete'), findsOneWidget);
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    expect(result, isTrue);
  });

  testWidgets('DeleteConfirmDialog returns false on cancel', (tester) async {
    bool? result;
    await tester.pumpWidget(wrapWithL10n(
      Builder(
        builder: (context) => ElevatedButton(
          onPressed: () async {
            result = await DeleteConfirmDialog.show(
              context,
              title: 'Confirm?',
            );
          },
          child: const Text('Show'),
        ),
      ),
    ));

    await tester.tap(find.text('Show'));
    await tester.pumpAndSettle();

    // Find the "Cancel" button (from l10n btnCancel).
    expect(find.text('Cancel'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(result, isFalse);
  });

  // ---------------------------------------------------------------------------
  // formatBytes utility
  // ---------------------------------------------------------------------------

  test('formatBytes formats bytes correctly', () {
    expect(formatBytes(0), '0 B');
    expect(formatBytes(512), '512 B');
    expect(formatBytes(1024), '1.0 KB');
    expect(formatBytes(1536), '1.5 KB');
    expect(formatBytes(1024 * 1024), '1.0 MB');
    expect(formatBytes(3 * 1024 * 1024), '3.0 MB');
    expect(formatBytes(3145728), '3.0 MB');
  });
}
