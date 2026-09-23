package api

import (
	"net/http"

	"github.com/go-gost/wisper/tunnel"
)

// p2pIdentityResponse is the JSON representation of the process-wide p2p identity.
type p2pIdentityResponse struct {
	// PublicKey is the shared host's base64 public key. It is materialized on
	// demand, so it is non-empty even while the host is not running.
	PublicKey string `json:"public_key"`
	// Running reports whether the shared host is started (a p2p tunnel or
	// entrypoint is live). The key alone cannot tell: an idle host still has one.
	Running bool `json:"running"`
	// Transport counters, zero while the host is not running: where the peers'
	// traffic goes now (direct vs relay) and how punching is faring.
	DirectPeers   int   `json:"direct_peers"`
	DerpPeers     int   `json:"derp_peers"`
	PunchAttempts int64 `json:"punch_attempts"`
	PunchSuccess  int64 `json:"punch_success"`
}

// handleGetP2PIdentity returns the shared p2p host's base64 public key. The
// identity is materialized on demand, so it is always available — even while
// no p2p tunnel or entrypoint is running; Running says which of the two states
// the host is in.
func handleGetP2PIdentity(w http.ResponseWriter, r *http.Request) {
	st := tunnel.P2PHostStatus()
	writeJSON(w, http.StatusOK, p2pIdentityResponse{
		PublicKey:     tunnel.P2PHostPublicKey(),
		Running:       tunnel.P2PHostRunning(),
		DirectPeers:   st.DirectPeers,
		DerpPeers:     st.DerpPeers,
		PunchAttempts: st.PunchAttempts,
		PunchSuccess:  st.PunchSuccess,
	})
}

// p2pRelayTestRequest is the body of POST /api/p2p/test: the relay values as
// typed in the settings form. An empty Derp probes the saved setting (which
// falls back to the public default).
type p2pRelayTestRequest struct {
	Derp   string `json:"derp"`
	Secure *bool  `json:"secure,omitempty"`
	CAFile string `json:"ca_file,omitempty"`
}

// p2pRelayTestResponse reports the probe outcome. A failed probe is a 200 with
// ok=false: the relay being unreachable is the result, not a request error.
type p2pRelayTestResponse struct {
	OK        bool   `json:"ok"`
	Derp      string `json:"derp,omitempty"`
	LatencyMS int64  `json:"latency_ms,omitempty"`
	Error     string `json:"error,omitempty"`
}

// handleTestP2PRelay dials the relay from this process (the host's actual
// network path and TLS options), so it also covers self-signed relays that a
// browser check could not.
func handleTestP2PRelay(w http.ResponseWriter, r *http.Request) {
	var req p2pRelayTestRequest
	if !readJSON(w, r, &req) {
		return
	}
	derp, latency, err := tunnel.TestP2PRelay(req.Derp, req.Secure, req.CAFile)
	if err != nil {
		writeJSON(w, http.StatusOK, p2pRelayTestResponse{OK: false, Derp: derp, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, p2pRelayTestResponse{OK: true, Derp: derp, LatencyMS: latency.Milliseconds()})
}
