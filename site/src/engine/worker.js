// ─── Pipeline worker host ── see docs/worker-protocol.md ─────────────────────

import { MERGED_ID } from '../core/constants.js';
import { canonicalNormRow } from './snapshot.js';
import { TOOLS, makeToolRow } from './tools.js';
import { executePipeline, configureExecutorYield, invalidatePreSearchCache, bottomLineAtoms, applyScoreRangeToRows, rowLastEntry, rowAtoms, collapseRepeatAtoms, streamPlan, cacheGroupStats, currentAtomCount } from './executor.js';
import { sortGroups, sortChainRows, activeGroupRow, groupRowComparator, chainRowComparator, chainSortTier, DEFAULT_SORT_BY_TIER } from './sort.js';
import { configureIO as configureSegmenterIO } from './segmenter.js';
import { configureIO as configurePhoneticsIO } from './phonetics.js';
import { DATA_ASSETS, getDataAsset } from './assets.js';
import { parseWordlist, toNorm, displayOf } from './norm.js';
import { parseRange, matchesRange } from './range.js';
import { compileRescoreRules } from './rescore.js';
import { sourceAccessor, invalidateSourceAccessor, parseWordlistColumns, columnsFromEntries } from './sources.js';
import { buildCorpus, assignFamilies, scopeSourceIds, mergedContributors, resolveEditSeedWinner, mergeKey, mergedNormLowerBound, computeMergedBucket, diffWordlistEntries, isDistinguishing, concreteDisplay } from './corpus.js';
import { familyKey } from './morphology.js';
import { getHistogramLayout, invalidateHistogramLayout, bucketCounts } from './histogram.js';
import { computeStatsRaw } from './stats.js';
import { makeWidthHintAcc, computeWidthHints, computeCorpusWidthBound } from './width-hints.js';
import { compileFlatHighlighters, materializeFlatRow } from './flat-highlight.js';
import { serializeEntries, sortedEntries } from './serialize.js';
import { threeWayMergeEdits, sameEditsEntries } from './edits-merge.js';
import { applyEditsWriteSet, planEntryWrite } from './edit-plan.js';

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
// the shared cache stops being shared (a re-fetch, not an error).
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
function idbDelete(key) {
  return dataDb().then(db => new Promise(resolve => {
    const tx = db.transaction(DATA_IDB_STORE, 'readwrite');
    tx.objectStore(DATA_IDB_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  }));
}
// getKey reports presence without deserializing the value — the asset record can
// be megabytes, and the freshness check must not pull it just to ask "is it cached?"
function idbHasKey(key) {
  return dataDb().then(db => new Promise(resolve => {
    const req = db.transaction(DATA_IDB_STORE, 'readonly').objectStore(DATA_IDB_STORE).getKey(key);
    req.onsuccess = () => resolve(req.result !== undefined);
    req.onerror = () => resolve(false);
  }));
}
// Mirrors storage.js's Storage.readWordlist: wordlist text is keyed 'data_' + dbKey.
function readWordlistText(sourceId) {
  return idbGet('data_' + sourceId);
}
configureSegmenterIO({ idbGet, idbPut });
configurePhoneticsIO({ idbGet, idbPut });

async function handleCheckAssets() {
  for (const asset of DATA_ASSETS) {
    try {
      if (!(await idbHasKey(asset.dataIdbKey))) continue;   // never loaded → skip
      const resp = await fetch(asset.url, { method: 'HEAD' });
      const remote = resp.ok ? resp.headers.get('content-length') : null;
      if (!remote) continue;
      const stored = await idbGet(asset.sizeIdbKey);
      // A cache from before the size key existed has no baseline — establish one
      // now rather than reading its absence as a change and re-downloading.
      if (!stored) { await idbPut(asset.sizeIdbKey, remote); continue; }
      if (remote === stored) continue;
      const wasLoaded = asset.has();
      asset.invalidate();
      await idbDelete(asset.dataIdbKey);
      await idbDelete(asset.sizeIdbKey);
      // Refetch now only when it was in active use; otherwise leave it cleared so
      // the next on-demand load fetches it, rather than forcing an unused download.
      if (wasLoaded) await asset.load();
    } catch { /* offline — leave the cached asset in place */ }
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

let latestRunId = -1;       // the supersession key; a `run`/`cancel` advances it
let pending = null;
let running = false;
let lastFlatResult = null;  // { runId, indices, scope, highlighters } retained to serve `fetchRows`
let lastGroupedResult = null;  // { runId, groups, scope } — full sorted+filtered groups (all chains) retained to serve `fetchGroupChains`
let lastTransformResult = null;  // { runId, chains, scope, version } — sorted+filtered transform chains; grows mid-stream, version bumped per batch for the fetch-drop guard
let diffCounter = 0;
// diffId -> { added, deleted, rescored } (lean, full, sorted) — retained to serve
// `fetchDiffRows`. Unlike lastFlatResult et al., it must NOT be cleared on a run or
// syncConfig: it holds lean copies (names no corpus) and outlives runs; main frees
// each entry by UI reachability (`freeDiff`).
const retainedDiffs = new Map();
let lastUserStackSig = null;
let lastRunCorpus = null;   // the corpus the live _preSearchCache was seeded from
let selfConfig = null;
let ownedBuilt = null;      // the retained per-source rich wordlists from the last syncConfig
let ownedMerged = null;     // eager self-built MERGED corpus; feeds the config summaries regardless of active scope
let ownedCorpus = null;     // eager self-built ACTIVE-scope corpus; the run-path corpus when fresh + scope-matched, else enrichment-only
// An entry's index in ownedCorpus.entries lives on the entry as `_i` (see
// indexCorpusEntries), not a side Map: the Map cost ~40 MB of pure overhead at ~750K
// rows — invisible on desktop, fatal on iOS's shared jetsam budget, so don't reintroduce it.
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

// Frees ~100 MB+ the moment a tool stops needing it; that resident weight can tip
// iOS's shared jetsam budget into a reload. Don't "tidy" invalidate() into also
// deleting the IDB key (as handleCheckAssets does) — re-adding would then re-fetch.
function evictUnusedAssets(serialized) {
  const needed = new Set();
  for (const { tool } of serialized) {
    const asset = TOOLS[tool]?.asset;
    if (asset) needed.add(asset);
  }
  for (const asset of DATA_ASSETS) {
    if (asset.has() && !needed.has(asset.key)) asset.invalidate();
  }
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
      await (req.type === 'repatch' ? runRepatch(req) : runOne(req));
    }
  } finally {
    running = false;
  }
}

// The pre-search cache persists the user-stack result across runs for the keystroke
// fast-path; the caller must drop it when the user stack changes. On main that's
// ToolStack's mutation handlers — signals the worker never sees, so it detects the
// change itself, else a tool add/remove/edit silently runs against the previous
// stack's cached pre-search state. Second guard: the cache's chains hold
// ownedCorpus.entries objects by reference, so a rebuilt corpus (scope switch, config
// re-sync, background splice) with an unchanged user stack must also drop it, or the
// cached chains point at the previous corpus's entries and silently mis-encode rows.
function preRunInvalidate(serialized) {
  const userStackSig = JSON.stringify(serialized.slice(0, -1));
  if (userStackSig !== lastUserStackSig) {
    invalidatePreSearchCache();
    evictUnusedAssets(serialized);
    lastUserStackSig = userStackSig;
  }
  if (ownedCorpus !== lastRunCorpus) {
    invalidatePreSearchCache();
    lastRunCorpus = ownedCorpus;
  }
}

async function runOne({ runId, stack: serialized, sort, scope, existsQuery, scoreRange, rebindQuery }) {
  const signal = makeSignalShim(runId);
  const stack = deserializeStack(serialized);

  // The UI always supplies a sort; a direct runOnWorker caller may not. Unlike the
  // flat emitter, the transform/tuple emitters crash on a null comparator (`.sort(null)`).
  if (!sort?.length) sort = [{ key: DEFAULT_SORT_BY_TIER[chainSortTier(stack)], dir: 'asc' }];

  preRunInvalidate(serialized);

  let out;
  const streamState = { streamed: false };
  // The view spec is a MUTABLE object shared with the retained result: a mid-stream
  // `reproject` mutates it in place, and the emitter re-reads it each batch, so a
  // sort/filter change re-derives the view without re-running the join.
  const viewSpec = { sort, scoreRange };
  try {
    const { tier } = streamPlan(stack);
    const emit = tier === 'flat' ? makeStreamEmitter(runId, viewSpec, scope, stack, signal, streamState)
      : tier === 'tuple' ? makeTupleStreamEmitter(runId, viewSpec, scope, stack, signal, streamState)
      : tier === 'transform' ? makeTransformStreamEmitter(runId, viewSpec, scope, stack, signal, streamState)
      : null;
    out = await executePipeline(ownedCorpus, stack, signal, emit);
  } catch (e) {
    if (isAbortError(e) || signal.aborted) return;
    postMessage({ type: 'error', runId, stackRowIndex: stackRowIndex(stack, e), message: e?.message || String(e) });
    return;
  }
  if (signal.aborted) return;

  postResult(runId, out, viewSpec, scope, stack, existsQuery, rebindQuery, streamState.streamed);
}

// Refresh-on-consent's fast path for a FLAT displayed result: re-derive the join over
// the freshly-spliced corpus and ship a `reprojected` snapshot — a background structural
// update refreshes the set in place, no chip. Only flat qualifies: its rows match
// per-entry, so an add/delete is a cheap re-scan; a combination tier (tuple/group/
// transform) can gain a result from an added entry PARTNERING an existing one — a
// re-scan misses that, so those still freeze + chip. Rides drainRuns because running its
// executePipeline concurrently with a real run corrupts the shared _preSearchCache and
// retained result, both silently.
async function runRepatch({ runId, reprojectId, stack: serialized, sort, scoreRange }) {
  // A scope/config change since the run would make the retained rows name the wrong
  // entries (the handleReproject guard); reply stale so main re-runs instead of tearing.
  if (!lastFlatResult || lastFlatResult.runId !== runId || !ownedCorpus || !ownedCorpusFresh || ownedScope !== lastFlatResult.scope) {
    postMessage({ type: 'reprojectStale', runId, reprojectId });
    return;
  }
  const signal = makeSignalShim(runId);
  const stack = deserializeStack(serialized);
  if (!sort?.length) sort = [{ key: DEFAULT_SORT_BY_TIER[chainSortTier(stack)], dir: 'asc' }];
  preRunInvalidate(serialized);

  let out;
  try {
    out = await executePipeline(ownedCorpus, stack, signal);   // buffered (no emit): one atomic snapshot, not a strobing re-stream
  } catch (e) {
    // Aborted ⇒ a newer run superseded us and refreshes the display, so reply nothing
    // (main's pending reproject self-heals); a real error re-runs.
    if (isAbortError(e) || signal.aborted) return;
    postMessage({ type: 'reprojectStale', runId, reprojectId });
    return;
  }
  if (signal.aborted) return;
  if (out.laneKind !== 'single' || out.rows.some(rowIsRich)) {
    postMessage({ type: 'reprojectStale', runId, reprojectId });
    return;
  }

  const { scope } = lastFlatResult;
  const prevVersion = lastFlatResult.version;
  const join = new Array(out.rows.length);
  for (let i = 0; i < out.rows.length; i++) join[i] = rowLastEntry(out.rows[i])._i;
  lastFlatResult = deriveFlatResult(runId, join, { sort, scoreRange }, scope, stack);   // fresh join, live corpus — drops the gap-cover pin
  lastGroupedResult = null;
  lastTransformResult = null;
  lastFlatResult.version = prevVersion + 1;   // keep the shared counter monotonic so a late fetchRows still drops
  postFlatSnapshot('reprojected', runId, reprojectId);
}

// The client's latest reported viewport for the active streaming run. The
// streaming emitters ship THIS window each batch instead of a fixed top window,
// so a user scrolled anywhere sees their rows refresh live and never strobe to
// skeletons — the point of viewport-driven streaming. See worker-protocol.md.
let pendingViewport = null;

// The window a streaming snapshot ships: the reported viewport (clamped), or the
// top `defaultSize` before this run's first viewport message has arrived (the
// first partial precedes it, and a fresh run resets to the top regardless).
function streamWindow(runId, total, defaultSize) {
  if (pendingViewport && pendingViewport.runId === runId) {
    const lo = Math.max(0, Math.min(pendingViewport.start | 0, total));
    const hi = Math.max(lo, Math.min(pendingViewport.end | 0, total));
    return { lo, hi };
  }
  return { lo: 0, hi: Math.min(defaultSize, total) };
}

// Reading `viewSpec` per batch (not captured constants) is what lets a mid-stream
// reproject change the sort/filter. `version` is load-bearing: the client drops a
// fetched window the order has moved past, else a mid-stream scroll paints a torn
// mixed-snapshot view. Summaries are CUMULATIVE — main keeps no resident scores, so a
// per-batch delta it can't accumulate would leave the stats/histogram stale.
function makeStreamEmitter(runId, viewSpec, scope, stack, signal, streamState) {
  const widthAcc = makeWidthHintAcc();
  const join = [];         // every produced _i, unfiltered — the retained join
  return batchRows => {
    if (signal.aborted) return;
    const intervals = viewSpec.scoreRange ? parseRange(viewSpec.scoreRange) : null;
    const cmp = flatComparator(viewSpec.sort, ownedCorpus);
    const batchIdx = [];
    for (const row of batchRows) {
      const e = rowLastEntry(row);
      join.push(e._i);
      if (intervals && !matchesRange(e.score, intervals)) continue;
      batchIdx.push(e._i);
      widthAcc.add(e);
    }
    if (batchIdx.length === 0) return;   // join grew but nothing in-range — no snapshot (join.push already ran)

    batchIdx.sort(cmp);
    const batchIndices = Int32Array.from(batchIdx);

    if (!streamState.streamed) {
      streamState.streamed = true;
      lastFlatResult = { runId, version: 0, indices: batchIndices, join, scope, viewSpec, highlighters: compileFlatHighlighters(stack), familySort: isFamilySort(viewSpec.sort) };
      lastGroupedResult = null;
      lastTransformResult = null;
    } else {
      lastFlatResult.indices = mergeSortedIndices(lastFlatResult.indices, batchIndices, cmp);
    }
    lastFlatResult.version++;   // one monotonic counter shared with reproject, so a mid-stream reproject can't collide the version a fetch drops on
    lastFlatResult.familySort = isFamilySort(viewSpec.sort);
    lastFlatResult.histogram = flatHistogram(join, scope, ownedCorpus);
    lastFlatResult.widthHints = widthAcc.hints();
    lastFlatResult.stats = flatViewStats(lastFlatResult.indices, ownedCorpus);

    postFlatSnapshot('partial', runId);
  };
}

// Shared by the streaming `partial` and the reprojected snapshot so the two can't drift.
function postFlatSnapshot(type, runId, reprojectId) {
  const r = lastFlatResult;
  const { lo, hi } = streamWindow(runId, r.indices.length, FIRST_WINDOW);
  postMessage({
    type, runId, reprojectId, version: r.version, total: r.indices.length, windowStart: lo,
    firstRows: buildFlatRows(lo, hi),
    widthHints: r.widthHints,
    stats: r.stats,
    histogramCounts: r.histogram.counts, histogramLayout: r.histogram.layout,
    filtered: !!(r.viewSpec.scoreRange && parseRange(r.viewSpec.scoreRange)),
  });
}

// Resolve against a pinned result's frozen snapshot, not live `ownedCorpus`: inlining
// this to `ownedCorpus` would silently tear a pin once a background splice shifts positions.
function corpusFor(r) {
  return r?.pinnedCorpus ?? ownedCorpus;
}

// The join is UNFILTERED, which is what lets a widening filter re-admit rows the
// narrower view had dropped — filter the join itself and widening can't recover them.
function flatViewIndices(join, viewSpec, corpus) {
  const intervals = viewSpec.scoreRange ? parseRange(viewSpec.scoreRange) : null;
  const entries = corpus.entries;
  const arr = [];
  for (const i of join) {
    if (intervals && !matchesRange(entries[i].score, intervals)) continue;
    arr.push(i);
  }
  arr.sort(flatComparator(viewSpec.sort, corpus));
  return Int32Array.from(arr);
}

// Histogram over the UNFILTERED join scores (out-of-range bars stay clickable), so
// it is invariant under a sort/filter reproject — only a join change moves it.
function flatHistogram(join, scope, corpus) {
  const entries = corpus.entries;
  const scores = new Int32Array(join.length);
  for (let i = 0; i < join.length; i++) scores[i] = entries[join[i]].score;
  if (scope === MERGED_ID) return { counts: bucketCounts(scores, ownedAllSourcesAxis), layout: null };
  const layout = getHistogramLayout(entries, 'scoped:' + scope);
  return { counts: bucketCounts(scores, layout), layout };
}

function flatViewStats(view, corpus) {
  const entries = corpus.entries;
  const scores = new Int32Array(view.length);
  for (let i = 0; i < view.length; i++) scores[i] = entries[view[i]].score;
  return computeStatsRaw(scores);
}

function mergeSortedIndices(a, b, cmp) {
  const out = new Int32Array(a.length + b.length);
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) out[k++] = cmp(a[i], b[j]) <= 0 ? a[i++] : b[j++];
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
}

// The grouped-tier sibling of makeStreamEmitter. The g.key tiebreak makes the
// incremental merge a total order equal to a from-scratch sortGroups, so completion
// adopts it. Reads `viewSpec` per batch so a mid-stream reproject re-sorts/re-filters.
function makeTupleStreamEmitter(runId, viewSpec, scope, stack, signal, streamState) {
  const join = [];   // every produced tuple group, unfiltered — the retained join
  return batchGroups => {
    if (signal.aborted) return;
    const intervals = viewSpec.scoreRange ? parseRange(viewSpec.scoreRange) : null;
    const cmp = groupRowComparator(viewSpec.sort, stack);
    // Stats on EVERY join group, not just the visible ones: groupSummaries reads
    // _count off the unfiltered join for its width hints.
    for (const g of batchGroups) { cacheGroupStats(g); join.push(g); }

    const visible = intervals ? applyScoreRangeToRows(batchGroups, intervals, 'record') : batchGroups;
    if (visible.length === 0) return;   // join grew but no in-range tuple — no view change

    const sortedBatch = cmp ? [...visible].sort(cmp) : visible;
    if (!streamState.streamed) {
      streamState.streamed = true;
      lastFlatResult = null;
      lastTransformResult = null;
      lastGroupedResult = { runId, version: 0, groups: sortedBatch, join, scope, viewSpec, stack, laneKind: 'record', summaries: null };
    } else {
      lastGroupedResult.groups = cmp
        ? mergeSortedGroups(lastGroupedResult.groups, sortedBatch, cmp)
        : lastGroupedResult.groups.concat(sortedBatch);
    }
    lastGroupedResult.version++;
    lastGroupedResult.summaries = groupSummaries(join, lastGroupedResult.groups, scope, stack, !!intervals);
    postGroupSnapshot('partialGroups', runId);
  };
}

// Shared by the streaming `partialGroups` and the reprojected snapshot so the two
// can't drift; the version is the retained result's, monotonic across both.
function postGroupSnapshot(type, runId, reprojectId) {
  const r = lastGroupedResult;
  const { lo, hi } = streamWindow(runId, r.groups.length, GROUP_ROW_WINDOW);
  postMessage({
    type, runId, reprojectId, version: r.version,
    laneKind: r.laneKind, atomCount: currentAtomCount(r.stack),
    total: r.groups.length, windowStart: lo,
    firstGroups: r.groups.slice(lo, hi).map(encodeGroup),
    ...r.summaries,
  });
}

// The transform tier's stream emitter (sibling of makeTupleStreamEmitter), folding
// mirror pairs online into `seen` — the retained UNFILTERED join. It keeps the
// first-arrived direction (only promoting the glyph): the corpus emits in norm order,
// so the lower-norm-join direction arrives first and is the canonical survivor. It
// rebuilds the atoms array for the ↔ promotion rather than mutating atoms the
// executor's terminal unify still reads — in-place mutation would corrupt them. Reads
// `viewSpec` per batch so a mid-stream reproject re-sorts/re-filters.
function makeTransformStreamEmitter(runId, viewSpec, scope, stack, signal, streamState) {
  const seen = new Map();   // fwd-key → survivor row (every direction) — the retained join
  return batchRows => {
    if (signal.aborted) return;
    const intervals = viewSpec.scoreRange ? parseRange(viewSpec.scoreRange) : null;
    const cmp = chainRowComparator(viewSpec.sort, stack);
    const chainOk = chain => rowAtoms(chain).every(a => matchesRange(a.wlEntry.score, intervals));
    const newInRange = [];
    for (const raw of batchRows) {
      const row = { atoms: collapseRepeatAtoms(raw.atoms), matched: raw.matched };
      const norms = row.atoms.map(a => a.wlEntry.norm);
      const fwd = norms.join('\0');
      const rev = norms.slice().reverse().join('\0');
      let folded = false;
      if (fwd !== rev) {
        const mirror = seen.get(rev);
        if (mirror) {
          const mScores = mirror.atoms.map(a => a.wlEntry.score);
          const rScores = row.atoms.map(a => a.wlEntry.score).reverse();
          if (mScores.every((s, j) => s === rScores[j])) {
            mirror.atoms = mirror.atoms.map(a => a.glyph ? { ...a, glyph: '↔' } : a);
            folded = true;
          }
        }
      }
      if (!folded) {
        seen.set(fwd, row);
        if (!intervals || chainOk(row)) newInRange.push(row);
      }
    }
    if (!streamState.streamed) {
      streamState.streamed = true;
      lastFlatResult = null;
      lastGroupedResult = null;
      lastTransformResult = { runId, version: 0, chains: [], join: seen, scope, viewSpec, stack, summaries: null };
    }
    if (newInRange.length) {
      newInRange.sort(cmp);
      lastTransformResult.chains = mergeSortedGroups(lastTransformResult.chains, newInRange, cmp);
    }
    lastTransformResult.version++;
    lastTransformResult.summaries = transformSummaries([...seen.values()], lastTransformResult.chains, scope, !!intervals);
    postTransformSnapshot('partialChains', runId);
  };
}

// Shared by the streaming `partialChains` and the reprojected snapshot so the two
// can't drift; the version is the retained result's, monotonic across both.
function postTransformSnapshot(type, runId, reprojectId) {
  const r = lastTransformResult;
  const { lo, hi } = streamWindow(runId, r.chains.length, FIRST_WINDOW);
  postMessage({
    type, runId, reprojectId, version: r.version,
    laneKind: 'single', atomCount: currentAtomCount(r.stack),
    total: r.chains.length, windowStart: lo,
    firstChains: r.chains.slice(lo, hi).map(encodeChain),
    ...r.summaries,
  });
}

// A view-only change (sort / score-range) re-derives the view over the RETAINED join,
// never re-running the pipeline. Same freshness discipline as fetchRows: a scope/config
// change since the run makes the retained rows name the wrong entries, so reply
// `reprojectStale` and let main re-run. Otherwise mutate the shared viewSpec IN PLACE —
// a still-streaming emitter reads it next batch — and re-derive in place, keeping `join`
// growing (a fresh object would strand rows produced after the reproject).
function handleReproject({ runId, reprojectId, sort, scoreRange, recomputeHistogram }) {
  const r = lastFlatResult || lastGroupedResult || lastTransformResult;
  if (!r || r.runId !== runId || !ownedCorpus || !ownedCorpusFresh || ownedScope !== r.scope) {
    postMessage({ type: 'reprojectStale', runId, reprojectId });
    return;
  }
  r.viewSpec.sort = sort;
  r.viewSpec.scoreRange = scoreRange;
  if (r === lastFlatResult) reprojectFlat(r, reprojectId, recomputeHistogram);
  else if (r === lastGroupedResult) reprojectGroup(r, reprojectId);
  else reprojectTransform(r, reprojectId);
}

// A rescore reproject changes the join's scores, so recompute or the flat histogram
// silently lags the edit; sort/filter leave it (invariant over the unfiltered join).
function reprojectFlat(r, reprojectId, recomputeHistogram) {
  const corpus = corpusFor(r);
  r.indices = flatViewIndices(r.join, r.viewSpec, corpus);
  r.familySort = isFamilySort(r.viewSpec.sort);
  r.stats = flatViewStats(r.indices, corpus);
  r.widthHints = computeWidthHints(r.indices, corpus);
  if (recomputeHistogram) r.histogram = flatHistogram(r.join, r.scope, corpus);
  r.version++;
  postFlatSnapshot('reprojected', r.runId, reprojectId);
}

function reprojectGroup(r, reprojectId) {
  const intervals = r.viewSpec.scoreRange ? parseRange(r.viewSpec.scoreRange) : null;
  const view = intervals ? applyScoreRangeToRows(r.join, intervals, r.laneKind) : r.join;
  r.groups = sortGroups(view, r.viewSpec.sort, r.stack);
  r.summaries = groupSummaries(r.join, r.groups, r.scope, r.stack, !!intervals);
  r.version++;
  postGroupSnapshot('reprojected', r.runId, reprojectId);
}

function reprojectTransform(r, reprojectId) {
  const intervals = r.viewSpec.scoreRange ? parseRange(r.viewSpec.scoreRange) : null;
  const rows = transformJoinRows(r.join);
  const view = intervals ? applyScoreRangeToRows(rows, intervals, 'single') : rows;
  r.chains = sortChainRows(view, r.viewSpec.sort, r.stack);
  r.summaries = transformSummaries(rows, r.chains, r.scope, !!intervals);
  r.version++;
  postTransformSnapshot('reprojected', r.runId, reprojectId);
}

function mergeSortedGroups(a, b, cmp) {
  const out = new Array(a.length + b.length);
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) out[k++] = cmp(a[i], b[j]) <= 0 ? a[i++] : b[j++];
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
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
function postResult(runId, { rows, atomCount, laneKind, capped }, viewSpec, scope, stack, existsQuery, rebindQuery, streamed) {
  const base = { type: 'result', runId, laneKind, atomCount, capped: !!capped, ranAgainstOwned: true };

  if (laneKind !== 'single') {
    lastFlatResult = null;
    lastTransformResult = null;
    if (streamed) {
      // Adopt, don't re-derive: the emitter merged with a total comparator, so a
      // recompute here could only mask a streaming bug (worker-protocol.md forbids it).
      lastGroupedResult.version++;
    } else {
      lastGroupedResult = deriveGroupResult(runId, rows, viewSpec, scope, stack, laneKind);
    }
    const r = lastGroupedResult;
    // The shipped length is NOT the group count — main sizes from summaries, else it
    // silently drops every group past the inline window.
    postMessage({ ...base, payload: { groups: r.groups.slice(0, GROUP_ROW_WINDOW).map(encodeGroup), ...r.summaries } });
    return;
  }

  if (rows.some(rowIsRich)) {
    lastFlatResult = null;
    lastGroupedResult = null;
    if (streamed) {
      lastTransformResult.join = transformJoinRows(lastTransformResult.join);   // freeze the seen Map
      lastTransformResult.version++;
    } else {
      lastTransformResult = deriveTransformResult(runId, rows, viewSpec, scope, stack);
    }
    const r = lastTransformResult;
    postMessage({
      ...base,
      payload: {
        firstChains: r.chains.slice(0, FIRST_WINDOW).map(encodeChain),
        chainCount: r.chains.length,
        ...r.summaries,
        ...resolveRebindExists(existsQuery, rebindQuery),
        rebindQuery: rebindQuery || null,
      },
    });
    return;
  }

  if (streamed) {
    lastFlatResult.version++;
  } else {
    const join = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) join[i] = rowLastEntry(rows[i])._i;
    lastFlatResult = deriveFlatResult(runId, join, viewSpec, scope, stack);
  }
  lastGroupedResult = null;
  lastTransformResult = null;
  const r = lastFlatResult;
  const { existsInScope, rebindEntry, rebindExists } = resolveRebindExists(existsQuery, rebindQuery);
  postMessage({ ...base, payload: {
    count: r.indices.length, widthHints: r.widthHints, stats: r.stats,
    histogramCounts: r.histogram.counts, histogramLayout: r.histogram.layout,
    existsInScope, rebindQuery: rebindQuery || null, rebindEntry, rebindExists,
    filtered: !!(viewSpec.scoreRange && parseRange(viewSpec.scoreRange)),
    firstRows: buildFlatRows(0, Math.min(FIRST_WINDOW, r.indices.length)),
  } });
}

// Shared by the non-streamed terminal and reproject so a re-derived flat result is
// structurally identical to a streamed one (else the two paths silently drift).
function deriveFlatResult(runId, join, viewSpec, scope, stack) {
  const indices = flatViewIndices(join, viewSpec, ownedCorpus);
  return {
    runId, version: 1, indices, join, scope, viewSpec,
    highlighters: compileFlatHighlighters(stack), familySort: isFamilySort(viewSpec.sort),
    histogram: flatHistogram(join, scope, ownedCorpus), stats: flatViewStats(indices, ownedCorpus),
    widthHints: computeWidthHints(indices, ownedCorpus),
  };
}

function deriveGroupResult(runId, join, viewSpec, scope, stack, laneKind) {
  const intervals = viewSpec.scoreRange ? parseRange(viewSpec.scoreRange) : null;
  // Filter with the RESULT's laneKind: a record (tuple) drops out-of-range rows whole
  // (never trims a positional lane), a set trims cluster members. Filter BEFORE the
  // sort so the group axes read post-filter _minScore/count; groupSummaries bins the
  // histogram over the unfiltered join, stats over the view.
  const view = intervals ? applyScoreRangeToRows(join, intervals, laneKind) : join;
  const groups = sortGroups(view, viewSpec.sort, stack);
  return {
    runId, version: 0, groups, join, scope, viewSpec, stack, laneKind,
    summaries: groupSummaries(join, groups, scope, stack, !!intervals),
  };
}

function deriveTransformResult(runId, join, viewSpec, scope, stack) {
  const intervals = viewSpec.scoreRange ? parseRange(viewSpec.scoreRange) : null;
  const rows = transformJoinRows(join);
  const view = intervals ? applyScoreRangeToRows(rows, intervals, 'single') : rows;
  const chains = sortChainRows(view, viewSpec.sort, stack);
  return {
    runId, version: 1, chains, join: rows, scope, viewSpec, stack,
    summaries: transformSummaries(rows, chains, scope, !!intervals),
  };
}

// The transform join is the emitter's `seen` Map mid-stream, an array once frozen; a
// caller must not assume one shape.
function transformJoinRows(join) {
  return join instanceof Map ? [...join.values()] : join;
}

// The above-the-fold window shipped inline with every flat result. Generous
// enough to cover a tall viewport plus the scroller's prefetch buffer, so the
// first paint never shows a skeleton for a result that fits on screen.
const FIRST_WINDOW = 60;

function shipContributors(e) {
  return ownedCorpus === ownedMerged
    ? mergedContributors(e.norm, e.display, ownedBuilt)
    : { sourceIds: scopeSourceIds(e.norm, ownedBuilt, ownedScope), activeIds: [e.wordlist.dbKey] };
}

// ─── Windowed row fetch ── see docs/worker-protocol.md ───────────────────────
// Shared by windowed `fetchRows` and unwindowed `fetchAllRows` so the two can't
// diverge — export bytes would silently drift from the rendered table otherwise.
// Always rich post-flip: main has no corpus to decode an index against, so a fetch
// for a window whose ownedCorpus is no longer fresh+scope-matched is dropped
// upstream (fetchResultFresh) rather than shipping un-decodable indices here.
function buildFlatRows(lo, hi) {
  const { indices, highlighters, familySort } = lastFlatResult;
  const entries = corpusFor(lastFlatResult).entries;
  const rows = [];
  for (let i = lo; i < hi; i++) {
    const e = entries[indices[i]];
    // Multiple stacked highlighting searches materialize one atom slot each (all
    // the same word), so ship the full atom sequence — taking only atoms[0] would
    // silently drop the extra highlight lines a 3-search row renders.
    const atoms = materializeFlatRow(e, highlighters).atoms
      .map(a => ({ highlights: a.highlights, glyph: a.glyph }));
    const { sourceIds, activeIds } = shipContributors(e);
    const row = {
      norm: e.norm, display: e.display, score: e.score, rawScore: e.rawScore,
      comment: e.comment, sourceId: e.wordlist.dbKey, sourceIds, activeIds, atoms,
    };
    // Per-row family-boundary flag for the demarcation bracket — set only under
    // the Entry sort, where same-family rows are contiguous; under any other sort
    // it would mark false family runs. The client reads it off each cached row.
    if (familySort) row.familyStart = i === 0 || e.family !== entries[indices[i - 1]].family;
    rows.push(row);
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
  postMessage({ type: 'rows', requestId, runId, version: lastFlatResult.version, start: lo, rows: buildFlatRows(lo, hi) });
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
    type: 'groups', requestId, runId, version: lastGroupedResult.version ?? 0, start: lo,
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

// ─── Windowed / full transform-chain fetch ── see docs/worker-protocol.md ────
// The transform analogue of fetchResultFresh: lastTransformResult.chains hold their
// atoms by reference to THAT run's corpus, so a scope/config change between the run
// and the fetch makes them name the wrong rows — drop silently; main re-fetches.
function transformResultFresh(runId) {
  return !!lastTransformResult && lastTransformResult.runId === runId
    && ownedCorpus && ownedCorpusFresh && ownedScope === lastTransformResult.scope;
}

function handleFetchTransformRows({ requestId, runId, start, end }) {
  if (!transformResultFresh(runId)) return;
  const lo = Math.max(0, start | 0);
  const hi = Math.min(lastTransformResult.chains.length, end | 0);
  postMessage({
    type: 'transformRows', requestId, runId, start: lo, version: lastTransformResult.version,
    chains: lastTransformResult.chains.slice(lo, hi).map(encodeChain),
  });
}

function handleFetchAllTransformRows({ requestId, runId }) {
  if (!transformResultFresh(runId)) return;
  postMessage({
    type: 'allTransformRows', requestId, runId,
    chains: lastTransformResult.chains.map(encodeChain),
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

// ─── Related-entries fetch ── see docs/worker-protocol.md ────────────────────
// Scanned from ownedMerged (the full enabled merge), NOT the active-scope
// ownedCorpus: Related entries ignores scope, so a single-list scope still surfaces
// every relative across the merged wordlist. Membership is family ∪ same-norm — the
// differently-spelled same-norm siblings (Boney M. / Boney M) have no other home,
// since provenance now scopes to one spelling. ownedCorpusFresh gates ownedMerged
// the same way the edit-seed fetch does (see its note).
function handleFetchFamily({ requestId, norm, display, boundNorm = norm, boundDisplay = display ?? null }) {
  let members = [];
  if (ownedMerged && ownedCorpusFresh) {
    // `bound` is the entry the panel is on: the bold `current` while the query
    // still names it, but dropped from its own relatives once a live rename types a
    // different spelling — the old spelling unifies into the new one on save, so it
    // is not a sibling of it.
    const bound = ownedMerged.byKey.get(mergeKey(boundNorm, boundDisplay ?? null)) ?? ownedMerged.byNorm.get(boundNorm) ?? null;
    const renaming = norm !== boundNorm || (display ?? null) !== (boundDisplay ?? null);
    // Re-key family from the query text, not bound.family: a live rename types a
    // spelling not yet in the corpus, whose family must pull the relatives. Equals
    // the stamped family on a real click (familyKey(displayOf(e))), so clicks are unchanged.
    const family = familyKey(display ?? norm, ownedMerged.vocab);
    for (const e of ownedMerged.entries) {
      if (e === bound && renaming) continue;
      if (e.norm === norm || (family && e.family === family)) {
        members.push({
          norm: e.norm, display: e.display ?? null, score: e.score,
          comment: e.comment || '', sourceId: e.wordlist.dbKey, current: e === bound,
        });
      }
    }
    members.sort((a, b) => (a.display ?? a.norm).localeCompare(b.display ?? b.norm) || a.norm.localeCompare(b.norm));
  }
  postMessage({ type: 'family', requestId, members });
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
  // footer preview for the seed text while deriving the provenance target from
  // the clicked atom (typedRaw ''); collapsing them would mis-pick the open table.
  const previewSrc = previewRaw ?? typedRaw;
  const preview = previewSrc && previewSrc.trim()
    ? (ownedMerged.byNorm.get(toNorm(previewSrc)) || null)
    : null;

  const provPreview = typedRaw && typedRaw.trim()
    ? (ownedMerged.byNorm.get(toNorm(typedRaw)) || null)
    : null;
  const targetNorm = provPreview ? provPreview.norm
    : typedRaw && typedRaw.trim() ? toNorm(typedRaw)
    : clickedNorm;
  // A click scopes provenance to the one clicked spelling (other spellings ride
  // Related entries); typing a rename stays norm-scoped as a collision check.
  const targetDisplay = typedRaw && typedRaw.trim() ? null : clickedDisplay ?? null;

  const rows = [];
  if (targetNorm != null) {
    for (const wl of ownedBuilt) {
      const group = sourceAccessor(wl).rescoredForNorm(targetNorm);
      if (group === undefined) continue;
      // Mirror the merge's display eligibility (mergedContributors) or the table
      // drifts from it: a bare entry unifies with any spelling, a concrete one must match.
      const distinguishing = isDistinguishing(group);
      for (const e of group) {
        const d = concreteDisplay(e, targetNorm, distinguishing);
        if (targetDisplay != null && d != null && d !== targetDisplay) continue;
        rows.push({
          sourceId: wl.dbKey,
          enabled: wl.enabled !== false,
          entry: { norm: e.norm, display: e.display ?? null, score: e.score, rawScore: e.rawScore, comment: e.comment || '' },
        });
      }
    }
  }

  const previewOut = preview && {
    norm: preview.norm, display: preview.display ?? null,
    score: preview.score, comment: preview.comment || '', sourceId: preview.wordlist.dbKey,
  };
  postMessage({ type: 'provenance', requestId, preview: previewOut ?? null, rows });
}

// ─── Entry-edit plan ── see docs/worker-protocol.md ──────────────────────────
// Guard on ownedBuilt ALONE, not ownedCorpusFresh: planEntryWrite reads only the
// per-source rescore indexes (sourceAccessor/computeMergedBucket over ownedBuilt),
// never ownedMerged/ownedCorpus, and releasePriorCorpus spares ownedBuilt across a
// syncConfig gap — so a null plan means only the genuine pre-first-sync window.
function handlePlanEdit({ requestId, mode, clicked, typed, trashScore }) {
  if (!ownedBuilt) { postMessage({ type: 'editPlan', requestId, plan: null }); return; }
  const plan = planEntryWrite({ mode, clicked, typed, sources: ownedBuilt, trashScore });
  postMessage({ type: 'editPlan', requestId, plan });
}

// Native (norm.localeCompare) order ties differently from the `entry` axis,
// which falls to score — so even `entry`/asc is sorted, never left as-is, or the
// main thread (which no longer sorts) would show a subtly wrong order.
const FLAT_SORT_AXES = {
  entry: {
    // display omits dir → follows the primary toggle (see sort.js's entry axis):
    // the within-family order continues the family-clustered alphabetical sort.
    primary: e => e.family || displayOf(e),
    tiebreakers: [{ p: e => displayOf(e) }, { p: e => e.score, dir: -1 }],
  },
  length: {
    primary: e => e.norm.length,
    tiebreakers: [{ p: e => e.score, dir: -1 }, { p: e => displayOf(e), dir: 1 }],
  },
  score: {
    primary: e => e.score,
    tiebreakers: [{ p: e => e.norm.length, dir: -1 }, { p: e => displayOf(e), dir: 1 }],
  },
  comment: {
    primary: e => e.comment || '',
    tiebreakers: [{ p: e => displayOf(e), dir: 1 }],
  },
};
function cmpVal(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
// Parallel copy of composeSortAxis's composition (FLAT_SORT_AXES has a different
// axis shape): drift from it and the flat tier sorts unlike the group/single
// tiers with no error to catch it. The `ia - ib` final tiebreak is load-bearing,
// not cosmetic: without a total order the streaming emitter's incremental merge
// is batch-order dependent, so the rendered sort would shift with scan timing.
function flatComparator(sort, runCorpus) {
  const picks = (sort || []).filter(s => s && FLAT_SORT_AXES[s.key]);
  const list = picks.length ? picks : [{ key: 'entry', dir: 'asc' }];
  const keyed = list.map(s => ({ p: FLAT_SORT_AXES[s.key].primary, dir: s.dir === 'desc' ? -1 : 1 }));
  const primaryDir = list[0].dir === 'desc' ? -1 : 1;
  const tiebreakers = FLAT_SORT_AXES[list[0].key].tiebreakers;
  const entries = runCorpus.entries;
  return (ia, ib) => {
    const a = entries[ia], b = entries[ib];
    for (const k of keyed) {
      const c = cmpVal(k.p(a), k.p(b)) * k.dir;
      if (c !== 0) return c;
    }
    for (const tb of tiebreakers) {
      const c = cmpVal(tb.p(a), tb.p(b)) * (tb.dir ?? primaryDir);
      if (c !== 0) return c;
    }
    return ia - ib;
  };
}

function isFamilySort(sort) {
  return ((sort || []).filter(s => s && FLAT_SORT_AXES[s.key])[0]?.key ?? 'entry') === 'entry';
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
    const { sourceIds, activeIds } = shipContributors(wlEntry);
    out = {
      norm: wlEntry.norm, display: wlEntry.display, score: wlEntry.score,
      rawScore: wlEntry.rawScore, comment: wlEntry.comment, sourceId: wlEntry.wordlist.dbKey,
      sourceIds, activeIds,
    };
  }
  if (highlights != null) out.h = highlights;
  if (glyph != null) out.g = glyph;
  return out;
}

function encodeChain(chain) {
  return { atoms: rowAtoms(chain).map(encodeAtom) };
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
// A multi-key group tool (Rhymes) puts one chain in several groups, so the
// per-chain aggregates count distinct chains, not memberships.
function distinctChains(groups) {
  const seen = new Set();
  const out = [];
  for (const g of groups) for (const c of g.chains) if (!seen.has(c)) { seen.add(c); out.push(c); }
  return out;
}

function groupSummaries(unfiltered, filtered, scope, stack, didFilter) {
  const distinctFiltered = distinctChains(filtered);
  const histScores = bottomLineAtoms(distinctChains(unfiltered)).map(e => e.score);
  const statScores = bottomLineAtoms(distinctFiltered).map(e => e.score);

  let histogramCounts, histogramLayout = null;
  if (scope === MERGED_ID) {
    histogramCounts = bucketCounts(histScores, ownedAllSourcesAxis);
  } else {
    histogramLayout = getHistogramLayout(ownedCorpus.entries, 'scoped:' + scope);
    histogramCounts = bucketCounts(histScores, histogramLayout);
  }

  const chainCount = distinctFiltered.length;

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

// Shared by the flat and transform branches so their entry-panel re-anchor + exists
// answers can't drift: a FULL-corpus byKey→byNorm lookup that re-anchors even to an
// entry filtered OUT of the visible (range-filtered) view.
function resolveRebindExists(existsQuery, rebindQuery) {
  const existsInScope = existsQuery ? ownedCorpus.byNorm.has(toNorm(existsQuery)) : null;
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
  return { existsInScope, rebindEntry, rebindExists };
}

// The transform-tier analogue of groupSummaries: histogram over the UNFILTERED
// bottom-line scores (out-of-range bars stay clickable), stats over the filtered.
function transformSummaries(unfiltered, filtered, scope, didFilter) {
  const histScores = bottomLineAtoms(unfiltered).map(e => e.score);
  const statScores = bottomLineAtoms(filtered).map(e => e.score);
  let histogramCounts, histogramLayout = null;
  if (scope === MERGED_ID) {
    histogramCounts = bucketCounts(histScores, ownedAllSourcesAxis);
  } else {
    histogramLayout = getHistogramLayout(ownedCorpus.entries, 'scoped:' + scope);
    histogramCounts = bucketCounts(histScores, histogramLayout);
  }
  return {
    stats: computeStatsRaw(statScores),
    histogramCounts,
    histogramLayout,
    widthHints: computeTransformWidthHints(unfiltered, filtered),
    filtered: didFilter,
  };
}

// Char-count hints for the entry/len/score slots (main re-measures pixels). The
// glyph prefix needs a pixel width main owns, so ship the widest glyph atom's text
// length SEPARATELY from the overall widest — main adds the measured glyph width to
// the former and maxes the two, reproducing the per-atom slot need.
function computeTransformWidthHints(unfiltered, filtered) {
  let maxDisplayLen = 0, maxGlyphDisplayLen = 0;
  for (const row of unfiltered) {
    for (const a of row.atoms) {
      const dl = displayOf(a.wlEntry).length;
      if (dl > maxDisplayLen) maxDisplayLen = dl;
      if (a.glyph != null && dl > maxGlyphDisplayLen) maxGlyphDisplayLen = dl;
    }
  }
  let maxLenDigits = 1, maxScoreDigits = 1, maxRawDigits = 0;
  for (const row of filtered) {
    for (const a of row.atoms) {
      const e = a.wlEntry;
      const ld = String(e.norm.length).length;
      if (ld > maxLenDigits) maxLenDigits = ld;
      const sd = String(e.score).length;
      if (sd > maxScoreDigits) maxScoreDigits = sd;
      if (e.rawScore != null && e.rawScore !== e.score) {
        maxRawDigits = Math.max(maxRawDigits, String(e.rawScore).length);
      }
    }
  }
  return { maxDisplayLen, maxGlyphDisplayLen, maxLenDigits, maxScoreDigits, maxRawDigits };
}

function rowIsRich(row) {
  if (!row.atoms) return false;   // a bare seed entry is a plain, single-atom flat row
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
  wl._rescoredByNorm = null;
  invalidateSourceAccessor(wl);
}

// The scoped (single-source) bucket recompute. Unlike computeMergedBucket it
// ignores enabled (a scoped corpus shows its source regardless) and carries
// `rawScore` — the scoped corpus keeps rawScore for the rescore-preview arrow, so
// omitting it would silently diverge on rescored norms.
function recomputeScopedBucket(norm, source) {
  const arr = sourceAccessor(source).rescoredForNorm(norm) ?? [];
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
    rows.push({ norm, display: variant, score: winner.score, rawScore: winner.rawScore, comment: commenter.comment || '', wordlist: source, family: '', _i: -1 });
    winners.push(source);
  }
  rows.sort((a, b) => (a.display ?? '').localeCompare(b.display ?? ''));
  return { rows, winners };
}

// In-place per-norm splice of an owned corpus: entries/byKey/byNorm all take the
// same splice or they silently desync, and sourceCounts shifts by the winner delta.
// bucketFn recomputes one norm's resolved rows. (The pipeline seeds straight off
// `entries`, so there is no separate chain array to keep in lockstep.)
//
// `replaced` is true when any norm swapped its row objects; the caller keeps the
// pre-search cache (its chains hold those objects) only while it stays false.
function spliceOwnedCorpus(cache, affectedNorms, bucketFn) {
  const { entries, byNorm, byKey, sourceCounts } = cache;
  const countDelta = new Map();
  let replaced = false;
  for (const norm of affectedNorms) {
    const lo = mergedNormLowerBound(entries, norm);
    let hi = lo;
    while (hi < entries.length && entries[hi].norm === norm) hi++;

    const { rows, winners } = bucketFn(norm);

    // Per-row, not per distinct wordlist: a multi-variant norm one source wins
    // several times contributes one merged entry PER variant — a Set here would
    // undercount the decrement and drift sourceCounts from main's.
    for (let i = lo; i < hi; i++) countDelta.set(entries[i].wordlist, (countDelta.get(entries[i].wordlist) || 0) - 1);
    for (const wl of winners) countDelta.set(wl, (countDelta.get(wl) || 0) + 1);

    // Reconcile onto the existing row objects when the edit leaves this norm's
    // (norm, display) set intact: preserving their identity is what lets the caller
    // keep the pre-search cache. A replacing splice would strand the cache's chains.
    const inPlace = rows.length === hi - lo
      && rows.every((r, k) => (r.display ?? null) === (entries[lo + k].display ?? null));
    if (inPlace) {
      for (let k = 0; k < rows.length; k++) {
        const old = entries[lo + k], r = rows[k];
        old.score = r.score; old.comment = r.comment;
        old.wordlist = r.wordlist; old.family = r.family;
        if ('rawScore' in r) old.rawScore = r.rawScore;
      }
      byNorm.set(norm, canonicalNormRow(entries.slice(lo, hi)));
    } else {
      replaced = true;
      for (let i = lo; i < hi; i++) byKey.delete(mergeKey(norm, entries[i].display));
      entries.splice(lo, hi - lo, ...rows);
      for (const r of rows) byKey.set(mergeKey(norm, r.display), r);
      if (rows.length) byNorm.set(norm, canonicalNormRow(rows)); else byNorm.delete(norm);
    }
  }
  for (const [wl, d] of countDelta) {
    if (!d) continue;
    const sc = sourceCounts.find(s => s.wordlist === wl);
    if (sc) sc.count += d;
    else sourceCounts.push({ wordlist: wl, count: d });
  }
  return replaced;
}

// Spliced rows key against the last full build's vocab; an edit's own new tokens
// are absent until the next rebuild, affecting only that entry's anchoring.
function withFamilies(bucket, vocab) {
  for (const row of bucket.rows) row.family = familyKey(displayOf(row), vocab);
  return bucket;
}

// The affected norms are re-merged from ALL sources (computeMergedBucket over
// ownedBuilt), not just `source` — narrowing to the changed source would silently
// drop a higher-priority list's winner for a norm `source` no longer touches.
function applyOwnedEdit(source, affectedNorms) {
  // computeMergedBucket (not the rawScore-carrying scoped variant): the merged
  // corpus drops rawScore on every entry (a full buildCorpus merge would too), so
  // the in-place splice must drop it to stay byte-identical to a rebuild.
  let replaced = spliceOwnedCorpus(ownedMerged, affectedNorms, norm => withFamilies(computeMergedBucket(norm, ownedBuilt), ownedMerged.vocab));

  // For MERGED scope ownedCorpus === ownedMerged (spliced above). Scoped to this
  // source it's a distinct single-source build — diverge from that and the scoped
  // view drifts from a rebuild with no error.
  if (ownedScope === source.dbKey && ownedCorpus !== ownedMerged) {
    replaced = spliceOwnedCorpus(ownedCorpus, affectedNorms, norm => withFamilies(recomputeScopedBucket(norm, source), ownedCorpus.vocab)) || replaced;
  }

  // Both gate on a row-OBJECT swap. A replacing splice shifts later indices (so
  // restamp `_i`, mirroring setOwnedCorpus) and strands the pre-search cache's
  // chains on the old objects (so drop it). A pure in-place reconcile — a
  // score/comment edit reshaping no norm's variant set — leaves positions and
  // identities, so both can be skipped and the next run reuses the cached stack.
  if (replaced) {
    indexCorpusEntries(ownedCorpus);
    invalidatePreSearchCache();
  }

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
    sourceTotals: sourceTotalsFrom(ownedBuilt),
    mergedCount: ownedMerged.entries.length,
    mergedWidthBound: computeCorpusWidthBound(ownedMerged),
    version: ownedConfigVersion,
  };

  // `replaced` looks redundant with its local use above, but main also reads it off
  // the editAck to ride a streaming tuple run through a key-stable edit (replaced
  // false) instead of restarting it — prune it from the return and that silently breaks.
  return { replaced, axis: ownedAllSourcesAxis, counts };
}

// The worker owns the My Edits IDB write (main holds no rawEntries to serialize
// post-flip). Callers post the ack BEFORE awaiting this so ack consumption isn't
// gated on disk I/O.
async function persistEditsCorpus(edits) {
  await idbPut('data_' + edits.dbKey, serializeEntries(sortedEntries(edits.rawEntries)));
}

// Gate on ownedBuilt, NOT ownedMerged/ownedCorpus: releasePriorCorpus frees the latter
// for a syncConfig's async-rebuild gap, and gating on them there made edit/merge handlers
// silently no-op and drop the change. ownedBuilt is spared, so ensureOwnedCorpus rebuilds.
function ownedCorpusReady(edits) {
  return !!(edits && ownedBuilt);
}

// Rebuild from the resident ownedBuilt if a syncConfig gap freed the corpus. Safe because
// the handlers bump latestSyncToken first, so the superseded in-flight build then discards.
function ensureOwnedCorpus() {
  if (ownedBuilt && (!ownedMerged || !ownedCorpus)) rebuildOwnedFromBuilt(ownedScope);
}

async function handleEditEntry(data) {
  const { editId, writes } = data;
  // Bump at the TOP so an older in-flight syncConfig build (started before this
  // edit, reading pre-edit rawEntries) discards via its commit guard rather than
  // overwriting the edit with stale data — half of the P6d edit-race harden.
  latestSyncToken++;
  const edits = editsWordlist();
  // Reply even when there's nothing to splice, else the bridge's await hangs.
  if (!ownedCorpusReady(edits)) {
    postMessage({ type: 'editAck', editId, axis: ownedAllSourcesAxis, counts: null });
    return;
  }
  ensureOwnedCorpus();

  applyEditsWriteSet(edits.rawEntries, writes);
  invalidateRescoredCacheFor(edits);

  const affected = [...new Set([...(writes.deletes || []), ...(writes.upserts || [])].map(w => w.norm))];
  const ack = applyOwnedEdit(edits, affected);
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
    postMessage({ type: 'editAck', editId, axis: ownedAllSourcesAxis, counts: null });
    return;
  }

  ensureOwnedCorpus();

  // Re-derive the index against the worker's OWN rawEntries — a caller-supplied
  // array index would misindex (the worker owns its rawEntries order).
  const idx = edits.rawEntries.findIndex(e => e.norm === norm && displayOf(e) === display);
  if (idx === -1) {
    postMessage({ type: 'editAck', editId, axis: ownedAllSourcesAxis, counts: null });
    return;
  }
  edits.rawEntries.splice(idx, 1);
  invalidateRescoredCacheFor(edits);

  const ack = applyOwnedEdit(edits, [norm]);
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
      sourceTotals: sourceTotalsFrom(ownedBuilt),
      mergedCount: ownedMerged.entries.length,
      mergedWidthBound: computeCorpusWidthBound(ownedMerged),
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
    for (const c of conflicts) { if (c.file) resolved.set(c.key, c.file); else resolved.delete(c.key); }
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
  } else {
    // The top-of-handler token bump discarded any in-flight syncConfig, so an
    // unchanged merge in its gap must still leave the corpus rebuilt, not freed.
    ensureOwnedCorpus();
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

// Per-section cap on the shipped rows. Uncapped, a full-replace re-import would ship
// ~600k entry objects and re-materialize them on main — silently defeating the very
// retention this stage removes. Counts stay true; the dialog virtual-scrolls.
const DIFF_SHIP_CAP = 500;

const leanDiffEntry = e => ({ norm: e.norm, display: e.display ?? null, score: e.score, comment: e.comment || '' });

// Lean-copy diffWordlistEntries' arrays for the wire + retention. The copies must
// be lean, not the raw entries: `deleted` holds OLD entries, and retaining those by
// reference in retainedDiffs would pin the whole prior corpus generation that
// `source.rawEntries = newEntries` is meant to drop (a silent iOS-fatal leak).
function diffForFetch(oldEntries, newEntries) {
  const { added, deleted, rescored, affectedNorms } = diffWordlistEntries(oldEntries, newEntries);
  return {
    added: added.map(leanDiffEntry),
    deleted: deleted.map(leanDiffEntry),
    rescored: rescored.map(r => ({ entry: leanDiffEntry(r.entry), oldScore: r.oldScore, score: r.score })),
    addedCount: added.length, deletedCount: deleted.length, rescoredCount: rescored.length,
    affectedNorms,
  };
}

function pinFlatSnapshot(snapshot) {
  if (snapshot && lastFlatResult && !lastFlatResult.pinnedCorpus) lastFlatResult.pinnedCorpus = { entries: snapshot };
}

// Refresh-on-consent's per-tier fork. Flat REPATCHES (runRepatch); the pin only bridges
// the gap until that lands — a fetchRows against the shifted positions between the splice
// and the repatch would silently tear. Grouped/transform freeze on their object refs + chip.
function refreshFork(structural, preSplice) {
  const repatch = structural && !!lastFlatResult;
  if (repatch) pinFlatSnapshot(preSplice);
  return { repatch, stale: structural && !lastFlatResult };
}

// SYNCHRONOUS (no IDB write — main owns the data_ write of the raw text), so the
// splice fully lands before the run main posts next; an await here would let the
// run interleave against the un-spliced corpus and ship stale rows.
function handleApplyFetched({ requestId, sourceId, text, background }) {
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

  // refresh-on-consent: snapshot the flat result's backing array BEFORE the splice
  // shifts positions (a later slice would capture the shifted array → silent tear).
  // Flat pins by position; grouped/transform hold object refs and freeze on their own.
  const displayed = lastFlatResult || lastGroupedResult || lastTransformResult;
  const scopeAffected = !!displayed && (displayed.scope === MERGED_ID || displayed.scope === sourceId);
  const preSplice = background && scopeAffected && lastFlatResult ? ownedCorpus.entries.slice() : null;

  // Materialize the OLD raw entries (transient views over the current store) before
  // rebuilding — the diff reads them while the new store is built.
  const oldEntries = sourceAccessor(source).collectRaw();
  const newEntries = parseWordlist(text);
  const wasEmpty = oldEntries.length === 0;

  // Re-importing My Edits keeps it object-backed (the edit splice mutates
  // rawEntries); a non-Edits re-import rebuilds the columnar store.
  if (source.type === 'edits') source.rawEntries = newEntries;
  else source.cols = columnsFromEntries(newEntries, source.rescoreRules);
  invalidateRescoredCacheFor(source);

  // Skip the diff entirely on a first population: nothing downstream reads it (the
  // rebuild ignores affectedNorms, main shows only "Loaded N"), so running it would
  // be an O(n) scan over ~600k entries for output no one consumes.
  if (wasEmpty) {
    const ack = rebuildOwnedFromBuilt(ownedScope);
    const { stale, repatch } = refreshFork(background && scopeAffected, preSplice);
    postMessage({
      type: 'fetchApplied', requestId, applied: true, mode: 'rebuild', stale, repatch,
      axis: ack.axis, counts: ack.counts, rescoreInputs: sourceRescoreInputsFrom(ownedBuilt),
      wasEmpty: true, oldCount: 0, newCount: newEntries.length, diffId: null,
    });
    return;
  }

  const diff = diffForFetch(oldEntries, newEntries);

  // Fallback rebuild is still cheaper than syncConfig — the OTHER sources stay
  // resident in ownedBuilt rather than being re-read from IDB and re-parsed.
  const rebuild = (diff.addedCount + diff.deletedCount) > ADD_DELETE_REBUILD_CAP;
  const ack = rebuild
    ? rebuildOwnedFromBuilt(ownedScope)
    : applyOwnedEdit(source, diff.affectedNorms);

  const { stale, repatch } = refreshFork(background && scopeAffected && (rebuild || ack.replaced), preSplice);

  // Mint a diffId only for a viewable change: main frees it via its toast/dialog, so
  // a diffId with no such owner (a no-op re-import → "up to date" alert) would never
  // be freed — a permanent Map entry. No change ⇒ null, nothing retained.
  let diffId = null;
  if (diff.addedCount || diff.deletedCount || diff.rescoredCount) {
    diffId = ++diffCounter;
    retainedDiffs.set(diffId, { added: diff.added, deleted: diff.deleted, rescored: diff.rescored });
  }

  postMessage({
    type: 'fetchApplied', requestId, applied: true, mode: rebuild ? 'rebuild' : 'splice', stale, repatch,
    axis: ack.axis, counts: ack.counts, rescoreInputs: sourceRescoreInputsFrom(ownedBuilt),
    wasEmpty: false, oldCount: oldEntries.length, newCount: newEntries.length, diffId,
    added: diff.added.slice(0, DIFF_SHIP_CAP),
    deleted: diff.deleted.slice(0, DIFF_SHIP_CAP),
    rescored: diff.rescored.slice(0, DIFF_SHIP_CAP),
    addedCount: diff.addedCount, deletedCount: diff.deletedCount, rescoredCount: diff.rescoredCount,
  });
}

// A missing diffId (freed, or lost on respawn) drops with no reply rather than
// erroring — like fetchResultFresh, main falls back to its inline window.
function handleFetchDiffRows({ requestId, diffId, section, start, end }) {
  const d = retainedDiffs.get(diffId);
  if (!d) return;
  const arr = d[section];
  if (!arr) return;
  const lo = Math.max(0, start | 0);
  const hi = Math.min(arr.length, end | 0);
  postMessage({ type: 'diffRows', requestId, diffId, section, start: lo, rows: arr.slice(lo, hi) });
}

function freeDiff({ diffId }) {
  retainedDiffs.delete(diffId);
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
    const wl = { dbKey: sourceId, enabled, type: type ?? null, rescoreRules };
    compileRescoreRules(wl);
    // My Edits stays object-backed because the edit splice mutates rawEntries in
    // place each keystroke; every other source is the lean columnar cold store.
    if (wl.type === 'edits') wl.rawEntries = text ? parseWordlist(text) : [];
    else wl.cols = parseWordlistColumns(text ?? '', wl.rescoreRules);
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
  const corpus = buildCorpus(list);
  assignFamilies(corpus);
  return corpus;
}

async function buildSelfCorpus(scope) {
  return buildScopeCorpus(await buildAllSourcesWordlists(), scope);
}

// Stamps each entry's `_i` once per rebuild, NOT per run: a per-run O(n) restamp
// over a 1M-entry corpus reintroduces the keystroke lag this whole effort removes.
// The stamp must stay total with ownedCorpus — a desync silently indexes one corpus
// into the other and corrupts every rendered row.
function indexCorpusEntries(corpus) {
  const { entries } = corpus;
  for (let i = 0; i < entries.length; i++) entries[i]._i = i;
}

function setOwnedCorpus(corpus, scope) {
  ownedCorpus = corpus;
  indexCorpusEntries(corpus);
  ownedScope = scope;
  ownedCorpusFresh = true;
}

function clearOwnedCorpus() {
  ownedCorpus = null;
  ownedCorpusFresh = false;
}

// Free the prior corpus before a rebuild so the worker never holds two at once —
// the transient that doubled the iOS footprint and crashed config changes. Every
// pin must go together or the old corpus stays alive and the spike persists. Safe
// ONLY because ownedCorpusFresh is false here: reads are fresh-gated and rebuild,
// runs defer until selfReady, so freeing now can't mis-encode rows against a
// half-gone corpus. ownedBuilt is spared — edit/merge handlers read it in the gap.
function releasePriorCorpus() {
  ownedMerged = null;
  clearOwnedCorpus();
  lastRunCorpus = null;
  invalidatePreSearchCache();
  lastFlatResult = lastGroupedResult = lastTransformResult = null;
}

// The cache key 'all' is reused across syncConfigs and the worker uses the
// histogram cache for nothing else, so a stale prior axis would be returned for
// changed scores — clear before computing.
function computeAllSourcesAxis(built) {
  invalidateHistogramLayout();
  return getHistogramLayout(allSourcesScores(built), 'all');
}

function* allSourcesScores(built) {
  for (const wl of built) yield* sourceAccessor(wl).scores();
}

// Distinct from ownedMerged.sourceCounts: that counts merge WINNERS, so a disabled
// or fully-shadowed source is absent from it entirely — folding totals there would
// silently drop those sources' counts. Totals come from ownedBuilt (every source).
function sourceTotalsFrom(built) {
  return built ? built.map(wl => ({ sourceId: wl.dbKey, total: sourceAccessor(wl).count })) : null;
}

// Distinct (rawScore, normLength) pairs per source — the minimal sufficient input
// for main's rescoringChangesScores (rescoreEntry reads only score + norm length).
// Main applies the LIVE editor draft to these locally, so the bake gate stays correct
// while the user edits rules the worker hasn't been re-synced with. Shipped only on
// config builds / content fetches (never per-edit), so the O(corpus) pass is cheap.
function sourceRescoreInputsFrom(built) {
  if (!built) return null;
  return built.map(wl => {
    const seen = new Set();
    const pairs = [];
    for (const e of sourceAccessor(wl).collectRaw()) {
      const key = e.score + ':' + e.norm.length;
      if (!seen.has(key)) { seen.add(key); pairs.push([e.score, e.norm.length]); }
    }
    return { sourceId: wl.dbKey, pairs };
  });
}

function corpusForScope(scope) {
  // Both fast-paths gate on ownedCorpusFresh: a syncConfig clears it synchronously
  // but leaves ownedMerged/ownedCorpus stale-non-null until the async rebuild
  // commits, so an ungated read in that gap answers from the pre-config corpus.
  // The scoped path also reflects in-place editEntry splices a rebuild would mask.
  if (scope === MERGED_ID && ownedCorpusFresh && ownedMerged) return Promise.resolve(ownedMerged);
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
function handleSerializeFor({ requestId, scope, format }) {
  const entries = serializeEntriesForScope(scope);
  // null ⇒ not fresh: ask main to retry, never to write. A text reply (even "") tells
  // main to write; collapsing the two reintroduces the 0-byte clobber of the synced file.
  if (entries === null) {
    postMessage({ type: 'serialized', requestId, retry: true });
    return;
  }
  const text = serializeEntries(sortedEntries(entries), format);
  postMessage({ type: 'serialized', requestId, text });
}

// A non-merged scope is a sourceId, serializing that source's FULL rescored entry
// list — NOT buildScopeCorpus, whose dedup/variant-collapse would diverge from the
// per-source download/mirror bytes.
function serializeEntriesForScope(scope) {
  if (!ownedCorpusFresh) return null;
  if (scope === MERGED_ID) return ownedMerged ? ownedMerged.entries : null;
  const wl = ownedBuilt?.find(w => w.dbKey === scope);
  return wl ? sourceAccessor(wl).collectRescored() : null;
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

    case 'viewport':
      pendingViewport = data;
      break;

    case 'reproject':
      handleReproject(data);
      break;

    case 'repatch':
      // Idle only: a live or queued run already recomputes everything, so the repatch is
      // moot — drop it (main's pending reproject self-heals on its next view op). Queuing
      // it would let it clobber, or run against, that run's shared pipeline state.
      if (!running && !pending) { pending = data; drainRuns(); }
      break;

    case 'setScope':
      if (ownedBuilt) {
        const scopeCorpus = (data.scope == null || data.scope === MERGED_ID)
          ? ownedMerged
          : buildScopeCorpus(ownedBuilt, data.scope);
        setOwnedCorpus(scopeCorpus, data.scope ?? MERGED_ID);
      }
      break;

    case 'check-assets':
      handleCheckAssets();
      break;

    case 'preload-asset': {
      const asset = getDataAsset(data.asset);
      if (asset) asset.load().catch(() => {});
      break;
    }

    case 'fetchRows':
      handleFetchRows(data);
      break;

    case 'fetchDiffRows':
      handleFetchDiffRows(data);
      break;

    case 'freeDiff':
      freeDiff(data);
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

    case 'fetchTransformRows':
      handleFetchTransformRows(data);
      break;

    case 'fetchAllTransformRows':
      handleFetchAllTransformRows(data);
      break;

    case 'fetchEditSeed':
      handleFetchEditSeed(data);
      break;

    case 'fetchFamily':
      handleFetchFamily(data);
      break;

    case 'fetchProvenance':
      handleFetchProvenance(data);
      break;

    case 'planEdit':
      handlePlanEdit(data);
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
      releasePriorCorpus();
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
          scope: data.scope ?? MERGED_ID,
          built: ownedCorpusFresh && ownedScope === (data.scope ?? MERGED_ID),
          axis: ownedAllSourcesAxis, version: ownedConfigVersion,
          sourceCounts: ownedMerged
            ? ownedMerged.sourceCounts.map(s => ({ sourceId: s.wordlist.dbKey, count: s.count }))
            : null,
          sourceTotals: sourceTotalsFrom(ownedBuilt),
          rescoreInputs: sourceRescoreInputsFrom(ownedBuilt),
          mergedCount: ownedMerged ? ownedMerged.entries.length : null,
          mergedWidthBound: ownedMerged ? computeCorpusWidthBound(ownedMerged) : null,
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

    // Test-only: shrink the executor's yield interval so a small corpus crosses
    // many yield boundaries and streams `partial`s, which it never would under the
    // shipped ~30ms budget.
    case '__testYieldInterval':
      configureExecutorYield({ intervalMs: data.intervalMs });
      break;

    // Test-only: a page-side hasCmuDict() reads main's realm (never loaded), not the
    // worker's, so the eviction suite must ask the worker for the true loaded state.
    case '__testAssetState':
      postMessage({ type: '__testAssetState', state: Object.fromEntries(DATA_ASSETS.map(a => [a.key, a.has()])) });
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
