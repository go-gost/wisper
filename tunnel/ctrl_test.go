package tunnel

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestMessageRoundTrip(t *testing.T) {
	want := netviewMessage{Type: "netview", V: 1, Hub: "hub1", Rev: 3,
		Members: []memberEntry{{IP: "10.10.100.5", Key: "k1"}},
		Claims:  []claimEntry{{Prefix: "192.168.50.0/24", Origin: "k2"}},
	}
	var buf bytes.Buffer
	if err := writeMessage(&buf, want); err != nil {
		t.Fatal(err)
	}
	got, claim, err := readMessage(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Type != "" {
		t.Fatalf("a netview also decoded a claim: %+v", claim)
	}
	if got.Rev != want.Rev || got.Hub != want.Hub || len(got.Members) != 1 ||
		len(got.Claims) != 1 || got.Claims[0].Prefix != "192.168.50.0/24" {
		t.Fatalf("round trip changed the message: %+v", got)
	}
}

func TestReadMessageRefusesBadInput(t *testing.T) {
	// An oversize length: refused before its body is read, so a hostile
	// spoke cannot make the hub allocate.
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], maxFrame+1)
	if _, _, err := readMessage(bytes.NewReader(hdr[:])); err == nil {
		t.Fatal("an oversize frame must be refused")
	}

	// A version we do not speak: an error the caller drops, not a panic.
	body := []byte(`{"type":"netview","v":99,"hub":"h","rev":1}`)
	binary.BigEndian.PutUint32(hdr[:], uint32(len(body)))
	if _, _, err := readMessage(bytes.NewReader(append(hdr[:], body...))); err == nil {
		t.Fatal("an unknown version must be refused")
	}

	// An unknown type: same rule.
	body = []byte(`{"type":"somethingelse","v":1}`)
	binary.BigEndian.PutUint32(hdr[:], uint32(len(body)))
	if _, _, err := readMessage(bytes.NewReader(append(hdr[:], body...))); err == nil {
		t.Fatal("an unknown type must be refused")
	}
}
