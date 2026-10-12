import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectGroups, settleGroupWindow } from './helpers.js';

// Fictional words, shaped on ROCKET/ROCKETTE and PROJECT's two readings. Swap in
// real ones and the suite silently passes against the live dict instead of the stub.
const DICT = [
  'zocket Z AA1 K AH0 T', 'zockette Z AA0 K EH1 T',
  'zroject Z R AA1 JH EH0 K T', 'zroject(2) Z R AH0 JH EH1 K T',
  'zellar Z EH1 L ER0', 'zeller Z EH1 L ER0', '',
].join('\n');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await page.route(/cmudict\.dict/, route => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    headers: { 'content-length': String(DICT.length) },
    body: DICT,
  }));
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'StressTest',
    entries: ['zocket', 'zockette', 'zroject', 'zellar', 'zeller'],
    scores: [50, 50, 50, 50, 50],
  }));
});

const marks = page => page.evaluate(() =>
  [...document.querySelectorAll('#vs-host mark')].map(m => m.textContent).sort());

test('groups homophones stressed apart, marking the stressed syllable', async ({ page }) => {
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'stress_shift' }]));
  await expectGroups(page, gs => gs.map(g => g.chains.map(c => c[0]).sort()), [['zocket', 'zockette']]);
  await settleGroupWindow(page);
  expect(await marks(page)).toEqual(['ckette', 'zock']);
});

test('heteronyms list an entry once per stress', async ({ page }) => {
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'stress_shift', params: { show: 'heteronyms' } }]));
  await expectGroups(page, gs => gs.map(g => g.chains.map(c => c[0]).sort()), [['zroject', 'zroject']]);
  await settleGroupWindow(page);
  expect(await marks(page)).toEqual(['ject', 'zroj']);
});
