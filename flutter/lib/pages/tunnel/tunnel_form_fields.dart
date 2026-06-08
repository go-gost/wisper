/// Type-specific form fields for tunnel creation/editing.
library;

import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';

/// Renders type-specific form fields based on tunnel type.
class TunnelFormFields extends StatefulWidget {
  const TunnelFormFields({
    super.key,
    required this.type,
    required this.isEditing,
    required this.basicAuth,
    this.onBasicAuthChanged,
    required this.directoryCtrl,
    required this.usernameCtrl,
    required this.passwordCtrl,
    required this.enableTLS,
    this.onEnableTLSChanged,
    required this.rewriteHost,
    this.onRewriteHostChanged,
    required this.hostnameCtrl,
  });

  final String type;
  final bool isEditing;
  final bool basicAuth;
  final ValueChanged<bool>? onBasicAuthChanged;
  final TextEditingController directoryCtrl;
  final TextEditingController usernameCtrl;
  final TextEditingController passwordCtrl;
  final bool enableTLS;
  final ValueChanged<bool>? onEnableTLSChanged;
  final bool rewriteHost;
  final ValueChanged<bool>? onRewriteHostChanged;
  final TextEditingController hostnameCtrl;

  @override
  State<TunnelFormFields> createState() => _TunnelFormFieldsState();
}

class _TunnelFormFieldsState extends State<TunnelFormFields> {
  bool _obscurePassword = true;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.type == 'file') _buildFileFields(context),
        if (widget.type == 'http') _buildHttpFields(context),
        // TCP and UDP have no extra fields beyond name/endpoint
      ],
    );
  }

  Widget _buildFileFields(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        TextFormField(
          controller: widget.directoryCtrl,
          decoration: InputDecoration(
            labelText: l10n.fieldDirectory,
            border: const OutlineInputBorder(),
          ),
          readOnly: !widget.isEditing,
          validator: widget.isEditing
              ? (v) {
                  if (v == null || v.isEmpty) return l10n.requiredField;
                  return null;
                }
              : null,
        ),
        const SizedBox(height: 16),
        SwitchListTile(
          title: Text(l10n.switchBasicAuth),
          value: widget.basicAuth,
          onChanged: widget.isEditing ? widget.onBasicAuthChanged : null,
          contentPadding: EdgeInsets.zero,
        ),
        if (widget.basicAuth) ...[
          const SizedBox(height: 8),
          TextFormField(
            controller: widget.usernameCtrl,
            decoration: InputDecoration(
              labelText: l10n.fieldUsername,
              border: const OutlineInputBorder(),
            ),
            readOnly: !widget.isEditing,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: widget.passwordCtrl,
            decoration: InputDecoration(
              labelText: l10n.fieldPassword,
              border: const OutlineInputBorder(),
              suffixIcon: widget.isEditing
                  ? IconButton(
                      icon: Icon(
                        _obscurePassword ? Icons.visibility : Icons.visibility_off,
                      ),
                      onPressed: () =>
                          setState(() => _obscurePassword = !_obscurePassword),
                    )
                  : null,
            ),
            obscureText: _obscurePassword,
            readOnly: !widget.isEditing,
          ),
        ],
      ],
    );
  }

  Widget _buildHttpFields(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        SwitchListTile(
          title: Text(l10n.switchRewriteHost),
          value: widget.rewriteHost,
          onChanged: widget.isEditing ? widget.onRewriteHostChanged : null,
          contentPadding: EdgeInsets.zero,
        ),
        if (widget.rewriteHost) ...[
          const SizedBox(height: 8),
          TextFormField(
            controller: widget.hostnameCtrl,
            decoration: InputDecoration(
              labelText: l10n.fieldHostname,
              hintText: 'e.g. example.local',
              border: const OutlineInputBorder(),
            ),
            readOnly: !widget.isEditing,
          ),
        ],
        const SizedBox(height: 8),
        SwitchListTile(
          title: Text(l10n.switchEnableTLS),
          value: widget.enableTLS,
          onChanged: widget.isEditing ? widget.onEnableTLSChanged : null,
          contentPadding: EdgeInsets.zero,
        ),
      ],
    );
  }
}
