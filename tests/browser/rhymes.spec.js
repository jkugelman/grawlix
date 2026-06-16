import { test } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible, expectGroups } from './helpers.js';

// zelph/delph are fictional — absent from the real CMU dict, so their EH1 L F
// family appears only if this stub (not the network) served the worker. Swap them
// for real words and the suite silently passes against the live dict instead.
const DICT = [
  'cat K AE1 T', 'bat B AE1 T', 'hat HH AE1 T', 'dog D AO1 G',
  'zelph Z EH1 L F', 'delph D EH1 L F', '',
].join('\n');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await page.route(/cmudict\.dict/, route => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    headers: { 'content-length': String(DICT.length) },
    body: DICT,
  }));
});

async function seed(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'RhymeTest',
    entries: ['cat', 'bat', 'hat', 'dog', 'zelph', 'delph'],
    scores: [50, 50, 50, 50, 50, 50],
  }));
}

test('filters the merged view to entries that rhyme with the target', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'rhymes', params: { entry: 'cat' } }]));
  await expectVisible(page, ['cat', 'bat', 'hat']);
});

test('group mode buckets the wordlist into rhyme families', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'rhymes', grouped: true }]));
  await expectGroups(page, gs => gs.length, 2);   // {cat,bat,hat} and {zelph,delph}; dog is a singleton
  await expectGroups(page, gs => gs.flatMap(g => g.chains.map(c => c[0])).sort(),
    ['bat', 'cat', 'delph', 'hat', 'zelph']);
});
