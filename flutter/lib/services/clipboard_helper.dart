/// Cross-platform clipboard helper.
///
/// Uses conditional imports to select the correct implementation:
/// - Web: uses JS interop with execCommand fallback (works on HTTP)
/// - IO: uses Flutter's Clipboard API
library;

export 'clipboard_helper_stub.dart'
    if (dart.library.html) 'clipboard_helper_web.dart';
