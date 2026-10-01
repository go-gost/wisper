package tunnel

import (
	"errors"
	"fmt"
	"net"
	"testing"

	"github.com/go-gost/core/listener"
)

// TestCleanStop pins the classification a deliberate stop depends on: the
// listener's sentinel arrives wrapped (the tun entrypoint's serve error is
// wrapped once more by the service), and anything else must stay a failure — a
// real read error ending a tunnel is still a failure.
func TestCleanStop(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, true},
		{"the listener's sentinel", listener.ErrClosed, true},
		{"the sentinel, wrapped", fmt.Errorf("tun entrypoint serve: %w", listener.ErrClosed), true},
		{"net.ErrClosed", net.ErrClosed, true},
		{"a real failure", errors.New("read: connection reset by peer"), false},
		{"a wrapped real failure", fmt.Errorf("serve: %w", errors.New("accept: too many open files")), false},
	}
	for _, c := range cases {
		if got := CleanStop(c.err); got != c.want {
			t.Errorf("%s: CleanStop(%v) = %v, want %v", c.name, c.err, got, c.want)
		}
	}
}
