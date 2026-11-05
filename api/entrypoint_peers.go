package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// entryPeerJSON is one row of a tun spoke's local peer view. It is deliberately
// the spoke's view, not the hub's allowlist: the hub row and blocked-but-gone
// keys are real rows the operator needs to see.
type entryPeerJSON struct {
	Key           string   `json:"key"`
	Name          string   `json:"name,omitempty"`
	IPs           []string `json:"ips,omitempty"`
	LANs          []string `json:"lans,omitempty"`
	State         string   `json:"state"`
	Blocked       bool     `json:"blocked,omitempty"`
	Direct        bool     `json:"direct,omitempty"`
	Disabled      bool     `json:"disabled,omitempty"`
	Transport     string   `json:"transport,omitempty"`
	DialedLocally bool     `json:"dialed_locally,omitempty"`
	RTTMs         int64    `json:"rtt_ms,omitempty"`
	InputBytes    uint64   `json:"input_bytes,omitempty"`
	OutputBytes   uint64   `json:"output_bytes,omitempty"`
}

type entrypointPeersResponse struct {
	Peers []entryPeerJSON `json:"peers"`
}

type entrypointPeersRequest struct {
	// Blocked is a pointer for the same reason the full update's field is:
	// absent means "leave the list alone", [] means "clear it".
	Blocked *[]string `json:"blocked"`
}

func entryPeersJSON(peers []tunnel.EntryPeer) []entryPeerJSON {
	out := make([]entryPeerJSON, 0, len(peers))
	for _, p := range peers {
		out = append(out, entryPeerJSON{
			Key:           p.Key,
			Name:          p.Name,
			IPs:           p.IPs,
			LANs:          p.LANs,
			State:         p.State,
			Blocked:       p.Blocked,
			Direct:        p.Direct,
			Disabled:      p.Disabled,
			Transport:     p.Transport,
			DialedLocally: p.DialedLocally,
			RTTMs:         p.RTTMs,
			InputBytes:    p.InputBytes,
			OutputBytes:   p.OutputBytes,
		})
	}
	return out
}

// peerListForEntrypoint resolves the two interfaces a tun spoke implements.
// A non-tun entrypoint has no local device network, so it has no peers to
// report rather than an empty one.
func peerListForEntrypoint(ep entrypoint.EntryPoint) ([]tunnel.EntryPeer, bool) {
	if ep.Type() != entrypoint.TunEntryPoint {
		return nil, false
	}
	reporter, ok := ep.(tunnel.PeerListReporter)
	if !ok {
		return nil, false
	}
	return reporter.PeerList(), true
}

func handleEntrypointPeers(w http.ResponseWriter, r *http.Request) {
	ep := entrypoint.Get(r.PathValue("id"))
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}
	peers, ok := peerListForEntrypoint(ep)
	if !ok {
		writeError(w, http.StatusBadRequest, "only a tun entrypoint has a peer list")
		return
	}
	writeJSON(w, http.StatusOK, entrypointPeersResponse{Peers: entryPeersJSON(peers)})
}

func handleUpdateEntrypointPeers(w http.ResponseWriter, r *http.Request) {
	ep := entrypoint.Get(r.PathValue("id"))
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}
	if ep.Type() != entrypoint.TunEntryPoint {
		writeError(w, http.StatusBadRequest, "only a tun entrypoint has local peers")
		return
	}
	setter, ok := ep.(tunnel.BlockedPeersSetter)
	if !ok {
		writeError(w, http.StatusBadRequest, "entrypoint does not support local peers")
		return
	}

	var req entrypointPeersRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Blocked != nil {
		keys, err := normalizeBlockedPeers(*req.Blocked)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := setter.SetBlockedPeers(r.Context(), keys); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := entrypoint.SaveConfig(); err != nil {
			slog.Error("save config", "err", err)
		}
	}

	peers, ok := peerListForEntrypoint(ep)
	if !ok {
		writeError(w, http.StatusBadRequest, "only a tun entrypoint has a peer list")
		return
	}
	writeJSON(w, http.StatusOK, entrypointPeersResponse{Peers: entryPeersJSON(peers)})
}

// normalizeBlockedPeers validates the local block list at the door. A key that
// is not a base64 public key can never match a peer, so accepting it would only
// make the page show a block that does nothing; duplicates are one policy.
func normalizeBlockedPeers(keys []string) ([]string, error) {
	seen := make(map[string]bool, len(keys))
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if seen[key] {
			return nil, fmt.Errorf("peer %s is listed twice", key)
		}
		if !tunnel.ValidPeerKey(key) {
			return nil, fmt.Errorf("peer %q is not a base64 public key", key)
		}
		seen[key] = true
		out = append(out, key)
	}
	return out, nil
}
