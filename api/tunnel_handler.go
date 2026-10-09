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
	// ShareEffective is the LAN-sharing backend the hub actually settled on
	// ("kernel", "userspace", or "" when sharing is disabled). ShareDowngraded
	// is true when auto fell back to userspace — the badge that explains why
	// ping does not reach the LAN.
	ShareEffective  string `json:"share_effective,omitempty"`
	ShareDowngraded bool   `json:"share_downgraded,omitempty"`
	// Lan is a tun hub's installed LAN routes and each spoke's claim of them.
	// Absent for every other type, which is what keeps a p2p tunnel's response
	// free of a section nothing fills.
	Lan *lanResponse `json:"lan,omitempty"`
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
	// LAN lists the CIDRs this spoke's hub routes for it: what the spoke
	// claimed over the control channel and the hub approved. A p2p tunnel
	// carries none — it has no hub to claim to — and a spoke claiming nothing
	// has an empty column rather than an absent one, because "holds no LAN"
	// is a state worth showing next to one that holds two.
	LAN []string `json:"lan,omitempty"`
	// Disabled keeps the peer on the list without giving it a route: its new
	// streams are closed while established ones drain.
	Disabled bool `json:"disabled,omitempty"`
	// IP is the address this peer may claim on the hub's device network: a
	// comma-separated list of host addresses, never a prefix. A p2p tunnel ignores
	// it — it has no device network.
	//
	// A pointer, because absent and empty are different requests and must not
	// arrive as one value: nil means the request said nothing about this spoke's
	// address, so the spoke keeps the one it has, and a pointer to "" means the
	// operator cleared it, so the hub allocates afresh. As a plain string the two
	// were the same value, and "says nothing" then reallocated every row of every
	// save that did not restate the addresses — addresses moving under a save that
	// never mentioned them. The field is left out of the response for a spoke with
	// no address, which is that same sentence said back: nothing to change.
	IP *string `json:"ip,omitempty"`
}

type tunnelOptionsResp struct {
	Prefix   string `json:"prefix,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	Username string `json:"username,omitempty"`
	// No Password: the response never echoes the secret (CWE-522). The
	// username plus BasicAuth below are the only auth signals clients get;
	// updates resubmit the secret via tunnelCreateRequest.Password.
	BasicAuth   bool   `json:"basic_auth"`
	EnableTLS   bool   `json:"enableTLS,omitempty"`
	RewriteHost bool   `json:"rewriteHost,omitempty"`
	FileUpload  bool   `json:"file_upload,omitempty"`
	Keepalive   bool   `json:"keepalive,omitempty"`
	Probe       bool   `json:"probe,omitempty"`
	TTL         int    `json:"ttl,omitempty"`
	RecordMode  string `json:"record_mode,omitempty"`
	// Peer is the remote peer's base64 public key (p2p entrypoints).
	Peer string `json:"peer,omitempty"`
	// Protocol is a p2p entrypoint's inner protocol: "tcp" or "udp".
	Protocol string `json:"protocol,omitempty"`
	// Peers is a p2p tunnel's or a tun hub's inbound allowlist. Empty is valid
	// for a p2p tunnel — it runs and routes nothing — but a tun hub rejects it.
	Peers []peerJSON `json:"peers,omitempty"`
	// PeerIPs is a tun hub's address assignment whole, as the config file carries
	// it: peer key → the addresses that spoke may claim. It is the same values
	// Peers holds one row at a time, so a client may read either; a p2p tunnel
	// has no device and carries none.
	PeerIPs map[string]string `json:"peer_ips,omitempty"`
	// A tun entrypoint's device: its address, MTU, name, routed subnets and
	// DNS servers.
	Net        string `json:"net,omitempty"`
	MTU        int    `json:"mtu,omitempty"`
	DeviceName string `json:"device_name,omitempty"`
	Routes     string `json:"routes,omitempty"`
	DNS        string `json:"dns,omitempty"`
	// ShareLAN lists the hub-side LAN subnets shared with spokes
	// (comma-separated CIDRs, empty disables). ShareMode pins the
	// implementation: auto (default), kernel, or userspace.
	ShareLAN  string `json:"share_lan,omitempty"`
	ShareMode string `json:"share_mode,omitempty"`
	// LanAllow is the hub-side policy for the LANs a spoke may claim:
	// "key=cidr" rows, each naming the supernets that spoke may claim inside.
	// A spoke with no row claims nothing at all. LanRoutes is the hub's own
	// routes, each a "cidr [via addr] [allow=keys]" spec.
	LanAllow  string   `json:"lan_allow,omitempty"`
	LanRoutes []string `json:"lan_routes,omitempty"`
}

// lanRouteJSON is one LAN route a tun hub installed: the CIDR, the spoke that
// claimed it (or "static" for the hub's own config), the member that reaches
// it, and the members allowed to use it.
type lanRouteJSON struct {
	Prefix string   `json:"prefix"`
	Origin string   `json:"origin"`
	Peer   string   `json:"peer"`
	Allow  []string `json:"allow,omitempty"`
}

// lanResponse is a tun hub's LAN routing for the doctor: the installed table
// and each spoke's claim. A hub that is not running, or whose handler installs
// no prefix routes, carries an empty list — a hub with no LAN routes is a hub
// working as it did before the feature existed.
type lanResponse struct {
	Routes []lanRouteJSON `json:"routes"`
	// Claims is the same table per claimer, so a UI can show either the whole
	// net or one spoke's row of it without asking twice.
	Claims map[string]lanClaimJSON `json:"claims"`
}

// lanClaimJSON is one spoke's LAN: the CIDRs it holds and who may use them.
type lanClaimJSON struct {
	Prefixes []string `json:"prefixes"`
	Allow    []string `json:"allow,omitempty"`
}

// lanJSON renders the hub's installed routes as the doctor's table, and
// indexes the allow lists per claimer for the per-spoke column beside it.
func lanJSON(lan tunnel.LanState) *lanResponse {
	resp := &lanResponse{
		Routes: make([]lanRouteJSON, 0, len(lan.Routes)),
		Claims: make(map[string]lanClaimJSON),
	}
	for _, r := range lan.Routes {
		resp.Routes = append(resp.Routes, lanRouteJSON{
			Prefix: r.Prefix,
			Origin: r.Origin,
			Peer:   r.Peer,
			Allow:  r.Allow,
		})
	}
	for peer, claims := range lan.PeerClaims() {
		resp.Claims[peer] = lanClaimJSON{Prefixes: claims}
	}
	return resp
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
	ProbeSent       uint64  `json:"probe_sent"`
	ProbeAcked      uint64  `json:"probe_acked"`
	// The hub's LAN routing: LANs routed for, claims refused, LANs withdrawn.
	// Only a tun hub carries values; every other type leaves them zero.
	LanRouted    uint64 `json:"lan_routed"`
	LanDenied    uint64 `json:"lan_denied"`
	LanWithdrawn uint64 `json:"lan_withdrawn"`
}

// peersJSON pairs each allowlisted key with its display alias, whether it is
// switched off, and the address it may claim. A key without an alias (a config
// older than aliases) is normalized on the way out, so the UI always has a name
// to show.
//
// peerIPs is a tun hub's assignment — the map every response builds its rows
// from, since it is the one place the answers are already kept. It is passed
// rather than read from a tunnel so this stays a pure builder, and it is looked
// up per key: a p2p tunnel's rows have no address to carry, and a spoke with none
// assigned yet comes back with the field absent, which is what makes an absent
// value "keep what you have" rather than "hold nothing".
//
// lan is the hub's LAN routing per spoke — what each spoke currently holds — and
// it is passed for the same reason: the builder stays pure, a p2p tunnel passes
// nil, and a spoke holding nothing comes back with an empty column rather than
// an absent one, because "this spoke claims no LAN" is a state worth showing.
func peersJSON(peers []string, aliases map[string]string, disabled []string, peerIPs map[string]string, lan map[string][]string) []peerJSON {
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
			peer := peerJSON{Key: k, Alias: a, Disabled: off[k]}
			// Only a row that holds an address carries the field, so a client that
			// saves the list back is saying "unchanged" about a spoke with none —
			// which is the same thing, since there is nothing to keep and nothing to
			// change. A pointer to "" would mean the operator had asked for a new
			// address, and no response should read that way.
			if ips := peerIPs[k]; ips != "" {
				peer.IP = &ips
			}
			if claims := lan[k]; len(claims) > 0 {
				peer.LAN = claims
			}
			out = append(out, peer)
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
			Probe:       opts.Probe,
			TTL:         opts.TTL,
			RecordMode:  opts.RecordMode,
			Peer:        opts.Peer,
			Protocol:    opts.Protocol,
			Peers:       peersJSON(opts.Peers, opts.PeerAliases, opts.PeerDisabled, opts.PeerIPs, nil),
			PeerIPs:     opts.PeerIPs,
			Net:         opts.Net,
			MTU:         opts.MTU,
			DeviceName:  opts.DeviceName,
			Routes:      opts.Routes,
			DNS:         opts.DNS,
			ShareLAN:    opts.ShareLAN,
			ShareMode:   tunnel.NormalizeShareMode(opts.ShareMode),
			LanAllow:    opts.LanAllow,
			LanRoutes:   opts.LanRoutes,
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
			ProbeSent:       safeSub(s.ProbeSent, bl.ProbeSent),
			ProbeAcked:      safeSub(s.ProbeAcked, bl.ProbeAcked),
			LanRouted:       safeSub(s.LanRouted, bl.LanRouted),
			LanDenied:       safeSub(s.LanDenied, bl.LanDenied),
			LanWithdrawn:    safeSub(s.LanWithdrawn, bl.LanWithdrawn),
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
	// The hub's LAN routing: only a tun hub reports it, and it fills both the
	// per-spoke column above and the routes list below. Read once, because the
	// two views are one RIB snapshot and a second read could disagree with
	// the first about what is in force.
	if ls, ok := t.(tunnel.LanStateReporter); ok {
		lan := ls.LANState()
		resp.Lan = lanJSON(lan)
		for i := range resp.Options.Peers {
			if claims := lan.PeerClaims()[resp.Options.Peers[i].Key]; len(claims) > 0 {
				resp.Options.Peers[i].LAN = claims
			}
		}
	}
	// The badge reads what is actually running, not what was configured:
	// only a tun hub reports sharing state, so anything else stays absent.
	if ss, ok := t.(interface {
		ShareState() (string, string, string, bool)
	}); ok {
		_, _, eff, down := ss.ShareState()
		resp.ShareEffective = eff
		resp.ShareDowngraded = down
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
	Name     string `json:"name"`
	Type     string `json:"type"`
	Endpoint string `json:"endpoint"`
	Prefix   string `json:"prefix,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	Username string `json:"username,omitempty"`
	// Password is a pointer so the full-tunnel PUT can tell "says nothing,
	// keep the stored secret" (nil, field absent) from "clear it" (pointer
	// to ""). The response never echoes it (CWE-522), so the UI's edit form
	// always submits nil unless the operator typed a new secret — without
	// this, every unrelated edit would wipe auth. Same nil-vs-empty
	// sentence the spoke IP field speaks.
	Password    *string `json:"password,omitempty"`
	EnableTLS   bool    `json:"enableTLS,omitempty"`
	RewriteHost bool    `json:"rewriteHost,omitempty"`
	FileUpload  bool    `json:"file_upload,omitempty"`
	Keepalive   bool    `json:"keepalive,omitempty"`
	TTL         int     `json:"ttl,omitempty"`
	RecordMode  string  `json:"record_mode,omitempty"`
	// Peer is the remote peer's base64 public key (p2p entrypoints).
	Peer string `json:"peer,omitempty"`
	// Peers is a p2p tunnel's inbound allowlist; an entry's alias is optional
	// and generated when omitted. A tun hub's spokes arrive the same way, and an
	// entry's ip is the address that spoke may claim — the field a full-tunnel PUT
	// has to carry, or the hub it rebuilds comes back with no assignment at all.
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
	// ShareLAN lists the hub-side LAN subnets shared with spokes
	// (comma-separated CIDRs, empty disables). ShareMode pins the
	// implementation: auto (default), kernel, or userspace.
	ShareLAN  string `json:"share_lan,omitempty"`
	ShareMode string `json:"share_mode,omitempty"`
	// LanAllow is the hub-side policy for the LANs a spoke may claim:
	// "key=cidr" rows, each naming the supernets that spoke may claim inside.
	// A spoke with no row claims nothing at all. LanRoutes is the hub's own
	// routes, each a "cidr [via addr] [allow=keys]" spec.
	LanAllow  string   `json:"lan_allow,omitempty"`
	LanRoutes []string `json:"lan_routes,omitempty"`
}

// settlePeerIPs applies a tun hub's address policy to the rows of a request, and
// is the one door onto it: create, the full-tunnel PUT and the peers-only PUT all
// come through here, so a proposed configuration is answered the same way whichever
// request proposed it.
//
// Three rules, in this order:
//
//   - absent means unchanged. A row whose ip is not in the request keeps what the
//     spoke already holds, so a client that saves a form without restating the
//     addresses — or adds one spoke to a list it was shown — moves nothing. This is
//     the rule that makes an address attached to a spoke rather than to the list
//     position it happens to occupy.
//   - present and empty means cleared. It is the only way to ask for a new address,
//     and the ask is honoured by the allocation below.
//   - everything left blank is then filled from the hub's own subnet, in the order
//     the rows were listed.
//
// current is the assignment in force — old.Options().PeerIPs on a save of a running
// hub, nil on a create, where a spoke has nothing to keep and so is simply new.
// netSpec is the net being *asked for*, not the one the running hub holds: a PUT
// that moves a hub to a different subnet proposes exactly that, and its rows have to
// be judged against the subnet they would live on. Asking the running hub's instead
// would bless a configuration that cannot work.
//
// A non-hub gets nil and no error: a p2p tunnel has no device network, so its rows
// carry no address and there is nothing to settle.
func settlePeerIPs(tunnelType string, rows []peerJSON, current map[string]string, netSpec string) (map[string]string, error) {
	if tunnelType != tunnel.TunTunnel {
		return nil, nil
	}
	// The order is the order the rows were listed in, which is the allowlist order
	// and so the order the peers page shows and the one allocation walks. Keys are
	// trimmed here for the same reason the peers handler trims them: a padded key
	// would otherwise get a row of its own that the allowlist does not list.
	peers := make([]string, 0, len(rows))
	resolved := make(map[string]string, len(rows))
	for _, p := range rows {
		key := strings.TrimSpace(p.Key)
		peers = append(peers, key)
		if p.IP != nil {
			resolved[key] = strings.TrimSpace(*p.IP)
			continue
		}
		// Absent: the address this spoke already has. A spoke new to the hub reads
		// as the empty string, which is not "unchanged" but "nothing yet" — and so
		// is allocated below like any other blank row.
		resolved[key] = current[key]
	}
	return tunnel.AllocatePeerIPs(peers, resolved, netSpec)
}

// derefPassword unwraps an optional request password: absent means "no
// secret supplied" and settles to "" for the option layer.
func derefPassword(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (r *tunnelCreateRequest) toOptions(peerIPs map[string]string) []tunnel.Option {
	peers := make([]string, 0, len(r.Peers))
	aliases := make(map[string]string, len(r.Peers))
	var disabled []string
	for _, p := range r.Peers {
		key := strings.TrimSpace(p.Key)
		peers = append(peers, key)
		if p.Alias != "" {
			aliases[key] = p.Alias
		}
		if p.Disabled {
			disabled = append(disabled, key)
		}
	}
	aliases = tunnel.NormalizePeerAliases(peers, aliases)

	return []tunnel.Option{
		tunnel.NameOption(r.Name),
		tunnel.EndpointOption(r.Endpoint),
		tunnel.PrefixOption(r.Prefix),
		tunnel.HostnameOption(r.Hostname),
		tunnel.UsernameOption(r.Username),
		tunnel.PasswordOption(derefPassword(r.Password)),
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
		// peerIPs is the settled assignment the caller passed in — it comes from
		// settlePeerIPs rather than being re-read from the rows here, so that a hub
		// rebuilt by the full-tunnel PUT cannot be handed rows nobody validated and
		// nobody allocated. Not optional, and the reason is that PUT: it rebuilds the
		// hub from this request, so an assignment missing here is a hub restarted
		// with none, every spoke refused as unknown, and SaveConfig writing peer_ips
		// back as null — a working network turned off by an unrelated edit.
		tunnel.PeerIPsOption(tunnel.NormalizePeerIPs(peers, peerIPs)),
		tunnel.NetOption(r.Net),
		tunnel.MTUOption(r.MTU),
		tunnel.DeviceNameOption(r.DeviceName),
		tunnel.RoutesOption(r.Routes),
		tunnel.DNSOption(r.DNS),
		tunnel.ShareLANOption(r.ShareLAN),
		tunnel.ShareModeOption(r.ShareMode),
		tunnel.LanAllowOption(r.LanAllow),
		tunnel.LanRoutesOption(r.LanRoutes...),
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
// the create form never reaches, so a hub starts with no peers and its first
// one is added there. What an empty list means — up, routing nothing — is
// recorded as an event at creation and on every save that leaves it empty,
// rather than refused here.
//
// The device fields are checked by validateTunNet and friends — the same rules
// apply to both ends of the device.
//
// Routes and DNS are refused outright. They are client-side settings: they tell
// a device whose traffic is being captured what to capture and which resolver
// to use. A hub captures nothing. Worse, a hub runs with host networking, so
// the device is built in the host's network namespace and both are applied
// there — routes through netlink.RouteReplace (which replaces the host's own
// route to that subnet rather than sitting beside it) and dns through
// `resolvectl dns`. Naming a subnet the host already routes, its own LAN,
// takes the network down. Refused rather than ignored, so a config carried
// over from the socket form says why instead of quietly doing nothing.
func validateTunTunnel(r *tunnelCreateRequest) error {
	if ep := strings.TrimSpace(r.Endpoint); ep != "" {
		return fmt.Errorf("a tun hub binds no address: clear the endpoint (%s) — the peer allowlist is the whole configuration", ep)
	}
	if rs := strings.TrimSpace(r.Routes); rs != "" {
		return fmt.Errorf("a tun hub takes no routes (%s): routes are client-side, and on a hub they replace the host's own route to that subnet — its peers share the device's subnet and need none", rs)
	}
	if dns := strings.TrimSpace(r.DNS); dns != "" {
		return fmt.Errorf("a tun hub takes no dns (%s): dns is client-side, and on a hub it would register the device as a resolver on the host", dns)
	}
	if err := validateTunNet(r.Net); err != nil {
		return err
	}
	// A malformed share_lan is refused here rather than at Run: the create
	// would otherwise answer 201 and the hub would fail to start, leaving a
	// stored tunnel that never runs.
	if _, err := tunnel.ParseShareLANNets(r.ShareLAN); err != nil {
		return fmt.Errorf("share_lan %q is not a comma-separated list of CIDRs: %v", r.ShareLAN, err)
	}
	return nil
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

	// A create is the same door as the two saves, so it gets the same policy: a hub
	// created with spokes that name no address is given one each, and a row that
	// cannot be honoured is refused now rather than becoming a hub that authorizes
	// nothing. Nothing is preserved (nil), because nothing exists to preserve.
	peerIPs, err := settlePeerIPs(req.Type, req.Peers, nil, req.Net)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	t := tunnel.NewByType(req.Type, req.toOptions(peerIPs)...)
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
// moments it becomes true: a hub created before its first peer arrives, and a
// hub whose last peer was just removed on the peers page. Both read as broken
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
	event.Record(t.ID(), event.LevelWarn, "no peers yet — this hub is up but routes nothing, so requests to it go unanswered until a peer is added on the peers page")
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
	// Back onto the request, so toOptions reads the type this hub is actually being
	// rebuilt as. A request that omits it is the common case on the detail page, and
	// without this a tun hub whose peers carry their addresses would be rebuilt as
	// though it were not one — dropping the assignment on the floor.
	req.Type = tunnelType

	if err := validateTunnelRequest(tunnelType, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// The same policy as the peers door, and it has to be here: this PUT rebuilds
	// the hub from the request, so without this the request's raw ip text is written
	// straight through — a row off the requested subnet survives until the new hub's
	// own filter drops it, which is data loss the reply does not mention (SaveConfig
	// then persists the loss), and a PUT carrying no ip at all turns every row into
	// "" — "may claim nothing" — locking every spoke out while the empty reply says
	// nothing is assigned yet and the service says it is healthy.
	//
	// old.Options().PeerIPs is read before the Close below, because after it the
	// options are the only place an assignment still lives and the reply would be
	// built from a tunnel that no longer exists.
	peerIPs, err := settlePeerIPs(tunnelType, req.Peers, old.Options().PeerIPs, req.Net)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// The response never echoes the password, so a PUT that omits it means
	// "unchanged", not "cleared" — carry the stored secret forward. An
	// explicit "" still clears (see tunnelCreateRequest.Password). Read
	// before the Close below: after it the options are the only copy left.
	if req.Password == nil {
		pw := old.Options().Password
		req.Password = &pw
	}

	// A p2p tunnel cannot be replaced while it lives: the process-wide host
	// routes each peer key to exactly one tunnel, so the old one must give its
	// routes up first (everything else swaps its own socket after the
	// replacement runs). A tun hub is the same shape: its allowlist is the same
	// process-wide host's, so the old one must release its routes first.
	if old.Type() == tunnel.P2PTunnel || old.Type() == tunnel.TunTunnel {
		old.Close()
	}

	// Create replacement with same ID first (before deleting old). The settled
	// assignment goes in whole, not the rows: this is the request's answer to "what
	// may each spoke claim", already validated and allocated, so the hub that comes
	// up authorizes exactly what was agreed.
	opts := append([]tunnel.Option{
		tunnel.IDOption(id),
		tunnel.CreatedAtOption(old.Options().CreatedAt),
	}, req.toOptions(peerIPs)...)

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
//
// On a tun hub the same request carries the address assignment: the hub is the
// allocator of record, so a row is checked and filled here, while the request
// that carried it can still be refused with a reason, rather than left to the
// hub's own filter to drop it later as an event with nobody to answer.
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

	// The same policy the other two doors apply (settlePeerIPs), settled before
	// anything is applied so a row naming an address outside the hub's subnets, the
	// hub's own address, or an address another row names too is refused here with
	// the spoke and the subnet named. SetPeerIPs cannot refuse it: the hub filters
	// what it is given, and a row it drops is a spoke refused at registration with a
	// message pointing nowhere near the cause.
	//
	// old.Options().PeerIPs is what "unchanged" means here: a row that says nothing
	// about its address keeps the one its spoke already holds. And
	// old.Options().Net is what the rows are judged against, because this request
	// cannot change a hub's net, so the one in force is the one being asked about.
	//
	// The error is checked before the map is used, and that order is the whole point:
	// assignPeerIPs hands back the rows it managed alongside its error, and taking
	// the map first would answer a refused save with a partial assignment — the
	// request said no and the response saved half of it.
	ip, err := settlePeerIPs(old.Type(), req.Peers, old.Options().PeerIPs, old.Options().Net)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
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
	// Order is load-bearing. SetPeers reconciles the p2p routes and can fail; on
	// failure it has changed nothing, so the assignment is still the old one and
	// the pair stays consistent. SetPeerIPs only swaps a pointer and cannot fail.
	// Running them the other way round would leave a spoke holding a route whose
	// assignment had just been withdrawn — a black hole with nothing to show for it.
	if err := setter.SetPeers(r.Context(), peers, aliases, disabled); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if s, ok := old.(tunnel.PeerIPSetter); ok {
		if err := s.SetPeerIPs(r.Context(), ip); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := tunnel.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	// Removing the last spoke is the moment an existing, working hub stops
	// answering, so the state is recorded where the user just was.
	noteNoSpokes(old)

	writeJSON(w, http.StatusOK, toTunnelResponse(old))
}
