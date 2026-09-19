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
