// Real-render atom-count contract — the end-to-end counterpart to the unit
// suite's currentAtomCount ↔ collapseRepeatAtoms agreement
// (tests/unit/pipeline-shape.test.js). STAKES: that unit test pins the
// predictor against a hand-written COPY of the executor's atom-emission logic.
// If the real runToolStage and currentAtomCount ever drift together while that
// copy stays stale, the unit test still passes but the app miscounts atom-lines
// (a virtual-scroller row-height bug). This spec drives the real executor and
// counts the actual rendered `.atom` spans, so such a drift surfaces here —
// delete it as "redundant with the unit test" and that coverage vanishes
// silently. For the same reason the `atoms` counts are hand-specified, never
// recomputed from currentAtomCount: doing so would make the test a tautology
// that passes through any together-drift.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// dog/park/lived are the transform OUTPUTS — drop one as "unused filler" and its
// row silently disappears (a transform keeps an output only when it's a real
// entry), leaving the count assertion nothing to read.
async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AtomCount',
    entries: ['lindsey', 'cat', 'act', 'dog', 'devil', 'lived', 'spark', 'park'],
    scores:  Array(8).fill(50),
  }));
}

const cases = [
  {
    name: 'single search folds into the originator → 1 atom',
    rowHasText: 'lindsey',
    stack: [{ tool: 'search', params: { pattern: 'lin' } }],
    atoms: 1,
  },
  {
    name: 'two searches stack a second highlight slot → 2 atoms',
    rowHasText: 'lindsey',
    stack: [
      { tool: 'search', params: { pattern: 'lin' } },
      { tool: 'search', params: { pattern: 'nds' } },
    ],
    atoms: 2,
  },
  {
    name: 'three searches stack three highlight slots → 3 atoms',
    rowHasText: 'lindsey',
    stack: [
      { tool: 'search', params: { pattern: 'lin' } },
      { tool: 'search', params: { pattern: 'nds' } },
      { tool: 'search', params: { pattern: 'sey' } },
    ],
    atoms: 3,
  },
  {
    name: 'search then a plain filter (anagrams) adds no atom → 1 atom',
    rowHasText: 'cat',
    stack: [
      { tool: 'search', params: { pattern: 'cat' } },
      { tool: 'anagrams', params: { entry: 'act' } },
    ],
    atoms: 1,
  },
  {
    name: 'a plain transform (semordnilap) adds an output atom → 2 atoms',
    rowHasText: 'devil',
    stack: [{ tool: 'semordnilap' }],
    atoms: 2,
  },
  {
    name: 'an input-marked transform (behead) folds its input mark with no slot tail → 2 atoms',
    rowHasText: 'spark',
    stack: [{ tool: 'behead' }],
    atoms: 2,
  },
  {
    name: 'a marked transform alone (search-replace) folds its input mark → 2 atoms',
    rowHasText: 'cat',
    stack: [{ tool: 'search', params: { pattern: 'cat', replace: 'dog' } }],
    atoms: 2,
  },
  {
    name: 'search then an input-marked transform keeps the input mark → 3 atoms',
    rowHasText: 'spark',
    stack: [
      { tool: 'search', params: { pattern: 'spark' } },
      { tool: 'behead' },
    ],
    atoms: 3,
  },
  {
    name: 'search then a marked transform keeps the input mark → 3 atoms',
    rowHasText: 'cat',
    stack: [
      { tool: 'search', params: { pattern: 'ca' } },
      { tool: 'search', params: { pattern: 'cat', replace: 'dog' } },
    ],
    atoms: 3,
  },
];

for (const c of cases) {
  test(`real chain row renders ${c.atoms} atom-line(s): ${c.name}`, async ({ page }) => {
    await gotoApp(page);
    await addFixture(page);
    await page.evaluate(s => window.__grawlixTest.setStack(s), c.stack);

    // toHaveCount(1) guards the count from passing vacuously when the row drops.
    const row = page.locator('#vs-host .entry-row', { hasText: c.rowHasText });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.atom')).toHaveCount(c.atoms);
  });
}

test('the multi-atom rows render the expected distinct chain words', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await expectVisible(page, [['devil', 'lived']]);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));
  await expectVisible(page, [['spark', 'park']]);

  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'search', params: { pattern: 'cat', replace: 'dog' } },
  ]));
  await expectVisible(page, [['cat', 'dog']]);
});
