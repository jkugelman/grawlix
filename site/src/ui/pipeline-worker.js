// ─── Pipeline worker client ──────────────────────────────────────────────────
// The worker URL anchors on main.js's import.meta.url (injected at boot), not
// this module's. Bundling inlines this file into main.js at src/ while site/
// serves it from src/ui/ — a literal relative to import.meta.url would resolve
// to different places in the two builds. main.js lands at src/main.js in both,
// so anchoring there makes one relative path correct everywhere, deploy base
// included (no leading-slash hardcoding).

import { packSnapshot, snapshotTransferables } from '../engine/snapshot.js';
import { currentAtomCount } from '../engine/executor.js';

let workerBaseURL = null;
let worker = null;

let shippedCorpus = null;
let shippedSnapshotId = 0;
let lastShippedVersion = null;

export function configurePipelineWorker({ baseURL }) {
  workerBaseURL = baseURL;
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./engine/worker.js', workerBaseURL), { type: 'module' });
    worker.addEventListener('message', onWorkerMessage);
  }
  return worker;
}

export function sendSnapshot(corpus) {
  const w = getWorker();
  const snap = packSnapshot(corpus.entries);
  shippedSnapshotId++;
  w.postMessage(
    { type: 'snapshot', snapshotId: shippedSnapshotId, ...snap },
    snapshotTransferables(snap),
  );
  shippedCorpus = corpus;
  lastShippedVersion = corpus._snapVersion ?? 0;
  return shippedSnapshotId;
}

export function shippedSnapshot() {
  return { corpus: shippedCorpus, snapshotId: shippedSnapshotId };
}

// A My Edits splice mutates the corpus in place (same object), so identity alone
// would leave the worker on stale data — `_snapVersion` is what catches it.
function ensureSnapshot(corpus) {
  const version = corpus._snapVersion ?? 0;
  if (corpus === shippedCorpus && version === lastShippedVersion) return;
  sendSnapshot(corpus);
}

// ─── Run dispatch & supersession ─────────────────────────────────────────────
let runCounter = 0;
let pendingRun = null;   // { runId, resolve, stack } for the latest dispatched run

export function runOnWorker(corpus, stack, sort) {
  ensureSnapshot(corpus);

  // Main owns the per-run _error reset now that the executor runs off-thread —
  // without this an old ⚠ mark persists after the offending tool is fixed.
  for (const row of stack) row._error = null;

  const serialized = stack.map(r => ({ tool: r.tool, params: r.params, grouped: r.grouped }));
  const runId = ++runCounter;

  // A superseded run gets no worker reply — settle the prior one as aborted here
  // or its awaiter (and pipelineIdle, which the whole suite gates on) dangles.
  if (pendingRun) pendingRun.resolve({ aborted: true });

  const w = getWorker();
  return new Promise(resolve => {
    pendingRun = { runId, resolve, stack };
    w.postMessage({ type: 'run', runId, snapshotId: shippedSnapshotId, stack: serialized, sort });
  });
}

function onWorkerMessage({ data }) {
  if (!data) return;
  if (data.type === 'result') {
    if (!pendingRun || data.runId !== pendingRun.runId) return;   // stale — drop
    const run = pendingRun;
    pendingRun = null;
    run.resolve(materializeResult(data, run.stack));
    return;
  }
  if (data.type === 'error') {
    if (!pendingRun || data.runId !== pendingRun.runId) return;
    const run = pendingRun;
    pendingRun = null;
    if (data.stackRowIndex != null && run.stack[data.stackRowIndex]) {
      run.stack[data.stackRowIndex]._error = data.message;
    }
    run.resolve({
      aborted: false, errored: true, rows: [],
      atomCount: currentAtomCount(run.stack), grouped: false,
    });
  }
}

// ─── Result materialization ── inverse of engine/worker.js's postResult ───────
// A stale snapshotId means the worker answered against a corpus main no longer
// holds — its indices name the wrong rich entries, so drop it rather than render
// garbage.
function materializeResult(data, stack) {
  if (data.snapshotId !== shippedSnapshotId) return { aborted: true };
  const corpus = shippedCorpus;
  const { grouped, atomCount, payload } = data;

  let rows;
  if (grouped) {
    rows = payload.groups.map(g => decodeGroup(g, corpus));
  } else if (payload.chains) {
    rows = payload.chains.map(c => decodeChain(c, corpus));
  } else {
    const idx = new Int32Array(payload.indices);
    const { highlights } = payload;
    rows = new Array(idx.length);
    for (let i = 0; i < idx.length; i++) {
      const wlEntry = corpus.entries[idx[i]];
      rows[i] = { atoms: highlights[i].map(h => ({ wlEntry, highlights: h, glyph: null })) };
    }
  }
  return { rows, atomCount, grouped, aborted: false };
}

// A synthetic atom (`{ s }`) is a tool output present in no wordlist; it carries
// its own norm/display/score inline and is deliberately NOT resolved through
// byNorm (that would alias it to a real entry of the same norm).
function decodeAtom(atom, corpus) {
  const wlEntry = 'i' in atom
    ? corpus.entries[atom.i]
    : { norm: atom.s.norm, display: atom.s.display, score: atom.s.score, comment: '', wordlist: null };
  return { wlEntry, highlights: atom.h ?? null, glyph: atom.g ?? null };
}

function decodeChain(chain, corpus) {
  return { atoms: chain.atoms.map(a => decodeAtom(a, corpus)) };
}

function decodeGroup(g, corpus) {
  return {
    key: g.key,
    anchor: g.anchor ? decodeAtom(g.anchor, corpus).wlEntry : null,
    chains: g.chains.map(c => decodeChain(c, corpus)),
    _minScore: g._minScore,
    _maxScore: g._maxScore,
    _count: g._count,
  };
}

export function patchWorkerToolForTest(tool, method, message) {
  getWorker().postMessage({ type: '__testPatchTool', tool, method, message });
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
