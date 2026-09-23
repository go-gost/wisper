package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

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
	// PeerStats is every allowlisted peer's traffic, allowlist order (p2p
	// tunnels only).
	PeerStats []peerStatsJSON `json:"peer_stats,omitempty"`
	// PeerTransport is where a p2p entrypoint's peer traffic goes right now:
	// "direct" or "derp". Empty when it is not connected, or not a p2p object.
	PeerTransport string `json:"peer_transport,omitempty"`
}

// peerStatsJSON is one peer's traffic in the tunnel's current run.
type peerStatsJSON struct {
	Key             string `json:"key"`
	Alias           string `json:"alias,omitempty"`
	Transport       string `json:"transport,omitempty"`
	CurrentConns    uint64 `json:"current_conns"`
	TotalConns      uint64 `json:"total_conns"`
	InputBytes      uint64 `json:"input_bytes"`
	OutputBytes     uint64 `json:"output_bytes"`
	InputRateBytes  uint64 `json:"input_rate_bytes"`
	OutputRateBytes uint64 `json:"output_rate_bytes"`
}

// peerJSON is one allowlist entry: the key is the credential, the alias its
// display name. The alias is optional on the way in (it is generated when
// omitted) and always present on the way out.
type peerJSON struct {
	Key   string `json:"key"`
	Alias string `json:"alias,omitempty"`
}

type tunnelOptionsResp struct {
	Prefix      string `json:"prefix,omitempty"`
	Hostname    string `json:"hostname,omitempty"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	BasicAuth   bool   `json:"basic_auth"`
	EnableTLS   bool   `json:"enableTLS,omitempty"`
	RewriteHost bool   `json:"rewriteHost,omitempty"`
	FileUpload  bool   `json:"file_upload,omitempty"`
	Keepalive   bool   `json:"keepalive,omitempty"`
	TTL         int    `json:"ttl,omitempty"`
	RecordMode  string `json:"record_mode,omitempty"`
	// Peer is the remote peer's base64 public key (p2p entrypoints).
	Peer string `json:"peer,omitempty"`
	// Protocol is a p2p entrypoint's inner protocol: "tcp" or "udp".
	Protocol string `json:"protocol,omitempty"`
	// Peers is a p2p tunnel's inbound allowlist. Empty is valid: the tunnel
	// runs and routes nothing.
	Peers []peerJSON `json:"peers,omitempty"`
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

// peersJSON pairs each allowlisted key with its display alias. A key without
// one (a config older than aliases) is normalized on the way out, so the UI
// always has a name to show.
func peersJSON(peers []string, aliases map[string]string) []peerJSON {
	normalized := tunnel.NormalizePeerAliases(peers, aliases)
	out := make([]peerJSON, 0, len(peers))
	seen := make(map[string]bool, len(peers))
	for _, k := range peers {
		if a, ok := normalized[k]; ok && !seen[k] {
			seen[k] = true
			out = append(out, peerJSON{Key: k, Alias: a})
		}
	}
	return out
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

	resp := tunnelResponse{
		ID:         t.ID(),
		Name:       t.Name(),
		Type:       t.Type(),
		Endpoint:   t.Endpoint(),
		Entrypoint: t.Entrypoint(),
		Status:     status,
		Favorite:   t.IsFavorite(),
		CreatedAt:  opts.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		Error:      errMsg,
		Options: tunnelOptionsResp{
			Prefix:      opts.Prefix,
			Hostname:    opts.Hostname,
			Username:    opts.Username,
			BasicAuth:   opts.Username != "",
			EnableTLS:   opts.EnableTLS,
			RewriteHost: opts.RewriteHost,
			FileUpload:  opts.FileUpload,
			Keepalive:   opts.Keepalive,
			TTL:         opts.TTL,
			RecordMode:  opts.RecordMode,
			Peer:        opts.Peer,
			Protocol:    opts.Protocol,
			Peers:       peersJSON(opts.Peers, opts.PeerAliases),
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
	// The p2p host's current path per peer, when this object has p2p peers —
	// for a p2p tunnel's allowlist and for a p2p entrypoint's single peer.
	var transports map[string]string
	if opts.Peer != "" || t.Type() == tunnel.P2PTunnel {
		transports = tunnel.P2PHostStatus().PeerTransports
	}
	if ps, ok := t.(tunnel.PeerStatsReporter); ok {
		for _, p := range ps.PeerStats() {
			resp.PeerStats = append(resp.PeerStats, peerStatsJSON{
				Key:             p.Key,
				Alias:           opts.PeerAliases[p.Key],
				Transport:       transports[p.Key],
				CurrentConns:    p.CurrentConns,
				TotalConns:      p.TotalConns,
				InputBytes:      p.InputBytes,
				OutputBytes:     p.OutputBytes,
				InputRateBytes:  p.InputRateBytes,
				OutputRateBytes: p.OutputRateBytes,
			})
		}
	}
	if opts.Peer != "" {
		resp.PeerTransport = transports[opts.Peer]
	}
	return resp
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
	Prefix      string `json:"prefix,omitempty"`
	Hostname    string `json:"hostname,omitempty"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	EnableTLS   bool   `json:"enableTLS,omitempty"`
	RewriteHost bool   `json:"rewriteHost,omitempty"`
	FileUpload  bool   `json:"file_upload,omitempty"`
	RecordMode  string `json:"record_mode,omitempty"`
	// Peer is the remote peer's base64 public key (p2p entrypoints).
	Peer string `json:"peer,omitempty"`
	// Peers is a p2p tunnel's inbound allowlist; an entry's alias is optional
	// and generated when omitted.
	Peers []peerJSON `json:"peers,omitempty"`
}

func (r *tunnelCreateRequest) toOptions() []tunnel.Option {
	peers := make([]string, 0, len(r.Peers))
	aliases := make(map[string]string, len(r.Peers))
	for _, p := range r.Peers {
		peers = append(peers, p.Key)
		if p.Alias != "" {
			aliases[p.Key] = p.Alias
		}
	}
	aliases = tunnel.NormalizePeerAliases(peers, aliases)

	return []tunnel.Option{
		tunnel.NameOption(r.Name),
		tunnel.EndpointOption(r.Endpoint),
		tunnel.PrefixOption(r.Prefix),
		tunnel.HostnameOption(r.Hostname),
		tunnel.UsernameOption(r.Username),
		tunnel.PasswordOption(r.Password),
		tunnel.EnableTLSOption(r.EnableTLS),
		tunnel.RewriteHostOption(r.RewriteHost),
		tunnel.FileUploadOption(r.FileUpload),
		tunnel.RecordModeOption(r.RecordMode),
		tunnel.PeerOption(r.Peer),
		tunnel.PeersOption(peers...),
		tunnel.PeerAliasesOption(aliases),
	}
}

// prefixRe matches a DNS label: lowercase letters, digits and hyphens,
// not starting or ending with a hyphen.
var prefixRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// normalizePrefix trims and lowercases the URL host prefix and validates it.
// An empty prefix is valid (feature off). The 8-character minimum mirrors the
// production ingress requirement.
func normalizePrefix(p string) (string, error) {
	p = strings.ToLower(strings.TrimSpace(p))
	if p == "" {
		return "", nil
	}
	if len(p) < 8 || len(p) > 63 {
		return "", fmt.Errorf("prefix must be 8-63 characters")
	}
	if !prefixRe.MatchString(p) {
		return "", fmt.Errorf("prefix may contain only lowercase letters, digits and hyphens, and must not start or end with a hyphen")
	}
	return p, nil
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

	if p, err := normalizePrefix(req.Prefix); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	} else {
		req.Prefix = p
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
	case tunnel.P2PTunnel:
		t = tunnel.NewP2PTunnel(req.toOptions()...)
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown tunnel type: %s", req.Type))
		return
	}

	if err := t.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tunnel: "+err.Error())
		return
	}

	tunnel.Add(t)
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

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

	if p, err := normalizePrefix(req.Prefix); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	} else {
		req.Prefix = p
	}

	// Use the type from request; default to old type if empty.
	tunnelType := req.Type
	if tunnelType == "" {
		tunnelType = old.Type()
	}

	// A p2p tunnel cannot be replaced while it lives: the process-wide host
	// routes each peer key to exactly one tunnel, so the old one must give its
	// routes up first (everything else binds its own socket and swaps after the
	// replacement runs).
	if old.Type() == tunnel.P2PTunnel {
		old.Close()
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
	case tunnel.P2PTunnel:
		t = tunnel.NewP2PTunnel(opts...)
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
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	writeJSON(w, http.StatusOK, toTunnelResponse(t))
}

func handleDeleteTunnel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t := tunnel.Get(id)
	if t == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}

	if t.Type() == tunnel.P2PTunnel {
		// The key file is the tunnel's identity. Removing it here (not in
		// tunnel.Delete) keeps an update/replace from rotating the pubkey.
		if err := tunnel.RemoveP2PKey(id); err != nil {
			slog.Error("remove p2p key", "id", id, "err", err)
		}
	}

	tunnel.Delete(id)
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

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
		tunnel.PrefixOption(opts.Prefix),
		tunnel.HostnameOption(opts.Hostname),
		tunnel.UsernameOption(opts.Username),
		tunnel.PasswordOption(opts.Password),
		tunnel.EnableTLSOption(opts.EnableTLS),
		tunnel.RewriteHostOption(opts.RewriteHost),
		tunnel.FileUploadOption(opts.FileUpload),
		tunnel.RecordModeOption(opts.RecordMode),
		tunnel.CreatedAtOption(opts.CreatedAt),
		tunnel.PeersOption(opts.Peers...),
		tunnel.PeerAliasesOption(opts.PeerAliases),
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
	case tunnel.P2PTunnel:
		newT = tunnel.NewP2PTunnel(optsSlice...)
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
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

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
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

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
			TotalConns:  s.TotalConns,
			InputBytes:  s.InputBytes,
			OutputBytes: s.OutputBytes,
			TotalErrs:   s.TotalErrs,
		}
	}
	t.SetStatsBaseline(bl)
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	writeJSON(w, http.StatusOK, toTunnelResponse(t))
}

// tunnelPeersRequest is the JSON body for saving a p2p tunnel's allowlist on
// its own — the peers page changes the list without touching the rest of the
// tunnel's config.
type tunnelPeersRequest struct {
	Peers []peerJSON `json:"peers"`
}

// handleUpdateTunnelPeers replaces a p2p tunnel's inbound allowlist and
// restarts it. The tunnel is rebuilt rather than patched: the process-wide host
// routes each peer key to exactly one tunnel, so the old one must give its
// routes up before the replacement claims them.
func handleUpdateTunnelPeers(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	old := tunnel.Get(id)
	if old == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}
	if old.Type() != tunnel.P2PTunnel {
		writeError(w, http.StatusBadRequest, "only p2p tunnels have an allowlist")
		return
	}

	var req tunnelPeersRequest
	if !readJSON(w, r, &req) {
		return
	}

	peers := make([]string, 0, len(req.Peers))
	aliases := make(map[string]string, len(req.Peers))
	seen := make(map[string]bool, len(req.Peers))
	for _, p := range req.Peers {
		key := strings.TrimSpace(p.Key)
		if !tunnel.ValidPeerKey(key) {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("peer %q is not a base64 public key", key))
			return
		}
		if seen[key] {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("peer %s is listed twice", key))
			return
		}
		seen[key] = true
		peers = append(peers, key)
		if a := strings.TrimSpace(p.Alias); a != "" {
			aliases[key] = a
		}
	}

	// The list is taken in place: the routes are reconciled on the
	// process-wide host, so the tunnel's service keeps running and a live peer
	// stream is not cut. A conflict (a key another tunnel holds) leaves
	// everything as it was and is reported as such.
	setter, ok := old.(tunnel.PeerSetter)
	if !ok {
		writeError(w, http.StatusInternalServerError, "tunnel does not take a peer list")
		return
	}
	if err := setter.SetPeers(peers, aliases); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	writeJSON(w, http.StatusOK, toTunnelResponse(old))
}
