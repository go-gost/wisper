package tunnel

import (
	"strings"
	"testing"
)

type fakeRunner struct {
	cmds []string
	err  error
}

func (f *fakeRunner) run(name string, args ...string) error {
	if f.err != nil {
		return f.err
	}
	f.cmds = append(f.cmds, name+" "+strings.Join(args, " "))
	return nil
}

// RED 5: setup wires mode decision to rule application; cleanup mirrors apply.
func TestSetupShareLANKernel(t *testing.T) {
	f := &fakeRunner{}
	eff, down, cleanup, err := setupShareLAN("10.10.0.0/24", "192.168.1.0/24", ShareAuto, true, f.run)
	if err != nil || eff != ShareKernel || down || cleanup == nil {
		t.Fatalf("setup = (%q,%v,%v,%v), want (kernel,false,non-nil,nil)", eff, down, cleanup != nil, err)
	}
	if len(f.cmds) == 0 {
		t.Fatal("setup applied no commands, want MASQUERADE + FORWARD")
	}
	sawMASQ := false
	for _, c := range f.cmds {
		if strings.Contains(c, "MASQUERADE") {
			sawMASQ = true
		}
		if strings.Contains(c, " -D ") {
			t.Fatalf("apply issued a delete %q, want only -A", c)
		}
	}
	if !sawMASQ {
		t.Fatalf("applied commands miss MASQUERADE: %v", f.cmds)
	}

	applied := len(f.cmds)
	cleanup()
	if len(f.cmds) != 2*applied {
		t.Fatalf("cleanup added %d commands, want %d (mirror of apply)", len(f.cmds)-applied, applied)
	}
	for _, c := range f.cmds[applied:] {
		if !strings.Contains(c, " -D ") {
			t.Fatalf("cleanup issued %q, want only -D", c)
		}
	}
}

func TestSetupShareLANFallback(t *testing.T) {
	f := &fakeRunner{}
	eff, down, cleanup, err := setupShareLAN("10.10.0.0/24", "192.168.1.0/24", ShareAuto, false, f.run)
	if err != nil || eff != ShareUserspace || !down || cleanup != nil {
		t.Fatalf("setup = (%q,%v,%v,%v), want (userspace,true,nil,nil)", eff, down, cleanup != nil, err)
	}
	if len(f.cmds) != 0 {
		t.Fatalf("fallback ran %v, want no kernel commands", f.cmds)
	}
}

func TestSetupShareLANKernelPinnedFails(t *testing.T) {
	f := &fakeRunner{}
	if _, _, _, err := setupShareLAN("10.10.0.0/24", "192.168.1.0/24", ShareKernel, false, f.run); err == nil {
		t.Fatal("pinned kernel without kernel path = nil error, want start failure")
	}
	if len(f.cmds) != 0 {
		t.Fatalf("failed setup ran %v, want nothing applied", f.cmds)
	}
}

func TestSetupShareLANDisabled(t *testing.T) {
	f := &fakeRunner{}
	eff, down, cleanup, err := setupShareLAN("10.10.0.0/24", "", ShareAuto, true, f.run)
	if err != nil || eff != "" || down || cleanup != nil {
		t.Fatalf("setup = (%q,%v,%v,%v), want (\"\",false,nil,nil)", eff, down, cleanup != nil, err)
	}
}
