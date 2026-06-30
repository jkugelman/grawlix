import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// P6a oracle: the worker's in-place `editEntry` command (My Edits edit AND add)
// mutates ONLY the worker's owned corpus — no full resyncWorkerConfig — and the
// resulting merged corpus must be byte-identical to main's build of the same
// edit. This proves the O(affected-norms) splice alone is correct, not a hidden
// rebuild: the worker dump is captured BEFORE main's saveMyEdit (whose persist
// fires a resync), so no resync intervenes between syncWorkerConfig and the dump.
//
// Three norm kinds per operation: (a) edits-only norm, (b) override norm (another
// enabled source also has it → contested winner), (c) multi-variant norm (same
// norm, multiple displays). Each asserts worker==main equality + non-vacuity
// (pre ≠ post).

const MERGED = '__merged__';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// addCustomWordlist appends, so priority is Alpha > Bravo. Bravo shares OVER
// (the contested-winner case).
async function seed(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ABLE', 'OVER', 'CRANE'], scores: [80, 70, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo', entries: ['BIRD', 'OVER', 'DRAKE'], scores: [50, 40, 30],
    comments: ['', 'bravo-over', ''],
  }));
}

// GULL = edits-only norm; OVER = override (also in Alpha/Bravo); "theirs" =
// multi-variant (two displays). Seeded via a My Edits import (not saveMyEdit,
// which renames a same-norm second display rather than adding a variant), so two
// genuine variants of "theirs" actually coexist. flushEditsToIdb so
// syncWorkerConfig reads them.
async function seedEdits(page) {
  const text = ['GULL;95;seabird', 'OVER;99;edits-over', 'the IRS;88', 'The Irs;77'].join('\n');
  await page.evaluate(t => window.__grawlixTest.reimport('My Edits', t), text);
  await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
}

async function enterFreshOwned(page, scopeName) {
  await page.evaluate(n => window.__grawlixTest.setScope(n), scopeName ?? null);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

const dumpWorker = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpWorkerCorpus(s), scope);
const dumpMain = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpMainCorpus(s), scope);

// Captures the worker dump BEFORE applying the edit to main — main's saveMyEdit
// persist fires a resync, so this ordering is what guarantees no resync sits
// between syncWorkerConfig and the worker dump under test.
async function runEditCase(page, { orig, next }) {
  const pre = (await dumpWorker(page, MERGED)).entries;

  const ack = await page.evaluate(({ o, n }) =>
    window.__grawlixTest.sendWorkerEditEntry(o, n), { o: orig, n: next });
  expect(ack).not.toBeNull();

  const workerDump = await dumpWorker(page, MERGED);
  expect(workerDump.error).toBeFalsy();
  const workerPost = workerDump.entries;

  await page.evaluate(({ o, n }) =>
    window.__grawlixTest.saveMyEditFrom(o, n.display, n.score, n.comment), { o: orig, n: next });
  const mainPost = await dumpMain(page, MERGED);

  return { pre, workerPost, mainPost, ack };
}

function assertConverged({ pre, workerPost, mainPost }) {
  expect(workerPost).toEqual(mainPost);         // worker splice == main rebuild
  expect(workerPost).not.toEqual(pre);          // non-vacuity: the edit changed something
}

// ─── EDIT (orig present) ─────────────────────────────────────────────────────

test('edit — edits-only norm', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  const r = await runEditCase(page, {
    orig: { norm: 'gull', display: 'GULL' },
    next: { norm: 'gull', display: 'GULL', score: 42, comment: 'changed' },
  });
  assertConverged(r);
});

test('edit — override norm (contested winner)', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // OVER is contested: Alpha, Bravo, and My Edits all carry it. My Edits (highest
  // priority) wins the bucket; re-scoring it exercises the contested re-resolve.
  const r = await runEditCase(page, {
    orig: { norm: 'over', display: 'OVER' },
    next: { norm: 'over', display: 'OVER', score: 10, comment: 'edits-over2' },
  });
  assertConverged(r);
  // Priority (not score) decides the winner — My Edits is first in state.sources.
  const over = r.mainPost.find(e => e[0] === 'over');
  const editsKey = await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  expect(over[5]).toBe(editsKey);
});

test('edit — multi-variant norm', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // Edit one of the two "theirs" variants; the other must stay put.
  const r = await runEditCase(page, {
    orig: { norm: 'theirs', display: 'the IRS' },
    next: { norm: 'theirs', display: 'the IRS', score: 11, comment: 'lowered' },
  });
  assertConverged(r);
  // Both displays still present in the merged corpus.
  const variants = r.workerPost.filter(e => e[0] === 'theirs').map(e => e[1]).sort();
  expect(variants).toEqual(['The Irs', 'the IRS']);
});

// A two-norm MOVE that vacates a norm a RESCORED source also holds: the merged
// winner for the vacated norm hands off to Alpha (rescored → carries rawScore).
// This is the rawScore-sensitive case — main patches the bucket via
// patchMergedForNorms (which drops rawScore on patched norms) and the worker's
// merged splice uses computeMergedBucket (also rawScore-dropping), so the two
// stay byte-identical; a rawScore-carrying worker splice would diverge here.
test('edit — moving a My Edits entry to a new norm junks the vacated norm, suppressing a foreign rescored row', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  // Alpha rescores CRANE (60 → 85), but moving My Edits' own CRANE away junks the vacated
  // norm, so My Edits' highest-priority trash entry wins the crane bucket at 0 — not Alpha.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Alpha', [
    { input: '60', length: '', output: '85', note: '' },
  ]));
  await page.evaluate(() => window.__grawlixTest.reimport('My Edits',
    ['CRANE;50;mine', 'GULL;95;seabird'].join('\n')));
  await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  await enterFreshOwned(page, null);

  const r = await runEditCase(page, {
    orig: { norm: 'crane', display: 'CRANE' },
    next: { norm: 'cranex', display: 'CRANEX', score: 40, comment: 'moved' },
  });
  assertConverged(r);
  const crane = r.workerPost.find(e => e[0] === 'crane');
  const editsKey = await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  expect(crane[5]).toBe(editsKey);
  expect(crane[2]).toBe(0);
  expect(r.workerPost.some(e => e[0] === 'cranex')).toBe(true);
});

// ─── ADD (orig === null) ─────────────────────────────────────────────────────

test('add — edits-only norm', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  const r = await runEditCase(page, {
    orig: null,
    next: { norm: 'heron', display: 'HERON', score: 66, comment: 'wader' },
  });
  assertConverged(r);
  expect(r.workerPost.some(e => e[0] === 'heron')).toBe(true);
});

test('add — override norm (contested winner)', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // ABLE is Alpha-only (80). Add it to My Edits at a higher score — My Edits then
  // wins the merge for ABLE.
  const r = await runEditCase(page, {
    orig: null,
    next: { norm: 'able', display: 'ABLE', score: 90, comment: 'mine' },
  });
  assertConverged(r);
  const able = r.mainPost.find(e => e[0] === 'able');
  const editsKey = await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  expect(able[5]).toBe(editsKey);
});

test('add — multi-variant norm', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // A THIRD display of the existing "theirs" norm — must coexist, not replace.
  const r = await runEditCase(page, {
    orig: null,
    next: { norm: 'theirs', display: 'THE IRS', score: 50, comment: '' },
  });
  assertConverged(r);
  const variants = r.workerPost.filter(e => e[0] === 'theirs').map(e => e[1]).sort();
  expect(variants).toEqual(['THE IRS', 'The Irs', 'the IRS']);
});

// ─── Scoped-to-My-Edits: ownedCorpus is a distinct object, must splice too ────

test('edit while scoped to My Edits splices the scoped corpus too', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);

  // Scope to My Edits so ownedCorpus !== ownedMerged. Then the editEntry splice
  // must patch the scoped ownedCorpus independently.
  const editsKey = await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  await page.evaluate(() => window.__grawlixTest.setScope('My Edits'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  const preScoped = (await dumpWorker(page, editsKey)).entries;
  const preMerged = (await dumpWorker(page, MERGED)).entries;

  await page.evaluate(k =>
    window.__grawlixTest.sendWorkerEditEntry(
      { norm: 'gull', display: 'GULL' },
      { norm: 'gull', display: 'GULL', score: 33, comment: 'edited' },
    ), editsKey);

  const workerScoped = (await dumpWorker(page, editsKey)).entries;
  const workerMerged = (await dumpWorker(page, MERGED)).entries;

  await page.evaluate(() => window.__grawlixTest.saveMyEditFrom({ norm: 'gull', display: 'GULL' }, 'GULL', 33, 'edited'));
  const mainScoped = await dumpMain(page, editsKey);
  const mainMerged = await dumpMain(page, MERGED);

  expect(workerScoped).toEqual(mainScoped);
  expect(workerScoped).not.toEqual(preScoped);   // scoped corpus actually changed
  expect(workerMerged).toEqual(mainMerged);
  expect(workerMerged).not.toEqual(preMerged);
});

// ─── Freshness-window regression: no resync, immediate rich rows ──────────────

test('after editEntry (no resync) an immediate run still serves FRESH rich rows', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // Drive the worker edit only (no resync, no main saveMyEdit), then run a flat
  // search and assert fetchWorkerRows returns rich rows — proving editEntry kept
  // ownedCorpusFresh true rather than degrading to the index-only fallback.
  await page.evaluate(() =>
    window.__grawlixTest.sendWorkerEditEntry(
      { norm: 'gull', display: 'GULL' },
      { norm: 'gull', display: 'GULL', score: 44, comment: 'fresh' },
    ));

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'r' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const win = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 1000));
  expect(win).not.toBeNull();
  expect(win.rows.length).toBeGreaterThan(0);
  for (const row of win.rows) {
    // rich row shape: norm + sourceId present, no bare { i }.
    expect('i' in row).toBe(false);
    expect(row).toHaveProperty('norm');
    expect(row).toHaveProperty('sourceId');
  }
});

// ─── Live synthetic score across a kept pre-search cache ──────────────────────

// A transform above the search bar caches its (synthetic) output in the pre-search
// cache. A score edit reconciles the corpus entry in place — the cache is KEPT, not
// rebuilt — so the kept cache must surface the edited score, not the one baked when
// it was built. Guards the in-place reconcile + live-getter pair end to end.
test('a kept pre-search cache surfaces a live synthetic score after a score edit', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['BARSTOOL'], scores: [70],
  }));

  // rebus 'tool' → Ⓣ turns BARSTOOL into the synthetic "barsⓉ"; the empty search
  // bar leaves rebus the producer, so its output lands in the pre-search cache.
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'rebus', params: { string: ['tool'], symbol: ['Ⓣ'] } },
    { tool: 'search', params: { pattern: '' } },
  ]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const synthScore = () => page.evaluate(async () => {
    const T = window.__grawlixTest;
    const reply = await T.fetchWorkerAllTransformRows(T.lastCompletedRunId());
    const row = reply.rows.find(c => c.atoms[0].wlEntry.norm === 'barstool');
    return row.atoms.at(-1).wlEntry.score;   // the synthetic output atom
  });

  expect(await synthScore()).toBe(70);

  // Key-stable score edit → in-place reconcile keeps the cache; refreshMergedScroller
  // re-runs and re-encodes the cached chains, so the synthetic output reads live.
  await page.evaluate(() => window.__grawlixTest.saveMyEditFrom(
    { norm: 'barstool', display: 'BARSTOOL' }, 'BARSTOOL', 5, ''));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  expect(await synthScore()).toBe(5);
});
