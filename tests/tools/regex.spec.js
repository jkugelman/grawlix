// Regex tool's own contract — pattern matching as a filter, search-and-replace
// as a transform once the replacement field is filled (outputs kept only when
// they are themselves wordlist entries), the whole-word anchor, case-insensitive
// matching, the raw (un-lowercased) pattern, the inert empty/invalid pattern,
// and match highlighting (literal runs auto-segmented, the user's own capture
// groups honored when present, replacement echoes colored to match).
// Pipeline mechanics that merely use regex live in ../tools.spec.js — keep
// this file to the tool, not the pipeline.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'RegexTool',
    entries: ['CAT', 'CATS', 'SCAT', 'COT', 'DOG', 'COG', 'BELL', 'TEEN'],
    scores:  Array(8).fill(50),
  }));
}

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

// Replacement tests need the output words present too — the transform keeps a
// rewritten entry only when it is itself a wordlist entry.
async function addReplaceFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'RegexReplace',
    entries: ['CAT', 'CATS', 'SCAT', 'DOG', 'DOGS', 'BELL', 'BEL', 'TEEN', 'TEN'],
    scores:  Array(9).fill(50),
  }));
}

async function setRegex(page, pattern, params = {}) {
  await page.evaluate(([pat, p]) =>
    window.__grawlixTest.setStack([{ tool: 'regex', params: { pattern: pat, ...p } }]),
    [pattern, params]);
}

test('a pattern filters entries by regular expression', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setRegex(page, '^c.t$');

  expect((await visible(page)).sort()).toEqual(['cat', 'cot']);
});

test('matching is case-insensitive', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setRegex(page, '^CAT$');

  expect(await visible(page)).toEqual(['cat']);
});

test('the pattern is not lowercased — `\\D` survives as non-digit', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setRegex(page, '^\\D+$');

  expect((await visible(page)).length).toBe(8);
});

test('whole-word anchors the pattern to the entry boundaries', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await setRegex(page, 'cat');
  expect((await visible(page)).sort()).toEqual(['cat', 'cats', 'scat']);

  await setRegex(page, 'cat', { 'whole-word': true });
  expect(await visible(page)).toEqual(['cat']);
});

test('an empty pattern is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setRegex(page, '');

  expect((await visible(page)).length).toBe(8);
});

test('an invalid pattern is inert rather than matching nothing', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setRegex(page, '(');

  expect((await visible(page)).length).toBe(8);
});

test('a pattern with no match leaves the view empty', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setRegex(page, 'zzz');

  expect(await visible(page)).toEqual([]);
});

test('a filled replacement rewrites matched entries as a transform', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setRegex(page, '^cat', { replace: 'dog' });

  expect((await visible(page)).sort()).toEqual([
    ['cat', 'dog'],
    ['cats', 'dogs'],
  ]);
});

test('a replacement whose output is not a wordlist entry is dropped', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setRegex(page, 'cat', { replace: 'dog' });

  // `scat` matches but its output `sdog` is not a wordlist entry, so the row
  // is dropped; `cat`/`cats` rewrite onto real entries and survive.
  expect((await visible(page)).sort()).toEqual([
    ['cat', 'dog'],
    ['cats', 'dogs'],
  ]);
});

test('`$1` in the replacement backreferences a capture group', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setRegex(page, '(.)\\1', { replace: '$1' });

  expect((await visible(page)).sort()).toEqual([
    ['bell', 'bel'],
    ['teen', 'ten'],
  ]);
});

test('whole-word constrains a replacement to entries that match in full', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setRegex(page, 'cat', { replace: 'dog', 'whole-word': true });

  expect(await visible(page)).toEqual([['cat', 'dog']]);
});

async function addHighlightFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'RegexHighlight',
    entries: ['UNITED', 'UNUSED', 'COT', 'COD'],
    scores:  Array(4).fill(50),
  }));
}

test('filter highlights each literal run of an auto-segmented pattern', async ({ page }) => {
  await gotoApp(page);
  await addHighlightFixture(page);
  await setRegex(page, '^un.+ed$');

  expect((await visible(page)).sort()).toEqual(['united', 'unused']);
  const row = page.locator('#vs-host .entry-row', { hasText: 'united' });
  await expect(row.locator('mark')).toHaveText(['un', 'ed']);
});

test('a single-char wildcard splits the highlight at its literal boundaries', async ({ page }) => {
  await gotoApp(page);
  await addHighlightFixture(page);
  await setRegex(page, 'c.t');

  // `.` is a wildcard — only the literal `c` and `t` light up, not the gap.
  const row = page.locator('#vs-host .entry-row', { hasText: 'cot' });
  await expect(row.locator('mark')).toHaveText(['c', 't']);
});

test('filter colors the user’s own capture groups when the pattern has them', async ({ page }) => {
  await gotoApp(page);
  await addHighlightFixture(page);
  await setRegex(page, '^(c)o(d)$');

  // Capture groups present, so the hybrid honors them — `o` sits outside both
  // groups and stays unmarked, instead of the whole word being one run.
  const row = page.locator('#vs-host .entry-row', { hasText: 'cod' });
  await expect(row.locator('mark')).toHaveText(['c', 'd']);
});

test('replace colors both capture groups on the input and their swapped echoes on the output', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'RegexSwap',
    entries: ['CATS', 'CAST', 'ARC', 'CAR'],
    scores:  Array(4).fill(50),
  }));
  await setRegex(page, '(t)(s)$', { replace: '$2$1' });

  expect(await visible(page)).toEqual([['cats', 'cast']]);
  const row = page.locator('#vs-host .entry-row', { hasText: 'cast' });
  const inMarks = row.locator('.atom').nth(0).locator('mark');
  const outMarks = row.locator('.atom').nth(1).locator('mark');
  await expect(inMarks).toHaveText(['t', 's']);
  await expect(outMarks).toHaveText(['s', 't']);

  // The `t` keeps its color as it moves, so the swap reads at a glance.
  const tColor = await inMarks.nth(0).getAttribute('class');
  await expect(outMarks.nth(1)).toHaveClass(tColor);
});
