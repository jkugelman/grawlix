// ─── Byte-budgeted GreedyDual-Size cache ── see docs/worker-protocol.md ──────
// The storage substrate shared by the worker's two pipeline caches — finished
// results and prefix states. It owns admission (floor + per-entry ceiling), byte
// accounting, and GreedyDual-Size eviction, and is deliberately ignorant of the
// PAYLOAD and of VALIDITY: the caller stores what it likes on the entry and proves
// freshness (corpus identity) itself. Fold validity in here and a caller that skips
// the check would serve a stale corpus's rows with nothing to catch it.
export class GdsCache {
  constructor({ minMs, maxEntryBytes, maxBytes }) {
    this.minMs = minMs;
    this.maxEntryBytes = maxEntryBytes;
    this.maxBytes = maxBytes;
    this.map = new Map();
    this.bytes = 0;
    this.clock = 0;
  }

  get size() { return this.map.size; }
  keys() { return [...this.map.keys()]; }

  configure({ minMs, maxEntryBytes, maxBytes } = {}) {
    if (minMs != null) this.minMs = minMs;
    if (maxEntryBytes != null) this.maxEntryBytes = maxEntryBytes;
    if (maxBytes != null) this.maxBytes = maxBytes;
    this.clear();
  }

  // Does NOT validate — a caller that peeks without its own freshness check serves
  // stale data silently. touch() re-bases H so a re-access ages the entry back up.
  peek(key) { return this.map.get(key) ?? null; }
  touch(entry) { entry.H = this.clock + entry.elapsed / Math.max(entry.bytes, 1); }

  // `computeBytes` is a thunk so the O(atoms) pricing is skipped for a below-floor
  // entry (the common per-keystroke case).
  admit(key, entry, elapsed, computeBytes) {
    if (elapsed < this.minMs) return false;
    const bytes = computeBytes();
    if (bytes > this.maxEntryBytes) return false;
    this.delete(key);
    this.#evict(bytes);
    entry.elapsed = elapsed;
    entry.bytes = bytes;
    // max(bytes,1) floors the denominator so a 0-byte entry can't mint an Infinity H
    // that makes it un-evictable; byte accounting keeps the true 0.
    entry.H = this.clock + elapsed / Math.max(bytes, 1);
    this.map.set(key, entry);
    this.bytes += bytes;
    return true;
  }

  delete(key) {
    const e = this.map.get(key);
    if (!e) return;
    this.bytes -= e.bytes;
    this.map.delete(key);
  }

  purge(pred) { for (const [k, e] of this.map) if (pred(e)) this.delete(k); }

  clear() { this.map.clear(); this.bytes = 0; this.clock = 0; }

  // Advancing the clock to each victim's H is what ages a never-revisited entry down
  // over time (a re-access re-bases it via touch()).
  #evict(incoming) {
    while (this.bytes + incoming > this.maxBytes && this.map.size > 0) {
      let victim = null, minH = Infinity;
      for (const [k, e] of this.map) if (e.H < minH) { minH = e.H; victim = k; }
      if (victim === null) break;
      this.clock = minH;
      this.delete(victim);
    }
  }
}
