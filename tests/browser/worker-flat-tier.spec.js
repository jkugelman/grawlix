const { test, expect } = require('@playwright/test');

// B3a worker-HOST test: drives engine/worker.js directly via raw postMessage +
// dynamic import of the served /src modules, separate from the real client (B4).
// Those /src paths exist only in the unbundled tree, so this can't run against
// dist; the full dist matrix runs at the commit-B gate.
test.skip(!!process.env.GRAWLIX_SITE_DIR && process.env.GRAWLIX_SITE_DIR !== 'site',
  'worker-host test imports unbundled /src modules; runs against site/ only');

async function blankPage(page) {
  await page.route('**/worker-host-blank', route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><title>worker host</title>' }));
  await page.goto('/worker-host-blank');
}

function runFlatStack(page, entries, stack) {
  return page.evaluate(async ({ entries, stack }) => {
    const { packSnapshot, snapshotTransferables, unpackSnapshot } =
      await import('/src/engine/snapshot.js');
    const { executePipeline } = await import('/src/engine/executor.js');
    const { makeToolRow } = await import('/src/engine/tools.js');

    // Reference run on the main thread. unpack(pack(...)) so the corpus matches
    // the worker's byte-for-byte (display-null normalization included).
    const refCorpus = unpackSnapshot(packSnapshot(entries));
    const refStack = stack.map(({ tool, params }) => {
      const row = makeToolRow(tool);
      if (params) row.params = { ...row.params, ...params };
      return row;
    });
    const ref = await executePipeline(refCorpus, refStack, {});
    // Must mirror the worker's FLAT_SORT_AXES.entry exactly (norm asc, norm.length
    // desc, score desc) — a silent divergence false-passes/fails the order check.
    const cmp = (a, b) =>
      a.norm.localeCompare(b.norm) || (b.norm.length - a.norm.length) || (b.score - a.score);
    const refEntries = ref.rows.map(r => r.atoms[0].wlEntry).sort(cmp);

    const worker = new Worker(new URL('/src/engine/worker.js', location.origin), { type: 'module' });
    const result = await new Promise((resolve, reject) => {
      worker.onerror = e => reject(new Error('worker onerror: ' + e.message));
      worker.onmessage = ({ data }) => { if (data.type === 'result') resolve(data); };
      const snap = packSnapshot(entries);
      worker.postMessage({ type: 'snapshot', snapshotId: 1, ...snap }, snapshotTransferables(snap));
      worker.postMessage({ type: 'run', runId: 1, snapshotId: 1, stack, sort: { key: 'entry', dir: 'asc' } });
    });
    worker.terminate();

    const idx = [...new Int32Array(result.payload.indices)];
    const workerEntries = idx.map(i => refCorpus.entries[i]);
    const workerScores = [...new Int32Array(result.payload.scores)];

    return {
      grouped: result.grouped,
      atomCount: result.atomCount,
      refAtomCount: ref.atomCount,
      // By value, not identity: ref and worker entries are separate object graphs.
      refEntries: refEntries.map(e => ({ norm: e.norm, display: e.display, score: e.score })),
      workerEntries: workerEntries.map(e => ({ norm: e.norm, display: e.display, score: e.score })),
      refScores: refEntries.map(e => e.score),
      workerScores,
      widthHints: result.payload.widthHints,
    };
  }, { entries, stack });
}

const CORPUS = [
  { norm: 'cat',     display: null,       score: 50 },
  { norm: 'cot',     display: null,       score: 40 },
  { norm: 'cut',     display: null,       score: 30 },
  { norm: 'dog',     display: 'Dog',      score: 60 },
  { norm: 'united',  display: null,       score: 70 },
  { norm: 'untied',  display: null,       score: 20 },
  { norm: 'theirs',  display: null,       score: 45 },
  { norm: 'theirs2', display: 'the IRS',  score: 55 },
  { norm: 'abcde',   display: null,       score: 10 },
  { norm: 'zebra',   display: 'Zebra',    score: 80 },
];

const flatStacks = {
  'empty search bar (no filter) returns every entry': [
    { tool: 'search', params: { pattern: '' } },
  ],
  'literal substring search': [
    { tool: 'search', params: { pattern: 'at' } },
  ],
  'wildcard ? search': [
    { tool: 'search', params: { pattern: 'c?t' } },
  ],
  'wildcard * search': [
    { tool: 'search', params: { pattern: 'un*ed' } },
  ],
  'class search [aeiou] with highlights': [
    { tool: 'search', params: { pattern: 'c[aou]t' } },
  ],
  'whole-word search': [
    { tool: 'search', params: { pattern: 'cat', 'whole-word': true } },
  ],
  'two stacked searches (multi-atom highlights)': [
    { tool: 'search', params: { pattern: 'c*t' } },
    { tool: 'search', params: { pattern: 'u' } },
  ],
};

test.describe('flat tier runs in the worker and matches the main-thread oracle', () => {
  for (const [name, stack] of Object.entries(flatStacks)) {
    test(name, async ({ page }) => {
      await blankPage(page);
      const r = await runFlatStack(page, CORPUS, stack);

      expect(r.grouped).toBe(false);
      expect(r.atomCount).toBe(r.refAtomCount);
      expect(r.workerEntries).toEqual(r.refEntries);
      expect(r.workerScores).toEqual(r.refScores);
      expect(r.widthHints).toHaveProperty('maxDisplayLen');
      expect(r.widthHints).toHaveProperty('maxLenDigits');
      expect(r.widthHints).toHaveProperty('maxScoreDigits');
    });
  }
});

// ─── Supersession ────────────────────────────────────────────────────────────
test('a superseded run is abandoned; only the latest replies', async ({ page }) => {
  await blankPage(page);

  const outcome = await page.evaluate(async () => {
    const { packSnapshot, snapshotTransferables } = await import('/src/engine/snapshot.js');

    // Determinism: a 200K-entry filter can't finish within one ~30ms yield
    // window, so run #1 reaches a macrotask yield (delivering #2's queued
    // message) before it completes — which is what lets #2 supersede it. Shrink
    // this and the race can invert, silently false-passing.
    const entries = [];
    for (let i = 0; i < 200000; i++) {
      entries.push({ norm: 'w' + i.toString(36), display: null, score: i % 100 });
    }

    const worker = new Worker(new URL('/src/engine/worker.js', location.origin), { type: 'module' });
    const results = [];
    const done = new Promise(resolve => {
      worker.onmessage = ({ data }) => {
        if (data.type !== 'result') return;
        results.push(data.runId);
        // Grace window: a wrongly-surviving #1 result would arrive after #2; without
        // the wait we'd resolve on #2 and never observe the violation.
        setTimeout(resolve, 200);
      };
    });

    const snap = packSnapshot(entries);
    worker.postMessage({ type: 'snapshot', snapshotId: 1, ...snap }, snapshotTransferables(snap));
    worker.postMessage({ type: 'run', runId: 1, snapshotId: 1, stack: [{ tool: 'search', params: { pattern: 'w*' } }] });
    worker.postMessage({ type: 'run', runId: 2, snapshotId: 1, stack: [{ tool: 'search', params: { pattern: 'w*1' } }] });

    await done;
    worker.terminate();
    return results;
  });

  expect(outcome).toEqual([2]);
});
