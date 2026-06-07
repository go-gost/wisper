/// Tunnel detail page — view/edit/create a tunnel.
///
/// Parameterised by [type] (file/http/tcp/udp) and [id].
/// When [id] == 'new', the page is in create mode.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/tunnel.dart';
import '../../providers/tunnel_provider.dart';
import '../../config/format.dart';
import '../../widgets/app_scaffold.dart';
import '../../widgets/copyable_text.dart';
import '../../widgets/delete_confirm_dialog.dart';
import '../../widgets/stats_row.dart';
import 'tunnel_form_fields.dart';

/// Detail page for a single tunnel.
class TunnelDetailPage extends ConsumerStatefulWidget {
  const TunnelDetailPage({
    super.key,
    required this.type,
    required this.id,
  });

  final String type;
  final String id;

  @override
  ConsumerState<TunnelDetailPage> createState() => _TunnelDetailPageState();
}

class _TunnelDetailPageState extends ConsumerState<TunnelDetailPage> {
  late bool _isEditing;
  bool _controllersInitialized = false;
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _nameCtrl;
  late TextEditingController _endpointCtrl;

  // File tunnel fields
  late TextEditingController _directoryCtrl;
  bool _basicAuth = false;
  late TextEditingController _usernameCtrl;
  late TextEditingController _passwordCtrl;

  // HTTP tunnel fields
  bool _enableTLS = false;
  bool _rewriteHost = false;

  bool get _isNew => widget.id == 'new';

  @override
  void initState() {
    super.initState();
    _isEditing = _isNew;
    _nameCtrl = TextEditingController();
    _endpointCtrl = TextEditingController();
    _directoryCtrl = TextEditingController();
    _usernameCtrl = TextEditingController();
    _passwordCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _endpointCtrl.dispose();
    _directoryCtrl.dispose();
    _usernameCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  void _initControllers(Tunnel tunnel) {
    if (_controllersInitialized) return;
    _controllersInitialized = true;
    _nameCtrl.text = tunnel.name;
    _endpointCtrl.text = tunnel.endpoint;
    _basicAuth = tunnel.options.basicAuth;
    _directoryCtrl.text = tunnel.options.directory;
    _usernameCtrl.text = tunnel.options.username;
    _passwordCtrl.text = tunnel.options.password;
    _enableTLS = tunnel.options.enableTLS;
    _rewriteHost = tunnel.options.rewriteHost;
  }

  @override
  Widget build(BuildContext context) {
    // Load existing tunnel data when not creating new
    if (!_isNew) {
      final tunnelAsync = ref.watch(tunnelProvider(widget.id));

      return tunnelAsync.when(
        loading: () => AppScaffold(
          appBar: AppBar(
            leading: BackButton(onPressed: () => context.pop()),
            title: Text(widget.type.toUpperCase()),
          ),
          body: const Center(child: CircularProgressIndicator()),
        ),
        error: (e, _) => AppScaffold(
          appBar: AppBar(
            leading: BackButton(onPressed: () => context.pop()),
            title: Text(widget.type.toUpperCase()),
          ),
          body: Center(child: Text('Error: $e')),
        ),
        data: (tunnel) {
          if (!_isEditing) _initControllers(tunnel);
          return _buildContent(context, tunnel);
        },
      );
    }

    // New tunnel — empty form
    return _buildContent(context, null);
  }

  Widget _buildContent(BuildContext context, Tunnel? tunnel) {
    return AppScaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.pop()),
        title: Text(widget.type.toUpperCase()),
        actions: [
          if (!_isNew) ...[
            // Favorite
            IconButton(
              icon: Icon(
                tunnel?.favorite == true ? Icons.star : Icons.star_outline,
                color: tunnel?.favorite == true
                    ? const Color(0xFFF44336)
                    : null,
              ),
              onPressed: () {
                if (tunnel != null) {
                  ref
                      .read(tunnelListProvider.notifier)
                      .toggleFavorite(widget.id, tunnel.favorite);
                }
              },
            ),
            // Start/Stop
            _buildStartStopButton(tunnel),
            // Delete
            IconButton(
              icon: const Icon(Icons.delete_outline,
                  color: Color(0xFFE53935)),
              onPressed: () async {
                final confirm = await DeleteConfirmDialog.show(context);
                if (confirm) {
                  await ref
                      .read(tunnelListProvider.notifier)
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
                  // View-only fields
                  if (!_isNew && !_isEditing) ...[
                    CopyableText(text: tunnel?.id ?? ''),
                    const SizedBox(height: 10),
                    if (tunnel?.entrypoint.isNotEmpty == true)
                      CopyableText(text: tunnel!.entrypoint),
                    const SizedBox(height: 10),
                  ],

                  // Error display
                  if (!_isEditing &&
                      tunnel != null &&
                      tunnel.error.isNotEmpty) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE53935).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline,
                              size: 18, color: Color(0xFFE53935)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              tunnel.error,
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

                  // Endpoint (hidden for file type — directory replaces it)
                  if (widget.type != 'file')
                    TextFormField(
                      controller: _endpointCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Endpoint',
                        border: OutlineInputBorder(),
                      ),
                      readOnly: !_isEditing,
                      validator: (v) =>
                          (v == null || v.isEmpty) ? 'Required' : null,
                    ),

                  // Type-specific fields
                  TunnelFormFields(
                    type: widget.type,
                    isEditing: _isEditing,
                    basicAuth: _basicAuth,
                    onBasicAuthChanged: (v) =>
                        setState(() => _basicAuth = v),
                    directoryCtrl: _directoryCtrl,
                    usernameCtrl: _usernameCtrl,
                    passwordCtrl: _passwordCtrl,
                    enableTLS: _enableTLS,
                    onEnableTLSChanged: (v) =>
                        setState(() => _enableTLS = v),
                    rewriteHost: _rewriteHost,
                    onRewriteHostChanged: (v) =>
                        setState(() => _rewriteHost = v),
                  ),

                  // Stats section (view mode only)
                  if (!_isEditing && tunnel != null) ...[
                    const SizedBox(height: 24),
                    _buildStatsSection(tunnel),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStartStopButton(Tunnel? tunnel) {
    final isRunning = tunnel?.status == 'running';
    if (isRunning) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFE53935),
          ),
          onPressed: () =>
              ref.read(tunnelListProvider.notifier).stop(widget.id),
          child: const Text('Stop'),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: FilledButton(
        onPressed: () =>
            ref.read(tunnelListProvider.notifier).start(widget.id),
        child: const Text('Start'),
      ),
    );
  }

  Widget _buildStatsSection(Tunnel tunnel) {
    final stats = tunnel.stats;
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
      'endpoint': _endpointCtrl.text,
    };

    if (widget.type == 'file') {
      body['endpoint'] = _directoryCtrl.text;
      body['directory'] = _directoryCtrl.text;
      body['basic_auth'] = _basicAuth;
      body['username'] = _basicAuth ? _usernameCtrl.text : '';
      body['password'] = _basicAuth ? _passwordCtrl.text : '';
    }
    if (widget.type == 'http') {
      body['enableTLS'] = _enableTLS;
      body['rewriteHost'] = _rewriteHost;
    }

    try {
      final backend = ref.read(backendProvider);
      if (_isNew) {
        await backend.createTunnel(body);
      } else {
        await backend.updateTunnel(widget.id, body);
      }
      await ref.read(tunnelListProvider.notifier).refresh();
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
