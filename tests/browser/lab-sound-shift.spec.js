import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The cache admits nothing built in under a second, so the test drops that floor.

const DICT = [
  'friar F R AY1 ER0', 'tuck T AH1 K', 'fire F AY1 ER0', 'truck T R AH1 K', 'dog D AO1 G', '',
].join('\n');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await page.route(/cmudict\.dict/, route => route.fulfill({
    status: 200, contentType: 'text/plain',
    headers: { 'content-length': String(DICT.length) }, body: DICT,
  }));
  // Sound shift also declares the unigram asset; fail it fast so no real fetch fires —
  // the tool degrades to cmudict-only, which is all this fixture needs.
  await page.route(/large_en\.msgpack\.gz/, route => route.abort());
});

test('a Sound-param change reuses the cached pair list (real worker)', async ({ page }) => {
  await gotoApp(page, '/lab/sound-shift/', { labTools: ['sound_shift'] });
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Phon', entries: ['friar tuck', 'fire truck', 'dog'], scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.configureArtifactCacheForTest({ minMs: 0 }));

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'sound_shift', params: {} }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  let state = await page.evaluate(() => window.__grawlixTest.artifactCacheState());
  expect(state).toMatchObject({ misses: 1, hits: 0, size: 1 });

  // A different stack, so the finished and prefix caches miss and prepare runs again.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'sound_shift', params: { sound: 'R' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  state = await page.evaluate(() => window.__grawlixTest.artifactCacheState());
  expect(state.hits).toBeGreaterThanOrEqual(1);
  expect(state.misses).toBe(1);   // no second compute
});
