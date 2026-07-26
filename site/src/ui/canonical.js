'use strict';

// ─── Entry canonical-form orchestration ──────────────────────────────────────
//
// Joins the segmenter spacing (worker) to the reference resolution (engine); the
// panel's rename hint and the lookup fallback both route here so one cache and
// one whole-word suppressor serve both.

import { toNorm } from '../engine/norm.js';
import { resolveReference } from '../engine/canonical.js';
import { LruCache } from '../core/lru.js';
import { fetchWorkerSpaceOut, fetchWorkerWordCase } from './pipeline-worker.js';

const cache = new LruCache(100, 60 * 60 * 1000);

// Resolve `display` to { value, complete }. `complete` is false when a reference
// fetch failed OR the worker couldn't segment, so resolveCached can refuse to keep
// it — the answer then depends on the sources, never on which fetch happened to land.
async function computeCanonical(display) {
  const norm = toNorm(display);
  if (!norm) return { value: display, complete: true };
  const hasSpace = /\s/.test(display);
  // The local fallback (worker spacing + wordlist casing) is what shows when the
  // references can't complete — computed up front so a thrown fetch degrades to it
  // rather than to a force-capped partial (Wiktionary down → "ground frost", not
  // "Ground frost").
  const spaced = hasSpace ? { suggestion: null, ready: true } : await fetchWorkerSpaceOut(norm);
  const fallback = spaced.suggestion || display;
  // Taints only the fallback return. An un-ready segmenter leaves fallback === display,
  // which gates out the re-resolve below, so every reference-derived answer here stands
  // on its own — suppressing those too would drop good hints whenever the worker is cold.
  const ready = spaced.ready;
  // Its own flag rather than `ready` above: an un-ready CORPUS taints reference-derived
  // answers (it silently reports every first word as uncarried, which the ladder reads
  // as evidence), where an un-ready SEGMENTER taints only the fallback.
  let caseReady = true;
  // The re-resolve below and both plural tiers re-ask about the same first word —
  // 2–4 identical round-trips per hint without this memo.
  const asked = new Map();
  const caseOf = n => {
    let p = asked.get(n);
    if (!p) {
      p = fetchWorkerWordCase(n).then(r => { if (!r.ready) caseReady = false; return r.display; });
      asked.set(n, p);
    }
    return p;
  };
  try {
    let ref = await resolveReference(display, norm, caseOf);
    // A spaced bare reference is a Wikipedia-only fuzz-match across the missing space
    // (generalassemblies → "General assemblies"); Wiktionary's stricter search never
    // matched the concatenation, so re-resolve the spaced fallback to let its correct
    // lowercase form win. The `/\s/` clause is load-bearing — dropping it re-caps.
    if (!hasSpace && (!ref || /\s/.test(ref)) && fallback !== display) {
      ref = (await resolveReference(fallback, norm, caseOf)) || ref;
    }
    if (ref) return { value: ref, complete: caseReady };
    // Plural fallback: a plural can't match its singular's reference form under the
    // exact-norm guard (DNA sequencer ≠ dnasequencers). Re-add the "s" and norm-check
    // the result, so the singular's casing/accents carry over while a wrong stem
    // still can't slip through.
    if (norm.length > 3 && display.endsWith('s')) {
      const stem = norm.slice(0, -1);
      // Short-circuit: the plural's own lookup may already hold the singular (a
      // full-text hit or a redirect); fetchJSON caches by URL, so re-resolving
      // `fallback` against the singular norm reuses them at no network cost.
      const near = await resolveReference(fallback, stem, caseOf);
      if (near && toNorm(near + 's') === norm) return { value: near + 's', complete: caseReady };
      // Long path: the singular has a query of its own (a Wikipedia entity whose
      // plural isn't a redirect), so resolve it from scratch and re-inflect. Its
      // incompleteness taints ours — the plural rode on a possibly-degraded stem.
      const sub = await resolveCached(display.slice(0, -1));
      if (!sub.complete) return { value: fallback, complete: false, local: true };
      if (toNorm(sub.value + 's') === norm) return { value: sub.value + 's', complete: caseReady };
    }
    return { value: fallback, complete: ready, local: true };
  } catch {
    return { value: fallback, complete: false, local: true };
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

// Returns { value, complete, local }. Callers that memoize must check `complete` — an
// incomplete one is a degraded snapshot of an outage, not this entry's form. `local`
// marks the value as the segmenter fallback, which makes no reference-derived casing
// claim: an incomplete-but-local answer is still safe to *show*, an incomplete
// reference form is not (its leading capital was settled without evidence).
export function resolveEntryCanonical(display) {
  return resolveCached(display);
}
