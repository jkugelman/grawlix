'use strict';

// ─── Packed retention: record (tuple) and group (set) tiers ──────────────────
// A combination row's atoms are whole merged-corpus entries (each carries `_i`,
// its index into the run's corpus), so a retained result is really corpus indices
// plus a little side data. Both tiers pack that into typed arrays and rebuild
// display group objects lazily, only for the fetched window.
//
// Scores/lengths/displays are read LIVE through the run's corpus, not frozen into
// sidecars: the eager path read them off each atom's `wlEntry` (which IS the corpus
// entry), so an in-place rescore it reflects live would silently diverge from a
// frozen copy. The only staleness guard is therefore a pinned corpus snapshot on a
// structural background edit (worker's `corpusFor`), exactly as the flat tier.
//
// The two tiers differ in how the view is derived, for a memory reason. A **record**
// (tuple) is combinatorial and capped at ~500k, so transiently materializing the
// eager object graph to sort it would reinstate the ~425 MB peak — it uses a bespoke
// index comparator (recordComparator) instead. A **group** (set) is corpus-bounded,
// so a transient flyweight materialization (buildGroupFlyweights) is ≤ what the eager
// tier already retained, no new peak — which lets it reuse the exact eager
// sort/filter/summary code for provable parity. Only the common corpus-entry case
// packs; the worker's packability gates (packableRecordStack / tryPackGroupJoin) keep
// a decorated-pool, multi-atom, or multi-key result on the eager path.

import { composeSortAxis, compareItems } from './sort.js';
import { displayOf } from './norm.js';
import { matchesRange, parseRange } from './range.js';
import { cacheGroupStats } from './executor.js';

// `length` is the logical count; `a` keeps spare capacity, so never read at or
// past `length` — it holds stale slots the doubling left behind.
class Grow {
  constructor(Ctor, cap = 1024) { this.Ctor = Ctor; this.a = new Ctor(cap); this.length = 0; }
  push(v) {
    if (this.length === this.a.length) { const b = new this.Ctor(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.length++] = v;
  }
}

export class PackedRecordJoin {
  constructor() {
    this.arity = 0;      // lanes per tuple (fixed per query); 0 until the first tuple appends
    this.count = 0;      // tuples retained
    this.laneIdx = new Grow(Int32Array);     // count*arity — each lane's corpus `_i`
    // CSR highlight table: lane L's ranges are hlStart/hlEnd/hlKind[hlPtr[L]..hlPtr[L+1]].
    this.hlPtr = new Grow(Int32Array); this.hlPtr.push(0);
    this.hlStart = new Grow(Int16Array);
    this.hlEnd = new Grow(Int16Array);
    this.hlKind = new Grow(Int8Array);       // kind-id into `kinds` (VAR_HL_COLORS bounds it small)
    this.kinds = [];                         // kind-id → kind string
    this._kindIndex = new Map();
  }

  _kindId(kind) {
    let id = this._kindIndex.get(kind);
    if (id === undefined) { id = this.kinds.length; this.kinds.push(kind); this._kindIndex.set(kind, id); }
    return id;
  }

  // Append a batch of eager tuple groups (tupleToGroup output). Throws on a shape
  // the packableRecordStack gate should have excluded, so a mis-gate surfaces loudly
  // instead of silently corrupting the join.
  appendGroups(groups) {
    for (const g of groups) {
      const chains = g.chains;
      if (this.count === 0 && this.arity === 0) this.arity = chains.length;
      if (chains.length !== this.arity) throw new Error(`packed record arity ${chains.length} != ${this.arity}`);
      for (let k = 0; k < chains.length; k++) {
        const atom = chains[k].atoms[0];
        if (chains[k].atoms.length !== 1 || atom.wlEntry._i == null) throw new Error('packed record lane is not a single corpus entry');
        this.laneIdx.push(atom.wlEntry._i);
        const hl = atom.highlights;
        if (hl) for (const r of hl) { this.hlStart.push(r.start); this.hlEnd.push(r.end); this.hlKind.push(this._kindId(r.kind)); }
        this.hlPtr.push(this.hlStart.length);
      }
      this.count++;
    }
  }

  laneEntry(corpus, ord, k) { return corpus.entries[this.laneIdx.a[ord * this.arity + k]]; }

  // Space-joined lane norms — must equal tupleToGroup's key, or the sort tiebreak
  // and group-key fetch resolve differently from the eager path.
  keyOf(corpus, ord) {
    const base = ord * this.arity, li = this.laneIdx.a, entries = corpus.entries;
    let s = '';
    for (let k = 0; k < this.arity; k++) { if (k) s += ' '; s += entries[li[base + k]].norm; }
    return s;
  }

  // null (not []) when the lane has no ranges, matching the eager atom's
  // `highlights.length ? highlights : null` so encodeAtom drops `h` on the same lanes.
  highlightsOf(ord, k) {
    const lane = ord * this.arity + k;
    const lo = this.hlPtr.a[lane], hi = this.hlPtr.a[lane + 1];
    if (lo === hi) return null;
    const out = new Array(hi - lo);
    for (let i = lo; i < hi; i++) out[i - lo] = { start: this.hlStart.a[i], end: this.hlEnd.a[i], kind: this.kinds[this.hlKind.a[i]] };
    return out;
  }

  get byteLength() {
    return this.laneIdx.length * 4 + this.hlPtr.length * 4
      + this.hlStart.length * 2 + this.hlEnd.length * 2 + this.hlKind.length
      + this.kinds.reduce((n, s) => n + s.length * 2 + 8, 0);
  }
}

export function packRecordJoin(groups) {
  const join = new PackedRecordJoin();
  join.appendGroups(groups);
  return join;
}

// One tuple's display group object — the shape encodeGroup/encodeChain/encodeAtom
// consume. Aggregates are recomputed from the corpus so they carry the same live/
// pinned scores the sort read.
export function materializeRecordRow(join, corpus, ord) {
  const arity = join.arity, base = ord * join.arity, li = join.laneIdx.a, entries = corpus.entries;
  let minS = Infinity, maxS = -Infinity, minL = Infinity, maxL = -Infinity;
  const chains = new Array(arity);
  for (let k = 0; k < arity; k++) {
    const e = entries[li[base + k]];
    if (e.score < minS) minS = e.score;
    if (e.score > maxS) maxS = e.score;
    if (e.norm.length < minL) minL = e.norm.length;
    if (e.norm.length > maxL) maxL = e.norm.length;
    chains[k] = { atoms: [{ wlEntry: e, highlights: join.highlightsOf(ord, k), glyph: null }] };
  }
  return { key: join.keyOf(corpus, ord), anchor: null, _minScore: minS, _maxScore: maxS, _minLength: minL, _maxLength: maxL, _count: arity, chains };
}

// Every lane in range — the applyScoreRangeToRows 'record' rule: a positional lane
// is never trimmed, so the tuple drops whole or not at all.
export function recordInRange(join, corpus, ord, intervals) {
  const arity = join.arity, base = ord * join.arity, li = join.laneIdx.a, entries = corpus.entries;
  for (let k = 0; k < arity; k++) if (!matchesRange(entries[li[base + k]].score, intervals)) return false;
  return true;
}

// The packed analogue of groupSortAxes for a tuple (no group tool ⇒ plain
// GROUP_SORT_AXES). Projections take an ordinal and return the SAME values the eager
// group-object axes read, so composeSortAxis/compareItems yield an identical order —
// the streaming-authority invariant (the incremental merge must equal a full sort).
function recordSortAxes(join, corpus) {
  const arity = join.arity, li = join.laneIdx.a, entries = corpus.entries;
  const laneEntry = (ord, k) => entries[li[ord * arity + k]];
  const minScore = ord => { let m = Infinity; for (let k = 0; k < arity; k++) { const s = laneEntry(ord, k).score; if (s < m) m = s; } return m; };
  const maxScore = ord => { let m = -Infinity; for (let k = 0; k < arity; k++) { const s = laneEntry(ord, k).score; if (s > m) m = s; } return m; };
  const minLen = ord => { let m = Infinity; for (let k = 0; k < arity; k++) { const l = laneEntry(ord, k).norm.length; if (l < m) m = l; } return m; };
  const maxLen = ord => { let m = -Infinity; for (let k = 0; k < arity; k++) { const l = laneEntry(ord, k).norm.length; if (l > m) m = l; } return m; };
  const count = () => arity;
  const displays = ord => { const a = new Array(arity); for (let k = 0; k < arity; k++) a[k] = displayOf(laneEntry(ord, k)); return a; };
  const key = ord => join.keyOf(corpus, ord);
  return {
    entry:        { primary: displays,  tiebreakers: [{ project: count, dir: 'desc' }] },
    count:        { primary: count,     tiebreakers: [{ project: key, dir: 'asc' }] },
    'min-score':  { primary: minScore,  tiebreakers: [{ project: count, dir: 'desc' }, { project: key, dir: 'asc' }] },
    'max-score':  { primary: maxScore,  tiebreakers: [{ project: count, dir: 'desc' }, { project: key, dir: 'asc' }] },
    'min-length': { primary: minLen,    tiebreakers: [{ project: count, dir: 'desc' }, { project: key, dir: 'asc' }] },
    'max-length': { primary: maxLen,    tiebreakers: [{ project: count, dir: 'desc' }, { project: key, dir: 'asc' }] },
  };
}

export function recordComparator(sortList, join, corpus) {
  const axis = composeSortAxis(sortList, recordSortAxes(join, corpus));
  if (!axis) return null;
  const dir = sortList[0].dir;
  const key = ord => join.keyOf(corpus, ord);
  return (a, b) => compareItems(a, b, axis, dir) || key(a).localeCompare(key(b));
}

// The sorted+filtered ordinal permutation (the view). The join stays unfiltered so a
// later widening reproject re-admits tuples a narrower filter dropped.
export function recordView(join, viewSpec, corpus) {
  const intervals = viewSpec.scoreRange ? parseRange(viewSpec.scoreRange) : null;
  const ords = [];
  for (let ord = 0; ord < join.count; ord++) {
    if (intervals && !recordInRange(join, corpus, ord, intervals)) continue;
    ords.push(ord);
  }
  const view = Int32Array.from(ords);
  const cmp = recordComparator(viewSpec.sort, join, corpus);
  if (cmp) view.sort(cmp);
  return view;
}

// ─── Packed group (set) retention ────────────────────────────────────────────

export class PackedGroupJoin {
  constructor() {
    this.count = 0;                          // groups
    this.keys = [];                          // per group: the tool-derived key string (retained — display, sort, memberHighlights)
    this.anchorIdx = new Grow(Int32Array);   // per group: anchor's corpus `_i`, or -1
    // CSR membership: group g's members are memberIdx[memberPtr[g]..memberPtr[g+1]].
    this.memberPtr = new Grow(Int32Array); this.memberPtr.push(0);
    this.memberIdx = new Grow(Int32Array);   // flattened member `_i`, bucketize order
  }

  memberRange(ord) { const p = this.memberPtr.a; return [p[ord], p[ord + 1]]; }

  get byteLength() {
    return this.anchorIdx.length * 4 + this.memberPtr.length * 4 + this.memberIdx.length * 4
      + this.keys.reduce((n, s) => n + s.length * 2 + 8, 0);
  }
}

// Pack the eager set groups, or return null to keep the eager path. Null on any shape
// whose packed form would silently diverge: a synthetic/multi-atom member (a decorated
// pool — no single `_i`), a matched-tagged member (a downstream group filter, whose
// score-range gate reads `matched`), or a member entry shared across groups (a multi-key
// tool, whose distinctChains dedup depends on chain-object identity packing discards).
export function tryPackGroupJoin(groups) {
  const seen = new Set();
  for (const g of groups) {
    if (g.anchor && g.anchor._i == null) return null;
    for (const chain of g.chains) {
      if (chain.matched !== undefined) return null;
      let e;
      if (chain.atoms) { if (chain.atoms.length !== 1) return null; e = chain.atoms[0].wlEntry; }
      else e = chain;                        // an undecorated group member is the bare wlEntry
      if (e._i == null || seen.has(e._i)) return null;
      seen.add(e._i);
    }
  }
  const join = new PackedGroupJoin();
  for (const g of groups) {
    join.keys.push(g.key);
    join.anchorIdx.push(g.anchor ? g.anchor._i : -1);
    for (const chain of g.chains) join.memberIdx.push((chain.atoms ? chain.atoms[0].wlEntry : chain)._i);
    join.memberPtr.push(join.memberIdx.length);
    join.count++;
  }
  return join;
}

// Transient group objects (members wrapped as single-atom chains, no highlights — the
// sort/filter/summary passes never read them) so the worker can drive the EXACT eager
// sortGroups/applyScoreRangeToRows/groupSummaries over a packed group join. Bounded by
// the corpus, so ≤ what the eager tier already retained — no new peak. `_ord` carries
// the join ordinal through to the view so materialize can recover key/anchor/members.
export function buildGroupFlyweights(join, corpus) {
  const entries = corpus.entries, li = join.memberIdx.a, ai = join.anchorIdx.a;
  const flyweights = new Array(join.count);
  for (let ord = 0; ord < join.count; ord++) {
    const [lo, hi] = join.memberRange(ord);
    const chains = new Array(hi - lo);
    for (let m = lo; m < hi; m++) chains[m - lo] = { atoms: [{ wlEntry: entries[li[m]], highlights: null, glyph: null }] };
    const g = { key: join.keys[ord], anchor: ai[ord] >= 0 ? entries[ai[ord]] : null, chains, _ord: ord };
    cacheGroupStats(g);
    flyweights[ord] = g;
  }
  return flyweights;
}

function tagCoord(ranges, coord) {
  if (!ranges || !ranges.length) return ranges;
  return ranges.map(r => r.coord ? r : { ...r, coord });
}

// One group's display object for the fetched window, from a view record (`{ ord,
// members }`, the sorted+filtered member `_i`s). Member highlights are RE-DERIVED from
// the tool's `memberHighlights(text, key)` — a pure function of the member text + group
// key, so recomputing at fetch is exact (the flat-tier model; safe unlike a tuple's
// ambiguous re-derivation). `def` is the active group tool's def.
export function materializeGroupRow(join, corpus, record, def) {
  const entries = corpus.entries;
  const key = join.keys[record.ord];
  const aIdx = join.anchorIdx.a[record.ord];
  const useDisplay = def && def.matchOn === 'display';
  const coord = useDisplay ? 'display' : 'norm';
  const mh = def && def.group && def.group.memberHighlights;
  const members = record.members;
  let minS = Infinity, maxS = -Infinity, minL = Infinity, maxL = -Infinity;
  const chains = new Array(members.length);
  for (let m = 0; m < members.length; m++) {
    const e = entries[members[m]];
    if (e.score < minS) minS = e.score;
    if (e.score > maxS) maxS = e.score;
    if (e.norm.length < minL) minL = e.norm.length;
    if (e.norm.length > maxL) maxL = e.norm.length;
    const highlights = mh ? tagCoord(mh(useDisplay ? displayOf(e) : e.norm, key), coord) : null;
    chains[m] = { atoms: [{ wlEntry: e, highlights, glyph: null }] };
  }
  return { key, anchor: aIdx >= 0 ? entries[aIdx] : null, _minScore: minS, _maxScore: maxS, _minLength: minL, _maxLength: maxL, _count: members.length, chains };
}
