const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

async function setup(page, { entries, corpus }) {
  await page.evaluate(({ entries }) => window.__grawlixTest.addCustomWordlist({
    name: 'SpaceOutTool',
    entries,
    scores: entries.map(() => 50),
  }), { entries });
  await page.evaluate(corpus => window.__grawlixTest.setUnigramCorpus(corpus), corpus);
}

test('picks the highest-likelihood split among multiple valid alternatives', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['WONDERLAND', 'WONDER', 'LAND', 'WON', 'DERLAND'],
    corpus: { wonder: -2, land: -2, won: -10, derland: -10 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  const rows = (await visible(page)).filter(r => Array.isArray(r) && r[0] === 'wonderland').map(r => r[1]);
  expect(rows).toEqual(['wonder land']);
});

test('passes single-word entries through when no split improves on the whole word', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['DOG'],
    corpus: { dog: -7, do: -5, d: -10 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  expect(await visible(page)).toEqual(['dog']);
  await expect(page.locator('.entry-row .atom')).toHaveCount(2);
});

test('renders the synthetic split entry with the input entry score', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SpaceOutScore',
    entries: ['ABARRELOFLAUGHS', 'BARREL', 'LAUGHS'],
    scores: [80, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setUnigramCorpus({
    a: -3, barrel: -11, of: -3, laughs: -10, barr: -13, elo: -14, fla: -12,
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  const row = page.locator('.entry-row', { hasText: 'abarreloflaughs' });
  await expect(row.locator('.atom').nth(1).locator('.atom-entry')).toHaveText(/a barrel of laughs/);
  await expect(row.locator('.atom').nth(1).locator('.atom-score')).toHaveText('80');
});

test('skips 3+ letter parts that arent in the merged wordlist', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['ABBARR'],
    corpus: { abb: -3, arr: -3 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  expect(await visible(page)).toEqual(['abbarr']);
});

test('rejects splits made of legit-but-low-frequency parts by score', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['ABARRELOFLAUGHS', 'BARREL', 'LAUGHS', 'BARR', 'ELO', 'FLA', 'UGHS'],
    corpus: { a: -3, barrel: -11, of: -3, laughs: -10, barr: -19, elo: -19, fla: -16, ughs: -19 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  const rows = (await visible(page))
    .filter(r => Array.isArray(r) && r[0] === 'abarreloflaughs')
    .map(r => r[1]);
  expect(rows).toEqual(['a barrel of laughs']);
});

test('uses the real wordlist metadata when the split form is itself an entry', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SpaceOutLookup',
    entries: ['ICECREAM', 'ICE CREAM', 'ICE', 'CREAM'],
    scores:  [50, 60, 50, 50],
    comments: ['', 'a frozen dessert', '', ''],
  }));
  await page.evaluate(() => window.__grawlixTest.setUnigramCorpus({
    ice: -7, cream: -7,
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  const row = page.locator('.entry-row', { hasText: 'icecream' });
  await expect(row.locator('.atom').nth(1).locator('.atom-entry')).toHaveText(/ice cream/);
  await expect(row.locator('.atom').nth(1).locator('.atom-score')).toHaveText('60');
  await expect(row.locator('.atom').nth(1).locator('.atom-comment')).toHaveText('a frozen dessert');
});

test('passthrough atom renders score and source when the entry is in the wordlist', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SpaceOutPassthrough',
    entries: ['DOG'],
    scores:  [45],
    comments: ['canid'],
  }));
  await page.evaluate(() => window.__grawlixTest.setUnigramCorpus({
    dog: -7, do: -5, d: -10,
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  const row = page.locator('.entry-row', { hasText: 'dog' });
  await expect(row.locator('.atom').nth(1).locator('.atom-score')).toHaveText('45');
  await expect(row.locator('.atom').nth(1).locator('.atom-comment')).toHaveText('canid');
});

test('never splits in the middle of a digit run', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['25OR6TO4'],
    corpus: { '25': -8, '6': -3, '4': -3, '2': -3, '5': -3, or: -3, to: -3 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  const rows = (await visible(page)).filter(r => Array.isArray(r) && r[0] === '25or6to4').map(r => r[1]);
  expect(rows).toEqual(['25 or 6 to 4']);
});

test('Splits=One returns exactly the top result; Splits=Many surfaces near-tie alternates', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['ABCDEF', 'ABC', 'DEF', 'ABCD'],
    corpus: { abc: -5, def: -5, abcd: -6, ef: -7 },
  });

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out', params: { splits: 'one' } }]));
  const one = (await visible(page)).filter(r => Array.isArray(r) && r[0] === 'abcdef').map(r => r[1]);
  expect(one).toEqual(['abc def']);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out', params: { splits: 'many' } }]));
  const many = new Set((await visible(page)).filter(r => Array.isArray(r) && r[0] === 'abcdef').map(r => r[1]));
  expect(many).toEqual(new Set(['abc def', 'abcd ef']));
});
