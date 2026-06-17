//go:build !android

package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

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

	if err := Start("", *addr); err != nil {
		slog.Error("start failed", "addr", *addr, "err", err)
		os.Exit(1)
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	Stop()
}
