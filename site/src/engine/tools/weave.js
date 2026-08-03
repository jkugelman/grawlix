'use strict';

import { WEAVE_CAP_MOBILE } from '../../core/constants.js';
import { toNorm } from '../norm.js';
import { SEARCH_KINDS } from '../search.js';

// Mobile is the safe default: a missed boot message has to under-retain, not
// over-retain into a reload.
let weaveMaxResults = WEAVE_CAP_MOBILE;

// Above this the streamed set is the only copy. Raising it reinstates the peak the
// packed join exists to avoid (~1172 B/tuple retained); lowering it past an
// entry-pinned result costs that run its prefix tile, and its interactivity.
let weaveRetainLimit = 50_000;

export function configureWeave({ maxResults, retainLimit } = {}) {
  if (Number.isFinite(maxResults) && maxResults > 0) weaveMaxResults = maxResults;
  if (Number.isFinite(retainLimit) && retainLimit >= 0) weaveRetainLimit = retainLimit;
}

const MIN_PART = 4;
// Chunks alternate, so the two piece-counts differ by at most one; "both parts in
// >=2 pieces" is therefore exactly runs >= 4.
const DEFAULT_RUNS = 4;
// Stops at 3 because 2 runs is a concatenation with nothing woven.
const RUNS_FLOOR = 3;
// Deeper ranges are narrow and there are millions of them, so memoizing past this
// costs the memory the trie below is avoiding.
const MEMO_DEPTH = 3;

// ─── Corpus index ────────────────────────────────────────────────────────────
//
// A sorted norm array doubles as a trie: every prefix owns a contiguous range, so
// descending is a binary search and costs no memory beyond the array. An explicit
// trie over a full merge runs to ~3M nodes / ~500 MB, which a worker can't hold.

function buildIndex(pool) {
  const byNorm = new Map();
  for (const e of pool) if (!byNorm.has(e.norm)) byNorm.set(e.norm, e);
  const norms = [...byNorm.keys()].sort();
  return { norms, byNorm, memo: new Map() };
}

function makeSearch({ norms, memo }) {
  const N = norms.length;
  const lower = (lo, hi, d, c) => {
    while (lo < hi) { const m = (lo + hi) >> 1; if (norms[m].length > d && norms[m][d] < c) lo = m + 1; else hi = m; }
    return lo;
  };
  const upper = (lo, hi, d, c) => {
    while (lo < hi) { const m = (lo + hi) >> 1; if (norms[m].length > d && norms[m][d] <= c) lo = m + 1; else hi = m; }
    return lo;
  };
  const complete = (lo, hi, d) => lo < hi && norms[lo].length === d;
  // An entry that IS the prefix (wall, beside wallet) sorts first in its own range
  // and has no character at d, so it reads as "less than" every c and breaks the
  // searches' monotone predicate. Skipping it is what keeps the range a real
  // prefix range — without it a descent silently lands on an unrelated norm.
  const rangeFor = (lo, hi, d, c) => {
    const base = lo < hi && norms[lo].length === d ? lo + 1 : lo;
    const l = lower(base, hi, d, c);
    if (l >= hi) return null;
    const u = upper(l, hi, d, c);
    return l < u ? [l, u] : null;
  };
  const narrow = (prefix, lo, hi, c) => {
    const d = prefix.length;
    if (d >= MEMO_DEPTH) return rangeFor(lo, hi, d, c);
    const k = prefix + c;
    let r = memo.get(k);
    if (r === undefined) memo.set(k, r = rangeFor(lo, hi, d, c));
    return r;
  };
  return { N, complete, narrow };
}

// ─── Weave search ────────────────────────────────────────────────────────────

function pathHighlights(path) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= path.length; i++) {
    if (i === path.length || path[i] !== path[start]) {
      out.push({ start, end: i, kind: SEARCH_KINDS[+path[start]] });
      start = i;
    }
  }
  return out;
}

// Scored by the FEWEST runs any assignment of this pair achieves. Repeated letters
// let a plain concatenation also be read as a 4-run weave, so taking the best-looking
// assignment would admit exactly the splits `minRuns` exists to reject.
export function findWeaves(word, index, search, fixed = null, minRuns = DEFAULT_RUNS) {
  const { complete, narrow, N } = search;
  const best = new Map();
  const L = word.length;
  const onTrack = (a, b) => !fixed || fixed.startsWith(a) || fixed.startsWith(b);
  (function go(i, a, loA, hiA, b, loB, hiB, runs, last, path) {
    if (i === L) {
      // Deliberately NOT filtered on runs here: a low-run assignment has to reach
      // `best` to establish the pair's minimum. Reject it early and the minimum is
      // taken over surviving assignments only, which is the max-runs bug inverted.
      if (a.length < MIN_PART || b.length < MIN_PART) return;
      if (fixed && a !== fixed && b !== fixed) return;
      if (!complete(loA, hiA, a.length) || !complete(loB, hiB, b.length)) return;
      const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
      const prev = best.get(key);
      if (!prev || runs < prev.runs) best.set(key, { a, b, runs, path });
      return;
    }
    const c = word[i];
    const ra = narrow(a, loA, hiA, c);
    if (ra && ra[0] < ra[1] && onTrack(a + c, b)) {
      go(i + 1, a + c, ra[0], ra[1], b, loB, hiB, last === '0' ? runs : runs + 1, '0', path + '0');
    }
    // word[0] is pinned to pile A so the mirror of every split isn't emitted twice.
    if (i > 0) {
      const rb = narrow(b, loB, hiB, c);
      if (rb && rb[0] < rb[1] && onTrack(a, b + c)) {
        go(i + 1, a, loA, hiA, b + c, rb[0], rb[1], last === '1' ? runs : runs + 1, '1', path + '1');
      }
    }
  })(0, '', 0, N, '', 0, N, 0, '', '');
  return [...best.values()].filter(w => w.runs >= minRuns);
}

// ─── Tool ────────────────────────────────────────────────────────────────────

export default {
  name: 'Weave', icon: '🧬', category: 'pairs',
  desc: 'Two entries interwoven, each keeping its letter order',
  example: 'wallet + socks → wall sockets',
  params: [
    { placeholder: 'entry' },
    { key: 'runs', label: 'Runs', type: 'number', default: String(DEFAULT_RUNS),
      min: RUNS_FLOOR, placeholder: String(DEFAULT_RUNS) },
  ],
  kind: 'tuple',
  isInert: () => false,
  prepare(params) {
    const n = parseInt(params?.runs, 10);
    return {
      fixed: toNorm((params?.entry || '').trim()) || null,
      minRuns: Number.isFinite(n) ? Math.max(RUNS_FLOOR, n) : DEFAULT_RUNS,
    };
  },
  async findTuples(pool, prepared, ctx) {
    const { fixed, minRuns } = prepared;
    const index = buildIndex(pool);
    const search = makeSearch(index);
    const { byNorm } = index;
    const pending = ctx.onBatch ? [] : null;
    let retained = [];
    let found = 0;
    const flush = async () => { if (pending?.length) await ctx.onBatch(pending.splice(0)); };

    for (const entry of pool) {
      if (found >= weaveMaxResults) break;
      if (entry.norm.length < MIN_PART * 2) continue;
      for (const w of findWeaves(entry.norm, index, search, fixed, minRuns)) {
        const lanes = [
          { entry, highlights: pathHighlights(w.path) },
          { entry: byNorm.get(w.a), highlights: null },
          { entry: byNorm.get(w.b), highlights: null },
        ];
        found++;
        pending?.push(lanes);
        // Dropped whole rather than truncated: a partly-filled set still looks like a
        // complete result to the executor, and would be cached as a prefix tile that
        // answers later runs with silently missing tuples.
        if (retained) {
          if (!pending || retained.length < weaveRetainLimit) retained.push(lanes);
          else retained = null;
        }
        if (found >= weaveMaxResults) break;
      }
      if (ctx.y.due()) { await flush(); await ctx.y.yield(); }
    }
    await flush();
    return { tuples: retained ?? [], retained: retained !== null, truncated: false, capped: found >= weaveMaxResults };
  },
};
