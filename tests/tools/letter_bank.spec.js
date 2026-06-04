const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible, expectGroups, readGroups } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries that contain every input letter and only those letters', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bank',
    entries: ['stoops', 'tops', 'postop', 'top', 'pear'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'SPOT' } }]));
  await expectVisible(page, ['postop', 'stoops', 'tops']);
});

test('rejects entries missing any letter from the input alphabet', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Missing',
    entries: ['ops', 'top', 'postop'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'OPTS' } }]));
  await expectVisible(page, ['postop']);
});

test('input duplicates do not raise the per-letter minimum', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Dup',
    entries: ['ab', 'aab', 'abba'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'AAB' } }]));
  await expectVisible(page, ['aab', 'ab', 'abba']);
});

test('empty letters is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'EmptyBank',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: '' } }]));
  await expectVisible(page, ['cat', 'dog']);
});

async function addLetterSetFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'LetterSetTest',
    entries: ['opt', 'pot', 'top', 'act', 'cat', 'dog'],
    scores: [50, 40, 30, 60, 20, 70],
  }));
}

test('grouped: clusters merged entries that share a distinct-letter set', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  await expectGroups(page,
    gs => gs.map(g => g.chains.map(c => c[0]).sort()).sort(),
    [['act', 'cat'], ['opt', 'pot', 'top']]);
  await expectGroups(page, gs => gs.map(g => g.count).sort(), [2, 3]);
});

test('grouped: a singleton entry drops — a group needs at least two members', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  await expectGroups(page, gs => gs.length, 2);
  const allSeeds = (await readGroups(page)).flatMap(g => g.chains.map(c => c[0]));
  expect(allSeeds).not.toContain('dog');
});

test('grouped: within a group, members sort by score desc then entry asc', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  await expectGroups(page,
    gs => gs.find(g => g.chains.some(c => c[0] === 'opt'))?.chains.map(c => c[0]) ?? null,
    ['opt', 'pot', 'top']);
});
