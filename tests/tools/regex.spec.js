// Regex tool's own contract — pattern matching as a filter, search-and-replace
// as a transform once the replacement field is filled, the whole-word anchor,
// case-insensitive matching, the raw (un-lowercased) pattern, and the inert
// empty/invalid pattern. Pipeline mechanics that merely use regex live in
// ../tools.spec.js — keep this file to the tool, not the pipeline.

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
  await addFixture(page);
  await setRegex(page, 'cat', { with: 'dog' });

  expect((await visible(page)).sort()).toEqual([
    ['cat', 'dog'],
    ['cats', 'dogs'],
    ['scat', 'sdog'],
  ]);
});

test('`$1` in the replacement backreferences a capture group', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setRegex(page, '(.)\\1', { with: '$1' });

  expect((await visible(page)).sort()).toEqual([
    ['bell', 'bel'],
    ['teen', 'ten'],
  ]);
});

test('whole-word constrains a replacement to entries that match in full', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await setRegex(page, 'cat', { with: 'dog', 'whole-word': true });

  expect(await visible(page)).toEqual([['cat', 'dog']]);
});
