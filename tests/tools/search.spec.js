// Search tool's own pattern-matching contract — literal text, `*` and `?`
// wildcards, whole-word, the inert empty query, the match highlight, and
// search-and-replace as a transform once the replacement field is filled
// (literal whole-span substitution, outputs kept only when they are themselves
// wordlist entries). Pipeline mechanics that merely use search (unification
// with semordnilap, the permanent search bar, URL round-trip, multi-search
// atom stacking) live in ../tools.spec.js — keep this file to the tool, not
// the pipeline.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible, readVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SearchTool',
    entries: ['untested', 'united', 'retested', 'cat', 'cot', 'cart', 'cats', 'scat'],
    scores:  Array(8).fill(50),
  }));
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

  await expectVisible(page, ['retested', 'untested']);
});

test('`*` matches any run of characters', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'un*ed');

  await expectVisible(page, ['united', 'untested']);
});

test('`?` matches exactly one character', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'c?t');

  await expectVisible(page, ['cat', 'cats', 'cot', 'scat']);
});

test('`#` matches any consonant and `@` matches any vowel', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Classes',
    entries: ['bad', 'bed', 'bid', 'bod', 'bud', 'byd'],
    scores:  Array(6).fill(50),
  }));

  await setSearch(page, 'b@d');
  await expectVisible(page, ['bad', 'bed', 'bid', 'bod', 'bud']);

  await setSearch(page, 'b#d');
  await expectVisible(page, ['byd'], { ordered: true });
});

test('`[abc]` matches any listed letter and `[^abc]` matches any unlisted letter', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Brackets',
    entries: ['bat', 'cat', 'rat', 'hat', 'mat'],
    scores:  Array(5).fill(50),
  }));

  await setSearch(page, '[bcr]at');
  await expectVisible(page, ['bat', 'cat', 'rat']);

  await setSearch(page, '[^bcr]at');
  await expectVisible(page, ['hat', 'mat']);
});

test('whole-word anchors the query to the entry boundaries', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await setSearch(page, 'cat');
  await expectVisible(page, ['cat', 'cats', 'scat']);

  await setSearch(page, 'cat', { 'whole-word': true });
  await expectVisible(page, ['cat'], { ordered: true });
});

test('`*` spans separators, so a prefix matches a multi-word entry even when whole-word', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Phrases',
    entries: ['A Book from the Sky', 'abacus'],
    scores:  [50, 50],
  }));

  await setSearch(page, 'abook*');
  await expectVisible(page, ['A Book from the Sky']);

  await setSearch(page, 'abook*', { 'whole-word': true });
  await expectVisible(page, ['A Book from the Sky']);
});

test('whole-word forgives separators at the entry edges, not just between letters', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Edges',
    entries: ['Yahoo!', 'U.S.A.', 'scat'],
    scores:  [50, 50, 50],
  }));

  await setSearch(page, 'yahoo', { 'whole-word': true });
  await expectVisible(page, ['Yahoo!']);

  await setSearch(page, 'usa', { 'whole-word': true });
  await expectVisible(page, ['U.S.A.']);
});

test('`?` fills exactly one character of any kind — letter, symbol, or space — never nothing', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Slots',
    entries: ['hisc', 'hi-c', 'hi c', 'hic'],
    scores:  [50, 50, 50, 50],
  }));

  await setSearch(page, 'hi?c');
  await expectVisible(page, ['hisc', 'hi-c', 'hi c']);
});

test('whole-word matches an entry whose letters equal the query across its separators', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Norm',
    entries: ['the IRS', 'Theirs', 'theirsy'],
    scores:  [50, 50, 50],
  }));

  await setSearch(page, 'theirs', { 'whole-word': true });
  await expectVisible(page, ['the IRS', 'Theirs']);
});

test('a match found through the stripped letters still highlights on the display', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NormHl',
    entries: ['the IRS'],
    scores:  [50],
  }));

  await setSearch(page, 'theirs');
  const row = page.locator('#vs-host .entry-row', { hasText: 'IRS' });
  await expect(row.locator('mark')).toHaveText(['the IRS']);
});

test('an empty query is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, '');

  await expect.poll(async () => (await readVisible(page)).length).toBe(8);
});

test('a query with no match leaves the view empty', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 'zzz');

  await expectVisible(page, [], { ordered: true });
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

test('every match in an entry is highlighted, not just the first', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setSearch(page, 't');

  const row = page.locator('#vs-host .entry-row', { hasText: 'untested' });
  await expect(row.locator('mark')).toHaveText(['t', 't']);
});

// Search-replace needs the output words present too — like regex, the
// transform keeps a rewritten entry only when it is itself a wordlist entry.
async function addReplaceFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SearchReplace',
    entries: ['cat', 'cats', 'scat', 'dog', 'dogs'],
    scores:  Array(5).fill(50),
  }));
}

test('a filled replacement rewrites matched entries as a transform', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setSearch(page, 'cat', { replace: 'dog' });

  // `scat` matches but its output `sdog` is not a wordlist entry, so the row
  // is dropped; `cat`/`cats` rewrite onto real entries and survive.
  await expectVisible(page, [
    ['cat', 'dog'],
    ['cats', 'dogs'],
  ]);
});

test('whole-word constrains a replacement to entries that match in full', async ({ page }) => {
  await gotoApp(page);
  await addReplaceFixture(page);
  await setSearch(page, 'cat', { replace: 'dog', 'whole-word': true });

  await expectVisible(page, [['cat', 'dog']], { ordered: true });
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
