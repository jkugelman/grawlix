import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible, expectGroups } from './helpers.js';

const DICT = [
  'road R OW1 D', 'rage R EY1 JH', 'code K OW1 D', 'page P EY1 JH', 'cage K EY1 JH',
  'center S EH1 N T ER0', 'stage S T EY1 JH', '',
].join('\n');
const FREQS = { road: -3, rage: -3, code: -3, page: -3, cage: -3, center: -3, stage: -3 };
const LIST = {
  name: 'Phrases',
  entries: ['roadrage', 'codepage', 'road', 'rage', 'code', 'page', 'cage', 'center', 'RR', 'red rover'],
  scores: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
};

const members = gs => gs.flatMap(g => g.chains.map(c => c[0])).sort();
const cacheState = page => page.evaluate(() => window.__grawlixTest.artifactCacheState());

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await page.route(/cmudict\.dict/, route => route.fulfill({
    status: 200, contentType: 'text/plain',
    headers: { 'content-length': String(DICT.length) }, body: DICT,
  }));
});

// Seed the corpus AFTER the wordlist settles: that run has no tool declaring the
// unigram asset, so it evicts whatever was injected before it.
async function seed(page) {
  await gotoApp(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), LIST);
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  // The cache admits nothing built in under a second, so each test drops that floor.
  await page.evaluate(() => window.__grawlixTest.configureArtifactCacheForTest({ minMs: 0 }));
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), FREQS);
}

test('a table one run builds serves a later run with different params', async ({ page }) => {
  await seed(page);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'rhymes', grouped: true }]));
  await expectGroups(page, members, ['cage', 'code', 'codepage', 'page', 'rage', 'road', 'roadrage']);
  expect(await cacheState(page)).toMatchObject({ misses: 1, hits: 0, size: 1 });

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'rhymes', params: { entry: 'stage' } }]));
  await expectVisible(page, ['cage', 'codepage', 'page', 'rage', 'roadrage']);
  const state = await cacheState(page);
  expect(state.hits).toBeGreaterThanOrEqual(1);
  expect(state.misses).toBe(1);
});

test('the table outlives an edit that adds entries, and reads the new ones', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'rhymes', grouped: true }]));
  await expectGroups(page, members, ['cage', 'code', 'codepage', 'page', 'rage', 'road', 'roadrage']);

  await page.evaluate(() => window.__grawlixTest.createMyEntry('stage', 50));
  await page.evaluate(() => window.__grawlixTest.createMyEntry('centerstage', 50));
  await expectGroups(page, members, ['cage', 'centerstage', 'code', 'codepage', 'page', 'rage', 'road', 'roadrage', 'stage']);
  expect(await cacheState(page)).toMatchObject({ misses: 1, size: 1 });
});

test('a second tool reads the table the first built', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'rhymes', grouped: true }]));
  await expectGroups(page, members, ['cage', 'code', 'codepage', 'page', 'rage', 'road', 'roadrage']);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'initialisms', grouped: true }]));
  await expectGroups(page, members, ['red rover', 'roadrage']);
  const state = await cacheState(page);
  expect(state.hits).toBeGreaterThanOrEqual(1);
  expect(state.misses).toBe(1);
});

// ─── Background updates & superseded builds ──────────────────────────────────

const PUBLISHED = 'roadrage;50\nroad;50\nrage;50\ncode;50\npage;50\n';

// Publisher-backed: a custom list never auto-updates, so it never repatches and these pass vacuously.
async function seedPublished(page, feed) {
  await page.route(/jkugelman-wordlist/, route => {
    const body = feed.updated ? feed.updatedBody : PUBLISHED;
    route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'content-length': String(body.length) }, body });
  });
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.configureArtifactCacheForTest({ minMs: 0 }));
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), FREQS);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'page', mode: 'word' } }]));
  await expectVisible(page, ['page']);
  expect(await cacheState(page)).toMatchObject({ misses: 1, size: 1 });
}

async function autoUpdate(page, feed) {
  feed.updated = true;
  await page.locator('#btn-settings').click();
  await page.locator('#auto-update-seg .seg-btn[data-val="on"]').click();
  await page.keyboard.press('Escape');
}

test('a background update that splices in place repatches through the cached table', async ({ page }) => {
  const feed = { updated: false, updatedBody: PUBLISHED + 'codepage;50\n' };
  await seedPublished(page, feed);
  await autoUpdate(page, feed);
  await expectVisible(page, ['codepage', 'page']);
  const state = await cacheState(page);
  expect(state.hits).toBeGreaterThanOrEqual(1);
  expect(state).toMatchObject({ misses: 1, size: 1 });
});

test('the table a rebuilding background update repatches with serves the next search', async ({ page }) => {
  // Past the splice cap, or the update splices in place and this repeats the test above.
  const filler = Array.from({ length: 300 }, (_, i) => `zz${i}q;50\n`).join('');
  const feed = { updated: false, updatedBody: PUBLISHED + 'codepage;50\n' + filler };
  await seedPublished(page, feed);
  await autoUpdate(page, feed);
  await expectVisible(page, ['codepage', 'page']);
  expect(await cacheState(page)).toMatchObject({ misses: 2, size: 1 });

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'code', mode: 'word' } }]));
  await expectVisible(page, ['code', 'codepage']);
  expect(await cacheState(page)).toMatchObject({ misses: 2, size: 1 });
});

test('a search superseded mid-build hands its partial table to the next', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const letters = 'bcdfhjklmnpstvwxyz';
    let s = 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const entries = ['roadrage', 'road', 'rage'], scores = [50, 50, 50];
    for (let i = 0; i < 30000; i++) {
      let w = '';
      for (let k = 0; k < 10; k++) w += letters[Math.floor(rnd() * letters.length)];
      entries.push(w); scores.push(50);
    }
    await window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
    await window.__grawlixTest.syncWorkerConfig();
  });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.configureArtifactCacheForTest({ minMs: 0 }));
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), FREQS);
  await page.evaluate(() => window.__grawlixTest.setWorkerYieldIntervalForTest(1));

  await page.evaluate(() => { window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'road', mode: 'word' } }]); });
  // Without the ring the first build may never have started, and the test passes vacuously.
  await expect(page.locator('#entries-table-panel.has-progress')).toHaveCount(1);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'rage', mode: 'word' } }]));
  await expectVisible(page, ['rage', 'roadrage']);

  const state = await cacheState(page);
  expect(state.hits).toBeGreaterThanOrEqual(1);
  expect(state).toMatchObject({ misses: 1, size: 1 });
});
