package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-gost/p2p"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
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
	// PeerStats is every allowlisted peer's traffic, allowlist order: a p2p
	// tunnel's peers or a tun hub's spokes.
	PeerStats []peerStatsJSON `json:"peer_stats,omitempty"`
	// PeerTransport is where a p2p entrypoint's peer traffic goes right now:
	// "direct" or "derp". Empty when it is not connected, or not a p2p object.
	PeerTransport string `json:"peer_transport,omitempty"`
	// Events is this object's recent history, newest first.
	Events []eventResponse `json:"events"`
}

// peerStatsJSON is one peer's traffic in the tunnel's current run, plus the
// p2p host's live diagnostic for it (path, punch state, last error, dialled
// endpoint, ages) so the peers page can expand a row without a second call.
type peerStatsJSON struct {
	Key           string   `json:"key"`
	Alias         string   `json:"alias,omitempty"`
	Transport     string   `json:"transport,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	State         string   `json:"state,omitempty"`
	Failed        bool     `json:"failed,omitempty"`
	LastError     string   `json:"last_error,omitempty"`
	PeerAddr      string   `json:"peer_addr,omitempty"`
	Candidates    int      `json:"candidates,omitempty"`
	Caps          []string `json:"caps,omitempty"`
	SessionAgeMs  int64    `json:"session_age_ms,omitempty"`
	LastRecvAgeMs int64    `json:"last_recv_age_ms,omitempty"`
	// Trace is the peer's recent punch history: short lines, oldest first
	// (newest kept), capped by the p2p host's ring.
	Trace           []string `json:"trace,omitempty"`
	CurrentConns    uint64   `json:"current_conns"`
	TotalConns      uint64   `json:"total_conns"`
	InputBytes      uint64   `json:"input_bytes"`
	OutputBytes     uint64   `json:"output_bytes"`
	InputRateBytes  uint64   `json:"input_rate_bytes"`
	OutputRateBytes uint64   `json:"output_rate_bytes"`
}

// peerJSON is one allowlist entry: the key is the credential, the alias its
// display name. The alias is optional on the way in (it is generated when
// omitted) and always present on the way out.
type peerJSON struct {
	Key   string `json:"key"`
	Alias string `json:"alias,omitempty"`
	// Disabled keeps the peer on the list without giving it a route: its new
	// streams are closed while established ones drain.
	Disabled bool `json:"disabled,omitempty"`
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
	// Peers is a p2p tunnel's or a tun hub's inbound allowlist. Empty is valid
	// for a p2p tunnel — it runs and routes nothing — but a tun hub rejects it.
	Peers []peerJSON `json:"peers,omitempty"`
	// A tun entrypoint's device: its address, MTU, name, routed subnets and
	// DNS servers.
	Net        string `json:"net,omitempty"`
	MTU        int    `json:"mtu,omitempty"`
	DeviceName string `json:"device_name,omitempty"`
	Routes     string `json:"routes,omitempty"`
	DNS        string `json:"dns,omitempty"`
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

// peersJSON pairs each allowlisted key with its display alias and whether it is
// switched off. A key without an alias (a config older than aliases) is
// normalized on the way out, so the UI always has a name to show.
func peersJSON(peers []string, aliases map[string]string, disabled []string) []peerJSON {
	normalized := tunnel.NormalizePeerAliases(peers, aliases)
	off := make(map[string]bool, len(disabled))
	for _, k := range disabled {
		off[k] = true
	}
	out := make([]peerJSON, 0, len(peers))
	seen := make(map[string]bool, len(peers))
	for _, k := range peers {
		if a, ok := normalized[k]; ok && !seen[k] {
			seen[k] = true
			out = append(out, peerJSON{Key: k, Alias: a, Disabled: off[k]})
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
			Password:    opts.Password,
			BasicAuth:   opts.Username != "",
			EnableTLS:   opts.EnableTLS,
			RewriteHost: opts.RewriteHost,
			FileUpload:  opts.FileUpload,
			Keepalive:   opts.Keepalive,
			TTL:         opts.TTL,
			RecordMode:  opts.RecordMode,
			Peer:        opts.Peer,
			Protocol:    opts.Protocol,
			Peers:       peersJSON(opts.Peers, opts.PeerAliases, opts.PeerDisabled),
			Net:         opts.Net,
			MTU:         opts.MTU,
			DeviceName:  opts.DeviceName,
			Routes:      opts.Routes,
			DNS:         opts.DNS,
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
	// The p2p host's current state per peer, when this object has p2p peers —
	// for a p2p tunnel's allowlist, a tun hub's spokes (the same peers on the
	// same host: a hub reaches its spokes over p2p, so its allowlist is a p2p
	// allowlist), and a p2p entrypoint's single peer. One snapshot read serves
	// both the path word and the per-peer diagnostics.
	var transports map[string]string
	var diagnostics map[string]p2p.PeerDiagnostic
	if hasP2PPeers(opts) {
		st := tunnel.P2PHostStatus()
		transports = st.PeerTransports
		diagnostics = st.PeerDiagnostics
	}
	if ps, ok := t.(tunnel.PeerStatsReporter); ok {
		for _, p := range ps.PeerStats() {
			d := diagnostics[p.Key]
			resp.PeerStats = append(resp.PeerStats, peerStatsJSON{
				Key:             p.Key,
				Alias:           opts.PeerAliases[p.Key],
				Transport:       transports[p.Key],
				Reason:          d.Reason,
				State:           d.State,
				Failed:          d.Failed,
				LastError:       d.LastError,
				PeerAddr:        d.PeerAddr,
				Candidates:      d.Candidates,
				Caps:            d.Caps,
				SessionAgeMs:    d.SessionAge.Milliseconds(),
				LastRecvAgeMs:   d.LastRecvAge.Milliseconds(),
				Trace:           d.Trace,
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
	resp.Events = toEventResponses(event.List(t.ID()))
	return resp
}

// hasP2PPeers reports whether this object has peers whose state the
// process-wide p2p host knows about, and so whether its response should carry
// the host's per-peer words — the path (direct or relay), the punch state, the
// last error.
//
// It is asked of the peers rather than of a tunnel type, because the peers are
// the question and not the type: a tun hub reaches its spokes over p2p, so its
// allowlist is a p2p allowlist and it was excluded from the host snapshot only
// because its type was not p2p. An empty allowlist is not a p2p tunnel — a p2p
// tunnel may run and route nothing — so a peer-less object of any type stays
// out, and the whole-host read is skipped for it.
func hasP2PPeers(opts tunnel.Options) bool {
	return opts.Peer != "" || len(opts.Peers) > 0
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
	Keepalive   bool   `json:"keepalive,omitempty"`
	TTL         int    `json:"ttl,omitempty"`
	RecordMode  string `json:"record_mode,omitempty"`
	// Peer is the remote peer's base64 public key (p2p entrypoints).
	Peer string `json:"peer,omitempty"`
	// Peers is a p2p tunnel's inbound allowlist; an entry's alias is optional
	// and generated when omitted.
	Peers []peerJSON `json:"peers,omitempty"`
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

func (r *tunnelCreateRequest) toOptions() []tunnel.Option {
	peers := make([]string, 0, len(r.Peers))
	aliases := make(map[string]string, len(r.Peers))
	var disabled []string
	for _, p := range r.Peers {
		peers = append(peers, p.Key)
		if p.Alias != "" {
			aliases[p.Key] = p.Alias
		}
		if p.Disabled {
			disabled = append(disabled, p.Key)
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
		tunnel.KeepaliveOption(r.Keepalive),
		tunnel.TTLOption(r.TTL),
		tunnel.RecordModeOption(r.RecordMode),
		tunnel.PeerOption(r.Peer),
		tunnel.PeersOption(peers...),
		tunnel.PeerAliasesOption(aliases),
		tunnel.PeerDisabledOption(tunnel.NormalizePeerDisabled(peers, disabled)),
		tunnel.NetOption(r.Net),
		tunnel.MTUOption(r.MTU),
		tunnel.DeviceNameOption(r.DeviceName),
		tunnel.RoutesOption(r.Routes),
		tunnel.DNSOption(r.DNS),
	}
}

// validateTunnelRequest rejects a request the runtime cannot honor, before any
// object is constructed. Only the types with structural requirements appear
// here; everything else is validated by its constructor.
func validateTunnelRequest(tunnelType string, req *tunnelCreateRequest) error {
	switch tunnelType {
	case tunnel.TunTunnel:
		return validateTunTunnel(req)
	}
	return nil
}

// validateTunTunnel checks what a tun hub cannot work without: a device
// address, and no endpoint — the p2p hub binds nothing, so the same rule
// tunnel/tun.go's init applies, and for the same reason (a hub carried over
// from the socket form says why it stopped working instead of silently
// changing meaning).
//
// The allowlist is not required: it is managed on its own peers page, which
// the create form never reaches, so a hub starts with no spokes and its first
// one is added there. What an empty list means — up, routing nothing — is
// recorded as an event at creation and on every save that leaves it empty,
// rather than refused here.
//
// The device fields are checked by validateTunNet and friends — the same rules
// apply to both ends of the device.
func validateTunTunnel(r *tunnelCreateRequest) error {
	if ep := strings.TrimSpace(r.Endpoint); ep != "" {
		return fmt.Errorf("a tun hub binds no address: clear the endpoint (%s) — the peer allowlist is the whole configuration", ep)
	}
	if err := validateTunNet(r.Net); err != nil {
		return err
	}
	if err := validateTunRoutes(r.Routes); err != nil {
		return err
	}
	return validateTunDNS(r.DNS)
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

	if err := validateTunnelRequest(req.Type, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	t := tunnel.NewByType(req.Type, req.toOptions()...)
	if t == nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown tunnel type: %s", req.Type))
		return
	}

	// The request's action id rides the p2p seam calls Run makes (Listen,
	// Warm), so this click can be joined with the p2p log line it produced.
	if err := tunnel.RunWithContext(r.Context(), t); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tunnel: "+err.Error())
		return
	}

	tunnel.Add(t)
	event.Record(t.ID(), event.LevelInfo, "created")
	noteNoSpokes(t)
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	writeJSON(w, http.StatusCreated, toTunnelResponse(t))
}

// noteNoSpokes records that a tun hub is up with nothing to route, for the two
// moments it becomes true: a hub created before its first spoke arrives, and a
// hub whose last spoke was just removed on the peers page. Both read as broken
// otherwise — a hub is running, its device is there, and a request to it is
// simply never answered — and the peers page is where the fix is, so the event
// says so.
//
// A hub is the only type this applies to: a p2p tunnel is reached by its own
// peers over a separate route, so an empty list there has always been a normal
// state with nothing to announce. warn, not error — the hub is running, and the
// user is expected to be here (that is why it is empty).
func noteNoSpokes(t tunnel.Tunnel) {
	if t.Type() != tunnel.TunTunnel || len(t.Options().Peers) > 0 {
		return
	}
	event.Record(t.ID(), event.LevelWarn, "no spokes yet — this hub is up but routes nothing, so requests to it go unanswered until a spoke is added on the peers page")
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

	if err := validateTunnelRequest(tunnelType, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// A p2p tunnel cannot be replaced while it lives: the process-wide host
	// routes each peer key to exactly one tunnel, so the old one must give its
	// routes up first (everything else swaps its own socket after the
	// replacement runs). A tun hub is the same shape: its allowlist is the same
	// process-wide host's, so the old one must release its routes first.
	if old.Type() == tunnel.P2PTunnel || old.Type() == tunnel.TunTunnel {
		old.Close()
	}

	// Create replacement with same ID first (before deleting old).
	opts := append([]tunnel.Option{
		tunnel.IDOption(id),
		tunnel.CreatedAtOption(old.Options().CreatedAt),
	}, req.toOptions()...)

	t := tunnel.NewByType(tunnelType, opts...)
	if t == nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown tunnel type: %s", tunnelType))
		return
	}

	t.SetStats(old.Stats())
	t.SetStatsBaseline(old.StatsBaseline())
	t.Favorite(old.IsFavorite())

	if err := tunnel.RunWithContext(r.Context(), t); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to restart tunnel: "+err.Error())
		return
	}

	// Swap: only delete old after new is running successfully.
	old.Close()
	tunnel.Delete(id)

	tunnel.Add(t)
	event.Record(t.ID(), event.LevelInfo, "updated")
	noteNoSpokes(t)
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

	name := t.Name()
	tunnel.Delete(id)
	event.Seed(id, nil)
	event.Global(event.LevelWarn, "%s: deleted", name)
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
	newT := tunnel.NewByType(t.Type(), tunnel.TunnelOptions(t.Options())...)
	if newT == nil {
		writeError(w, http.StatusInternalServerError, "unknown tunnel type")
		return
	}

	newT.SetStats(t.Stats())
	newT.SetStatsBaseline(t.StatsBaseline())
	newT.Favorite(t.IsFavorite())

	if err := tunnel.RunWithContext(r.Context(), newT); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tunnel: "+err.Error())
		return
	}

	tunnel.Set(newT)
	event.Record(newT.ID(), event.LevelInfo, "started")
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
	event.Record(id, event.LevelInfo, "stopped")
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

// tunnelPeersRequest is the JSON body for saving a p2p tunnel's or a tun hub's
// allowlist on its own — the peers page changes the list without touching the
// rest of the tunnel's config.
type tunnelPeersRequest struct {
	Peers []peerJSON `json:"peers"`
}

// handleUpdateTunnelPeers replaces a p2p tunnel's or a tun hub's inbound
// allowlist. The list is taken in place, not by a rebuild: the process-wide
// host routes each peer key to exactly one tunnel, so the tunnel holding the
// old routes is the one that reconciles them — its service, its peer route and
// (for a hub) its tun device all keep running.
//
// Only the two p2p types answer this; anything else has no allowlist to manage.
func handleUpdateTunnelPeers(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	old := tunnel.Get(id)
	if old == nil {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return
	}
	if old.Type() != tunnel.P2PTunnel && old.Type() != tunnel.TunTunnel {
		writeError(w, http.StatusBadRequest, "only a p2p tunnel or a tun hub manages its allowlist on its own")
		return
	}

	var req tunnelPeersRequest
	if !readJSON(w, r, &req) {
		return
	}

	peers := make([]string, 0, len(req.Peers))
	aliases := make(map[string]string, len(req.Peers))
	var disabled []string
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
		if p.Disabled {
			disabled = append(disabled, key)
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
	if err := setter.SetPeers(r.Context(), peers, aliases, disabled); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	// Removing the last spoke is the moment an existing, working hub stops
	// answering, so the state is recorded where the user just was.
	noteNoSpokes(old)

	writeJSON(w, http.StatusOK, toTunnelResponse(old))
}
