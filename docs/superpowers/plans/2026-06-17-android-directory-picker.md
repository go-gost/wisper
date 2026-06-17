# Android Native Directory Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Browse" button next to the directory text field in the file tunnel form on Android, letting users pick a directory via `ACTION_OPEN_DOCUMENT_TREE`.

**Architecture:** Android `JsBridge` inner class with `@JavascriptInterface` exposes `pickDir()` to the WebView. A Lit `button` in `tunnel-detail-page.ts` feature-detects `window.WisperNative` and calls it. On result, the content URI is resolved to a real filesystem path and sent back via `evaluateJavascript`.

**Tech Stack:** Kotlin (Android), Lit/TypeScript (Web UI), i18n key-value pairs (en + zh)

---

### Task 1: Add i18n keys for the Browse button

**Files:**
- Modify: `web-src/src/i18n/en.ts`
- Modify: `web-src/src/i18n/zh.ts`

- [ ] **Step 1: Add English key**

In `web-src/src/i18n/en.ts`, add `browseDirectory` after the `fieldDirectory` line (line 49):

```typescript
fieldDirectory: 'Directory',
browseDirectory: 'Browse',
```

- [ ] **Step 2: Add Chinese key**

In `web-src/src/i18n/zh.ts`, add `browseDirectory` after the `fieldDirectory` line (line 49):

```typescript
fieldDirectory: '目录',
browseDirectory: '浏览',
```

- [ ] **Step 3: Commit**

```bash
git add web-src/src/i18n/en.ts web-src/src/i18n/zh.ts
git commit -m "feat: add browseDirectory i18n key (en + zh)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add Browse button to tunnel detail page

**Files:**
- Modify: `web-src/src/pages/tunnel-detail-page.ts`

- [ ] **Step 1: Add `_browseDir()` method**

Add this method to the `TunnelDetailPage` class after the existing state declarations (after line 39, before `_unsubs`):

```typescript
// Native bridge detection
private get _isNativeDirPicker(): boolean {
  return !!(window as any).WisperNative?.pickDir;
}

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

- [ ] **Step 2: Replace the directory form group (lines 857-864) with Browse button inline**

Replace:

```html
<!-- Target / Directory -->
<div class="form-group">
  <label class="form-label">
    ${this.tunnelType === 'file' ? t('fieldDirectory') : t('fieldEndpoint')}
  </label>
  <input class="form-input" .value=${this._endpoint}
    placeholder=${this.tunnelType === 'http' ? 'http://localhost:3000' : this.tunnelType === 'file' ? '/path/to/dir' : 'host:port'}
    @input=${(e: Event) => { this._endpoint = (e.target as HTMLInputElement).value; }}>
</div>
```

With:

```html
<!-- Target / Directory -->
<div class="form-group">
  <label class="form-label">
    ${this.tunnelType === 'file' ? t('fieldDirectory') : t('fieldEndpoint')}
  </label>
  <div class="dir-input-row">
    <input class="form-input dir-input" .value=${this._endpoint}
      placeholder=${this.tunnelType === 'http' ? 'http://localhost:3000' : this.tunnelType === 'file' ? '/path/to/dir' : 'host:port'}
      @input=${(e: Event) => { this._endpoint = (e.target as HTMLInputElement).value; }}>
    ${this.tunnelType === 'file' && this._isNativeDirPicker
      ? html`<button type="button" class="browse-btn"
          @click=${this._browseDir}>📁 ${t('browseDirectory')}</button>`
      : ''}
  </div>
</div>
```

- [ ] **Step 3: Add CSS for `.dir-input-row` and `.browse-btn`**

In the `static styles` block, after the `.form-input[readonly]` block (after line 504), add:

```css
/* ── Directory picker ── */
.dir-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dir-input {
  flex: 1;
}
.browse-btn {
  white-space: nowrap;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text);
  font-size: var(--font-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.browse-btn:hover {
  background: var(--border-subtle);
  border-color: var(--accent);
}
```

- [ ] **Step 4: Verify web build**

```bash
make web
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add web-src/src/pages/tunnel-detail-page.ts
git commit -m "feat: add Browse button for native directory picker in file tunnel form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add JsBridge + directory picker to MainActivity

**Files:**
- Modify: `android/app/src/main/java/run/gost/wisper/MainActivity.kt`

- [ ] **Step 1: Add imports**

At the top of the file, after the existing imports (after line 36), add:

```kotlin
import android.app.Activity
import android.content.Intent
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
```

(Note: `Intent` is already imported. `Activity` may not be needed directly but `registerForActivityResult` requires it from `ComponentActivity` which `AppCompatActivity` extends.)

- [ ] **Step 2: Add directory picker fields to MainActivity class**

After the existing companion object (lines 40-44), add these fields:

```kotlin
// ── Directory picker ─────────────────────────────────────────────────
private var pendingDirCallback: String? = null

private val dirPickerLauncher: ActivityResultLauncher<Intent> =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = pendingDirCallback ?: return@registerForActivityResult
        pendingDirCallback = null

        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            return@registerForActivityResult
        }

        val uri = result.data?.data ?: return@registerForActivityResult

        // Take persistable read permission
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: Exception) {
            // Some providers don't support persistable permissions
        }

        val path = resolveDocumentTreeUri(uri)
        val escaped = path.replace("\\", "\\\\").replace("'", "\\'")
        webView.evaluateJavascript("$callback('$escaped')", null)
    }
```

- [ ] **Step 3: Add `resolveDocumentTreeUri` method**

Add this method to the `MainActivity` class:

```kotlin
private fun resolveDocumentTreeUri(uri: android.net.Uri): String {
    try {
        val docId = DocumentsContract.getTreeDocumentId(uri)
        val parts = docId.split(":", limit = 2)
        val volume = parts[0]
        val relativePath = if (parts.size > 1) parts[1] else ""

        val root = if (volume.equals("primary", ignoreCase = true)) {
            android.os.Environment.getExternalStorageDirectory().absolutePath
        } else {
            "/storage/$volume"
        }

        return if (relativePath.isEmpty()) root else "$root/$relativePath"
    } catch (e: Exception) {
        Toast.makeText(
            this,
            "Could not resolve directory path — using URI",
            Toast.LENGTH_SHORT
        ).show()
        return uri.toString() ?: "/"
    }
}
```

- [ ] **Step 4: Add `JsBridge` inner class**

Add this inner class at the bottom of `MainActivity` (before the final closing `}`):

```kotlin
// ── JavaScript Bridge ──────────────────────────────────────────────
private inner class JsBridge {
    @android.webkit.JavascriptInterface
    fun pickDir(callbackId: String) {
        runOnUiThread {
            pendingDirCallback = callbackId
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
            }
            try {
                dirPickerLauncher.launch(intent)
            } catch (e: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    "Could not open directory picker",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }
}
```

- [ ] **Step 5: Register the JsBridge on the WebView**

In `onCreate()`, after `webView = WebView(this).apply { ... }` (after line 94), add:

```kotlin
// Register native bridge for directory picker
webView.addJavascriptInterface(JsBridge(), "WisperNative")
```

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/run/gost/wisper/MainActivity.kt
git commit -m "feat(android): add native directory picker bridge for file tunnel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Build and smoke-test the web UI

**Files:** None new

- [ ] **Step 1: Rebuild web**

```bash
make web-force
```

Expected: build succeeds, output in `web/` directory.

- [ ] **Step 2: Rebuild Go backend**

```bash
go build -o wisper .
```

Expected: build succeeds, embeds the updated `web/` directory.

- [ ] **Step 3: Verify the Browse button is hidden in desktop browser**

```bash
./wisper &
sleep 1
# Open in a desktop browser — the Browse button should NOT appear
# because window.WisperNative is not injected.
```

Manual check: navigate to Create File Tunnel — verify the directory field is a simple text input with no Browse button.

- [ ] **Step 4: Verify the Browse button appears in Android WebView**

Build and install APK:

```bash
make android-debug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Manual check on device:
1. Open Wisper
2. Navigate to Create → File tunnel
3. Verify "📁 Browse" button appears next to the directory field
4. Tap Browse → verify system directory picker opens
5. Select a directory → verify the path fills into the input field
6. Press back to cancel → verify the field is unchanged

- [ ] **Step 5: Commit (if any changes from smoke test)**

```bash
git add -A
git commit -m "chore: finalize Android directory picker feature

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
