import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

// Result export off the worker. exportRows() pulls the full result from the
// worker and main keeps formatting. Post-flip there's no local corpus, so the
// flat export ALWAYS round-trips the worker (one fetchAllRows per format); the
// grouped export likewise round-trips (one fetchAllGroups per format) because the
// grouped tier windows each group's chains, so the resident groups carry only a
// firstChains window — exporting from them would silently truncate every group
// over the window. Transform export stays fully local. See docs/worker-protocol.md.
//
// No flag-off local baseline survives the flip, so these assert the export is
// non-vacuous (real rows formatted), round-trips the worker, and that the four
// formats agree on the entry set — the byte-identity load is carried by the
// formatter unit tests; this spec pins the worker-export wiring.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const STEMS = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE', 'FROND', 'GRAPE', 'HOUSE'];

async function seedCorpus(page) {
  await page.evaluate(stems => {
    const mk = (offset, scoreBase) => {
      const entries = [], scores = [], comments = [];
      for (let i = 0; i < 24; i++) {
        entries.push(stems[(i + offset) % stems.length] + String(i).padStart(2, '0'));
        scores.push(scoreBase + (i % 7) * 5);
        comments.push(i % 3 === 0 ? 'note' + i : '');
      }
      return { entries, scores, comments };
    };
    window.__grawlixTest.addCustomWordlist({ name: 'Alpha', ...mk(0, 20) });
    return window.__grawlixTest.addCustomWordlist({ name: 'Bravo', ...mk(3, 60) });
  }, STEMS);
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

async function runFlat(page, pattern) {
  await page.evaluate(p => window.__grawlixTest.setStack(
    p == null ? [] : [{ tool: 'search', params: { pattern: p } }]), pattern ?? null);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function setRange(page, range) {
  await page.locator('#score-range-input').fill(range);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function captureExports(page) {
  return page.evaluate(async () => {
    const t = window.__grawlixTest;
    return {
      copy: await t.exportText('copy'),
      wordlist: (await t.exportText('wordlist')).text,
      csv: await t.exportText('csv'),
      json: await t.exportText('json'),
    };
  });
}

const ranAgainstOwned = page =>
  page.evaluate(() => window.__grawlixTest.windowedFlatDebug().ranAgainstOwned);
const allRowsFetches = page =>
  page.evaluate(() => window.__grawlixTest.allRowsFetchesSent());
const allGroupsFetches = page =>
  page.evaluate(() => window.__grawlixTest.allGroupsFetchesSent());

// The flat export round-trips the worker once per format and produces real rows.
async function assertWorkerExport(page, setup, { minEntries }) {
  await setup();
  expect(await ranAgainstOwned(page)).toBe(true);

  const before = await allRowsFetches(page);
  const exports = await captureExports(page);
  expect(await allRowsFetches(page) - before).toBe(4);   // 4 formats × the worker round-trip

  // Non-vacuous: the formats agree on a real, non-empty entry set.
  const wordlistEntries = exports.wordlist.trim().split('\n').filter(Boolean);
  expect(wordlistEntries.length).toBeGreaterThanOrEqual(minEntries);
  const jsonEntries = exports.json.groups.flatMap(g => g.chains).flatMap(c => c.entries);
  expect(jsonEntries.length).toBe(wordlistEntries.length);
  expect(exports.csv.trim().split('\r\n').length - 1).toBe(jsonEntries.length);   // minus header
}

test('merged scope, no filter: flat export round-trips the worker', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertWorkerExport(page, async () => {
    await scopeTo(page, 'All Wordlists');
    await runFlat(page, '');
  }, { minEntries: 40 });
});

test('merged scope, score-range filtered: flat export round-trips the worker', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertWorkerExport(page, async () => {
    await scopeTo(page, 'All Wordlists');
    await runFlat(page, '');
    await setRange(page, '40-90');
  }, { minEntries: 1 });
});

test('scoped source: flat export round-trips the worker', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertWorkerExport(page, async () => {
    await scopeTo(page, 'Alpha');
    await runFlat(page, '');
  }, { minEntries: 24 });
});

// Grouped export round-trips the worker (fetchAllGroups), never fetchAllRows: the
// grouped tier windows each group's chains, so resident groups carry only a
// firstChains window — exporting from them must pull the full chains off the worker.
test('grouped result: export round-trips the worker for full chains', async ({ page }) => {
  await gotoApp(page);
  // Anagram-able entries so the grouped run yields a non-empty group to export.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Ana', entries: ['elvis', 'lives', 'evils', 'veils'], scores: [50, 45, 40, 35],
  }));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  await scopeTo(page, 'All Wordlists');
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', grouped: true }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const beforeRows = await allRowsFetches(page);
  const beforeGroups = await allGroupsFetches(page);
  const exports = await captureExports(page);
  expect(await allRowsFetches(page) - beforeRows).toBe(0);       // never the flat path
  expect(await allGroupsFetches(page) - beforeGroups).toBe(4);   // 4 formats × the grouped round-trip
  expect(exports.wordlist.length).toBeGreaterThan(0);
});
