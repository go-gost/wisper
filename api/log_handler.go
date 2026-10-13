package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-gost/wisper/config"
)

const (
	// logTailDefault is what a caller gets when it does not ask for a count.
	logTailDefault = 200
	// logTailMax caps a single request: the file is rotated at 10MB, and a
	// whole rotated file in one JSON response is nobody's idea of a debug tool.
	logTailMax = 2000
	// logTailChunk bounds how much is read off the end of the file. The tail is
	// what a reader wants, and this keeps the cost flat as the file grows.
	logTailChunk = 256 << 10
)

// logsResponse is the current log tail. Lines are in file order, oldest first,
// the way tail(1) prints them. Level is what the logger is filtering at, so a
// client can see what it would have to raise before it sees anything.
type logsResponse struct {
	File  string   `json:"file"`
	Level string   `json:"level"`
	Lines []string `json:"lines"`
}

// handleGetLogs returns the last lines of the current log file. When the log
// does not go to a file at all (stderr, stdout, none), there is nothing to
// read and it says so instead of pretending to be empty.
// handleGetLogs returns lines from a log file. tail selects a count; since= is
// a timestamp prefix bounding a window and grep= a substring filter, so a crash
// can be investigated over a combined file whose earlier lines are not the same
// twenty minutes the tail cap offers. source= picks between the log file
// (default) and the crash log, the only place a fatal panic's goroutine stack
// survives.
func handleGetLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	tail := logTailDefault
	if s := q.Get("tail"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "invalid tail: "+s)
			return
		}
		tail = min(n, logTailMax)
	}

	file, err := logFilePath(q.Get("source"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if file == "" {
		writeError(w, http.StatusNotFound, "the log output is not a file")
		return
	}

	lines, err := tailLines(file, tail)
	if err != nil {
		if os.IsNotExist(err) {
			// Nothing has been written yet, which is not an error.
			writeJSON(w, http.StatusOK, logsResponse{File: file, Level: config.LogLevel(), Lines: []string{}})
			return
		}
		writeError(w, http.StatusInternalServerError, "read log: "+err.Error())
		return
	}

	// An unparseable since= is refused rather than silently matching nothing:
	// a typo in the timestamp would otherwise hand back an empty crash report.
	if since := q.Get("since"); since != "" && !parseableTime(since) {
		writeError(w, http.StatusBadRequest, "invalid since: "+since)
		return
	}

	lines = filterLines(lines, q.Get("since"), q.Get("grep"), tail)

	writeJSON(w, http.StatusOK, logsResponse{File: file, Level: config.LogLevel(), Lines: lines})
}

// logFilePath resolves a source name to a file. The default is the configured
// log output; "crash" is the file the runtime's fatal output goes to. An
// unknown name is an error rather than a fallback, because silently returning
// the log file would report nothing about the crash a caller asked about.
func logFilePath(source string) (string, error) {
	switch source {
	case "":
		return config.LogFile(), nil
	case "crash":
		f := config.LogFile()
		if f == "" {
			return "", nil
		}
		return filepath.Join(filepath.Dir(f), "crash.log"), nil
	default:
		return "", fmt.Errorf("unknown source: %s (want log or crash)", source)
	}
}

// filterLines applies since= and grep= after the tail, not while reading: the
// file is one concatenated log with no per-process boundaries, so a window is
// found in what a reader holds, then narrowed. max is the same cap the tail
// used, so a filter can never widen the response.
//
// since= compares timestamps rather than matching a prefix: "the last twenty
// minutes" does not start with the clock reading of twenty minutes ago, so a
// substring would keep only the one line stamped exactly at the boundary.
func filterLines(lines []string, since, grep string, max int) []string {
	var from time.Time
	if since != "" {
		var err error
		if from, err = time.Parse(time.RFC3339, since); err != nil {
			// A bare "2026-10-13T00:30" is the shape slog prints truncated by
			// hand; accepting it keeps a copy-paste out of the shell's way.
			from, err = time.Parse("2006-01-02T15:04", since)
			_ = err
		}
	}

	out := make([]string, 0, len(lines))
	kept := false
	for _, line := range lines {
		stamp, ok := lineTime(line)
		if ok {
			// A goroutine stack is multi-line and only its first line carries a
			// time; the rest must follow the entry they belong to.
			kept = !stamp.Before(from)
		}
		if since != "" && !kept {
			continue
		}
		if grep != "" && !strings.Contains(line, grep) {
			continue
		}
		out = append(out, line)
		if len(out) >= max {
			break
		}
	}
	return out
}

// parseableTime reports whether since= is a timestamp this handler reads.
func parseableTime(s string) bool {
	if _, err := time.Parse(time.RFC3339, s); err == nil {
		return true
	}
	_, err := time.Parse("2006-01-02T15:04", s)
	return err == nil
}

// lineTime reads the time field the slog JSON handler writes. It is a prefix
// match on purpose: the field is first, so the common case needs no full parse.
func lineTime(line string) (time.Time, bool) {
	const key = `{"time":"`
	if !strings.HasPrefix(line, key) {
		return time.Time{}, false
	}
	end := strings.Index(line[len(key):], `"`)
	if end < 0 {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, line[len(key):len(key)+end])
	return t, err == nil
}

// setLogLevelRequest is the JSON body for raising or lowering the level.
type setLogLevelRequest struct {
	Level string `json:"level"`
}

// handleSetLogLevel sets the level the running logger filters at. It takes the
// level from the query string or from a JSON body, so a browser URL works as
// well as the usual JSON client — this is the call that makes a live debug
// session possible on a device whose log level otherwise needs a restart.
func handleSetLogLevel(w http.ResponseWriter, r *http.Request) {
	level := r.URL.Query().Get("level")
	if level == "" {
		var req setLogLevelRequest
		if !readJSON(w, r, &req) {
			return
		}
		level = req.Level
	}

	if err := config.SetLogLevel(level); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"level": config.LogLevel()})
}

// tailLines reads the last n lines of the file at path. It reads a bounded
// chunk off the end rather than the whole file, so the first line of the chunk
// may be a partial one and is dropped.
func tailLines(path string, n int) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return nil, err
	}

	start := max(fi.Size()-logTailChunk, 0)
	buf := make([]byte, fi.Size()-start)
	if _, err := f.ReadAt(buf, start); err != nil && err != io.EOF {
		return nil, err
	}

	lines := strings.Split(strings.TrimSuffix(string(buf), "\n"), "\n")
	if start > 0 && len(lines) > 0 {
		lines = lines[1:]
	}
	if len(lines) == 1 && lines[0] == "" {
		// An empty file splits into one empty line; there is nothing to show.
		lines = lines[:0]
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines, nil
}
