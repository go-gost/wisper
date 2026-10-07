package tunnel

import (
	"net"
)

// shareAction is one packet's fate in the userspace fallback.
type shareAction int

const (
	// sharePass goes to the real device (virtual-network traffic, unchanged).
	sharePass shareAction = iota
	// shareToStack enters the userspace TCP/UDP stack (LAN-bound).
	shareToStack
	// shareDrop is discarded against the counter (LAN ping, malformed).
	shareDrop
)

// shareClassify decides a packet written toward the device. Only TCP and UDP
// to a shared LAN enter the stack — the stack terminates those itself, so
// anything else handed to it would only die there silently. LAN ping drops
// here, where the counter names it, instead.
func shareClassify(pkt []byte, lans []*net.IPNet) shareAction {
	var proto byte
	var dst net.IP
	switch {
	case len(pkt) >= 20 && pkt[0]>>4 == 4:
		proto = pkt[9]
		dst = net.IP(pkt[16:20])
	case len(pkt) >= 40 && pkt[0]>>4 == 6:
		proto = pkt[6]
		dst = net.IP(pkt[24:40])
	default:
		return shareDrop
	}
	for _, lan := range lans {
		if lan.Contains(dst) {
			if proto == 6 || proto == 17 {
				return shareToStack
			}
			return shareDrop
		}
	}
	return sharePass
}
