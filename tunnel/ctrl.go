package tunnel

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

// ControlMagic opens a control stream. Four bytes: 'W' is 0x57, high nibble
// 5, and an IP packet's version nibble is 4 or 6 — so no device stream can
// begin with it. 'GOST' is NOT available: it is the keepalive registration
// frame's magic (x/handler/tun/client.go:27), which is the first frame on
// every tun stream (client.go:71 runs the handshake before transportClient),
// and 'G' is 0x47 — high nibble 4, a legal IPv4 header start.
var ControlMagic = []byte("WISP")

// maxFrame caps one message body. A spoke that sends a larger length is
// refused before its body is read.
const maxFrame = 64 << 10

// message types and the only version this build speaks. A peer that sends
// anything else gets an error, not a misparse.
const (
	ctrlTypeNetview = "netview"
	ctrlTypeClaim   = "claim"
	ctrlVersion     = 1
)

type netviewMessage struct {
	Type    string        `json:"type"` // "netview"
	V       int           `json:"v"`    // 1
	Hub     string        `json:"hub"`
	Rev     uint64        `json:"rev"`
	Members []memberEntry `json:"members"`
	Claims  []claimEntry  `json:"claims"`
}

type memberEntry struct {
	IP  string `json:"ip"`  // the member's tun address, "10.10.100.5"
	Key string `json:"key"` // its peer key
}

type claimEntry struct {
	Prefix string   `json:"prefix"` // "192.168.50.0/24"
	Origin string   `json:"origin"` // claiming peer key
	Allow  []string `json:"allow"`  // empty = every member
}

type claimMessage struct {
	Type string   `json:"type"` // "claim"
	V    int      `json:"v"`    // 1
	Add  []string `json:"add"`
	Drop []string `json:"drop"`
}

// writeMessage frames one message: 4-byte big-endian length then the JSON.
func writeMessage(w io.Writer, m any) error {
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	if len(body) > maxFrame {
		return fmt.Errorf("control message of %d bytes exceeds the %d byte limit", len(body), maxFrame)
	}
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], uint32(len(body)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	_, err = w.Write(body)
	return err
}

// readMessage reads one framed message. An unknown type, a version above 1,
// or an oversize length is an error the caller turns into "drop the frame,
// keep the stream" — forward-compat, the same rule derpclient applies
// (p2p/internal/derpclient/derpclient.go:16). It returns both structs because
// a caller reading a mixed stream does not know which is coming; exactly one
// is non-zero.
func readMessage(r io.Reader) (netviewMessage, claimMessage, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return netviewMessage{}, claimMessage{}, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > maxFrame {
		return netviewMessage{}, claimMessage{}, fmt.Errorf("control frame of %d bytes exceeds the %d byte limit", n, maxFrame)
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return netviewMessage{}, claimMessage{}, err
	}

	// Peek the type first so a frame is decoded into the one struct it is,
	// leaving the other zero: "type" is a fixed field in both, so an
	// unrecognised one is a forward-compat drop, not a partial decode.
	var head struct {
		Type string `json:"type"`
		V    int    `json:"v"`
	}
	if err := json.Unmarshal(body, &head); err != nil {
		return netviewMessage{}, claimMessage{}, err
	}
	if head.V != ctrlVersion { // only v1 speaks; an absent (v0) version is dropped too
		return netviewMessage{}, claimMessage{}, fmt.Errorf("unsupported control message version %d", head.V)
	}
	switch head.Type {
	case ctrlTypeNetview:
		var m netviewMessage
		if err := json.Unmarshal(body, &m); err != nil {
			return netviewMessage{}, claimMessage{}, err
		}
		return m, claimMessage{}, nil
	case ctrlTypeClaim:
		var m claimMessage
		if err := json.Unmarshal(body, &m); err != nil {
			return netviewMessage{}, claimMessage{}, err
		}
		return netviewMessage{}, m, nil
	default:
		return netviewMessage{}, claimMessage{}, fmt.Errorf("unknown control message type %q", head.Type)
	}
}
