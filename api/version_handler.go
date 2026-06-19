package api

import (
	"net/http"

	"github.com/go-gost/wisper/version"
)

// versionResponse is the JSON representation of the running app version.
type versionResponse struct {
	Version string `json:"version"`
}

// handleGetVersion returns the build version of the running Wisper binary.
// The version is injected at build time via -ldflags; in dev builds it is
// "0.0.0-dev".
func handleGetVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, versionResponse{Version: version.Version})
}
