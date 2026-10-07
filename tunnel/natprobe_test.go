package tunnel

import (
	"testing"
)

// RED 6: ip_forward file content parses to a bool; garbage never enables.
func TestParseIPForward(t *testing.T) {
	if !parseIPForward([]byte("1\n")) {
		t.Fatal(`parseIPForward("1") = false, want true`)
	}
	if parseIPForward([]byte("0\n")) {
		t.Fatal(`parseIPForward("0") = true, want false`)
	}
	if parseIPForward([]byte("yes\n")) {
		t.Fatal(`parseIPForward("yes") = true, want false (garbage never enables)`)
	}
	if parseIPForward(nil) {
		t.Fatal("parseIPForward(nil) = true, want false")
	}
}
