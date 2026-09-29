package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
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
//	opts: extra config.Init options, e.g. log output/level overrides.
func Start(configDir, addr string, opts ...config.Option) (err error) {
	captureCrashes(configDir)

	// A panic in here used to abort the process: this runs inside a c-shared
	// library, where the runtime cannot unwind, and on Android stderr goes
	// nowhere — so a nil dereference during startup left nothing behind but an
	// unexplained SIGABRT and an app that stayed down until Android's deferred
	// restart. Recovered, the panic is written where crash.log would have shown
	// it and returned, so the caller (the app's service) can log it and shut
	// down cleanly instead.
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("wisper: start: %v", r)
			reportCrash(configDir, "start panic", r, debug.Stack())
		}
	}()

	config.Init(append([]config.Option{config.WithConfigDir(configDir)}, opts...)...)
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

// captureCrashes points the Go runtime's crash output at a file in the config
// directory. On Android nothing else captures it: an app's stderr goes nowhere
// and the tombstone carries no abort text, so a panic or a runtime fatal error
// aborts the process — a c-shared library cannot keep running after one — and
// leaves behind nothing but an unexplained SIGABRT a second or two after start.
// Elsewhere stderr is readable and stays the destination.
func captureCrashes(configDir string) {
	if runtime.GOOS != "android" {
		return
	}
	dir := filepath.Join(configDir, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "crash.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	// Left open for the process's life on purpose: the runtime writes to it from
	// whichever goroutine is crashing, where reopening the file is not an option.
	_ = debug.SetCrashOutput(f, debug.CrashOptions{})
}

// reportCrash appends a recovered panic and its stack to the same crash.log the
// runtime writes to for a fatal one, so both kinds of startup failure land in
// one place.
func reportCrash(configDir, what string, r any, stack []byte) {
	dir := filepath.Join(configDir, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "crash.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s: %v\n%s\n", what, r, stack)
}
