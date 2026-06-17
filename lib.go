//go:build cgo && android

package main

/*
#include <stdlib.h>
*/
import "C"

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

// main is required by -buildmode=c-shared; never called directly.
func main() {}
