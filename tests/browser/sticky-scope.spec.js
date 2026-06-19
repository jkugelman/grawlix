// Sticky scope + per-scope score range (unify redesign § Persistence). Both
// ride standalone read-time-default localStorage keys — `selectedScope` and
// `scoreRanges` — outside the versioned `meta` blob, so no SCHEMA_VERSION bump
// and no migration. These tests pin: the active scope survives a reload, each
// scope keeps its own score range, and a vanished scope falls back to All Wordlists.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo, scopeViaSelector } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// The score-range input. Filling it fires its oninput =>
// AppView.onScoreRange, the same path the user drives.
const rangeInput = page => page.locator('#score-range-input');

async function setRange(page, value) {
  await rangeInput(page).fill(value);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Poll init() to completion the way gotoApp does — a bare reload resolves the
// load event before init's boot tail (scope + range restore, first render) runs.
async function reloadReady(page) {
  await page.reload();
  await page.evaluate(() => window.__grawlixTest.whenReady());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

test('a score range is per-scope: set on A, B is independent, A persists across reload', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ocean', 'tide', 'reef'], scores: [80, 50, 20],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta', entries: ['zebra', 'kelp'], scores: [70, 30],
  }));

  // Scope to Alpha and set a range. The input + the scroller both reflect it.
  await scopeTo(page, 'Alpha');
  await setRange(page, '50-90');
  await expect(rangeInput(page)).toHaveValue('50-90');

  // Switch to Beta: it has no range of its own, so the input is blank and the
  // filter is off — Alpha's range did not leak across the scope boundary.
  await scopeTo(page, 'Beta');
  await expect(rangeInput(page)).toHaveValue('');

  await setRange(page, '60+');
  await expect(rangeInput(page)).toHaveValue('60+');

  // All Wordlists keeps its own (still empty) range independent of both sources.
  await scopeTo(page, 'All Wordlists');
  await expect(rangeInput(page)).toHaveValue('');

  // Back to Alpha: its range is restored, not Beta's nor All Wordlists' blank.
  await scopeTo(page, 'Alpha');
  await expect(rangeInput(page)).toHaveValue('50-90');

  // Reload: sticky scope lands back on Alpha (the last scope) with its range
  // intact, and Beta still carries its own when we switch to it.
  await reloadReady(page);
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Alpha');
  await expect(rangeInput(page)).toHaveValue('50-90');
  await scopeTo(page, 'Beta');
  await expect(rangeInput(page)).toHaveValue('60+');
});

test('clearing a scope\'s range drops only that scope\'s entry', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ocean', 'tide'], scores: [80, 20],
  }));

  await scopeTo(page, 'All Wordlists');
  await setRange(page, '10-90');
  await scopeTo(page, 'Alpha');
  await setRange(page, '50-90');

  // Clear Alpha's range. All Wordlists' range must survive.
  await setRange(page, '');
  await expect(rangeInput(page)).toHaveValue('');
  await scopeTo(page, 'All Wordlists');
  await expect(rangeInput(page)).toHaveValue('10-90');

  await reloadReady(page);
  // Sticky scope returned us to All Wordlists; its range persisted, Alpha's stayed cleared.
  await expect(rangeInput(page)).toHaveValue('10-90');
  await scopeTo(page, 'Alpha');
  await expect(rangeInput(page)).toHaveValue('');
});

test('the selected scope persists across a reload', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Mine', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  await scopeViaSelector(page, 'Mine');
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Mine');

  await reloadReady(page);
  // Without sticky scope this would reset to All Wordlists.
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Mine');
});

test('a disabled scoped source still restores on reload (scope is not gated on enabled)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Off', entries: ['ocean', 'tide'], scores: [70, 40], enabled: false,
  }));

  await scopeViaSelector(page, 'Off');
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Off');

  await reloadReady(page);
  // The source boots disabled (dimmed in the selector) but scope still lands on
  // it — disabled sources stay viewable when scoped to.
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Off');
});

test('deleting the scoped source then reloading falls back to All Wordlists', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Doomed', entries: ['ocean'], scores: [70],
  }));

  await scopeViaSelector(page, 'Doomed');
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Doomed');

  // Delete it from storage directly (no confirm dialog), leaving a dangling
  // selectedScope dbKey for the next boot to resolve.
  await page.evaluate(() => {
    const wl = state.sources.find(w => w.name === 'Doomed');
    state.sources = state.sources.filter(w => w !== wl);
    return Storage.deleteWordlist(wl).then(() => persistMeta());
  });

  await reloadReady(page);
  // The stored dbKey no longer matches any source, so boot falls back to All Wordlists.
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
});

test('first run (cleared storage) lands on All Wordlists', async ({ page }) => {
  // gotoApp seeds returningVisitor but nothing else; no selectedScope is stored,
  // so boot must default to All Wordlists.
  await gotoApp(page);
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
  // And no selectedScope key was written until the user actually scopes.
  expect(await page.evaluate(() => localStorage.getItem('grawlix_selectedScope'))).toBeNull();
});
