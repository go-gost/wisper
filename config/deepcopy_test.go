package config

import (
	"testing"
	"time"

	"github.com/go-gost/wisper/event"
)

// deepCopyConfig must not leave two Config copies sharing an events backing
// array. Every caller of Get() mutates what it gets and writes it back through
// SaveConfig, so a shared array means one copy silently rewrites another's
// history.
func TestDeepCopyIsolatesEvents(t *testing.T) {
	orig := &Config{
		Tunnels: []*Tunnel{{
			ID:     "t1",
			Events: []event.Event{{Time: time.Now(), Level: event.LevelInfo, Message: "first"}},
		}},
		Events: []event.Event{{Time: time.Now(), Level: event.LevelInfo, Message: "global"}},
	}

	cp := deepCopyConfig(orig)
	cp.Tunnels[0].Events[0].Message = "changed"
	cp.Events[0].Message = "changed"

	if got := orig.Tunnels[0].Events[0].Message; got != "first" {
		t.Errorf("per-object events leaked between copies: %q", got)
	}
	if got := orig.Events[0].Message; got != "global" {
		t.Errorf("global events leaked between copies: %q", got)
	}
}
