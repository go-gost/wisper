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
}

// handleGetP2PIdentity returns the shared p2p host's base64 public key. The
// identity is materialized on demand, so it is always available — even while
// no p2p tunnel or entrypoint is running; Running says which of the two states
// the host is in.
func handleGetP2PIdentity(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, p2pIdentityResponse{
		PublicKey: tunnel.P2PHostPublicKey(),
		Running:   tunnel.P2PHostRunning(),
	})
}
