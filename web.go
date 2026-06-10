package main

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed web/*
var webFS embed.FS

// webFileServer returns an http.Handler that serves the embedded Lit web UI files.
// It implements SPA fallback: requests that don't match a static file serve index.html.
// Cache-Control headers prevent the browser from serving stale assets after a rebuild.
func webFileServer() http.Handler {
	sub, _ := fs.Sub(webFS, "web")
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
