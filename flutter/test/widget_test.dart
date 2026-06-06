import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:wisper/app.dart';

void main() {
  testWidgets('App renders without error', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: WisperApp()),
    );

    // Verify the app shell renders — look for the Wisper app title.
    await tester.pumpAndSettle();
    expect(find.text('Wisper'), findsOneWidget);
  });
}
