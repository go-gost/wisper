package entrypoint

import (
	"errors"
	"net"
	"reflect"
	"testing"
)

func TestReflectRouteSet(t *testing.T) {
	tests := []struct {
		name    string
		want    []string
		have    []string
		added   []string
		removed []string
	}{
		{
			name:  "first netview installs everything",
			want:  []string{"192.168.50.0/24", "10.0.0.0/8"},
			have:  nil,
			added: []string{"10.0.0.0/8", "192.168.50.0/24"},
		},
		{
			name: "unchanged netview diffs to nothing",
			want: []string{"192.168.50.0/24"},
			have: []string{"192.168.50.0/24"},
		},
		{
			name:    "withdrawn prefix is removed",
			want:    nil,
			have:    []string{"192.168.50.0/24"},
			removed: []string{"192.168.50.0/24"},
		},
		{
			name:    "a prefix can move both ways in one netview",
			want:    []string{"10.1.0.0/16"},
			have:    []string{"192.168.50.0/24"},
			added:   []string{"10.1.0.0/16"},
			removed: []string{"192.168.50.0/24"},
		},
		{
			name: "order is irrelevant to the diff",
			want: []string{"10.0.0.0/8", "192.168.50.0/24"},
			have: []string{"192.168.50.0/24", "10.0.0.0/8"},
		},
		{
			name:    "duplicates in either side collapse",
			want:    []string{"10.0.0.0/8", "10.0.0.0/8"},
			have:    []string{"192.168.50.0/24", "192.168.50.0/24"},
			added:   []string{"10.0.0.0/8"},
			removed: []string{"192.168.50.0/24"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			added, removed := reflectRouteSet(tt.want, tt.have)
			if !reflect.DeepEqual(added, tt.added) {
				t.Errorf("added = %v, want %v", added, tt.added)
			}
			if !reflect.DeepEqual(removed, tt.removed) {
				t.Errorf("removed = %v, want %v", removed, tt.removed)
			}
		})
	}
}

// recordingRoutes records what the sync asked of the kernel, in order, so a
// test can assert not just the set of operations but their sequence: a
// netview that withdraws and installs at once must remove before it adds, or
// a prefix that replaces another on the same device could collide.
type recordingRoutes struct {
	link    int
	linkErr error
	addErr  error
	delErr  error

	ops []string
}

func (r *recordingRoutes) LinkIndexFor(addrs []net.IPNet) (int, error) {
	if r.linkErr != nil {
		return 0, r.linkErr
	}
	r.ops = append(r.ops, "link")
	return r.link, nil
}

func (r *recordingRoutes) AddRoute(linkIndex int, dst *net.IPNet) error {
	r.ops = append(r.ops, "add "+dst.String())
	return r.addErr
}

func (r *recordingRoutes) RemoveRoute(linkIndex int, dst *net.IPNet) error {
	r.ops = append(r.ops, "del "+dst.String())
	return r.delErr
}

func (s *netviewSync) installedList() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.installed))
	for c := range s.installed {
		out = append(out, c)
	}
	return out
}

var _ = errors.New // keep errors imported for future failure-path assertions

func TestNetviewSyncInstallsOnFirstNetview(t *testing.T) {
	kr := &recordingRoutes{link: 7}
	s := newNetviewSync(nil, kr, nil)

	s.Reflect([]string{"192.168.50.0/24"})

	want := []string{"link", "add 192.168.50.0/24"}
	if !reflect.DeepEqual(kr.ops, want) {
		t.Fatalf("ops = %v, want %v", kr.ops, want)
	}
	if got := s.installedList(); !reflect.DeepEqual(got, []string{"192.168.50.0/24"}) {
		t.Fatalf("installed = %v, want [192.168.50.0/24]", got)
	}
}

func TestNetviewSyncSteadyNetviewTouchesNothing(t *testing.T) {
	kr := &recordingRoutes{link: 7}
	s := newNetviewSync(nil, kr, nil)

	s.Reflect([]string{"192.168.50.0/24"})
	before := len(kr.ops)
	s.Reflect([]string{"192.168.50.0/24"})

	if len(kr.ops) != before {
		t.Fatalf("a refresh that changed nothing ran %v", kr.ops[before:])
	}
}

func TestNetviewSyncRemovesBeforeItAdds(t *testing.T) {
	kr := &recordingRoutes{link: 7}
	s := newNetviewSync(nil, kr, nil)

	s.Reflect([]string{"192.168.50.0/24"})
	kr.ops = nil
	s.Reflect([]string{"10.1.0.0/16"})

	want := []string{"del 192.168.50.0/24", "add 10.1.0.0/16"}
	if !reflect.DeepEqual(kr.ops, want) {
		t.Fatalf("ops = %v, want %v", kr.ops, want)
	}
}

func TestNetviewSyncRetriesAfterAFailedAdd(t *testing.T) {
	kr := &recordingRoutes{link: 7, addErr: errors.New("table busy")}
	s := newNetviewSync(nil, kr, nil)

	s.Reflect([]string{"192.168.50.0/24"})
	if got := s.installedList(); len(got) != 0 {
		t.Fatalf("installed = %v, want empty (a failed add must not be recorded)", got)
	}

	// The next netview tries again rather than treating the hole as settled.
	kr.addErr = nil
	s.Reflect([]string{"192.168.50.0/24"})
	if got := s.installedList(); !reflect.DeepEqual(got, []string{"192.168.50.0/24"}) {
		t.Fatalf("installed = %v, want [192.168.50.0/24] after the retry", got)
	}
}

func TestNetviewSyncRetriesAfterATransientLinkMiss(t *testing.T) {
	// The device is not there yet - a spoke whose control channel beat its
	// tun device to the punch. One netview is the whole race, and the sync
	// must not read it as a verdict about the platform.
	kr := &recordingRoutes{linkErr: errors.New("no link holds the device addresses")}
	s := newNetviewSync(nil, kr, nil)

	s.Reflect([]string{"192.168.50.0/24"})
	ops := len(kr.ops)

	// The device appears (the listener's Init finished); the next netview
	// finds it and installs.
	kr.linkErr = nil
	s.Reflect([]string{"192.168.50.0/24"})

	if got := s.installedList(); !reflect.DeepEqual(got, []string{"192.168.50.0/24"}) {
		t.Fatalf("installed = %v, want [192.168.50.0/24] once the link appeared", got)
	}
	if len(kr.ops) <= ops {
		t.Fatal("after the link appeared the sync did nothing")
	}
}

// The address, not the network: ParseCIDR's second value is the masked
// network (10.20.0.2/24 parses to the 10.20.0.0/24 network), and a link holds
// the address it was configured with. Matching on the network would look for a
// link holding 10.20.0.0 and never find the one holding 10.20.0.2 - the
// silent "no link holds the device addresses" the probe took hours to find.
func TestParseDeviceNetsKeepsTheAddress(t *testing.T) {
	tests := []struct {
		name string
		spec string
		want []string
	}{
		{name: "cidr keeps the host address", spec: "10.20.0.2/24", want: []string{"10.20.0.2/32"}},
		{name: "bare address", spec: "10.20.0.2", want: []string{"10.20.0.2/32"}},
		{name: "ipv6 cidr", spec: "fd00::2/64", want: []string{"fd00::2/128"}},
		{name: "comma list", spec: " 10.20.0.2/24 , fd00::2/64 ", want: []string{"10.20.0.2/32", "fd00::2/128"}},
		{name: "unparseable yields nothing", spec: "banana", want: nil},
		{name: "empty yields nothing", spec: "", want: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			for _, n := range parseDeviceNets(tt.spec) {
				got = append(got, n.String())
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("parseDeviceNets(%q) = %v, want %v", tt.spec, got, tt.want)
			}
		})
	}
}

// The end-to-end seam the probe found broken: a device whose address only
// becomes reachable after the first look must still get its routes once it
// comes up, and the address that identifies it is the host address.
func TestNetviewSyncInstallsOnceTheDeviceAppears(t *testing.T) {
	kr := &recordingRoutes{linkErr: errors.New("no link holds the device addresses")}
	// 10.20.0.2/24 as the entrypoint config spells it.
	s := newNetviewSync(parseDeviceNets("10.20.0.2/24"), kr, nil)

	s.Reflect([]string{"192.168.50.0/24"})

	// The device appears: the link now resolves and carries 10.20.0.2.
	kr.linkErr = nil
	s.Reflect([]string{"192.168.50.0/24"})

	want := []string{"link", "add 192.168.50.0/24"}
	if !reflect.DeepEqual(kr.ops, want) {
		t.Fatalf("ops = %v, want %v", kr.ops, want)
	}
	if got := s.installedList(); !reflect.DeepEqual(got, []string{"192.168.50.0/24"}) {
		t.Fatalf("installed = %v, want [192.168.50.0/24]", got)
	}
}
