package entrypoint

import (
	"errors"
	"net"
	"sort"
	"sync"
	"time"

	"github.com/go-gost/core/logger"
)

// errRouteGone is the kernel's answer to removing a route it does not hold.
// errors.Is, because netlink hands back the syscall errno wrapped in a
// *netlink.NetlinkError, and "the route is already gone" is the outcome the
// removal wanted regardless of how it is spelled.
var errRouteGone = errors.New("route gone")

// kernelRoutes is the seam this package's netview sync works through: find
// the link this device's packets ride, and add or remove one destination on
// it. Production is the kernel's own table, reached through netlink on Linux
// (netview_sync_linux.go) and a stub everywhere else (netview_sync_other.go),
// because the entrypoint package builds for every platform even though only
// one of them has routes to install. Tests hand in a recorder, which is what
// makes the diff — the only part of this with reasoning in it — testable at
// all: the diff is a pure function over CIDR sets and everything around it
// is syscalls.
type kernelRoutes interface {
	// LinkIndexFor returns the index of the link holding any of the device's
	// addresses, or an error when no link does (the device not up yet, or a
	// platform where the device is not this process's to configure).
	LinkIndexFor(addrs []net.IPNet) (int, error)
	// AddRoute installs dst on link; RemoveRoute removes it.
	AddRoute(linkIndex int, dst *net.IPNet) error
	RemoveRoute(linkIndex int, dst *net.IPNet) error
}

// newKernelRoutes is the platform's kernelRoutes. Each platform file sets it
// in its init, so this one stays build-tag free and importable everywhere.
var newKernelRoutes func() kernelRoutes

// reflectRouteSet is the diff a sync needs: the CIDRs the hub now routes
// here that this device does not yet carry, and the ones it carries that the
// hub no longer routes. Both directions matter — a claim withdrawn at the hub
// must stop capturing traffic on the spoke, or the spoke keeps swallowing
// packets for a network nobody answers for.
//
// want/have are full snapshots, so this is a set difference and not a merge:
// an absent entry is withdrawn, which is exactly the netview's own semantics.
func reflectRouteSet(want, have []string) (added, removed []string) {
	wantSet := make(map[string]struct{}, len(want))
	for _, c := range want {
		wantSet[c] = struct{}{}
	}
	haveSet := make(map[string]struct{}, len(have))
	for _, c := range have {
		haveSet[c] = struct{}{}
	}
	// Walked as sets, not slices: a repeated entry in either side is one
	// prefix, and the diff must ask for it once. (The hub sends no repeats;
	// this is about what the function promises, not what it receives.)
	for c := range wantSet {
		if _, ok := haveSet[c]; !ok {
			added = append(added, c)
		}
	}
	for c := range haveSet {
		if _, ok := wantSet[c]; !ok {
			removed = append(removed, c)
		}
	}
	sort.Strings(added)
	sort.Strings(removed)
	return added, removed
}

// netviewSync keeps the spoke's kernel routes equal to the hub's approvals.
//
// Process-wide for the same reason the router is: one spoke process installs
// one netview, whichever entrypoint's control channel received it, so the
// routes are the device's, not an entrypoint's. Every failure here is a
// warning and a continue, because the spoke's job is to tunnel and a route it
// could not install only costs it the LAN it would have carried.
type netviewSync struct {
	mu sync.Mutex
	// addrs are this device's addresses: the handle by which the link it
	// rides is found.
	addrs []net.IPNet
	kr    kernelRoutes
	log   logger.Logger

	// link is resolved once and reused: the link is the device, which does
	// not change identity while the entrypoint runs.
	link   int
	linked bool
	// installed is the set of CIDRs this device carries because of us. It
	// tracks what a successful add installed, not what we asked for, so a
	// failed add is retried on the next netview and never recorded as done.
	installed map[string]struct{}
	// retrying marks a retry loop in flight; warned marks that the current
	// link-less stretch has already been logged, so the one race an operator
	// needs to see costs one line rather than one per attempt. last is the
	// prefix set the retry re-enters with, saved because a timer fires with
	// no caller to ask.
	retrying bool
	warned   bool
	last     []string
}

// linkRetryInterval and linkRetryAttempts bound the wait for a device whose
// datagram link is still coming up: the control stream arrives seconds before
// it, and roughly twenty seconds of retrying covers a slow device without
// becoming a goroutine that outlives the entrypoint.
const (
	linkRetryInterval = 2 * time.Second
	linkRetryAttempts = 10
)

// newNetviewSync builds the sync for a device with these addresses. A nil
// kernelRoutes is replaced by the platform's, so a caller with no seam to
// inject still gets the real thing on the platform that has one.
func newNetviewSync(addrs []net.IPNet, kr kernelRoutes, log logger.Logger) *netviewSync {
	if kr == nil {
		kr = newKernelRoutes()
	}
	return &netviewSync{addrs: addrs, kr: kr, log: log, installed: map[string]struct{}{}}
}

// Reflect makes this device carry exactly the prefixes the hub routes here.
// It is the RouteSync the control channel calls with each accepted netview.
//
// The diff runs first and an empty one is the common case — a refresh that
// changed nothing — so a steady spoke touches the kernel only when the hub's
// approvals actually moved.
func (s *netviewSync) Reflect(prefixes []string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reflect(prefixes)
}

// reflect is Reflect with the lock held, so a retry can re-enter it without
// deadlocking on the mutex it already owns.
func (s *netviewSync) reflect(prefixes []string) {
	s.last = prefixes
	have := make([]string, 0, len(s.installed))
	for c := range s.installed {
		have = append(have, c)
	}
	added, removed := reflectRouteSet(prefixes, have)
	if len(added) == 0 && len(removed) == 0 {
		return
	}

	// The link is resolved on every netview until it sticks, and a miss is
	// retried on a timer rather than left to the next netview: the spoke's
	// control stream comes up milliseconds after the entrypoint starts,
	// which is seconds before its tun device's datagram link does, and a
	// spoke that claims nothing never produces another netview to retry
	// with. Without this, the one push the hub sends on connect is the only
	// chance the routes ever get, and the race loses it silently.
	if !s.linked {
		link, err := s.kr.LinkIndexFor(s.addrs)
		if err != nil {
			// Once per race, not once per attempt: a device that is still
			// coming up is one fact, and a log that repeats it every two
			// seconds is noise the operator cannot read.
			if !s.warned {
				s.warned = true
				s.warnf("netview: routes not installed yet, %v", err)
			}
			s.retry()
			return
		}
		s.link, s.linked, s.warned = link, true, false
	}

	for _, c := range removed {
		dst, err := parseCIDR(c)
		if err != nil {
			continue
		}
		err = s.kr.RemoveRoute(s.link, dst)
		if err != nil && !errors.Is(err, errRouteGone) {
			s.warnf("netview: remove %s: %v", c, err)
			continue
		}
		// A route the kernel does not hold is a route we do not need to
		// report: the device is where we want it either way.
		delete(s.installed, c)
	}

	failed := false
	for _, c := range added {
		dst, err := parseCIDR(c)
		if err != nil {
			continue
		}
		if err := s.kr.AddRoute(s.link, dst); err != nil {
			// Not recorded as installed, so the next netview tries again:
			// a transient refusal (the table busy) must not become a
			// permanent hole in the device's routes.
			s.warnf("netview: add %s: %v", c, err)
			failed = true
			continue
		}
		s.installed[c] = struct{}{}
	}
	_ = failed
}

func (s *netviewSync) warnf(format string, args ...any) {
	if s.log != nil {
		s.log.Warnf(format, args...)
	}
}

// retry arms one timer-driven re-entry of reflect, holding nothing until the
// timer fires. Called with s.mu held; it starts a goroutine that re-takes the
// lock per attempt and re-enters reflect, so a retry and a netview race on the
// same lock rather than on two copies of the decision.
//
// One loop at a time: a second miss while a loop is running joins it, because
// the loop holds the current prefix set and retrying again would double the
// kernel traffic for no new information.
func (s *netviewSync) retry() {
	if s.retrying {
		return
	}
	s.retrying = true
	go func() {
		defer func() {
			s.mu.Lock()
			s.retrying = false
			s.mu.Unlock()
		}()
		for attempt := 0; attempt < linkRetryAttempts; attempt++ {
			time.Sleep(linkRetryInterval)
			s.mu.Lock()
			if s.linked {
				s.mu.Unlock()
				return
			}
			s.reflect(s.last)
			linked := s.linked
			s.mu.Unlock()
			if linked {
				return
			}
		}
	}()
}

func parseCIDR(c string) (*net.IPNet, error) {
	_, n, err := net.ParseCIDR(c)
	if err != nil {
		return nil, err
	}
	return n, nil
}
