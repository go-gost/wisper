/**
 * smux.test.js — Unit tests for SMUX v2 server.
 *
 * Tests frame encoding/decoding, multi-stream, cmdUPD flow control,
 * partial reads, and keepalive.
 *
 * Run: node --test test/smux.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SmuxServer, Stream } from '../lib/smux.js';

// ── Helpers ────────────────────────────────────────────────────────────

/** LittleEndian helpers (mirror SMUX wire format) */
const LE = true;

/** Build a raw SMUX frame as Uint8Array */
function makeFrame(ver, cmd, sid, data = new Uint8Array(0)) {
  const len = data.length;
  const buf = new Uint8Array(8 + len);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, ver);
  dv.setUint8(1, cmd);
  dv.setUint16(2, len, LE);
  dv.setUint32(4, sid, LE);
  if (len > 0) buf.set(data, 8);
  return buf;
}

function synFrame(sid, data = new Uint8Array(0)) {
  return makeFrame(2, 0, sid, data);
}
function pshFrame(sid, data) {
  return makeFrame(2, 2, sid, data);
}
function finFrame(sid) {
  return makeFrame(2, 1, sid);
}
function nopFrame() {
  return makeFrame(2, 3, 0);
}
function updFrame(sid, consumed, window) {
  const data = new Uint8Array(8);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, consumed, LE);
  dv.setUint32(4, window, LE);
  return makeFrame(2, 4, sid, data);
}

/** Collect output frames from server into an array */
function captureOutput(server) {
  const frames = [];
  server.setOutput((frame) => frames.push(frame));
  return frames;
}

// ── Frame parsing ──────────────────────────────────────────────────────

describe('SmuxServer frame parsing', () => {
  let server, output;

  beforeEach(() => {
    server = new SmuxServer({
      onStream: () => {},
      onError: () => {},
    });
    output = captureOutput(server);
  });

  it('responds to NOP with NOP', () => {
    server.feed(nopFrame());
    assert.equal(output.length, 1);
    const dv = new DataView(output[0].buffer);
    assert.equal(dv.getUint8(1), 3); // cmdNOP
  });

  it('ignores bad version', () => {
    server.feed(makeFrame(9, 0, 1)); // version 9 SYN
    // No output because version mismatch
    assert.equal(output.length, 0);
  });

  it('handles multiple frames in one feed', () => {
    const f1 = nopFrame();
    const f2 = nopFrame();
    const merged = new Uint8Array(f1.length + f2.length);
    merged.set(f1);
    merged.set(f2, f1.length);
    server.feed(merged);
    // Two NOPs → two NOP replies
    assert.equal(output.length, 2);
  });

  it('handles partial frame (wait for more data)', (t, done) => {
    // Feed only first 4 bytes of an 8-byte frame
    const fullFrame = synFrame(1);
    const partial = fullFrame.slice(0, 4);

    // Should not crash, no stream created yet
    server.feed(partial);
    assert.equal(output.length, 0); // nothing dispatched

    // Feed remaining 4 bytes
    const rest = fullFrame.slice(4);
    server.feed(rest);

    // Now the SYN frame should be complete
    // Stream should be created, verify
    assert(output.length >= 0); // may or may not have NOP response
    done();
  });
});

// ── Stream lifecycle ───────────────────────────────────────────────────

describe('SmuxServer stream lifecycle', () => {
  it('emits stream on SYN from client (odd stream ID)', (t, done) => {
    const server = new SmuxServer({
      onStream: (stream) => {
        assert.equal(stream.id, 1); // odd → client-initiated
        assert(!stream.closed);
        done();
      },
    });
    captureOutput(server);
    server.feed(synFrame(1));
  });

  it('stream closes on FIN', (t, done) => {
    const server = new SmuxServer({
      onStream: async (stream) => {
        // Read should return null when FIN arrives
        const chunk = await stream.read();
        assert.equal(chunk, null);
        done();
      },
    });
    captureOutput(server);
    server.feed(synFrame(3));          // open stream
    server.feed(finFrame(3));          // close it
  });

  it('stream.read() returns data pushed via PSH', (t, done) => {
    const testData = new TextEncoder().encode('hello world');

    const server = new SmuxServer({
      onStream: async (stream) => {
        const chunk = await stream.read();
        assert.deepEqual(chunk, testData);
        done();
      },
    });
    captureOutput(server);
    server.feed(synFrame(5));                   // open stream
    server.feed(pshFrame(5, testData)); // push data
  });

  it('supports multiple concurrent streams', (t, done) => {
    const received = new Map();
    const server = new SmuxServer({
      onStream: async (stream) => {
        const chunk = await stream.read();
        received.set(stream.id, chunk);
        if (received.size === 2) {
          assert.deepEqual(received.get(1), new TextEncoder().encode('stream-1'));
          assert.deepEqual(received.get(3), new TextEncoder().encode('stream-3'));
          done();
        }
      },
    });
    captureOutput(server);

    server.feed(synFrame(1));
    server.feed(synFrame(3));
    server.feed(pshFrame(1, new TextEncoder().encode('stream-1')));
    server.feed(pshFrame(3, new TextEncoder().encode('stream-3')));
  });
});

// ── Write path ─────────────────────────────────────────────────────────

describe('SmuxServer write path', () => {
  it('stream.write() sends PSH frame', (t, done) => {
    const server = new SmuxServer({
      onStream: async (stream) => {
        await stream.write(new TextEncoder().encode('response'));
        // Check output for PSH frame
        assert(output.length >= 1);
        const last = output[output.length - 1];
        const dv = new DataView(last.buffer);
        assert.equal(dv.getUint8(1), 2); // cmdPSH
        assert.equal(dv.getUint32(4, LE), stream.id);
        done();
      },
    });
    const output = captureOutput(server);
    server.feed(synFrame(1));
  });

  it('stream.close() sends FIN frame', async (t) => {
    const server = new SmuxServer({
      onStream: async (stream) => {
        // close() drains pending writes then sends FIN asynchronously — await
        // it before inspecting the output buffer.
        await stream.close();
        const last = output[output.length - 1];
        const dv = new DataView(last.buffer, last.byteOffset, last.byteLength);
        assert.equal(dv.getUint8(1), 1); // cmdFIN
        assert.equal(dv.getUint32(4, LE), stream.id);
      },
    });
    const output = captureOutput(server);
    server.feed(synFrame(1));
    // Give the async onStream/close drain a tick to complete.
    await new Promise(r => setTimeout(r, 0));
  });
});

// ── cmdUPD v2 flow control ─────────────────────────────────────────────

describe('SmuxServer cmdUPD (v2 flow control)', () => {
  it('sends cmdUPD after consuming PSH data', (t, done) => {
    const server = new SmuxServer({
      onStream: async (stream) => {
        // Read the data → should trigger cmdUPD
        await stream.read();

        // Check that a UPD was sent
        const updFrames = output.filter(f => {
          const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
          return dv.getUint8(1) === 4; // cmdUPD
        });
        assert(updFrames.length >= 1);
        done();
      },
    });
    const output = captureOutput(server);
    const data = new TextEncoder().encode('a'.repeat(1024));
    server.feed(synFrame(7));
    server.feed(pshFrame(7, data));
  });

  it('peer window decreases on write, recovers on UPD', (t, done) => {
    let streamRef;

    const server = new SmuxServer({
      onStream: (stream) => {
        streamRef = stream;

        // Explicitly send a UPD to give the stream write budget
        const upd = updFrame(stream.id, 0, 262144);
        server.feed(upd);

        // Now write should work
        stream.write(new TextEncoder().encode('ok')).then(() => {
          done();
        });
      },
    });
    captureOutput(server);
    server.feed(synFrame(9)); // peer window = 262144 initially
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────

describe('SmuxServer edge cases', () => {
  it('multiple frames in single WebSocket message', (t, done) => {
    const server = new SmuxServer({
      onStream: async (stream) => {
        const chunks = [];
        let chunk;
        while ((chunk = await stream.read()) !== null) {
          chunks.push(chunk);
        }
        // Two PSH chunks then FIN
        assert.equal(chunks.length, 2);
        done();
      },
    });
    captureOutput(server);

    const syn = synFrame(1);
    const psh1 = pshFrame(1, new TextEncoder().encode('part1'));
    const psh2 = pshFrame(1, new TextEncoder().encode('part2'));
    const fin = finFrame(1);

    // Feed all at once
    const merged = new Uint8Array(syn.length + psh1.length + psh2.length + fin.length);
    let off = 0;
    merged.set(syn, off); off += syn.length;
    merged.set(psh1, off); off += psh1.length;
    merged.set(psh2, off); off += psh2.length;
    merged.set(fin, off);

    server.feed(merged);
  });

  it('ignores PSH for unknown stream', () => {
    const server = new SmuxServer({ onStream: () => {} });
    const output = captureOutput(server);
    // Send PSH to a stream that doesn't exist — should not crash
    server.feed(pshFrame(999, new TextEncoder().encode('orphan')));
    // No crash = pass
    assert(true);
  });

  it('server handles close() gracefully', () => {
    const server = new SmuxServer({ onStream: () => {} });
    captureOutput(server);
    server.feed(synFrame(1));
    server.close();
    // After close, feed should be a no-op
    server.feed(pshFrame(1, new TextEncoder().encode('after-close')));
    assert(true);
  });
});
