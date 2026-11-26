package entrypoint

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	xrecorder "github.com/go-gost/x/recorder"
)

func TestRequestRingCapacityAndOrdering(t *testing.T) {
	ring := newRequestRing(0)
	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 501; i++ {
		ring.append(Request{
			Time: base.Add(time.Duration(i) * time.Second),
			Host: fmt.Sprintf("request-%03d", i),
		})
	}

	got := ring.list(500)
	if len(got) != 500 {
		t.Fatalf("ring length = %d, want 500", len(got))
	}
	if got[0].Host != "request-500" || got[499].Host != "request-001" {
		t.Fatalf("ring bounds = %q .. %q, want request-500 .. request-001", got[0].Host, got[499].Host)
	}
	if got[250].Host != "request-250" {
		t.Errorf("middle record = %q, want request-250", got[250].Host)
	}

	limited := ring.list(2)
	if len(limited) != 2 || limited[0].Host != "request-500" || limited[1].Host != "request-499" {
		t.Errorf("limited ring = %+v, want the two newest records", limited)
	}
	if all := ring.list(0); len(all) != 500 {
		t.Errorf("unlimited ring length = %d, want 500", len(all))
	}
}

func TestRequestRingConcurrentAppendAndRead(t *testing.T) {
	ring := newRequestRing(0)
	const (
		writers   = 16
		perWriter = 64
	)

	var wg sync.WaitGroup
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < perWriter; i++ {
				ring.append(Request{Host: fmt.Sprintf("%02d-%03d", w, i)})
			}
		}(w)
	}
	for r := 0; r < 4; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 1000; i++ {
				if got := ring.list(25); len(got) > 25 {
					t.Errorf("read returned %d records, want at most 25", len(got))
					return
				}
			}
		}()
	}
	wg.Wait()

	got := ring.list(0)
	if len(got) != 500 {
		t.Fatalf("ring length after concurrent writes = %d, want 500", len(got))
	}
	seen := make(map[string]bool, len(got))
	for _, req := range got {
		if seen[req.Host] {
			t.Fatalf("duplicate request %q in ring", req.Host)
		}
		seen[req.Host] = true
	}
}

func TestRequestRecorderClassifiesPath(t *testing.T) {
	tests := []struct {
		name         string
		network      string
		path         []xrecorder.PathHop
		route        string
		wantTunneled bool
	}{
		{
			name:         "chain hop",
			network:      "tcp",
			path:         []xrecorder.PathHop{{Chain: "split", Node: "hub", Addr: "relay-peer"}},
			wantTunneled: true,
		},
		{
			name:         "node hop",
			network:      "tcp",
			path:         []xrecorder.PathHop{{Node: "hub", Addr: "relay-peer"}},
			wantTunneled: true,
		},
		{
			name:         "target hop ignores legacy route",
			network:      "tcp",
			path:         []xrecorder.PathHop{{Addr: "149.154.167.99:80"}},
			route:        "hub@relay > 149.154.167.99:80",
			wantTunneled: false,
		},
		{
			name:         "empty TCP path ignores legacy route",
			network:      "tcp",
			route:        "hub@relay > 149.154.167.99:80",
			wantTunneled: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ring := newRequestRing(0)
			data, err := json.Marshal(xrecorder.HandlerRecorderObject{
				Time:     time.Now(),
				DstAddr:  "149.154.167.99:80",
				Network:  tt.network,
				Path:     tt.path,
				Route:    tt.route,
				Duration: time.Millisecond,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := ring.Record(context.Background(), data); err != nil {
				t.Fatal(err)
			}
			got := ring.list(0)
			if len(got) != 1 {
				t.Fatalf("Record(path %+v) stored %d rows, want 1", tt.path, len(got))
			}
			if got[0].Tunneled != tt.wantTunneled {
				t.Errorf("Record(path %+v) tunneled = %v, want %v", tt.path, got[0].Tunneled, tt.wantTunneled)
			}
		})
	}
}

func TestRequestRecorderEmitsPathWithoutRoute(t *testing.T) {
	tests := []struct {
		name     string
		path     []xrecorder.PathHop
		wantPath bool
	}{
		{
			name: "with path",
			path: []xrecorder.PathHop{
				{Chain: "split", Hop: 0, Node: "hub", Addr: "relay-peer", ConnectMs: 5},
				{Hop: 1, Addr: "149.154.167.99:80", ConnectMs: 12},
			},
			wantPath: true,
		},
		{name: "empty path", wantPath: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ring := newRequestRing(0)
			data, err := json.Marshal(xrecorder.HandlerRecorderObject{
				Time:     time.Now(),
				DstAddr:  "149.154.167.99:80",
				Network:  "tcp",
				Path:     tt.path,
				Duration: time.Millisecond,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := ring.Record(context.Background(), data); err != nil {
				t.Fatal(err)
			}
			got := ring.list(0)
			if len(got) != 1 {
				t.Fatalf("Record(path %+v) stored %d rows, want 1", tt.path, len(got))
			}
			encoded, err := json.Marshal(got[0])
			if err != nil {
				t.Fatal(err)
			}
			var object map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &object); err != nil {
				t.Fatal(err)
			}
			if _, ok := object["route"]; ok {
				t.Error("Record(path) JSON contains legacy route, want it omitted")
			}
			raw, ok := object["path"]
			if ok != tt.wantPath {
				t.Fatalf("Record(path %+v) JSON path presence = %v, want %v", tt.path, ok, tt.wantPath)
			}
			if !tt.wantPath {
				return
			}
			var path []map[string]json.RawMessage
			if err := json.Unmarshal(raw, &path); err != nil {
				t.Fatal(err)
			}
			if len(path) != 2 {
				t.Fatalf("Record(path) JSON path length = %d, want 2", len(path))
			}
			for _, field := range []string{"chain", "hop", "node", "addr", "connect_ms", "err"} {
				if _, ok := path[0][field]; !ok {
					t.Errorf("Record(path) JSON hop is missing %q: %s", field, raw)
				}
			}
			if _, ok := path[0]["connectMs"]; ok {
				t.Errorf("Record(path) JSON hop contains connectMs, want connect_ms: %s", raw)
			}
			if string(path[0]["connect_ms"]) != "5" || string(path[1]["connect_ms"]) != "12" {
				t.Errorf("Record(path) JSON connect_ms values = %s, %s, want 5, 12", path[0]["connect_ms"], path[1]["connect_ms"])
			}
		})
	}
}

func TestRequestRecorderIgnoresMalformedRecords(t *testing.T) {
	ring := newRequestRing(0)
	for _, junk := range []string{
		"not json",
		"{}",
		"null",
		`{"time":"2026-11-26T12:00:00Z"}`,
	} {
		if err := ring.Record(context.Background(), []byte(junk)); err != nil {
			t.Fatalf("Record(%q) returned %v, want malformed input ignored", junk, err)
		}
	}
	if got := ring.list(0); len(got) != 0 {
		t.Fatalf("malformed records appended %d rows, want none", len(got))
	}

	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	records := []xrecorder.HandlerRecorderObject{
		{
			Time:    base,
			Host:    "example.com:443",
			DstAddr: "203.0.113.10:443",
			Network: "tcp",
			Proto:   "tls",
			Path: []xrecorder.PathHop{
				{Hop: 0, Addr: "203.0.113.10:443", ConnectMs: 8},
			},
			InputBytes:  12,
			OutputBytes: 34,
			Duration:    1500 * time.Millisecond,
		},
		{
			Time:    base.Add(time.Second),
			Host:    "tunneled.example:443",
			DstAddr: "198.51.100.20:443",
			Network: "tcp",
			Proto:   "http",
			Path: []xrecorder.PathHop{
				{Chain: "split", Hop: 0, Node: "hub", Addr: "relay-peer", ConnectMs: 4},
				{Hop: 1, Addr: "198.51.100.20:443", ConnectMs: 9},
			},
			InputBytes:  56,
			OutputBytes: 78,
			Duration:    2750 * time.Millisecond,
			Err:         "dial failed",
		},
	}
	for i := range records {
		data, err := json.Marshal(records[i])
		if err != nil {
			t.Fatal(err)
		}
		if err := ring.Record(context.Background(), data); err != nil {
			t.Fatalf("Record(valid %d) returned %v", i, err)
		}
	}

	got := ring.list(0)
	if len(got) != 2 {
		t.Fatalf("recorded rows = %d, want 2", len(got))
	}
	if !got[0].Tunneled {
		t.Error("a path with a chain node was marked direct")
	}
	if got[0].DurationMS != 2750 || got[0].InputBytes != 56 || got[0].OutputBytes != 78 || got[0].Err != "dial failed" {
		t.Errorf("recorded fields = %+v, want the handler object's counters, duration and error", got[0])
	}
	if got[1].Tunneled {
		t.Error("a path containing only the destination was marked tunneled")
	}
	if !got[1].Time.Equal(base) || got[1].Host != "example.com:443" || got[1].Dst != "203.0.113.10:443" {
		t.Errorf("direct record = %+v, want the original time and destination", got[1])
	}
}

func TestRequestRecorderFiltersChainArtifactsAndDNS(t *testing.T) {
	tests := []struct {
		name      string
		dst       string
		network   string
		wantCount int
	}{
		{name: "bare peer key", dst: "gfyuoMdKHdqS-example", network: "tcp", wantCount: 0},
		{name: "udp DNS", dst: "8.8.8.8:53", network: "udp", wantCount: 0},
		{name: "tcp DNS", dst: "8.8.8.8:53", network: "tcp", wantCount: 0},
		{name: "IPv4 destination", dst: "149.154.167.99:80", network: "tcp", wantCount: 1},
		{name: "IPv6 destination", dst: "[2001:db8::1]:443", network: "tcp", wantCount: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ring := newRequestRing(0)
			data, err := json.Marshal(xrecorder.HandlerRecorderObject{
				Time:     time.Now(),
				DstAddr:  tt.dst,
				Network:  tt.network,
				Duration: time.Millisecond,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := ring.Record(context.Background(), data); err != nil {
				t.Fatalf("Record(%q) returned %v, want nil", tt.dst, err)
			}
			got := ring.list(0)
			if len(got) != tt.wantCount {
				t.Fatalf("Record(%q) stored %d rows, want %d", tt.dst, len(got), tt.wantCount)
			}
			if tt.wantCount > 0 && got[0].Dst != tt.dst {
				t.Errorf("Record(%q) stored dst %q, want %q", tt.dst, got[0].Dst, tt.dst)
			}
		})
	}
}

func TestRequestRecorderClassifiesUDPWithoutPath(t *testing.T) {
	ring := newRequestRing(0)
	ring.setTunneledClassifier(func(ctx context.Context, network, host, dst string) bool {
		return host == "tunneled.example:53"
	})
	for _, host := range []string{"direct.example:53", "tunneled.example:53"} {
		data, err := json.Marshal(xrecorder.HandlerRecorderObject{
			Time:     time.Now(),
			Host:     host,
			DstAddr:  "203.0.113.53:5353",
			Network:  "udp",
			Duration: time.Millisecond,
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := ring.Record(context.Background(), data); err != nil {
			t.Fatal(err)
		}
	}
	got := ring.list(0)
	if len(got) != 2 {
		t.Fatalf("UDP rows = %d, want 2", len(got))
	}
	if !got[0].Tunneled || got[1].Tunneled {
		t.Errorf("UDP tunneled flags = %v, %v, want true then false", got[0].Tunneled, got[1].Tunneled)
	}
}

func TestTungoUDPRecorderUsesLiveRules(t *testing.T) {
	tungoRunConfig(t)
	t.Chdir(t.TempDir())
	useDeviceListener(t, loopbackDeviceListener(t))
	for i := Count() - 1; i >= 0; i-- {
		Delete(GetIndex(i).ID())
	}
	t.Cleanup(func() {
		for i := Count() - 1; i >= 0; i-- {
			Delete(GetIndex(i).ID())
		}
	})

	const id = "tungo-udp-request-route"
	ep := runningTungoWithRules(t, id, []string{"203.0.113.0/24"}).(*tungoEntryPoint)
	record := func(host string) Request {
		t.Helper()
		data, err := json.Marshal(xrecorder.HandlerRecorderObject{
			Time:     time.Now(),
			Host:     host,
			DstAddr:  "203.0.113.53:5353",
			Network:  "udp",
			Duration: time.Millisecond,
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := ep.requests.Record(context.Background(), data); err != nil {
			t.Fatal(err)
		}
		return ep.Requests(1)[0]
	}

	if got := record("203.0.113.53:5353"); !got.Tunneled {
		t.Error("a UDP destination selected by the live rule was recorded as direct")
	}
	ep.SetRules([]string{"198.51.100.0/24"})
	if got := record("203.0.113.53:5353"); got.Tunneled {
		t.Error("a UDP destination dropped by a live rule edit was still recorded as tunneled")
	}
}

func TestTungoRequestsNilSafe(t *testing.T) {
	ep := NewTungoEntryPoint().(interface {
		Requests(int) []Request
	})
	if got := ep.Requests(10); len(got) != 0 {
		t.Fatalf("new entrypoint requests = %+v, want none", got)
	}
	var nilEP *tungoEntryPoint
	if got := nilEP.Requests(10); len(got) != 0 {
		t.Fatalf("nil entrypoint requests = %+v, want none", got)
	}
}

func TestRestartRunningKeepsRequestHistory(t *testing.T) {
	tungoRunConfig(t)
	t.Chdir(t.TempDir())
	useDeviceListener(t, loopbackDeviceListener(t))
	for i := Count() - 1; i >= 0; i-- {
		Delete(GetIndex(i).ID())
	}
	t.Cleanup(func() {
		for i := Count() - 1; i >= 0; i-- {
			Delete(GetIndex(i).ID())
		}
	})

	const id = "tungo-restart-requests"
	old := runningTungoWithRules(t, id, []string{"example.com"})
	old.(*tungoEntryPoint).requests.append(Request{Host: "before-restart.example"})

	RestartRunning()

	next := Get(id)
	if next == nil || next == old {
		t.Fatalf("tungo entrypoint was not restarted: %v", next)
	}
	got := next.(interface {
		Requests(int) []Request
	}).Requests(10)
	if len(got) != 1 || got[0].Host != "before-restart.example" {
		t.Fatalf("request history after restart = %+v, want the pre-restart record", got)
	}
}
