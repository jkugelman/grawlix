'use strict';

// ─── Bounded LRU cache with expiry ────────────────────────────────────────────
//
// Reads refresh recency, never expiry — lifetime runs from `set`, so a
// frequently-read stale entry still ages out instead of living forever.

export class LruCache {
  constructor(max, ttlMs) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  #live(key) {
    const cell = this.map.get(key);
    if (!cell) return null;
    if (Date.now() >= cell.expires) { this.map.delete(key); return null; }
    return cell;
  }

  has(key) { return this.#live(key) !== null; }

  get(key) {
    const cell = this.#live(key);
    if (!cell) return undefined;
    // Not a no-op: delete+set re-inserts at the back of Map order, which is what
    // makes eviction LRU rather than FIFO.
    this.map.delete(key);
    this.map.set(key, cell);
    return cell.value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  delete(key) { this.map.delete(key); }
}
