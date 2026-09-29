//go:build p2ppoc

// Throwaway probe for the event-history design: sample P2PHostStatus() once a
// second to see whether the signals the design wants to diff are observable,
// and what they do when the relay dies and comes back.
//
// Run: CGO_ENABLED=1 go test -tags p2ppoc -run TestProbeEventSignals -v ./tunnel/
package tunnel_test

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-gost/p2p"
	"github.com/go-gost/p2p/endpoint"
	cfg "github.com/go-gost/wisper/config"
	wtunnel "github.com/go-gost/wisper/tunnel"
)

func TestProbeEventSignals(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startEchoServer(t)

	bin := derperBin(t)
	dir := t.TempDir()
	certDir := filepath.Join(dir, "certs")
	writeSelfSignedCert(t, certDir, "127.0.0.1")
	addr := fmt.Sprintf("127.0.0.1:%d", freePort(t))
	stunPort := freeUDPPort(t)
	derpURL := fmt.Sprintf("wss://%s/derp", addr)
	stun := fmt.Sprintf("127.0.0.1:%d", stunPort)

	// Own launcher rather than startDerperSTUN: this probe kills the relay
	// mid-run to watch what the gauges do without it.
	start := func() *exec.Cmd {
		logf, err := os.Create(filepath.Join(dir, "derper.log"))
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(bin,
			"-c", filepath.Join(dir, "derper.json"),
			"-hostname", "127.0.0.1",
			"-certmode", "manual",
			"-certdir", certDir,
			"-a", addr,
			"-http-port", "-1",
			fmt.Sprintf("-stun-port=%d", stunPort),
		)
		cmd.Stdout, cmd.Stderr = logf, logf
		if err := cmd.Start(); err != nil {
			t.Fatalf("start derper: %v", err)
		}
		deadline := time.Now().Add(25 * time.Second)
		for {
			c, err := net.DialTimeout("tcp", addr, time.Second)
			if err == nil {
				c.Close()
				return cmd
			}
			if time.Now().After(deadline) {
				t.Fatal("derper never listened")
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
	stop := func(cmd *exec.Cmd) {
		if cmd == nil {
			return
		}
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}

	derp := start()
	t.Cleanup(func() { stop(derp) })

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derpURL, Secure: &secure, Stun: stun},
	}})

	direct := true
	peer, err := endpoint.New(&p2p.Config{
		Derp: derpURL, KeyHex: strings.Repeat("45", 32), Stun: stun,
		Direct: &direct, TLS: &p2p.TLSConfig{Secure: &secure},
	})
	if err != nil {
		t.Fatalf("peer host: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.Connect(); err != nil {
		t.Fatalf("peer connect: %v", err)
	}

	runTunnel(t, "probe", echo, peer.PublicKey())
	hostKey := wtunnel.P2PHostPublicKey()
	registerProvider(t, "probe-peer", peer)

	peers := func(st p2p.Status) string {
		out := make([]string, 0, len(st.PeerTransports))
		for k, v := range st.PeerTransports {
			out = append(out, fmt.Sprintf("%s=%s", k[:8], v))
		}
		sort.Strings(out)
		return strings.Join(out, ",")
	}
	sample := func(label string) {
		st := wtunnel.P2PHostStatus()
		var punches []string
		for k, v := range st.PeerPunches {
			punches = append(punches, fmt.Sprintf("%s=%+v", k[:8], v))
		}
		sort.Strings(punches)
		t.Logf("%-24s running=%v relay=%v err=%q peers=[%s] punches=[%s] direct=%d derp=%d punch=%d/%d streams=%d/%d",
			label, wtunnel.P2PHostRunning(), st.RelayConnected, st.RelayError,
			peers(st), strings.Join(punches, ","),
			st.DirectPeers, st.DerpPeers, st.PunchSuccess, st.PunchAttempts,
			st.StreamsDirect, st.StreamsDerp)
	}

	t.Logf("--- phase 1: live relay, no traffic (does anything move?)")
	for i := 0; i < 6; i++ {
		sample(fmt.Sprintf("phase1 t=%ds", i))
		time.Sleep(time.Second)
	}

	t.Logf("--- phase 2: one stream through the tunnel")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if conn, err := dialHost(t, ctx, "probe-peer", hostKey); err != nil {
		t.Logf("dial: %v", err)
	} else {
		_, _ = conn.Write([]byte("probe"))
		buf := make([]byte, 5)
		_, _ = io.ReadFull(conn, buf)
		conn.Close()
	}
	for i := 0; i < 4; i++ {
		sample(fmt.Sprintf("phase2 t=%ds", i))
		time.Sleep(time.Second)
	}

	t.Logf("--- phase 3: relay killed (does the peer leave the map?)")
	stop(derp)
	derp = nil
	for i := 0; i < 12; i++ {
		sample(fmt.Sprintf("phase3 down t=%ds", i))
		time.Sleep(time.Second)
	}

	t.Logf("--- phase 4: relay back (does the peer return?)")
	derp = start()
	for i := 0; i < 15; i++ {
		sample(fmt.Sprintf("phase4 up t=%ds", i))
		time.Sleep(time.Second)
	}
}
