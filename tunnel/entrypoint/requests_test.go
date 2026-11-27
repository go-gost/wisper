package entrypoint

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
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

func TestRequestRecorderMergesSplitFlowBySID(t *testing.T) {
	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	path := []xrecorder.PathHop{{Hop: 0, Addr: "203.0.113.10:443", ConnectMs: 8}}
	request := xrecorder.HandlerRecorderObject{
		SID:         "split-flow",
		Time:        base,
		Host:        "example.com:443",
		DstAddr:     "203.0.113.10:443",
		Network:     "tcp",
		Proto:       "http",
		Path:        path,
		InputBytes:  100,
		OutputBytes: 40,
		Duration:    250 * time.Millisecond,
		Err:         "request error",
	}
	connection := xrecorder.HandlerRecorderObject{
		SID:         "split-flow",
		Time:        base.Add(time.Second),
		Host:        "example.com:443",
		DstAddr:     "203.0.113.10:443",
		Network:     "tcp",
		InputBytes:  120,
		OutputBytes: 30,
		Duration:    500 * time.Millisecond,
		Err:         "connection reset",
	}
	wantPath := []RequestPathHop{{Hop: 0, Addr: "203.0.113.10:443", ConnectMS: 8}}
	for _, tt := range []struct {
		name         string
		requestFirst bool
	}{
		{name: "request then connection", requestFirst: true},
		{name: "connection then request", requestFirst: false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ring := newRequestRing(0)
			records := []xrecorder.HandlerRecorderObject{request, connection}
			if !tt.requestFirst {
				slices.Reverse(records)
			}
			for _, record := range records {
				recordRequestObject(t, ring, record)
			}

			got := ring.list(0)
			if len(got) != 1 {
				t.Fatalf("Record(split SID %q) stored %d rows, want 1", request.SID, len(got))
			}
			merged := got[0]
			if merged.Host != request.Host || merged.Dst != request.DstAddr || merged.Network != request.Network || merged.Proto != request.Proto {
				t.Errorf("Record(split SID %q) identity = %q/%q/%q/%q, want %q/%q/%q/%q",
					request.SID, merged.Host, merged.Dst, merged.Network, merged.Proto,
					request.Host, request.DstAddr, request.Network, request.Proto)
			}
			if merged.Tunneled {
				t.Errorf("Record(split SID %q) tunneled = true, want false for a target-only path", request.SID)
			}
			if merged.InputBytes != 120 || merged.OutputBytes != 40 || merged.DurationMS != 500 {
				t.Errorf("Record(split SID %q) bytes/duration = %d/%d/%d, want 120/40/500",
					request.SID, merged.InputBytes, merged.OutputBytes, merged.DurationMS)
			}
			if !slices.Equal(merged.Path, wantPath) {
				t.Errorf("Record(split SID %q) path = %+v, want %+v", request.SID, merged.Path, wantPath)
			}
			wantErr := connection.Err
			if !tt.requestFirst {
				wantErr = request.Err
			}
			if merged.Err != wantErr {
				t.Errorf("Record(split SID %q) error = %q, want newer error %q", request.SID, merged.Err, wantErr)
			}
			if !merged.Time.Equal(base) {
				t.Errorf("Record(split SID %q) time = %s, want earlier time %s", request.SID, merged.Time, base)
			}
		})
	}
}

func TestRequestRecorderMergesSameSIDFields(t *testing.T) {
	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	rich := xrecorder.HandlerRecorderObject{
		SID:     "merge-fields",
		Time:    base,
		Host:    "rich.example:443",
		DstAddr: "203.0.113.10:443",
		Network: "tcp",
		Proto:   "http",
		Path: []xrecorder.PathHop{
			{Chain: "split", Hop: 0, Node: "hub", Addr: "relay-peer", ConnectMs: 4},
			{Hop: 1, Addr: "203.0.113.10:443", ConnectMs: 8},
		},
		InputBytes:  20,
		OutputBytes: 50,
		Duration:    200 * time.Millisecond,
		Err:         "rich error",
	}
	poor := xrecorder.HandlerRecorderObject{
		SID:         "merge-fields",
		Time:        base.Add(time.Second),
		Host:        "poor.example:443",
		DstAddr:     "198.51.100.20:443",
		Network:     "udp",
		Proto:       "quic",
		Path:        []xrecorder.PathHop{{Addr: "198.51.100.20:443"}},
		InputBytes:  10,
		OutputBytes: 40,
		Duration:    100 * time.Millisecond,
	}
	wantPath := []RequestPathHop{
		{Chain: "split", Hop: 0, Node: "hub", Addr: "relay-peer", ConnectMS: 4},
		{Hop: 1, Addr: "203.0.113.10:443", ConnectMS: 8},
	}
	for _, tt := range []struct {
		name      string
		richFirst bool
		want      xrecorder.HandlerRecorderObject
	}{
		{name: "rich then poor", richFirst: true, want: rich},
		{name: "poor then rich", richFirst: false, want: poor},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ring := newRequestRing(0)
			records := []xrecorder.HandlerRecorderObject{rich, poor}
			if !tt.richFirst {
				slices.Reverse(records)
			}
			for _, record := range records {
				recordRequestObject(t, ring, record)
			}

			got := ring.list(0)
			if len(got) != 1 {
				t.Fatalf("Record(SID %q) stored %d rows, want 1", rich.SID, len(got))
			}
			merged := got[0]
			if merged.Host != tt.want.Host || merged.Dst != tt.want.DstAddr || merged.Network != tt.want.Network || merged.Proto != tt.want.Proto {
				t.Errorf("Record(SID %q) identity = %q/%q/%q/%q, want first non-empty %q/%q/%q/%q",
					rich.SID, merged.Host, merged.Dst, merged.Network, merged.Proto,
					tt.want.Host, tt.want.DstAddr, tt.want.Network, tt.want.Proto)
			}
			if !merged.Tunneled {
				t.Errorf("Record(SID %q) tunneled = false, want true from either record", rich.SID)
			}
			if merged.InputBytes != 20 || merged.OutputBytes != 50 || merged.DurationMS != 200 {
				t.Errorf("Record(SID %q) bytes/duration = %d/%d/%d, want maxima 20/50/200",
					rich.SID, merged.InputBytes, merged.OutputBytes, merged.DurationMS)
			}
			if !slices.Equal(merged.Path, wantPath) {
				t.Errorf("Record(SID %q) path = %+v, want longer path %+v", rich.SID, merged.Path, wantPath)
			}
			if merged.Err != rich.Err {
				t.Errorf("Record(SID %q) error = %q, want retained/newer error %q", rich.SID, merged.Err, rich.Err)
			}
			if !merged.Time.Equal(base) {
				t.Errorf("Record(SID %q) time = %s, want earlier time %s", rich.SID, merged.Time, base)
			}
		})
	}
}

func TestRequestRecorderKeepsDifferentSIDsAndAppendsEmptySIDs(t *testing.T) {
	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name      string
		firstSID  string
		secondSID string
	}{
		{name: "different SIDs", firstSID: "flow-1", secondSID: "flow-2"},
		{name: "empty SIDs", firstSID: "", secondSID: ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ring := newRequestRing(0)
			recordRequestObject(t, ring, xrecorder.HandlerRecorderObject{
				SID: tt.firstSID, Time: base, Host: "first.example", DstAddr: "203.0.113.10:443", Network: "tcp",
			})
			recordRequestObject(t, ring, xrecorder.HandlerRecorderObject{
				SID: tt.secondSID, Time: base.Add(time.Second), Host: "second.example", DstAddr: "198.51.100.20:443", Network: "tcp",
			})

			got := ring.list(0)
			if len(got) != 2 {
				t.Fatalf("Record(SIDs %q and %q) stored %d rows, want 2", tt.firstSID, tt.secondSID, len(got))
			}
			if got[0].Host != "second.example" || got[1].Host != "first.example" {
				t.Errorf("Record(SIDs %q and %q) order = %q, %q, want second.example, first.example",
					tt.firstSID, tt.secondSID, got[0].Host, got[1].Host)
			}
		})
	}
}

func TestRequestRingMergeCapacityAndEviction(t *testing.T) {
	ring := newRequestRing(2)
	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	record := func(sid, host string, input uint64, timestamp time.Time) {
		t.Helper()
		recordRequestObject(t, ring, xrecorder.HandlerRecorderObject{
			SID: sid, Time: timestamp, Host: host, DstAddr: "203.0.113.10:443", Network: "tcp", InputBytes: input,
		})
	}

	record("a", "a", 1, base)
	record("b", "b", 1, base.Add(time.Second))
	record("a", "a-updated", 2, base.Add(2*time.Second))
	got := ring.list(0)
	if len(got) != 2 || got[0].Host != "b" || got[1].Host != "a" || got[1].InputBytes != 2 || !got[1].Time.Equal(base) {
		t.Fatalf("append/merge(a) = %+v, want two rows b and a with merged bytes and earlier time", got)
	}

	record("c", "c", 1, base.Add(3*time.Second))
	record("d", "d", 1, base.Add(4*time.Second))
	record("a", "a-new", 3, base.Add(5*time.Second))
	record("a", "a-new-updated", 4, base.Add(6*time.Second))
	record("e", "e", 1, base.Add(7*time.Second))

	got = ring.list(0)
	if len(got) != 2 {
		t.Fatalf("ring length after wrapped merges and evictions = %d, want 2", len(got))
	}
	if got[0].Host != "e" || got[1].Host != "a-new" || got[1].InputBytes != 4 || !got[1].Time.Equal(base.Add(5*time.Second)) {
		t.Errorf("append/merge after eviction wrap = %+v, want e and a-new with merged bytes and earlier time", got)
	}
}

func TestRequestRecorderFiltersBeforeSIDMerge(t *testing.T) {
	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name string
		host string
		dst  string
	}{
		// A chain artifact carries no host of its own: the ring only keeps a
		// non-IP dialed address when the sniffed host identifies the request.
		{name: "chain artifact", host: "", dst: "relay-peer-key"},
		{name: "DNS", host: "dropped.example", dst: "8.8.8.8:53"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ring := newRequestRing(0)
			recordRequestObject(t, ring, xrecorder.HandlerRecorderObject{
				SID: "filtered-merge", Time: base, Host: "kept.example", DstAddr: "203.0.113.10:443", Network: "tcp", InputBytes: 1,
			})
			recordRequestObject(t, ring, xrecorder.HandlerRecorderObject{
				SID: "filtered-merge", Time: base.Add(time.Second), Host: tt.host, DstAddr: tt.dst, Network: "udp",
				InputBytes: 99, Duration: time.Second, Err: "must not merge",
			})

			got := ring.list(0)
			if len(got) != 1 {
				t.Fatalf("Record(filtered dst %q) stored %d rows, want the one kept row", tt.dst, len(got))
			}
			if got[0].Host != "kept.example" || got[0].Dst != "203.0.113.10:443" || got[0].InputBytes != 1 || got[0].Err != "" {
				t.Errorf("Record(filtered dst %q) changed the kept row: %+v", tt.dst, got[0])
			}
		})
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

// TestRequestRecorderKeepsTunneledTLSFlowNamedAfterTheChainPeer pins what a
// sniffed TLS flow through the split's relay node records: x overwrites the
// flow's destination with the upstream conn's address, and that conn is the
// p2p stream, whose RemoteAddr is the hub's base64 peer key. The request is
// still a real one the phone sent, so the ring must use the sniffed host as
// its destination instead of discarding the row as a chain artifact.
func TestRequestRecorderKeepsTunneledTLSFlowNamedAfterTheChainPeer(t *testing.T) {
	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	ring := newRequestRing(0)
	recordRequestObject(t, ring, xrecorder.HandlerRecorderObject{
		SID:        "tunneled-tls",
		Time:       base,
		Host:       "example.com:443",
		DstAddr:    "gfyuoMdKHdqS-example",
		Network:    "tcp",
		Proto:      "tls",
		Path:       []xrecorder.PathHop{{Chain: "split", Hop: 0, Node: "hub", Addr: "gfyuoMdKHdqS-example"}},
		Duration:   time.Second,
		InputBytes: 10,
	})

	got := ring.list(0)
	if len(got) != 1 {
		t.Fatalf("Record(tunneled TLS over the chain peer) stored %d rows, want 1", len(got))
	}
	request := got[0]
	if request.Host != "example.com:443" || request.Dst != "example.com:443" {
		t.Errorf("recorded host/dst = %q/%q, want the sniffed host as the destination", request.Host, request.Dst)
	}
	if !request.Tunneled {
		t.Error("recorded tunneled = false, want true for a chain hop")
	}
}

// TestRequestRecorderPrefersTheDialedIPOnMerge: a tunneled HTTP flow records
// twice — once from the sniffer with the chain peer as its dialed address, once
// from the handler's deferred record with the tun destination. The merged row
// must keep the IP target so the request list does not show the peer key as
// the destination.
func TestRequestRecorderPrefersTheDialedIPOnMerge(t *testing.T) {
	base := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	sniffed := xrecorder.HandlerRecorderObject{
		SID:     "tunneled-http",
		Time:    base,
		Host:    "example.com:80",
		DstAddr: "gfyuoMdKHdqS-example",
		Network: "tcp",
	}
	connection := xrecorder.HandlerRecorderObject{
		SID:     "tunneled-http",
		Time:    base.Add(time.Second),
		Host:    "example.com:80",
		DstAddr: "203.0.113.10:80",
		Network: "tcp",
		Path: []xrecorder.PathHop{
			{Chain: "split", Hop: 0, Node: "hub", Addr: "gfyuoMdKHdqS-example"},
			{Hop: 1, Addr: "203.0.113.10:80"},
		},
		Duration: time.Second,
	}
	for _, tt := range []struct {
		name         string
		sniffedFirst bool
	}{
		{name: "sniffed then connection", sniffedFirst: true},
		{name: "connection then sniffed", sniffedFirst: false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ring := newRequestRing(0)
			records := []xrecorder.HandlerRecorderObject{sniffed, connection}
			if !tt.sniffedFirst {
				slices.Reverse(records)
			}
			for _, record := range records {
				recordRequestObject(t, ring, record)
			}

			got := ring.list(0)
			if len(got) != 1 {
				t.Fatalf("Record(SID %q) stored %d rows, want 1", sniffed.SID, len(got))
			}
			if got[0].Dst != connection.DstAddr {
				t.Errorf("Record(SID %q) dst = %q, want the dialed %q", sniffed.SID, got[0].Dst, connection.DstAddr)
			}
			if got[0].Host != connection.Host {
				t.Errorf("Record(SID %q) host = %q, want %q", sniffed.SID, got[0].Host, connection.Host)
			}
			if !got[0].Tunneled {
				t.Errorf("Record(SID %q) tunneled = false, want true from the chain hop", sniffed.SID)
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

func recordRequestObject(t *testing.T, ring *requestRing, object xrecorder.HandlerRecorderObject) {
	t.Helper()
	data, err := json.Marshal(object)
	if err != nil {
		t.Fatalf("json.Marshal(HandlerRecorderObject SID %q) returned %v", object.SID, err)
	}
	if err := ring.Record(context.Background(), data); err != nil {
		t.Fatalf("requestRing.Record(SID %q) returned %v", object.SID, err)
	}
}
