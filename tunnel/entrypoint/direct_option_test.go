package entrypoint

import (
	"bytes"
	"os"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	tp "github.com/go-gost/wisper/tunnel"
)

func TestDirectOptionRoundTrip(t *testing.T) {
	ep := NewTunEntryPoint(
		tp.IDOption("ep-direct-option"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.0.2/24"),
		tp.DirectOption(true),
	)
	if !ep.Options().Direct {
		t.Fatal("DirectOption(true) did not reach Options()")
	}
	replacement := NewTunEntryPoint(tp.TunnelOptions(ep.Options())...)
	if !replacement.Options().Direct {
		t.Fatal("TunnelOptions lost the direct flag")
	}
	_ = replacement.Close()

	t.Chdir(t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})
	Add(ep)
	t.Cleanup(func() { Delete("ep-direct-option") })

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	saved := cfg.Get().EntryPoints
	if len(saved) != 1 || !saved[0].Direct {
		t.Fatalf("persisted direct = %+v, want true", saved)
	}
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read back the config: %v", err)
	}
	if !bytes.Contains(raw, []byte("direct: true")) {
		t.Fatalf("wisper.yaml carries no direct flag:\n%s", raw)
	}

	// False is the old path and is omitted, not written as a dead field.
	off := NewTunEntryPoint(
		tp.IDOption("ep-direct-off"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.0.2/24"),
	)
	if off.Options().Direct {
		t.Fatal("direct defaulted to true")
	}
	_ = off.Close()
}
