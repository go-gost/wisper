package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The web assets have two sources — the embedded copy and a development
// directory — and picking the wrong one is silent: the page still loads, so a
// stale directory (or a missing one quietly falling back to the embed) looks
// like "my change did nothing" rather than an error.

func TestWebAssetsPrefersTheFlagOverTheEnv(t *testing.T) {
	oldFlag, oldEnv := webDirFlag, os.Getenv("WISPER_WEB_DIR")
	t.Cleanup(func() {
		webDirFlag = oldFlag
		if oldEnv == "" {
			_ = os.Unsetenv("WISPER_WEB_DIR")
		} else {
			_ = os.Setenv("WISPER_WEB_DIR", oldEnv)
		}
	})

	fromEnv := t.TempDir()
	if err := os.Setenv("WISPER_WEB_DIR", fromEnv); err != nil {
		t.Fatal(err)
	}
	fromFlag := t.TempDir()

	// Precedence: flag > env, the same order the log flags use.
	webDirFlag = ""
	if got := resolveWebDir(); got != fromEnv {
		t.Errorf("env alone: dir = %q, want %q", got, fromEnv)
	}
	webDirFlag = fromFlag
	if got := resolveWebDir(); got != fromFlag {
		t.Errorf("flag set: dir = %q, want the flag to win (%q)", got, fromFlag)
	}

	// Unset both: the embedded copy.
	webDirFlag = ""
	_ = os.Unsetenv("WISPER_WEB_DIR")
	if got := resolveWebDir(); got != "" {
		t.Errorf("neither set: dir = %q, want the embedded copy", got)
	}
}

func TestWebAssetsServesTheDirectory(t *testing.T) {
	oldFlag := webDirFlag
	t.Cleanup(func() { webDirFlag = oldFlag })

	dir := t.TempDir()
	// Not index.html alone: the SPA fallback and the asset lookup share the
	// sub-FS, so a file at the top level must be reachable.
	for name, body := range map[string]string{
		"index.html":    "<!doctype html><title>dev</title>",
		"assets/app.js": "console.log('dev')",
	} {
		full := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	webDirFlag = dir

	h := webFileServer()
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	if got := get("/").Body.String(); !strings.Contains(got, "<title>dev</title>") {
		t.Errorf("GET / = %q, want the directory's index.html", got)
	}
	if got := get("/assets/app.js").Body.String(); !strings.Contains(got, "console.log") {
		t.Errorf("GET /assets/app.js = %q, want the directory's asset", got)
	}
	// SPA fallback still holds for a client-side route that is not a file.
	if got := get("/entrypoint/tun/abc").Body.String(); !strings.Contains(got, "<title>dev</title>") {
		t.Errorf("SPA fallback = %q, want index.html", got)
	}

	// A change on disk is visible without a restart — the whole point.
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>edited</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := get("/").Body.String(); !strings.Contains(got, "edited") {
		t.Error("an edit on disk was not served: this path exists to skip the rebuild")
	}
}

// A directory that is not there must not fall back to the embedded copy: that
// would serve a stale UI from the binary and look exactly like "the dev mode
// did not take", which is the failure this whole path is meant to prevent.
func TestWebAssetsRefusesAMissingDirectory(t *testing.T) {
	oldFlag := webDirFlag
	t.Cleanup(func() { webDirFlag = oldFlag })

	webDirFlag = filepath.Join(t.TempDir(), "does-not-exist")

	if _, err := webAssets(); err == nil {
		t.Error("a missing web dir was accepted; it would silently serve the embedded copy")
	}

	// And the server must not come up serving the wrong thing either.
	rec := httptest.NewRecorder()
	webFileServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), "<title>") {
		t.Errorf("served a page with a missing web dir: %q", rec.Body.String())
	}
}

func TestWebAssetsEmbeddedByDefault(t *testing.T) {
	oldFlag := webDirFlag
	t.Cleanup(func() { webDirFlag = oldFlag })
	webDirFlag = ""

	assets, err := webAssets()
	if err != nil {
		t.Fatalf("embedded assets: %v", err)
	}
	// The embedded tree is rooted at web/, so it must already be there.
	if _, err := fs.Stat(assets, "index.html"); err != nil {
		t.Errorf("embedded copy has no index.html: %v", err)
	}
}
