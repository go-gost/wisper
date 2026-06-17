package api

import (
	"fmt"
	"net/http"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
)

// tunnelResponse is the JSON representation of a tunnel returned by the API.
type tunnelResponse struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Type       string            `json:"type"`
	Endpoint   string            `json:"endpoint"`
	Entrypoint string            `json:"entrypoint"`
	Status     string            `json:"status"`
	Favorite   bool              `json:"favorite"`
	CreatedAt  string            `json:"created_at"`
	Error      string            `json:"error,omitempty"`
	Options    tunnelOptionsResp `json:"options"`
	Stats      statsResponse     `json:"stats"`
}

type tunnelOptionsResp struct {
	Hostname    string `json:"hostname,omitempty"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	BasicAuth   bool   `json:"basic_auth"`
	EnableTLS   bool   `json:"enableTLS,omitempty"`
	RewriteHost bool   `json:"rewriteHost,omitempty"`
	FileUpload  bool   `json:"file_upload,omitempty"`
	Keepalive   bool   `json:"keepalive,omitempty"`
	TTL         int    `json:"ttl,omitempty"`
}

type statsResponse struct {
	CurrentConns    uint64  `json:"current_conns"`
	TotalConns      uint64  `json:"total_conns"`
	TotalErrs       uint64  `json:"total_errs"`
	RequestRate     float64 `json:"request_rate"`
	InputBytes      uint64  `json:"input_bytes"`
	OutputBytes     uint64  `json:"output_bytes"`
	InputRateBytes  uint64  `json:"input_rate_bytes"`
	OutputRateBytes uint64  `json:"output_rate_bytes"`
}

// safeSub returns a - b, or 0 if b > a (underflow guard for baseline subtraction).
func safeSub(a, b uint64) uint64 {
	if a >= b {
		return a - b
	}
	return 0
}

func toTunnelResponse(t tunnel.Tunnel) tunnelResponse {
	opts := t.Options()
	s := t.Stats()
	bl := t.StatsBaseline()
	status := "stopped"
	errMsg := ""
	if !t.IsClosed() {
		if tunnel.IsServiceFailed(t) {
			status = "error"
			errMsg = tunnel.ServiceErrorMessage(t)
			// Fall back to Err() if the service-level error is empty.
			if errMsg == "" {
				errMsg = errStr(t.Err())
			}
		} else {
			status = "running"
		}
	} else if t.Err() != nil {
		// Closed tunnel with a recorded failure — preserve the error for display.
		errMsg = errStr(t.Err())
	}

	return tunnelResponse{
		ID:         t.ID(),
		Name:       t.Name(),
		Type:       t.Type(),
		Endpoint:   t.Endpoint(),
		Entrypoint: t.Entrypoint(),
		Status:     status,
		Favorite:   t.IsFavorite(),
		CreatedAt:  opts.CreatedAt.Format("2006-01-02T15:04:05Z"),
		Error:      errMsg,
		Options: tunnelOptionsResp{
			Hostname:    opts.Hostname,
			Username:    opts.Username,
			Password:    opts.Password,
			BasicAuth:   opts.Username != "",
			EnableTLS:   opts.EnableTLS,
			RewriteHost: opts.RewriteHost,
			FileUpload:  opts.FileUpload,
			Keepalive:   opts.Keepalive,
			TTL:         opts.TTL,
		},
		Stats: statsResponse{
			CurrentConns:    s.CurrentConns,
			TotalConns:      safeSub(s.TotalConns, bl.TotalConns),
			TotalErrs:       safeSub(s.TotalErrs, bl.TotalErrs),
			RequestRate:     s.RequestRate,
			InputBytes:      safeSub(s.InputBytes, bl.InputBytes),
			OutputBytes:     safeSub(s.OutputBytes, bl.OutputBytes),
			InputRateBytes:  s.InputRateBytes,
			OutputRateBytes: s.OutputRateBytes,
		},
	}
}

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// tunnelCreateRequest is the JSON body for creating a new tunnel.
type tunnelCreateRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Endpoint    string `json:"endpoint"`
	Hostname    string `json:"hostname,omitempty"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	EnableTLS   bool   `json:"enableTLS,omitempty"`
	RewriteHost bool   `json:"rewriteHost,omitempty"`
	FileUpload  bool   `json:"file_upload,omitempty"`
}

func (r *tunnelCreateRequest) toOptions() []tunnel.Option {
	return []tunnel.Option{
		tunnel.NameOption(r.Name),
		tunnel.EndpointOption(r.Endpoint),
		tunnel.HostnameOption(r.Hostname),
		tunnel.UsernameOption(r.Username),
		tunnel.PasswordOption(r.Password),
		tunnel.EnableTLSOption(r.EnableTLS),
		tunnel.RewriteHostOption(r.RewriteHost),
		tunnel.FileUploadOption(r.FileUpload),
	}
}

func handleListTunnels(w http.ResponseWriter, r *http.Request) {
	var result []tunnelResponse
	for i := 0; i < tunnel.Count(); i++ {
		t := tunnel.GetIndex(i)
		if t != nil {
			result = append(result, toTunnelResponse(t))
		}
	}
	if result == nil {
		result = []tunnelResponse{}
	}
	writeJSON(w, http.StatusOK, result)
}

func handleCreateTunnel(w http.ResponseWriter, r *http.Request) {
	var req tunnelCreateRequest
	if !readJSON(w, r, &req) {
		return
	}

	if req.Type == "" {
		writeError(w, http.StatusBadRequest, "type is required")
		return
	}

	var t tunnel.Tunnel
	switch req.Type {
	case tunnel.FileTunnel:
		t = tunnel.NewFileTunnel(req.toOptions()...)
	case tunnel.HTTPTunnel:
		t = tunnel.NewHTTPTunnel(req.toOptions()...)
	case tunnel.TCPTunnel:
		t = tunnel.NewTCPTunnel(req.toOptions()...)
	case tunnel.UDPTunnel:
		t = tunnel.NewUDPTunnel(req.toOptions()...)
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown tunnel type: %s", req.Type))
		return
	}

	if err := t.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tunnel: "+err.Error())
		return
	}

	tunnel.Add(t)
	tunnel.SaveConfig()

	writeJSON(w, http.StatusCreated, toTunnelResponse(t))
}

func handleGetTunnel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t := tunnel.Get(id)
	if t == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}
	writeJSON(w, http.StatusOK, toTunnelResponse(t))
}

func handleUpdateTunnel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	old := tunnel.Get(id)
	if old == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	var req tunnelCreateRequest
	if !readJSON(w, r, &req) {
		return
	}

	// Use the type from request; default to old type if empty.
	tunnelType := req.Type
	if tunnelType == "" {
		tunnelType = old.Type()
	}

	// Create replacement with same ID first (before deleting old).
	opts := append([]tunnel.Option{
		tunnel.IDOption(id),
		tunnel.CreatedAtOption(old.Options().CreatedAt),
	}, req.toOptions()...)

	var t tunnel.Tunnel
	switch tunnelType {
	case tunnel.FileTunnel:
		t = tunnel.NewFileTunnel(opts...)
	case tunnel.HTTPTunnel:
		t = tunnel.NewHTTPTunnel(opts...)
	case tunnel.TCPTunnel:
		t = tunnel.NewTCPTunnel(opts...)
	case tunnel.UDPTunnel:
		t = tunnel.NewUDPTunnel(opts...)
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown tunnel type: %s", tunnelType))
		return
	}

	t.SetStats(old.Stats())
		t.SetStatsBaseline(old.StatsBaseline())
	t.Favorite(old.IsFavorite())

	if err := t.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to restart tunnel: "+err.Error())
		return
	}

	// Swap: only delete old after new is running successfully.
	old.Close()
	tunnel.Delete(id)

	tunnel.Add(t)
	tunnel.SaveConfig()

	writeJSON(w, http.StatusOK, toTunnelResponse(t))
}

func handleDeleteTunnel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t := tunnel.Get(id)
	if t == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	tunnel.Delete(id)
	tunnel.SaveConfig()

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func handleStartTunnel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t := tunnel.Get(id)
	if t == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	if !t.IsClosed() {
		// A tunnel that failed (Run() error or service.StateFailed) is not
		// closed, but also not running — it's stuck. Close it to allow restart.
		if t.Err() != nil || tunnel.IsServiceFailed(t) {
			t.Close()
		} else {
			writeError(w, http.StatusConflict, "tunnel already running")
			return
		}
	}

	// Recreate and start
	opts := t.Options()
	optsSlice := []tunnel.Option{
		tunnel.IDOption(opts.ID),
		tunnel.NameOption(opts.Name),
		tunnel.EndpointOption(opts.Endpoint),
		tunnel.HostnameOption(opts.Hostname),
		tunnel.UsernameOption(opts.Username),
		tunnel.PasswordOption(opts.Password),
		tunnel.EnableTLSOption(opts.EnableTLS),
		tunnel.RewriteHostOption(opts.RewriteHost),
		tunnel.FileUploadOption(opts.FileUpload),
		tunnel.CreatedAtOption(opts.CreatedAt),
	}

	var newT tunnel.Tunnel
	switch t.Type() {
	case tunnel.FileTunnel:
		newT = tunnel.NewFileTunnel(optsSlice...)
	case tunnel.HTTPTunnel:
		newT = tunnel.NewHTTPTunnel(optsSlice...)
	case tunnel.TCPTunnel:
		newT = tunnel.NewTCPTunnel(optsSlice...)
	case tunnel.UDPTunnel:
		newT = tunnel.NewUDPTunnel(optsSlice...)
	default:
		writeError(w, http.StatusInternalServerError, "unknown tunnel type")
		return
	}

	newT.SetStats(t.Stats())
		newT.SetStatsBaseline(t.StatsBaseline())
	newT.Favorite(t.IsFavorite())

	if err := newT.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tunnel: "+err.Error())
		return
	}

	tunnel.Set(newT)
	tunnel.SaveConfig()

	writeJSON(w, http.StatusOK, toTunnelResponse(newT))
}

func handleStopTunnel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t := tunnel.Get(id)
	if t == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	if t.IsClosed() {
		writeError(w, http.StatusConflict, "tunnel already stopped")
		return
	}

	t.Close()
	tunnel.SaveConfig()

	writeJSON(w, http.StatusOK, toTunnelResponse(t))
}

func handleResetTunnelStats(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t := tunnel.Get(id)
	if t == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	kind := r.URL.Query().Get("kind")
	s := t.Stats()
	bl := t.StatsBaseline()

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
	t.SetStatsBaseline(bl)
	tunnel.SaveConfig()

	writeJSON(w, http.StatusOK, toTunnelResponse(t))
}
