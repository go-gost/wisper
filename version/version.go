package version

// Version is the current version of Wisper. It is overridden at release build
// time via -ldflags "-X ...version.Version=<tag>" (see .goreleaser.yaml and
// .github/workflows/release.yml). The default is a dev marker so an unbuilt
// or `go run` binary is obviously not a release.
var Version = "0.0.0-dev"

// Commit is the git revision the binary was built from, stamped at build time.
// It exists because the Android build passes -buildvcs=false, so
// debug.ReadBuildInfo carries no vcs settings there: without this, a crash in
// an installed APK cannot be traced back to the source that produced it.
var Commit = ""
