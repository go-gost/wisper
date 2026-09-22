package api

import (
	"net/http"

	"github.com/go-gost/wisper/tunnel"
)

// p2pIdentityResponse is the JSON representation of the process-wide p2p identity.
type p2pIdentityResponse struct {
	PublicKey string `json:"public_key"`
}

// handleGetP2PIdentity returns the shared p2p host's base64 public key.
// While no p2p tunnel or entrypoint has started the host, the key is the empty
// string — that is the idle state, not an error.
func handleGetP2PIdentity(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, p2pIdentityResponse{PublicKey: tunnel.P2PHostPublicKey()})
}
