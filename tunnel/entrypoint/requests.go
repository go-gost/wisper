package entrypoint

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/go-gost/core/recorder"
	xrecorder "github.com/go-gost/x/recorder"
)

const defaultRequestRingCapacity = 500

// RequestPathHop describes one dial hop in a Request's path. The final target
// hop has no chain or node.
type RequestPathHop struct {
	Chain     string `json:"chain"`
	Hop       int    `json:"hop"`
	Node      string `json:"node"`
	Addr      string `json:"addr"`
	ConnectMS uint64 `json:"connect_ms"`
	Err       string `json:"err"`
}

// Request is one recent flow handled by a tungo entrypoint. Tunneled is true
// when Path contains a chain or node hop; a direct path contains only the
// target hop. The UDP handler currently omits Path, so an empty UDP path is
// classified by asking the entrypoint's live chain which node it selects.
type Request struct {
	Time        time.Time        `json:"time"`
	Host        string           `json:"host"`
	Dst         string           `json:"dst"`
	Network     string           `json:"network"`
	Proto       string           `json:"proto"`
	Path        []RequestPathHop `json:"path,omitempty"`
	Tunneled    bool             `json:"tunneled"`
	InputBytes  uint64           `json:"input_bytes"`
	OutputBytes uint64           `json:"output_bytes"`
	DurationMS  int64            `json:"duration_ms"`
	Err         string           `json:"err"`
}

// requestRing is a fixed-size, concurrency-safe history. next is the oldest
// slot once the ring is full; reads walk backward from it so the newest record
// is always first. Non-IP-literal chain artifacts and port 53 DNS records are
// excluded before storage.
type requestRing struct {
	mu       sync.RWMutex
	records  []Request
	next     int
	count    int
	classify func(context.Context, string, string, string) bool
}

func newRequestRing(capacity int) *requestRing {
	if capacity <= 0 {
		capacity = defaultRequestRingCapacity
	}
	return &requestRing{records: make([]Request, capacity)}
}

func isRecordableDestination(dst string) bool {
	host, port, err := net.SplitHostPort(dst)
	if err != nil {
		host = dst
	}
	return net.ParseIP(host) != nil && port != "53"
}

func requestPath(path []xrecorder.PathHop) []RequestPathHop {
	if len(path) == 0 {
		return nil
	}
	out := make([]RequestPathHop, len(path))
	for i, hop := range path {
		out[i] = RequestPathHop{
			Chain:     hop.Chain,
			Hop:       hop.Hop,
			Node:      hop.Node,
			Addr:      hop.Addr,
			ConnectMS: hop.ConnectMs,
			Err:       hop.Err,
		}
	}
	return out
}

func (r *requestRing) append(req Request) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.records) == 0 {
		r.records = make([]Request, defaultRequestRingCapacity)
	}
	r.records[r.next] = req
	r.next = (r.next + 1) % len(r.records)
	if r.count < len(r.records) {
		r.count++
	}
}

func (r *requestRing) setTunneledClassifier(classify func(context.Context, string, string, string) bool) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.classify = classify
}

func (r *requestRing) list(limit int) []Request {
	if r == nil {
		return []Request{}
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	n := r.count
	if limit > 0 && limit < n {
		n = limit
	}
	out := make([]Request, 0, n)
	for i := 0; i < n; i++ {
		index := (r.next - 1 - i + len(r.records)) % len(r.records)
		out = append(out, r.records[index])
	}
	return out
}

// Record implements recorder.Recorder for handler-level tungo flow records.
// Tunneled is derived from Path, with the live chain classifying an empty UDP
// path. Malformed payloads, non-IP-literal chain artifacts and port 53 DNS
// records are deliberately ignored: request history must never take down the
// data path that produced it.
func (r *requestRing) Record(ctx context.Context, data []byte, opts ...recorder.RecordOption) error {
	if r == nil {
		return nil
	}
	var ro xrecorder.HandlerRecorderObject
	if err := json.Unmarshal(data, &ro); err != nil || ro.Time.IsZero() || ro.Network == "" || ro.DstAddr == "" {
		return nil
	}
	if !isRecordableDestination(ro.DstAddr) {
		return nil
	}
	tunneled := false
	for _, hop := range ro.Path {
		if hop.Chain != "" || hop.Node != "" {
			tunneled = true
			break
		}
	}
	if len(ro.Path) == 0 && strings.HasPrefix(ro.Network, "udp") {
		r.mu.RLock()
		classify := r.classify
		r.mu.RUnlock()
		if classify != nil {
			tunneled = classify(ctx, ro.Network, ro.Host, ro.DstAddr)
		}
	}
	r.append(Request{
		Time:        ro.Time,
		Host:        ro.Host,
		Dst:         ro.DstAddr,
		Network:     ro.Network,
		Proto:       ro.Proto,
		Path:        requestPath(ro.Path),
		Tunneled:    tunneled,
		InputBytes:  ro.InputBytes,
		OutputBytes: ro.OutputBytes,
		DurationMS:  ro.Duration.Milliseconds(),
		Err:         ro.Err,
	})
	return nil
}

// Requests returns the entrypoint's recent requests, newest first. A nil
// entrypoint or one without a ring has an empty history.
func (s *tungoEntryPoint) Requests(limit int) []Request {
	return s.requestHistoryRing().list(limit)
}

func (s *tungoEntryPoint) requestHistoryRing() *requestRing {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.requests
}

func (s *tungoEntryPoint) setRequestHistoryRing(ring *requestRing) {
	if s == nil || ring == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = ring
}

// PreserveRequestHistory carries a tungo entrypoint's in-process request ring
// to a same-ID replacement. The ring belongs to the entrypoint identity rather
// than to one run, so a restart does not silently erase what the detail page
// has just shown.
func PreserveRequestHistory(dst, src EntryPoint) {
	srcRing, ok := src.(interface {
		requestHistoryRing() *requestRing
	})
	if !ok {
		return
	}
	dstRing, ok := dst.(interface {
		setRequestHistoryRing(*requestRing)
	})
	if !ok {
		return
	}
	dstRing.setRequestHistoryRing(srcRing.requestHistoryRing())
}
