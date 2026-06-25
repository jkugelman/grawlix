'use strict';

// ─── Per-source entry store: the materialization boundary ─────────────────────
//
// One accessor interface over a wordlist's per-source entries, read the same way
// whether a source is object-backed (My Edits) or columnar (every other source).
// It yields transient views the caller consumes and lets GC — retaining them
// would rebuild the per-source object pile this boundary exists to avoid.
//
// Bulk traversal yields per-NORM groups, not per-entry: the merge computes
// `isDistinguishing` once per same-norm group before mapping `concreteDisplay`
// over its members, so a per-entry callback couldn't reconstruct that whole-group
// property.

import { getRescoredEntries, getRescoredByNorm, groupEntries, rescoreScore } from './rescore.js';
import { parseWordlistLine, toNorm, displayForRaw, caseOfRaw, caseFromCounts } from './norm.js';

export function sourceAccessor(wl) {
  return wl._accessor ??= (wl.cols ? columnarAccessor(wl) : objectAccessor(wl));
}

// The columnar adapter closes over `wl.cols`; a column rebuild MUST clear this or
// the cached accessor silently keeps reading the pre-rebuild columns.
export function invalidateSourceAccessor(wl) {
  wl._accessor = null;
}

// Views ARE the objects getRescoredEntries already caches, so the merge sees the
// identical entries it always did — the indirection is behavior-free for objects.
function objectAccessor(wl) {
  return {
    get count() { return wl.rawEntries.length; },
    hasNorm: norm => getRescoredByNorm(wl).has(norm),
    rescoredForNorm(norm) {
      const g = getRescoredByNorm(wl).get(norm);
      return g === undefined ? undefined : groupEntries(g);
    },
    forEachGroup(cb) {
      for (const [norm, g] of getRescoredByNorm(wl)) cb(norm, groupEntries(g));
    },
    collectRescored: () => getRescoredEntries(wl),
    *scores() { for (const e of getRescoredEntries(wl)) yield e.score; },
    collectRaw: () => wl.rawEntries,
  };
}

// ─── Columnar source: typed arrays + packed string buffers ────────────────────
//
// A non-Edits source's entries as parallel columns sorted by norm. Load-bearing
// invariants, each of which fails silently if broken:
//   - The sort is STABLE on file index: within-norm variant order decides the
//     merge winner / commenter, so a reorder mis-picks them with no error.
//   - `rawScores`/`scores` are two columns; the view's `rawScore` reads undefined
//     exactly when a rule left the score unchanged — the equivalence the dump and
//     splice tuple tests pin (undefined vs a value diverges them).
//   - Display/comment pack PRESENT entries only; a zero-length offset run is the
//     absent marker, which holds only because a present one is never empty.
//   - norm is strictly [a-z0-9], so it packs 1 byte/char and byte-compare equals
//     the code-unit order the merge sorts by; widen toNorm and this mis-orders.
//
// Full n+1 offset arrays (not a presence bitmap) keep random access O(1): a
// popcount-rank scheme would make a full export O(result × sources × n).

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function decodeNorm(cols, i) {
  const lo = cols.normOffsets[i], hi = cols.normOffsets[i + 1];
  return String.fromCharCode.apply(null, cols.normBytes.subarray(lo, hi));
}

function decodeDisplay(cols, i) {
  const lo = cols.dispOffsets[i], hi = cols.dispOffsets[i + 1];
  return hi > lo ? DEC.decode(cols.dispBytes.subarray(lo, hi)) : null;
}

function decodeComment(cols, i) {
  const lo = cols.commentOffsets[i], hi = cols.commentOffsets[i + 1];
  return hi > lo ? DEC.decode(cols.commentBytes.subarray(lo, hi)) : '';
}

// A class (prototype getters), not object-literal getters: the merge build
// allocates millions of these, so per-instance getter closures would bloat it.
class ColView {
  constructor(cols, i) { this.cols = cols; this.i = i; this.score = cols.scores[i]; }
  get norm() { return decodeNorm(this.cols, this.i); }
  get display() { return decodeDisplay(this.cols, this.i); }
  get comment() { return decodeComment(this.cols, this.i); }
  get rawScore() {
    const c = this.cols, i = this.i;
    return c.scores[i] === c.rawScores[i] ? undefined : c.rawScores[i];
  }
}

class ColRawView {
  constructor(cols, i) { this.cols = cols; this.i = i; this.score = cols.rawScores[i]; }
  get norm() { return decodeNorm(this.cols, this.i); }
  get display() { return decodeDisplay(this.cols, this.i); }
  get comment() { return decodeComment(this.cols, this.i); }
}

function cmpQueryNorm(cols, query, i) {
  const lo = cols.normOffsets[i], hi = cols.normOffsets[i + 1];
  const len = hi - lo, qlen = query.length, m = Math.min(len, qlen);
  for (let k = 0; k < m; k++) {
    const a = query.charCodeAt(k), b = cols.normBytes[lo + k];
    if (a !== b) return a < b ? -1 : 1;
  }
  return qlen === len ? 0 : qlen < len ? -1 : 1;
}

function sameNormAt(cols, i, j) {
  const ai = cols.normOffsets[i], al = cols.normOffsets[i + 1] - ai;
  const bi = cols.normOffsets[j], bl = cols.normOffsets[j + 1] - bi;
  if (al !== bl) return false;
  for (let k = 0; k < al; k++) if (cols.normBytes[ai + k] !== cols.normBytes[bi + k]) return false;
  return true;
}

function normRange(cols, query) {
  let lo = 0, hi = cols.n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmpQueryNorm(cols, query, mid) > 0) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= cols.n || cmpQueryNorm(cols, query, lo) !== 0) return null;
  let end = lo + 1;
  while (end < cols.n && cmpQueryNorm(cols, query, end) === 0) end++;
  return [lo, end];
}

function columnarAccessor(wl) {
  const cols = wl.cols;
  return {
    get count() { return cols.n; },
    hasNorm: norm => normRange(cols, norm) !== null,
    rescoredForNorm(norm) {
      const r = normRange(cols, norm);
      if (!r) return undefined;
      const views = [];
      for (let i = r[0]; i < r[1]; i++) views.push(new ColView(cols, i));
      return views;
    },
    forEachGroup(cb) {
      let i = 0;
      while (i < cols.n) {
        let j = i + 1;
        while (j < cols.n && sameNormAt(cols, i, j)) j++;
        const views = [];
        for (let k = i; k < j; k++) views.push(new ColView(cols, k));
        cb(decodeNorm(cols, i), views);
        i = j;
      }
    },
    collectRescored() {
      const out = new Array(cols.n);
      for (let i = 0; i < cols.n; i++) out[i] = new ColView(cols, i);
      return out;
    },
    scores: () => cols.scores,
    collectRaw() {
      const out = new Array(cols.n);
      for (let i = 0; i < cols.n; i++) out[i] = new ColRawView(cols, i);
      return out;
    },
  };
}

// ─── Columnar builders ────────────────────────────────────────────────────────

function* eachLine(text) {
  let i = 0;
  const len = text.length;
  while (i < len) {
    let nl = text.indexOf('\n', i);
    if (nl === -1) nl = len;
    yield text.slice(i, nl);
    i = nl + 1;
  }
}

// The boot path: streams the text straight into columns, retaining no per-entry
// object array. Two passes because the display decision needs the file's case,
// which can only be known after every entry is seen.
export function parseWordlistColumns(text, rules) {
  const raws = [], comments = [], rawScores = [];
  let upper = 0, lower = 0, mixed = 0;
  for (const line of eachLine(text)) {
    const p = parseWordlistLine(line);
    if (!p) continue;
    raws.push(p.raw);
    comments.push(p.comment || '');
    rawScores.push(p.score);
    const c = caseOfRaw(p.raw);
    if (c === 'mixed') mixed++; else if (c === 'upper') upper++; else if (c === 'lower') lower++;
  }
  const fileCase = caseFromCounts(upper, lower, mixed);
  const n = raws.length;
  const norms = new Array(n), displays = new Array(n);
  for (let i = 0; i < n; i++) {
    norms[i] = toNorm(raws[i]);
    displays[i] = displayForRaw(raws[i], fileCase);
  }
  return gatherColumns(norms, displays, comments, rawScores, rules);
}

export function columnsFromEntries(entries, rules) {
  const n = entries.length;
  const norms = new Array(n), displays = new Array(n), comments = new Array(n), rawScores = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    norms[i] = e.norm;
    displays[i] = e.display ?? null;
    comments[i] = e.comment || '';
    rawScores[i] = e.score;
  }
  return gatherColumns(norms, displays, comments, rawScores, rules);
}

function gatherColumns(norms, displays, comments, rawScoresArr, rules) {
  const n = norms.length;

  // Stable argsort by (norm code-units, original file index): the within-norm
  // variant order must stay file order or the merge picks the wrong winner/comment.
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => {
    const na = norms[a], nb = norms[b];
    return na < nb ? -1 : na > nb ? 1 : a - b;
  });

  let nb = 0;
  for (let i = 0; i < n; i++) nb += norms[i].length;
  const normBytes = new Uint8Array(nb);
  const normOffsets = new Uint32Array(n + 1);
  const rawScores = new Int32Array(n);

  const dispEnc = new Array(n), commentEnc = new Array(n);
  let noff = 0, db = 0, cb = 0;
  for (let k = 0; k < n; k++) {
    const src = order[k];
    const s = norms[src];
    normOffsets[k] = noff;
    for (let j = 0; j < s.length; j++) normBytes[noff++] = s.charCodeAt(j);
    rawScores[k] = rawScoresArr[src];
    const d = displays[src];
    if (d != null) { const e = ENC.encode(d); dispEnc[k] = e; db += e.length; } else dispEnc[k] = null;
    const c = comments[src];
    if (c) { const e = ENC.encode(c); commentEnc[k] = e; cb += e.length; } else commentEnc[k] = null;
  }
  normOffsets[n] = noff;

  const dispBytes = new Uint8Array(db), commentBytes = new Uint8Array(cb);
  const dispOffsets = new Uint32Array(n + 1), commentOffsets = new Uint32Array(n + 1);
  let doff = 0, coff = 0;
  for (let k = 0; k < n; k++) {
    dispOffsets[k] = doff;
    const de = dispEnc[k];
    if (de) { dispBytes.set(de, doff); doff += de.length; }
    commentOffsets[k] = coff;
    const ce = commentEnc[k];
    if (ce) { commentBytes.set(ce, coff); coff += ce.length; }
  }
  dispOffsets[n] = doff;
  commentOffsets[n] = coff;

  const scores = new Int32Array(n);
  let changed = false;
  for (let k = 0; k < n; k++) {
    const s = rescoreScore(rawScores[k], normOffsets[k + 1] - normOffsets[k], rules);
    scores[k] = s;
    if (s !== rawScores[k]) changed = true;
  }

  return {
    n, normBytes, normOffsets, rawScores,
    // Share rawScores when no rule moved any score, dropping a whole Int32 column.
    scores: changed ? scores : rawScores,
    dispBytes, dispOffsets, commentBytes, commentOffsets,
  };
}
