package api

import (
	"net/http"

	"github.com/go-gost/p2p"
	"github.com/go-gost/p2p/doctor"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/version"
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
	// PeerDiagnostics is each connected peer's live state, keyed by its base64
	// public key — the per-peer detail behind the counters above, for a CLI or
	// another client that has no tunnel object.
	PeerDiagnostics map[string]peerDiagnosticJSON `json:"peer_diagnostics,omitempty"`
}

// peerDiagnosticJSON is one connected peer's live state in the /api/p2p
// response. It is the same snapshot a tunnel's peer_stats carries, minus the
// traffic counters.
type peerDiagnosticJSON struct {
	Path          string   `json:"path,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	State         string   `json:"state,omitempty"`
	Failed        bool     `json:"failed,omitempty"`
	LastError     string   `json:"last_error,omitempty"`
	PeerAddr      string   `json:"peer_addr,omitempty"`
	Candidates    int      `json:"candidates,omitempty"`
	Caps          []string `json:"caps,omitempty"`
	SessionAgeMs  int64    `json:"session_age_ms,omitempty"`
	LastRecvAgeMs int64    `json:"last_recv_age_ms,omitempty"`
	Attempts      int64    `json:"attempts,omitempty"`
	Ups           int64    `json:"ups,omitempty"`
	Drops         int64    `json:"drops,omitempty"`
}

// peerDiagnosticsJSON maps the status snapshot onto the wire form.
func peerDiagnosticsJSON(in map[string]p2p.PeerDiagnostic) map[string]peerDiagnosticJSON {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]peerDiagnosticJSON, len(in))
	for k, d := range in {
		out[k] = peerDiagnosticJSON{
			Path:          d.Path,
			Reason:        d.Reason,
			State:         d.State,
			Failed:        d.Failed,
			LastError:     d.LastError,
			PeerAddr:      d.PeerAddr,
			Candidates:    d.Candidates,
			Caps:          d.Caps,
			SessionAgeMs:  d.SessionAge.Milliseconds(),
			LastRecvAgeMs: d.LastRecvAge.Milliseconds(),
			Attempts:      d.Attempts,
			Ups:           d.Ups,
			Drops:         d.Drops,
		}
	}
	return out
}

// handleGetP2PIdentity returns the shared p2p host's base64 public key. The
// identity is materialized on demand, so it is always available — even while
// no p2p tunnel or entrypoint is running; Running says which of the two states
// the host is in.
func handleGetP2PIdentity(w http.ResponseWriter, r *http.Request) {
	st := tunnel.P2PHostStatus()
	writeJSON(w, http.StatusOK, p2pIdentityResponse{
		PublicKey:       tunnel.P2PHostPublicKey(),
		Running:         tunnel.P2PHostRunning(),
		DirectPeers:     st.DirectPeers,
		DerpPeers:       st.DerpPeers,
		PunchAttempts:   st.PunchAttempts,
		PunchSuccess:    st.PunchSuccess,
		PeerDiagnostics: peerDiagnosticsJSON(st.PeerDiagnostics),
	})
}

// handleGetP2PDoctor renders the shared doctor report as plain text. In-process,
// so it is complete where the CLI's is not: the relay's liveness (RelayConnected)
// and the full per-peer snapshot are real here, not inferred from a frozen proto.
// An optional ?peer=<base64-key> narrows it to one peer.
func handleGetP2PDoctor(w http.ResponseWriter, r *http.Request) {
	opts := doctor.Options{
		Version:  version.Version,
		Identity: tunnel.P2PHostPublicKey(),
		Peer:     r.URL.Query().Get("peer"),
	}
	if s := config.Get().Settings; s != nil && s.P2P != nil {
		opts.RelayURL = tunnel.P2PDerpURL(s)
		opts.STUN = tunnel.P2PStunAddr(s)
		opts.Direct = s.P2P.Direct
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(doctor.Report(tunnel.P2PHostStatus(), opts)))
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

// p2pStunTestRequest is the body of POST /api/p2p/test-stun: the STUN address
// as typed in the settings form. Empty probes the saved setting (or the one
// derived from the relay).
type p2pStunTestRequest struct {
	Stun string `json:"stun"`
}

// p2pStunTestResponse reports the probe outcome. A server that does not answer
// is a 200 with ok=false, like the relay probe: it is the result, not a
// request error. Mapped is the public address the server saw — what a peer
// would have to reach.
type p2pStunTestResponse struct {
	OK        bool   `json:"ok"`
	Stun      string `json:"stun,omitempty"`
	Mapped    string `json:"mapped,omitempty"`
	LatencyMS int64  `json:"latency_ms,omitempty"`
	Error     string `json:"error,omitempty"`
}

// handleTestP2PStun probes the STUN server the direct path would use: a wrong
// or blocked STUN address is the usual reason a hole punch never comes up.
func handleTestP2PStun(w http.ResponseWriter, r *http.Request) {
	var req p2pStunTestRequest
	if !readJSON(w, r, &req) {
		return
	}
	stun, mapped, latency, err := tunnel.TestP2PStun(req.Stun)
	if err != nil {
		writeJSON(w, http.StatusOK, p2pStunTestResponse{OK: false, Stun: stun, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, p2pStunTestResponse{
		OK: true, Stun: stun, Mapped: mapped, LatencyMS: latency.Milliseconds(),
	})
}

// pendingPeerResponse is one refused knock as the UI reads it.
type pendingPeerResponse struct {
	Key       string `json:"key"`
	FirstSeen string `json:"first_seen"`
	LastSeen  string `json:"last_seen"`
	Attempts  int    `json:"attempts"`
}

// pendingPeersResponse is the whole list; the field is always present, empty or
// not, so a client can render it without a nil check.
type pendingPeersResponse struct {
	Peers []pendingPeerResponse `json:"peers"`
}

// handleListPendingPeers lists the keys that knocked without being on any
// tunnel's allowlist, newest first. The list is process-wide: a p2p stream
// carries no destination, so a knock cannot be attributed to a tunnel.
func handleListPendingPeers(w http.ResponseWriter, r *http.Request) {
	peers := tunnel.P2PPendingPeers()
	out := make([]pendingPeerResponse, 0, len(peers))
	for _, p := range peers {
		out = append(out, pendingPeerResponse{
			Key:       p.Key,
			FirstSeen: p.FirstSeen.UTC().Format("2006-01-02T15:04:05Z"),
			LastSeen:  p.LastSeen.UTC().Format("2006-01-02T15:04:05Z"),
			Attempts:  p.Attempts,
		})
	}
	writeJSON(w, http.StatusOK, pendingPeersResponse{Peers: out})
}

// handleDismissPendingPeer forgets one knock. Idempotent: an entry that is
// already gone is still a 200.
func handleDismissPendingPeer(w http.ResponseWriter, r *http.Request) {
	tunnel.DismissPendingPeer(r.PathValue("key"))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
