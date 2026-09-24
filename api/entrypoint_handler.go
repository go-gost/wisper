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
	// Peer is the remote peer's base64 public key (p2p and tun entrypoints).
	Peer string `json:"peer,omitempty"`
	// Protocol is a p2p entrypoint's inner protocol: "tcp" (default) or "udp".
	Protocol string `json:"protocol,omitempty"`
	// Net is a tun device's address (CIDR, comma-separated for several).
	Net string `json:"net,omitempty"`
	// MTU is the tun device's MTU (absent = the implementation default).
	MTU int `json:"mtu,omitempty"`
	// DeviceName is the tun device's name (absent = kernel-chosen).
	DeviceName string `json:"device_name,omitempty"`
	// Routes are the subnets routed through the device, comma-separated
	// "cidr [gw]" pairs.
	Routes string `json:"routes,omitempty"`
	// DNS is the device's DNS servers, comma-separated.
	DNS string `json:"dns,omitempty"`
}

func (r *entrypointCreateRequest) toOptions() []tunnel.Option {
	return []tunnel.Option{
		tunnel.IDOption(r.ID),
		tunnel.NameOption(r.Name),
		tunnel.EndpointOption(r.Endpoint),
		tunnel.KeepaliveOption(r.Keepalive),
		tunnel.TTLOption(r.TTL),
		tunnel.PeerOption(r.Peer),
		tunnel.ProtocolOption(r.Protocol),
		tunnel.NetOption(r.Net),
		tunnel.MTUOption(r.MTU),
		tunnel.DeviceNameOption(r.DeviceName),
		tunnel.RoutesOption(r.Routes),
		tunnel.DNSOption(r.DNS),
	}
}

// validateEntryPointRequest rejects a request the runtime cannot honor, before
// any object is constructed.
func validateEntryPointRequest(epType string, req *entrypointCreateRequest) error {
	switch epType {
	case entrypoint.TunEntryPoint:
		return validateTunEntryPoint(req)
	}
	return nil
}

// validateTunEntryPoint checks what a spoke cannot do without: a device address
// and the hub's public key (a bad key would leave the chain node dialing
// nothing, with no error on the way out).
func validateTunEntryPoint(r *entrypointCreateRequest) error {
	if err := validateTunNet(r.Net); err != nil {
		return err
	}
	if err := validateTunRoutes(r.Routes); err != nil {
		return err
	}
	if err := validateTunDNS(r.DNS); err != nil {
		return err
	}
	if !tunnel.ValidPeerKey(r.Peer) {
		return fmt.Errorf("peer must be the hub's base64 public key")
	}
	return nil
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

	if err := validateEntryPointRequest(req.Type, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	ep := entrypoint.NewByType(req.Type, req.toOptions()...)
	if ep == nil {
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

	if err := validateEntryPointRequest(epType, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Every entrypoint type binds its own local address (and a p2p one also
	// claims a provider name on the shared host), so the old one has to let go
	// before the replacement can start.
	old.Close()

	// Create replacement with same ID first (before deleting old).
	opts := append([]tunnel.Option{
		tunnel.IDOption(id),
		tunnel.CreatedAtOption(old.Options().CreatedAt),
	}, req.toOptions()...)

	ep := entrypoint.NewByType(epType, opts...)
	if ep == nil {
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

	if ep.Type() == entrypoint.P2PEntryPoint {
		// The key file is the entrypoint's identity: removed only on explicit
		// delete, so stop/start and update keep the same key.
		if err := tunnel.RemoveP2PKey(id); err != nil {
			slog.Error("remove p2p key", "id", id, "err", err)
		}
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
	newEP := entrypoint.NewByType(ep.Type(), tunnel.TunnelOptions(ep.Options())...)
	if newEP == nil {
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
			TotalConns:  s.TotalConns,
			InputBytes:  s.InputBytes,
			OutputBytes: s.OutputBytes,
			TotalErrs:   s.TotalErrs,
		}
	}
	ep.SetStatsBaseline(bl)
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	writeJSON(w, http.StatusOK, toTunnelResponse(ep))
}
