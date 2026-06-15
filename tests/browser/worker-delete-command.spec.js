import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// P6b/P6c oracle: the worker's in-place `deleteEntry` command removes one My
// Edits entry by (norm, display) and runs the SAME owned-corpus splice an edit
// does for the deleted norm — without a full resyncWorkerConfig. The resulting
// merged corpus must be byte-identical to main's build of the same delete. The
// worker dump is captured BEFORE main's deleteFromEdits (whose persist fires a
// resync), so no resync intervenes between syncWorkerConfig and the dump.
//
// P6c also proves the order-independence invariant: undo of a delete re-adds the
// deleted record via editEntry's add path (orig: null), and because the corpus
// SORTS everywhere (buildCorpus/computeMergedBucket, serializeEntries) and
// getRescoredByNorm is a map, a plain push at an arbitrary position yields a
// merged corpus byte-identical to before the delete — even for a multi-variant
// norm.

const MERGED = '__merged__';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// addCustomWordlist appends, so priority is Alpha > Bravo. Bravo shares OVER
// (the contested-winner case): deleting My Edits' OVER hands the bucket off.
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
// multi-variant (two displays). Seeded via a My Edits import so two genuine
// variants of "theirs" coexist. flushEditsToIdb so syncWorkerConfig reads them.
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

// Captures the worker dump BEFORE applying the delete to main — main's
// deleteFromEdits persist fires a resync, so this ordering guarantees no resync
// sits between syncWorkerConfig and the worker dump under test.
async function runDeleteCase(page, target) {
  const pre = (await dumpWorker(page, MERGED)).entries;

  const ack = await page.evaluate(t => window.__grawlixTest.sendWorkerDeleteEntry(t), target);
  expect(ack).not.toBeNull();

  const workerDump = await dumpWorker(page, MERGED);
  expect(workerDump.error).toBeFalsy();
  const workerPost = workerDump.entries;

  await page.evaluate(t => window.__grawlixTest.deleteMyEditFrom(t), target);
  const mainPost = await dumpMain(page, MERGED);

  return { pre, workerPost, mainPost, ack };
}

function assertConverged({ pre, workerPost, mainPost }) {
  expect(workerPost).toEqual(mainPost);         // worker splice == main rebuild
  expect(workerPost).not.toEqual(pre);          // non-vacuity: the delete changed something
}

// ─── DELETE × three norm kinds ───────────────────────────────────────────────

test('delete — edits-only norm vanishes from the merge', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  const r = await runDeleteCase(page, { norm: 'gull', display: 'GULL' });
  assertConverged(r);
  // GULL existed only in My Edits → gone from the merge entirely.
  expect(r.pre.some(e => e[0] === 'gull')).toBe(true);
  expect(r.workerPost.some(e => e[0] === 'gull')).toBe(false);
});

test('delete — override norm hands the bucket to a lower-priority source', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // OVER is contested: My Edits (99) wins, Alpha (70) and Bravo (40) also carry
  // it. Deleting My Edits' OVER hands the merged bucket to Alpha (next priority).
  const r = await runDeleteCase(page, { norm: 'over', display: 'OVER' });
  assertConverged(r);
  const over = r.workerPost.find(e => e[0] === 'over');
  expect(over).toBeTruthy();                          // norm survives — other sources have it
  const alpha = await page.evaluate(() => state.sources.find(s => s.name === 'Alpha').dbKey);
  expect(over[5]).toBe(alpha);                        // new winner is Alpha (priority, not score)
  expect(over[2]).toBe(70);                           // Alpha's score
});

test('delete — multi-variant norm keeps the other variants', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // "theirs" has two displays in My Edits. Delete one; the other must remain.
  const r = await runDeleteCase(page, { norm: 'theirs', display: 'the IRS' });
  assertConverged(r);
  const variants = r.workerPost.filter(e => e[0] === 'theirs').map(e => e[1]).sort();
  expect(variants).toEqual(['The Irs']);
});

// ─── DELETE → UNDO round-trip (byte-identical) ───────────────────────────────
// Undo re-adds the deleted record via editEntry's add path (orig: null). The
// post-undo dump must equal the pre-delete dump exactly — proving rawEntries
// ORDER affects no output (the push lands at an arbitrary position, the corpus
// sorts regardless).

async function deleteThenUndo(page, target, restored) {
  const pre = (await dumpWorker(page, MERGED)).entries;

  const delAck = await page.evaluate(t => window.__grawlixTest.sendWorkerDeleteEntry(t), target);
  expect(delAck).not.toBeNull();
  const afterDelete = (await dumpWorker(page, MERGED)).entries;
  expect(afterDelete).not.toEqual(pre);              // non-vacuity: the delete changed something

  const undoAck = await page.evaluate(rec =>
    window.__grawlixTest.sendWorkerEditEntry(null, rec), restored);
  expect(undoAck).not.toBeNull();
  const afterUndo = (await dumpWorker(page, MERGED)).entries;

  return { pre, afterDelete, afterUndo };
}

test('delete → undo restores the corpus byte-identically (edits-only norm)', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  const { pre, afterUndo } = await deleteThenUndo(page,
    { norm: 'gull', display: 'GULL' },
    { norm: 'gull', display: 'GULL', score: 95, comment: 'seabird' });
  expect(afterUndo).toEqual(pre);
});

test('delete → undo restores the corpus byte-identically (override norm)', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // Deleting OVER hands the bucket to Alpha; re-adding My Edits' OVER must take
  // it back and restore the exact pre-delete winner/score/comment.
  const { pre, afterUndo } = await deleteThenUndo(page,
    { norm: 'over', display: 'OVER' },
    { norm: 'over', display: 'OVER', score: 99, comment: 'edits-over' });
  expect(afterUndo).toEqual(pre);
});

test('delete → undo restores a multi-variant norm byte-identically', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // Delete one of the two "theirs" variants, then re-add it. The full variant
  // set AND its sort order must match the pre-delete corpus exactly — the
  // order-independence proof: the re-added record pushes at an arbitrary
  // rawEntries position, yet the variant set sorts back identically.
  const { pre, afterDelete, afterUndo } = await deleteThenUndo(page,
    { norm: 'theirs', display: 'the IRS' },
    { norm: 'theirs', display: 'the IRS', score: 88, comment: '' });

  // After the delete only "The Irs" remained; after undo both variants return.
  const deletedVariants = afterDelete.filter(e => e[0] === 'theirs').map(e => e[1]).sort();
  expect(deletedVariants).toEqual(['The Irs']);
  expect(afterUndo).toEqual(pre);
});

// ─── Freshness-window regression: no resync, immediate rich rows ──────────────

test('after deleteEntry (no resync) an immediate run still serves FRESH rich rows', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page, null);

  // Drive the worker delete only (no resync, no main delete), then run a flat
  // search and assert fetchWorkerRows returns rich rows — proving deleteEntry
  // kept ownedCorpusFresh true rather than degrading to the index-only fallback.
  await page.evaluate(() =>
    window.__grawlixTest.sendWorkerDeleteEntry({ norm: 'gull', display: 'GULL' }));

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'r' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const win = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 1000));
  expect(win).not.toBeNull();
  expect(win.rows.length).toBeGreaterThan(0);
  for (const row of win.rows) {
    expect('i' in row).toBe(false);
    expect(row).toHaveProperty('norm');
    expect(row).toHaveProperty('sourceId');
  }
});

// ─── Scoped-to-My-Edits: ownedCorpus is a distinct object, must splice too ────

test('delete while scoped to My Edits splices the scoped corpus too', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);

  const editsKey = await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  await page.evaluate(() => window.__grawlixTest.setScope('My Edits'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  const preScoped = (await dumpWorker(page, editsKey)).entries;
  const preMerged = (await dumpWorker(page, MERGED)).entries;

  await page.evaluate(() =>
    window.__grawlixTest.sendWorkerDeleteEntry({ norm: 'gull', display: 'GULL' }));

  const workerScoped = (await dumpWorker(page, editsKey)).entries;
  const workerMerged = (await dumpWorker(page, MERGED)).entries;

  await page.evaluate(() =>
    window.__grawlixTest.deleteMyEditFrom({ norm: 'gull', display: 'GULL' }));
  const mainScoped = await dumpMain(page, editsKey);
  const mainMerged = await dumpMain(page, MERGED);

  expect(workerScoped).toEqual(mainScoped);
  expect(workerScoped).not.toEqual(preScoped);   // scoped corpus actually changed
  expect(workerMerged).toEqual(mainMerged);
  expect(workerMerged).not.toEqual(preMerged);
});
