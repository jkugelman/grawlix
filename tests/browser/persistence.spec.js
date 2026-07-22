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

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('a custom wordlist survives a page reload with its entries and rules intact', async ({ page }) => {
  await gotoApp(page);

  // Seed: a custom wordlist with a recognizable shape, plus a non-default
  // rescore rule so a regression that drops rules (or auto-seeds on top of
  // existing rules) shows up clearly.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Persist', entries: ['aardvark', 'bagel', 'carrot'], scores: [10, 50, 90],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Persist', [
    { input: '10-50', length: '',  output: '40', note: 'compress' },
    { input: '90',    length: '5', output: '95', note: 'long-bonus' },
  ]));

  // Reload. The page.route stub set up in beforeEach persists across the
  // reload (same browser context), so the publisher fetches stay empty.
  await reloadApp(page);

  // Wordlist came back with the exact entries it had.
  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Persist'));
  expect(wl.populated).toBe(true);
  const entries = await page.evaluate(() => window.__grawlixTest.dumpSourceEntries('Persist'));
  expect(entries).toEqual([
    { entry: 'aardvark', display: null, score: 10, comment: '' },
    { entry: 'bagel',    display: null, score: 50, comment: '' },
    { entry: 'carrot',   display: null, score: 90, comment: '' },
  ]);

  // Rules came back intact and in their stored order (no auto-sort) — including
  // the length filter, which lives in localStorage's meta. A pre-bump
  // SCHEMA_VERSION change that broke the rule shape would corrupt this.
  expect(wl.rescoreRules).toEqual([
    { input: '10-50', length: '',  output: '40' },
    { input: '90',    length: '5', output: '95' },
  ]);

  // Merged view still resolves the entries with the persisted rescore
  // rules applied — BAGEL was 50 in the source, rescored to 40 by the
  // first rule. Proves the IndexedDB read path
  // (`idbGet('data_' + dbKey)`) reattached and the rules are wired into
  // the merge.
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toMatchObject({
    entry: 'bagel', score: 40, comment: '', wordlist: 'Persist',
  });
});

test('URL search/sort/match-mode state applies on boot and updates as the UI changes', async ({ page }) => {
  // Visit the app with a URL that encodes a non-default sort axis, a
  // search query, and the match mode — via the legacy `whole-word` alias,
  // so this doubles as the alias regression test. The Router's applyURL
  // runs during init() and seeds AppView's state from these params.
  await gotoApp(page, '/?search=BAGEL&whole-word&sort=length');

  // UI reflects the URL.
  await expect(page.locator('input[data-key="pattern"]')).toHaveValue('BAGEL');
  await expect(page.locator('.tool-row-match input[type="checkbox"]')).toBeChecked();
  await expect(page.locator('.tool-row-match .match-mode-label')).toHaveText('Whole entry');
  await expect(page.locator('.col-len .col-sort')).toHaveAttribute('aria-label', 'Sort by Length, ascending');

  // The other half of the round-trip: drive the UI, watch the URL update.
  // Changing the search query is debounced (250ms), so poll the hash.
  await page.locator('input[data-key="pattern"]').fill('CARROT');
  await expect.poll(async () => page.evaluate(() => location.search)).toContain('search=CARROT');

  await page.locator('.col-score .col-sort').click();
  await expect.poll(async () => page.evaluate(() => location.search)).toContain('sort=score');

  await page.locator('.search-bar .match-mode-arrow').click();
  await page.locator('.match-mode-menu button[data-mode="span"]').click();
  await expect(page.locator('.search-bar .match-mode-label')).toHaveText('Spans words');
  await expect.poll(async () => page.evaluate(() => location.search)).toContain('mode=span');
  await page.locator('.search-bar .tool-row-match input[type="checkbox"]').uncheck();
  await expect.poll(async () => page.evaluate(() => location.search)).not.toContain('mode=');
});

test('SCHEMA_VERSION reset prompt does not re-arm itself after the user clicks Reset', async ({ page }) => {
  // Boot once so init() seeds a current `meta` + `schemaVersion` in storage.
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Stale', scores: [50],
  }));

  // Simulate the user upgrading to a build whose SCHEMA_VERSION has bumped
  // since their last visit: rewrite the stored version to look outdated,
  // then reload so init() reruns and hits the format-changed branch.
  await page.evaluate(() => localStorage.setItem('grawlix_schemaVersion', '0'));
  await page.reload();

  // The format-changed prompt fires on boot.
  const confirmDialog = page.locator('#confirm-dialog');
  await expect(confirmDialog).toBeVisible();

  // Click Reset → resetAllDataAndReload() wipes storage and reloads.
  // Wait for the second navigation's `load` event before asserting against
  // the fresh page's DOM.
  const loadPromise = page.waitForEvent('load');
  await confirmDialog.locator('#btn-confirm-ok').click();
  await loadPromise;
  // Gate on the post-reset init() finishing: it stamps schemaVersion mid-init, and
  // the read below otherwise races it (the firefox-timing flake this test hit).
  await page.evaluate(() => window.__grawlixTest.whenReady());

  // Regression: location.reload() is asynchronous — JS keeps running until
  // the navigation actually fires. If anything in init() runs after the
  // reload call (e.g. persistMeta() in the defaultSources path), `meta`
  // ends up back in localStorage while `schemaVersion` does not, and the
  // next boot re-fires the format-changed prompt. With the fix in place,
  // resetAllDataAndReload() parks the caller until the navigation lands,
  // so nothing downstream can re-arm the warning.
  //
  // Browser-timing caveat: Chromium and WebKit both defer the reload long
  // enough that init() reaches persistMeta(), so this test fails clearly
  // on those two without the fix — exactly the WebKit-on-iOS bug that
  // prompted the regression. Firefox's reload pre-empts the continuation
  // and the test passes there with or without the fix; that's fine for a
  // sentinel covered by two of three browsers.
  await expect(confirmDialog).toBeHidden();

  // Sanity: the post-reset init() wrote schemaVersion. (Without the fix,
  // init() races location.reload() and may write `meta` back to localStorage
  // too, but it never re-saves schemaVersion — that's what re-arms the
  // warning on the next boot.)
  const schemaVersion = await page.evaluate(() => localStorage.getItem('grawlix_schemaVersion'));
  expect(schemaVersion).not.toBeNull();
});
