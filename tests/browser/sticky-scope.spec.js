// Sticky scope + global score range (unify redesign § Persistence). Both ride
// standalone localStorage keys — `selectedScope` and `scoreRange` — outside the
// versioned `meta` blob, so no SCHEMA_VERSION bump and no migration. `scoreRange`
// is three-state: absent → the default (one above the trash score, so `1+` out of
// the box), '' → deliberately cleared, else the stored range. These tests pin:
// scope survives a reload, the range is one global filter that stays put across
// scope switches and stays cleared once cleared, a brand-new visitor gets `1+`,
// the default tracks the trash score, and a vanished scope falls back to All
// Wordlists.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo, scopeViaSelector } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// The score-range input. Filling it fires its oninput =>
// AppView.onScoreRange, the same path the user drives.
const rangeInput = page => page.locator('#score-range-input');
const rangeBtn = page => page.locator('.score-range-btn');
const lsRange = page => page.evaluate(() => localStorage.getItem('grawlix_scoreRange'));

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

test('the score range is global: it stays put across scope switches and a reload', async ({ page }) => {
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

  // The regression guard: switching scope no longer makes the filter disappear.
  await scopeTo(page, 'Beta');
  await expect(rangeInput(page)).toHaveValue('50-90');
  await scopeTo(page, 'All Wordlists');
  await expect(rangeInput(page)).toHaveValue('50-90');

  // Editing from any scope rewrites the one global filter the others read.
  await setRange(page, '60+');
  await scopeTo(page, 'Alpha');
  await expect(rangeInput(page)).toHaveValue('60+');

  await reloadReady(page);
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('Alpha');
  await expect(rangeInput(page)).toHaveValue('60+');
  await scopeTo(page, 'Beta');
  await expect(rangeInput(page)).toHaveValue('60+');
});

test('clearing the range clears the global filter for every scope', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ocean', 'tide'], scores: [80, 20],
  }));

  await scopeTo(page, 'All Wordlists');
  await setRange(page, '10-90');
  await scopeTo(page, 'Alpha');
  await expect(rangeInput(page)).toHaveValue('10-90');

  // Clear it from Alpha; the global filter is gone everywhere.
  await setRange(page, '');
  await expect(rangeInput(page)).toHaveValue('');
  await scopeTo(page, 'All Wordlists');
  await expect(rangeInput(page)).toHaveValue('');

  await reloadReady(page);
  // Sticky scope returned us to All Wordlists; the cleared range stays cleared.
  await expect(rangeInput(page)).toHaveValue('');
});

test('a brand-new visitor gets the 1+ default score filter', async ({ page }) => {
  // seedScoreRange:false leaves the key unset, exercising the real new-user
  // default rather than the suite's unfiltered baseline.
  await gotoApp(page, '/', { seedScoreRange: false });
  await expect(rangeInput(page)).toHaveValue('1+');
  // Untouched, the default isn't written — the key stays unset so the user keeps
  // getting it, and a later clear (stored '') can still read as deliberate.
  expect(await page.evaluate(() => localStorage.getItem('grawlix_scoreRange'))).toBeNull();
});

test('off the default, the button is a reset that restores 1+ and drops the key', async ({ page }) => {
  await gotoApp(page, '/', { seedScoreRange: false });
  await expect(rangeInput(page)).toHaveValue('1+');
  await expect(rangeBtn(page)).toHaveAttribute('data-mode', 'clear');
  await expect(rangeBtn(page).locator('use')).toHaveAttribute('href', '#icon-x');

  await setRange(page, '50+');
  await expect(rangeBtn(page)).toHaveAttribute('data-mode', 'reset');
  await expect(rangeBtn(page).locator('use')).toHaveAttribute('href', '#icon-reset');
  expect(await lsRange(page)).toBe('50+');

  await rangeBtn(page).click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(rangeInput(page)).toHaveValue('1+');
  // Reset drops the key rather than persisting 1+, so the user keeps following
  // the default — that's why this asserts null, not '1+'.
  expect(await lsRange(page)).toBeNull();
  await expect(rangeBtn(page)).toHaveAttribute('data-mode', 'clear');
});

test('at the default the X clears to empty; an empty box still offers a reset', async ({ page }) => {
  await gotoApp(page, '/', { seedScoreRange: false });
  await expect(rangeBtn(page)).toHaveAttribute('data-mode', 'clear');

  await rangeBtn(page).click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(rangeInput(page)).toHaveValue('');
  // A deliberate clear persists '' — distinct from the untouched absent key.
  expect(await lsRange(page)).toBe('');
  await expect(rangeBtn(page)).toBeVisible();
  await expect(rangeBtn(page)).toHaveAttribute('data-mode', 'reset');

  await rangeBtn(page).click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(rangeInput(page)).toHaveValue('1+');
  expect(await lsRange(page)).toBeNull();
});

test('customizing the score tiers leaves the default filter untouched', async ({ page }) => {
  await gotoApp(page, '/', { seedScoreRange: false });
  await expect(rangeInput(page)).toHaveValue('1+');

  // The default no longer depends on the tiers: relabeling them must not move it
  // off `1+` or change the button — the old regime blanked it under dirty tiers.
  await page.evaluate(() => window.__grawlixTest.setScoring([{ input: '0-100', note: 'everything' }]));
  await expect(rangeInput(page)).toHaveValue('1+');
  await expect(rangeBtn(page)).toHaveAttribute('data-mode', 'clear');
  await expect(rangeBtn(page).locator('use')).toHaveAttribute('href', '#icon-x');

  await reloadReady(page);
  await expect(rangeInput(page)).toHaveValue('1+');
});

test('the default filter tracks the trash score', async ({ page }) => {
  await gotoApp(page, '/', { seedScoreRange: false });
  await expect(rangeInput(page)).toHaveValue('1+');

  await page.locator('#btn-settings').click();
  await page.locator('#trash-score-input').fill('7');
  await page.locator('#trash-score-input').blur();
  await page.locator('#settings-dialog .dialog-close-btn').click();

  // The box keeps showing `1+` — its value isn't rewritten — but that's now off
  // the moved default (7 + 1), so the button retargets as a reset to 8+.
  await expect(rangeBtn(page)).toHaveAttribute('data-mode', 'reset');
  await expect(rangeBtn(page)).toHaveAttribute('title', 'Reset to 8+');
  await rangeBtn(page).click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(rangeInput(page)).toHaveValue('8+');
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
  // gotoApp seeds returningVisitor and an empty scoreRange; no selectedScope is
  // stored, so boot must default to All Wordlists.
  await gotoApp(page);
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
  // And no selectedScope key was written until the user actually scopes.
  expect(await page.evaluate(() => localStorage.getItem('grawlix_selectedScope'))).toBeNull();
});
