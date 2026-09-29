package tunnel

import (
	"os"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"gopkg.in/yaml.v3"
)

// A round trip through the config file is what makes history survive a
// restart, so both halves are asserted: SaveConfig writes the store into the
// config, LoadConfig seeds the store back from it.
//
// It uses chdir rather than config.Init: Init sets the package-global config
// directory that Write reads, and a test that left it set would point every
// later test's Write at its own (by then deleted) temp dir — the same reason
// TestSaveConfigKeepsPeers chdirs and leaves the global empty.
func TestEventHistoryPersists(t *testing.T) {
	t.Chdir(t.TempDir()) // empty global config dir: SaveConfig writes ./wisper.yaml
	cfg.Set(&cfg.Config{})

	tun := NewTCPTunnel(
		NameOption("round trip"),
		EndpointOption("127.0.0.1:0"),
	)
	tun.Close() // closed: nothing is started, so the test needs no network
	Add(tun)
	id := tun.ID()
	t.Cleanup(func() {
		Delete(id)
		event.Seed(id, nil)
	})

	event.Record(id, event.LevelWarn, "service failed: dial tcp: timeout")
	event.Global(event.LevelInfo, "p2p host started")

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	// The file itself must hold both lists: that is what survives a restart.
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	var onDisk cfg.Config
	if err := yaml.Unmarshal(raw, &onDisk); err != nil {
		t.Fatalf("parse config: %v", err)
	}

	var persisted *cfg.Tunnel
	for _, tc := range onDisk.Tunnels {
		if tc != nil && tc.ID == id {
			persisted = tc
		}
	}
	if persisted == nil {
		t.Fatalf("tunnel %s missing from the config file", id)
	}
	if len(persisted.Events) != 1 || persisted.Events[0].Message != "service failed: dial tcp: timeout" {
		t.Fatalf("tunnel events not persisted: %+v", persisted.Events)
	}
	if len(onDisk.Events) != 1 || onDisk.Events[0].Message != "p2p host started" {
		t.Fatalf("global events not persisted: %+v", onDisk.Events)
	}

	// The delete handler forgets the object's history (Delete itself keeps it —
	// the update path reuses Delete); removing the object here makes LoadConfig
	// re-add it. LoadConfig must seed the history back from what was persisted.
	// LoadConfig reads the in-memory config, which the SaveConfig above has
	// already replaced.
	Delete(id)
	event.Seed(id, nil)
	if n := len(event.List(id)); n != 0 {
		t.Fatalf("history not forgotten: %d events left", n)
	}
	LoadConfig()

	if got := event.List(id); len(got) != 1 || got[0].Message != "service failed: dial tcp: timeout" {
		t.Errorf("LoadConfig did not seed the tunnel history: %+v", got)
	}
}
