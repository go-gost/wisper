//go:build !android

package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/version"
)

func main() {
	addr := flag.String("addr", ":8900", "HTTP API listen address")
	// WISPER_LOG_OUTPUT/WISPER_LOG_LEVEL are the flag defaults, so precedence is
	// flag > env > config file.
	logOutput := flag.String("log.output", os.Getenv("WISPER_LOG_OUTPUT"), "log output: stderr, stdout, none, or a file path (default: config file)")
	logLevel := flag.String("log.level", os.Getenv("WISPER_LOG_LEVEL"), "log level: debug, info, warn, error (default: config file)")
	showVersion := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("wisper %s\n", version.Version)
		os.Exit(0)
	}

	if err := Start("", *addr,
		config.WithLogOutput(*logOutput),
		config.WithLogLevel(*logLevel),
	); err != nil {
		slog.Error("start failed", "addr", *addr, "err", err)
		os.Exit(1)
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	Stop()
}
