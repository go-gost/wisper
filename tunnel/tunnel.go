package tunnel

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/service"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	xconfig "github.com/go-gost/x/config"
	_ "github.com/go-gost/x/connector/tunnel"
	_ "github.com/go-gost/x/dialer/ws"
	xservice "github.com/go-gost/x/service"
)

const (
	defaultEndpointAddr = "gost.run"
	defaultServerName   = "wisper.gost.run"
	// defaultP2PDerp is the DERP relay used when settings.p2p.derp is empty.
	defaultP2PDerp = "wss://derp.gost.run/derp"
)

// GetEndpointAddr returns the public entrypoint domain, reading from config
// with fallback to the default (gost.run).
func GetEndpointAddr() string {
	if s := config.Get().Settings; s != nil && s.Entrypoint != "" {
		return s.Entrypoint
	}
	return defaultEndpointAddr
}

// GetServerName returns the tunnel relay server hostname, reading from config
// with fallback to the default (wisper.gost.run).
func GetServerName() string {
	if s := config.Get().Settings; s != nil && s.Server != "" {
		return s.Server
	}
	return defaultServerName
}

// GetServerAddr returns the tunnel relay server address (hostname:443).
func GetServerAddr() string {
	return GetServerName() + ":443"
}

const (
	FileTunnel = "file"
	HTTPTunnel = "http"
	TCPTunnel  = "tcp"
	UDPTunnel  = "udp"
	P2PTunnel  = "p2p"
	// TunTunnel is a hub: this node holds the tun device and the hub kernel
	// routes between the spokes whose datagrams arrive over a p2p tunnel.
	TunTunnel = "tun"
)

var (
	ErrTunnelClosed = errors.New("tunnel closed")
)

// Options holds the configuration for creating a tunnel.
type Options struct {
	ID       string
	Name     string
	Endpoint string
	// Prefix is the custom public URL host prefix (subdomain label) requested
	// from the tunnel server. Distinct from Hostname, which for HTTP tunnels
	// means backend Host-header rewrite.
	Prefix      string
	Hostname    string
	Username    string
	Password    string
	EnableTLS   bool
	RewriteHost bool
	FileUpload  bool
	Keepalive   bool
	Probe       bool
	TTL         int
	RecordMode  string
	// Peer is this link's other end: for a p2p entrypoint, the remote host's
	// base64 public key to dial.
	Peer string
	// Protocol is a p2p entrypoint's inner protocol: "tcp" (the default when
	// empty) or "udp". It selects the local listener and the chain node's
	// dialer.
	Protocol string
	// Peers is a p2p tunnel's inbound allowlist: the base64 public keys of the
	// peers whose streams are routed to it. Empty is valid — the tunnel runs,
	// it just receives nothing (there is no catch-all route).
	Peers []string
	// PeerAliases is the display name of each allowlisted key (key → alias),
	// so pages show a short label instead of the key itself.
	PeerAliases map[string]string
	// PeerDisabled is the allowlisted keys that are switched off: kept in Peers
	// (and shown on the peers page) but given no route, so their new streams
	// are closed while established ones drain.
	PeerDisabled []string
	// PeerIPs is a tun hub's address assignment: peer key → the comma-separated
	// host addresses that peer may claim. A hub is the allocator of record — the
	// allowlist alone says a spoke may connect, this says which device address it
	// owns, and without it every claim is refused. A p2p tunnel has no device, so
	// it carries nothing here.
	PeerIPs map[string]string
	// Net is a tun device's address: a CIDR, or several comma-separated.
	// A hub tunnel and a spoke entrypoint both carry it.
	Net string
	// MTU is the tun device's MTU (0 leaves the implementation default).
	MTU int
	// DeviceName is the tun device's name (empty lets the kernel choose).
	DeviceName string
	// Routes are the subnets routed through the device, comma-separated
	// "cidr [gw]" pairs.
	Routes string
	// DNS is the device's DNS servers, comma-separated.
	DNS string
	// ShareLAN lists the hub-side LAN subnets a tun hub shares with its
	// spokes, comma-separated CIDRs. Empty disables sharing. When set, the
	// hub NATs spoke traffic into the LAN (kernel MASQUERADE first, userspace
	// TCP/UDP fallback) so no static route on the LAN gateway is needed.
	ShareLAN string
	// ShareMode pins the sharing implementation: auto (default), kernel, or
	// userspace. Auto tries the kernel path and falls back with an event.
	ShareMode string
	// LanAllow is the policy for the LANs the hub's spokes may claim:
	// "key=cidr" rows, each naming the supernets that spoke may claim inside.
	// A spoke with no row claims nothing at all — default-deny — so a spoke
	// that reaches a hub it is not configured for cannot put a route into it
	// just by saying so. Read by ParseLanAllow at start.
	LanAllow string
	// LanRoutes is the hub's own routes, each a "cidr [via addr] [allow=keys]"
	// spec resolved against the spokes' assigned addresses. They are injected
	// before any claim, so a hub operator reaches a LAN that no spoke claims.
	LanRoutes     []string
	CreatedAt     time.Time
	Stats         config.ServiceStats
	StatsBaseline config.ServiceStats
}

// Option is a functional option for tunnel Options.
type Option func(opts *Options)

func IDOption(id string) Option {
	return func(opts *Options) {
		opts.ID = id
	}
}

func NameOption(name string) Option {
	return func(opts *Options) {
		opts.Name = name
	}
}

func EndpointOption(endpoint string) Option {
	return func(opts *Options) {
		opts.Endpoint = endpoint
	}
}

func PrefixOption(prefix string) Option {
	return func(opts *Options) {
		opts.Prefix = prefix
	}
}

func HostnameOption(hostname string) Option {
	return func(opts *Options) {
		opts.Hostname = hostname
	}
}

func UsernameOption(username string) Option {
	return func(opts *Options) {
		opts.Username = username
	}
}

func PasswordOption(password string) Option {
	return func(opts *Options) {
		opts.Password = password
	}
}

func EnableTLSOption(b bool) Option {
	return func(opts *Options) {
		opts.EnableTLS = b
	}
}

func RewriteHostOption(b bool) Option {
	return func(opts *Options) {
		opts.RewriteHost = b
	}
}

func FileUploadOption(b bool) Option {
	return func(opts *Options) {
		opts.FileUpload = b
	}
}

func KeepaliveOption(b bool) Option {
	return func(opts *Options) {
		opts.Keepalive = b
	}
}

func ProbeOption(b bool) Option {
	return func(opts *Options) {
		opts.Probe = b
	}
}

func TTLOption(ttl int) Option {
	return func(opts *Options) {
		opts.TTL = ttl
	}
}

func CreatedAtOption(createdAt time.Time) Option {
	return func(opts *Options) {
		opts.CreatedAt = createdAt
	}
}

func StatsBaselineOption(baseline config.ServiceStats) Option {
	return func(opts *Options) {
		opts.StatsBaseline = baseline
	}
}

func RecordModeOption(mode string) Option {
	return func(opts *Options) {
		opts.RecordMode = mode
	}
}

// PeerOption sets the remote peer's base64 public key (p2p entrypoints).
func PeerOption(peer string) Option {
	return func(opts *Options) {
		opts.Peer = peer
	}
}

// ProtocolOption sets a p2p entrypoint's inner protocol ("tcp" or "udp").
func ProtocolOption(protocol string) Option {
	return func(opts *Options) {
		opts.Protocol = protocol
	}
}

// PeersOption sets a p2p tunnel's inbound allowlist (base64 public keys). An
// empty list is valid: the tunnel runs and routes nothing.
func PeersOption(peers ...string) Option {
	return func(opts *Options) {
		opts.Peers = peers
	}
}

// PeerAliasesOption sets the allowlist's display names (key → alias).
func PeerAliasesOption(aliases map[string]string) Option {
	return func(opts *Options) {
		opts.PeerAliases = aliases
	}
}

// PeerDisabledOption sets the allowlisted keys that are switched off. They stay
// in the allowlist but hold no route. Callers must pass a set already normalized
// against the listed peers (NormalizePeerDisabled): the listed peers are what the
// peers page renders and what the requesting-peers filter reads, so a disabled key
// that is not listed would show up as a requesting peer.
func PeerDisabledOption(disabled []string) Option {
	return func(opts *Options) {
		opts.PeerDisabled = disabled
	}
}

// PeerIPsOption sets a tun hub's address assignment (peer key → the
// comma-separated host addresses that peer may claim). An empty assignment means
// the hub authorizes nothing, so every spoke is refused until one is saved.
func PeerIPsOption(peerIPs map[string]string) Option {
	return func(opts *Options) {
		opts.PeerIPs = peerIPs
	}
}

// NormalizePeerIPs keeps only the assignment rows of keys that are still
// allowlisted, modelled on NormalizePeerDisabled: a spoke removed from the hub's
// allowlist must not linger in the config holding an address, or it would come
// back already entitled to it if it were ever added again. The values themselves
// are the operator's (or the allocator's) and are kept byte for byte — this drops
// keys, it does not re-parse or re-render addresses, so a hub that restarts
// authorizes exactly what it authorized before. Nil when nothing is left, which is
// what a hub with no assignment is written as.
func NormalizePeerIPs(peers []string, known map[string]string) map[string]string {
	if len(peers) == 0 || len(known) == 0 {
		return nil
	}
	listed := make(map[string]bool, len(peers))
	for _, p := range peers {
		listed[p] = true
	}
	out := make(map[string]string, len(known))
	for p, ips := range known {
		if listed[p] {
			out[p] = ips
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// NetOption sets a tun device's address (a CIDR, or several comma-separated).
func NetOption(net string) Option {
	return func(opts *Options) {
		opts.Net = net
	}
}

// MTUOption sets a tun device's MTU (0 leaves the implementation default).
func MTUOption(mtu int) Option {
	return func(opts *Options) {
		opts.MTU = mtu
	}
}

// DeviceNameOption sets a tun device's name (empty lets the kernel choose).
func DeviceNameOption(name string) Option {
	return func(opts *Options) {
		opts.DeviceName = name
	}
}

// RoutesOption sets the subnets routed through a tun device (comma-separated
// "cidr [gw]" pairs).
func RoutesOption(routes string) Option {
	return func(opts *Options) {
		opts.Routes = routes
	}
}

// DNSOption sets a tun device's DNS servers (comma-separated).
func DNSOption(dns string) Option {
	return func(opts *Options) {
		opts.DNS = dns
	}
}

// ShareLANOption sets the hub-side LAN subnets a tun hub shares (comma-separated CIDRs).
func ShareLANOption(spec string) Option {
	return func(opts *Options) {
		opts.ShareLAN = spec
	}
}

// ShareModeOption pins the sharing implementation (auto/kernel/userspace).
func ShareModeOption(mode string) Option {
	return func(opts *Options) {
		opts.ShareMode = NormalizeShareMode(mode)
	}
}

// LanAllowOption sets the hub-side LAN-routing policy: the supernets each
// spoke may claim inside ("key=cidr" rows).
func LanAllowOption(spec string) Option {
	return func(opts *Options) {
		opts.LanAllow = spec
	}
}

// LanRoutesOption sets the hub's own routes ("cidr [via addr] [allow=keys]"
// specs, resolved against the spokes' assigned addresses).
func LanRoutesOption(specs ...string) Option {
	return func(opts *Options) {
		opts.LanRoutes = specs
	}
}

// entrypointHost returns the public host label for the tunnel URL:
// the server-negotiated bind host once bound, else the requested prefix,
// else the md5 hash. Pre-bind the rtcp listener address is a bare label
// (SplitHostPort fails); post-bind it is "host:port".
func entrypointHost(hash, prefix string, forward service.Service) string {
	host := hash
	if prefix != "" {
		host = prefix
	}
	if forward != nil {
		if addr := forward.Addr(); addr != nil {
			if h, _, err := net.SplitHostPort(addr.String()); err == nil && h != "" {
				host = h
			}
		}
	}
	return host
}

// ServiceStatus is implemented by services that expose a Status method.
type ServiceStatus interface {
	Status() *xservice.Status
}

// IsServiceFailed checks whether the tunnel's underlying GOST service is in a
// failed state (e.g., cannot connect to the relay server). This is more
// reliable than Err() because Serve() retries temporary bind/accept errors
// indefinitely and never returns.
func IsServiceFailed(t Tunnel) bool {
	s := t.Status()
	return s != nil && s.State() == xservice.StateFailed
}

// ServiceErrorMessage returns the last accept/bind error message from the
// underlying GOST service status. Returns an empty string if no error is
// available.
func ServiceErrorMessage(t Tunnel) string {
	s := t.Status()
	if s == nil {
		return ""
	}
	if err := s.LastError(); err != nil {
		return err.Error()
	}
	return ""
}

// Tunnel is the interface for all tunnel and entrypoint types.
type Tunnel interface {
	ID() string
	Type() string
	Name() string
	Endpoint() string
	Entrypoint() string
	Options() Options
	Run() error
	Status() *xservice.Status
	Stats() config.ServiceStats
	SetStats(stats config.ServiceStats)
	StatsBaseline() config.ServiceStats
	SetStatsBaseline(baseline config.ServiceStats)
	Favorite(b bool)
	IsFavorite() bool
	Close() error
	IsClosed() bool
	Err() error
}

// ContextRunner is implemented by a tunnel or entrypoint whose Run reaches the
// shared p2p host: the action id an HTTP request carried is in ctx, so the seam
// calls that run makes (the host's Listen/Warm/Punch) name it in their log
// line. A type that does not implement it makes no p2p seam call, so there is
// nothing to correlate.
type ContextRunner interface {
	RunContext(ctx context.Context) error
}

// RunWithContext starts s carrying ctx's action id into the p2p seam calls its
// run makes. A type with no context-aware run falls back to Run: its lifecycle
// opens no p2p seam call, so an id would have nothing to join.
func RunWithContext(ctx context.Context, s Tunnel) error {
	if cr, ok := s.(ContextRunner); ok {
		return cr.RunContext(ctx)
	}
	return s.Run()
}

type tunnelList struct {
	list []Tunnel
	mux  sync.RWMutex
}

var (
	tunnels tunnelList
)

// Count returns the number of registered tunnels.
func Count() int {
	tunnels.mux.RLock()
	defer tunnels.mux.RUnlock()
	return len(tunnels.list)
}

// Add registers a tunnel.
func Add(s Tunnel) {
	tunnels.mux.Lock()
	defer tunnels.mux.Unlock()
	tunnels.list = append(tunnels.list, s)
}

// Set replaces an existing tunnel by ID, preserving its favorite state.
func Set(s Tunnel) {
	if s == nil {
		return
	}
	t := Get(s.ID())
	if t == nil {
		return
	}
	s.Favorite(t.IsFavorite())

	tunnels.mux.Lock()
	defer tunnels.mux.Unlock()

	for i, sv := range tunnels.list {
		if sv != nil && sv.ID() == s.ID() {
			tunnels.list[i] = s
		}
	}
}

// GetIndex returns the tunnel at the given index.
func GetIndex(index int) Tunnel {
	tunnels.mux.RLock()
	defer tunnels.mux.RUnlock()
	if index < 0 || index >= len(tunnels.list) {
		return nil
	}
	return tunnels.list[index]
}

// Get returns the tunnel with the given ID.
func Get(id string) Tunnel {
	tunnels.mux.RLock()
	defer tunnels.mux.RUnlock()

	for _, s := range tunnels.list {
		if s != nil && s.ID() == id {
			return s
		}
	}
	return nil
}

// Delete removes and closes the tunnel with the given ID. The p2p key file is
// left intact (the API's delete handler removes it), so an update/replace keeps
// the tunnel's identity. Event history is kept too — the update path reuses
// Delete to swap the old tunnel out, so clearing here would wipe the history of
// a tunnel that is merely being replaced. The delete handler clears it.
func Delete(id string) {
	tunnels.mux.Lock()
	defer tunnels.mux.Unlock()

	for i, s := range tunnels.list {
		if s != nil && s.ID() == id {
			s.Close()
			tunnels.list = append(tunnels.list[:i], tunnels.list[i+1:]...)
			return
		}
	}
}

// RestartRunning recreates all running tunnels so they pick up the current
// config (e.g. a changed server address). Stopped tunnels are left as-is.
// Tunnels are closed before new ones start to avoid conflicts on the relay
// server (same tunnel ID cannot be registered twice concurrently).
func RestartRunning() {
	type restartInfo struct {
		index         int
		opts          Options
		fav           bool
		stats         config.ServiceStats
		statsBaseline config.ServiceStats
	}

	var pending []restartInfo

	// Phase 1: close all running tunnels and collect their info.
	for i := 0; i < Count(); i++ {
		t := GetIndex(i)
		if t == nil || t.IsClosed() {
			continue
		}
		pending = append(pending, restartInfo{
			index:         i,
			opts:          t.Options(),
			fav:           t.IsFavorite(),
			stats:         t.Stats(),
			statsBaseline: t.StatsBaseline(),
		})
		t.Close()
	}

	// Phase 2: start new tunnels with the updated config.
	for _, p := range pending {
		newT := createTunnel(tunnels.list[p.index].Type(), Options{
			ID:           p.opts.ID,
			Name:         p.opts.Name,
			Endpoint:     p.opts.Endpoint,
			Prefix:       p.opts.Prefix,
			Hostname:     p.opts.Hostname,
			Username:     p.opts.Username,
			Password:     p.opts.Password,
			EnableTLS:    p.opts.EnableTLS,
			RewriteHost:  p.opts.RewriteHost,
			FileUpload:   p.opts.FileUpload,
			Keepalive:    p.opts.Keepalive,
			TTL:          p.opts.TTL,
			RecordMode:   p.opts.RecordMode,
			Peers:        p.opts.Peers,
			PeerAliases:  p.opts.PeerAliases,
			PeerDisabled: p.opts.PeerDisabled,
			PeerIPs:      p.opts.PeerIPs,
			Protocol:     p.opts.Protocol,
			Net:          p.opts.Net,
			MTU:          p.opts.MTU,
			DeviceName:   p.opts.DeviceName,
			Routes:       p.opts.Routes,
			DNS:          p.opts.DNS,
			ShareLAN:     p.opts.ShareLAN,
			ShareMode:    p.opts.ShareMode,
			LanAllow:     p.opts.LanAllow,
			LanRoutes:    p.opts.LanRoutes,
			CreatedAt:    p.opts.CreatedAt,
		})
		if newT == nil {
			continue
		}

		newT.SetStats(p.stats)
		newT.SetStatsBaseline(p.statsBaseline)
		newT.Favorite(p.fav)

		if err := newT.Run(); err != nil {
			slog.Error("restart tunnel", "name", p.opts.Name, "err", err)
			continue
		}

		Set(newT)
	}

	if err := SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}
}

// ChainConfig builds a GOST chain configuration that connects to the tunnel server.
func ChainConfig(id string, name string, recordMode string) *xconfig.ChainConfig {
	s := config.Get().Settings
	secure := s == nil || !s.Insecure

	rm := recordMode
	if rm == "" {
		rm = "off" // Not set — privacy-preserving default.
	}
	md := map[string]any{"tunnel.id": id, "record.mode": rm}

	return &xconfig.ChainConfig{
		Name: name,
		Hops: []*xconfig.HopConfig{
			{
				Name: name,
				Nodes: []*xconfig.NodeConfig{
					{
						Name: name,
						Addr: GetServerAddr(),
						Connector: &xconfig.ConnectorConfig{
							Type:     "tunnel",
							Metadata: md,
						},
						Dialer: &xconfig.DialerConfig{
							Type: "wss",
							TLS: &xconfig.TLSConfig{
								Secure:     secure,
								ServerName: GetServerName(),
							},
						},
					},
				},
			},
		},
	}
}

// LoadConfig loads tunnels from the persisted configuration.
func LoadConfig() {
	for _, cfg := range config.Get().Tunnels {
		if cfg == nil {
			continue
		}

		event.Seed(cfg.ID, cfg.Events)

		tun := createTunnel(cfg.Type, Options{
			ID:            cfg.ID,
			Name:          cfg.Name,
			Endpoint:      cfg.Endpoint,
			Prefix:        cfg.Prefix,
			Hostname:      cfg.Hostname,
			Username:      cfg.Username,
			Password:      cfg.Password,
			EnableTLS:     cfg.EnableTLS,
			RewriteHost:   cfg.RewriteHost,
			FileUpload:    cfg.FileUpload,
			Keepalive:     cfg.Keepalive,
			TTL:           cfg.TTL,
			RecordMode:    cfg.RecordMode,
			Peer:          cfg.Peer,
			Protocol:      cfg.Protocol,
			Peers:         cfg.Peers,
			PeerAliases:   NormalizePeerAliases(cfg.Peers, cfg.PeerAliases),
			PeerDisabled:  NormalizePeerDisabled(cfg.Peers, cfg.PeerDisabled),
			PeerIPs:       NormalizePeerIPs(cfg.Peers, cfg.PeerIPs),
			Net:           cfg.Net,
			MTU:           cfg.MTU,
			DeviceName:    cfg.DeviceName,
			Routes:        cfg.Routes,
			DNS:           cfg.DNS,
			ShareLAN:      cfg.ShareLAN,
			ShareMode:     cfg.ShareMode,
			LanAllow:      cfg.LanAllow,
			LanRoutes:     cfg.LanRoutes,
			CreatedAt:     cfg.CreatedAt,
			Stats:         cfg.Stats,
			StatsBaseline: cfg.StatsBaseline,
		})
		if tun == nil {
			continue
		}

		if cfg.Closed {
			tun.Close()
		} else if err := tun.Run(); err != nil {
			tun.Close()
		}

		tun.Favorite(cfg.Favorite)
		Add(tun)
	}
}

// SaveConfig persists all tunnel states to disk.
func SaveConfig() error {
	cfg := config.Get()
	cfg.Tunnels = nil

	for i := 0; i < Count(); i++ {
		tun := GetIndex(i)
		if tun == nil {
			continue
		}

		opts := tun.Options()

		cfg.Tunnels = append(cfg.Tunnels, &config.Tunnel{
			ID:            tun.ID(),
			Name:          tun.Name(),
			Type:          tun.Type(),
			Endpoint:      tun.Endpoint(),
			Prefix:        opts.Prefix,
			Hostname:      opts.Hostname,
			Username:      opts.Username,
			Password:      opts.Password,
			EnableTLS:     opts.EnableTLS,
			RewriteHost:   opts.RewriteHost,
			FileUpload:    opts.FileUpload,
			Keepalive:     opts.Keepalive,
			TTL:           opts.TTL,
			RecordMode:    opts.RecordMode,
			Peer:          opts.Peer,
			Protocol:      opts.Protocol,
			Peers:         opts.Peers,
			PeerAliases:   opts.PeerAliases,
			PeerDisabled:  opts.PeerDisabled,
			PeerIPs:       opts.PeerIPs,
			Net:           opts.Net,
			MTU:           opts.MTU,
			DeviceName:    opts.DeviceName,
			Routes:        opts.Routes,
			DNS:           opts.DNS,
			ShareLAN:      opts.ShareLAN,
			ShareMode:     opts.ShareMode,
			LanAllow:      opts.LanAllow,
			LanRoutes:     opts.LanRoutes,
			Favorite:      tun.IsFavorite(),
			Closed:        tun.IsClosed(),
			CreatedAt:     opts.CreatedAt,
			Stats:         tun.Stats(),
			StatsBaseline: tun.StatsBaseline(),
			Events:        event.List(tun.ID()),
		})
	}

	cfg.Events = event.ListGlobal()

	config.Set(cfg)

	if err := cfg.Write(); err != nil {
		slog.Error("write config", "err", err)
		return err
	}
	return nil
}

// TunnelOptions returns the functional options carrying every shared field of
// opts. The type-specific constructors take it as their starting set, so a new
// shared field is threaded everywhere from one place.
func TunnelOptions(opts Options) []Option {
	return []Option{
		IDOption(opts.ID),
		NameOption(opts.Name),
		EndpointOption(opts.Endpoint),
		PrefixOption(opts.Prefix),
		HostnameOption(opts.Hostname),
		UsernameOption(opts.Username),
		PasswordOption(opts.Password),
		EnableTLSOption(opts.EnableTLS),
		CreatedAtOption(opts.CreatedAt),
		RewriteHostOption(opts.RewriteHost),
		FileUploadOption(opts.FileUpload),
		KeepaliveOption(opts.Keepalive),
		ProbeOption(opts.Probe),
		TTLOption(opts.TTL),
		RecordModeOption(opts.RecordMode),
		PeerOption(opts.Peer),
		ProtocolOption(opts.Protocol),
		PeersOption(opts.Peers...),
		PeerAliasesOption(opts.PeerAliases),
		PeerDisabledOption(opts.PeerDisabled),
		PeerIPsOption(opts.PeerIPs),
		NetOption(opts.Net),
		MTUOption(opts.MTU),
		DeviceNameOption(opts.DeviceName),
		RoutesOption(opts.Routes),
		DNSOption(opts.DNS),
		ShareLANOption(opts.ShareLAN),
		ShareModeOption(opts.ShareMode),
		LanAllowOption(opts.LanAllow),
		LanRoutesOption(opts.LanRoutes...),
	}
}

// NewByType constructs a tunnel of the given type; nil for an unknown type. It
// is the single place the type strings map to constructors.
func NewByType(st string, options ...Option) Tunnel {
	switch st {
	case FileTunnel:
		return NewFileTunnel(options...)
	case HTTPTunnel:
		return NewHTTPTunnel(options...)
	case TCPTunnel:
		return NewTCPTunnel(options...)
	case UDPTunnel:
		return NewUDPTunnel(options...)
	case P2PTunnel:
		return NewP2PTunnel(options...)
	case TunTunnel:
		return NewTunTunnel(options...)
	}
	return nil
}

func createTunnel(st string, opts Options) (t Tunnel) {
	t = NewByType(st, TunnelOptions(opts)...)
	if t == nil {
		return nil
	}

	t.SetStats(opts.Stats)
	t.SetStatsBaseline(opts.StatsBaseline)
	return
}

// CleanStop reports whether a service's Serve returned because it was closed
// rather than because it failed. Stopping a tunnel or an entrypoint closes its
// listener, and a closed listener answers with core's listener.ErrClosed;
// net.ErrClosed covers the paths that wrap the socket instead. A deliberate stop
// must not leave an error behind — neither in the log, where it reads like a
// failure, nor in the entrypoint's error field, which the UI shows.
func CleanStop(err error) bool {
	return err == nil || errors.Is(err, listener.ErrClosed) || errors.Is(err, net.ErrClosed)
}
