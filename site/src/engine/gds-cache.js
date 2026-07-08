// ─── Byte-budgeted GreedyDual-Size cache ── see docs/worker-protocol.md ──────
// A single storage substrate shared by the worker's three pipeline roles — finished
// results, prefix states, and partial (superseded) joins. `GdsCache` is the POOL: it
// owns ONE byte budget, ONE GreedyDual-Size eviction order, and the byte accounting,
// and is deliberately ignorant of ADMISSION (worthiness) and of VALIDITY: a `RoleCache`
// decides what's worth storing and the caller proves freshness (corpus identity) itself.
// Fold either in here and a caller that skips the check would serve a stale corpus's rows
// with nothing to catch it. The three roles share the pool so they evict against ONE
// budget by global H, instead of each hoarding a private allowance.
export class GdsCache {
  constructor({ maxBytes }) {
    this.maxBytes = maxBytes;
    this.map = new Map();
    this.bytes = 0;
    this.clock = 0;
  }

  get size() { return this.map.size; }
  keys() { return [...this.map.keys()]; }

  configure({ maxBytes } = {}) {
    if (maxBytes != null) this.maxBytes = maxBytes;
    this.clear();
  }

  // Does NOT validate — a caller that peeks without its own freshness check serves
  // stale data silently. touch() re-bases H so a re-access ages the entry back up.
  peek(key) { return this.map.get(key) ?? null; }
  touch(entry) { entry.H = this.clock + entry.elapsed / Math.max(entry.bytes, 1); }

  insert(key, entry, elapsed, bytes) {
    this.delete(key);
    this.#evict(bytes);
    entry.elapsed = elapsed;
    entry.bytes = bytes;
    // max(bytes,1) floors the denominator so a 0-byte entry can't mint an Infinity H
    // that makes it un-evictable; byte accounting keeps the true 0.
    entry.H = this.clock + elapsed / Math.max(bytes, 1);
    this.map.set(key, entry);
    this.bytes += bytes;
  }

  delete(key) {
    const e = this.map.get(key);
    if (!e) return;
    this.bytes -= e.bytes;
    this.map.delete(key);
  }

  purge(pred) { for (const [k, e] of this.map) if (pred(e)) this.delete(k); }
  purgeKeys(pred) { for (const k of this.map.keys()) if (pred(k)) this.delete(k); }

  clear() { this.map.clear(); this.bytes = 0; this.clock = 0; }

  // Advancing the clock to each victim's H is what ages a never-revisited entry down
  // over time (a re-access re-bases it via touch()). Stops at an empty map, so a lone
  // entry larger than the whole budget is admitted rather than refused — the ceiling
  // that guards against that is RoleCache's, not the pool's.
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

// ─── Role-scoped view over a shared GdsCache pool ─────────────────────────────
// One per pipeline role (finished / prefix / partial). It owns the ADMISSION policy —
// the recompute-time floor and the per-entry byte ceiling — and namespaces its keys with
// a role tag so the three roles coexist in the one pool without colliding. Storage, the
// byte budget, and eviction are the pool's: admitting a finished result can evict a prefix
// tile and vice versa, which is the point of sharing. Admission params are per-role (only
// tests diverge them — production gives all three the same floor/ceiling); the budget is
// the pool's and therefore shared.
export class RoleCache {
  constructor(pool, role, { minMs, maxEntryBytes }) {
    this.pool = pool;
    this.role = role;
    this.prefix = role + '\0';
    this.minMs = minMs;
    this.maxEntryBytes = maxEntryBytes;
  }

  #key(key) { return this.prefix + key; }
  #mine(key) { return key.startsWith(this.prefix); }

  peek(key) { return this.pool.peek(this.#key(key)); }
  delete(key) { this.pool.delete(this.#key(key)); }
  touch(entry) { this.pool.touch(entry); }

  // `computeBytes` is a thunk so the O(atoms) pricing is skipped for a below-floor
  // entry (the common per-keystroke case).
  admit(key, entry, elapsed, computeBytes) {
    if (elapsed < this.minMs) return false;
    const bytes = computeBytes();
    if (bytes > this.maxEntryBytes) return false;
    this.pool.insert(this.#key(key), entry, elapsed, bytes);
    return true;
  }

  // maxBytes is the shared pool budget (setting it via any role reconfigures the pool);
  // clearing drops only this role's entries so reconfiguring one role can't wipe another's.
  configure({ minMs, maxEntryBytes, maxBytes } = {}) {
    if (minMs != null) this.minMs = minMs;
    if (maxEntryBytes != null) this.maxEntryBytes = maxEntryBytes;
    if (maxBytes != null) this.pool.maxBytes = maxBytes;
    this.clear();
  }

  clear() { this.pool.purgeKeys(k => this.#mine(k)); }

  // Role-scoped introspection (test-only): filter the shared pool by role tag.
  keys() { return this.pool.keys().filter(k => this.#mine(k)); }
  get size() { return this.keys().length; }
  get bytes() { return this.keys().reduce((b, k) => b + (this.pool.peek(k)?.bytes ?? 0), 0); }
}
