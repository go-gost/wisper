//go:build cgo

// lib_jni.c — JNI bridge functions (compiled once, not duplicated by cgo).
//
// These wrapper functions are in a standalone .c file rather than in the cgo
// preamble because cgo duplicates the preamble across multiple generated .c
// files when //export directives are present, causing duplicate symbol errors.
//
// The actual Go functions (wisperStartGo / wisperStopGo) are exported via
// //export in lib.go and resolved at link time.

#include <jni.h>

extern int wisperStartGo(char* configDir, char* addr);
extern void wisperStopGo();

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
