//go:build cgo && android

package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"log/slog"

	"github.com/go-gost/wisper/api"
	"github.com/go-gost/wisper/tunnel"
)

//export wisperStartGo
func wisperStartGo(configDirC *C.char, addrC *C.char) C.int {
	if err := Start(C.GoString(configDirC), C.GoString(addrC)); err != nil {
		return -1
	}
	return 0
}

//export wisperStopGo
func wisperStopGo() {
	Stop()
}

//export wisperSetTunFdGo
func wisperSetTunFdGo(fd C.int, reason *C.char) {
	// C.GoString(nil) is "", so an older caller that sends no reason logs exactly
	// as it did before the reason existed.
	tunnel.SetTunFD(int(fd), C.GoString(reason))
}

//export wisperVpnTakenGo
func wisperVpnTakenGo() {
	if name, ok := api.StopForVpnTaken(); ok {
		slog.Info("vpn taken by another app: stopped tun entrypoint", "name", name)
	}
}

// main is required by -buildmode=c-shared; never called directly.
func main() {}
