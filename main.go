package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-gost/wisper/api"
	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/runner"
	"github.com/go-gost/wisper/runner/task"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
	"github.com/go-gost/wisper/version"
)

func main() {
	addr := flag.String("addr", ":8900", "HTTP API listen address")
	showVersion := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("wisper %s\n", version.Version)
		os.Exit(0)
	}

	// Initialize config, load tunnels and entrypoints.
	config.Init()
	tunnel.LoadConfig()
	entrypoint.LoadConfig()

	// Start periodic stats update.
	statsInterval := 1
	if s := config.Get().Settings; s != nil && s.StatsInterval > 0 {
		statsInterval = s.StatsInterval
	}
	runner.Exec(context.Background(), task.UpdateStats(),
		runner.WithAsync(true),
		runner.WithInterval(time.Duration(statsInterval)*time.Second),
		runner.WithCancel(true),
	)

	// Start HTTP API server (with embedded web UI).
	handler := api.NewHandler(webFileServer())
	srv := &http.Server{Handler: handler}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		slog.Error("listen failed", "addr", *addr, "err", err)
		os.Exit(1)
	}

	slog.Info(fmt.Sprintf("wisper %s listening on %s", version.Version, ln.Addr()))

	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	// Wait for shutdown signal.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down...")

	// Persist state before exit.
	tunnel.SaveConfig()
	entrypoint.SaveConfig()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)

	slog.Info("wisper stopped")
}
