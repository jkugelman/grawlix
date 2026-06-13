// ─── Pipeline worker host ── see docs/worker-protocol.md ─────────────────────

import { MERGED_ID } from '../core/constants.js';
import { canonicalNormRow } from './snapshot.js';
import { TOOLS, makeToolRow } from './tools.js';
import { executePipeline, configureExecutorYield, invalidatePreSearchCache, bottomLineAtoms, applyScoreRangeToRows } from './executor.js';
import { sortGroups, activeGroupRow } from './group-sort.js';
import { configureIO as configureSegmenterIO } from './segmenter.js';
import { parseWordlist, toNorm, displayOf } from './norm.js';
import { parseRange, matchesRange } from './range.js';
import { compileRescoreRules, getRescoredEntries, getRescoredByNorm } from './rescore.js';
import { buildCorpus, resolveEditSeedWinner, mergeKey, mergedNormLowerBound, computeMergedBucket, isDistinguishing, concreteDisplay } from './corpus.js';
import { getHistogramLayout, invalidateHistogramLayout, bucketCounts } from './histogram.js';
import { computeStatsRaw } from './stats.js';
import { compileFlatHighlighters, materializeFlatRow } from './flat-highlight.js';
import { serializeEntries, sortedEntries } from './serialize.js';
import { threeWayMergeEdits, sameEditsEntries } from './edits-merge.js';

// scheduler.yield() (the executor's default) starves the worker's run/cancel
// message on Chromium and a microtask yield never delivers it — either silently
// breaks supersession. setTimeout(0) is the one yield the B1 spike proved
// preempts an in-flight run. ~30ms is a cancellation-latency dial, not
// correctness.
configureExecutorYield({
  yieldImpl: () => new Promise(r => setTimeout(r, 0)),
  intervalMs: 30,
});

// Data IDB access. idbGet/idbPut/readWordlist live in data/storage.js, a layer
// the engine can't import, so the worker opens the SAME DB/store itself for both
// the segmenter's unigram corpus and wordlist text. name/version/store MUST track
// storage.js's openDB, else it silently opens a different or wrong-version DB and
// the shared cache stops being shared (a re-fetch, not an error). onSize is a
// no-op: the LS size note is main-only.
const DATA_IDB_NAME = 'grawlix';
const DATA_IDB_STORE = 'data';
let _dataDb = null;
function dataDb() {
  if (_dataDb) return _dataDb;
  _dataDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DATA_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DATA_IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
  return _dataDb;
}
function idbGet(key) {
  return dataDb().then(db => new Promise(resolve => {
    const req = db.transaction(DATA_IDB_STORE, 'readonly').objectStore(DATA_IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  }));
}
// Must write the SAME record Storage.writeWordlist would (key 'data_' + dbKey,
// the serialized text): main skips its own My Edits write, so any divergence here
// silently becomes the persisted My Edits truth, surfacing only on reload.
async function idbPut(key, val) {
  const db = await dataDb();
  return new Promise(resolve => {
    const tx = db.transaction(DATA_IDB_STORE, 'readwrite');
    tx.objectStore(DATA_IDB_STORE).put(val, key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}
// Mirrors storage.js's Storage.readWordlist: wordlist text is keyed 'data_' + dbKey.
function readWordlistText(sourceId) {
  return idbGet('data_' + sourceId);
}
configureSegmenterIO({ idbGet, idbPut, onSize: () => null });

// ─── State ───────────────────────────────────────────────────────────────────

let latestRunId = -1;       // the supersession key; a `run`/`cancel` advances it
let pending = null;
let running = false;
let lastFlatResult = null;  // { runId, indices, scores, scope, highlighters } retained to serve `fetchRows`
let lastGroupedResult = null;  // { runId, groups, scope } — full sorted+filtered groups (all chains) retained to serve `fetchGroupChains`
let lastUserStackSig = null;
let lastRunCorpus = null;   // the corpus the live _preSearchCache was seeded from
let selfConfig = null;
let ownedBuilt = null;      // the retained per-source rich wordlists from the last syncConfig
let ownedMerged = null;     // eager self-built MERGED corpus; feeds the config summaries regardless of active scope
let ownedCorpus = null;     // eager self-built ACTIVE-scope corpus; the run-path corpus when fresh + scope-matched, else enrichment-only
let ownedEntryToIndex = null; // Map(ownedCorpus.entries[i] → i); built ONCE per ownedCorpus rebuild (never per run — a 1M-entry rebuild per keystroke is the lag this effort removes) and kept strictly paired with ownedCorpus so the two can't desync
let ownedScope = null;      // the scope `ownedCorpus` is built for; paired with ownedCorpusFresh to gate enrichment
// Union of EVERY configured source's rescored scores (enabled AND disabled, not
// deduped). Must be recomputed ONLY per syncConfig — never per run, never from
// the enabled-only/deduped ownedCorpus — or main's badge colors silently shift
// on a scope switch or keystroke, a regression no error surfaces.
let ownedAllSourcesAxis = { mode: 'empty', slots: [], min: null, max: null };
let ownedConfigVersion = 0;
// Supersession key for syncConfig builds. A config change can fire two re-syncs
// (the completeness hook before an import's IDB write, the post-write one after);
// only the LATEST build may commit, or the premature build — which read stale IDB
// text — could set ownedCorpus + fresh=true with stale data and corrupt rows.
let latestSyncToken = 0;
// A false positive (enriching from a mismatched ownedCorpus) silently corrupts
// every rendered row; a false negative just falls back to index-only — so this
// guard stays conservative. Because a snapshot no longer clears it, the paired
// ownedScope (scope-equality at the fetch site) is load-bearing: without it a
// scoped run could enrich from a merged ownedCorpus and ship wrong rows.
let ownedCorpusFresh = false;

// ─── Stack deserialization ───────────────────────────────────────────────────
// makeToolRow seeds param defaults; the wire params then overwrite. Reversed,
// defaults would clobber the user's params and the executor would silently run a
// different stack than the URL/main thread describes.
function deserializeStack(serialized) {
  const rows = [];
  for (const { tool, params, grouped } of serialized) {
    if (!TOOLS[tool]) continue;
    const row = makeToolRow(tool);
    if (params) row.params = { ...row.params, ...params };
    if (grouped) row.grouped = true;
    rows.push(row);
  }
  return rows;
}

// ─── Run loop & supersession ─────────────────────────────────────────────────
// A superseded run must post NOTHING (it just stops): the protocol has the
// client reap it by runId, and a stray late `result` for a stale run would
// overwrite the live one on the main thread with no error anywhere.
function makeSignalShim(thisRunId) {
  return {
    get aborted() { return thisRunId !== latestRunId; },
    get reason() { return undefined; },
  };
}

function isAbortError(e) {
  return e?.name === 'AbortError';
}

async function drainRuns() {
  if (running) return;
  running = true;
  try {
    while (pending) {
      const req = pending;
      pending = null;
      await runOne(req);
    }
  } finally {
    running = false;
  }
}

async function runOne({ runId, stack: serialized, sort, scope, existsQuery, scoreRange, rebindQuery }) {
  const signal = makeSignalShim(runId);
  const stack = deserializeStack(serialized);

  // The pre-search cache persists the user-stack result across runs for the
  // keystroke fast-path; the caller must drop it when the user stack changes. On
  // main that's ToolStack's mutation handlers — signals the worker never sees, so
  // it must detect the change itself, else a tool add/remove/edit silently runs
  // against the previous stack's cached pre-search state.
  const userStackSig = JSON.stringify(serialized.slice(0, -1));
  if (userStackSig !== lastUserStackSig) {
    invalidatePreSearchCache();
    lastUserStackSig = userStackSig;
  }

  // The pre-search cache's chains hold ownedCorpus.entries objects by reference. A
  // rebuilt ownedCorpus (scope switch, config re-sync) leaves the user stack
  // unchanged, so the userStackSig guard above can't catch it — yet the cached
  // chains now point at the previous corpus's entries, silently mis-encoding rows.
  if (ownedCorpus !== lastRunCorpus) {
    invalidatePreSearchCache();
    lastRunCorpus = ownedCorpus;
  }

  let out;
  try {
    out = await executePipeline(ownedCorpus, stack, signal);
  } catch (e) {
    if (isAbortError(e) || signal.aborted) return;
    postMessage({ type: 'error', runId, stackRowIndex: stackRowIndex(stack, e), message: e?.message || String(e) });
    return;
  }
  if (signal.aborted) return;

  postResult(runId, out, sort, scope, stack, existsQuery, scoreRange, rebindQuery);
}

function stackRowIndex(stack, e) {
  const idx = stack.indexOf(e?.stackRow);
  return idx === -1 ? null : idx;
}

// ─── Result encoding ── three tiers, see docs/worker-protocol.md ──────────────
// The flat path's index+scores encoding is lossless only when every atom is the
// same word; a rich row (glyph, distinct norms, or a synthetic) would silently
// lose data through it, so any rich row forces the atom-sequence encoding for the
// whole result.
function postResult(runId, { rows, atomCount, grouped }, sort, scope, stack, existsQuery, scoreRange, rebindQuery) {
  const base = { type: 'result', runId, grouped, atomCount, ranAgainstOwned: true };

  if (grouped) {
    lastFlatResult = null;
    const intervals = scoreRange ? parseRange(scoreRange) : null;
    // Filter BEFORE the group sort so the group axes read each group's post-filter
    // _minScore/count; the unfiltered `rows` still feeds the histogram + width hints
    // (the full distribution, so out-of-range bars stay clickable).
    const visible = intervals ? applyScoreRangeToRows(rows, intervals, true) : rows;
    const sorted = sortGroups(visible, sort?.key, sort?.dir, stack);
    lastGroupedResult = { runId, groups: sorted, scope };
    // Only the first window of group ROWS ships inline (main fetches later windows
    // via fetchGroups). The shipped array length is NOT the group count — main must
    // size from groupSummaries' groupCount, or it shows only the window and silently
    // drops every later group.
    postMessage({
      ...base,
      payload: {
        groups: sorted.slice(0, GROUP_ROW_WINDOW).map(g => encodeGroup(g)),
        ...groupSummaries(rows, sorted, scope, stack, !!intervals),
      },
    });
    return;
  }
  if (rows.some(rowIsRich)) {
    lastFlatResult = null;
    lastGroupedResult = null;
    postMessage({ ...base, payload: { chains: rows.map(c => encodeChain(c)) } });
    return;
  }

  const n = rows.length;
  let indices = new Int32Array(n);
  for (let i = 0; i < n; i++) indices[i] = ownedEntryToIndex.get(rows[i].atoms[0].wlEntry);

  sortFlatIndices(indices, sort, ownedCorpus);

  let scores = new Int32Array(n);
  for (let i = 0; i < n; i++) scores[i] = ownedCorpus.entries[indices[i]].score;

  // Must bucket BEFORE filtering below — the histogram stays the full
  // distribution so out-of-range bars remain clickable. ownedAllSourcesAxis is
  // the merged axis; a scoped run buckets against its own scoped layout instead,
  // since the merged axis would mis-bin a scoped distribution.
  let histogramCounts = null, histogramLayout = null;
  if (scope === MERGED_ID) {
    histogramCounts = bucketCounts(scores, ownedAllSourcesAxis);
  } else {
    histogramLayout = getHistogramLayout(ownedCorpus.entries, 'scoped:' + scope);
    histogramCounts = bucketCounts(scores, histogramLayout);
  }

  const intervals = scoreRange ? parseRange(scoreRange) : null;
  const doFilter = !!intervals;
  if (doFilter) {
    const idxOut = [], scoreOut = [];
    for (let i = 0; i < n; i++) {
      if (matchesRange(scores[i], intervals)) { idxOut.push(indices[i]); scoreOut.push(scores[i]); }
    }
    indices = Int32Array.from(idxOut);
    scores = Int32Array.from(scoreOut);
  }

  const widthHints = computeWidthHints(indices, ownedCorpus);

  // .slice() is load-bearing: the postMessage below transfers (detaches)
  // indices/scores, so the worker must retain its own copies to serve fetchRows.
  lastFlatResult = {
    runId,
    indices: indices.slice(),
    scores: scores.slice(),
    scope,
    highlighters: compileFlatHighlighters(stack),
  };
  lastGroupedResult = null;

  const stats = computeStatsRaw(scores);
  // existsInScope answers "in the run's SCOPE"; existsInMerge always answers
  // against the merge — main's two consumers split (the add-FAB seed checks
  // scope, the empty-state checks merge), so shipping both reproduces main's
  // pre-flip behavior exactly even on a scoped run.
  const existsInScope = existsQuery ? ownedCorpus.byNorm.has(toNorm(existsQuery)) : null;
  const existsInMerge = existsQuery && ownedMerged
    ? ownedMerged.byNorm.has(toNorm(existsQuery)) : null;

  // Resolve the open popover's re-anchor target the SAME way main's flat
  // findResultEntry+resultHasEntry do: a FULL-corpus byKey→byNorm lookup that
  // re-anchors even to an entry filtered OUT of the visible (range-filtered) view.
  let rebindEntry = null, rebindExists = null;
  if (rebindQuery) {
    const { norm, display } = rebindQuery;
    const row = ownedCorpus.byKey.get(mergeKey(norm, display)) ?? ownedCorpus.byNorm.get(norm) ?? null;
    rebindEntry = row && {
      norm, display: row.display ?? null, score: row.score, rawScore: row.rawScore,
      comment: row.comment || '', sourceId: row.wordlist.dbKey,
    };
    rebindExists = ownedCorpus.byNorm.has(norm);
  }

  // Ship the first window's rich rows inline so main paints above-the-fold rows
  // instantly instead of flashing skeletons until a fetchRows round-trip lands —
  // the instant first paint the resident-corpus render gave pre-flip. Built from
  // the just-set lastFlatResult; the scroller seeds _winCache from it.
  const firstRows = buildFlatRows(0, Math.min(FIRST_WINDOW, indices.length));

  postMessage(
    { ...base, payload: { indices: indices.buffer, scores: scores.buffer, widthHints, stats, histogramCounts, histogramLayout, existsInScope, existsInMerge, rebindQuery: rebindQuery || null, rebindEntry, rebindExists, filtered: doFilter, firstRows } },
    [indices.buffer, scores.buffer],
  );
}

// The above-the-fold window shipped inline with every flat result. Generous
// enough to cover a tall viewport plus the scroller's prefetch buffer, so the
// first paint never shows a skeleton for a result that fits on screen.
const FIRST_WINDOW = 60;

function computeWidthHints(indices, runCorpus) {
  let maxDisplayLen = 0, maxScore = 0, hasNeg = false, maxRawDigits = 0;
  for (let i = 0; i < indices.length; i++) {
    const e = runCorpus.entries[indices[i]];
    const dispLen = (e.display ?? e.norm).length;
    if (dispLen > maxDisplayLen) maxDisplayLen = dispLen;
    if (e.score < 0) hasNeg = true;
    const s = e.score < 0 ? -e.score : e.score;
    if (s > maxScore) maxScore = s;
    // Shipped because main can't scan the full result for the rescore-preview
    // arrow's raw-score width post-flip (no corpus); main applies it only when
    // the preview is active.
    if (e.rawScore != null && e.rawScore !== e.score) {
      const d = String(e.rawScore).length;
      if (d > maxRawDigits) maxRawDigits = d;
    }
  }
  return {
    maxDisplayLen,
    maxLenDigits: maxDisplayLen > 0 ? String(maxDisplayLen).length : 1,
    maxScoreDigits: String(maxScore).length + (hasNeg ? 1 : 0),
    maxRawDigits,
  };
}

// ─── Windowed row fetch ── see docs/worker-protocol.md ───────────────────────
// Shared by windowed `fetchRows` and unwindowed `fetchAllRows` so the two can't
// diverge — export bytes would silently drift from the rendered table otherwise.
// Always rich post-flip: main has no corpus to decode an index against, so a fetch
// for a window whose ownedCorpus is no longer fresh+scope-matched is dropped
// upstream (fetchResultFresh) rather than shipping un-decodable indices here.
function buildFlatRows(lo, hi) {
  const { indices, highlighters } = lastFlatResult;
  const rows = [];
  for (let i = lo; i < hi; i++) {
    const e = ownedCorpus.entries[indices[i]];
    // Multiple stacked highlighting searches materialize one atom slot each (all
    // the same word), so ship the full atom sequence — taking only atoms[0] would
    // silently drop the extra highlight lines a 3-search row renders.
    const atoms = materializeFlatRow(e, highlighters).atoms
      .map(a => ({ highlights: a.highlights, glyph: a.glyph }));
    rows.push({
      norm: e.norm, display: e.display, score: e.score, rawScore: e.rawScore,
      comment: e.comment, sourceId: e.wordlist.dbKey, atoms,
    });
  }
  return rows;
}

// A fetch is serveable only against a still-fresh, scope-matched ownedCorpus —
// lastFlatResult's indices name THAT corpus's entries. A scope/config change
// between the run and the fetch makes them name the wrong (or no) rows, so drop
// silently; main re-fetches on the next run rather than rendering garbage.
function fetchResultFresh(runId) {
  return !!lastFlatResult && lastFlatResult.runId === runId
    && ownedCorpus && ownedCorpusFresh && ownedScope === lastFlatResult.scope;
}

function handleFetchRows({ requestId, runId, start, end }) {
  if (!fetchResultFresh(runId)) return;
  const lo = Math.max(0, start | 0);
  const hi = Math.min(lastFlatResult.indices.length, end | 0);
  postMessage({ type: 'rows', requestId, runId, start: lo, rows: buildFlatRows(lo, hi) });
}

// ─── Full-result row fetch (export) ── see docs/worker-protocol.md ───────────
function handleFetchAllRows({ requestId, runId }) {
  if (!fetchResultFresh(runId)) return;
  postMessage({
    type: 'allRows', requestId, runId,
    rows: buildFlatRows(0, lastFlatResult.indices.length),
  });
}

// ─── Windowed grouped-chain fetch ── see docs/worker-protocol.md ─────────────
// The grouped analogue of fetchResultFresh. lastGroupedResult.groups hold their
// chains by reference to THAT run's corpus, so a scope/config change between the
// run and the fetch makes them name the wrong rows — drop silently, mirroring the
// flat path; main re-fetches on its next run rather than rendering garbage.
function groupedResultFresh(runId) {
  return !!lastGroupedResult && lastGroupedResult.runId === runId
    && ownedCorpus && ownedCorpusFresh && ownedScope === lastGroupedResult.scope;
}

function handleFetchGroupChains({ requestId, runId, groupKey, start, end }) {
  if (!groupedResultFresh(runId)) return;
  const group = lastGroupedResult.groups.find(g => g.key === groupKey);
  if (!group) return;
  const lo = Math.max(0, start | 0);
  const hi = Math.min(group.chains.length, end | 0);
  postMessage({
    type: 'groupChains', requestId, runId, groupKey, start: lo,
    chains: group.chains.slice(lo, hi).map(encodeChain),
  });
}

// ─── Windowed group-row fetch ── see docs/worker-protocol.md ─────────────────
function handleFetchGroups({ requestId, runId, start, end }) {
  if (!groupedResultFresh(runId)) return;
  const lo = Math.max(0, start | 0);
  const hi = Math.min(lastGroupedResult.groups.length, end | 0);
  postMessage({
    type: 'groups', requestId, runId, start: lo,
    groups: lastGroupedResult.groups.slice(lo, hi).map(encodeGroup),
  });
}

// ─── Full-result group fetch (export) ── see docs/worker-protocol.md ─────────
function handleFetchAllGroups({ requestId, runId }) {
  if (!groupedResultFresh(runId)) return;
  postMessage({
    type: 'allGroups', requestId, runId,
    groups: lastGroupedResult.groups.map(encodeGroupFull),
  });
}

// ─── Edit-seed fetch ── see docs/worker-protocol.md ──────────────────────────
// The seed is ALWAYS the merged winner, even from a scoped view, so it resolves
// against ownedMerged, never ownedCorpus. ownedMerged carries no freshness flag
// of its own; ownedCorpusFresh stands in because a syncConfig clears it
// synchronously and only a committed syncConfig (which rebuilds ownedMerged) or an
// edit command re-sets it — so fresh ⇒ ownedMerged is current. A stale seed
// silently saves a wrong value, so this guard must not loosen. A miss replies null.
function handleFetchEditSeed({ requestId, norm, display }) {
  let winner = null;
  if (ownedMerged && ownedCorpusFresh) {
    const row = resolveEditSeedWinner(ownedMerged, norm, display ?? null);
    if (row) {
      winner = {
        norm: row.norm, display: row.display ?? null,
        score: row.score, comment: row.comment || '', sourceId: row.wordlist.dbKey,
      };
    }
  }
  postMessage({ type: 'editSeed', requestId, winner });
}

// ─── Provenance + preview fetch ── see docs/worker-protocol.md ────────────────
// ownedCorpusFresh stands in for an ownedMerged/ownedBuilt freshness flag (cleared
// synchronously by syncConfig, re-set by a committed syncConfig or an edit command
// — same reasoning as handleFetchEditSeed); a stale answer silently renders the
// wrong table. A miss → {preview:null,rows:null}; main keeps its last-good render.
function handleFetchProvenance({ requestId, typedRaw, previewRaw, clickedNorm, clickedDisplay }) {
  if (!(ownedMerged && ownedBuilt && ownedCorpusFresh)) {
    postMessage({ type: 'provenance', requestId, preview: null, rows: null });
    return;
  }

  // previewRaw is independent of typedRaw because the initial render needs the
  // footer preview for the seed text while deriving provTarget from the clicked
  // atom (typedRaw ''); collapsing them would mis-pick the open-time table.
  const previewSrc = previewRaw ?? typedRaw;
  const preview = previewSrc && previewSrc.trim()
    ? (ownedMerged.byNorm.get(toNorm(previewSrc)) || null)
    : null;

  const provPreview = typedRaw && typedRaw.trim()
    ? (ownedMerged.byNorm.get(toNorm(typedRaw)) || null)
    : null;
  const target = provPreview ?? (typedRaw && typedRaw.trim()
    ? { norm: toNorm(typedRaw), display: null }
    : { norm: clickedNorm, display: clickedDisplay ?? null });

  const rows = [];
  if (target.norm != null) {
    const display = target.display;
    for (const wl of ownedBuilt) {
      const arr = getRescoredByNorm(wl).get(target.norm);
      if (!arr) continue;
      // Mirror the merge's eligibility (§ corpus.js) so the popover and the table
      // agree on ancestry: a bare entry applies to every spelling of its norm —
      // never collapse to e.display === display — UNLESS this same list also spells
      // the sibling, which concretizes the bare one to its own row.
      const distinguishing = isDistinguishing(arr);
      for (const e of arr) {
        const eff = concreteDisplay(e, target.norm, distinguishing);
        const include = display == null || eff === display || eff == null;
        if (include) {
          rows.push({
            sourceId: wl.dbKey,
            enabled: wl.enabled !== false,
            entry: { norm: e.norm, display: e.display ?? null, score: e.score, rawScore: e.rawScore, comment: e.comment || '' },
          });
        }
      }
    }
  }

  const previewOut = preview && {
    norm: preview.norm, display: preview.display ?? null,
    score: preview.score, comment: preview.comment || '', sourceId: preview.wordlist.dbKey,
  };
  postMessage({ type: 'provenance', requestId, preview: previewOut ?? null, rows });
}

// Native (norm.localeCompare) order ties differently from the `entry` axis,
// which falls to score — so even `entry`/asc is sorted, never left as-is, or the
// main thread (which no longer sorts) would show a subtly wrong order.
const FLAT_SORT_AXES = {
  entry: {
    primary: e => e.norm,
    tiebreakers: [{ p: e => e.norm.length, dir: -1 }, { p: e => e.score, dir: -1 }],
  },
  length: {
    primary: e => e.norm.length,
    tiebreakers: [{ p: e => e.score, dir: -1 }, { p: e => e.norm, dir: 1 }],
  },
  score: {
    primary: e => e.score,
    tiebreakers: [{ p: e => e.norm.length, dir: -1 }, { p: e => e.norm, dir: 1 }],
  },
};
function cmpVal(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
function sortFlatIndices(indices, sort, runCorpus) {
  const axis = FLAT_SORT_AXES[sort?.key] || FLAT_SORT_AXES.entry;
  const primaryDir = sort?.dir === 'desc' ? -1 : 1;
  const entries = runCorpus.entries;
  const arr = Array.from(indices);
  arr.sort((ia, ib) => {
    const a = entries[ia], b = entries[ib];
    const pc = cmpVal(axis.primary(a), axis.primary(b)) * primaryDir;
    if (pc !== 0) return pc;
    for (const tb of axis.tiebreakers) {
      const c = cmpVal(tb.p(a), tb.p(b)) * tb.dir;
      if (c !== 0) return c;
    }
    return 0;
  });
  indices.set(arr);
}

// The rich field set must stay identical to buildFlatRows' — a grouped/transform
// atom and a flat row of the same entry both feed one render path, so a divergence
// here silently renders the two tiers differently (e.g. a dropped rawScore/comment)
// with no error to catch it.
function encodeAtom(atom) {
  const { wlEntry, highlights, glyph } = atom;
  let out;
  if (wlEntry.wordlist == null) {
    out = { s: { norm: wlEntry.norm, display: wlEntry.display, score: wlEntry.score } };
  } else {
    out = {
      norm: wlEntry.norm, display: wlEntry.display, score: wlEntry.score,
      rawScore: wlEntry.rawScore, comment: wlEntry.comment, sourceId: wlEntry.wordlist.dbKey,
    };
  }
  if (highlights != null) out.h = highlights;
  if (glyph != null) out.g = glyph;
  return out;
}

function encodeChain(chain) {
  return { atoms: chain.atoms.map(encodeAtom) };
}

// Must exceed the most chains a COLLAPSED group row can ever fit (the slot-fill
// visibleCount in entries-table's _renderGroupRowHTML — ~25 for a wide desktop
// slot of short chains): if the window is shorter, the collapsed row under-shows
// and its "+N more" count is silently wrong, with no fetch to recover the rest.
const GROUP_FIRST_WINDOW = 64;

// The above-the-fold window of group ROWS shipped inline with every grouped
// result (the group-list analogue of FIRST_WINDOW). Generous enough to cover a
// tall viewport of group rows plus the scroller's prefetch buffer, so the first
// paint shows no skeleton group rows for a result that fits on screen.
const GROUP_ROW_WINDOW = 60;

function encodeGroupEnvelope(g) {
  return {
    key: g.key,
    anchor: g.anchor ? encodeAtom({ wlEntry: g.anchor, highlights: null, glyph: null }) : null,
    _minScore: g._minScore,
    _maxScore: g._maxScore,
    _count: g._count,
  };
}

function encodeGroup(g) {
  return {
    ...encodeGroupEnvelope(g),
    firstChains: g.chains.slice(0, GROUP_FIRST_WINDOW).map(encodeChain),
  };
}

function encodeGroupFull(g) {
  return {
    ...encodeGroupEnvelope(g),
    chains: g.chains.map(encodeChain),
  };
}

// Histogram buckets the UNFILTERED scores (out-of-range bars stay clickable to
// widen the filter); stats + counts compute over the FILTERED set; `filtered`
// pairs with main's _workerFiltered guard. The same split the flat branch makes —
// collapsing it silently drops the out-of-range bars or mis-reports Min/Max under
// a live filter. Width hints stay on the unfiltered set so columns don't shift
// sideways when a filter cuts the view (main's non-flat slot-width rule).
function groupSummaries(unfiltered, filtered, scope, stack, didFilter) {
  const histScores = bottomLineAtoms(unfiltered).map(e => e.score);
  const statScores = bottomLineAtoms(filtered).map(e => e.score);

  let histogramCounts, histogramLayout = null;
  if (scope === MERGED_ID) {
    histogramCounts = bucketCounts(histScores, ownedAllSourcesAxis);
  } else {
    histogramLayout = getHistogramLayout(ownedCorpus.entries, 'scoped:' + scope);
    histogramCounts = bucketCounts(histScores, histogramLayout);
  }

  let chainCount = 0;
  for (const g of filtered) chainCount += g._count;

  return {
    stats: computeStatsRaw(statScores),
    histogramCounts,
    histogramLayout,
    groupWidthHints: computeGroupWidthHints(unfiltered, stack),
    chainCount,
    groupCount: filtered.length,
    filtered: didFilter,
  };
}

// Pixel width measurement stays on main (it needs live font metrics), so the
// proportional column/anchor widths can't reduce to a scalar here. Ships the
// widest-by-CHARACTER-COUNT representative per column instead; main re-measures
// just those — exact for the digit-string column values shipped today, but a
// future proportional-text column could pick a non-pixel-widest string.
function computeGroupWidthHints(rows, stack) {
  let maxCount = 0;
  let maxAnchorDisplayLen = 0, maxAnchorScoreDigits = 0;
  const groupRow = activeGroupRow(stack);
  const columns = groupRow?.def.group?.columns ?? [];
  const columnWidest = columns.map(() => '');
  for (const g of rows) {
    if (g._count > maxCount) maxCount = g._count;
    if (g.anchor) {
      const dispLen = (g.anchor.display ?? g.anchor.norm).length;
      if (dispLen > maxAnchorDisplayLen) maxAnchorDisplayLen = dispLen;
      const digits = String(g.anchor.score).length;
      if (digits > maxAnchorScoreDigits) maxAnchorScoreDigits = digits;
    }
    for (let c = 0; c < columns.length; c++) {
      const v = String(columns[c].value(g));
      if (v.length > columnWidest[c].length) columnWidest[c] = v;
    }
  }
  const columnWidestByKey = {};
  for (let c = 0; c < columns.length; c++) columnWidestByKey[columns[c].key] = columnWidest[c];
  return { maxCount, groupCount: rows.length, maxAnchorDisplayLen, maxAnchorScoreDigits, columnWidestByKey };
}

function rowIsRich(row) {
  const first = row.atoms[0].wlEntry;
  return row.atoms.some(a =>
    a.glyph != null || a.wlEntry !== first || a.wlEntry.wordlist == null);
}

// ─── My Edits in-place edit/add ── see docs/worker-protocol.md ───────────────

function editsWordlist() {
  return ownedBuilt?.find(wl => wl.type === 'edits') ?? null;
}

function invalidateRescoredCacheFor(wl) {
  wl._rescored = null;
  wl._rescoredMap = null;
  wl._rescoredByNorm = null;
}

// The scoped (single-source) bucket recompute. Unlike computeMergedBucket it
// ignores enabled (a scoped corpus shows its source regardless) and carries
// `rawScore` — the scoped corpus keeps rawScore for the rescore-preview arrow, so
// omitting it would silently diverge on rescored norms.
function recomputeScopedBucket(norm, source) {
  const arr = getRescoredByNorm(source).get(norm) || [];
  const displays = new Set();
  for (const e of arr) if (e.display != null) displays.add(e.display);
  const rows = [];
  const winners = [];
  const variants = displays.size > 0 ? [...displays].sort() : [null];
  for (const variant of variants) {
    const eligible = c => c.display === variant || c.display === null;
    const winner = arr.find(eligible);
    if (!winner) continue;
    const commenter = arr.find(c => eligible(c) && c.comment) ?? winner;
    rows.push({ norm, display: variant, score: winner.score, rawScore: winner.rawScore, comment: commenter.comment || '', wordlist: source });
    winners.push(source);
  }
  rows.sort((a, b) => (a.display ?? '').localeCompare(b.display ?? ''));
  return { rows, winners };
}

// In-place per-norm splice of an owned corpus: entries/byKey/byNorm/_initialChains
// all take the same splice or they silently desync, and sourceCounts shifts by
// the winner delta. bucketFn recomputes one norm's resolved rows.
function spliceOwnedCorpus(cache, affectedNorms, bucketFn) {
  const { entries, byNorm, byKey, sourceCounts } = cache;
  const chains = cache._initialChains;
  const patched = [];
  const countDelta = new Map();
  for (const norm of affectedNorms) {
    const lo = mergedNormLowerBound(entries, norm);
    let hi = lo;
    while (hi < entries.length && entries[hi].norm === norm) hi++;
    // Per-row, not per distinct wordlist: a multi-variant norm one source wins
    // several times contributes one merged entry PER variant, and `winners`
    // (below) is likewise one per row — a Set here would undercount the decrement
    // and drift sourceCounts from main's by the duplicate-winner count.
    for (let i = lo; i < hi; i++) {
      const wl = entries[i].wordlist;
      countDelta.set(wl, (countDelta.get(wl) || 0) - 1);
      byKey.delete(mergeKey(norm, entries[i].display));
    }

    const { rows, winners } = bucketFn(norm);
    entries.splice(lo, hi - lo, ...rows);
    if (chains) chains.splice(lo, hi - lo, ...rows.map(r => ({ atoms: [{ wlEntry: r, highlights: null, glyph: null }] })));
    for (const r of rows) byKey.set(mergeKey(norm, r.display), r);
    if (rows.length) byNorm.set(norm, canonicalNormRow(rows)); else byNorm.delete(norm);

    patched.push({ norm, rows: rows.map(r => ({ norm: r.norm, display: r.display, score: r.score })) });

    for (const wl of winners) countDelta.set(wl, (countDelta.get(wl) || 0) + 1);
  }
  for (const [wl, d] of countDelta) {
    if (!d) continue;
    const sc = sourceCounts.find(s => s.wordlist === wl);
    if (sc) sc.count += d;
    else sourceCounts.push({ wordlist: wl, count: d });
  }
  return patched;
}

// Must mirror actions.js's saveEdit mutation exactly (orig:null → add, else
// edit/move) or the worker's My Edits diverges from main's with no error.
function mutateEditsRawEntries(edits, orig, next) {
  const entryChanged = next.norm !== orig?.norm || next.display !== orig?.display;
  if (orig && entryChanged) {
    const idx = edits.rawEntries.findIndex(e => e.norm === orig.norm && displayOf(e) === orig.display);
    if (idx >= 0) edits.rawEntries.splice(idx, 1);
  }
  const existing = edits.rawEntries.find(e => e.norm === next.norm && displayOf(e) === next.display);
  if (existing) {
    existing.score = next.score;
    existing.comment = next.comment;
  } else {
    edits.rawEntries.push({ norm: next.norm, display: next.display, score: next.score, comment: next.comment });
  }
}

function leanRowFor(norm, display) {
  if (!(ownedMerged && ownedMerged.byKey)) return null;
  const row = ownedMerged.byKey.get(mergeKey(norm, display));
  if (!row) return null;
  const out = {
    norm: row.norm, display: row.display ?? null, score: row.score,
    rawScore: row.rawScore, comment: row.comment || '', sourceId: row.wordlist.dbKey,
  };
  // Only when ownedEntryToIndex indexes ownedMerged (MERGED scope); a scoped
  // ownedCorpus would yield the wrong (scoped) position, so omit it there.
  if (ownedCorpus === ownedMerged) out.index = ownedEntryToIndex.get(row);
  return out;
}

// The affected norms are re-merged from ALL sources (computeMergedBucket over
// ownedBuilt), not just `source` — narrowing to the changed source would silently
// drop a higher-priority list's winner for a norm `source` no longer touches.
function applyOwnedEdit(source, affectedNorms, edited) {
  // computeMergedBucket (not the rawScore-carrying scoped variant): the merged
  // corpus drops rawScore on every entry (a full buildCorpus merge would too), so
  // the in-place splice must drop it to stay byte-identical to a rebuild.
  const mergedPatched = spliceOwnedCorpus(ownedMerged, affectedNorms, norm => computeMergedBucket(norm, ownedBuilt));

  // For MERGED scope ownedCorpus === ownedMerged (spliced above). Scoped to this
  // source it's a distinct single-source build — diverge from that and the scoped
  // view drifts from a rebuild with no error.
  if (ownedScope === source.dbKey && ownedCorpus !== ownedMerged) {
    spliceOwnedCorpus(ownedCorpus, affectedNorms, norm => recomputeScopedBucket(norm, source));
  }

  // A count-changing splice shifts every later index, so reindex fully (mirrors
  // setOwnedCorpus — an incremental reindex silently misindexes).
  ownedEntryToIndex = new Map();
  for (let i = 0; i < ownedCorpus.entries.length; i++) ownedEntryToIndex.set(ownedCorpus.entries[i], i);
  // The pre-search cache's chains hold ownedCorpus.entries by reference; the
  // splice replaced those objects, so stale chains would misindex on the next run.
  invalidatePreSearchCache();

  // The in-place splice leaves the owned corpus current, so (re)assert freshness:
  // a concurrent stale syncConfig build that started before this edit must not be
  // the one that wins — the latestSyncToken bumps in the handlers guard that.
  ownedCorpusFresh = true;

  // editEntry/deleteEntry skip the resync that recomputed these, so a stale
  // axis/counts would silently outlive the edit unless refreshed here.
  ownedConfigVersion++;
  ownedAllSourcesAxis = computeAllSourcesAxis(ownedBuilt);
  const counts = {
    sourceCounts: ownedMerged.sourceCounts.map(s => ({ sourceId: s.wordlist.dbKey, count: s.count })),
    mergedCount: ownedMerged.entries.length,
    version: ownedConfigVersion,
  };

  return { norms: mergedPatched, edited, axis: ownedAllSourcesAxis, counts };
}

// The worker owns the My Edits IDB write (main holds no rawEntries to serialize
// post-flip). Callers post the ack BEFORE awaiting this so ack consumption isn't
// gated on disk I/O.
async function persistEditsCorpus(edits) {
  await idbPut('data_' + edits.dbKey, serializeEntries(sortedEntries(edits.rawEntries)));
}

function ownedCorpusReady(edits) {
  return !!(edits && ownedMerged && ownedCorpus);
}

async function handleEditEntry(data) {
  const { editId, orig, next } = data;
  // Bump at the TOP so an older in-flight syncConfig build (started before this
  // edit, reading pre-edit rawEntries) discards via its commit guard rather than
  // overwriting the edit with stale data — half of the P6d edit-race harden.
  latestSyncToken++;
  const edits = editsWordlist();
  // Reply even when there's nothing to splice, else the bridge's await hangs.
  if (!ownedCorpusReady(edits)) {
    postMessage({ type: 'editAck', editId, norms: [], edited: null, axis: ownedAllSourcesAxis, counts: null });
    return;
  }

  mutateEditsRawEntries(edits, orig ?? null, next);
  invalidateRescoredCacheFor(edits);

  const affected = [...new Set([orig?.norm, next.norm].filter(n => n != null))];
  const ack = applyOwnedEdit(edits, affected, leanRowFor(next.norm, next.display));
  postMessage({ type: 'editAck', editId, ...ack });
  await persistEditsCorpus(edits);
  // Bump AGAIN after the IDB write so a syncConfig that read the pre-write text
  // (started between the ack and the write landing) discards too — the second
  // half of the edit-race harden.
  latestSyncToken++;
}

async function handleDeleteEntry(data) {
  const { editId, norm, display } = data;
  latestSyncToken++;
  const edits = editsWordlist();
  if (!ownedCorpusReady(edits)) {
    postMessage({ type: 'editAck', editId, norms: [], edited: null, axis: ownedAllSourcesAxis, counts: null });
    return;
  }

  // Re-derive the index against the worker's OWN rawEntries — a caller-supplied
  // array index would misindex (the worker owns its rawEntries order).
  const idx = edits.rawEntries.findIndex(e => e.norm === norm && displayOf(e) === display);
  if (idx === -1) {
    postMessage({ type: 'editAck', editId, norms: [], edited: null, axis: ownedAllSourcesAxis, counts: null });
    return;
  }
  edits.rawEntries.splice(idx, 1);
  invalidateRescoredCacheFor(edits);

  const ack = applyOwnedEdit(edits, [norm], null);
  postMessage({ type: 'editAck', editId, ...ack });
  await persistEditsCorpus(edits);
  latestSyncToken++;   // post-write bump — see handleEditEntry
}

// ─── My Edits disk merge ── see docs/worker-protocol.md ──────────────────────
// The worker owns this baseline record; the literal must match disk-sync.js's
// SYNC_WORKER_PREFIX, or the two silently key different records and the 3-way
// merge runs against an absent (empty) ancestor.
const SYNC_WORKER_PREFIX = 'sync_worker_';

// A reconcile may rewrite arbitrarily many norms, so it rebuilds the owned corpus
// WHOLESALE (a per-norm splice silently desyncs against a merge that large).
// Mirrors syncConfig's commit body but synchronous off the resident ownedBuilt.
function rebuildOwnedFromBuilt(scope) {
  ownedConfigVersion++;
  ownedAllSourcesAxis = computeAllSourcesAxis(ownedBuilt);
  ownedMerged = buildScopeCorpus(ownedBuilt, MERGED_ID);
  const scopeCorpus = (scope == null || scope === MERGED_ID)
    ? ownedMerged
    : buildScopeCorpus(ownedBuilt, scope);
  setOwnedCorpus(scopeCorpus, scope ?? MERGED_ID);
  return {
    axis: ownedAllSourcesAxis,
    counts: {
      sourceCounts: ownedMerged.sourceCounts.map(s => ({ sourceId: s.wordlist.dbKey, count: s.count })),
      mergedCount: ownedMerged.entries.length,
      version: ownedConfigVersion,
    },
  };
}

async function handleMergeDisk({ requestId, fileText, conflictChoice }) {
  // Edit-race harden (as editEntry): an older in-flight syncConfig build must
  // discard rather than overwrite the reconciled corpus with stale data.
  latestSyncToken++;
  const edits = editsWordlist();
  if (!ownedCorpusReady(edits)) {
    postMessage({ type: 'mergeResult', requestId, mergedText: null, corpusChanged: false, conflicts: [] });
    return;
  }

  const brec = await idbGet(SYNC_WORKER_PREFIX + edits.dbKey);
  const baseline = brec?.baseline ?? '';
  const { resolved, conflicts } = threeWayMergeEdits(
    parseWordlist(baseline), parseWordlist(fileText), edits.rawEntries);

  // Phase 1 of the two-phase round-trip: report conflicts and apply NOTHING (no
  // corpus mutation, no baseline write) — applying here would double-apply when
  // phase 2 re-merges with the choice. Re-running statelessly is sound because
  // baseline/fileText/corpus are stable while main's modal dialog is open.
  if (conflicts.length && conflictChoice === undefined) {
    postMessage({ type: 'mergeResult', requestId, conflicts, mergedText: null, corpusChanged: false });
    return;
  }
  if (conflictChoice === 'file') {
    for (const c of conflicts) { if (c.file) resolved.set(c.norm, c.file); else resolved.delete(c.norm); }
  }

  const merged = [...resolved.values()];
  const outText = serializeEntries(sortedEntries(merged));
  const corpusChanged = !sameEditsEntries(merged, edits.rawEntries);

  let axis, counts;
  if (corpusChanged) {
    edits.rawEntries = merged;
    invalidateRescoredCacheFor(edits);
    ({ axis, counts } = rebuildOwnedFromBuilt(ownedScope));
    await idbPut('data_' + edits.dbKey, outText);
  }
  await idbPut(SYNC_WORKER_PREFIX + edits.dbKey, { baseline: outText });
  latestSyncToken++;   // post-write bump — see handleEditEntry

  postMessage({
    type: 'mergeResult', requestId, mergedText: outText, corpusChanged, conflicts: [],
    rawEntries: corpusChanged ? merged : undefined, axis, counts,
  });
}

async function handleFlushEdits({ requestId }) {
  const edits = editsWordlist();
  if (!edits) {
    postMessage({ type: 'flushResult', requestId, text: null, changed: false });
    return;
  }
  const text = serializeEntries(sortedEntries(edits.rawEntries));
  const brec = await idbGet(SYNC_WORKER_PREFIX + edits.dbKey);
  // `?? ''` preserves _flushWrite's dedup against the connect-seeded '' baseline:
  // a no-change flush (text === baseline) writes nothing.
  const baseline = brec?.baseline ?? '';
  if (text === baseline) {
    postMessage({ type: 'flushResult', requestId, text, changed: false });
    return;
  }
  await idbPut(SYNC_WORKER_PREFIX + edits.dbKey, { baseline: text });
  postMessage({ type: 'flushResult', requestId, text, changed: true });
}

// ─── Fetch content-diff ── see docs/worker-protocol.md ──────────────────────

// Only ADD/DELETE changes drive the cost: a rescore splices in place (equal-length
// overwrite, no array shift, O(1)), but an add/delete shifts the merged array O(n),
// so the splice batch is O(structuralChanges × n). The cap is absolute, not a
// fraction of n — a fraction would allow O(n²) work and freeze on large lists.
const ADD_DELETE_REBUILD_CAP = 256;

// Bails to { rebuild: true } the instant adds+deletes exceed `cap`: past it the
// caller rebuilds wholesale and never reads affectedNorms, so finishing the scan
// and growing the Set would be wasted O(n) work ahead of an already-O(n log n)
// rebuild. Otherwise { rebuild: false, affectedNorms } covers every changed norm —
// rescores included, since the splice recomputes each one's bucket.
function diffSourceEntries(oldEntries, newEntries, cap) {
  const oldByKey = new Map();
  for (const e of oldEntries) oldByKey.set(mergeKey(e.norm, e.display), e);
  const affected = new Set();
  let structuralChanges = 0;
  for (const e of newEntries) {
    const key = mergeKey(e.norm, e.display);
    const prev = oldByKey.get(key);
    if (!prev) {
      if (++structuralChanges > cap) return { rebuild: true };          // add
      affected.add(e.norm);
    } else {
      oldByKey.delete(key);
      if (prev.score !== e.score || (prev.comment || '') !== (e.comment || '')) affected.add(e.norm);  // rescore
    }
  }
  for (const e of oldByKey.values()) {                                  // delete
    if (++structuralChanges > cap) return { rebuild: true };
    affected.add(e.norm);
  }
  return { rebuild: false, affectedNorms: [...affected] };
}

// SYNCHRONOUS (no IDB write — main owns the data_ write of the raw text), so the
// splice fully lands before the run main posts next; an await here would let the
// run interleave against the un-spliced corpus and ship stale rows.
function handleApplyFetched({ requestId, sourceId, text }) {
  // Edit-race harden (as editEntry): an older in-flight syncConfig build, reading
  // pre-fetch IDB text, must discard via its commit guard rather than clobber this.
  latestSyncToken++;
  const source = ownedBuilt?.find(w => w.dbKey === sourceId) ?? null;
  // No resident build yet, or a brand-new source the last syncConfig didn't carry:
  // applied=false routes main to a full resyncWorkerConfig.
  if (!source || !ownedMerged || !ownedCorpus) {
    postMessage({ type: 'fetchApplied', requestId, applied: false });
    return;
  }

  const oldEntries = source.rawEntries;
  const newEntries = parseWordlist(text);
  const diff = oldEntries.length === 0 ? { rebuild: true } : diffSourceEntries(oldEntries, newEntries, ADD_DELETE_REBUILD_CAP);

  source.rawEntries = newEntries;
  invalidateRescoredCacheFor(source);

  // Fallback rebuild is still cheaper than syncConfig — the OTHER sources stay
  // resident in ownedBuilt rather than being re-read from IDB and re-parsed.
  const ack = diff.rebuild
    ? rebuildOwnedFromBuilt(ownedScope)
    : applyOwnedEdit(source, diff.affectedNorms, null);

  postMessage({ type: 'fetchApplied', requestId, applied: true, mode: diff.rebuild ? 'rebuild' : 'splice', axis: ack.axis, counts: ack.counts });
}

// ─── Self-build (test oracle) ── see docs/worker-protocol.md ─────────────────

// Test-only: forces the NEXT syncConfig build to throw, so the suite can exercise
// the build-failure selfReady (built:false → the client settles the deferred run
// errored, no-hang settle path 4) without corrupting IDB.
let _failNextBuild = false;

async function buildAllSourcesWordlists() {
  if (_failNextBuild) { _failNextBuild = false; throw new Error('forced build failure'); }
  const built = [];
  for (const { sourceId, enabled, type, rescoreRules } of selfConfig.sources) {
    const text = await readWordlistText(sourceId);
    const rawEntries = text ? parseWordlist(text) : [];
    const wl = { dbKey: sourceId, enabled, type: type ?? null, rescoreRules, rawEntries };
    compileRescoreRules(wl);
    built.push(wl);
  }
  return built;
}

function buildScopeCorpus(built, scope) {
  // A scoped build takes the single matching source regardless of enabled (a
  // scoped view shows its source even when disabled); the merged build filters to
  // enabled. Diverging on the enabled handling silently corrupts the scope's view.
  const list = scope === MERGED_ID
    ? built.filter(w => w.enabled)
    : built.filter(w => w.dbKey === scope);
  return buildCorpus(list);
}

async function buildSelfCorpus(scope) {
  return buildScopeCorpus(await buildAllSourcesWordlists(), scope);
}

// ownedEntryToIndex is built here, once per rebuild, NOT per run: a per-run O(n)
// rebuild over a 1M-entry corpus reintroduces the keystroke lag this whole effort
// removes. The pairing with ownedCorpus must stay total — desync silently indexes
// one corpus into the other and corrupts every rendered row.
function setOwnedCorpus(corpus, scope) {
  ownedCorpus = corpus;
  ownedEntryToIndex = new Map();
  for (let i = 0; i < corpus.entries.length; i++) ownedEntryToIndex.set(corpus.entries[i], i);
  ownedScope = scope;
  ownedCorpusFresh = true;
}

function clearOwnedCorpus() {
  ownedCorpus = null;
  ownedEntryToIndex = null;
  ownedCorpusFresh = false;
}

// The cache key 'all' is reused across syncConfigs and the worker uses the
// histogram cache for nothing else, so a stale prior axis would be returned for
// changed scores — clear before computing.
function computeAllSourcesAxis(built) {
  invalidateHistogramLayout();
  return getHistogramLayout(allSourcesScores(built), 'all');
}

function* allSourcesScores(built) {
  for (const wl of built) yield* getRescoredEntries(wl);
}

function corpusForScope(scope) {
  if (scope === MERGED_ID && ownedMerged) return Promise.resolve(ownedMerged);
  // Reflect the live (in-place-spliced) owned corpus for the active scope, so an
  // editEntry splice is observable; a stale build-from-IDB would mask it.
  if (ownedCorpusFresh && ownedScope === scope && ownedCorpus) return Promise.resolve(ownedCorpus);
  return buildSelfCorpus(scope);
}

// Test-only single-entry lookup against a scope's owned corpus.
async function handleQueryEntry({ requestId, scope, norm, display }) {
  try {
    const corpus = await corpusForScope(scope);
    const e = display !== undefined
      ? corpus.byKey.get(mergeKey(norm, display))
      : corpus.byNorm.get(norm);
    const entry = e ? [e.norm, e.display, e.score, e.rawScore, e.comment, e.wordlist.dbKey] : null;
    postMessage({ type: 'entry', requestId, entry });
  } catch {
    postMessage({ type: 'entry', requestId, entry: null });
  }
}

async function dumpCorpus(scope) {
  try {
    const corpus = await corpusForScope(scope);
    const entries = corpus.entries.map(e =>
      [e.norm, e.display, e.score, e.rawScore, e.comment, e.wordlist.dbKey]);
    postMessage({ type: 'corpusDump', scope, entries });
  } catch (e) {
    postMessage({ type: 'corpusDump', scope, entries: [], error: e?.message || String(e) });
  }
}

// ─── Corpus serialize ── see docs/worker-protocol.md ─────────────────────────
// The `sort` flag reproduces two call sites per target: the download is UNSORTED,
// the disk mirror SORTED. Unifying it silently diverges one path's bytes.
function handleSerializeFor({ requestId, scope, format, sort }) {
  const entries = serializeEntriesForScope(scope);
  if (!entries) {
    postMessage({ type: 'serialized', requestId, text: null });
    return;
  }
  const text = serializeEntries(sort ? sortedEntries(entries) : entries, format);
  postMessage({ type: 'serialized', requestId, text });
}

// A non-merged scope is a sourceId, serializing that source's FULL rescored entry
// list — NOT buildScopeCorpus, whose dedup/variant-collapse would diverge from the
// per-source download/mirror bytes.
function serializeEntriesForScope(scope) {
  if (!ownedCorpusFresh) return null;
  if (scope === MERGED_ID) return ownedMerged ? ownedMerged.entries : null;
  const wl = ownedBuilt?.find(w => w.dbKey === scope);
  return wl ? getRescoredEntries(wl) : null;
}

// ─── Message dispatch ────────────────────────────────────────────────────────

onmessage = ({ data }) => {
  switch (data?.type) {
    case 'ping':
      postMessage({ type: 'pong' });
      break;

    case 'run':
      latestRunId = data.runId;
      pending = data;
      drainRuns();
      break;

    case 'cancel':
      latestRunId++;
      pending = null;
      break;

    case 'setScope':
      if (ownedBuilt) {
        const scopeCorpus = (data.scope == null || data.scope === MERGED_ID)
          ? ownedMerged
          : buildScopeCorpus(ownedBuilt, data.scope);
        setOwnedCorpus(scopeCorpus, data.scope ?? MERGED_ID);
      }
      break;

    case 'fetchRows':
      handleFetchRows(data);
      break;

    case 'fetchGroupChains':
      handleFetchGroupChains(data);
      break;

    case 'fetchGroups':
      handleFetchGroups(data);
      break;

    case 'fetchAllRows':
      handleFetchAllRows(data);
      break;

    case 'fetchAllGroups':
      handleFetchAllGroups(data);
      break;

    case 'fetchEditSeed':
      handleFetchEditSeed(data);
      break;

    case 'fetchProvenance':
      handleFetchProvenance(data);
      break;

    case 'editEntry':
      handleEditEntry(data);
      break;

    case 'deleteEntry':
      handleDeleteEntry(data);
      break;

    case 'mergeDisk':
      handleMergeDisk(data);
      break;

    case 'flushEdits':
      handleFlushEdits(data);
      break;

    case 'applyFetched':
      handleApplyFetched(data);
      break;

    case 'syncConfig': {
      selfConfig = data;
      // A newer syncConfig started while this one's async build was in flight —
      // discard the older build (it read stale IDB text); only the latest commits.
      const myToken = ++latestSyncToken;
      // Fall back synchronously until the async (IDB-reading) rebuild settles, so
      // a config change can't serve a stale ownedCorpus in the gap.
      ownedCorpusFresh = false;
      buildAllSourcesWordlists()
        .then(built => {
          if (myToken !== latestSyncToken) return;
          ownedConfigVersion++;
          ownedBuilt = built;
          ownedAllSourcesAxis = computeAllSourcesAxis(built);
          // ownedMerged is held separately from the active-scope ownedCorpus
          // because the config summaries must stay MERGED even on a sync while a
          // scoped view is selected — deriving them from ownedCorpus instead would
          // silently ship the scoped source's counts as the merge's.
          ownedMerged = buildScopeCorpus(built, MERGED_ID);
          const scopeCorpus = (data.scope == null || data.scope === MERGED_ID)
            ? ownedMerged
            : buildScopeCorpus(built, data.scope);
          setOwnedCorpus(scopeCorpus, data.scope ?? MERGED_ID);
        })
        .catch(() => {
          if (myToken !== latestSyncToken) return;
          ownedBuilt = null; ownedMerged = null; clearOwnedCorpus();
        })
        // Reply even on build failure, else the bridge's `await selfReady` hangs
        // to its timeout; the error surfaces later via dumpCorpus. configId echoes
        // the request so each concurrent syncConfig's listener awaits its OWN reply
        // — without it a superseded build's stale-version reply can satisfy (and
        // unregister) the listener waiting on the committed build, so the committed
        // build's reply arrives unheard and the shipped axis silently stays stale.
        // `built` is the deferred-run drain gate on the client: true ⇒ a usable
        // owned corpus committed for THIS scope, so a deferred run can dispatch;
        // false (build failed / superseded by a different scope) ⇒ the client
        // settles the deferred run errored rather than waiting forever (the hang
        // trap). Reads the committed state at settle, not this build's own outcome.
        .finally(() => postMessage({
          type: 'selfReady', configId: data.configId, count: data.sources.length,
          built: ownedCorpusFresh && ownedScope === (data.scope ?? MERGED_ID),
          axis: ownedAllSourcesAxis, version: ownedConfigVersion,
          sourceCounts: ownedMerged
            ? ownedMerged.sourceCounts.map(s => ({ sourceId: s.wordlist.dbKey, count: s.count }))
            : null,
          mergedCount: ownedMerged ? ownedMerged.entries.length : null,
        }));
      break;
    }

    case 'dumpCorpus':
      dumpCorpus(data.scope);
      break;

    case 'queryEntry':
      handleQueryEntry(data);
      break;

    case 'serializeFor':
      handleSerializeFor(data);
      break;

    // Test-only: the suite breaks a tool to exercise the error path, but the
    // worker has its own TOOLS realm a page-side `TOOLS.x.run = …` can't reach,
    // so it patches the worker's copy instead.
    case '__testPatchTool':
      patchToolForTest(data.tool, data.method, data.message);
      break;

    // Test-only: the uncaught throw is the point — it fires the parent Worker's
    // `error` event, the real crash signal the client's fallback path keys on.
    case '__testCrash':
      throw new Error('forced worker crash');

    case '__testFailNextBuild':
      _failNextBuild = true;
      break;
  }
};

const _toolOriginals = new Map();
function patchToolForTest(tool, method, message) {
  const def = TOOLS[tool];
  if (!def) return;
  const sig = `${tool}.${method}`;
  if (!_toolOriginals.has(sig)) _toolOriginals.set(sig, def[method]);
  if (message == null) {
    def[method] = _toolOriginals.get(sig);
  } else {
    def[method] = () => { throw new Error(message); };
  }
}
