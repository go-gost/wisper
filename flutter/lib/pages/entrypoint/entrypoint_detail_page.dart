/// Entrypoint detail page — view/edit an entrypoint.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/entrypoint.dart';
import '../../providers/entrypoint_provider.dart';
import '../../providers/tunnel_provider.dart' show backendProvider;
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

  bool get _isNew => widget.id == 'new';

  @override
  void initState() {
    super.initState();
    _isEditing = _isNew;
    _nameCtrl = TextEditingController();
    _bindAddrCtrl = TextEditingController();
    _tunnelChainCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _bindAddrCtrl.dispose();
    _tunnelChainCtrl.dispose();
    super.dispose();
  }

  void _initControllers(Entrypoint ep) {
    if (_controllersInitialized) return;
    _controllersInitialized = true;
    _nameCtrl.text = ep.name;
    _bindAddrCtrl.text = ep.bindAddress;
    _tunnelChainCtrl.text = ep.tunnelChain;
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
                onPressed: () =>
                    setState(() { _isEditing = true; _controllersInitialized = false; }),
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
                  if (!_isNew && !_isEditing) ...[
                    CopyableText(text: ep?.id ?? ''),
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
        StatsRow(
          icon: Icons.arrow_upward,
          iconColor: const Color(0xFF4CAF50),
          value: _formatBytes(stats.inputBytes),
          rate: '${_formatBytes(stats.inputRateBytes)}/s',
        ),
        const SizedBox(height: 4),
        StatsRow(
          icon: Icons.arrow_downward,
          iconColor: const Color(0xFF2196F3),
          value: _formatBytes(stats.outputBytes),
          rate: '${_formatBytes(stats.outputRateBytes)}/s',
        ),
      ],
    );
  }

  static String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Future<void> _onSave() async {
    if (!_formKey.currentState!.validate()) return;

    final body = <String, dynamic>{
      'name': _nameCtrl.text,
      'type': widget.type,
      'endpoint': _bindAddrCtrl.text,
    };

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
