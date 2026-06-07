/// Entrypoint detail page — view/edit an entrypoint.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/entrypoint.dart';
import '../../providers/entrypoint_provider.dart';
import '../../providers/tunnel_provider.dart' show backendProvider;
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
    if (!_isNew) {
      final epAsync = ref.watch(entrypointProvider(widget.id));

      return epAsync.when(
        loading: () => AppScaffold(
          appBar: AppBar(
            leading: BackButton(onPressed: () => context.pop()),
            title: Text('${widget.type.toUpperCase()} Entrypoint'),
          ),
          body: const Center(child: CircularProgressIndicator()),
        ),
        error: (e, _) => AppScaffold(
          appBar: AppBar(
            leading: BackButton(onPressed: () => context.pop()),
            title: Text('${widget.type.toUpperCase()} Entrypoint'),
          ),
          body: Center(child: Text('Error: $e')),
        ),
        data: (ep) {
          if (!_isEditing) _initControllers(ep);
          return _buildContent(context, ep);
        },
      );
    }

    return _buildContent(context, null);
  }

  Widget _buildContent(BuildContext context, Entrypoint? ep) {
    return AppScaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.pop()),
        title: Text('${widget.type.toUpperCase()} Entrypoint'),
        actions: [
          if (!_isNew && ep != null) ...[
            // Favorite
            IconButton(
              icon: Icon(
                ep.favorite ? Icons.star : Icons.star_outline,
                color: ep.favorite ? const Color(0xFFF44336) : null,
              ),
              onPressed: () {
                final tunnels = ref
                    .read(entrypointListProvider)
                    .valueOrNull;
                if (tunnels != null) {
                  final entry = tunnels.firstWhere((e) => e.id == widget.id);
                  // Update favorite via backend
                  ref.read(backendProvider).updateEntrypoint(widget.id, {
                    ...entry.toJson(),
                    'favorite': !entry.favorite,
                  }).then((_) {
                    ref.read(entrypointListProvider.notifier).refresh();
                  });
                }
              },
            ),
            // Start/Stop
            _buildStartStopButton(ep),
            // Delete
            IconButton(
              icon: const Icon(Icons.delete_outline, color: Color(0xFFE53935)),
              onPressed: () async {
                final confirm = await DeleteConfirmDialog.show(context);
                if (confirm) {
                  await ref
                      .read(entrypointListProvider.notifier)
                      .delete(widget.id);
                  if (context.mounted) context.pop();
                }
              },
            ),
            // Edit
            if (!_isEditing)
              TextButton(
                onPressed: () => setState(() {
                  _isEditing = true;
                  _controllersInitialized = false;
                }),
                child: const Text('Edit'),
              ),
          ],
          if (_isEditing)
            TextButton(
              onPressed: _onSave,
              child: const Text('Save'),
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
                    decoration: const InputDecoration(
                      labelText: 'Name',
                      border: OutlineInputBorder(),
                    ),
                    readOnly: !_isEditing,
                    validator: (v) =>
                        (v == null || v.isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 16),

                  // Bind Address
                  TextFormField(
                    controller: _bindAddrCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Bind Address',
                      border: OutlineInputBorder(),
                    ),
                    readOnly: !_isEditing,
                    validator: (v) =>
                        (v == null || v.isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 16),

                  // Tunnel Chain
                  TextFormField(
                    controller: _tunnelChainCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Tunnel Chain',
                      border: OutlineInputBorder(),
                    ),
                    readOnly: !_isEditing,
                  ),
                  const SizedBox(height: 16),

                  // Keepalive switch
                  SwitchListTile(
                    title: const Text('Keepalive'),
                    value: _keepalive,
                    onChanged: _isEditing ? (v) => setState(() => _keepalive = v) : null,
                    contentPadding: EdgeInsets.zero,
                  ),
                  const SizedBox(height: 8),

                  // TTL
                  TextFormField(
                    controller: _ttlCtrl,
                    decoration: const InputDecoration(
                      labelText: 'TTL',
                      border: OutlineInputBorder(),
                      hintText: 'e.g. 30s',
                    ),
                    readOnly: !_isEditing,
                  ),

                  // Stats (view mode only)
                  if (!_isEditing && ep != null) ...[
                    const SizedBox(height: 24),
                    _buildStatsSection(ep),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStartStopButton(Entrypoint ep) {
    final isRunning = ep.status == 'running';
    if (isRunning) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFE53935),
          ),
          onPressed: () =>
              ref.read(entrypointListProvider.notifier).stop(widget.id),
          child: const Text('Stop'),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: FilledButton(
        onPressed: () =>
            ref.read(entrypointListProvider.notifier).start(widget.id),
        child: const Text('Start'),
      ),
    );
  }

  Widget _buildStatsSection(Entrypoint ep) {
    final stats = ep.stats;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Statistics',
            style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        Wrap(
          spacing: 4,
          runSpacing: 4,
          children: [
            _badge(
                '↕ ${stats.currentConns} / ${stats.totalConns} connections'),
            _badge('⚡ ${stats.requestRate.toStringAsFixed(1)} R/s'),
          ],
        ),
        const SizedBox(height: 12),
        StatsRow(
          icon: Icons.arrow_upward,
          iconColor: const Color(0xFF4CAF50),
          value: formatBytes(stats.inputBytes),
          rate: '${formatBytes(stats.inputRateBytes)}/s',
        ),
        const SizedBox(height: 4),
        StatsRow(
          icon: Icons.arrow_downward,
          iconColor: const Color(0xFF2196F3),
          value: formatBytes(stats.outputBytes),
          rate: '${formatBytes(stats.outputRateBytes)}/s',
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

  Future<void> _onSave() async {
    if (!_formKey.currentState!.validate()) return;

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
      if (mounted) context.pop();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e')),
        );
      }
    }
  }
}
