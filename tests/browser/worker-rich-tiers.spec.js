const { test, expect } = require('@playwright/test');

// B3b worker-HOST test: the transform-chain and grouped result tiers, driven raw
// via postMessage + dynamic import of the served /src modules (sibling to
// worker-flat-tier.spec.js, the flat-tier oracle). Decodes the worker's atom/
// group encoding and compares it row-for-row to an in-page executePipeline run.
// Those /src paths exist only in the unbundled tree, so this can't run on dist.
test.skip(!!process.env.GRAWLIX_SITE_DIR && process.env.GRAWLIX_SITE_DIR !== 'site',
  'worker-host test imports unbundled /src modules; runs against site/ only');

async function blankPage(page) {
  await page.route('**/worker-host-blank', route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><title>worker host</title>' }));
  await page.goto('/worker-host-blank');
}

// Runs `stack` through the worker AND in-page executePipeline, decodes the
// worker's tiered payload back to plain atom/group shapes, and returns both sides
// for a by-value compare. `seedCorpus` optionally pre-populates the shared
// unigram-corpus IDB record (DB `grawlix`, store `data`) so Space out — the one
// transform that emits synthetics — works in both threads.
function runRichStack(page, entries, stack, seedCorpus) {
  return page.evaluate(async ({ entries, stack, seedCorpus }) => {
    const { packSnapshot, snapshotTransferables, unpackSnapshot } =
      await import('/src/engine/snapshot.js');
    const { executePipeline, invalidatePreSearchCache } = await import('/src/engine/executor.js');
    const { makeToolRow } = await import('/src/engine/tools.js');
    const segmenter = await import('/src/engine/segmenter.js');

    const refCorpus = unpackSnapshot(packSnapshot(entries));

    // Plain {norm,display,score} for a wlEntry — strips the wordlist ref/comment
    // so ref and worker (separate object graphs) compare by value.
    const lean = e => e == null ? null : { norm: e.norm, display: e.display, score: e.score };
    const refAtom = a => ({ entry: lean(a.wlEntry), highlights: a.highlights ?? null, glyph: a.glyph ?? null });
    const refChain = c => c.atoms.map(refAtom);

    if (seedCorpus) {
      // Write the corpus the worker will read from IDB, and load the in-page
      // module's copy so the oracle's Space out resolves the same way.
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('grawlix', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('data');
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise(resolve => {
        const tx = db.transaction('data', 'readwrite');
        tx.objectStore('data').put(
          { map: new Map(Object.entries(seedCorpus.freqs)), minLog: seedCorpus.minLog },
          'corpus_unigrams_decoded');
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
      segmenter.invalidateUnigramCorpus();
      segmenter.setUnigramCorpus(seedCorpus.freqs, seedCorpus.minLog);
      // In-page module still needs configureIO for any path that re-loads; the
      // worker configures its own at boot.
      segmenter.configureIO({
        idbGet: () => Promise.resolve({ map: new Map(Object.entries(seedCorpus.freqs)), minLog: seedCorpus.minLog }),
        idbPut: () => Promise.resolve(),
        onSize: () => null,
      });
    }

    invalidatePreSearchCache();
    const refStack = stack.map(({ tool, params, grouped }) => {
      const row = makeToolRow(tool);
      if (params) row.params = { ...row.params, ...params };
      if (grouped) row.grouped = true;
      return row;
    });
    const ref = await executePipeline(refCorpus, refStack, {});

    // Decode the worker's atom encoding: {i} → corpus entry, {s} → inline
    // synthetic; h/g optional. Mirror it onto the ref's plain atom shape.
    const decodeAtom = a => ({
      entry: 'i' in a ? lean(refCorpus.entries[a.i]) : { norm: a.s.norm, display: a.s.display, score: a.s.score },
      highlights: a.h ?? null,
      glyph: a.g ?? null,
    });
    const decodeChain = c => c.atoms.map(decodeAtom);

    const worker = new Worker(new URL('/src/engine/worker.js', location.origin), { type: 'module' });
    const result = await new Promise((resolve, reject) => {
      worker.onerror = e => reject(new Error('worker onerror: ' + e.message));
      worker.onmessage = ({ data }) => { if (data.type === 'result') resolve(data); };
      const snap = packSnapshot(entries);
      worker.postMessage({ type: 'snapshot', snapshotId: 1, ...snap }, snapshotTransferables(snap));
      worker.postMessage({ type: 'run', runId: 1, snapshotId: 1, stack });
    });
    worker.terminate();

    const out = { grouped: result.grouped, atomCount: result.atomCount, refAtomCount: ref.atomCount };

    if (result.grouped) {
      out.refGroups = ref.rows.map(g => ({
        key: g.key,
        anchor: lean(g.anchor),
        minScore: g._minScore, maxScore: g._maxScore, count: g._count,
        chains: g.chains.map(refChain),
      }));
      out.workerGroups = result.payload.groups.map(g => ({
        key: g.key,
        anchor: g.anchor ? decodeAtom(g.anchor).entry : null,
        minScore: g._minScore, maxScore: g._maxScore, count: g._count,
        chains: g.chains.map(decodeChain),
      }));
    } else if (result.payload.chains) {
      out.refChains = ref.rows.map(refChain);
      out.workerChains = result.payload.chains.map(decodeChain);
      out.hasSynthetic = true;
    } else {
      // Folded to single-atom rows → the B5 flat index payload (no highlights),
      // so this compares entries in the worker's entry/asc order, not chains.
      out.hasSynthetic = false;
      const cmp = (a, b) =>
        a.norm.localeCompare(b.norm) || (b.norm.length - a.norm.length) || (b.score - a.score);
      out.refEntries = ref.rows.map(r => lean(r.atoms[0].wlEntry)).sort(cmp);
      out.workerEntries = [...new Int32Array(result.payload.indices)].map(i => lean(refCorpus.entries[i]));
      out.workerScores = [...new Int32Array(result.payload.scores)];
      out.refScores = out.refEntries.map(e => e.score);
    }
    return out;
  }, { entries, stack, seedCorpus });
}

// ─── Corpus & stacks ──────────────────────────────────────────────────────────

const CORPUS = [
  { norm: 'sling',   display: null,    score: 50 },
  { norm: 'ling',    display: null,    score: 40 },
  { norm: 'party',   display: null,    score: 60 },
  { norm: 'part',    display: null,    score: 55 },
  { norm: 'cart',    display: null,    score: 35 },
  { norm: 'art',     display: null,    score: 45 },
  { norm: 'elvis',   display: null,    score: 70 },
  { norm: 'lives',   display: null,    score: 65 },
  { norm: 'evils',   display: null,    score: 30 },
  { norm: 'veils',   display: null,    score: 25 },
  { norm: 'stressed', display: null,   score: 80 },
  { norm: 'desserts', display: null,   score: 75 },
  // Initialisms group: two phrases sharing the initialism 'hot', with 'hot' a
  // corpus entry so the group has an anchor.
  { norm: 'helenoftroy', display: 'Helen of Troy', score: 90 },
  { norm: 'heatoftheday', display: 'Heat of the Day', score: 85 },
  { norm: 'hot',       display: null,  score: 20 },
];

const transformStacks = {
  'Behead (corpus-only atoms, input highlights)': {
    stack: [{ tool: 'behead', params: { count: '1' } }],
    synthetic: false,
  },
  'Curtail (corpus-only atoms, input highlights)': {
    stack: [{ tool: 'curtail', params: { count: '1' } }],
    synthetic: false,
  },
  'Anagrams as a chain filter (no transform → folds to single-atom rows)': {
    stack: [{ tool: 'anagrams', params: { entry: 'elvis' } }],
    synthetic: false,
  },
  'Semordnilap (bidirectional, unify folds the mirror to one ↔ row)': {
    stack: [{ tool: 'semordnilap' }],
    synthetic: false,
  },
  'Behead then Curtail (multi-step chain, three atoms)': {
    stack: [{ tool: 'behead', params: { count: '1' } }, { tool: 'curtail', params: { count: '1' } }],
    synthetic: false,
  },
};

const groupStacks = {
  'Anagrams grouped (string key, no anchor)': [
    { tool: 'anagrams', grouped: true },
  ],
  'Initialisms grouped (display-keyed, with anchor)': [
    { tool: 'initialisms', grouped: true },
  ],
};

// Tiny unigram corpus that makes SPACEOUT-style entries split into parts that
// are themselves entries, while the joined phrase ("cat dog") is NOT a corpus
// entry — so Space out emits an inline synthetic atom.
const SYNTH_CORPUS = [
  { norm: 'cat', display: null, score: 50 },
  { norm: 'dog', display: null, score: 40 },
  { norm: 'catdog', display: null, score: 30 },
];
const SYNTH_FREQS = { cat: -1.0, dog: -1.1 };
const SYNTH_SEED = { freqs: SYNTH_FREQS, minLog: -3.0 };

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('transform-chain tier matches the main-thread oracle', () => {
  for (const [name, { stack }] of Object.entries(transformStacks)) {
    test(name, async ({ page }) => {
      await blankPage(page);
      const r = await runRichStack(page, CORPUS, stack);
      expect(r.grouped).toBe(false);
      expect(r.atomCount).toBe(r.refAtomCount);
      if (r.workerChains) {
        expect(r.workerChains).toEqual(r.refChains);
      } else {
        // Folded to single-atom rows → the flat index payload (B5).
        expect(r.workerEntries).toEqual(r.refEntries);
        expect(r.workerScores).toEqual(r.refScores);
      }
    });
  }
});

test.describe('grouped tier matches the main-thread oracle', () => {
  for (const [name, stack] of Object.entries(groupStacks)) {
    test(name, async ({ page }) => {
      await blankPage(page);
      const r = await runRichStack(page, CORPUS, stack);
      expect(r.grouped).toBe(true);
      expect(r.atomCount).toBe(r.refAtomCount);
      expect(r.workerGroups).toEqual(r.refGroups);
    });
  }
});

test('Space out emits inline synthetic atoms, encoded and decoded round-trip', async ({ page }) => {
  await blankPage(page);
  const r = await runRichStack(page, SYNTH_CORPUS, [{ tool: 'space_out', params: { splits: 'many' } }], SYNTH_SEED);
  expect(r.grouped).toBe(false);
  // The synthetic atom forces the rich-chain payload, not the index payload.
  expect(r.hasSynthetic).toBe(true);
  expect(r.workerChains).toEqual(r.refChains);
  // Sanity: a synthetic atom round-tripped through the inline {s} branch. The
  // split phrase "cat dog" norms to "catdog" (same as the corpus entry) but
  // carries display "cat dog" — a (norm,display) pair no corpus entry has, so it
  // can only have come from the synthetic encoding, not an index lookup.
  const corpusPairs = new Set(SYNTH_CORPUS.map(e => `${e.norm}\0${e.display}`));
  const synth = r.workerChains.flat().find(a =>
    a.entry && !corpusPairs.has(`${a.entry.norm}\0${a.entry.display}`));
  expect(synth, 'expected a synthetic output atom').toMatchObject(
    { entry: { norm: 'catdog', display: 'cat dog', score: 30 } });
});
