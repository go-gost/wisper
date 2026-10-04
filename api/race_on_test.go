//go:build race

package api

// raceEnabled reports whether this build has the race detector compiled in.
//
// It exists so the race probe can skip itself instead of running to no purpose.
// Everything the probe can find is a detector finding: the writes it races are
// scalar, slice and map-pointer assignments, which the runtime's own map detector
// does not catch, so without -race the probe cannot detect the thing it exists
// for — it would only spend its ~24 seconds. Measured: with the read under test
// un-locked, `go test -race` reports eight races and plain `go test` reports a
// pass.
//
// The project's gates run with -race, so nothing is lost; this only stops a
// developer running the suite without it from paying for a test that cannot fail.
const raceEnabled = true
