// Tool pipeline seam — see docs/design.md § Tool gallery & stack and
// docs/plans/tools.md.
//
// These tests cover Phase 1: the anagram tool runs against the merged wordlist
// and feeds the Workshop entries table. The pipeline executor, the entryNorm
// runtime normalization, and the chain of wirings (stack mutations → scroller
// refresh, param keystroke → scroller refresh, URL → stack on boot) all sit
// downstream of the merged-view path, so the same regressions that would
// silently break merge tests would break these.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Default Workshop display case is lowercase, so visible entry text comes
// back lowercase regardless of how the wordlist stored it.
async function addAnagramFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AnagramTest',
    entries: ['LINDSEY', 'SNIDELY', 'CAT', 'ACT', 'DOG'],
    scores: [60, 50, 40, 40, 40],
  }));
}

test('anagram via URL filters the merged view', async ({ page }) => {
  await stubPublisherFetches(page);
  await gotoApp(page);
  await addAnagramFixture(page);
  // Re-navigate to land on the anagram URL after the wordlist is loaded;
  // applying the URL on a populated app exercises the same boot path a
  // shared link would.
  await page.evaluate(() => {
    location.hash = '#/workshop?anagram=LINDSEY';
    Router.applyURL();
    renderWorkshopMergedDetail();
  });

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);
});

test('empty anagram input passes through (full merged view)', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: '' } }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['act', 'cat', 'dog', 'lindsey', 'snidely']);
});

test('anagram + search compose (search filters tool output)', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => {
    location.hash = '#/workshop?anagram=LINDSEY&search=sni';
    Router.applyURL();
    renderWorkshopMergedDetail();
  });

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual(['snidely']);
});

test('anagram matches across whitespace and case in entries', async ({ page }) => {
  await gotoApp(page);
  // RUN AMOK and MURK ANO share the same letter bank as RUNAMOK after the
  // runtime strips whitespace (and lowercases) on every wlEntry's entryNorm.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Whitespace', entries: ['RUN AMOK', 'MURK ANO', 'MOURNAK', 'CAT'], scores: [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'RUNAMOK' } }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['mournak', 'murk ano', 'run amok']);
});

test('anagram param strips whitespace before sorting letters', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  // Typing LIND SEY with a space is the same query as LINDSEY — the runtime
  // normalizes the param identically to wlEntry.entryNorm.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'LIND SEY' } }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);
});

test('typing in the row input live-filters the entries table', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  // Click the Anagram gallery card (no chain — body click replaces the stack).
  await page.locator('.gallery-card[data-tool="anagram"]').click();

  const input = page.locator('.tool-row input[data-key="entry"]');
  await expect(input).toBeFocused();
  await input.fill('LINDSEY');

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);
});

test('removing the tool row reverts to the full merged view', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'LINDSEY' } }]));

  // Sanity: tool is filtering.
  let visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);

  // Click the row's X.
  await page.locator('.tool-row-remove').click();

  visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['act', 'cat', 'dog', 'lindsey', 'snidely']);
});

test('pipeline output preserves wlEntry refs (popover opens, source/score intact)', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'LINDSEY' } }]));

  // Open the popover on an entry produced by the pipeline.
  await page.locator('.entry-row .atom-entry', { hasText: 'snidely' }).click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  // The score input reflects the entry's actual score from the merged view,
  // confirming the pipeline handed back the original wlEntry rather than a
  // synthesized lookalike.
  await expect(page.locator('#atom-pop-score')).toHaveValue('50');
});
