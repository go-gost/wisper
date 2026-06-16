# Android App Polish Plan — Completing Remaining Features

## Context

The Android Wisper APK is functionally working on Pixel 9 (Android 16): Go backend starts in-process via JNI, foreground service keeps tunnels alive, notification with Stop action works, WebView loads the Lit UI. Verified via logcat + `curl` on device.

However, the app shell is still **minimal** — several features expected in a production Android app are missing. This plan fills the gaps while keeping the scope aligned with the design spec (no boot auto-start, no iOS, no new tunnel features).

## What's Missing

| # | Feature | Priority | Effort |
|---|---------|----------|--------|
| 1 | App launcher icon (adaptive) | **High** | Small |
| 2 | Back button navigates WebView history | **High** | Small |
| 3 | WebView respects system dark/light theme | **High** | Small |
| 4 | Loading indicator while backend starts | Medium | Small |
| 5 | Error page when backend fails | Medium | Small |
| 6 | Edge-to-edge display insets | Medium | Small |

## Implementation Plan

### 1. App Launcher Icon (adaptive icon)

**Problem:** No `mipmap` resources — app shows default Android icon.

**Solution:** Create adaptive icon XML referencing existing `appicon.png` (512×512).

- Create `res/mipmap-anydpi-v26/ic_launcher.xml` — adaptive icon with `<adaptive-icon>`: `<background>` = solid #1a1a2e (dark brand bg), `<foreground>` = inset version of appicon
- Create `res/mipmap-anydpi-v26/ic_launcher_round.xml` — same for round mask
- Create `res/values/ic_launcher_background.xml` — color resource
- Reference existing `appicon.png` as foreground (can use `<bitmap>` drawable wrapping it, placed in `res/drawable/`)
- Alternatively: create a simple vector drawable XML for the ghost logo to avoid bitmap scaling issues
- Set `android:icon` and `android:roundIcon` in AndroidManifest

**Files to create:**
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- `android/app/src/main/res/drawable/ic_launcher_foreground.xml` (vector drawable ghost logo)
- `android/app/src/main/res/values/colors.xml` (brand colors)

**Files to modify:**
- `android/app/src/main/AndroidManifest.xml` — add `android:icon` / `android:roundIcon`

### 2. Back Button WebView Navigation

**Problem:** Pressing Android back button with WebView history does nothing or exits app immediately.

**Solution:** Override `onBackPressed()` with WebView history check.

```kotlin
override fun onBackPressed() {
    if (webView.canGoBack()) {
        webView.goBack()
    } else {
        super.onBackPressed()
    }
}
```

Also handle `BackHandler` for `onKeyDown` if needed (for older API edge cases), but `onBackPressed()` covers API 5+.

**Files to modify:**
- `android/app/src/main/java/run/gost/wisper/MainActivity.kt`

### 3. WebView Dark Theme

**Problem:** The Lit UI themes via `:root.dark` CSS class, toggled by settings page. On Android the WebView always starts in light mode regardless of system setting.

**Solution:** Detect Android system `UiMode` and inject JavaScript to apply the correct theme class before the page loads (or immediately after).

The web app's `index.html` already has `<meta name="color-scheme" content="light dark">` and a CSS `prefers-color-scheme` hack isn't present — it uses `.dark` class. So we need to:

1. Detect night mode: `resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK`
2. After `onPageFinished`, evaluate JavaScript: `document.documentElement.classList.add('dark')` when system is dark

Also configure `WebSettings`:
- `setAlgorithmicDarkeningAllowed(true)` (API 33+) — for content that doesn't support dark mode

**Files to modify:**
- `android/app/src/main/java/run/gost/wisper/MainActivity.kt`

### 4. Loading Indicator

**Problem:** When app opens, user sees blank WebView until backend starts and page loads. No indication anything is happening.

**Solution:** Show a `ProgressBar` (centered, indeterminate) on top of WebView. Hide it when `onPageFinished` fires.

Alternative: Show a simple HTML pre-load page with the Wisper logo and "Starting..." text, then redirect to backend URL when service is ready.

I'll use the `ProgressBar` approach — simpler, fewer edge cases.

```kotlin
// In onCreate:
val progressBar = ProgressBar(this).apply {
    isIndeterminate = true
}
// Use FrameLayout to layer ProgressBar over WebView
val layout = FrameLayout(this).apply {
    addView(webView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    addView(progressBar, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply {
        gravity = Gravity.CENTER
    })
}
setContentView(layout)

// In WebViewClient.onPageFinished:
progressBar.visibility = View.GONE
```

**Files to modify:**
- `android/app/src/main/java/run/gost/wisper/MainActivity.kt`

### 5. Error State

**Problem:** If backend fails to start, WebView shows "net::ERR_CONNECTION_REFUSED" — not user-friendly.

**Solution:** Set a `WebViewClient` with `onReceivedError` that shows an error page with a "Retry" button.

```kotlin
webView.webViewClient = object : WebViewClient() {
    override fun onPageFinished(view: WebView?, url: String?) {
        progressBar.visibility = View.GONE
    }

    override fun onReceivedError(
        view: WebView?, request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        if (error?.errorCode == ERROR_CONNECT_REFUSED || error?.errorCode == ERROR_TIMEOUT) {
            // Show error state with retry button
            showErrorState()
        }
    }
}
```

The error state can be a `TextView` + `Button` in the FrameLayout, or load a `data:` URI with inline HTML.

**Files to modify:**
- `android/app/src/main/java/run/gost/wisper/MainActivity.kt`

### 6. Edge-to-Edge Display Insets

**Problem:** On Android 15+ (API 35, Pixel 9), the default is edge-to-edge. Status bar and navigation bar may overlap WebView content.

**Solution:** Apply `WindowInsetsCompat` to add padding to the WebView container. Use `ViewCompat.setOnApplyWindowInsetsListener` on the root layout.

```kotlin
ViewCompat.setOnApplyWindowInsetsListener(mainLayout) { view, insets ->
    val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
    view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
    insets
}
```

Also call `enableEdgeToEdge()` in `onCreate` (from `androidx.activity`).

But wait — `minSdk = 26`, and we only have `core-ktx` + `appcompat` dependencies. `enableEdgeToEdge()` is in `activity-ktx`. To avoid adding a dependency, use the `WindowInsetsCompat` approach with `core-ktx` (already included).

Actually, for the WebView, we typically DON'T want edge-to-edge — the web content needs to scroll, and system bars overlapping it is bad UX. The simplest approach: set `android:windowSoftInputMode="adjustResize"` + apply system bar insets as padding on the WebView.

**Files to modify:**
- `android/app/src/main/java/run/gost/wisper/MainActivity.kt`

## WebViewClient Consolidation

All the WebView behavior improvements (loading, error, dark mode injection) can be consolidated into a single `WebViewClient` subclass. The MainActivity rewrite will be clean:

```kotlin
// Pseudocode structure
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: View
    private lateinit var rootLayout: FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 1. Create views
        // 2. Configure WebView (settings + WebViewClient)
        // 3. Apply edge-to-edge insets
        // 4. Request notification permission / start service
    }

    // Back button
    override fun onBackPressed() { /* WebView history */ }

    // Service connection — same as current
    // Menu — same as current
}
```

## Verification

1. **Build:** `make android` produces APK without errors
2. **Icon:** Install on Pixel 9 → app drawer shows Wisper ghost icon (not default Android icon)
3. **Dark theme:** Set phone to dark mode → open app → WebView shows dark themed UI (dark blue bg)
4. **Light theme:** Set phone to light mode → reopen → WebView shows light theme
5. **Loading:** Fresh install → ProgressBar spinner visible before WebView loads
6. **Back navigation:** Navigate to tunnel detail page → press back → goes back to list (not exits app)
7. **Back exit:** On home page → press back → app exits normally
8. **Error:** Force backend failure → error UI shown with retry option
9. **Edge-to-edge:** WebView content not hidden behind status bar or nav bar
10. **Regression:** Tunnels survive background/screen-off/swipe-away, Stop works
