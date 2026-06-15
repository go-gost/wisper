//go:build cgo

package main

/*
#include <jni.h>
#include <stdlib.h>

// Go functions — declared so the C JNI bridge can call them.
extern int wisperStartGo(char* configDir, char* addr);
extern void wisperStopGo();

// JNI bridge: Kotlin String → C string → Go function.
JNIEXPORT jint JNICALL
Java_run_gost_wisper_WisperJNI_start(JNIEnv *env, jclass clazz,
	jstring configDir, jstring addr) {
	const char *configDirC = (*env)->GetStringUTFChars(env, configDir, NULL);
	const char *addrC      = (*env)->GetStringUTFChars(env, addr, NULL);

	jint result = wisperStartGo((char*)configDirC, (char*)addrC);

	(*env)->ReleaseStringUTFChars(env, configDir, configDirC);
	(*env)->ReleaseStringUTFChars(env, addr, addrC);

	return result;
}

JNIEXPORT void JNICALL
Java_run_gost_wisper_WisperJNI_stop(JNIEnv *env, jclass clazz) {
	wisperStopGo();
}
*/
import "C"

// wisperStartGo bridges from C to Go. Returns 0 on success, -1 on error.
func wisperStartGo(configDirC *C.char, addrC *C.char) C.int {
	if err := Start(C.GoString(configDirC), C.GoString(addrC)); err != nil {
		return -1
	}
	return 0
}

// wisperStopGo bridges from C to Go.
func wisperStopGo() {
	Stop()
}

// main is required by -buildmode=c-shared; never called directly.
func main() {}
