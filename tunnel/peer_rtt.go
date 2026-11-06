package tunnel

import "github.com/go-gost/p2p"

// PeerRTT is one peer's measured round-trip time, read from whichever data
// plane carries it: KCP's session SRTT or QUIC's connection RTT. RTO and
// RTTVar are KCP-only; QUIC leaves them zero. KCP says which plane the numbers
// came from, so a caller can keep the KCP-only wire fields absent for QUIC.
//
// It is the single mapping point for the p2p host's diagnostics: the API's
// peer rows and the tun spoke's local peer list both read the same numbers
// here, rather than each deciding which transport to ask.
type PeerRTT struct {
	RTTMs    int64
	RTOMs    int64
	RTTVarMs int64
	Live     bool
	KCP      bool
}

// PeerRTTFor returns one peer's transport RTT from the host diagnostic map. A
// missing peer or dead session reads as zero, which the UI hides. KCP is the
// default when the diagnostic carries no transport word (an older p2p host);
// QUIC is read from its own connection stats, never from a stale relay KCP
// session.
func PeerRTTFor(diags map[string]p2p.PeerDiagnostic, peer string) PeerRTT {
	if peer == "" {
		return PeerRTT{}
	}
	d := diags[peer]
	if d.Transport == "quic" {
		if d.QUIC == nil {
			return PeerRTT{}
		}
		// Round to whole milliseconds but never to zero for a measured
		// sub-millisecond LAN round trip: the wire treats zero as "not
		// measured", and a live direct link must not disappear from the row.
		rttMs := d.QUIC.RTT.Milliseconds()
		if rttMs == 0 && d.QUIC.RTT > 0 {
			rttMs = 1
		}
		return PeerRTT{
			RTTMs: rttMs,
			Live:  d.QUIC.Live,
		}
	}
	k := d.RelayKCP
	return PeerRTT{
		RTTMs:    k.SRTT,
		RTOMs:    k.RTO,
		RTTVarMs: k.RTTVar,
		Live:     k.Live,
		KCP:      true,
	}
}

// KcpSRTT is the KCP-plane wire value: the measured RTT for a KCP peer, zero
// (and therefore absent) for QUIC, whose number rides the generic field only.
func (r PeerRTT) KcpSRTT() int64 {
	if !r.KCP {
		return 0
	}
	return r.RTTMs
}

// KcpLive is the KCP-only display gate, false for QUIC even when QUIC's own
// connection is live.
func (r PeerRTT) KcpLive() bool {
	return r.KCP && r.Live
}
