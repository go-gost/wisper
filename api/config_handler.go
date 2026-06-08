package api

import (
	"net/http"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// configResponse is the JSON representation of app settings.
type configResponse struct {
	Server     string `json:"server"`
	Entrypoint string `json:"entrypoint"`
	Insecure   bool   `json:"insecure"`
	Lang       string `json:"lang"`
	Theme      string `json:"theme"`
}

func handleGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	settings := cfg.Settings
	if settings == nil {
		settings = &config.Settings{}
	}

	writeJSON(w, http.StatusOK, configResponse{
		Server:     settings.Server,
		Entrypoint: settings.Entrypoint,
		Insecure:   settings.Insecure,
		Lang:       settings.Lang,
		Theme:      settings.Theme,
	})
}

// configUpdateRequest is the JSON body for updating settings.
type configUpdateRequest struct {
	Server     *string `json:"server,omitempty"`
	Entrypoint *string `json:"entrypoint,omitempty"`
	Insecure   *bool   `json:"insecure,omitempty"`
	Lang       *string `json:"lang,omitempty"`
	Theme      *string `json:"theme,omitempty"`
}

func handleUpdateConfig(w http.ResponseWriter, r *http.Request) {
	var req configUpdateRequest
	if !readJSON(w, r, &req) {
		return
	}

	cfg := config.Get()
	if cfg.Settings == nil {
		cfg.Settings = &config.Settings{}
	}

	serverChanged := req.Server != nil && *req.Server != cfg.Settings.Server
	entrypointChanged := req.Entrypoint != nil && *req.Entrypoint != cfg.Settings.Entrypoint
	insecureChanged := req.Insecure != nil && *req.Insecure != cfg.Settings.Insecure

	if req.Server != nil {
		cfg.Settings.Server = *req.Server
	}
	if req.Entrypoint != nil {
		cfg.Settings.Entrypoint = *req.Entrypoint
	}
	if req.Insecure != nil {
		cfg.Settings.Insecure = *req.Insecure
	}
	if req.Lang != nil {
		cfg.Settings.Lang = *req.Lang
	}
	if req.Theme != nil {
		cfg.Settings.Theme = *req.Theme
	}

	config.Set(cfg)
	cfg.Write()

	// Restart all running tunnels/entrypoints so they reconnect with the
	// new server, entrypoint domain, or TLS settings.
	if serverChanged || entrypointChanged || insecureChanged {
		tunnel.RestartRunning()
		entrypoint.RestartRunning()
	}

	handleGetConfig(w, r)
}
