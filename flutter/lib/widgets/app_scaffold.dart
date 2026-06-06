/// App-wide layout scaffold with max-width constraint.
///
/// All pages use this to ensure content is centred within [kMaxContentWidth].
library;

import 'package:flutter/material.dart';

import '../config/constants.dart';

/// Page scaffold with a centred max-width content area.
class AppScaffold extends StatelessWidget {
  const AppScaffold({
    super.key,
    this.appBar,
    required this.body,
    this.floatingActionButton,
  });

  /// Optional custom app bar widget above the body.
  final Widget? appBar;

  /// Main scrollable content.
  final Widget body;

  /// Optional FAB (positioned bottom-right).
  final Widget? floatingActionButton;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: kMaxContentWidth),
          child: Column(
            children: [
              appBar ?? const SizedBox.shrink(),
              Expanded(child: body),
            ],
          ),
        ),
      ),
      floatingActionButton: floatingActionButton,
    );
  }
}
