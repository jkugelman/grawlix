// ─── Pipeline worker host ── see docs/worker-protocol.md ─────────────────────

import { unpackSnapshot } from './snapshot.js';
import { TOOLS, makeToolRow } from './tools.js';
import { executePipeline, configureExecutorYield, invalidatePreSearchCache } from './executor.js';
import { configureIO as configureSegmenterIO } from './segmenter.js';

// scheduler.yield() (the executor's default) starves the worker's run/cancel
// message on Chromium and a microtask yield never delivers it — either silently
// breaks supersession. setTimeout(0) is the one yield the B1 spike proved
// preempts an in-flight run. ~30ms is a cancellation-latency dial, not
// correctness.
configureExecutorYield({
  yieldImpl: () => new Promise(r => setTimeout(r, 0)),
  intervalMs: 30,
});

// Segmenter I/O. idbGet/idbPut live in data/storage.js, a layer the engine
// can't import, so the worker opens the SAME DB/store itself — name/version/store
// MUST track storage.js's openDB, else it silently opens a different or
// wrong-version DB and the shared unigram-corpus cache stops being shared (a
// re-fetch, not an error). onSize is a no-op: the LS size note is main-only.
const SEGMENTER_IDB_NAME = 'grawlix';
const SEGMENTER_IDB_STORE = 'data';
let _segmenterDb = null;
function segmenterDb() {
  if (_segmenterDb) return _segmenterDb;
  _segmenterDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(SEGMENTER_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(SEGMENTER_IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
  return _segmenterDb;
}
configureSegmenterIO({
  async idbGet(key) {
    const db = await segmenterDb();
    return new Promise(resolve => {
      const req = db.transaction(SEGMENTER_IDB_STORE, 'readonly').objectStore(SEGMENTER_IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  },
  async idbPut(key, val) {
    const db = await segmenterDb();
    return new Promise(resolve => {
      const tx = db.transaction(SEGMENTER_IDB_STORE, 'readwrite');
      tx.objectStore(SEGMENTER_IDB_STORE).put(val, key);
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

async function runOne({ runId, snapshotId: reqSnapshotId, stack: serialized }) {
  const signal = makeSignalShim(runId);
  const stack = deserializeStack(serialized);
  let out;
  try {
    out = await executePipeline(corpus, stack, signal);
  } catch (e) {
    if (isAbortError(e) || signal.aborted) return;
    postMessage({ type: 'error', runId, stackRowIndex: stackRowIndex(stack, e), message: e?.message || String(e) });
    return;
  }
  if (signal.aborted) return;

  postResult(runId, reqSnapshotId ?? snapshotId, out);
}

function stackRowIndex(stack, e) {
  const idx = stack.indexOf(e?.stackRow);
  return idx === -1 ? null : idx;
}

// ─── Result encoding ── three tiers, see docs/worker-protocol.md ──────────────
// The flat path keeps only atoms[0]'s index + the per-atom highlights, dropping
// glyphs and every other atom's identity — lossless ONLY when a row is a single
// word (search/filter, every atom the same corpus entry). A transform spans
// words (distinct norms, glyphs) or emits a synthetic, so any rich row forces
// the atom-sequence encoding for the whole result. Only the flat tier transfers
// a buffer; the heavily-filtered transform/grouped payloads ride structured
// clone as objects.
function postResult(runId, sid, { rows, atomCount, grouped }) {
  const base = { type: 'result', runId, snapshotId: sid, grouped, atomCount };

  if (grouped) {
    postMessage({ ...base, payload: { groups: rows.map(encodeGroup) } });
    return;
  }
  if (rows.some(rowIsRich)) {
    postMessage({ ...base, payload: { chains: rows.map(encodeChain) } });
    return;
  }

  const indices = new Int32Array(rows.length);
  const highlights = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    indices[i] = entryToIndex.get(row.atoms[0].wlEntry);
    highlights[i] = row.atoms.map(a => a.highlights);
  }
  postMessage(
    { ...base, payload: { indices: indices.buffer, highlights } },
    [indices.buffer],
  );
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

    case 'run':
      latestRunId = data.runId;
      pending = data;
      drainRuns();
      break;

    case 'cancel':
      latestRunId++;
      pending = null;
      break;
  }
};
