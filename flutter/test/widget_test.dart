import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:wisper/app.dart';

void main() {
  testWidgets('App renders MaterialApp without error', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: WisperApp()),
    );

    // Verify the MaterialApp is present (it drives routing + theming).
    await tester.pumpAndSettle();
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
