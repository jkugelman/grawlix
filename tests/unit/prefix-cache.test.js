import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeToolRow } from '../../site/src/engine/tools.js';
import { toNorm } from '../../site/src/engine/norm.js';
import {
  executePipeline,
  lastPipelineSeedFrom,
  configureExecutorYield,
} from '../../site/src/engine/executor.js';

// The prefix-state cache seam (§2 of docs/planned/result-cache-followons.md, now shipped):
// executePipeline resumes from the longest cached prefix and runs only the suffix,
// snapshotting each inter-stage state back as a tile. The executor is stateless — all
// reuse rides the worker-supplied `resume` seam. These tests drive the seam two ways:
// single-run mechanics with a mock resume, and multi-run *workflows* (add a row, edit,
// remove, revert, type) through a faithful stand-in for the worker's cache. The byte
// budget / GDS eviction / corpus invalidation live in the worker (tests/browser/prefix-cache.spec.js).

const wlEntry = s => {
  const norm = toNorm(s);
  return { norm, display: norm === s ? null : s, score: 0, comment: '' };
};

function makeCorpus(words) {
  const entries = words.map(wlEntry);
  const byNorm = new Map();
  for (const e of entries) if (!byNorm.has(e.norm)) byNorm.set(e.norm, e);
  return { entries, byNorm };
}

// A row projection stable across tiers: flat chain rows, group rows (with .chains), and
// bare seed entries all reduce to the same [norm, score, highlights, glyph] shape, so
// deepStrictEqual proves a seeded run is byte-identical to a cold one.
const project = rows => rows.map(r => ({
  key: r.key ?? null,
  chains: (r.chains ?? [r]).map(c =>
    (c.atoms ?? [{ wlEntry: c, highlights: null, glyph: null }]).map(a =>
      [a.wlEntry.norm, a.wlEntry.score, a.highlights ?? null, a.glyph ?? null])),
}));

function captureResume({ seedState = null, seedFrom = 0, floorMs = 0 } = {}) {
  const offers = [];
  const resume = {
    seedState, seedFrom, floorMs,
    offer: (prefixLen, state, elapsed) => offers.push({ prefixLen, state, elapsed }),
  };
  return { resume, offers };
}

const MATCHING = Array.from({ length: 200 }, (_, i) => `un${String(i).padStart(4, '0')}ed`);
const S = pattern => ({ tool: 'search', params: { pattern } });   // a serialized search row

function forceDeterministicYields() {
  configureExecutorYield({ yieldImpl: () => Promise.resolve(), intervalMs: 0 });
}

// ─── Single-run mechanics (mock resume) ───────────────────────────────────────

test('flat: seeding from a cached prefix reruns only the suffix, byte-identical to a cold run', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const stack = () => [
    makeToolRow('search', { pattern: 'UN*ED' }),
    makeToolRow('search', { pattern: 'UN*1*ED' }),
    makeToolRow('search', { pattern: 'UN*0*ED' }),
  ];

  const cap = captureResume({ floorMs: 0 });
  const cold = await executePipeline(corpus, stack(), null, null, cap.resume);
  const tile = cap.offers.find(o => o.prefixLen === 1);
  assert.ok(tile, 'the [f0] prefix state must be offered as a tile');

  const { resume } = captureResume({ seedState: tile.state, seedFrom: 1 });
  const seeded = await executePipeline(corpus, stack(), null, null, resume);

  assert.equal(lastPipelineSeedFrom(), 1, 'the seeded run resumed from index 1 — f0 was skipped');
  assert.deepStrictEqual(project(seeded.rows), project(cold.rows));
});

test('tiling: offers cover every user-stack prefix (incl. pre-search) but never the terminal', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const stack = [
    makeToolRow('search', { pattern: 'UN*ED' }),
    makeToolRow('search', { pattern: 'UN*1*ED' }),
    makeToolRow('search', { pattern: 'UN*0*ED' }),
    makeToolRow('search', { pattern: 'UN*2*ED' }),
  ];
  const cap = captureResume({ floorMs: 0 });
  await executePipeline(corpus, stack, null, null, cap.resume);

  // 4 rows → userStackLen 3. Tiles cover prefix lengths 1..3 (3 = the pre-search state,
  // reused when a row is added on top); length 4 (the terminal) is the finished cache's job.
  assert.deepEqual(cap.offers.map(o => o.prefixLen).sort(), [1, 2, 3]);
});

test('tiling: an infinite floor suppresses every tile', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const stack = [
    makeToolRow('search', { pattern: 'UN*ED' }),
    makeToolRow('search', { pattern: 'UN*1*ED' }),
    makeToolRow('search', { pattern: 'UN*0*ED' }),
  ];
  const cap = captureResume({ floorMs: Infinity });
  await executePipeline(corpus, stack, null, null, cap.resume);
  assert.equal(cap.offers.length, 0);
});

test('tuple: seeding from a mid-pipeline group state is byte-identical to a cold run', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(['ape', 'pea', 'bro', 'rob', 'sky', 'sly', 'are', 'era']);
  const stack = () => [
    makeToolRow('umiaq', { query: 'AB;BA' }),
    makeToolRow('search', { pattern: 'PEA' }),
    makeToolRow('search', { pattern: 'AP*' }),
  ];

  const cap = captureResume({ floorMs: 0 });
  const cold = await executePipeline(corpus, stack(), null, null, cap.resume);
  assert.equal(cold.laneKind, 'record', 'fixture must be a tuple run');
  assert.ok(cold.rows.length > 0, 'the downstream filters must keep at least one tuple');
  const tile = cap.offers.find(o => o.prefixLen === 1);
  assert.ok(tile, 'the [umiaq] prefix state must be offered');

  const { resume } = captureResume({ seedState: tile.state, seedFrom: 1 });
  const seeded = await executePipeline(corpus, stack(), null, null, resume);

  assert.equal(lastPipelineSeedFrom(), 1, 'the expensive Umiaq stage was skipped');
  assert.deepStrictEqual(project(seeded.rows), project(cold.rows));
});

// ─── Multi-run workflows (faithful cache stand-in) ────────────────────────────
// A stand-in for the worker's prefix cache + makePrefixResume, so a sequence of runs
// reuses across them exactly as the app does. Keys by the serialized prefix (as the
// worker does), probes longest-first, and offers store. `run` returns the pipeline output.

function prefixHarness(floorMs = 0) {
  const cache = new Map();
  const key = (ser, len) => JSON.stringify(ser.slice(0, len));
  return {
    async run(corpus, ser) {
      const stack = ser.map(r => makeToolRow(r.tool, r.params || {}));
      const userStackLen = ser.length - 1;
      let seedState = null, seedFrom = 0;
      for (let len = userStackLen; len >= 1; len--) {
        const e = cache.get(key(ser, len));
        if (e) { seedState = e; seedFrom = len; break; }
      }
      const resume = { seedState, seedFrom, floorMs, offer: (n, st) => cache.set(key(ser, n), st) };
      return executePipeline(corpus, stack, null, null, resume);
    },
  };
}

// The rows the app would show for `ser`, computed with no reuse (a fresh, empty cache).
const coldRows = async (corpus, ser) => project((await prefixHarness().run(corpus, ser)).rows);

const A = S('UN*ED'), B = S('UN*1*ED'), C = S('UN*0*ED');
const Bx = S('UN*2*ED'), BAR = S('UN*5*ED'), BAR2 = S('UN*7*ED');

test('workflow: one slow tool, add one on top — reuses the first (the reported regression)', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const h = prefixHarness();

  await h.run(corpus, [A, BAR]);              // [A | search] — cold
  assert.equal(lastPipelineSeedFrom(), 0);

  const out = await h.run(corpus, [A, B, BAR]);   // add B on top → [A, B | search]
  assert.equal(lastPipelineSeedFrom(), 1, 'adding a tool on top must reuse the first tool, not rerun it');
  assert.deepStrictEqual(project(out.rows), await coldRows(corpus, [A, B, BAR]));
});

test('workflow: build a stack incrementally — each added tool reuses the last', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const h = prefixHarness();

  await h.run(corpus, [A, BAR]);
  assert.equal(lastPipelineSeedFrom(), 0);
  await h.run(corpus, [A, B, BAR]);
  assert.equal(lastPipelineSeedFrom(), 1);
  const out = await h.run(corpus, [A, B, C, BAR]);
  assert.equal(lastPipelineSeedFrom(), 2, 'the third tool reused [A, B]');
  assert.deepStrictEqual(project(out.rows), await coldRows(corpus, [A, B, C, BAR]));
});

test('workflow: editing a middle tool reuses the prefix above it', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const h = prefixHarness();

  await h.run(corpus, [A, B, C, BAR]);        // caches [A], [A,B], [A,B,C]
  const out = await h.run(corpus, [A, Bx, C, BAR]);   // edit B → Bx
  assert.equal(lastPipelineSeedFrom(), 1, 'a never-seen middle edit reused [A]');
  assert.deepStrictEqual(project(out.rows), await coldRows(corpus, [A, Bx, C, BAR]));
});

test('workflow: removing a tool reuses what remains', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const h = prefixHarness();

  await h.run(corpus, [A, B, BAR]);           // caches [A], [A,B]
  const out = await h.run(corpus, [A, BAR]);      // remove B
  assert.equal(lastPipelineSeedFrom(), 1, 'removing B reused [A]');
  assert.deepStrictEqual(project(out.rows), await coldRows(corpus, [A, BAR]));
});

test('workflow: reverting an edit reuses the whole (still-cached) user stack', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const h = prefixHarness();

  await h.run(corpus, [A, B, BAR]);           // caches [A], [A,B]
  await h.run(corpus, [A, Bx, BAR]);          // edit B → Bx
  const out = await h.run(corpus, [A, B, BAR]);   // revert → [A,B] still cached
  assert.equal(lastPipelineSeedFrom(), 2, 'the revert reused the whole [A, B] user stack');
  assert.deepStrictEqual(project(out.rows), await coldRows(corpus, [A, B, BAR]));
});

test('workflow: typing in the search bar reuses the whole user stack every keystroke', async () => {
  forceDeterministicYields();
  const corpus = makeCorpus(MATCHING);
  const h = prefixHarness();

  await h.run(corpus, [A, B, BAR]);           // caches [A,B] (the pre-search state)
  const out = await h.run(corpus, [A, B, BAR2]);  // change only the trailing search row
  assert.equal(lastPipelineSeedFrom(), 2, 'the keystroke reran only the search row off [A, B]');
  assert.deepStrictEqual(project(out.rows), await coldRows(corpus, [A, B, BAR2]));
});
