import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Stage-3 (ch5) regression net that OUTLIVES the A/B specs. worker-rich-rows and
// worker-rich-windowed prove the worker's rich fetchRows by comparing against
// main's build (dumpMainCorpus / the local render path); at "the flip" main stops
// building the corpus and those reference sides vanish. This spec freezes the
// worker's rich output for a fixed corpus as a hardcoded literal instead, so it
// survives the flip. Reintroducing ANY main-thread comparison here silently
// defeats that — the frozen literal is the only legal reference.
//
// sourceId can't be frozen: a dbKey is generated per run, so a hardcoded one
// would flake. Each expected row carries `wl` (the seeding wordlist's name),
// resolved to the live dbKey at assert time.
//
// Sequencing footgun (shared with worker-rich-rows/worker-corpus): a snapshot or
// patch clears ownedCorpusFresh and fetchRows falls back to index-only { i }.
// syncWorkerConfig must run AFTER the last seeding snapshot, and the run that
// fetchWorkerRows targets must be the fresh merged run that follows it.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const SHARED = { entry: 'SHARED', appleScore: 90, appleComment: 'applewins',
                 berryScore: 10, berryComment: 'berryloses' };

function buildFixture() {
  const N = 60;
  const apple = { name: 'Apple', entries: [], scores: [], comments: [] };
  const berry = { name: 'Berry', entries: [], scores: [], comments: [] };
  for (let i = 0; i < N; i++) {
    const tag = String(i).padStart(2, '0');
    apple.entries.push('ITEMA' + tag);
    apple.scores.push(50 + (i % 10));
    apple.comments.push(i % 4 === 0 ? 'noteA' + tag : '');
    berry.entries.push('ITEMB' + tag);
    berry.scores.push(20 + (i % 10));
    berry.comments.push(i % 5 === 0 ? 'noteB' + tag : '');
  }
  apple.entries.push(SHARED.entry); apple.scores.push(SHARED.appleScore); apple.comments.push(SHARED.appleComment);
  berry.entries.push(SHARED.entry); berry.scores.push(SHARED.berryScore); berry.comments.push(SHARED.berryComment);
  return { apple, berry };
}

// rawScore is deliberately `undefined` on every frozen row (these are unrescored).
// Don't drop those keys: toEqual treats a present `undefined` and an absent key
// alike, so deleting them silently stops asserting rawScore is unset. A flat row's
// per-atom highlight/glyph slots ride an `atoms` array (one slot for a plain row,
// more when stacked searches add highlight lines); `wl` resolves to a live dbKey.

const HL = [{ start: 0, end: 4, kind: 'search:0', coord: 'display' }];
const PLAIN_ATOMS = [{ highlights: null, glyph: null }];
const HL_ATOMS = [{ highlights: HL, glyph: null }];

const PLAIN_TOP = [
  { norm: 'itema00', display: 'ITEMA00', score: 50, rawScore: undefined, comment: 'noteA00', wl: 'Apple', atoms: PLAIN_ATOMS },
  { norm: 'itema01', display: 'ITEMA01', score: 51, rawScore: undefined, comment: '',        wl: 'Apple', atoms: PLAIN_ATOMS },
  { norm: 'itema02', display: 'ITEMA02', score: 52, rawScore: undefined, comment: '',        wl: 'Apple', atoms: PLAIN_ATOMS },
  { norm: 'itema03', display: 'ITEMA03', score: 53, rawScore: undefined, comment: '',        wl: 'Apple', atoms: PLAIN_ATOMS },
  { norm: 'itema04', display: 'ITEMA04', score: 54, rawScore: undefined, comment: 'noteA04', wl: 'Apple', atoms: PLAIN_ATOMS },
  { norm: 'itema05', display: 'ITEMA05', score: 55, rawScore: undefined, comment: '',        wl: 'Apple', atoms: PLAIN_ATOMS },
];

const PLAIN_DEEP = [
  { norm: 'itemb50', display: 'ITEMB50', score: 20, rawScore: undefined, comment: 'noteB50', wl: 'Berry', atoms: PLAIN_ATOMS },
  { norm: 'itemb51', display: 'ITEMB51', score: 21, rawScore: undefined, comment: '',        wl: 'Berry', atoms: PLAIN_ATOMS },
  { norm: 'itemb52', display: 'ITEMB52', score: 22, rawScore: undefined, comment: '',        wl: 'Berry', atoms: PLAIN_ATOMS },
  { norm: 'itemb53', display: 'ITEMB53', score: 23, rawScore: undefined, comment: '',        wl: 'Berry', atoms: PLAIN_ATOMS },
  { norm: 'itemb54', display: 'ITEMB54', score: 24, rawScore: undefined, comment: '',        wl: 'Berry', atoms: PLAIN_ATOMS },
  { norm: 'itemb55', display: 'ITEMB55', score: 25, rawScore: undefined, comment: 'noteB55', wl: 'Berry', atoms: PLAIN_ATOMS },
];

const PLAIN_SHARED = [
  { norm: 'shared', display: 'SHARED', score: 90, rawScore: undefined, comment: 'applewins', wl: 'Apple', wls: ['Apple', 'Berry'], atoms: PLAIN_ATOMS },
];

const HL_TOP = PLAIN_TOP.map(r => ({ ...r, atoms: HL_ATOMS }));
const HL_DEEP = PLAIN_DEEP.map(r => ({ ...r, atoms: HL_ATOMS }));

// Scoped golden: scope to Apple alone, so the corpus is Apple's 61 entries
// (60 ITEMA + SHARED) in norm order — 'itema..' < 'shared', so SHARED lands last.
const SCOPED_APPLE_TOP = [
  { norm: 'itema00', display: 'ITEMA00', score: 50, rawScore: undefined, comment: 'noteA00', wl: 'Apple', atoms: PLAIN_ATOMS },
  { norm: 'itema01', display: 'ITEMA01', score: 51, rawScore: undefined, comment: '',        wl: 'Apple', atoms: PLAIN_ATOMS },
  { norm: 'itema02', display: 'ITEMA02', score: 52, rawScore: undefined, comment: '',        wl: 'Apple', atoms: PLAIN_ATOMS },
];
const SCOPED_APPLE_SHARED = [
  { norm: 'shared', display: 'SHARED', score: 90, rawScore: undefined, comment: 'applewins', wl: 'Apple', wls: ['Apple', 'Berry'], atoms: PLAIN_ATOMS },
];

async function seedFreshMergedRun(page, stack) {
  const { apple, berry } = buildFixture();
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), apple);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), berry);
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  return page.evaluate(() => Object.fromEntries(state.sources.map(s => [s.name, s.dbKey])));
}

const resolve = (rows, dbKeys) => rows.map(({ wl, wls, act, ...rest }) =>
  ({ ...rest, sourceId: dbKeys[wl], sourceIds: (wls ?? [wl]).map(n => dbKeys[n]),
     activeIds: (act ?? [wl]).map(n => dbKeys[n]) }));

function isRich(row) {
  return 'norm' in row && 'sourceId' in row && Array.isArray(row.atoms);
}

test('plain merged flat rows match the frozen golden at top and deep offsets', async ({ page }) => {
  await gotoApp(page);
  const dbKeys = await seedFreshMergedRun(page, []);

  const all = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 100000));
  expect(all).not.toBeNull();
  expect(all.rows.length).toBe(121);          // 60 Apple + 60 Berry + 1 deduped SHARED
  expect(all.rows.every(isRich)).toBe(true);  // flat + rich, not index-only { i }

  const top = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 6));
  expect(top.start).toBe(0);
  expect(top.rows).toEqual(resolve(PLAIN_TOP, dbKeys));

  // Offset 110 is past VS_BUFFER (60): a genuine deep window, distinct fetch.
  const deep = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(110, 116));
  expect(deep.start).toBe(110);
  expect(deep.rows).toEqual(resolve(PLAIN_DEEP, dbKeys));

  const shared = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(120, 121));
  expect(shared.rows).toEqual(resolve(PLAIN_SHARED, dbKeys));
  expect(shared.rows[0].sourceId).toBe(dbKeys.Apple);   // priority winner, not Berry
});

test('highlighted search flat rows match the frozen golden with match ranges', async ({ page }) => {
  await gotoApp(page);
  const dbKeys = await seedFreshMergedRun(page, [{ tool: 'search', params: { pattern: 'item' } }]);

  const all = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 100000));
  expect(all).not.toBeNull();
  expect(all.rows.length).toBe(120);          // SHARED has no 'item', so it filters out
  expect(all.rows.every(isRich)).toBe(true);

  const top = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 6));
  expect(top.start).toBe(0);
  expect(top.rows).toEqual(resolve(HL_TOP, dbKeys));

  const deep = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(110, 116));
  expect(deep.start).toBe(110);
  expect(deep.rows).toEqual(resolve(HL_DEEP, dbKeys));
});

test('scoped (Apple) flat rows match a frozen golden', async ({ page }) => {
  await gotoApp(page);
  const { apple, berry } = buildFixture();
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), apple);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), berry);
  await page.evaluate(() => window.__grawlixTest.setScope('Apple'));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const dbKeys = await page.evaluate(() => Object.fromEntries(state.sources.map(s => [s.name, s.dbKey])));

  const all = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 100000));
  expect(all).not.toBeNull();
  expect(all.rows.length).toBe(61);            // Apple's 60 ITEMA + SHARED — Berry excluded
  expect(all.rows.every(isRich)).toBe(true);

  const top = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 3));
  expect(top.start).toBe(0);
  expect(top.rows).toEqual(resolve(SCOPED_APPLE_TOP, dbKeys));

  // SHARED sorts last (norm 'shared' > 'itema..'); its score is Apple's 90, not
  // Berry's 10 — a scoped Apple corpus never sees Berry's entry.
  const last = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(60, 61));
  expect(last.rows).toEqual(resolve(SCOPED_APPLE_SHARED, dbKeys));
});
