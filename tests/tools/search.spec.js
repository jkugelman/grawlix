// Search tool's own pattern-matching contract — literal text, `*` and `?`
// wildcards, whole-word, the inert empty query, the match highlight, and
// search-and-replace as a transform once the replacement field is filled
// (literal whole-span substitution, outputs kept only when they are themselves
// wordlist entries). Pipeline mechanics that merely use search (unification
// with semordnilap, the permanent search bar, URL round-trip, multi-search
// atom stacking) live in ../tools.spec.js — keep this file to the tool, not
// the pipeline.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SearchTool',
    entries: ['UNTESTED', 'UNITED', 'RETESTED', 'CAT', 'COT', 'CART', 'CATS', 'SCAT'],
    scores:  Array(8).fill(50),
  }));
}

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

async function setSearch(page, query, params = {}) {
  await page.evaluate(([q, p]) =>
    window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: q, ...p } }]),
    [query, params]);
}

test('a literal query matches anywhere in the entry', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'test');

  expect((await visible(page)).sort()).toEqual(['retested', 'untested']);
});

test('`*` matches any run of characters', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'un*ed');

  expect((await visible(page)).sort()).toEqual(['united', 'untested']);
});

test('`?` matches exactly one character', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'c?t');

  expect((await visible(page)).sort()).toEqual(['cat', 'cats', 'cot', 'scat']);
});

test('whole-word anchors the query to the entry boundaries', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await setSearch(page, 'cat');
  expect((await visible(page)).sort()).toEqual(['cat', 'cats', 'scat']);

  await setSearch(page, 'cat', { 'whole-word': true });
  expect(await visible(page)).toEqual(['cat']);
});

test('an empty query is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, '');

  expect((await visible(page)).length).toBe(8);
});

test('a query with no match leaves the view empty', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'zzz');

  expect(await visible(page)).toEqual([]);
});

test('the matched span is wrapped in a highlight mark', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'test');

  const row = page.locator('#vs-host .entry-row', { hasText: 'untested' });
  await expect(row.locator('.atom mark')).toContainText('test');
});

test('a wildcard splits the highlight at its literal boundaries', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'c?t');

  // `?` is a wildcard — only the literal `c` and `t` light up, not the gap.
  const row = page.locator('#vs-host .entry-row', { hasText: 'cot' });
  await expect(row.locator('mark')).toHaveText(['c', 't']);
});

// Search-replace needs the output words present too — like regex, the
// transform keeps a rewritten entry only when it is itself a wordlist entry.
async function addReplaceFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SearchReplace',
    entries: ['CAT', 'CATS', 'SCAT', 'DOG', 'DOGS'],
    scores:  Array(5).fill(50),
  }));
}

test('a filled replacement rewrites matched entries as a transform', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setSearch(page, 'cat', { replace: 'dog' });

  // `scat` matches but its output `sdog` is not a wordlist entry, so the row
  // is dropped; `cat`/`cats` rewrite onto real entries and survive.
  expect((await visible(page)).sort()).toEqual([
    ['cat', 'dog'],
    ['cats', 'dogs'],
  ]);
});

test('whole-word constrains a replacement to entries that match in full', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setSearch(page, 'cat', { replace: 'dog', 'whole-word': true });

  expect(await visible(page)).toEqual([['cat', 'dog']]);
});

test('replace highlights the matched span in and the replacement out, same color', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setSearch(page, 'cat', { replace: 'dog' });

  const row = page.locator('#vs-host .entry-row', { hasText: 'dogs' });
  const inMarks = row.locator('.atom').nth(0).locator('mark');
  const outMarks = row.locator('.atom').nth(1).locator('mark');
  await expect(inMarks).toHaveText(['cat']);
  await expect(outMarks).toHaveText(['dog']);
  await expect(outMarks.nth(0)).toHaveClass(await inMarks.nth(0).getAttribute('class'));
});
