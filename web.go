package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
)

//go:embed web/*
var webFS embed.FS

// webDirFlag is set by main from -web-dir, which defaults to the same env var,
// so an explicit flag wins over the environment (the log flags use the same
// flag > env precedence).
var webDirFlag string

// resolveWebDir is the directory to serve from: the flag if given, else the
// environment, else "" for the embedded copy.
func resolveWebDir() string {
	if webDirFlag != "" {
		return webDirFlag
	}
	return os.Getenv("WISPER_WEB_DIR")
}

// webAssets returns the built assets with the sub-tree the handler serves
// rooted at it: the embedded copy, or webDir when it is set.
func webAssets() (fs.FS, error) {
	dir := resolveWebDir()
	if dir != "" {
		// Logged once at startup, because a stale directory that still serves is
		// the failure mode a developer will not notice.
		slog.Info("web: serving from disk (development)", "dir", dir)
		if _, err := os.Stat(dir); err != nil {
			// Not a fallback to the embedded copy: a stale bundle that still
			// serves is the trap this whole path exists to avoid, and a wrong
			// directory must say so rather than quietly serve something else.
			return nil, fmt.Errorf("web dir %s: %w", dir, err)
		}
		return os.DirFS(dir), nil
	}
	return fs.Sub(webFS, "web")
}

// webFileServer returns an http.Handler that serves the web UI files — the
// embedded ones, or webDir when it is set. It implements SPA fallback:
// requests that don't match a static file serve index.html.
// Cache-Control headers prevent the browser from serving stale assets after a rebuild.
func webFileServer() http.Handler {
	sub, err := webAssets()
	if err != nil {
		// Only the embedded branch can fail, and only on a malformed embed: a
		// missing webDir is not swallowed into the embedded copy, because a stale
		// bundle that still serves is the trap this whole path exists to avoid.
		slog.Error("web assets unavailable, serving nothing", "err", err)
		return http.NotFoundHandler()
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prevent browser caching of Flutter web assets.
		// During development the JS bundle changes frequently.
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

		path := r.URL.Path
		// Strip leading slash for fs.Open
		if path != "" && path[0] == '/' {
			path = path[1:]
		}
		if path == "" {
			path = "index.html"
		}

		// If the file exists, serve it directly.
		if f, err := sub.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for client-side routing.
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
