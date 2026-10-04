//go:build !race

package api

// raceEnabled reports whether this build has the race detector compiled in. This
// is the half of the pair that makes the probe skip itself: see race_on_test.go
// for why the probe cannot do its job without the detector.
const raceEnabled = false
