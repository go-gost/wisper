package api

import (
	"net/http"

	"github.com/go-gost/wisper/tunnel"
)

// p2pIdentityResponse is the JSON representation of the process-wide p2p identity.
type p2pIdentityResponse struct {
	PublicKey string `json:"public_key"`
}

// handleGetP2PIdentity returns the shared p2p host's base64 public key. The
// identity is materialized on demand, so it is always available — even while
// no p2p tunnel or entrypoint is running.
func handleGetP2PIdentity(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, p2pIdentityResponse{PublicKey: tunnel.P2PHostPublicKey()})
}
