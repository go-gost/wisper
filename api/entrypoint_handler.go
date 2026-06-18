package api

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// entrypointCreateRequest is the JSON body for creating a new entrypoint.
type entrypointCreateRequest struct {
	ID        string `json:"id,omitempty"`
	Type      string `json:"type"`
	Name      string `json:"name"`
	Endpoint  string `json:"endpoint"`
	Keepalive bool   `json:"keepalive,omitempty"`
	TTL       int    `json:"ttl,omitempty"`
}

func (r *entrypointCreateRequest) toOptions() []tunnel.Option {
	return []tunnel.Option{
		tunnel.IDOption(r.ID),
		tunnel.NameOption(r.Name),
		tunnel.EndpointOption(r.Endpoint),
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
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

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
		ep.SetStatsBaseline(old.StatsBaseline())
	ep.Favorite(old.IsFavorite())

	if err := ep.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to restart entrypoint: "+err.Error())
		return
	}

	// Swap: only delete old after new is running successfully.
	old.Close()
	entrypoint.Delete(id)

	entrypoint.Add(ep)
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

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
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

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
		// An entrypoint that failed (Run() error or service.StateFailed) is not
		// closed, but also not running — it's stuck. Close it to allow restart.
		if ep.Err() != nil || tunnel.IsServiceFailed(ep) {
			ep.Close()
		} else {
			writeError(w, http.StatusConflict, "entrypoint already running")
			return
		}
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
		newEP.SetStatsBaseline(ep.StatsBaseline())
	newEP.Favorite(ep.IsFavorite())

	if err := newEP.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start entrypoint: "+err.Error())
		return
	}

	entrypoint.Set(newEP)
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

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
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	writeJSON(w, http.StatusOK, toTunnelResponse(ep))
}

func handleResetEntrypointStats(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ep := entrypoint.Get(id)
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}

	kind := r.URL.Query().Get("kind")
	s := ep.Stats()
	bl := ep.StatsBaseline()

	switch kind {
	case "input":
		bl.InputBytes = s.InputBytes
	case "output":
		bl.OutputBytes = s.OutputBytes
	case "conns":
		bl.TotalConns = s.TotalConns
	case "errors":
		bl.TotalErrs = s.TotalErrs
	default:
		bl = config.ServiceStats{
			TotalConns: s.TotalConns,
			InputBytes: s.InputBytes,
			OutputBytes: s.OutputBytes,
			TotalErrs:  s.TotalErrs,
		}
	}
	ep.SetStatsBaseline(bl)
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	writeJSON(w, http.StatusOK, toTunnelResponse(ep))
}
