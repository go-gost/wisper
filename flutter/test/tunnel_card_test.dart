import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:wisper/l10n/app_localizations.dart';
import 'package:wisper/widgets/tunnel_card.dart';

/// Wraps a widget with MaterialApp + localization delegates so that
/// AppLocalizations.of(context) works in tests.
Widget wrapWithL10n(Widget child) {
  return MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    locale: const Locale('en'),
    home: Scaffold(body: child),
  );
}

void main() {
  Widget buildTunnelCard({
    String name = 'Test Tunnel',
    String type = 'tcp',
    String endpoint = 'localhost:8080',
    String status = 'running',
    String error = '',
    int currentConns = 5,
    int totalConns = 120,
    double requestRate = 5.2,
    int inputBytes = 1536,
    int outputBytes = 3200,
    int inputRateBytes = 800,
    int outputRateBytes = 1200,
    VoidCallback? onTap,
  }) {
    return wrapWithL10n(
      TunnelCard(
        name: name,
        type: type,
        endpoint: endpoint,
        status: status,
        error: error,
        currentConns: currentConns,
        totalConns: totalConns,
        requestRate: requestRate,
        inputBytes: inputBytes,
        outputBytes: outputBytes,
        inputRateBytes: inputRateBytes,
        outputRateBytes: outputRateBytes,
        onTap: onTap,
      ),
    );
  }

  testWidgets('TunnelCard displays name and endpoint', (tester) async {
    await tester.pumpWidget(buildTunnelCard(
      name: 'My TCP Tunnel',
      endpoint: 'localhost:9090',
    ));
    await tester.pumpAndSettle();

    expect(find.text('My TCP Tunnel'), findsOneWidget);
    expect(find.text('localhost:9090'), findsOneWidget);
  });

  testWidgets('TunnelCard shows status label with type', (tester) async {
    await tester.pumpWidget(buildTunnelCard(status: 'running', type: 'http'));
    await tester.pumpAndSettle();

    // Should contain type and "running" (from English l10n).
    expect(find.textContaining('http'), findsOneWidget);
    expect(find.textContaining('running'), findsOneWidget);
  });

  testWidgets('TunnelCard displays connection stats', (tester) async {
    await tester.pumpWidget(buildTunnelCard(
      currentConns: 12,
      totalConns: 120,
      requestRate: 5.2,
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('12 / 120'), findsOneWidget);
    expect(find.textContaining('5.2'), findsOneWidget);
  });

  testWidgets('TunnelCard responds to tap', (tester) async {
    var tapped = false;
    await tester.pumpWidget(buildTunnelCard(onTap: () => tapped = true));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(InkWell));
    expect(tapped, isTrue);
  });
}
