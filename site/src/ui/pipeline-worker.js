// ─── Pipeline worker client ──────────────────────────────────────────────────
// The worker URL anchors on main.js's import.meta.url (injected at boot), not
// this module's. Bundling inlines this file into main.js at src/ while site/
// serves it from src/ui/ — a literal relative to import.meta.url would resolve
// to different places in the two builds. main.js lands at src/main.js in both,
// so anchoring there makes one relative path correct everywhere, deploy base
// included (no leading-slash hardcoding).

import { currentAtomCount } from '../engine/executor.js';
import { state } from '../data/state.js';
import { setShippedAllSourcesAxis, setShippedScopedLayout } from '../data/derived.js';
import { setShippedConfigCounts } from '../data/merge.js';
import { MERGED_ID } from '../core/constants.js';
import { AppView, activeScoreRange } from './app-view.js';
import { popoverRebindQuery } from './entries-table.js';

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

export function configurePipelineWorker({ baseURL }) {
  workerBaseURL = baseURL;
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./engine/worker.js', workerBaseURL), { type: 'module' });
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', onWorkerCrash);
    worker.addEventListener('messageerror', onWorkerCrash);
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
    if (deferredTimer) { clearTimeout(deferredTimer); deferredTimer = null; }
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
  getWorker().postMessage({ type: 'setScope', scope });
  // The worker rebuilds ownedCorpus synchronously from ownedBuilt on this
  // message (FIFO-before the scope's run), so once any build has landed the
  // client can mirror the new fresh-scope immediately — that's what lets the
  // scope's run dispatch rather than defer. Before the first build (mirror
  // null) leave it: nothing is fresh yet and the run must still defer.
  if (ownedFreshScope !== null) {
    ownedFreshScope = scope;
    drainDeferred();
  }
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
// build-failure selfReady or a crash settles it errored (paths 4/5); a timeout
// backstop settles it aborted (path 6). Every one of those settles is wired —
// a hung deferred promise wedges _pipelineRunning → pipelineIdle → the whole
// suite, so this set MUST stay exhaustive.
let deferredRun = null;   // { stack, sort, scope, resolve }
let deferredTimer = null;
const DEFERRED_TIMEOUT_MS = 5000;

function erroredResult(stack) {
  return {
    aborted: false, errored: true, rows: [],
    atomCount: currentAtomCount(stack), grouped: false,
  };
}

export function runOnWorker(stack, sort) {
  // Resolve errored, never hang: post-flip there's no main corpus, so a latched
  // worker must settle every run (and any prior deferred run) gracefully.
  if (workerUnavailable) {
    if (deferredRun) { deferredRun.resolve({ aborted: true }); deferredRun = null; }
    if (deferredTimer) { clearTimeout(deferredTimer); deferredTimer = null; }
    return Promise.resolve(erroredResult(stack));
  }

  // Main owns the per-run _error reset now that the executor runs off-thread —
  // without this an old ⚠ mark persists after the offending tool is fixed.
  for (const row of stack) row._error = null;

  const scope = state.selected === MERGED_ID ? MERGED_ID : state.selected?.dbKey ?? null;

  // A replacing run/defer supersedes any prior deferred run (settle path 2): the
  // old deferral can never dispatch, so settle it aborted now or it dangles.
  if (deferredRun) { deferredRun.resolve({ aborted: true }); deferredRun = null; }
  if (deferredTimer) { clearTimeout(deferredTimer); deferredTimer = null; }

  // The sync ownedFreshFor read is the race-free gate: either the build's
  // selfReady has already set the mirror (dispatch now) or it hasn't (defer, and
  // drainDeferred will fire on the next selfReady) — no window where both miss.
  if (!ownedFreshFor(scope)) {
    return new Promise(resolve => {
      deferredRun = { stack, sort, scope, resolve };
      // Backstop (settle path 6): if a selfReady/crash signal is somehow lost,
      // resolve aborted rather than leave pipelineIdle wedged forever.
      deferredTimer = setTimeout(() => {
        if (deferredRun?.resolve === resolve) {
          deferredRun = null; deferredTimer = null;
          resolve({ aborted: true });
        }
      }, DEFERRED_TIMEOUT_MS);
    });
  }

  return dispatchRun(stack, sort, scope);
}

function dispatchRun(stack, sort, scope) {
  const serialized = stack.map(r => ({ tool: r.tool, params: r.params, grouped: r.grouped }));
  const runId = ++runCounter;

  const existsQuery = AppView.searchQuery.trim() || null;
  const scoreRange = activeScoreRange() || null;
  const rebindQuery = popoverRebindQuery();

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
  if (deferredTimer) { clearTimeout(deferredTimer); deferredTimer = null; }
  dispatchRun(stack, sort, scope).then(resolve);
}

function onWorkerMessage({ data }) {
  if (!data) return;
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
    }
    run.resolve(erroredResult(run.stack));
  }
}

// ─── Result materialization ── inverse of engine/worker.js's postResult ───────
function materializeResult(data, stack, scope) {
  const { grouped, atomCount, payload } = data;

  if (!grouped && payload.indices && !payload.chains) {
    // Every flat result must re-stamp the holder — even a null-layout one — so a
    // scope switch can't leave a previous scope's layout behind for the scope-key
    // guard to wrongly accept.
    setShippedScopedLayout(payload.histogramLayout ?? null, scope);
    return {
      flat: true,
      indices: new Int32Array(payload.indices),
      scores: new Int32Array(payload.scores),
      widthHints: payload.widthHints,
      stats: payload.stats ?? null,
      histogramCounts: payload.histogramCounts ?? null,
      histogramLayout: payload.histogramLayout ?? null,
      existsInScope: payload.existsInScope ?? null,
      existsInMerge: payload.existsInMerge ?? null,
      rebindQuery: payload.rebindQuery ?? null,
      rebindEntry: rebuildRebindEntry(payload.rebindEntry),
      rebindExists: payload.rebindExists ?? null,
      firstRows: payload.firstRows ?? null,
      filtered: !!payload.filtered,
      ranAgainstOwned: !!data.ranAgainstOwned,
      atomCount, grouped: false, aborted: false,
    };
  }

  // Rebuilt each pass (not memoized) so an add/remove/reorder between runs can't
  // resolve a rich atom's sourceId to a stale wordlist.
  const sourceById = new Map(state.sources.map(w => [w.dbKey, w]));
  const rows = grouped
    ? payload.groups.map(g => decodeGroup(g, sourceById))
    : payload.chains.map(c => decodeChain(c, sourceById));
  if (grouped) {
    // Stamp the holder so scopedHistogramLayout() returns the SAME axis the worker
    // bucketed histogramCounts against; otherwise the scoped grouped histogram
    // renders counts against a mismatched axis and silently mis-bins.
    setShippedScopedLayout(payload.histogramLayout ?? null, scope);
    return {
      rows, atomCount, grouped, aborted: false,
      stats: payload.stats ?? null,
      histogramCounts: payload.histogramCounts ?? null,
      histogramLayout: payload.histogramLayout ?? null,
      groupWidthHints: payload.groupWidthHints ?? null,
      chainCount: payload.chainCount ?? null,
      groupCount: payload.groupCount ?? null,
      filtered: !!payload.filtered,
    };
  }
  return { rows, atomCount, grouped, aborted: false };
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

// ─── Self-build bridge ── boot handshake + test oracle ── see docs/worker-protocol.md ──
let configRequestId = 0;
export function syncConfigsSent() { return configRequestId; }
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
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(false); }, 5000);
    function onMessage({ data }) {
      if (data?.type !== 'selfReady' || data.configId !== configId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      setShippedAllSourcesAxis(data.axis, data.version);
      setShippedConfigCounts(data.sourceCounts ?? null, data.mergedCount ?? null, data.version);
      applySelfReadyFreshness(data, scope, configId);
      resolve(data.count);
    }
    w.addEventListener('message', onMessage);
    w.postMessage(payload);
  });
}

// The build's selfReady is the deferred-run drain trigger. A SUCCESSFUL build
// (built) marks the worker fresh for this sync's scope → drainDeferred dispatches
// any matching deferral (settle paths 1/3). A genuinely FAILED build (the latest
// sync, ownedCorpus null) must NOT mark fresh — it leaves the deferred run
// undispatchable, the hang trap: settle it errored (settle path 4). A SUPERSEDED
// build also reports built:false (its work was discarded for a newer sync), but a
// newer syncConfig is in flight that WILL drain the deferral, so its selfReady is
// ignored — settling errored here would prematurely fail a run a later build serves.
function applySelfReadyFreshness(data, scope, configId) {
  if (data.built) {
    ownedFreshScope = scope;
    drainDeferred();
  } else if (configId === configRequestId && deferredRun && deferredRun.scope === scope) {
    const { stack, resolve } = deferredRun;
    deferredRun = null;
    if (deferredTimer) { clearTimeout(deferredTimer); deferredTimer = null; }
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

// ─── Edit-seed fetch bridge ── see docs/worker-protocol.md ───────────────────
// Own requestId space, independent of the run's runId: a popover query must not
// touch run supersession. A timeout resolves null so main falls back to its
// local clicked seed rather than hanging the editor.
let fetchEditSeedRequestId = 0;
let editSeedFetches = 0;
export function fetchEditSeedFetchCount() { return editSeedFetches; }
export function fetchWorkerEditSeed(norm, display, timeout = 5000) {
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

// ─── Provenance + preview fetch bridge ── see docs/worker-protocol.md ────────
// Its own requestId space, independent of both the run's runId and the edit-seed
// lane: a popover query must not touch run or seed supersession. A timeout resolves
// {preview:null,rows:null} so main falls back to its local corpus reads.
let fetchProvenanceRequestId = 0;
let provenanceFetches = 0;
export function fetchProvenanceFetchCount() { return provenanceFetches; }
export function fetchWorkerProvenance(typedRaw, previewRaw, clickedNorm, clickedDisplay, timeout = 5000) {
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

// ─── My Edits edit/add command bridge ── see docs/worker-protocol.md ─────────
let editEntryId = 0;
export function sendEditEntry(orig, next, timeout = 5000) {
  const w = getWorker();
  const editId = ++editEntryId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'editAck' || data.editId !== editId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ norms: data.norms, edited: data.edited, axis: data.axis, counts: data.counts });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'editEntry', editId, orig, next });
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
      resolve({ norms: data.norms, edited: data.edited, axis: data.axis, counts: data.counts });
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

let flushEditsRequestId = 0;
export function fetchWorkerFlushEdits(timeout = 5000) {
  const w = getWorker();
  const requestId = ++flushEditsRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'flushResult' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve({ text: data.text, changed: data.changed });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'flushEdits', requestId });
  });
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
      resolve({ start: data.start, rows: data.rows });
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'fetchRows', requestId, runId, start, end });
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
      if (runId !== lastResultRunId) { resolve(null); return; }   // superseded run — drop
      const sourceById = new Map(state.sources.map(s => [s.dbKey, s]));
      resolve({ start: data.start, groups: data.groups.map(g => decodeGroup(g, sourceById)) });
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
export function fetchWorkerSerialize(scope, format, sort, timeout = 5000) {
  const w = getWorker();
  const requestId = ++fetchSerializeRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(null); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'serialized' || data.requestId !== requestId) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve(data.text ?? null);
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'serializeFor', requestId, scope, format, sort });
  });
}
