package api

import (
	"fmt"
	"net/http"

	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// entrypointCreateRequest is the JSON body for creating a new entrypoint.
type entrypointCreateRequest struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Endpoint  string `json:"endpoint"`
	Hostname  string `json:"hostname,omitempty"`
	Keepalive bool   `json:"keepalive,omitempty"`
	TTL       int    `json:"ttl,omitempty"`
}

func (r *entrypointCreateRequest) toOptions() []tunnel.Option {
	return []tunnel.Option{
		tunnel.NameOption(r.Name),
		tunnel.EndpointOption(r.Endpoint),
		tunnel.HostnameOption(r.Hostname),
		tunnel.KeepaliveOption(r.Keepalive),
		tunnel.TTLOption(r.TTL),
	}
}

func handleListEntrypoints(w http.ResponseWriter, r *http.Request) {
	var result []tunnelResponse
	for i := 0; i < entrypoint.Count(); i++ {
		ep := entrypoint.GetIndex(i)
		if ep != nil {
			result = append(result, toTunnelResponse(ep))
		}
	}
	if result == nil {
		result = []tunnelResponse{}
	}
	writeJSON(w, http.StatusOK, result)
}

func handleCreateEntrypoint(w http.ResponseWriter, r *http.Request) {
	var req entrypointCreateRequest
	if !readJSON(w, r, &req) {
		return
	}

	if req.Type == "" {
		writeError(w, http.StatusBadRequest, "type is required")
		return
	}

	var ep entrypoint.EntryPoint
	switch req.Type {
	case entrypoint.TCPEntryPoint:
		ep = entrypoint.NewTCPEntryPoint(req.toOptions()...)
	case entrypoint.UDPEntryPoint:
		ep = entrypoint.NewUDPEntryPoint(req.toOptions()...)
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown entrypoint type: %s", req.Type))
		return
	}

	if err := ep.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start entrypoint: "+err.Error())
		return
	}

	entrypoint.Add(ep)
	entrypoint.SaveConfig()

	writeJSON(w, http.StatusCreated, toTunnelResponse(ep))
}

func handleGetEntrypoint(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ep := entrypoint.Get(id)
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}
	writeJSON(w, http.StatusOK, toTunnelResponse(ep))
}

func handleUpdateEntrypoint(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	old := entrypoint.Get(id)
	if old == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}

	var req entrypointCreateRequest
	if !readJSON(w, r, &req) {
		return
	}

	// Use the type from request; default to old type if empty.
	epType := req.Type
	if epType == "" {
		epType = old.Type()
	}

	// Create replacement with same ID first (before deleting old).
	opts := append([]tunnel.Option{
		tunnel.IDOption(id),
		tunnel.CreatedAtOption(old.Options().CreatedAt),
	}, req.toOptions()...)

	var ep entrypoint.EntryPoint
	switch epType {
	case entrypoint.TCPEntryPoint:
		ep = entrypoint.NewTCPEntryPoint(opts...)
	case entrypoint.UDPEntryPoint:
		ep = entrypoint.NewUDPEntryPoint(opts...)
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown entrypoint type: %s", epType))
		return
	}

	ep.SetStats(old.Stats())
	ep.Favorite(old.IsFavorite())

	if err := ep.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to restart entrypoint: "+err.Error())
		return
	}

	// Swap: only delete old after new is running successfully.
	old.Close()
	entrypoint.Delete(id)

	entrypoint.Add(ep)
	entrypoint.SaveConfig()

	writeJSON(w, http.StatusOK, toTunnelResponse(ep))
}

func handleDeleteEntrypoint(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ep := entrypoint.Get(id)
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}

	entrypoint.Delete(id)
	entrypoint.SaveConfig()

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func handleStartEntrypoint(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ep := entrypoint.Get(id)
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}

	if !ep.IsClosed() {
		writeError(w, http.StatusConflict, "entrypoint already running")
		return
	}

	// Recreate and start
	opts := ep.Options()
	optsSlice := []tunnel.Option{
		tunnel.IDOption(opts.ID),
		tunnel.NameOption(opts.Name),
		tunnel.EndpointOption(opts.Endpoint),
		tunnel.HostnameOption(opts.Hostname),
		tunnel.KeepaliveOption(opts.Keepalive),
		tunnel.TTLOption(opts.TTL),
		tunnel.CreatedAtOption(opts.CreatedAt),
	}

	var newEP entrypoint.EntryPoint
	switch ep.Type() {
	case entrypoint.TCPEntryPoint:
		newEP = entrypoint.NewTCPEntryPoint(optsSlice...)
	case entrypoint.UDPEntryPoint:
		newEP = entrypoint.NewUDPEntryPoint(optsSlice...)
	default:
		writeError(w, http.StatusInternalServerError, "unknown entrypoint type")
		return
	}

	newEP.SetStats(ep.Stats())
	newEP.Favorite(ep.IsFavorite())

	if err := newEP.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start entrypoint: "+err.Error())
		return
	}

	entrypoint.Set(newEP)
	entrypoint.SaveConfig()

	writeJSON(w, http.StatusOK, toTunnelResponse(newEP))
}

func handleStopEntrypoint(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ep := entrypoint.Get(id)
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}

	if ep.IsClosed() {
		writeError(w, http.StatusConflict, "entrypoint already stopped")
		return
	}

	ep.Close()
	entrypoint.SaveConfig()

	writeJSON(w, http.StatusOK, toTunnelResponse(ep))
}
