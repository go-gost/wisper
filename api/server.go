package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// writeJSON writes a JSON response with the given status code.
// It sets cache-control headers to prevent browsers from serving stale responses.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("writeJSON", "err", err)
	}
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// readJSON decodes a JSON request body into v.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

// corsMiddleware adds CORS headers for local web UI access.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// NewHandler returns the root HTTP handler with all API routes registered.
// If webHandler is non-nil, non-API requests are served by it (embedded Lit web UI).
func NewHandler(webHandler http.Handler) http.Handler {
	mux := http.NewServeMux()

	// Tunnel endpoints
	mux.HandleFunc("GET /api/tunnels", handleListTunnels)
	mux.HandleFunc("POST /api/tunnels", handleCreateTunnel)
	mux.HandleFunc("GET /api/tunnels/{id}", handleGetTunnel)
	mux.HandleFunc("PUT /api/tunnels/{id}", handleUpdateTunnel)
	mux.HandleFunc("DELETE /api/tunnels/{id}", handleDeleteTunnel)
	mux.HandleFunc("POST /api/tunnels/{id}/start", handleStartTunnel)
	mux.HandleFunc("POST /api/tunnels/{id}/stop", handleStopTunnel)
	mux.HandleFunc("POST /api/tunnels/{id}/stats/reset", handleResetTunnelStats)

	// Entrypoint endpoints
	mux.HandleFunc("GET /api/entrypoints", handleListEntrypoints)
	mux.HandleFunc("POST /api/entrypoints", handleCreateEntrypoint)
	mux.HandleFunc("GET /api/entrypoints/{id}", handleGetEntrypoint)
	mux.HandleFunc("PUT /api/entrypoints/{id}", handleUpdateEntrypoint)
	mux.HandleFunc("DELETE /api/entrypoints/{id}", handleDeleteEntrypoint)
	mux.HandleFunc("POST /api/entrypoints/{id}/start", handleStartEntrypoint)
	mux.HandleFunc("POST /api/entrypoints/{id}/stop", handleStopEntrypoint)
	mux.HandleFunc("POST /api/entrypoints/{id}/stats/reset", handleResetEntrypointStats)

	// Stats and config
	mux.HandleFunc("GET /api/stats", handleGetStats)
	mux.HandleFunc("GET /api/config", handleGetConfig)
	mux.HandleFunc("PUT /api/config", handleUpdateConfig)

	// Serve embedded web UI for non-API requests.
	if webHandler != nil {
		mux.Handle("/", webHandler)
	}

	return corsMiddleware(mux)
}
