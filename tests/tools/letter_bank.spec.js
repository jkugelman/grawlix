const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries that contain every input letter and only those letters', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bank',
    entries: ['stoops', 'tops', 'postop', 'top', 'pear'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'SPOT' } }]));
  expect((await visible(page)).sort()).toEqual(['postop', 'stoops', 'tops']);
});

test('rejects entries missing any letter from the input alphabet', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Missing',
    entries: ['ops', 'top', 'postop'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'OPTS' } }]));
  expect((await visible(page)).sort()).toEqual(['postop']);
});

test('input duplicates do not raise the per-letter minimum', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Dup',
    entries: ['ab', 'aab', 'abba'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'AAB' } }]));
  expect((await visible(page)).sort()).toEqual(['aab', 'ab', 'abba']);
});

test('empty letters is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'EmptyBank',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: '' } }]));
  expect((await visible(page)).sort()).toEqual(['cat', 'dog']);
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

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const clusters = groups.map(g => g.chains.map(c => c[0]).sort()).sort();
  expect(clusters).toEqual([['act', 'cat'], ['opt', 'pot', 'top']]);
  expect(groups.map(g => g.count).sort()).toEqual([2, 3]);
});

test('grouped: a singleton entry drops — a group needs at least two members', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const allSeeds = groups.flatMap(g => g.chains.map(c => c[0]));
  expect(allSeeds).not.toContain('dog');
});

test('grouped: within a group, members sort by score desc then entry asc', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const optGroup = groups.find(g => g.chains.some(c => c[0] === 'opt'));
  expect(optGroup.chains.map(c => c[0])).toEqual(['opt', 'pot', 'top']);
});
