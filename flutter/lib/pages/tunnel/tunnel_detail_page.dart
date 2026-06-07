/// Tunnel detail page — view/edit/create a tunnel.
///
/// Parameterised by [type] (file/http/tcp/udp) and [id].
/// When [id] == 'new', the page is in create mode.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../l10n/app_localizations.dart';
import '../../models/tunnel.dart';
import '../../providers/tunnel_provider.dart';
import '../../providers/backend_provider.dart' show backendProvider;
import '../../providers/stats_provider.dart';
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
    // For file type, directory IS the endpoint (Go stores it as endpoint).
    _directoryCtrl.text = tunnel.options.directory.isNotEmpty
        ? tunnel.options.directory
        : tunnel.endpoint;
    _usernameCtrl.text = tunnel.options.username;
    _passwordCtrl.text = tunnel.options.password;
    _enableTLS = tunnel.options.enableTLS;
    _rewriteHost = tunnel.options.rewriteHost;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

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
          return _buildContent(context, l10n, tunnel);
        },
      );
    }

    // New tunnel — empty form
    return _buildContent(context, l10n, null);
  }

  Widget _buildContent(BuildContext context, AppLocalizations l10n, Tunnel? tunnel) {
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
              onPressed: () => _onToggleFavorite(tunnel),
            ),
            // Start/Stop
            _buildStartStopButton(context, l10n, tunnel),
            // Delete
            IconButton(
              icon: const Icon(Icons.delete_outline,
                  color: Color(0xFFE53935)),
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
                    decoration: InputDecoration(
                      labelText: l10n.fieldName,
                      border: const OutlineInputBorder(),
                    ),
                    readOnly: !_isEditing,
                    validator: (v) =>
                        (v == null || v.isEmpty) ? l10n.requiredField : null,
                  ),
                  const SizedBox(height: 16),

                  // Endpoint (hidden for file type — directory replaces it)
                  if (widget.type != 'file')
                    TextFormField(
                      controller: _endpointCtrl,
                      decoration: InputDecoration(
                        labelText: l10n.fieldEndpoint,
                        border: const OutlineInputBorder(),
                      ),
                      readOnly: !_isEditing,
                      validator: (v) =>
                          (v == null || v.isEmpty) ? l10n.requiredField : null,
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

                  // Stats section (view mode only) — uses live-polled stats
                  if (!_isEditing && tunnel != null) ...[
                    const SizedBox(height: 24),
                    _buildLiveStatsSection(tunnel),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStartStopButton(BuildContext context, AppLocalizations l10n, Tunnel? tunnel) {
    final isRunning = tunnel?.status == 'running';
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
  Widget _buildLiveStatsSection(Tunnel tunnel) {
    final l10n = AppLocalizations.of(context)!;
    final statsAsync = ref.watch(statsProvider);
    final liveStats = statsAsync.valueOrNull?[tunnel.id];

    // Fall back to tunnel snapshot if live stats unavailable.
    final currentConns = liveStats?.currentConns ?? tunnel.stats.currentConns;
    final totalConns = liveStats?.totalConns ?? tunnel.stats.totalConns;
    final requestRate = liveStats?.requestRate ?? tunnel.stats.requestRate;
    final inputBytes = liveStats?.inputBytes ?? tunnel.stats.inputBytes;
    final outputBytes = liveStats?.outputBytes ?? tunnel.stats.outputBytes;
    final inputRateBytes = liveStats?.inputRateBytes ?? tunnel.stats.inputRateBytes;
    final outputRateBytes = liveStats?.outputRateBytes ?? tunnel.stats.outputRateBytes;

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
      await ref.read(tunnelListProvider.notifier).start(widget.id);
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
      await ref.read(tunnelListProvider.notifier).stop(widget.id);
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
      await ref.read(tunnelListProvider.notifier).delete(widget.id);
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

  Future<void> _onToggleFavorite(Tunnel? tunnel) async {
    if (tunnel == null) return;
    final l10n = AppLocalizations.of(context)!;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(tunnelListProvider.notifier)
          .toggleFavorite(widget.id, tunnel.favorite);
      if (mounted) {
        messenger.showSnackBar(SnackBar(
          content: Text(
            tunnel.favorite ? l10n.favoriteRemoved : l10n.favoriteAdded,
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
      'endpoint': _endpointCtrl.text,
    };

    if (widget.type == 'file') {
      body['endpoint'] = _directoryCtrl.text;
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
