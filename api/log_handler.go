package api

import (
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

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
func handleGetLogs(w http.ResponseWriter, r *http.Request) {
	tail := logTailDefault
	if s := r.URL.Query().Get("tail"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "invalid tail: "+s)
			return
		}
		tail = min(n, logTailMax)
	}

	file := config.LogFile()
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

	writeJSON(w, http.StatusOK, logsResponse{File: file, Level: config.LogLevel(), Lines: lines})
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
