/// Entrypoint detail page — view/edit an entrypoint.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../l10n/app_localizations.dart';
import '../../models/entrypoint.dart';
import '../../providers/entrypoint_provider.dart';
import '../../providers/stats_provider.dart';
import '../../providers/backend_provider.dart' show backendProvider;
import '../../config/format.dart';
import '../../widgets/app_scaffold.dart';
import '../../widgets/copyable_text.dart';
import '../../widgets/delete_confirm_dialog.dart';
import '../../widgets/stats_row.dart';

/// Detail page for a single entrypoint.
class EntrypointDetailPage extends ConsumerStatefulWidget {
  const EntrypointDetailPage({
    super.key,
    required this.type,
    required this.id,
  });

  final String type;
  final String id;

  @override
  ConsumerState<EntrypointDetailPage> createState() =>
      _EntrypointDetailPageState();
}

class _EntrypointDetailPageState extends ConsumerState<EntrypointDetailPage> {
  bool _isEditing = false;
  bool _controllersInitialized = false;
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _nameCtrl;
  late TextEditingController _bindAddrCtrl;
  late TextEditingController _tunnelChainCtrl;

  // Options fields
  bool _keepalive = false;
  late TextEditingController _ttlCtrl;

  bool get _isNew => widget.id == 'new';

  @override
  void initState() {
    super.initState();
    _isEditing = _isNew;
    _nameCtrl = TextEditingController();
    _bindAddrCtrl = TextEditingController();
    _tunnelChainCtrl = TextEditingController();
    _ttlCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _bindAddrCtrl.dispose();
    _tunnelChainCtrl.dispose();
    _ttlCtrl.dispose();
    super.dispose();
  }

  void _initControllers(Entrypoint ep) {
    if (_controllersInitialized) return;
    _controllersInitialized = true;
    _nameCtrl.text = ep.name;
    _bindAddrCtrl.text = ep.bindAddress;
    _tunnelChainCtrl.text = ep.tunnelChain;
    _keepalive = ep.options.keepalive;
    _ttlCtrl.text = ep.options.ttl > 0 ? ep.options.ttl.toString() : '';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    if (!_isNew) {
      final epAsync = ref.watch(entrypointProvider(widget.id));

      return epAsync.when(
        loading: () => AppScaffold(
          appBar: AppBar(
            leading: BackButton(onPressed: () => context.pop()),
            title: Text('${widget.type.toUpperCase()} ${l10n.entrypointNewTitle}'),
          ),
          body: const Center(child: CircularProgressIndicator()),
        ),
        error: (e, _) => AppScaffold(
          appBar: AppBar(
            leading: BackButton(onPressed: () => context.pop()),
            title: Text('${widget.type.toUpperCase()} ${l10n.entrypointNewTitle}'),
          ),
          body: Center(child: Text('Error: $e')),
        ),
        data: (ep) {
          if (!_isEditing) _initControllers(ep);
          return _buildContent(context, l10n, ep);
        },
      );
    }

    return _buildContent(context, l10n, null);
  }

  Widget _buildContent(BuildContext context, AppLocalizations l10n, Entrypoint? ep) {
    return AppScaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.pop()),
        title: Text('${widget.type.toUpperCase()} ${l10n.entrypointNewTitle}'),
        actions: [
          if (!_isNew && ep != null) ...[
            // Favorite
            IconButton(
              icon: Icon(
                ep.favorite ? Icons.star : Icons.star_outline,
                color: ep.favorite ? const Color(0xFFF44336) : null,
              ),
              onPressed: () => _onToggleFavorite(ep),
            ),
            // Start/Stop
            _buildStartStopButton(context, l10n, ep),
            // Delete
            IconButton(
              icon: const Icon(Icons.delete_outline, color: Color(0xFFE53935)),
              onPressed: () => _onDelete(context, l10n),
            ),
            // Edit
            if (!_isEditing)
              TextButton(
                onPressed: () => setState(() {
                  _isEditing = true;
                  _controllersInitialized = false;
                }),
                child: Text(l10n.btnEdit),
              ),
          ],
          if (_isEditing)
            TextButton(
              onPressed: _onSave,
              child: Text(l10n.btnSave),
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // View-only ID
                  if (!_isNew && !_isEditing) ...[
                    CopyableText(text: ep?.id ?? ''),
                    const SizedBox(height: 10),
                  ],

                  // Error display
                  if (!_isEditing &&
                      ep != null &&
                      ep.error.isNotEmpty) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color:
                            const Color(0xFFE53935).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline,
                              size: 18, color: Color(0xFFE53935)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              ep.error,
                              style: const TextStyle(
                                  color: Color(0xFFE53935), fontSize: 13),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],

                  // Name
                  TextFormField(
                    controller: _nameCtrl,
                    decoration: InputDecoration(
                      labelText: l10n.fieldName,
                      border: const OutlineInputBorder(),
                    ),
                    readOnly: !_isEditing,
                    validator: (v) =>
                        (v == null || v.isEmpty) ? l10n.requiredField : null,
                  ),
                  const SizedBox(height: 16),

                  // Bind Address
                  TextFormField(
                    controller: _bindAddrCtrl,
                    decoration: InputDecoration(
                      labelText: l10n.fieldBindAddress,
                      border: const OutlineInputBorder(),
                    ),
                    readOnly: !_isEditing,
                    validator: (v) =>
                        (v == null || v.isEmpty) ? l10n.requiredField : null,
                  ),
                  const SizedBox(height: 16),

                  // Tunnel Chain
                  TextFormField(
                    controller: _tunnelChainCtrl,
                    decoration: InputDecoration(
                      labelText: l10n.fieldTunnelChain,
                      border: const OutlineInputBorder(),
                    ),
                    readOnly: !_isEditing,
                  ),
                  const SizedBox(height: 16),

                  // Keepalive switch
                  SwitchListTile(
                    title: Text(l10n.switchKeepalive),
                    value: _keepalive,
                    onChanged: _isEditing ? (v) => setState(() => _keepalive = v) : null,
                    contentPadding: EdgeInsets.zero,
                  ),
                  const SizedBox(height: 8),

                  // TTL
                  TextFormField(
                    controller: _ttlCtrl,
                    decoration: InputDecoration(
                      labelText: l10n.fieldTTL,
                      border: const OutlineInputBorder(),
                      hintText: l10n.fieldTTLHint,
                    ),
                    readOnly: !_isEditing,
                  ),

                  // Stats (view mode only) — uses live-polled stats
                  if (!_isEditing && ep != null) ...[
                    const SizedBox(height: 24),
                    _buildLiveStatsSection(ep),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStartStopButton(BuildContext context, AppLocalizations l10n, Entrypoint ep) {
    final isRunning = ep.status == 'running';
    if (isRunning) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFE53935),
          ),
          onPressed: () => _onStop(context, l10n),
          child: Text(l10n.btnStop),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: FilledButton(
        onPressed: () => _onStart(context, l10n),
        child: Text(l10n.btnStart),
      ),
    );
  }

  /// Stats section that uses the live-polled stats from [statsProvider].
  Widget _buildLiveStatsSection(Entrypoint ep) {
    final l10n = AppLocalizations.of(context)!;
    final statsAsync = ref.watch(statsProvider);
    final liveStats = statsAsync.valueOrNull?[ep.id];

    // Fall back to entrypoint snapshot if live stats unavailable.
    final currentConns = liveStats?.currentConns ?? ep.stats.currentConns;
    final totalConns = liveStats?.totalConns ?? ep.stats.totalConns;
    final requestRate = liveStats?.requestRate ?? ep.stats.requestRate;
    final inputBytes = liveStats?.inputBytes ?? ep.stats.inputBytes;
    final outputBytes = liveStats?.outputBytes ?? ep.stats.outputBytes;
    final inputRateBytes = liveStats?.inputRateBytes ?? ep.stats.inputRateBytes;
    final outputRateBytes = liveStats?.outputRateBytes ?? ep.stats.outputRateBytes;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.labelStatistics,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        Wrap(
          spacing: 4,
          runSpacing: 4,
          children: [
            _badge('↕ $currentConns / $totalConns connections'),
            _badge('⚡ ${requestRate.toStringAsFixed(1)} R/s'),
          ],
        ),
        const SizedBox(height: 12),
        StatsRow(
          icon: Icons.arrow_upward,
          iconColor: const Color(0xFF4CAF50),
          value: formatBytes(inputBytes),
          rate: '${formatBytes(inputRateBytes)}/s',
        ),
        const SizedBox(height: 4),
        StatsRow(
          icon: Icons.arrow_downward,
          iconColor: const Color(0xFF2196F3),
          value: formatBytes(outputBytes),
          rate: '${formatBytes(outputRateBytes)}/s',
        ),
      ],
    );
  }

  Widget _badge(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(text, style: const TextStyle(fontSize: 12)),
    );
  }

  // ---------------------------------------------------------------------------
  // Actions with toast feedback
  // ---------------------------------------------------------------------------

  Future<void> _onStart(BuildContext context, AppLocalizations l10n) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(entrypointListProvider.notifier).start(widget.id);
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.started)));
      }
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.startFailed('$e'))));
      }
    }
  }

  Future<void> _onStop(BuildContext context, AppLocalizations l10n) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(entrypointListProvider.notifier).stop(widget.id);
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.stopped)));
      }
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.stopFailed('$e'))));
      }
    }
  }

  Future<void> _onDelete(BuildContext context, AppLocalizations l10n) async {
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    final confirm = await DeleteConfirmDialog.show(context);
    if (!confirm) return;
    try {
      await ref.read(entrypointListProvider.notifier).delete(widget.id);
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.deleted)));
        router.pop();
      }
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.deleteFailed('$e'))));
      }
    }
  }

  Future<void> _onToggleFavorite(Entrypoint ep) async {
    final l10n = AppLocalizations.of(context)!;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(entrypointListProvider.notifier)
          .toggleFavorite(widget.id, ep.favorite);
      if (mounted) {
        messenger.showSnackBar(SnackBar(
          content: Text(
            ep.favorite ? l10n.favoriteRemoved : l10n.favoriteAdded,
          ),
        ));
      }
    } catch (_) {
      // Silently ignore — favorite toggle is non-critical
    }
  }

  Future<void> _onSave() async {
    if (!_formKey.currentState!.validate()) return;
    final l10n = AppLocalizations.of(context)!;
    final messenger = ScaffoldMessenger.of(context);

    final body = <String, dynamic>{
      'name': _nameCtrl.text,
      'type': widget.type,
      'endpoint': _bindAddrCtrl.text,
      'entrypoint': _tunnelChainCtrl.text,
      'keepalive': _keepalive,
    };

    final ttlText = _ttlCtrl.text.trim();
    if (ttlText.isNotEmpty) {
      // Parse "30s" → 30, or bare number
      final digits = ttlText.replaceAll(RegExp(r'[^0-9]'), '');
      if (digits.isNotEmpty) {
        body['ttl'] = int.parse(digits);
      }
    }

    try {
      final backend = ref.read(backendProvider);
      if (_isNew) {
        await backend.createEntrypoint(body);
      } else {
        await backend.updateEntrypoint(widget.id, body);
      }
      await ref.read(entrypointListProvider.notifier).refresh();
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.saved)));
        context.pop();
      }
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.saveFailed('$e'))));
      }
    }
  }
}
