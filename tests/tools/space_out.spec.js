const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible, readVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

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
    entries: ['wonderland', 'wonder', 'land', 'won', 'derland'],
    corpus: { wonder: -2, land: -2, won: -10, derland: -10 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  await expect.poll(async () =>
    (await readVisible(page)).filter(r => Array.isArray(r) && r[0] === 'wonderland').map(r => r[1])
  ).toEqual(['wonder land']);
});

test('passes single-word entries through when no split improves on the whole word', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['dog'],
    corpus: { dog: -7, do: -5, d: -10 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  await expectVisible(page, ['dog'], { ordered: true });
  await expect(page.locator('.entry-row .atom')).toHaveCount(2);
});

test('renders the synthetic split entry with the input entry score', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SpaceOutScore',
    entries: ['abarreloflaughs', 'barrel', 'laughs'],
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
    entries: ['abbarr'],
    corpus: { abb: -3, arr: -3 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  await expectVisible(page, ['abbarr'], { ordered: true });
});

test('rejects splits made of legit-but-low-frequency parts by score', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['abarreloflaughs', 'barrel', 'laughs', 'barr', 'elo', 'fla', 'ughs'],
    corpus: { a: -3, barrel: -11, of: -3, laughs: -10, barr: -19, elo: -19, fla: -16, ughs: -19 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  await expect.poll(async () => (await readVisible(page))
    .filter(r => Array.isArray(r) && r[0] === 'abarreloflaughs')
    .map(r => r[1])
  ).toEqual(['a barrel of laughs']);
});

test('uses the real wordlist metadata when the split form is itself an entry', async ({ page }) => {
  await gotoApp(page);
  // Spelled with the space so the merged row's display IS the split form:
  // space_out carries a hit's comment (not just its score) only on that path.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SpaceOutLookup',
    entries: ['ice cream', 'ice', 'cream'],
    scores:  [60, 50, 50],
    comments: ['a frozen dessert', '', ''],
  }));
  await page.evaluate(() => window.__grawlixTest.setUnigramCorpus({
    ice: -7, cream: -7,
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  const row = page.locator('.entry-row', { hasText: 'ice cream' });
  await expect(row.locator('.atom').nth(1).locator('.atom-entry')).toHaveText(/ICE CREAM/i);
  await expect(row.locator('.atom').nth(1).locator('.atom-score')).toHaveText('60');
  await expect(row.locator('.atom').nth(1).locator('.atom-comment')).toHaveText('a frozen dessert');
});

test('passthrough atom renders score and source when the entry is in the wordlist', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SpaceOutPassthrough',
    entries: ['dog'],
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
    entries: ['99problems', 'problems'],
    corpus: { '99': -5, '9': -3, problems: -7 },
  });
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out' }]));

  await expect.poll(async () =>
    (await readVisible(page)).filter(r => Array.isArray(r) && r[0] === '99problems').map(r => r[1])
  ).toEqual(['99 problems']);
});

test('Splits=One returns exactly the top result; Splits=Many surfaces near-tie alternates', async ({ page }) => {
  await gotoApp(page);
  await setup(page, {
    entries: ['abcdef', 'abc', 'def', 'abcd'],
    corpus: { abc: -5, def: -5, abcd: -6, ef: -7 },
  });

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out', params: { splits: 'one' } }]));
  await expect.poll(async () =>
    (await readVisible(page)).filter(r => Array.isArray(r) && r[0] === 'abcdef').map(r => r[1])
  ).toEqual(['abc def']);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'space_out', params: { splits: 'many' } }]));
  await expect.poll(async () =>
    [...new Set((await readVisible(page)).filter(r => Array.isArray(r) && r[0] === 'abcdef').map(r => r[1]))].sort()
  ).toEqual(['abc def', 'abcd ef']);
});
