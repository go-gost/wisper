/// Home page — Tunnel/Entrypoint tabs with card list.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      appBar: _buildHeader(context),
      body: Column(
        children: [
          NavTabs(
            tabs: const ['Tunnel', 'Entrypoint'],
            selectedIndex: _tabIndex,
            onChanged: (i) => setState(() => _tabIndex = i),
          ),
          Expanded(
            child: _tabIndex == 0 ? _buildTunnelList() : _buildEntrypointList(),
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

  Widget _buildHeader(BuildContext context) {
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
              icon: const Icon(Icons.star_outline),
              tooltip: 'Favorites',
              onPressed: () {
                // TODO: toggle favorites filter (Phase 4)
              },
            ),
            IconButton(
              icon: const Icon(Icons.settings),
              tooltip: 'Settings',
              onPressed: () => context.push('/settings'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTunnelList() {
    final tunnelsAsync = ref.watch(tunnelListProvider);
    final statsAsync = ref.watch(statsProvider);

    return tunnelsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Error: $e')),
      data: (tunnels) {
        if (tunnels.isEmpty) {
          return const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.cloud_off, size: 48, color: Colors.grey),
                SizedBox(height: 12),
                Text('No tunnels yet'),
              ],
            ),
          );
        }

        final statsMap = statsAsync.valueOrNull ?? {};

        return RefreshIndicator(
          onRefresh: () => ref.read(tunnelListProvider.notifier).refresh(),
          child: ListView.builder(
            itemCount: tunnels.length,
            itemBuilder: (context, index) {
              final t = tunnels[index];
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

  Widget _buildEntrypointList() {
    final entrypointsAsync = ref.watch(entrypointListProvider);
    final statsAsync = ref.watch(statsProvider);

    return entrypointsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Error: $e')),
      data: (entrypoints) {
        if (entrypoints.isEmpty) {
          return const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.cloud_off, size: 48, color: Colors.grey),
                SizedBox(height: 12),
                Text('No entrypoints yet'),
              ],
            ),
          );
        }

        final statsMap = statsAsync.valueOrNull ?? {};

        return RefreshIndicator(
          onRefresh: () => ref.read(entrypointListProvider.notifier).refresh(),
          child: ListView.builder(
            itemCount: entrypoints.length,
            itemBuilder: (context, index) {
              final e = entrypoints[index];
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
