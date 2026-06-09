'use strict';

// ─── Signals ──────────────────────────────────────────────────────────────────
//
// Hand-rolled minimal signals primitive. Reactivity for the structural state
// and view layer; the perf-critical caches (merged, override, stats) stay
// imperative and bump `cacheVersion$` to notify subscribers. ~50 lines, no
// external dependency — keeps grawlix's "no build step, no npm" property.
//
// Scope notes:
//   - No automatic dependency cleanup on re-runs (effects accumulate subs).
//     Fine for grawlix's small, stable graph.
//   - No batching primitive in the lib — `batchUpdate` already coalesces at
//     the call-site level.
//   - No async support; not needed.

let _currentEffect = null;
// While `_batchedEffects` is non-null, signal writes queue subscribers here
// instead of running them; the batch owner drains and runs each effect once.
// Coalesces multi-field updates (e.g. the configure-wordlist dialog save) so
// each effect sees a coherent post-batch state and runs once, not N times.
let _batchedEffects = null;

function _fireSubs(subs) {
  if (_batchedEffects) {
    for (const s of subs) _batchedEffects.add(s);
  } else {
    [...subs].forEach(s => s());
  }
}

export function signal(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get() { if (_currentEffect) subs.add(_currentEffect); return value; },
    peek() { return value; },          // non-subscribing read
    set(v) {
      if (Object.is(v, value)) return;
      value = v;
      _fireSubs(subs);
    },
    // For mutable values (arrays, maps): force notify even when ref is unchanged.
    bump() { _fireSubs(subs); },
  };
}

export function effect(fn) {
  const run = () => {
    const prev = _currentEffect;
    _currentEffect = run;
    try { fn(); } finally { _currentEffect = prev; }
  };
  run();
  return run;
}

// Owns the `_batchedEffects` queue: the outermost caller creates it and drains
// it once after `fn` returns; nested calls share it (only the owner drains).
// `batchUpdate` (data layer) must do its persist/cache bookkeeping inside `fn`,
// not after this returns — that work has to land before the queue drains.
export function runBatched(fn) {
  const owner = _batchedEffects === null;
  if (owner) _batchedEffects = new Set();
  try { fn(); }
  finally {
    if (owner) {
      const queued = _batchedEffects;
      _batchedEffects = null;
      [...queued].forEach(s => s());
    }
  }
}
