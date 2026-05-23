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
    entries: ['STOOPS', 'TOPS', 'POSTOP', 'TOP', 'PEAR'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'SPOT' } }]));
  expect((await visible(page)).sort()).toEqual(['postop', 'stoops', 'tops']);
});

test('rejects entries missing any letter from the input alphabet', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Missing',
    entries: ['OPS', 'TOP', 'POSTOP'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'OPTS' } }]));
  expect((await visible(page)).sort()).toEqual(['postop']);
});

test('input duplicates do not raise the per-letter minimum', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Dup',
    entries: ['AB', 'AAB', 'ABBA'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: 'AAB' } }]));
  expect((await visible(page)).sort()).toEqual(['aab', 'ab', 'abba']);
});

test('empty letters is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'EmptyBank',
    entries: ['CAT', 'DOG'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', params: { letters: '' } }]));
  expect((await visible(page)).sort()).toEqual(['cat', 'dog']);
});

async function addLetterSetFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'LetterSetTest',
    entries: ['OPT', 'POT', 'TOP', 'ACT', 'CAT', 'DOG'],
    scores: [50, 40, 30, 60, 20, 70],
  }));
}

test('grouped: clusters merged entries that share a distinct-letter set', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const clusters = groups.map(g => g.lines[0].words.slice().sort()).sort();
  expect(clusters).toEqual([['act', 'cat'], ['opt', 'pot', 'top']]);
  expect(groups.map(g => g.lines[0].count).sort()).toEqual([2, 3]);
});

test('grouped: a singleton entry drops — a group needs at least two members', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const allWords = groups.flatMap(g => g.lines[0].words);
  expect(allWords).not.toContain('dog');
});

test('grouped: within a group, members sort by score desc then entry asc', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const optGroup = groups.find(g => g.lines[0].words.includes('opt'));
  expect(optGroup.lines[0].words).toEqual(['opt', 'pot', 'top']);
});
