package version

// Version is the current version of Wisper. It is overridden at release build
// time via -ldflags "-X ...version.Version=<tag>" (see .goreleaser.yaml and
// .github/workflows/release.yml). The default is a dev marker so an unbuilt
// or `go run` binary is obviously not a release.
var Version = "0.0.0-dev"
