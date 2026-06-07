/// Tunnel type selection page.
library;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../config/constants.dart';
import '../../l10n/app_localizations.dart';
import '../../widgets/app_scaffold.dart';

/// Page that shows the available tunnel types as selectable cards.
class TunnelListPage extends StatelessWidget {
  const TunnelListPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AppScaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.pop()),
        title: Text(l10n.tunnelNewTitle),
      ),
      body: ListView(
        padding: const EdgeInsets.only(top: 8),
        children: TunnelType.values.map((type) {
          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => context.push('/tunnel/${type.value}/new'),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            type.label,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 16,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _typeDesc(l10n, type),
                            style: TextStyle(
                              color: Theme.of(context).disabledColor,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      Icons.chevron_right,
                      color: Theme.of(context).disabledColor,
                    ),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  String _typeDesc(AppLocalizations l10n, TunnelType type) {
    return switch (type) {
      TunnelType.file => l10n.typeFileDesc,
      TunnelType.http => l10n.typeHttpDesc,
      TunnelType.tcp => l10n.typeTcpDesc,
      TunnelType.udp => l10n.typeUdpDesc,
    };
  }
}
