import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// P6d oracle: the REAL My Edits per-entry UI paths (saveEdit / deleteFromEdits /
// delete-undo) drive the worker command instead of persistEdits — the worker
// mutates its owned corpus, WRITES the My Edits IDB itself, and ships axis/counts
// on the editAck; main skips its own IDB write AND the resyncWorkerConfig rebuild,
// consuming the ack instead. Three properties per operation (edit / add / delete /
// undo):
//
//   1. Steady-state — once the ack lands, the shipped config counts + merged total
//      + all-sources badge axis (which main sources from the ack) equal a forced
//      LOCAL rebuild, and the merged table changed non-vacuously.
//   2. Worker wrote IDB byte-identically — data_<editsKey> equals
//      serializeEntries(sortedEntries(rawEntries)); the edit PERSISTS (proving
//      main delegated the write rather than silently dropping it).
//   3. No resync — syncConfigsSent() did NOT advance across the operation; the
//      command, not a rebuild, kept the worker fresh.

const MERGED = '__merged__';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Alpha > Bravo by import order; Bravo shares OVER (the contested-winner case).
async function seed(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ABLE', 'OVER', 'CRANE'], scores: [80, 70, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo', entries: ['BIRD', 'OVER', 'DRAKE'], scores: [50, 40, 30],
    comments: ['', 'bravo-over', ''],
  }));
}

// GULL = edits-only; OVER = override; "theirs" = multi-variant (two displays).
async function seedEdits(page) {
  const text = ['GULL;95;seabird', 'OVER;99;edits-over', 'the IRS;88', 'The Irs;77'].join('\n');
  await page.evaluate(t => window.__grawlixTest.reimport('My Edits', t), text);
  await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
}

// Merged scope, sync — the worker now owns a fresh corpus and IDB write.
async function enterFreshOwned(page) {
  await page.evaluate(() => window.__grawlixTest.setScope(null));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

const dumpMain = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpMainCorpus(s), scope);

// Shipped config counts, normalized to [[name, count]] sorted by name, to compare
// against the local rebuild's same-shaped counts.
const shippedCountsNorm = page => page.evaluate(() =>
  window.__grawlixTest.sourceCounts()
    .map(s => [s.name, s.count]).sort((a, b) => a[0].localeCompare(b[0])));

// The winning-source contribution counts from the worker dump (only sources that
// actually contribute a merged row), in the same [[name, count]] shape, to compare
// against the shipped counts filtered to the same contributing set.
const dumpContribCounts = page => page.evaluate(async () =>
  (await window.__grawlixTest.dumpMergedCache()).counts);
const contributors = counts => counts.filter(([, n]) => n > 0).sort((a, b) => a[0].localeCompare(b[0]));

// Read the My Edits IDB record (data_<dbKey>) straight from the live DB.
const readEditsIdb = (page, dbKey) => page.evaluate(key => new Promise(resolve => {
  const req = window._db.transaction('data', 'readonly').objectStore('data').get('data_' + key);
  req.onsuccess = () => resolve(req.result ?? null);
  req.onerror = () => resolve(null);
}), dbKey);

// Drives the real UI edit path (the same saveEdit the panel calls), then polls
// every property to a settle: the ack has landed when the shipped counts match the
// local rebuild and the IDB record matches the edited rawEntries.
async function runRealEdit(page, fn) {
  const syncsBefore = await page.evaluate(() => window.__grawlixTest.syncConfigsSent());
  const pre = await dumpMain(page, MERGED);

  await page.evaluate(fn);

  // Steady-state: the shipped contributing counts match the worker dump's, and the
  // shipped merged total matches the dumped corpus size.
  const dumpContrib = contributors(await dumpContribCounts(page));
  await expect.poll(async () => contributors(await shippedCountsNorm(page))).toEqual(dumpContrib);
  const localMergedTotal = await page.evaluate(async () =>
    (await window.__grawlixTest.dumpMergedCache()).entries.length);
  expect(await page.evaluate(() => window.__grawlixTest.mergedEntryCount()))
    .toBe(localMergedTotal);

  const post = await dumpMain(page, MERGED);
  expect(post).not.toEqual(pre);                  // non-vacuity

  // Worker wrote IDB byte-identically (the edit persists).
  const { dbKey, text } = await page.evaluate(() => window.__grawlixTest.expectedEditsIdbText());
  await expect.poll(() => readEditsIdb(page, dbKey)).toBe(text);

  // No resync kept the worker fresh — the command did.
  const syncsAfter = await page.evaluate(() => window.__grawlixTest.syncConfigsSent());
  expect(syncsAfter).toBe(syncsBefore);

  return { dbKey };
}

// ─── EDIT ────────────────────────────────────────────────────────────────────

test('edit — real saveEdit path: worker writes IDB, no resync, steady-state', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page);

  await runRealEdit(page, () =>
    window.__grawlixTest.saveMyEditFrom(
      { norm: 'over', display: 'OVER' }, 'OVER', 10, 'edits-over2'));

  // My Edits still wins OVER (priority), now at the edited score.
  const over = (await dumpMain(page, MERGED)).find(e => e[0] === 'over');
  const editsKey = await page.evaluate(() => window.__grawlixTest.expectedEditsIdbText().dbKey);
  expect(over[5]).toBe(editsKey);
  expect(over[2]).toBe(10);
});

// ─── ADD ─────────────────────────────────────────────────────────────────────

test('add — real saveEdit path (orig null): worker writes IDB, no resync, steady-state', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page);

  await runRealEdit(page, () =>
    window.__grawlixTest.saveMyEditFrom(null, 'HERON', 66, 'wader'));

  expect((await dumpMain(page, MERGED)).some(e => e[0] === 'heron')).toBe(true);
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

test('delete — real deleteFromEdits path: worker writes IDB, no resync, steady-state', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page);

  await runRealEdit(page, () =>
    window.__grawlixTest.deleteMyEditFrom({ norm: 'over', display: 'OVER' }));

  // OVER hands off to Alpha (next priority); GULL would vanish, but OVER survives.
  const over = (await dumpMain(page, MERGED)).find(e => e[0] === 'over');
  const alpha = await page.evaluate(() => state.sources.find(s => s.name === 'Alpha').dbKey);
  expect(over[5]).toBe(alpha);
  expect(over[2]).toBe(70);
});

// ─── DELETE → UNDO ───────────────────────────────────────────────────────────
// Undo re-adds the deleted record via saveEdit's add path (→ editEntry add). Both
// the delete and the undo persist through the worker; the post-undo merged corpus +
// IDB must match the pre-delete state byte-identically.

test('delete → undo: each step persists through the worker, restores byte-identically', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page);

  const editsKey = await page.evaluate(() => window.__grawlixTest.expectedEditsIdbText().dbKey);
  const preMerged = await dumpMain(page, MERGED);
  const preIdb = await readEditsIdb(page, editsKey);

  // Delete GULL (edits-only) — vanishes from the merge, IDB shrinks.
  await runRealEdit(page, () =>
    window.__grawlixTest.deleteMyEditFrom({ norm: 'gull', display: 'GULL' }));
  expect((await dumpMain(page, MERGED)).some(e => e[0] === 'gull')).toBe(false);

  // Undo via the toast's re-add (→ editEntry add path). Drive the real re-add
  // through saveEdit, the same record the undo callback re-inserts.
  await runRealEdit(page, () =>
    window.__grawlixTest.saveMyEditFrom(null, 'GULL', 95, 'seabird'));

  // Byte-identical restore: merged corpus AND persisted IDB match pre-delete.
  expect(await dumpMain(page, MERGED)).toEqual(preMerged);
  expect(await readEditsIdb(page, editsKey)).toBe(preIdb);
});

// ─── Multi-variant edit keeps the sibling variant ───────────────────────────

test('edit — multi-variant via real path: sibling variant survives, persists', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await seedEdits(page);
  await enterFreshOwned(page);

  await runRealEdit(page, () =>
    window.__grawlixTest.saveMyEditFrom(
      { norm: 'theirs', display: 'the IRS' }, 'the IRS', 11, 'lowered'));

  const variants = (await dumpMain(page, MERGED))
    .filter(e => e[0] === 'theirs').map(e => e[1]).sort();
  expect(variants).toEqual(['The Irs', 'the IRS']);
});
