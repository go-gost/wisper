# Android Native Directory Picker for File Tunnel

**Date:** 2026-06-17
**Status:** Design approved, pending implementation

## Goal

Add a "Browse" button next to the directory text field in the file tunnel form on Android, letting users pick a directory via the system's native file picker instead of typing a path manually.

## Scope

- **In scope:** Android — launch `ACTION_OPEN_DOCUMENT_TREE`, resolve content URI to real filesystem path, fill the directory form field
- **Out of scope:** Desktop (Tauri) native picker, in-app file tree browser, file (non-directory) picking, web fallback

## Architecture

Three layers, two files changed:

```
Web UI (tunnel-detail-page.ts)
    │ click "Browse" → window.WisperNative.pickDir(callbackId)
    │               ← window[callbackId]('/storage/emulated/0/Download')
    │
    │ @JavascriptInterface bridge
    │
MainActivity.kt — JsBridge inner class
    │ Intent(ACTION_OPEN_DOCUMENT_TREE)
    │ ActivityResultLauncher → content:// URI
    │ DocumentsContract → real path resolution
    │ webView.evaluateJavascript("callbackName('/real/path')")
```

## UI Details

- A "Browse" button appears next to the directory `<input>` **only when** both conditions are true:
  1. The tunnel type is `file`
  2. `window.WisperNative?.pickDir` exists (feature detection)
- The text field remains editable — user can still type a path manually
- On picker cancel: nothing happens (field keeps current value)
- On picker error: Toast displayed on Android, no change to field

### Placement in the form

```
Directory: [/path/to/dir        ] [📁 Browse]
```

Button is inline to the right of the input. Uses system-default styling on Android (WebView context). On the Lit side, it's a simple `<button>` element.

## Android Implementation

### `JsBridge` class — new inner class in `MainActivity.kt`

```kotlin
private inner class JsBridge {
    @JavascriptInterface
    fun pickDir(callbackId: String) {
        pendingDirCallback = callbackId
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
                     Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        dirPickerLauncher.launch(intent)
    }
}
```

### `ActivityResultLauncher` — registered in `onCreate`

```kotlin
private var pendingDirCallback: String? = null

private val dirPickerLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
) { result ->
    val callback = pendingDirCallback ?: return@registerForActivityResult
    pendingDirCallback = null

    if (result.resultCode != RESULT_OK || result.data == null) {
        // User cancelled — do nothing
        return@registerForActivityResult
    }

    val uri = result.data?.data ?: return@registerForActivityResult

    // Take persistable permission so the Go backend can access the directory
    contentResolver.takePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION
    )

    val path = resolveDocumentTreeUri(uri)

    val escaped = path.replace("\\", "\\\\").replace("'", "\\'")
    webView.evaluateJavascript("$callback('$escaped')", null)
}
```

### Content URI → real path resolution

`resolveDocumentTreeUri(uri: Uri): String` — resolved in this order:

1. **Extract document ID** via `DocumentsContract.getTreeDocumentId(uri)` — yields e.g. `primary:Download/music`
2. **Split on colon** → volume (`primary`) and relative path (`Download/music`)
3. **Map volume to root:**
   - `primary` → `Environment.getExternalStorageDirectory().absolutePath` (typically `/storage/emulated/0`)
   - Other volumes → `/storage/<volume-id>`
4. **Join** root + relative path → `/storage/emulated/0/Download/music`
5. **Fallback:** if resolution fails at any step, return `uri.toString()` (the content URI) and show a Toast warning that the Go backend may not be able to access it

```kotlin
private fun resolveDocumentTreeUri(uri: Uri): String {
    try {
        val docId = DocumentsContract.getTreeDocumentId(uri)
        val parts = docId.split(":", limit = 2)
        val volume = parts[0]
        val relativePath = if (parts.size > 1) parts[1] else ""

        val root = if (volume.equals("primary", ignoreCase = true)) {
            Environment.getExternalStorageDirectory().absolutePath
        } else {
            "/storage/$volume"
        }

        return if (relativePath.isEmpty()) root else "$root/$relativePath"
    } catch (e: Exception) {
        Toast.makeText(this, "Could not resolve directory path — using URI", Toast.LENGTH_SHORT).show()
        return uri.toString() ?: "/"
    }
}
```

### Bridge registration

In `onCreate`, after WebView is created but before loading the URL:

```kotlin
webView.addJavascriptInterface(JsBridge(), "WisperNative")
```

### Permission note

`ACTION_OPEN_DOCUMENT_TREE` does **not** require `MANAGE_EXTERNAL_STORAGE`. The existing `checkStorageThenStart()` flow is unchanged. The `takePersistableUriPermission` call ensures the Go backend (running as the same Linux UID) can read the selected directory.

## Web UI Implementation

### Detection

```typescript
// In tunnel-detail-page.ts
private get _isNativeDirPicker(): boolean {
  return !!(window as any).WisperNative?.pickDir;
}
```

### Callback registration

When the user clicks "Browse":

```typescript
private _browseDir() {
  const cbName = '__wisper_dir_callback__';
  (window as any)[cbName] = (path: string) => {
    this._endpoint = path;
    this.requestUpdate();
    delete (window as any)[cbName];
  };
  (window as any).WisperNative.pickDir(cbName);
}
```

### Template

The Browse button renders only for `file` tunnel type when the bridge is available:

```typescript
${this.tunnelType === 'file' && this._isNativeDirPicker
  ? html`<button type="button" class="browse-btn"
      @click=${this._browseDir}>📁 Browse</button>`
  : ''}
```

Placed inside the form field group containing the directory input, in a horizontal row (`display: flex; gap: 8px; align-items: center`).

### CSS

Minimal styling to fit inline with the input:

```css
.browse-btn {
  white-space: nowrap;
  padding: 0 12px;
  height: 40px;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  background: var(--btn-bg, #f5f5f5);
  color: var(--text-color, #333);
  cursor: pointer;
  font-size: 14px;
}
```

### i18n

Add new key `browseDirectory`:
- `en.ts`: `"Browse"`
- `zh.ts`: `"浏览"`

## Testing

### Manual test (Android)

1. Build & install APK on device/emulator
2. Open app → Create File tunnel
3. Verify "Browse" button appears next to directory field
4. Tap Browse → system directory picker opens
5. Select a directory → field fills with resolved path
6. Tap Browse → press back/cancel → field unchanged
7. Verify the Go backend can serve files from the picked directory

### Unit test (Web UI)

- [ ] Browse button renders when `_isNativeDirPicker` is true and tunnel type is `file`
- [ ] Browse button hidden when `WisperNative` is absent (desktop/browser)
- [ ] Browse button hidden for non-file tunnel types
- [ ] Clicking Browse calls `WisperNative.pickDir` with a callback name
- [ ] Callback updates `_endpoint` state

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `android/app/src/main/java/run/gost/wisper/MainActivity.kt` | Add `JsBridge` inner class, `ActivityResultLauncher`, URI resolver | ~60 |
| `web-src/src/pages/tunnel-detail-page.ts` | Add Browse button + bridge detection + callback handler | ~30 |
| `web-src/src/i18n/en.ts` | Add `browseDirectory` key | +1 |
| `web-src/src/i18n/zh.ts` | Add `browseDirectory` key | +1 |

## Future

- **Desktop (Tauri):** Register `WisperNative.pickDir` via Tauri's `dialog` plugin (`@tauri-apps/plugin-dialog`). Same interface, different native backend. No web UI changes needed.
- **Multi-platform abstraction:** If more native features are added, consider extracting a `NativeBridge` TypeScript class with typed methods instead of ad-hoc `window` properties.
