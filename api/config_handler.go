package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/runner"
	"github.com/go-gost/wisper/runner/task"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// configResponse is the JSON representation of app settings.
type configResponse struct {
	Server        string           `json:"server"`
	Entrypoint    string           `json:"entrypoint"`
	Insecure      bool             `json:"insecure"`
	Lang          string           `json:"lang"`
	Theme         string           `json:"theme"`
	StatsInterval int              `json:"stats_interval"`
	InspectorURL  string           `json:"inspector_url"`
	P2P           *P2PSettingsResp `json:"p2p,omitempty"`
}

// P2PSettingsResp mirrors config.P2PSettings (secure is a pointer so an
// omitted value keeps the "verify" default).
type P2PSettingsResp struct {
	Derp   string `json:"derp"`
	Secure *bool  `json:"secure,omitempty"`
	CAFile string `json:"ca_file,omitempty"`
	Stun   string `json:"stun,omitempty"`
	Direct *bool  `json:"direct,omitempty"`
}

func handleGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	settings := cfg.Settings
	if settings == nil {
		settings = &config.Settings{}
	}

	statsInterval := settings.StatsInterval
	if statsInterval <= 0 {
		statsInterval = 1
	}

	// Omitted (nil) when unset, so the UI can show the default placeholder.
	var p2p *P2PSettingsResp
	if settings.P2P != nil {
		p2p = &P2PSettingsResp{
			Derp:   settings.P2P.Derp,
			Secure: settings.P2P.Secure,
			CAFile: settings.P2P.CAFile,
			Stun:   settings.P2P.Stun,
			Direct: settings.P2P.Direct,
		}
	}

	writeJSON(w, http.StatusOK, configResponse{
		Server:        settings.Server,
		Entrypoint:    settings.Entrypoint,
		Insecure:      settings.Insecure,
		Lang:          settings.Lang,
		Theme:         settings.Theme,
		StatsInterval: statsInterval,
		InspectorURL:  settings.InspectorURL,
		P2P:           p2p,
	})
}

// configUpdateRequest is the JSON body for updating settings.
type configUpdateRequest struct {
	Server        *string          `json:"server,omitempty"`
	Entrypoint    *string          `json:"entrypoint,omitempty"`
	Insecure      *bool            `json:"insecure,omitempty"`
	Lang          *string          `json:"lang,omitempty"`
	Theme         *string          `json:"theme,omitempty"`
	StatsInterval *int             `json:"stats_interval,omitempty"`
	InspectorURL  *string          `json:"inspector_url,omitempty"`
	P2P           *P2PSettingsResp `json:"p2p,omitempty"`
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
	intervalChanged := req.StatsInterval != nil && *req.StatsInterval != cfg.Settings.StatsInterval

	var p2pChanged bool
	if req.P2P != nil {
		prev := cfg.Settings.P2P
		p2pChanged = prev == nil ||
			prev.Derp != req.P2P.Derp ||
			prev.CAFile != req.P2P.CAFile ||
			prev.Stun != req.P2P.Stun ||
			!boolPtrEqual(prev.Secure, req.P2P.Secure) ||
			!boolPtrEqual(prev.Direct, req.P2P.Direct)
	}

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
	if req.StatsInterval != nil && *req.StatsInterval > 0 {
		cfg.Settings.StatsInterval = *req.StatsInterval
	}
	if req.InspectorURL != nil {
		cfg.Settings.InspectorURL = *req.InspectorURL
	}
	if req.P2P != nil {
		// Settings is shallow-copied into cfg, so never mutate the previous
		// struct through its pointer — assign a whole new one.
		cfg.Settings.P2P = &config.P2PSettings{
			Derp:   req.P2P.Derp,
			Secure: req.P2P.Secure,
			CAFile: req.P2P.CAFile,
			Stun:   req.P2P.Stun,
			Direct: req.P2P.Direct,
		}
	}

	config.Set(cfg)
	if err := cfg.Write(); err != nil {
		slog.Error("write config", "err", err)
	}

	// Restart all running tunnels/entrypoints so they reconnect with the
	// new server, entrypoint domain, TLS, p2p relay, or recording settings.
	if serverChanged || entrypointChanged || insecureChanged || p2pChanged {
		tunnel.RestartRunning()
		entrypoint.RestartRunning()
	}

	// Restart stats runner with the new interval.
	if intervalChanged {
		interval := time.Duration(cfg.Settings.StatsInterval) * time.Second
		if err := runner.Exec(context.Background(), task.UpdateStats(),
			runner.WithAsync(true),
			runner.WithInterval(interval),
			runner.WithCancel(true),
		); err != nil {
			slog.Error("restart stats runner", "err", err)
		}
	}

	handleGetConfig(w, r)
}

// boolPtrEqual reports whether two optional bools hold the same value:
// two nils are equal, nil vs. non-nil is not.
func boolPtrEqual(a, b *bool) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
