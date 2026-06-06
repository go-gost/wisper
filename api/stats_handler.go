package api

import (
	"net/http"

	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// statsOverallResponse is the combined stats for all tunnels and entrypoints.
type statsOverallResponse struct {
	Tunnels     []tunnelResponse `json:"tunnels"`
	Entrypoints []tunnelResponse `json:"entrypoints"`
}

func handleGetStats(w http.ResponseWriter, r *http.Request) {
	var tunnels []tunnelResponse
	for i := 0; i < tunnel.Count(); i++ {
		t := tunnel.GetIndex(i)
		if t != nil {
			tunnels = append(tunnels, toTunnelResponse(t))
		}
	}

	var entrypoints []tunnelResponse
	for i := 0; i < entrypoint.Count(); i++ {
		ep := entrypoint.GetIndex(i)
		if ep != nil {
			entrypoints = append(entrypoints, toTunnelResponse(ep))
		}
	}

	if tunnels == nil {
		tunnels = []tunnelResponse{}
	}
	if entrypoints == nil {
		entrypoints = []tunnelResponse{}
	}

	writeJSON(w, http.StatusOK, statsOverallResponse{
		Tunnels:     tunnels,
		Entrypoints: entrypoints,
	})
}
