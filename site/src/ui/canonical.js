'use strict';

// ─── Entry canonical-form orchestration ──────────────────────────────────────
//
// Joins the segmenter spacing (worker) to the reference resolution (engine); the
// panel's rename hint and the lookup fallback both route here so one cache and
// one whole-word suppressor serve both.

import { toNorm } from '../engine/norm.js';
import { resolveReference } from '../engine/canonical.js';
import { fetchWorkerSpaceOut } from './pipeline-worker.js';

const cache = new Map();

// Resolve `display` to { value, complete }. `complete` is false when a reference
// fetch failed, so resolveCached can refuse to keep it — the answer then depends
// on the sources, never on which fetch happened to land.
async function computeCanonical(display) {
  const norm = toNorm(display);
  if (!norm) return { value: display, complete: true };
  const hasSpace = /\s/.test(display);
  // The local fallback (worker spacing + wordlist casing) is what shows when the
  // references can't complete — computed up front so a thrown fetch degrades to it
  // rather than to a force-capped partial (Wiktionary down → "ground frost", not
  // "Ground frost").
  const fallback = hasSpace ? display : (await fetchWorkerSpaceOut(norm)) || display;
  try {
    // Bare: a same-norm reference form for the unsplit entry means it's a real word
    // — take it and never offer a split (the whole-word suppressor). Spaced: this
    // is the phrase resolution outright.
    let ref = await resolveReference(display, norm);
    if (!ref && !hasSpace && fallback !== display) ref = await resolveReference(fallback, norm);
    if (ref) return { value: ref, complete: true };
    // Plural fallback: a plural can't match its singular's reference form under the
    // exact-norm guard (DNA sequencer ≠ dnasequencers). Re-add the "s" and norm-check
    // the result, so the singular's casing/accents carry over while a wrong stem
    // still can't slip through.
    if (norm.length > 3 && display.endsWith('s')) {
      const stem = norm.slice(0, -1);
      // Short-circuit: the plural's own lookup may already hold the singular (a
      // full-text hit or a redirect); the fetches are memoized, so re-resolving
      // `fallback` against the singular norm reuses them at no network cost.
      const near = await resolveReference(fallback, stem);
      if (near && toNorm(near + 's') === norm) return { value: near + 's', complete: true };
      // Long path: the singular has a query of its own (a Wikipedia entity whose
      // plural isn't a redirect), so resolve it from scratch and re-inflect. Its
      // incompleteness taints ours — the plural rode on a possibly-degraded stem.
      const sub = await resolveCached(display.slice(0, -1));
      if (!sub.complete) return { value: fallback, complete: false };
      if (toNorm(sub.value + 's') === norm) return { value: sub.value + 's', complete: true };
    }
    return { value: fallback, complete: true };
  } catch {
    return { value: fallback, complete: false };
  }
}

function resolveCached(display) {
  let p = cache.get(display);
  if (!p) {
    p = computeCanonical(display);
    cache.set(display, p);
    // Evict a resolution built on a failed fetch so the next access retries.
    p.then(r => { if (!r.complete) cache.delete(display); }, () => cache.delete(display));
  }
  return p;
}

export function resolveEntryCanonical(display) {
  return resolveCached(display).then(r => r.value);
}
