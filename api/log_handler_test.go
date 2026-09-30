package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-gost/wisper/config"
	xconfig "github.com/go-gost/x/config"
)

// setLogOutput points the running app's log at path for the rest of the test.
func setLogOutput(t *testing.T, output string) {
	t.Helper()
	config.Set(&config.Config{Log: &xconfig.LogConfig{Output: output}})
}

// TestGetLogs covers the tail the debug flow actually reads: a count, a file
// bigger than the count, and the cases where there is no file to read.
func TestGetLogs(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	file := filepath.Join(t.TempDir(), "wisper.log")

	// No file at all: logging goes somewhere a reader cannot tail.
	setLogOutput(t, "stderr")
	if resp, body := getJSON(t, srv.URL+"/api/logs"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stderr output: status = %d, want 404 (%v)", resp.StatusCode, body)
	}

	// A file that does not exist yet is empty, not an error.
	setLogOutput(t, file)
	resp, body := getJSON(t, srv.URL+"/api/logs")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("missing file: status = %d, want 200 (%v)", resp.StatusCode, body)
	}
	if lines := body["lines"].([]any); len(lines) != 0 {
		t.Errorf("missing file: lines = %v, want none", lines)
	}

	if err := os.WriteFile(file, []byte("one\ntwo\nthree\nfour\n"), 0644); err != nil {
		t.Fatal(err)
	}

	resp, body = getJSON(t, srv.URL+"/api/logs?tail=2")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("tail=2: status = %d (%v)", resp.StatusCode, body)
	}
	if lines := body["lines"].([]any); len(lines) != 2 ||
		lines[0] != "three" || lines[1] != "four" {
		t.Errorf("tail=2: lines = %v, want the last two in file order", body["lines"])
	}

	// More lines than the file holds returns all of them.
	_, body = getJSON(t, srv.URL+"/api/logs?tail=99")
	if lines := body["lines"].([]any); len(lines) != 4 || lines[0] != "one" {
		t.Errorf("tail=99: lines = %v, want the whole file", body["lines"])
	}

	for _, q := range []string{"tail=x", "tail=0", "tail=-1"} {
		if resp, _ := getJSON(t, srv.URL+"/api/logs?"+q); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", q, resp.StatusCode)
		}
	}
}

// TestGetLogsPartialFirstLine: the tail is read in one chunk off the end, so a
// file larger than that chunk starts mid-line there. The partial line must not
// come back as if it were a log entry.
func TestGetLogsPartialFirstLine(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	file := filepath.Join(t.TempDir(), "wisper.log")
	setLogOutput(t, file)

	// 300 lines of ~1KB, which is more than the chunk the handler reads.
	var b strings.Builder
	line := strings.Repeat("x", 1000)
	for i := 0; i < 300; i++ {
		fmt.Fprintf(&b, "%s %d\n", line, i)
	}
	if err := os.WriteFile(file, []byte(b.String()), 0644); err != nil {
		t.Fatal(err)
	}

	_, body := getJSON(t, srv.URL+"/api/logs?tail=3")
	lines := body["lines"].([]any)
	if len(lines) != 3 {
		t.Fatalf("lines = %v, want 3", body["lines"])
	}
	for i, want := range []string{"297", "298", "299"} {
		got, _ := lines[i].(string)
		if got != line+" "+want {
			t.Errorf("line %d = %.40q…, want a whole line ending in %q", i, got, want)
		}
	}
}

// TestLogLevelEndpoint: the level can be raised and lowered through the API, is
// reported back with the tail, and an unknown level is refused.
func TestLogLevelEndpoint(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Close()

	file := filepath.Join(t.TempDir(), "wisper.log")
	setLogOutput(t, file)

	resp, body := putJSON(t, srv.URL+"/api/log/level", map[string]string{"level": "debug"})
	if resp.StatusCode != http.StatusOK || body["level"] != "debug" {
		t.Fatalf("PUT level=debug: status = %d, body = %v", resp.StatusCode, body)
	}

	_, body = getJSON(t, srv.URL+"/api/logs")
	if body["level"] != "debug" {
		t.Errorf("GET /api/logs reports level %v, want debug", body["level"])
	}

	// The query string form, which is what a browser URL needs.
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/log/level?level=info", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT ?level=info: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("PUT ?level=info: status = %d, want 200", resp.StatusCode)
	}

	if resp, _ := putJSON(t, srv.URL+"/api/log/level", map[string]string{"level": "loud"}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("PUT level=loud: status = %d, want 400", resp.StatusCode)
	}
}
