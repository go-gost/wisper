package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/pprof"

	"github.com/go-gost/p2p/endpoint"
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, "+actionHeader)

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// logMutations records every non-GET request at debug. One line covers all of
// the state-changing endpoints — including the ones that record no event (a
// settings change, a peers edit, a stats reset), so a state change visible in
// neither the events nor the object history can still be traced to a request.
//
// The line carries the request's action id: the UI's (or a generated one), so
// it can be joined with the log line the p2p seam writes for the work this
// action started (a start's Listen/Warm/Punch). The id is put in the request
// context for exactly that, and it is a label throughout — read for a log
// field, never for a decision.
func logMutations(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			id := r.Header.Get(actionHeader)
			if id == "" {
				id = newActionID()
			}
			slog.Debug("api", "method", r.Method, "path", r.URL.Path, "id", id)
			r = r.WithContext(endpoint.WithAction(r.Context(), id))
		}
		next.ServeHTTP(w, r)
	})
}

// registerDebugPprof mounts the runtime profiling endpoints on mux.
//
// Off unless -debug.pprof (WISPER_DEBUG_PPROF) is set, and it stays in the tree
// permanently rather than being a local patch: the p2p tunnel's throughput is
// CPU-bound on its host, so separating "per-packet cost" from "the path is slow"
// needs a CPU profile, and finding that out should not need a rebuild.
//
// Registered: Index (which serves heap, allocs, goroutine, block, mutex and the
// rest by name) plus profile and symbol, which Index does not cover.
//
// Deliberately NOT registered:
//   - cmdline, which hands the process argv to whoever asks. This API has no
//     authentication, so that is a way to read whatever was passed on the
//     command line.
//   - trace, a heavy runtime trace that answers no question a CPU profile
//     does not.
//
// The net/http/pprof blank import (the usual `import _ "net/http/pprof"`) is
// not usable here: it registers on http.DefaultServeMux, and this server serves
// its own mux, so that import would have no effect at all.
func registerDebugPprof(mux *http.ServeMux) {
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
}

// hideDebugPprof reserves the /debug/pprof/ subtree while the endpoints are off.
//
// Without this the embedded web UI answers instead: its catch-all serves
// index.html for any unmatched path, so a disabled /debug/pprof/ returns 200
// text/html. No profiling data leaks that way, but the state becomes
// unreadable — a status-code check reports the endpoints as present, and
// /debug/pprof/profile?seconds=600 looks like it is collecting while it is
// really just the SPA. An explicit 404 makes "off" mean off, and keeps the
// subtree from being shadowed by the catch-all should it ever be mounted.
func hideDebugPprof(mux *http.ServeMux) {
	mux.HandleFunc("/debug/pprof/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
}

// NewHandler returns the root HTTP handler with all API routes registered.
// If webHandler is non-nil, non-API requests are served by it (embedded Lit web UI).
// debugPprof mounts /debug/pprof; see registerDebugPprof for why it is opt-in.
func NewHandler(webHandler http.Handler, debugPprof bool) http.Handler {
	mux := http.NewServeMux()

	// Tunnel endpoints
	mux.HandleFunc("GET /api/tunnels", handleListTunnels)
	mux.HandleFunc("POST /api/tunnels", handleCreateTunnel)
	mux.HandleFunc("GET /api/tunnels/{id}", handleGetTunnel)
	mux.HandleFunc("PUT /api/tunnels/{id}", handleUpdateTunnel)
	mux.HandleFunc("DELETE /api/tunnels/{id}", handleDeleteTunnel)
	mux.HandleFunc("POST /api/tunnels/{id}/start", handleStartTunnel)
	mux.HandleFunc("POST /api/tunnels/{id}/stop", handleStopTunnel)
	mux.HandleFunc("PUT /api/tunnels/{id}/peers", handleUpdateTunnelPeers)
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

	// Stats, config, and version
	mux.HandleFunc("GET /api/stats", handleGetStats)
	mux.HandleFunc("GET /api/config", handleGetConfig)
	mux.HandleFunc("PUT /api/config", handleUpdateConfig)
	mux.HandleFunc("GET /api/version", handleGetVersion)

	// Host-level event history
	mux.HandleFunc("GET /api/events", handleGetEvents)
	mux.HandleFunc("DELETE /api/events", handleClearEvents)

	// Log tail, and the level override that lasts one run
	mux.HandleFunc("GET /api/logs", handleGetLogs)
	mux.HandleFunc("PUT /api/log/level", handleSetLogLevel)

	// Process-wide p2p identity, and the relay/STUN connectivity probes
	mux.HandleFunc("GET /api/p2p", handleGetP2PIdentity)
	mux.HandleFunc("POST /api/p2p/test", handleTestP2PRelay)
	mux.HandleFunc("POST /api/p2p/test-stun", handleTestP2PStun)
	mux.HandleFunc("GET /api/p2p/pending", handleListPendingPeers)
	mux.HandleFunc("DELETE /api/p2p/pending/{key}", handleDismissPendingPeer)
	// Diagnostic report, rendered in-process (the relay's liveness is real here).
	mux.HandleFunc("GET /api/p2p/doctor", handleGetP2PDoctor)

	if debugPprof {
		registerDebugPprof(mux)
	} else {
		hideDebugPprof(mux)
	}

	// Serve embedded web UI for non-API requests.
	if webHandler != nil {
		mux.Handle("/", webHandler)
	}

	return corsMiddleware(logMutations(mux))
}
