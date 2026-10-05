package api

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The p2p tunnel saturates its CPU quota at ~750 Mbit/s, and telling "per-packet
// cost" apart from "the path is slow" needs a CPU profile — so the endpoints
// stay in the tree permanently. They are off unless -debug.pprof /
// WISPER_DEBUG_PPROF is set, because the API has no authentication at all and
// CORS is "*": an always-on /debug/pprof/profile?seconds=600 is a free core
// burn for anyone who can reach the port, and a heap dump of a p2p host can
// carry tunnel buffers and peer keys.

// pprofGet is a plain GET that returns the status and body. The pprof endpoints
// answer text/html or a binary profile, so the JSON helpers do not apply.
func pprofGet(t *testing.T, h http.Handler, path string) (int, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	body, _ := io.ReadAll(rec.Body)
	return rec.Code, string(body)
}

// offByDefault is the security property, so it is asserted first and on its
// own: with the flag unset there must be no route at all, not a route that
// answers 403. A 404 leaves nothing to enumerate.
func TestPprofOffByDefault(t *testing.T) {
	h := NewHandler(nil, false)

	for _, path := range []string{
		"/debug/pprof/",
		"/debug/pprof/profile",
		"/debug/pprof/heap",
		"/debug/pprof/goroutine",
		"/debug/pprof/symbol",
	} {
		if code, _ := pprofGet(t, h, path); code != http.StatusNotFound {
			t.Errorf("GET %s with pprof off = %d, want 404 (no route)", path, code)
		}
	}
}

func TestPprofEnabled(t *testing.T) {
	h := NewHandler(nil, true)

	t.Run("index lists the profiles", func(t *testing.T) {
		code, body := pprofGet(t, h, "/debug/pprof/")
		if code != http.StatusOK {
			t.Fatalf("GET /debug/pprof/ = %d, want 200", code)
		}
		// The named profiles Index serves must all be reachable, since they
		// are how a per-packet-cost question gets answered: allocs/heap test
		// the allocation-rate theory, goroutine the orchestration theory,
		// mutex/block the lock-convoy theory.
		for _, want := range []string{"heap", "allocs", "goroutine", "block", "mutex"} {
			if !strings.Contains(body, want) {
				t.Errorf("index does not list %q", want)
			}
		}
	})

	// profile and symbol are separate registrations; a wrong path there fails
	// only at capture time, which is the worst moment to find out.
	for _, path := range []string{"/debug/pprof/symbol"} {
		if code, _ := pprofGet(t, h, path); code != http.StatusOK {
			t.Errorf("GET %s with pprof on = %d, want 200", path, code)
		}
	}

	// A real profile round-trips, which is the only thing worth asserting
	// here: a body that decodes as a pprof archive proves the endpoint
	// collects and streams rather than erroring.
	//
	// seconds=1 is the floor -- pprof treats seconds<=0 as "use the 30s
	// default", so asking for 0 would make this test take 30s.
	code, body := pprofGet(t, h, "/debug/pprof/profile?seconds=1")
	if code != http.StatusOK {
		t.Fatalf("GET /debug/pprof/profile = %d, want 200: %.200q", code, body)
	}
	if len(body) < 2 || body[0] != 0x1f || body[1] != 0x8b {
		t.Fatalf("profile is not a gzip archive: %.40q", body)
	}
	zr, err := gzip.NewReader(strings.NewReader(body))
	if err != nil {
		t.Fatalf("profile is not gzip: %v", err)
	}
	raw, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("read profile: %v", err)
	}
	// The payload is pprof's protobuf encoding, not the legacy text format, so
	// the profile's own field names are what identify it. "cpu" and
	// "nanoseconds" are the SampleType names Go writes for a CPU profile; a
	// truncated or empty archive will not carry both.
	for _, want := range []string{"cpu", "nanoseconds"} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("profile archive missing %q: %.200q", want, raw)
		}
	}
}

// cmdline hands the process argv to an unauthenticated caller, and trace is a
// heavy runtime trace; neither helps read a CPU profile, so neither is mounted.
func TestPprofOmitsCmdlineAndTrace(t *testing.T) {
	h := NewHandler(nil, true)

	for _, path := range []string{"/debug/pprof/cmdline", "/debug/pprof/trace"} {
		if code, _ := pprofGet(t, h, path); code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404 (deliberately not mounted)", path, code)
		}
	}
}

// The web UI is mounted at "/", the catch-all, and its file server answers any
// unmatched path with index.html. So with pprof off and the web UI present —
// the real production configuration — /debug/pprof/ used to come back 200
// text/html: no data leaked, but "off" was unreadable and a status check would
// report the endpoints as live.
func TestPprofOffWithWebHandlerStill404(t *testing.T) {
	web := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("web:" + r.URL.Path))
	})
	h := NewHandler(web, false)

	for _, path := range []string{"/debug/pprof/", "/debug/pprof/profile?seconds=1", "/debug/pprof/heap"} {
		if code, body := pprofGet(t, h, path); code != http.StatusNotFound {
			t.Errorf("GET %s with pprof off and web UI = %d, want 404, got %.80q", path, code, body)
		}
	}
	// The catch-all must still do its real job.
	if code, body := pprofGet(t, h, "/index.html"); code != http.StatusOK || !strings.HasPrefix(body, "web:") {
		t.Errorf("web UI no longer served: %d %q", code, body)
	}
}

// The web UI is mounted at "/", the catch-all. Without a more specific pattern
// the pprof subtree would be swallowed by it and every profile 404s.
func TestPprofEnabledWithWebHandler(t *testing.T) {
	web := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("web:" + r.URL.Path))
	})
	h := NewHandler(web, true)

	code, body := pprofGet(t, h, "/debug/pprof/")
	if code != http.StatusOK {
		t.Errorf("GET /debug/pprof/ behind the web handler = %d, want 200: %s", code, body)
	}
	// Must be the pprof index, not the SPA's index.html: both are 200.
	if !strings.Contains(body, "goroutine") {
		t.Errorf("/debug/pprof/ served the web UI instead of the pprof index: %.120q", body)
	}
	if code, body := pprofGet(t, h, "/index.html"); code != http.StatusOK || !strings.HasPrefix(body, "web:") {
		t.Errorf("web UI no longer served: %d %q", code, body)
	}
}
