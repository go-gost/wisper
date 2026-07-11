/**
 * tunnel-stats.js — per-tunnel byte counting and rate computation.
 *
 * Pure module (no chrome.* dependencies). Designed for unit testing in Node
 * with a fake stream that exposes read() / write() / close().
 *
 * Usage:
 *   import { TunnelStats } from './tunnel-stats.js';
 *   const stats = new TunnelStats();
 *   const proxy = stats.wrapStream(realStream);
 *   // use proxy in forwarder, smux, etc.
 *   // ...
 *   const snapshot = stats.sample(1);  // rates for the last 1-second interval
 */

export class TunnelStats {
  constructor() {
    this.inputBytes = 0;
    this.outputBytes = 0;
    this.totalConns = 0;
    this.currentConns = 0;
    this.requestCount = 0;

    // Baseline snapshots used by sample() to compute delta rates.
    // Initialised lazily on the first sample() call so the first interval
    // rate is always 0 (no spike from the initial baseline).
    this._lastInputBytes = null;
    this._lastOutputBytes = null;
    this._lastRequestCount = null;
    this._lastSampleTime = null;
  }

  /**
   * Mark the creation of one new request/connection.
   * Called once per SMUX stream (per onStream event).
   */
  markRequest() {
    this.requestCount++;
    this.totalConns++;
    this.currentConns++;
  }

  /**
   * Wrap a stream object's read/write/close so we count every byte.
   *
   * @param {object} stream - an object with async read(), write(bytes), close()
   * @returns {object} proxied stream — same shape, transparent pass-through
   */
  wrapStream(stream) {
    const stats = this;

    return {
      get id() { return stream.id; },
      get closed() { return stream.closed; },

      async read() {
        const chunk = await stream.read();
        if (chunk) {
          stats.inputBytes += chunk.length;
        }
        return chunk;
      },

      async write(data) {
        stats.outputBytes += data.length;
        return stream.write(data);
      },

      close() {
        stats.currentConns = Math.max(0, stats.currentConns - 1);
        return stream.close();
      },
    };
  }

  /**
   * Compute rate snapshot for the last interval.
   *
   * @param {number} intervalSec - elapsed seconds since the last sample
   * @returns {object} { inputBytes, outputBytes, totalConns, currentConns,
   *   requestCount, inputRate, outputRate, connsRate }
   *
   * The first call initialises the baseline and returns zero rates.
   * After that, each call computes (current - last) / intervalSec.
   */
  sample(intervalSec) {
    if (this._lastInputBytes === null) {
      // First sample — just set baseline, return zeros.
      this._lastInputBytes = this.inputBytes;
      this._lastOutputBytes = this.outputBytes;
      this._lastRequestCount = this.requestCount;
      this._lastSampleTime = Date.now();
      return {
        inputBytes: this.inputBytes,
        outputBytes: this.outputBytes,
        totalConns: this.totalConns,
        currentConns: this.currentConns,
        requestCount: this.requestCount,
        inputRate: 0,
        outputRate: 0,
        connsRate: 0,
      };
    }

    const inputRate = (this.inputBytes - this._lastInputBytes) / intervalSec;
    const outputRate = (this.outputBytes - this._lastOutputBytes) / intervalSec;
    const connsRate = (this.requestCount - this._lastRequestCount) / intervalSec;

    this._lastInputBytes = this.inputBytes;
    this._lastOutputBytes = this.outputBytes;
    this._lastRequestCount = this.requestCount;
    this._lastSampleTime = Date.now();

    return {
      inputBytes: this.inputBytes,
      outputBytes: this.outputBytes,
      totalConns: this.totalConns,
      currentConns: this.currentConns,
      requestCount: this.requestCount,
      inputRate,
      outputRate,
      connsRate,
    };
  }

  /** Reset all counters and baseline. */
  reset() {
    this.inputBytes = 0;
    this.outputBytes = 0;
    this.totalConns = 0;
    this.currentConns = 0;
    this.requestCount = 0;
    this._lastInputBytes = null;
    this._lastOutputBytes = null;
    this._lastRequestCount = null;
    this._lastSampleTime = null;
  }
}
