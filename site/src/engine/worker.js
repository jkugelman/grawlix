// ─── Pipeline worker host ── see docs/worker-protocol.md ─────────────────────

import { MERGED_ID } from '../core/constants.js';
import { unpackSnapshot, canonicalNormRow } from './snapshot.js';
import { TOOLS, makeToolRow } from './tools.js';
import { executePipeline, configureExecutorYield, invalidatePreSearchCache } from './executor.js';
import { configureIO as configureSegmenterIO } from './segmenter.js';
import { parseWordlist } from './norm.js';
import { compileRescoreRules } from './rescore.js';
import { buildCorpus } from './corpus.js';

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
// Mirrors storage.js's Storage.readWordlist: wordlist text is keyed 'data_' + dbKey.
function readWordlistText(sourceId) {
  return idbGet('data_' + sourceId);
}
configureSegmenterIO({
  idbGet,
  async idbPut(key, val) {
    const db = await dataDb();
    return new Promise(resolve => {
      const tx = db.transaction(DATA_IDB_STORE, 'readwrite');
      tx.objectStore(DATA_IDB_STORE).put(val, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },
  onSize: () => null,
});

// ─── State ───────────────────────────────────────────────────────────────────

let corpus = null;          // { entries, byNorm } from unpackSnapshot
let entryToIndex = null;    // Map(entryObject → corpus index)
let snapshotId = null;
let latestRunId = -1;       // the supersession key; a `run`/`cancel` advances it
let pending = null;
let running = false;
let lastUserStackSig = null;
let selfConfig = null;

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

async function runOne({ runId, snapshotId: reqSnapshotId, stack: serialized, sort }) {
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

  let out;
  try {
    out = await executePipeline(corpus, stack, signal);
  } catch (e) {
    if (isAbortError(e) || signal.aborted) return;
    postMessage({ type: 'error', runId, stackRowIndex: stackRowIndex(stack, e), message: e?.message || String(e) });
    return;
  }
  if (signal.aborted) return;

  postResult(runId, reqSnapshotId ?? snapshotId, out, sort);
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
function postResult(runId, sid, { rows, atomCount, grouped }, sort) {
  const base = { type: 'result', runId, snapshotId: sid, grouped, atomCount };

  if (grouped) {
    postMessage({ ...base, payload: { groups: rows.map(encodeGroup) } });
    return;
  }
  if (rows.some(rowIsRich)) {
    postMessage({ ...base, payload: { chains: rows.map(encodeChain) } });
    return;
  }

  const n = rows.length;
  const indices = new Int32Array(n);
  for (let i = 0; i < n; i++) indices[i] = entryToIndex.get(rows[i].atoms[0].wlEntry);

  sortFlatIndices(indices, sort);

  const scores = new Int32Array(n);
  let maxDisplayLen = 0, maxScore = 0, hasNeg = false;
  for (let i = 0; i < n; i++) {
    const e = corpus.entries[indices[i]];
    scores[i] = e.score;
    const dispLen = (e.display ?? e.norm).length;
    if (dispLen > maxDisplayLen) maxDisplayLen = dispLen;
    if (e.score < 0) hasNeg = true;
    const s = e.score < 0 ? -e.score : e.score;
    if (s > maxScore) maxScore = s;
  }
  const widthHints = {
    maxDisplayLen,
    maxLenDigits: maxDisplayLen > 0 ? String(maxDisplayLen).length : 1,
    maxScoreDigits: String(maxScore).length + (hasNeg ? 1 : 0),
  };

  postMessage(
    { ...base, payload: { indices: indices.buffer, scores: scores.buffer, widthHints } },
    [indices.buffer, scores.buffer],
  );
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
function sortFlatIndices(indices, sort) {
  const axis = FLAT_SORT_AXES[sort?.key] || FLAT_SORT_AXES.entry;
  const primaryDir = sort?.dir === 'desc' ? -1 : 1;
  const entries = corpus.entries;
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

function encodeAtom(atom) {
  const { wlEntry, highlights, glyph } = atom;
  const out = entryToIndex.has(wlEntry)
    ? { i: entryToIndex.get(wlEntry) }
    : { s: { norm: wlEntry.norm, display: wlEntry.display, score: wlEntry.score } };
  if (highlights != null) out.h = highlights;
  if (glyph != null) out.g = glyph;
  return out;
}

function encodeChain(chain) {
  return { atoms: chain.atoms.map(encodeAtom) };
}

function encodeGroup(g) {
  return {
    key: g.key,
    anchor: g.anchor ? encodeAtom({ wlEntry: g.anchor, highlights: null, glyph: null }) : null,
    _minScore: g._minScore,
    _maxScore: g._maxScore,
    _count: g._count,
    chains: g.chains.map(encodeChain),
  };
}

function rowIsRich(row) {
  const first = row.atoms[0].wlEntry;
  return row.atoms.some(a =>
    a.glyph != null || a.wlEntry !== first || !entryToIndex.has(a.wlEntry));
}

// ─── My Edits patch ── see docs/worker-protocol.md ───────────────────────────
// Mirrors data/merge.js's patchMergedForNorms splice. MUST search in main's
// `norm.localeCompare` order, or the splice lands at the wrong index and silently
// corrupts the corpus.
function normLowerBound(entries, norm) {
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].norm.localeCompare(norm) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function applyPatch(data) {
  // No base, or this patch doesn't sit directly atop the snapshot it was built on
  // (id != next): applying it would corrupt the corpus — drop it, a later reship
  // recovers.
  if (!corpus || data.snapshotId !== snapshotId + 1) return;

  const { entries, byNorm } = corpus;
  const chains = corpus._initialChains;
  for (const { norm, rows } of data.norms) {
    const lo = normLowerBound(entries, norm);
    let hi = lo;
    while (hi < entries.length && entries[hi].norm === norm) hi++;

    const newRows = rows.map(r => ({ norm: r.norm, display: r.display, score: r.score }));
    entries.splice(lo, hi - lo, ...newRows);
    if (chains) chains.splice(lo, hi - lo, ...newRows.map(r => ({ atoms: [{ wlEntry: r, highlights: null, glyph: null }] })));
    if (newRows.length) byNorm.set(norm, canonicalNormRow(newRows)); else byNorm.delete(norm);
  }

  // A count-changing splice shifts every later index, so reindexing incrementally
  // would silently misindex — full rebuild, still far cheaper than a reship.
  entryToIndex = new Map();
  for (let i = 0; i < entries.length; i++) entryToIndex.set(entries[i], i);
  invalidatePreSearchCache();
  snapshotId = data.snapshotId;
}

// ─── Self-build (test oracle) ── see docs/worker-protocol.md ─────────────────

async function buildSelfCorpus(scope) {
  const built = [];
  for (const { sourceId, enabled, rescoreRules } of selfConfig.sources) {
    const text = await readWordlistText(sourceId);
    const rawEntries = text ? parseWordlist(text) : [];
    const wl = { dbKey: sourceId, enabled, rescoreRules, rawEntries };
    compileRescoreRules(wl);
    built.push(wl);
  }
  // A scoped build takes the single matching source regardless of enabled,
  // mirroring main's buildScopedCorpus — diverging on the enabled handling here
  // would silently desync the worker's view from main's.
  const list = scope === MERGED_ID
    ? built.filter(w => w.enabled)
    : built.filter(w => w.dbKey === scope);
  return buildCorpus(list);
}

async function dumpCorpus(scope) {
  try {
    const corpus = await buildSelfCorpus(scope);
    const entries = corpus.entries.map(e =>
      [e.norm, e.display, e.score, e.rawScore, e.comment, e.wordlist.dbKey]);
    postMessage({ type: 'corpusDump', scope, entries });
  } catch (e) {
    postMessage({ type: 'corpusDump', scope, entries: [], error: e?.message || String(e) });
  }
}

// ─── Message dispatch ────────────────────────────────────────────────────────

onmessage = ({ data }) => {
  switch (data?.type) {
    case 'ping':
      postMessage({ type: 'pong' });
      break;

    case 'snapshot':
      corpus = unpackSnapshot(data);
      entryToIndex = new Map();
      for (let i = 0; i < corpus.entries.length; i++) entryToIndex.set(corpus.entries[i], i);
      snapshotId = data.snapshotId;
      invalidatePreSearchCache();
      break;

    case 'patch':
      applyPatch(data);
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

    case 'syncConfig':
      selfConfig = data;
      postMessage({ type: 'selfReady', count: data.sources.length });
      break;

    case 'dumpCorpus':
      dumpCorpus(data.scope);
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
