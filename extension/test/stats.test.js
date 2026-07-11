import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TunnelStats } from '../lib/tunnel-stats.js';

/** A minimal fake stream that records writes and returns canned reads. */
function fakeStream(opts = {}) {
  const reads = opts.reads || [];
  const readDelay = opts.readDelay || 0;
  let ri = 0;
  const writes = [];
  let closed = false;

  return {
    id: opts.id ?? 1,
    get closed() { return closed; },

    async read() {
      if (readDelay) await new Promise(r => setTimeout(r, readDelay));
      if (ri >= reads.length) return null;
      return reads[ri++];
    },

    async write(data) {
      writes.push(data);
    },

    close() {
      closed = true;
    },

    // Test helpers
    _writes() { return writes; },
  };
}

describe('TunnelStats', () => {
  it('wrapping a stream counts read bytes as input', async () => {
    const stats = new TunnelStats();
    const s = fakeStream({ reads: [
      new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]),         // 5 bytes
      new Uint8Array([0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]),   // 6 bytes
    ]});
    const proxy = stats.wrapStream(s);

    const a = await proxy.read();
    const b = await proxy.read();
    const c = await proxy.read(); // null

    assert.equal(a.length, 5);
    assert.equal(b.length, 6);
    assert.equal(c, null);
    assert.equal(stats.inputBytes, 11);
    assert.equal(stats.outputBytes, 0);
  });

  it('wrapping a stream counts written bytes as output', async () => {
    const stats = new TunnelStats();
    const s = fakeStream();
    const proxy = stats.wrapStream(s);

    await proxy.write(new Uint8Array([0x48, 0x65]));           // 2
    await proxy.write(new Uint8Array(3));                        // 3
    await proxy.write(new Uint8Array(0));                        // 0

    assert.equal(stats.outputBytes, 5);
    assert.equal(stats.inputBytes, 0);
  });

  it('wrapping counts both directions simultaneously', async () => {
    const stats = new TunnelStats();
    const s = fakeStream({ reads: [new Uint8Array(7)] });
    const proxy = stats.wrapStream(s);

    await proxy.read();   // input += 7
    await proxy.write(new Uint8Array(4)); // output += 4

    assert.equal(stats.inputBytes, 7);
    assert.equal(stats.outputBytes, 4);
  });

  it('markRequest increments totalConns and currentConns', () => {
    const stats = new TunnelStats();
    assert.equal(stats.totalConns, 0);
    assert.equal(stats.currentConns, 0);

    stats.markRequest();
    assert.equal(stats.totalConns, 1);
    assert.equal(stats.currentConns, 1);

    stats.markRequest();
    assert.equal(stats.totalConns, 2);
    assert.equal(stats.currentConns, 2);
  });

  it('close decrements currentConns', async () => {
    const stats = new TunnelStats();
    stats.markRequest(); // currentConns=1

    const s = fakeStream();
    const proxy = stats.wrapStream(s);
    await proxy.close();

    assert.equal(stats.currentConns, 0);
    assert.equal(stats.totalConns, 1);
  });

  it('currentConns is clamped to 0 on double close', async () => {
    const stats = new TunnelStats();
    const s = fakeStream();
    const proxy = stats.wrapStream(s);

    await proxy.close();
    await proxy.close();

    assert.equal(stats.currentConns, 0);
  });

  it('first sample returns zero rates and sets baseline', () => {
    const stats = new TunnelStats();
    stats.inputBytes = 100;
    stats.outputBytes = 200;

    const snap = stats.sample(1);

    assert.equal(snap.inputRate, 0);
    assert.equal(snap.outputRate, 0);
    assert.equal(snap.inputBytes, 100);
    assert.equal(snap.outputBytes, 200);
  });

  it('second sample computes rates from the baseline', () => {
    const stats = new TunnelStats();
    stats.inputBytes = 100;
    stats.outputBytes = 200;
    stats.markRequest();

    // First sample — sets baseline
    stats.sample(1);

    // Advance counters
    stats.inputBytes = 160;
    stats.outputBytes = 280;
    stats.markRequest();

    const snap = stats.sample(1);  // 1s interval

    assert.equal(snap.inputRate, 60);   // 160-100
    assert.equal(snap.outputRate, 80);  // 280-200
    assert.equal(snap.inputBytes, 160);
    assert.equal(snap.outputBytes, 280);
  });

  it('sample with non-1 interval scales rates correctly', () => {
    const stats = new TunnelStats();
    stats.inputBytes = 0;
    stats.sample(1); // baseline

    stats.inputBytes = 200;
    const snap = stats.sample(2); // 200 bytes / 2s = 100

    assert.equal(snap.inputRate, 100);
  });

  it('reset clears all counters and baseline', () => {
    const stats = new TunnelStats();
    stats.inputBytes = 50;
    stats.outputBytes = 60;
    stats.totalConns = 3;
    stats.currentConns = 2;
    stats.requestCount = 5;
    stats.sample(1); // set baseline
    stats.inputBytes = 70;
    stats.outputBytes = 80;

    stats.reset();

    assert.equal(stats.inputBytes, 0);
    assert.equal(stats.outputBytes, 0);
    assert.equal(stats.totalConns, 0);
    assert.equal(stats.currentConns, 0);
    assert.equal(stats.requestCount, 0);

    // After reset, first sample should return zero rates
    const snap = stats.sample(1);
    assert.equal(snap.inputRate, 0);
    assert.equal(snap.outputRate, 0);
  });

  it('wraps stream.id and stream.closed transparently', () => {
    const stats = new TunnelStats();
    const s = fakeStream({ id: 42 });
    const proxy = stats.wrapStream(s);

    assert.equal(proxy.id, 42);
    assert.equal(proxy.closed, false);
  });
});
