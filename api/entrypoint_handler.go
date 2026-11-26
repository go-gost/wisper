package api

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
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
	// Peer is the remote peer's base64 public key (p2p, tun and tungo
	// entrypoints).
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
	// ShareLAN lists the LAN subnets this spoke shares with the hub,
	// comma-separated CIDRs. Empty disables sharing.
	ShareLAN string `json:"share_lan,omitempty"`
	// ShareMode pins the sharing implementation (auto/kernel/userspace).
	// Empty leaves the default (auto).
	ShareMode string `json:"share_mode,omitempty"`
	// BlockedPeers is the spoke's local inbound block list. It is a pointer
	// so an omitted field is distinguishable from an explicit clear: absent
	// on an update keeps the old list, [] clears it.
	BlockedPeers *[]string `json:"blocked_peers,omitempty"`
	// Direct enables the mesh data path. A pointer for the same reason: absent
	// on an update keeps the old value, explicit false turns it off.
	Direct *bool `json:"direct,omitempty"`
	// Rules is a tungo entrypoint's split list: the destinations that go through
	// the tunnel, everything else dialled directly. A pointer for the same reason
	// as BlockedPeers: absent on an update keeps the saved list, [] clears it (and
	// an empty list is a working split — everything direct).
	Rules *[]string `json:"rules,omitempty"`
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
		tunnel.ShareLANOption(r.ShareLAN),
		tunnel.ShareModeOption(r.ShareMode),
		tunnel.BlockedPeersOption(derefStrings(r.BlockedPeers)...),
		tunnel.DirectOption(derefBool(r.Direct)),
		tunnel.RulesOption(derefStrings(r.Rules)...),
	}
}

func derefStrings(p *[]string) []string {
	if p == nil {
		return nil
	}
	return *p
}

func derefBool(p *bool) bool {
	return p != nil && *p
}

// validateTunNet rejects a device address the tun listener would otherwise
// skip silently: x splits "net" and drops every entry it cannot parse, so a
// typo would start a device with no address at all.
func validateTunNet(netStr string) error {
	if strings.TrimSpace(netStr) == "" {
		return fmt.Errorf("net is required: the device address, e.g. 10.10.0.1/24")
	}
	for _, s := range strings.Split(netStr, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(s); err != nil {
			return fmt.Errorf("invalid net %q: %v", s, err)
		}
	}
	return nil
}

// validateTunRoutes checks the optional route list ("cidr [gw]" pairs). Like
// net, an unparseable entry is skipped by the listener, so a typo would leave a
// subnet unreachable with no error anywhere.
func validateTunRoutes(routes string) error {
	for _, s := range strings.Split(routes, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		fields := strings.Fields(s)
		if _, _, err := net.ParseCIDR(fields[0]); err != nil {
			return fmt.Errorf("invalid route %q: %v", fields[0], err)
		}
		if len(fields) > 1 && net.ParseIP(fields[1]) == nil {
			return fmt.Errorf("invalid route gateway %q", fields[1])
		}
	}
	return nil
}

// validateTunDNS checks the optional comma-separated DNS server list.
func validateTunDNS(dns string) error {
	for _, s := range strings.Split(dns, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if net.ParseIP(s) == nil {
			return fmt.Errorf("invalid dns server %q", s)
		}
	}
	return nil
}

// validateEntryPointRequest rejects a request the runtime cannot honor, before
// any object is constructed.
func validateEntryPointRequest(epType string, req *entrypointCreateRequest) error {
	// The rule list belongs to the split: a tun or p2p entrypoint has no split to
	// apply it to, so a request that carries one is a client bug worth naming
	// rather than a field that is silently dropped.
	if epType != entrypoint.TungoEntryPoint && len(derefStrings(req.Rules)) > 0 {
		return fmt.Errorf("rules applies to tungo entrypoints")
	}
	switch epType {
	case entrypoint.TunEntryPoint:
		return validateTunEntryPoint(req)
	case entrypoint.TungoEntryPoint:
		return validateTungoEntryPoint(req)
	}
	return nil
}

// validateDeviceFields checks what every device entrypoint shares: the device
// address, the route list and the resolver list. The listener skips an entry it
// cannot parse without a word, so a typo here is a device that silently misses a
// subnet or answers no queries.
func validateDeviceFields(r *entrypointCreateRequest) error {
	if err := validateTunNet(r.Net); err != nil {
		return err
	}
	if err := validateTunRoutes(r.Routes); err != nil {
		return err
	}
	return validateTunDNS(r.DNS)
}

// validateTungoEntryPoint checks what a split spoke cannot do without: the
// device fields, a device that captures its traffic, and the hub's public key (a
// bad key would leave the chain node dialing nothing, with no error on the way
// out). The rule list may be empty: that is a working split that sends
// everything direct.
func validateTungoEntryPoint(r *entrypointCreateRequest) error {
	if err := validateDeviceFields(r); err != nil {
		return err
	}
	if err := validateTungoSplit(r); err != nil {
		return err
	}
	if !tunnel.ValidPeerKey(r.Peer) {
		return fmt.Errorf("peer must be the hub's base64 public key")
	}
	return nil
}

// The two catch-alls a split defaults to when its route list is empty. A device
// that captures only one address family sends every flow of the other one around
// the tunnel — the one leak this tool cannot have — so neither catch-all travels
// without the other.
const (
	catchAllV4 = "0.0.0.0/0"
	catchAllV6 = "::/0"
)

// tungoDefaultDNS is the resolver a split hands its device when the form leaves
// dns empty: the address the hub's dns service answers on (the design's §5.1).
// It is only handed out when the routes actually reach it: a resolver the device
// cannot route to is worse than none, because blank dns means "no override, use
// the phone's own resolver".
const tungoDefaultDNS = "192.168.100.100"

// validateTungoSplit normalises the split's device fields in place and before
// the entrypoint is built, so the value that is stored is the safe one:
//
//   - an empty route list defaults to both catch-alls, capturing all traffic;
//     the split rules then decide which flows use the tunnel and which go direct.
//     A narrow list is a deliberate choice and is left exactly as written;
//   - a catch-all without the other family's one leaks that family around the
//     split, so the missing catch-all is appended (a named-subnet split, with
//     neither catch-all, is left exactly as written);
//   - an empty dns list is filled in with the tunnel's own resolver, but only
//     when the routes cover it: a narrow split keeps its dns empty and lets the
//     phone resolve, rather than handing the device an unreachable server. The
//     route list is never widened to make the default fit — that would send
//     traffic into the tunnel the operator deliberately kept out.
func validateTungoSplit(r *entrypointCreateRequest) error {
	if strings.TrimSpace(r.Routes) == "" {
		r.Routes = catchAllV4 + ", " + catchAllV6
	}
	r.Routes = withCatchAlls(r.Routes)
	if strings.TrimSpace(r.DNS) == "" && routesReach(r.Routes, tungoDefaultDNS) {
		r.DNS = tungoDefaultDNS
	}
	return nil
}

// withCatchAlls appends the catch-all of the family the list is missing when the
// other one is present. Anything else — a named subnet, both catch-alls — is
// returned unchanged: those are the operator's own choices, not a leak.
func withCatchAlls(routes string) string {
	var hasV4, hasV6 bool
	for _, s := range strings.Split(routes, ",") {
		fields := strings.Fields(strings.TrimSpace(s))
		if len(fields) == 0 {
			continue
		}
		switch fields[0] {
		case catchAllV4:
			hasV4 = true
		case catchAllV6:
			hasV6 = true
		}
	}
	switch {
	case hasV4 && !hasV6:
		return routes + ", " + catchAllV6
	case hasV6 && !hasV4:
		return routes + ", " + catchAllV4
	}
	return routes
}

// routesReach reports whether one of the comma-separated route entries covers
// addr. A route is a "cidr [gw]" pair; only the CIDR counts, and a prefix of one
// family never covers an address of the other, however the two compare as bytes.
func routesReach(routes, addr string) bool {
	ip := net.ParseIP(addr)
	if ip == nil {
		return false
	}
	for _, s := range strings.Split(routes, ",") {
		fields := strings.Fields(strings.TrimSpace(s))
		if len(fields) == 0 {
			continue
		}
		_, n, err := net.ParseCIDR(fields[0])
		if err != nil {
			continue
		}
		if (n.IP.To4() == nil) != (ip.To4() == nil) {
			continue
		}
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// validateTunEntryPoint checks what a tun spoke cannot do without: a device
// address and the hub's public key, plus the one device field of its own —
// share_lan, the LAN it hands its hub.
func validateTunEntryPoint(r *entrypointCreateRequest) error {
	if err := validateDeviceFields(r); err != nil {
		return err
	}
	if !tunnel.ValidPeerKey(r.Peer) {
		return fmt.Errorf("peer must be the hub's base64 public key")
	}
	// A malformed share_lan is refused here rather than at Run, as for a tun
	// hub (see validateTunTunnel): the create would otherwise answer 201 and
	// the spoke would fail to start, leaving a stored entrypoint that never
	// runs.
	if _, err := tunnel.ParseShareLANNets(r.ShareLAN); err != nil {
		return fmt.Errorf("share_lan %q is not a comma-separated list of CIDRs: %v", r.ShareLAN, err)
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

	// A second tun entrypoint cannot run (one VPN device, see CheckTunDeviceFree),
	// so the create is refused before it leaves a stopped entrypoint behind.
	if err := entrypoint.CheckTunDeviceFree(ep.ID()); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	// Add before starting: an Android tun entrypoint waits for a device the
	// app's poll hands over only once the entrypoint is listed, so it has to be
	// in the list before Start goes looking for one.
	entrypoint.Add(ep)
	event.Record(ep.ID(), event.LevelInfo, "created")
	entrypoint.Start(r.Context(), ep)
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

const (
	defaultEntrypointRequestLimit = 50
	maxEntrypointRequestLimit     = 500
)

type entrypointRequestsResponse struct {
	Requests []entrypoint.Request `json:"requests"`
}

func handleGetEntrypointRequests(w http.ResponseWriter, r *http.Request) {
	ep := entrypoint.Get(r.PathValue("id"))
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}

	limit := defaultEntrypointRequestLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = n
	}
	if limit > maxEntrypointRequestLimit {
		limit = maxEntrypointRequestLimit
	}

	var requests []entrypoint.Request
	if lister, ok := ep.(interface {
		Requests(int) []entrypoint.Request
	}); ok {
		requests = lister.Requests(limit)
	}
	if requests == nil {
		requests = []entrypoint.Request{}
	}
	writeJSON(w, http.StatusOK, entrypointRequestsResponse{Requests: requests})
}

type entrypointRulesRequest struct {
	// A pointer distinguishes "no rules field" from an explicit [] — the latter
	// is a valid split that sends every flow direct.
	Rules *[]string `json:"rules"`
}

func handleUpdateEntrypointRules(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ep := entrypoint.Get(id)
	if ep == nil {
		writeError(w, http.StatusNotFound, "entrypoint not found")
		return
	}
	if ep.Type() != entrypoint.TungoEntryPoint {
		writeError(w, http.StatusBadRequest, "rules applies to tungo entrypoints")
		return
	}
	setter, ok := ep.(entrypoint.RuleSetter)
	if !ok {
		writeError(w, http.StatusBadRequest, "entrypoint does not support rules")
		return
	}

	var req entrypointRulesRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Rules == nil {
		writeError(w, http.StatusBadRequest, "rules is required")
		return
	}

	setter.SetRules(*req.Rules)
	event.Record(id, event.LevelInfo, "updated")
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
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

	// Refused before the old entrypoint is closed: a replacement that cannot get
	// the device would otherwise take the running one down with it.
	if err := entrypoint.CheckTunDeviceFree(id); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	// Capture what an omitted field means before Close discards the old run.
	// BlockedPeers and Rules are the fields this request may leave alone: an
	// update form that never mentions one must not silently clear the operator's
	// local block, or turn a split into "everything direct".
	oldOpts := old.Options()
	if req.BlockedPeers == nil {
		blocked := append([]string(nil), oldOpts.BlockedPeers...)
		req.BlockedPeers = &blocked
	}
	if req.Direct == nil {
		direct := oldOpts.Direct
		req.Direct = &direct
	}
	if req.Rules == nil {
		rules := append([]string(nil), oldOpts.Rules...)
		req.Rules = &rules
	}

	// The path owns the identity. The body ID is optional, and an update that
	// omits it must not create a replacement with an empty/new ID: a new ID would
	// make the UI's detail URL point at nothing.
	req.ID = id

	// The replacement is built before the old entrypoint lets go, so a request
	// the runtime cannot honor leaves the running one alone. It is also what the
	// hot path below compares against: the constructor is what applies the
	// defaults (name, MTU), so "nothing else changed" is exact rather than a
	// guess at which fields the form restated.
	opts := append([]tunnel.Option{
		tunnel.CreatedAtOption(oldOpts.CreatedAt),
	}, req.toOptions()...)

	ep := entrypoint.NewByType(epType, opts...)
	if ep == nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown entrypoint type: %s", epType))
		return
	}

	// A split list is a live object the chain resolves by name, so an edit that
	// changes nothing else is applied in place. Rebuilding instead would take the
	// VPN device down and back up — dropping every flow on it, and restarting
	// what the counters are measured against — for a change the running split can
	// take on its own.
	if rs, ok := old.(entrypoint.RuleSetter); ok && rulesOnlyUpdate(old, epType, oldOpts, ep) {
		rs.SetRules(derefStrings(req.Rules))
		event.Record(id, event.LevelInfo, "updated")
		if err := entrypoint.SaveConfig(); err != nil {
			slog.Error("save config", "err", err)
		}
		writeJSON(w, http.StatusOK, toTunnelResponse(old))
		return
	}

	// Every entrypoint type binds its own local address (and a p2p one also
	// claims a provider name on the shared host), so the old one has to let go
	// before the replacement can start.
	old.Close()

	ep.SetStats(old.Stats())
	ep.SetStatsBaseline(old.StatsBaseline())
	ep.Favorite(old.IsFavorite())
	entrypoint.PreserveRequestHistory(ep, old)

	// Swap, then start — the same order create and start use, and the only one
	// that works: the replacement has to be listed for an Android tun device to
	// be handed over (see Start). Starting it here *and* through Start would run
	// it twice: the second Run replaces the first's service (leaving it serving
	// forever with nobody to close it) and unregisters the provider name the
	// first one registered, closing the shared p2p host on the way out.
	// Delete's own Close is the repeat a second explicit old.Close() would only
	// duplicate — while the replacement is up, every extra Close is another
	// chance to unregister the name it now holds.
	entrypoint.Delete(id)

	entrypoint.Add(ep)
	event.Record(ep.ID(), event.LevelInfo, "updated")
	entrypoint.Start(r.Context(), ep)
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	writeJSON(w, http.StatusOK, toTunnelResponse(ep))
}

// rulesOnlyUpdate reports whether this update asks a running, healthy
// entrypoint of the same type for nothing but a new rule list — the edit that is
// applied in place instead of rebuilding the run. A request that changes the
// type is a rebuild whatever else it restates, and a stopped or failing
// entrypoint is rebuilt as it always was: saving one is also the way to make it
// start again.
func rulesOnlyUpdate(old entrypoint.EntryPoint, epType string, oldOpts tunnel.Options, next entrypoint.EntryPoint) bool {
	if epType != old.Type() || old.IsClosed() || old.Err() != nil || tunnel.IsServiceFailed(old) {
		return false
	}
	return sameRunOptions(oldOpts, next.Options())
}

// sameRunOptions reports whether two option sets describe the same run, which is
// what lets a rules-only edit be applied to a live entrypoint instead of
// rebuilding it. The rule list is left out on purpose — it is the field the edit
// is allowed to change — as are the identity, the creation time and the counters:
// those belong to the object, not to the request. ShareMode is compared as its
// normalized value, because the response already maps an unset mode to "auto"
// and a client that saves back what it read means the same thing. Everything else
// is compared as a whole, so a field added later cannot leak in as "unchanged":
// it forces the rebuild path until someone decides otherwise.
func sameRunOptions(a, b tunnel.Options) bool {
	for _, o := range []*tunnel.Options{&a, &b} {
		o.ID, o.CreatedAt = "", time.Time{}
		o.Rules = nil
		o.ShareMode = tunnel.NormalizeShareMode(o.ShareMode)
		o.Stats, o.StatsBaseline = config.ServiceStats{}, config.ServiceStats{}
	}
	return reflect.DeepEqual(a, b)
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

	name := ep.Name()
	entrypoint.Delete(id)
	event.Seed(id, nil)
	event.Global(event.LevelWarn, "%s: deleted", name)
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

	if err := entrypoint.CheckTunDeviceFree(id); err != nil {
		writeError(w, http.StatusConflict, err.Error())
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
	entrypoint.PreserveRequestHistory(newEP, ep)

	// Same as create: listed first, then started (see Start).
	entrypoint.Set(newEP)
	event.Record(newEP.ID(), event.LevelInfo, "started")
	entrypoint.Start(r.Context(), newEP)
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
	event.Record(id, event.LevelInfo, "stopped")
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
