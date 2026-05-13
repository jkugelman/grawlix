// Persistence + URL state — see CLAUDE.md § Persistence and § Stable links,
// docs/design.md, and site/index.html § Init, § Storage, § Router.
//
// These tests pin the durable-state contracts:
//
//  - localStorage + IndexedDB faithfully round-trip a wordlist through a
//    reload. This is the SCHEMA_VERSION seam — CLAUDE.md flags forgetting
//    to bump it as easy to miss, and silent persistence-corruption would
//    affect every user.
//
//  - The URL is the source of truth for search and sort state at boot. The
//    Router's encode/decode pair has to round-trip cleanly or a shared
//    link decodes to the wrong UI.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('a custom wordlist survives a page reload with its entries and rules intact', async ({ page }) => {
  await gotoApp(page);

  // Seed: a custom wordlist with a recognizable shape, plus a non-default
  // rescore rule so a regression that drops rules (or auto-seeds on top of
  // existing rules) shows up clearly.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Persist', entries: ['AARDVARK', 'BAGEL', 'CARROT'], scores: [10, 50, 90],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Persist', [
    { input: '10-50', length: '',  output: '40', note: 'compress' },
    { input: '90',    length: '5', output: '95', note: 'long-bonus' },
  ]));

  // Reload. The page.route stub set up in beforeEach persists across the
  // reload (same browser context), so the publisher fetches stay empty.
  await page.reload();
  await expect.poll(async () => page.evaluate(() => _db !== null), { timeout: 5000 }).toBe(true);

  // Wordlist came back with the exact entries it had.
  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Persist'));
  expect(wl.populated).toBe(true);
  expect(wl.entries).toEqual([
    { entry: 'AARDVARK', score: 10, comment: '' },
    { entry: 'BAGEL',    score: 50, comment: '' },
    { entry: 'CARROT',   score: 90, comment: '' },
  ]);

  // Rules came back intact — including the length filter, which lives in
  // localStorage's meta. A pre-bump SCHEMA_VERSION change that broke the
  // rule shape would corrupt this. Order reflects `recomputeUncovered`'s
  // post-sort (output score descending) applied at boot, which is the
  // order the rule editor renders them in.
  expect(wl.rescoreRules).toEqual([
    { input: '90',    length: '5', output: '95' },
    { input: '10-50', length: '',  output: '40' },
  ]);

  // Merged view still resolves the entries with the persisted rescore
  // rules applied — BAGEL was 50 in the source, rescored to 40 by the
  // first rule. Proves the IndexedDB read path
  // (`idbGet('data_' + dbKey)`) reattached and the rules are wired into
  // the merge.
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toEqual({
    entry: 'bagel', score: 40, comment: '', wordlist: 'Persist',
  });
});

test('URL search/sort/whole-word state applies on boot and updates as the UI changes', async ({ page }) => {
  // Visit the app with a URL that encodes a non-default sort axis, a
  // search query, and the whole-word toggle. The Router's applyURL runs
  // during init() and seeds WorkshopView's state from these params.
  await gotoApp(page, '/#/workshop?search=BAGEL&whole-word&sort=length');

  // UI reflects the URL.
  await expect(page.locator('#search-input')).toHaveValue('BAGEL');
  await expect(page.locator('#search-whole-word')).toBeChecked();
  await expect(page.locator('.sort-axis-select')).toHaveValue('length');

  // The other half of the round-trip: drive the UI, watch the URL update.
  // Changing the search query is debounced (250ms), so poll the hash.
  await page.locator('#search-input').fill('CARROT');
  await expect.poll(async () => page.evaluate(() => location.hash)).toContain('search=CARROT');

  // Sort axis change is immediate.
  await page.locator('.sort-axis-select').selectOption('score');
  await expect.poll(async () => page.evaluate(() => location.hash)).toContain('sort=score');
});
