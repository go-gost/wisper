//go:build cgo && android

package main

/*
#include <stdlib.h>
*/
import "C"

import "github.com/go-gost/wisper/tunnel"

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
func wisperSetTunFdGo(fd C.int) {
	tunnel.SetTunFD(int(fd))
}

// main is required by -buildmode=c-shared; never called directly.
func main() {}
