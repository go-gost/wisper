/// Type-specific form fields for tunnel creation/editing.
library;

import 'package:flutter/material.dart';

/// Renders type-specific form fields based on tunnel type.
class TunnelFormFields extends StatelessWidget {
  const TunnelFormFields({
    super.key,
    required this.type,
    required this.isEditing,
    required this.basicAuth,
    this.onBasicAuthChanged,
    required this.usernameCtrl,
    required this.passwordCtrl,
    required this.enableTLS,
    this.onEnableTLSChanged,
  });

  final String type;
  final bool isEditing;
  final bool basicAuth;
  final ValueChanged<bool>? onBasicAuthChanged;
  final TextEditingController usernameCtrl;
  final TextEditingController passwordCtrl;
  final bool enableTLS;
  final ValueChanged<bool>? onEnableTLSChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (type == 'file') _buildFileFields(context),
        if (type == 'http') _buildHttpFields(context),
        // TCP and UDP have no extra fields beyond name/endpoint
      ],
    );
  }

  Widget _buildFileFields(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        SwitchListTile(
          title: const Text('Basic Auth'),
          value: basicAuth,
          onChanged: isEditing ? onBasicAuthChanged : null,
          contentPadding: EdgeInsets.zero,
        ),
        if (basicAuth) ...[
          const SizedBox(height: 8),
          TextFormField(
            controller: usernameCtrl,
            decoration: const InputDecoration(
              labelText: 'Username',
              border: OutlineInputBorder(),
            ),
            readOnly: !isEditing,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: passwordCtrl,
            decoration: const InputDecoration(
              labelText: 'Password',
              border: OutlineInputBorder(),
            ),
            obscureText: true,
            readOnly: !isEditing,
          ),
        ],
      ],
    );
  }

  Widget _buildHttpFields(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        SwitchListTile(
          title: const Text('Rewrite Host'),
          value: false, // TODO: wire up
          onChanged: null, // TODO: wire up
          contentPadding: EdgeInsets.zero,
        ),
        SwitchListTile(
          title: const Text('Enable TLS'),
          value: enableTLS,
          onChanged: isEditing ? onEnableTLSChanged : null,
          contentPadding: EdgeInsets.zero,
        ),
      ],
    );
  }
}
