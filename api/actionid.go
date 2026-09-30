package api

import (
	"crypto/rand"
	"encoding/hex"
)

// actionHeader is the header a UI action carries so its backend log line can be
// joined with the click that caused it. It is a label and never auth: nothing
// reads it for a decision, and the value only ever reaches a log field (and the
// p2p seam, which treats it the same way).
const actionHeader = "Wisper-Id"

// newActionID returns a fresh short id for a request that arrived without one,
// so a curl, the CLI, or an older bundle is still correlatable. Four random
// bytes are enough for the id's only job — telling two requests apart in one
// log tail — and it is not a secret, so crypto/rand is convenience, not policy.
func newActionID() string {
	var b [4]byte
	_, _ = rand.Read(b[:]) // crypto/rand.Read never fails on a supported platform
	return hex.EncodeToString(b[:])
}
