//go:build !android

package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
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
	// WISPER_WEB_DIR is the flag default, same precedence as the log flags:
	// flag > env. A bare webDir is the env value, so only an explicit flag wins.
	webDir := flag.String("web-dir", os.Getenv("WISPER_WEB_DIR"), "directory of built web assets to serve instead of the embedded ones (development; serves from disk, no rebuild)")
	// WISPER_DEBUG_PPROF is the flag default, same precedence as the log flags:
	// flag > env. Off by default — the API is unauthenticated, and an open
	// /debug/pprof/profile is a way to burn a core and read process memory.
	debugPprof := flag.Bool("debug.pprof", envBool("WISPER_DEBUG_PPROF"), "serve /debug/pprof runtime profiling endpoints on the API address")
	flag.Parse()
	if *webDir != "" {
		webDirFlag = *webDir
	}
	if *debugPprof {
		debugPprofFlag = true
	}

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

// envBool reads a boolean environment variable for use as a flag default.
// An unset or unparseable value is false, so a typo in the environment leaves
// the flag off rather than silently enabling it.
func envBool(name string) bool {
	v, err := strconv.ParseBool(os.Getenv(name))
	return err == nil && v
}
