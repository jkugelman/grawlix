// ─── Pipeline worker client ──────────────────────────────────────────────────
// The worker URL anchors on main.js's import.meta.url (injected at boot), not
// this module's. Bundling inlines this file into main.js at src/ while site/
// serves it from src/ui/ — a literal relative to import.meta.url would resolve
// to different places in the two builds. main.js lands at src/main.js in both,
// so anchoring there makes one relative path correct everywhere, deploy base
// included (no leading-slash hardcoding).

import { currentAtomCount } from '../engine/executor.js';
import { anyAssetAutoUpdates } from '../engine/assets.js';
import { state, bumpErrorMarks } from '../data/state.js';
import { setShippedAllSourcesAxis, setShippedScopedLayout } from '../data/derived.js';
import { setShippedConfigCounts, setShippedRescoreInputs } from '../data/merge.js';
import { MERGED_ID, UMIAQ_CAP_MOBILE, UMIAQ_CAP_DESKTOP } from '../core/constants.js';
import { isMobile } from '../core/platform.js';
import { AppView, activeScoreRange } from './app-view.js';
import { entryPanelRebindQuery, streamFlatBatchToScroller, streamGroupBatchToScroller, streamTransformBatchToScroller, ingestReprojectToScroller, setPipelineProgress } from './entries-table.js';

let workerBaseURL = null;
let worker = null;

function workerOwnsCorpus() { return true; }
export { workerOwnsCorpus };

const MAX_CRASHES = 2;
let crashCount = 0;
let workerUnavailable = false;

// Client-side mirror of which scope the worker's owned corpus is fresh for, so a
// run decides synchronously whether to dispatch or defer. The sync read is what
// makes deferred-run registration race-free (see runOnWorker). `null` ⇒ not fresh
// for any scope, so every run defers until the first build's selfReady lands.
let ownedFreshScope = null;
function ownedFreshFor(scope) { return ownedFreshScope === scope; }

// Resolves on the next COMMITTED build (selfReady with built:true), or immediately
// when one already stands. A save whose plan came back null (the pre-first-sync
// ownedBuilt===null window) awaits this before retrying, so it never silently drops
// the edit. A timeout resolves false so a wedged/absent worker bails, not hangs.
let _committedWaiters = [];
export function whenWorkerCommitted(timeout = 5000) {
  if (ownedFreshScope !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const entry = ok => { clearTimeout(timer); _committedWaiters = _committedWaiters.filter(w => w !== entry); resolve(ok); };
    const timer = setTimeout(() => entry(false), timeout);
    _committedWaiters.push(entry);
  });
}

export function configurePipelineWorker({ baseURL }) {
  workerBaseURL = baseURL;
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./engine/worker.js', workerBaseURL), { type: 'module' });
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', onWorkerCrash);
    worker.addEventListener('messageerror', onWorkerCrash);
    // FIFO-first so the cap is set before any run; a respawn re-sends it here.
    worker.postMessage({ type: 'configTools', umiaqMaxResults: isMobile() ? UMIAQ_CAP_MOBILE : UMIAQ_CAP_DESKTOP });
  }
  return worker;
}

function onWorkerCrash() {
  if (worker) {
    worker.removeEventListener('message', onWorkerMessage);
    worker.removeEventListener('error', onWorkerCrash);
    worker.removeEventListener('messageerror', onWorkerCrash);
    worker.terminate();
    worker = null;
  }
  // A respawned worker rebuilds from IDB, so nothing is fresh until its selfReady
  // lands; clearing the mirror forces every in-flight/incoming run to defer until
  // then (settle path 3) rather than dispatching against the dead worker.
  ownedFreshScope = null;

  crashCount++;

  const run = pendingRun;
  pendingRun = null;
  const deferred = deferredRun;
  deferredRun = null;

  if (crashCount >= MAX_CRASHES) {
    // There's no main corpus to rescue onto, so a run can't be re-run — latch
    // unavailable and settle every in-flight AND deferred awaiter errored (and
    // every future run via runOnWorker's short-circuit), or they dangle and wedge
    // pipelineIdle. This is no-hang settle path 5 (crash-while-deferred, latched).
    workerUnavailable = true;
    if (run) run.resolve(erroredResult(run.stack));
    if (deferred) deferred.resolve(erroredResult(deferred.stack));
    return;
  }

  // syncWorkerConfig respawns the worker (via getWorker) and has it rebuild its
  // owned corpus from IDB; its selfReady drains the deferral. Re-dispatch the
  // in-flight run AND re-register the deferred run through runOnWorker, not a
  // bespoke post: that keeps supersession intact and lets the freshness mirror
  // gate them (they defer until the rebuild's selfReady). No-hang settle path 5
  // (crash-while-deferred, respawn).
  syncWorkerConfig(state.sources);
  if (run) runOnWorker(run.stack, run.sort).then(run.resolve);
  if (deferred) runOnWorker(deferred.stack, deferred.sort).then(deferred.resolve);
}

export function sendWorkerScope(scope) {
  // Fresh state: the worker's setScope re-slices ownedCorpus synchronously,
  // FIFO-before the scope's run, so the optimistic mirror can't outrun it.
  if (ownedFreshScope !== null) {
    getWorker().postMessage({ type: 'setScope', scope });
    ownedFreshScope = scope;
    drainDeferred();
    return;
  }
  // Null mirror (a syncConfig is reshaping the corpus): the lightweight setScope
  // leaves a deferred scoped run with no drain signal, so it hangs (no backstop).
  // Escalate to a resync for the now-current scope; its selfReady drains the run.
  syncWorkerConfig(state.sources);
}

// The scroller reports its visible window so a streaming run ships THAT window in
// each snapshot (viewport-driven streaming) rather than a fixed top — keyed by
// runId so a stale viewport from the prior run is ignored. See worker-protocol.md.
export function sendViewport(runId, start, end) {
  getWorker().postMessage({ type: 'viewport', runId, start, end });
}

export function checkWorkerAssets() {
  if (!anyAssetAutoUpdates()) return;
  getWorker().postMessage({ type: 'check-assets' });
}

export function preloadWorkerAsset(asset) {
  getWorker().postMessage({ type: 'preload-asset', asset });
}

// ─── Run dispatch, supersession & the deferred-run queue ─────────────────────
// Post-flip a run whose owned corpus isn't yet fresh for its scope (boot's
// first paint before the build lands; a cacheVersion$ re-sync gap; a My-Edits
// edit window; an import/fetch) has no snapshot to fall back on, so it can't
// dispatch — it DEFERS and drains when the worker becomes fresh for that scope.
// setScope needs no defer: the worker rebuilds ownedCorpus synchronously from
// ownedBuilt, and the run that follows re-checks freshness.
let runCounter = 0;
let pendingRun = null;   // { runId, resolve, stack, scope, sort } for the latest dispatched run
let lastResultRunId = null;   // runId of the last `result` the worker delivered

// The single latest-wins deferred run. A NEW deferred run replaces it, settling
// the replaced one aborted (settle path 2); a selfReady drains it (paths 1/3); a
// build-failure selfReady or a crash settles it errored (paths 4/5). The set MUST
// stay exhaustive — a dangling promise wedges pipelineIdle and the whole suite.
// Deliberately NO wall-clock timeout: a timer that aborts a merely-slow build's
// run re-parks the UI on an empty result with no error — the regression this
// removed. A same-page worker goes silent only by crashing (handled) or
// deadlocking (a bug we let surface, caught by Playwright's per-test timeout).
let deferredRun = null;   // { stack, sort, scope, resolve }

function erroredResult(stack) {
  return {
    aborted: false, errored: true, rows: [],
    atomCount: currentAtomCount(stack),
  };
}

export function runOnWorker(stack, sort) {
  // Resolve errored, never hang: post-flip there's no main corpus, so a latched
  // worker must settle every run (and any prior deferred run) gracefully.
  if (workerUnavailable) {
    if (deferredRun) { deferredRun.resolve({ aborted: true }); deferredRun = null; }
    return Promise.resolve(erroredResult(stack));
  }

  // Main owns the per-run _error reset now that the executor runs off-thread —
  // without this an old ⚠ mark persists after the offending tool is fixed.
  let hadError = false;
  for (const row of stack) { if (row._error != null) hadError = true; row._error = null; }
  if (hadError) bumpErrorMarks();

  const scope = state.selected === MERGED_ID ? MERGED_ID : state.selected?.dbKey ?? null;

  // A replacing run/defer supersedes any prior deferred run (settle path 2): the
  // old deferral can never dispatch, so settle it aborted now or it dangles.
  if (deferredRun) { deferredRun.resolve({ aborted: true }); deferredRun = null; }

  // The sync ownedFreshFor read is the race-free gate: either the build's
  // selfReady has already set the mirror (dispatch now) or it hasn't (defer, and
  // drainDeferred fires on the build's selfReady) — no window where both miss.
  if (!ownedFreshFor(scope)) {
    return new Promise(resolve => { deferredRun = { stack, sort, scope, resolve }; });
  }

  return dispatchRun(stack, sort, scope);
}

const serializeStack = stack => stack.map(r => ({ tool: r.tool, params: r.params, grouped: r.grouped, invert: r.invert, reverse: r.reverse }));

function dispatchRun(stack, sort, scope) {
  const serialized = serializeStack(stack);
  const runId = ++runCounter;

  const existsQuery = AppView.searchQuery.trim() || null;
  const scoreRange = activeScoreRange() || null;
  const rebindQuery = entryPanelRebindQuery();

  // A superseded run gets no worker reply — settle the prior one as aborted here
  // or its awaiter (and pipelineIdle, which the whole suite gates on) dangles.
  if (pendingRun) pendingRun.resolve({ aborted: true });

  const w = getWorker();
  return new Promise(resolve => {
    pendingRun = { runId, resolve, stack, scope, sort };
    w.postMessage({ type: 'run', runId, stack: serialized, sort, scope, existsQuery, scoreRange, rebindQuery });
  });
}

// Drains the deferred run when the worker reports fresh for its scope (settle
// paths 1/3). Re-checks ownedFreshFor against the run's OWN scope — a selfReady
// for a different scope leaves it deferred — so a stale-scope build can't drain
// the wrong run. dispatchRun's resolve chains onto the deferred awaiter.
function drainDeferred() {
  if (!deferredRun) return;
  const { stack, sort, scope, resolve } = deferredRun;
  if (!ownedFreshFor(scope)) return;
  deferredRun = null;
  dispatchRun(stack, sort, scope).then(resolve);
}

let reprojectCounter = 0;
let pendingReproject = null;   // { reprojectId, resolve } for the latest in-flight reproject

// A sort / score-range change re-derives the view over the worker's RETAINED join for
// the currently-displayed run — no re-run. Resolves { stale } so the caller re-runs when
// the worker no longer holds that run fresh (a scope/config change since). reprojectId
// disambiguates rapid reprojects, which all target the same displayed runId.
export function reprojectPipeline(sort, scoreRange, recomputeHistogram = false) {
  const runId = pendingRun?.runId ?? lastResultRunId;
  if (runId == null || workerUnavailable) return Promise.resolve({ stale: true });
  if (pendingRun) pendingRun.sort = sort;   // a crash re-dispatch must use the current sort
  if (pendingReproject) { pendingReproject.resolve({ stale: false }); pendingReproject = null; }
  const reprojectId = ++reprojectCounter;
  return new Promise(resolve => {
    pendingReproject = { reprojectId, resolve };
    getWorker().postMessage({ type: 'reproject', runId, reprojectId, sort, scoreRange, recomputeHistogram });
  });
}

// Re-derive a FLAT result's join over the freshly-spliced corpus (a background structural
// auto-update), shipped as a `reprojected` snapshot for in-place ingest, no chip. Unlike
// reprojectPipeline it re-runs the pipeline, so it carries the stack; it shares the
// pendingReproject slot + reprojected/reprojectStale replies (so it must clear a prior one
// first, as reprojectPipeline does), and a stale reply falls the caller back to a re-run.
export function repatchPipeline(stack, sort, scoreRange) {
  const runId = pendingRun?.runId ?? lastResultRunId;
  if (runId == null || workerUnavailable) return Promise.resolve({ stale: true });
  if (pendingReproject) { pendingReproject.resolve({ stale: false }); pendingReproject = null; }
  const reprojectId = ++reprojectCounter;
  return new Promise(resolve => {
    pendingReproject = { reprojectId, resolve };
    getWorker().postMessage({ type: 'repatch', runId, reprojectId, stack: serializeStack(stack), sort, scoreRange });
  });
}

function onWorkerMessage({ data }) {
  if (!data) return;
  if (data.type === 'selfReady') { handleSelfReady(data); return; }
  if (data.type === 'partial') {
    // Same supersession gate as `result`: a partial from a stale stream must
    // never paint over the live run. Crucially it does NOT settle pendingRun —
    // only `result`/supersession do — or pipelineIdle() would resolve mid-stream
    // and the whole pipeline-idle contract (the suite gates on it) would break.
    if (!pendingRun || data.runId !== pendingRun.runId) return;
    // Stash the scoped layout so scopedHistogramLayout() returns the axis the worker
    // bucketed histogramCounts against, mirroring the partialGroups handler.
    setShippedScopedLayout(data.histogramLayout ?? null, pendingRun.scope);
    streamFlatBatchToScroller({
      runId: data.runId,
      version: data.version,
      windowStart: data.windowStart ?? 0,
      total: data.total,
      firstRows: data.firstRows ?? null,
      widthHints: data.widthHints,
      stats: data.stats ?? null,
      histogramCounts: data.histogramCounts ?? null,
      histogramLayout: data.histogramLayout ?? null,
      filtered: !!data.filtered,
    });
    return;
  }
  if (data.type === 'partialGroups') {
    // Same supersession + never-settle-pendingRun discipline as the flat `partial`.
    if (!pendingRun || data.runId !== pendingRun.runId) return;
    // Stash the scoped layout so scopedHistogramLayout() returns the axis the worker
    // bucketed histogramCounts against, mirroring materializeResult's grouped path.
    setShippedScopedLayout(data.histogramLayout ?? null, pendingRun.scope);
    const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
    streamGroupBatchToScroller({
      runId: data.runId,
      version: data.version,
      windowStart: data.windowStart ?? 0,
      atomCount: data.atomCount,
      total: data.total,
      chainCount: data.chainCount,
      firstGroups: (data.firstGroups ?? []).map(g => decodeGroup(g, sourceById)),
      groupWidthHints: data.groupWidthHints ?? null,
      stats: data.stats ?? null,
      histogramCounts: data.histogramCounts ?? null,
      histogramLayout: data.histogramLayout ?? null,
      filtered: !!data.filtered,
    });
    return;
  }
  if (data.type === 'partialChains') {
    // Same supersession + never-settle-pendingRun discipline as the flat `partial`.
    if (!pendingRun || data.runId !== pendingRun.runId) return;
    setShippedScopedLayout(data.histogramLayout ?? null, pendingRun.scope);
    const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
    streamTransformBatchToScroller({
      runId: data.runId,
      version: data.version,
      windowStart: data.windowStart ?? 0,
      atomCount: data.atomCount,
      total: data.total,
      firstChains: (data.firstChains ?? []).map(c => decodeChain(c, sourceById)),
      widthHints: data.widthHints ?? null,
      stats: data.stats ?? null,
      histogramCounts: data.histogramCounts ?? null,
      histogramLayout: data.histogramLayout ?? null,
      filtered: !!data.filtered,
    });
    return;
  }
  if (data.type === 'progress') {
    // Advisory prepare-progress for the live run. Same supersession gate as
    // `partial`, and likewise must NOT settle pendingRun.
    if (!pendingRun || data.runId !== pendingRun.runId) return;
    setPipelineProgress(data.fraction);
    return;
  }
  if (data.type === 'reprojected') {
    // A view re-derive for the displayed run: ingest to the scroller WITHOUT settling
    // pendingRun or the deferred queue — a reproject is not a run.
    const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
    // A sort/filter reproject leaves the scoped histogram layout invariant, but a rescore
    // or refresh-on-consent reproject re-buckets over a CHANGED corpus whose layout can
    // gain/lose slots — adopt the shipped one (scoped runs only; merged ships null and
    // rides the ack's axis), or the stats bar buckets fresh counts against a stale-length
    // layout, trips its length-mismatch guard, and blanks every bar.
    if (data.histogramLayout) setShippedScopedLayout(data.histogramLayout, state.selected?.dbKey);
    ingestReprojectToScroller({
      ...data,
      firstGroups: data.firstGroups && data.firstGroups.map(g => decodeGroup(g, sourceById)),
      firstChains: data.firstChains && data.firstChains.map(c => decodeChain(c, sourceById)),
    });
    if (pendingReproject?.reprojectId === data.reprojectId) { pendingReproject.resolve({ stale: false }); pendingReproject = null; }
    return;
  }
  if (data.type === 'reprojectStale') {
    if (pendingReproject?.reprojectId === data.reprojectId) { pendingReproject.resolve({ stale: true }); pendingReproject = null; }
    return;
  }
  if (data.type === 'result') {
    if (!pendingRun || data.runId !== pendingRun.runId) return;   // stale — drop
    const run = pendingRun;
    pendingRun = null;
    lastResultRunId = data.runId;
    run.resolve(materializeResult(data, run.stack, run.scope));
    return;
  }
  if (data.type === 'error') {
    if (!pendingRun || data.runId !== pendingRun.runId) return;
    const run = pendingRun;
    pendingRun = null;
    if (data.stackRowIndex != null && run.stack[data.stackRowIndex]) {
      run.stack[data.stackRowIndex]._error = data.message;
      bumpErrorMarks();
    }
    run.resolve(erroredResult(run.stack));
  }
}

// ─── Result materialization ── inverse of engine/worker.js's postResult ───────
function materializeResult(data, stack, scope) {
  const { laneKind, atomCount, payload } = data;

  if (laneKind === 'single' && !payload.firstChains) {
    // Every flat result must re-stamp the holder — even a null-layout one — so a
    // scope switch can't leave a previous scope's layout behind for the scope-key
    // guard to wrongly accept.
    setShippedScopedLayout(payload.histogramLayout ?? null, scope);
    return {
      flat: true,
      count: payload.count,
      widthHints: payload.widthHints,
      stats: payload.stats ?? null,
      histogramCounts: payload.histogramCounts ?? null,
      histogramLayout: payload.histogramLayout ?? null,
      existsInScope: payload.existsInScope ?? null,
      rebindQuery: payload.rebindQuery ?? null,
      rebindEntry: rebuildRebindEntry(payload.rebindEntry),
      rebindExists: payload.rebindExists ?? null,
      firstRows: payload.firstRows ?? null,
      filtered: !!payload.filtered,
      ranAgainstOwned: !!data.ranAgainstOwned,
      atomCount, aborted: false,
    };
  }

  // Rebuilt each pass (not memoized) so an add/remove/reorder between runs can't
  // resolve a rich atom's sourceId to a stale wordlist.
  const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
  // Stamp the holder so scopedHistogramLayout() returns the SAME axis the worker
  // bucketed histogramCounts against; otherwise the scoped histogram renders counts
  // against a mismatched axis and silently mis-bins. Both windowed tiers need it.
  setShippedScopedLayout(payload.histogramLayout ?? null, scope);
  if (laneKind !== 'single') {
    return {
      rows: payload.groups.map(g => decodeGroup(g, sourceById)),
      atomCount, aborted: false,
      stats: payload.stats ?? null,
      histogramCounts: payload.histogramCounts ?? null,
      histogramLayout: payload.histogramLayout ?? null,
      groupWidthHints: payload.groupWidthHints ?? null,
      chainCount: payload.chainCount ?? null,
      groupCount: payload.groupCount ?? null,
      capped: !!data.capped,
      filtered: !!payload.filtered,
    };
  }
  return {
    transform: true,
    firstChains: payload.firstChains.map(c => decodeChain(c, sourceById)),
    chainCount: payload.chainCount ?? 0,
    atomCount, aborted: false,
    stats: payload.stats ?? null,
    histogramCounts: payload.histogramCounts ?? null,
    histogramLayout: payload.histogramLayout ?? null,
    widthHints: payload.widthHints ?? null,
    existsInScope: payload.existsInScope ?? null,
    rebindQuery: payload.rebindQuery ?? null,
    rebindEntry: rebuildRebindEntry(payload.rebindEntry),
    rebindExists: payload.rebindExists ?? null,
    filtered: !!payload.filtered,
    ranAgainstOwned: !!data.ranAgainstOwned,
  };
}

function rebuildRebindEntry(row) {
  if (!row) return null;
  return {
    norm: row.norm, display: row.display ?? null, score: row.score, rawScore: row.rawScore,
    comment: row.comment || '', wordlist: state.sources.find(w => w.dbKey === row.sourceId) ?? null,
  };
}

// `{ s }` is a synthetic, deliberately NOT resolved through byNorm (that would
// alias it to a real entry of the same norm); anything else is a rich
// self-contained atom (the worker always ships rich post-flip).
function decodeAtom(atom, sourceById) {
  let wlEntry;
  if ('s' in atom) {
    const { norm, display, score } = atom.s;
    wlEntry = { norm, display, score, comment: '', wordlist: null };
  } else {
    wlEntry = {
      norm: atom.norm, display: atom.display, score: atom.score, rawScore: atom.rawScore,
      comment: atom.comment, wordlist: sourceById.get(atom.sourceId) ?? null,
      sourceIds: atom.sourceIds ?? (atom.sourceId ? [atom.sourceId] : []),
      activeIds: atom.activeIds ?? (atom.sourceId ? [atom.sourceId] : []),
    };
  }
  return { wlEntry, highlights: atom.h ?? null, glyph: atom.g ?? null };
}

function decodeChain(chain, sourceById) {
  return { atoms: chain.atoms.map(a => decodeAtom(a, sourceById)) };
}

function decodeGroupEnvelope(g, sourceById) {
  return {
    key: g.key,
    anchor: g.anchor ? decodeAtom(g.anchor, sourceById).wlEntry : null,
    _minScore: g._minScore,
    _maxScore: g._maxScore,
    _minLength: g._minLength,
    _maxLength: g._maxLength,
    _count: g._count,
  };
}

function decodeGroup(g, sourceById) {
  return { ...decodeGroupEnvelope(g, sourceById), chains: g.firstChains.map(c => decodeChain(c, sourceById)) };
}

function decodeGroupFull(g, sourceById) {
  return { ...decodeGroupEnvelope(g, sourceById), chains: g.chains.map(c => decodeChain(c, sourceById)) };
}

export function pipelineWorkerState() {
  return { workerUnavailable, crashCount };
}

export function patchWorkerToolForTest(tool, method, message) {
  getWorker().postMessage({ type: '__testPatchTool', tool, method, message });
}

export function crashWorkerForTest() {
  getWorker().postMessage({ type: '__testCrash' });
}

export function forceWorkerCrashForTest() {
  onWorkerCrash();
}

export function failNextWorkerBuildForTest() {
  getWorker().postMessage({ type: '__testFailNextBuild' });
}

// Test-only: a small corpus finishes before the worker's ~30ms yield, so it never
// streams `partial`s; shrinking the interval makes it cross many yield boundaries.
export function setWorkerYieldIntervalForTest(intervalMs) {
  getWorker().postMessage({ type: '__testYieldInterval', intervalMs });
}

export function stopRunAfterTotalForTest(total) {
  getWorker().postMessage({ type: '__testStopRunAfterTotal', total });
}

export function setWorkerUnigramCorpusForTest(freqs) {
  getWorker().postMessage({ type: '__testSetUnigramCorpus', freqs });
}

// Test-only: collect streamed `partial`s for assertion against the final result.
export function captureWorkerPartialsForTest() {
  const w = getWorker();
  const partials = [];
  function onMessage({ data }) {
    if (data?.type !== 'partial') return;
    partials.push({
      runId: data.runId,
      version: data.version,
      total: data.total,
      stats: data.stats ?? null,
      firstRows: data.firstRows ?? null,
    });
  }
  w.addEventListener('message', onMessage);
  return {
    peek() { return partials.slice(); },
    stop() { w.removeEventListener('message', onMessage); return partials; },
  };
}

// Test-only: collect streamed `partialGroups` (tuple tier) for assertion.
export function captureWorkerGroupPartialsForTest() {
  const w = getWorker();
  const partials = [];
  function onMessage({ data }) {
    if (data?.type !== 'partialGroups') return;
    partials.push({
      runId: data.runId,
      version: data.version,
      total: data.total,
      chainCount: data.chainCount,
      laneKind: data.laneKind,
      groupKeys: (data.firstGroups ?? []).map(g => g.key),
    });
  }
  w.addEventListener('message', onMessage);
  return {
    peek() { return partials.slice(); },
    stop() { w.removeEventListener('message', onMessage); return partials; },
  };
}

// Test-only: collect streamed `partialChains` (transform tier) for assertion.
export function captureWorkerChainPartialsForTest() {
  const w = getWorker();
  const partials = [];
  function onMessage({ data }) {
    if (data?.type !== 'partialChains') return;
    partials.push({
      runId: data.runId,
      version: data.version,
      total: data.total,
      laneKind: data.laneKind,
      entries: (data.firstChains ?? []).map(c => c.atoms.map(a => a.s?.display ?? a.display ?? a.norm)),
    });
  }
  w.addEventListener('message', onMessage);
  return {
    peek() { return partials.slice(); },
    stop() { w.removeEventListener('message', onMessage); return partials; },
  };
}

// ─── Self-build bridge ── boot handshake + test oracle ── see docs/worker-protocol.md ──
let configRequestId = 0;
export function syncConfigsSent() { return configRequestId; }

// configId → its workerReady resolver. selfReady MUST be consumed on the PERSISTENT
// listener (handleSelfReady): the old per-call listener was torn down on a 5s timer,
// so any slower build's selfReady was orphaned — worker fully built, UI parked on an
// empty result with no error. Don't reintroduce a timed per-call listener.
const _configWaiters = new Map();

export function syncWorkerConfig(sources) {
  const w = getWorker();
  const scope = state.selected === MERGED_ID ? MERGED_ID : state.selected?.dbKey ?? MERGED_ID;
  // Mirror the worker clearing ownedCorpusFresh synchronously at syncConfig start:
  // a run dispatched in the rebuild gap would execute against the STALE corpus
  // (e.g. a just-added source missing), so clear the mirror to force a defer until
  // this sync's selfReady re-confirms freshness (settle paths 1/3 drain it).
  ownedFreshScope = null;
  const configId = ++configRequestId;
  const payload = {
    type: 'syncConfig',
    configId,
    scope,
    sources: sources.map(wl => ({
      sourceId: wl.dbKey,
      enabled: wl.enabled,
      type: wl.type ?? null,
      rescoreRules: (wl.rescoreRules || []).map(r => ({
        input: r.input, length: r.length, output: r.output, note: r.note,
      })),
    })),
  };
  return new Promise(resolve => {
    _configWaiters.set(configId, resolve);
    w.postMessage(payload);
  });
}

function handleSelfReady(data) {
  setShippedAllSourcesAxis(data.axis, data.version);
  setShippedConfigCounts(data.sourceCounts ?? null, data.sourceTotals ?? null, data.mergedCount ?? null, data.mergedWidthBound ?? null, data.version);
  setShippedRescoreInputs(data.rescoreInputs);
  applySelfReadyFreshness(data);
  const resolve = _configWaiters.get(data.configId);
  if (resolve) { _configWaiters.delete(data.configId); resolve(data.count); }
}

// The build's selfReady is the deferred-run drain trigger. A SUCCESSFUL build
// (built) marks the worker fresh for its scope → drainDeferred dispatches any
// matching deferral (settle paths 1/3). A genuinely FAILED build (the latest
// sync, ownedCorpus null) must NOT mark fresh — it leaves the deferred run
// undispatchable, the hang trap: settle it errored (settle path 4). A SUPERSEDED
// build also reports built:false (its work was discarded for a newer sync), but a
// newer syncConfig is in flight that WILL drain the deferral, so its selfReady is
// ignored — settling errored here would prematurely fail a run a later build serves.
function applySelfReadyFreshness(data) {
  const scope = data.scope ?? MERGED_ID;
  if (data.built) {
    ownedFreshScope = scope;
    const waiters = _committedWaiters; _committedWaiters = [];
    waiters.forEach(w => w(true));
    drainDeferred();
  } else if (data.configId === configRequestId && deferredRun && deferredRun.scope === scope) {
    const { stack, resolve } = deferredRun;
    deferredRun = null;
    resolve(erroredResult(stack));
  }
}

// Every config change must re-sync, or ownedCorpus goes stale-but-fresh and the
// worker enriches rows from stale data — silent corruption of every rendered row.
export function resyncWorkerConfig() {
  syncWorkerConfig(state.sources);
}

export function dumpWorkerCorpus(scope, timeout = 10000) {
  const w = getWorker();
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve({ entries: [], error: 'timeout' }); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'corpusDump' || data.scope !== scope) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ entries: data.entries, error: data.error });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'dumpCorpus', scope });
  });
}

let queryEntryRequestId = 0;
export function queryWorkerEntry(scope, norm, display, timeout = 5000) {
  const w = getWorker();
  const requestId = ++queryEntryRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'entry' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.entry);
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'queryEntry', requestId, scope, norm, display });
  });
}

// Test-only: the real 5s recompute floor makes the cross-run result cache inert
// under sub-second test queries; drop it so a fast run is cacheable. Fire-and-forget.
export function configureResultCacheForTest(opts) {
  getWorker().postMessage({ type: '__testResultCacheConfig', ...opts });
}

export function resultCacheStateForTest(timeout = 2000) {
  const w = getWorker();
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== '__testResultCacheState') return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ size: data.size, bytes: data.bytes, hits: data.hits, misses: data.misses, keys: data.keys });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: '__testResultCacheState' });
  });
}

export function configurePrefixCacheForTest(opts) {
  getWorker().postMessage({ type: '__testPrefixCacheConfig', ...opts });
}

export function prefixCacheStateForTest(timeout = 2000) {
  const w = getWorker();
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== '__testPrefixCacheState') return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ size: data.size, bytes: data.bytes, hits: data.hits, misses: data.misses, keys: data.keys, seedFrom: data.seedFrom });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: '__testPrefixCacheState' });
  });
}

export function configurePartialCacheForTest(opts) {
  getWorker().postMessage({ type: '__testPartialCacheConfig', ...opts });
}

export function partialCacheStateForTest(timeout = 2000) {
  const w = getWorker();
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== '__testPartialCacheState') return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ size: data.size, bytes: data.bytes, hits: data.hits, stashes: data.stashes, resumedFrom: data.resumedFrom, keys: data.keys });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: '__testPartialCacheState' });
  });
}

export function retainedResultInfoForTest(timeout = 2000) {
  const w = getWorker();
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== '__testRetainedResultInfo') return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ packed: data.packed, laneKind: data.laneKind, count: data.count, atoms: data.atoms, bytes: data.bytes });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: '__testRetainedResultInfo' });
  });
}

export function workerAssetStateForTest(timeout = 2000) {
  const w = getWorker();
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve({}); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== '__testAssetState') return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.state);
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: '__testAssetState' });
  });
}

export function pingWorker(timeout = 2000) {
  const w = getWorker();
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(false); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'pong') return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve('pong');
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'ping' });
  });
}

// ─── Pending-edit barrier ── see docs/worker-protocol.md ─────────────────────
// An edit posts its `editEntry` command only after its plan round-trips (saveEntry
// awaits planForSave); the corpus reads below post synchronously, so FIFO lands them
// ahead of the editEntry and they read the pre-edit corpus — the just-changed score
// shows stale with no error. The gesture brackets itself begin→endPendingEdit (intent
// → command posted); the reads await this barrier so they can't overtake it.
let pendingEditCount = 0;
let pendingEditBarrier = Promise.resolve();
let releasePendingEdits = null;
export function beginPendingEdit() {
  if (pendingEditCount++ === 0) pendingEditBarrier = new Promise(r => { releasePendingEdits = r; });
}
export function endPendingEdit() {
  if (pendingEditCount > 0 && --pendingEditCount === 0) { releasePendingEdits(); releasePendingEdits = null; }
}

// ─── Edit-seed fetch bridge ── see docs/worker-protocol.md ───────────────────
// Own requestId space, independent of the run's runId: an entry-panel query must not
// touch run supersession. A timeout resolves null so main falls back to its
// local clicked seed rather than hanging the editor.
let fetchEditSeedRequestId = 0;
let editSeedFetches = 0;
export function fetchEditSeedFetchCount() { return editSeedFetches; }
export async function fetchWorkerEditSeed(norm, display, timeout = 5000) {
  await pendingEditBarrier;
  const w = getWorker();
  const requestId = ++fetchEditSeedRequestId;
  editSeedFetches++;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'editSeed' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.winner ?? null);
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchEditSeed', requestId, norm, display });
  });
}

// ─── Family fetch bridge ── see docs/worker-protocol.md ──────────────────────
// Its own requestId space; a timeout resolves [] so the panel simply shows no
// related entries rather than hanging.
let fetchFamilyRequestId = 0;
export async function fetchWorkerFamily(norm, display, boundNorm, boundDisplay, timeout = 5000) {
  await pendingEditBarrier;
  const w = getWorker();
  const requestId = ++fetchFamilyRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve([]); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'family' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.members ?? []);
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchFamily', requestId, norm, display, boundNorm, boundDisplay });
  });
}

// Own requestId space; a timeout resolves [] so the walk's list falls back to
// bare entries rather than hanging.
let fetchWinnersRequestId = 0;
export function fetchWorkerWinners(ids, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchWinnersRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve([]); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'winners' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.members ?? []);
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchWinners', requestId, ids });
  });
}

// No pending-edit barrier (unlike the family/provenance reads): the hint is
// advisory and keys only on vocab membership, which a pending rescore never
// changes. Longer timeout than its sibling bridges, though — a cold query
// triggers the multi-MB unigram download in the worker; even if that outruns the
// timeout the corpus still lands, so a later query (a keystroke, a reopen) uses it.
let fetchSpaceOutRequestId = 0;
export function fetchWorkerSpaceOut(norm, timeout = 15000) {
  const w = getWorker();
  const requestId = ++fetchSpaceOutRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'spaceOut' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.suggestion ?? null);
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchSpaceOut', requestId, norm });
  });
}

// ─── Provenance + preview fetch bridge ── see docs/worker-protocol.md ────────
// Its own requestId space, independent of both the run's runId and the edit-seed
// lane: an entry-panel query must not touch run or seed supersession. A timeout resolves
// {preview:null,rows:null} so main falls back to its local corpus reads.
let fetchProvenanceRequestId = 0;
let provenanceFetches = 0;
export function fetchProvenanceFetchCount() { return provenanceFetches; }
export async function fetchWorkerProvenance(typedRaw, previewRaw, clickedNorm, clickedDisplay, timeout = 5000) {
  await pendingEditBarrier;
  const w = getWorker();
  const requestId = ++fetchProvenanceRequestId;
  provenanceFetches++;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve({ preview: null, rows: null }); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'provenance' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ preview: data.preview ?? null, rows: data.rows ?? null });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchProvenance', requestId, typedRaw, previewRaw, clickedNorm, clickedDisplay });
  });
}

// ─── Entry-edit plan fetch bridge ── see docs/worker-protocol.md ─────────────
// Its own requestId space; the worker owns every source's rescore index, so it
// plans the edit. A timeout resolves null so the caller falls back rather than
// hanging — the preview keeps its last-good plan, a save retries then bails.
let fetchEditPlanRequestId = 0;
let editPlanFetches = 0;
export function fetchEditPlanFetchCount() { return editPlanFetches; }
export function fetchWorkerEditPlan({ mode, clicked, typed, trashScore }, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchEditPlanRequestId;
  editPlanFetches++;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'editPlan' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.plan ?? null);
    }
    w.addEventListener('message', onMessage);
    // Lean `clicked` to the two fields planEntryWrite reads: a raw wlEntry carries a
    // `wordlist` back-reference (the whole source + its rawEntries) that would
    // structured-clone across the boundary — megabytes for a two-field read.
    const leanClicked = clicked && { norm: clicked.norm, display: clicked.display ?? null };
    w.postMessage({ type: 'planEdit', requestId, mode, clicked: leanClicked, typed, trashScore });
  });
}

// ─── My Edits edit/add command bridge ── see docs/worker-protocol.md ─────────
let editEntryId = 0;
export function sendEditEntry(writes, timeout = 5000) {
  const w = getWorker();
  const editId = ++editEntryId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'editAck' || data.editId !== editId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ replaced: data.replaced, axis: data.axis, counts: data.counts });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'editEntry', editId, writes });
  });
}

export function sendDeleteEntry({ norm, display }, timeout = 5000) {
  const w = getWorker();
  const editId = ++editEntryId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'editAck' || data.editId !== editId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ axis: data.axis, counts: data.counts });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'deleteEntry', editId, norm, display });
  });
}

// ─── My Edits disk-merge bridge ── see docs/worker-protocol.md ───────────────
// A timeout resolves null so reconcile()/flush leave the file alone rather than
// wedging the sync loop on a lost reply.
let mergeDiskRequestId = 0;
export function fetchWorkerMergeDisk(fileText, conflictChoice, timeout = 5000) {
  const w = getWorker();
  const requestId = ++mergeDiskRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'mergeResult' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({
        mergedText: data.mergedText, corpusChanged: data.corpusChanged, conflicts: data.conflicts,
        rawEntries: data.rawEntries, axis: data.axis, counts: data.counts,
      });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'mergeDisk', requestId, fileText, conflictChoice });
  });
}

// ─── Fetch content-diff bridge ── see docs/worker-protocol.md ────────────────
// A timeout resolves null so applyWordlistText falls back to a full resync rather
// than wedging on a lost reply. Generous (10s): the worker parses the whole new
// text synchronously before replying.
let applyFetchedRequestId = 0;
let lastFetchAppliedMode = null;
export function lastFetchAppliedMode$() { return lastFetchAppliedMode; }
export function sendApplyFetched(sourceId, text, background = false, timeout = 10000) {
  const w = getWorker();
  const requestId = ++applyFetchedRequestId;
  return new Promise(resolve => {
    // Keep the listener alive past the timeout: a late fetchApplied still carries a
    // diffId whose toast/dialog owner main already abandoned (it took the resync
    // branch), so free that orphan rather than dropping the reply and leaking the
    // diff in the worker's retainedDiffs forever.
    let settled = false;
    const timer = setTimeout(() => { settled = true; resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'fetchApplied' || data.requestId !== requestId) return;
      // Interim ack: the worker deferred the apply behind a live run and will post the real
      // ack when it lands. Cancel the timeout (the run's duration would otherwise trip it,
      // silently falling back to a full resync) but keep the listener for the real ack.
      if (data.deferred) { clearTimeout(timer); return; }
      w.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (settled) { sendFreeDiff(data.diffId); return; }
      lastFetchAppliedMode = data.mode ?? null;
      // Forward the whole ack: applyWordlistText/applyConfigAck read wasEmpty, the
      // capped diff + true counts, and rescoreInputs off it (main holds no old entries).
      resolve(data);
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'applyFetched', requestId, sourceId, text, background });
  });
}

// ─── Update-summary diff-row bridges ── see docs/worker-protocol.md ──────────
// A timeout resolves null so the update dialog stays on its inline first window
// rather than wedging on a lost reply.
let fetchDiffRowsRequestId = 0;
export function diffFetchesSent() { return fetchDiffRowsRequestId; }
export function fetchWorkerDiffRows(diffId, section, start, end, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchDiffRowsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'diffRows' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ start: data.start, rows: data.rows });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchDiffRows', requestId, diffId, section, start, end });
  });
}

export function sendFreeDiff(diffId) {
  if (diffId != null) getWorker().postMessage({ type: 'freeDiff', diffId });
}

// ─── Windowed row fetch bridge (test) ── see docs/worker-protocol.md ─────────
let fetchRowsRequestId = 0;
export function lastCompletedRunId() { return lastResultRunId; }
export function fetchWorkerRows(runId, start, end, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchRowsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'rows' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ start: data.start, rows: data.rows, version: data.version });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchRows', requestId, runId, start, end });
  });
}

// ─── Find-in-page bridge ── see docs/worker-protocol.md ──────────────────────
let findRequestId = 0;
export function findInResult(runId, query, timeout = 8000) {
  const w = getWorker();
  const requestId = ++findRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'findResult' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      if (runId !== lastResultRunId) { resolve(null); return; }   // superseded run — drop
      resolve({ matches: data.matches, capped: data.capped });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'find', requestId, runId, query });
  });
}

// ─── Windowed grouped-chain fetch bridge ── see docs/worker-protocol.md ──────
let fetchGroupChainsRequestId = 0;
export function fetchWorkerGroupChains(runId, groupKey, start, end, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchGroupChainsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'groupChains' || data.requestId !== requestId
          || data.runId !== runId || data.groupKey !== groupKey) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      if (runId !== lastResultRunId) { resolve(null); return; }   // superseded run — drop
      const sourceById = new Map(state.sources.map(s => [s.dbKey, s]));
      resolve({ start: data.start, chains: data.chains.map(c => decodeChain(c, sourceById)) });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchGroupChains', requestId, runId, groupKey, start, end });
  });
}

// ─── Windowed group-row fetch bridge ── see docs/worker-protocol.md ──────────
let fetchGroupsRequestId = 0;
export function fetchWorkerGroups(runId, start, end, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchGroupsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'groups' || data.requestId !== requestId || data.runId !== runId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      // Supersession (and mid-stream version-drop) moves to the scroller — a
      // streaming run's window targets _streamRunId, which lastResultRunId (advanced
      // only at `result`) hasn't reached yet, so a guard here would drop every
      // mid-stream group window. Mirrors the flat fetchWorkerRows bridge.
      const sourceById = new Map(state.sources.map(s => [s.dbKey, s]));
      resolve({ start: data.start, version: data.version, groups: data.groups.map(g => decodeGroup(g, sourceById)) });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchGroups', requestId, runId, start, end });
  });
}

// ─── Full-result row fetch bridge (export) ── see docs/worker-protocol.md ────
let fetchAllRowsRequestId = 0;
export function allRowsFetchesSent() { return fetchAllRowsRequestId; }
export function fetchWorkerAllRows(runId, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchAllRowsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'allRows' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ rows: data.rows });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchAllRows', requestId, runId });
  });
}

// ─── Windowed transform-chain fetch bridge ── see docs/worker-protocol.md ────
// Drops a reply for a superseded run (like the grouped bridges) so a stale window
// can't paint over the current result.
let fetchTransformRowsRequestId = 0;
export function fetchWorkerTransformRows(runId, start, end, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchTransformRowsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'transformRows' || data.requestId !== requestId || data.runId !== runId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      if (runId !== lastResultRunId) { resolve(null); return; }   // superseded run — drop
      const sourceById = new Map(state.sources.map(s => [s.dbKey, s]));
      resolve({ start: data.start, rows: data.chains.map(c => decodeChain(c, sourceById)) });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchTransformRows', requestId, runId, start, end });
  });
}

// ─── Full-result transform fetch bridge (export) ── see docs/worker-protocol.md ──
let fetchAllTransformRowsRequestId = 0;
export function fetchWorkerAllTransformRows(runId, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchAllTransformRowsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'allTransformRows' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      const sourceById = new Map(state.sources.map(s => [s.dbKey, s]));
      resolve({ rows: data.chains.map(c => decodeChain(c, sourceById)) });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchAllTransformRows', requestId, runId });
  });
}

// ─── Full-result group fetch bridge (export) ── see docs/worker-protocol.md ──
let fetchAllGroupsRequestId = 0;
export function allGroupsFetchesSent() { return fetchAllGroupsRequestId; }
export function fetchWorkerAllGroups(runId, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchAllGroupsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'allGroups' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      const sourceById = new Map(state.sources.map(s => [s.dbKey, s]));
      resolve({ groups: data.groups.map(g => decodeGroupFull(g, sourceById)) });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchAllGroups', requestId, runId });
  });
}

// ─── Corpus serialize bridge ── see docs/worker-protocol.md ──────────────────
let fetchSerializeRequestId = 0;
export function serializeFetchesSent() { return fetchSerializeRequestId; }
// Resolves { text } on success (text may be ""), { retry: true } when the worker's
// owned corpus isn't fresh yet, or null on timeout / dead worker. Mishandling a branch
// writes/downloads empty silently, and `retry` is decided across the worker boundary.
export function fetchWorkerSerialize(scope, format, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchSerializeRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'serialized' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.retry ? { retry: true } : { text: data.text });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'serializeFor', requestId, scope, format });
  });
}
