/// Home page — Tunnel/Entrypoint tabs with card list.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../l10n/app_localizations.dart';
import '../../providers/tunnel_provider.dart';
import '../../providers/entrypoint_provider.dart';
import '../../providers/stats_provider.dart';
import '../../widgets/app_scaffold.dart';
import '../../widgets/nav_tabs.dart';
import '../../widgets/tunnel_card.dart';

/// Home page with Tunnel/Entrypoint tab switcher.
class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});

  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  int _tabIndex = 0;
  bool _showFavoritesOnly = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AppScaffold(
      appBar: _buildHeader(context, l10n),
      body: Column(
        children: [
          NavTabs(
            tabs: [l10n.homeTabTunnel, l10n.homeTabEntrypoint],
            selectedIndex: _tabIndex,
            onChanged: (i) => setState(() => _tabIndex = i),
          ),
          Expanded(
            child: _tabIndex == 0 ? _buildTunnelList(context, l10n) : _buildEntrypointList(context, l10n),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        onPressed: () {
          if (_tabIndex == 0) {
            context.push('/tunnel/new');
          } else {
            context.push('/entrypoint/new');
          }
        },
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, AppLocalizations l10n) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            // App icon
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Center(
                child: Text(
                  'W',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 18,
                  ),
                ),
              ),
            ),
            const Spacer(),
            IconButton(
              icon: Icon(
                _showFavoritesOnly ? Icons.star : Icons.star_outline,
                color: _showFavoritesOnly ? const Color(0xFFF44336) : null,
              ),
              tooltip: _showFavoritesOnly
                  ? l10n.homeAllTooltip
                  : l10n.homeFavoritesTooltip,
              onPressed: () =>
                  setState(() => _showFavoritesOnly = !_showFavoritesOnly),
            ),
            IconButton(
              icon: const Icon(Icons.settings),
              tooltip: l10n.settingsTitle,
              onPressed: () => context.push('/settings'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTunnelList(BuildContext context, AppLocalizations l10n) {
    final tunnelsAsync = ref.watch(tunnelListProvider);
    final statsAsync = ref.watch(statsProvider);

    return tunnelsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Error: $e')),
      data: (tunnels) {
        final filtered = _showFavoritesOnly
            ? tunnels.where((t) => t.favorite).toList()
            : tunnels;

        if (filtered.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
                const SizedBox(height: 12),
                Text(l10n.homeEmptyTunnels),
              ],
            ),
          );
        }

        final statsMap = statsAsync.valueOrNull ?? {};

        return RefreshIndicator(
          onRefresh: () => ref.read(tunnelListProvider.notifier).refresh(),
          child: ListView.builder(
            itemCount: filtered.length,
            itemBuilder: (context, index) {
              final t = filtered[index];
              final s = statsMap[t.id];
              return TunnelCard(
                name: t.name,
                type: t.type.toUpperCase(),
                endpoint: t.endpoint,
                status: t.status,
                error: t.error,
                currentConns: s?.currentConns ?? t.stats.currentConns,
                totalConns: s?.totalConns ?? t.stats.totalConns,
                requestRate: s?.requestRate ?? t.stats.requestRate,
                inputBytes: s?.inputBytes ?? t.stats.inputBytes,
                outputBytes: s?.outputBytes ?? t.stats.outputBytes,
                inputRateBytes: s?.inputRateBytes ?? t.stats.inputRateBytes,
                outputRateBytes: s?.outputRateBytes ?? t.stats.outputRateBytes,
                onTap: () => context.push('/tunnel/${t.type}/${t.id}'),
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildEntrypointList(BuildContext context, AppLocalizations l10n) {
    final entrypointsAsync = ref.watch(entrypointListProvider);
    final statsAsync = ref.watch(statsProvider);

    return entrypointsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Error: $e')),
      data: (entrypoints) {
        final filtered = _showFavoritesOnly
            ? entrypoints.where((e) => e.favorite).toList()
            : entrypoints;

        if (filtered.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
                const SizedBox(height: 12),
                Text(l10n.homeEmptyEntrypoints),
              ],
            ),
          );
        }

        final statsMap = statsAsync.valueOrNull ?? {};

        return RefreshIndicator(
          onRefresh: () => ref.read(entrypointListProvider.notifier).refresh(),
          child: ListView.builder(
            itemCount: filtered.length,
            itemBuilder: (context, index) {
              final e = filtered[index];
              final s = statsMap[e.id];
              return TunnelCard(
                name: e.name,
                type: e.type.toUpperCase(),
                endpoint: e.bindAddress,
                status: e.status,
                error: e.error,
                currentConns: s?.currentConns ?? e.stats.currentConns,
                totalConns: s?.totalConns ?? e.stats.totalConns,
                requestRate: s?.requestRate ?? e.stats.requestRate,
                inputBytes: s?.inputBytes ?? e.stats.inputBytes,
                outputBytes: s?.outputBytes ?? e.stats.outputBytes,
                inputRateBytes: s?.inputRateBytes ?? e.stats.inputRateBytes,
                outputRateBytes: s?.outputRateBytes ?? e.stats.outputRateBytes,
                onTap: () => context.push('/entrypoint/${e.type}/${e.id}'),
              );
            },
          ),
        );
      },
    );
  }
}
