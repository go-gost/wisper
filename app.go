package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/wisper/api"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/runner"
	"github.com/go-gost/wisper/runner/task"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

var (
	httpServer atomic.Pointer[http.Server]
	stopOnce   sync.Once
)

// Start initializes wisper and starts the HTTP server in a background goroutine.
//
//	configDir: path for config/logs (empty = OS user config dir).
//	addr: listen address, e.g. "127.0.0.1:8900" (Android) or ":8900" (desktop).
func Start(configDir, addr string) error {
	config.Init(config.WithConfigDir(configDir))
	tunnel.LoadConfig()
	entrypoint.LoadConfig()

	statsInterval := 1
	if s := config.Get().Settings; s != nil && s.StatsInterval > 0 {
		statsInterval = s.StatsInterval
	}
	if err := runner.Exec(context.Background(), task.UpdateStats(),
		runner.WithAsync(true),
		runner.WithInterval(time.Duration(statsInterval)*time.Second),
		runner.WithCancel(true),
	); err != nil {
		slog.Error("start stats runner", "err", err)
	}

	handler := api.NewHandler(webFileServer())
	srv := &http.Server{Handler: handler}
	httpServer.Store(srv)

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	slog.Info("wisper listening", "addr", ln.Addr())

	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
		}
	}()

	return nil
}

// Stop persists state and gracefully shuts down the HTTP server.
// Safe to call multiple times; only the first call has effect.
func Stop() {
	stopOnce.Do(func() {
		slog.Info("shutting down...")
		if err := tunnel.SaveConfig(); err != nil {
				slog.Error("save tunnel config", "err", err)
			}
			if err := entrypoint.SaveConfig(); err != nil {
				slog.Error("save entrypoint config", "err", err)
			}

		if srv := httpServer.Load(); srv != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := srv.Shutdown(ctx); err != nil {
				slog.Error("shutdown server", "err", err)
			}
		}
		slog.Info("wisper stopped")
	})
}
