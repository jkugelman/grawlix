// Update-summary windowing — see docs/worker-protocol.md § fetchDiffRows / freeDiff.
//
// The worker computes the FULL added/deleted/rescored diff but ships only the first
// DIFF_SHIP_CAP (500) rows of each section inline; the dialog virtual-scrolls the
// rest via fetchDiffRows, so a large re-import never re-materializes its full diff on
// the main thread. Each retained diff is freed when its dialog/toast owner ends.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeViaSelector, barKebabAction } from './helpers.js';

const pad = i => String(i).padStart(4, '0');
const lines = (prefix, n, score) => Array.from({ length: n }, (_, i) => `${prefix}${pad(i)};${score}`);
const body = (...groups) => groups.flat().join('\n') + '\n';

// Each section > 500 so the inline window can't cover it: 600 deleted (del*), 600
// added (addb*), 600 rescored (res* 50→60). The byte length differs from INITIAL so
// checkForUpdates' HEAD poll sees a change.
const INITIAL = body(lines('del', 600, 50),  lines('res', 600, 50));
const UPDATED = body(lines('addb', 600, 50), lines('res', 600, 60));
// A third version for the multi-diff test: deletes addb*, adds addc* (560), rescores
// res* 60→70. Distinct byte length from both INITIAL and UPDATED.
const UPDATED2 = body(lines('addc', 560, 50), lines('res', 600, 70));

function routeJK(page, feed) {
  return page.route(/jkugelman-wordlist/, route => {
    const b = feed.body;
    route.fulfill({
      status: 200, contentType: 'text/plain',
      headers: { 'content-length': String(b.length) }, body: b,
    });
  });
}

const scrollEntries = page => page.locator('#update-summary-scroll .usd-entry-col');

test('a >cap re-import windows each section past its inline first window', async ({ page }) => {
  const feed = { body: INITIAL };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);

  feed.body = UPDATED;
  await scopeViaSelector(page, 'John Kugelman');
  await barKebabAction(page, 'Fetch');

  const dialog = page.locator('#update-summary-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.usd-pill-added')).toHaveText('600 added');
  await expect(dialog.locator('.usd-pill-deleted')).toHaveText('600 deleted');
  await expect(dialog.locator('.usd-pill-rescored')).toHaveText('600 rescored');

  expect(await page.evaluate(() => window.__grawlixTest.diffFetchesSent())).toBe(0);

  // res0599 (local index 599 > the 500 inline cap) renders only if the worker served
  // a window past the inline seed — the property under test.
  await page.evaluate(() => {
    const el = document.querySelector('#update-summary-scroll');
    el.scrollTop = el.scrollHeight;
  });
  await expect(scrollEntries(page).filter({ hasText: 'res0599' })).toHaveCount(1);
  expect(await page.evaluate(() => window.__grawlixTest.diffFetchesSent())).toBeGreaterThan(0);
});

test('a small (<cap) re-import fires zero diff fetches', async ({ page }) => {
  // delta deleted, beta rescored, epsilon added — one row per section, all inline.
  const small = { initial: 'alpha;50\nbeta;50\ndelta;50\n', updated: 'alpha;50\nbeta;60\nepsilon;50\n' };
  const feed = { body: small.initial };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);

  feed.body = small.updated;
  await scopeViaSelector(page, 'John Kugelman');
  await barKebabAction(page, 'Fetch');

  const dialog = page.locator('#update-summary-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.usd-pill-added')).toHaveText('1 added');
  await page.evaluate(() => {
    const el = document.querySelector('#update-summary-scroll');
    el.scrollTop = el.scrollHeight;
  });
  await expect(scrollEntries(page).filter({ hasText: 'epsilon' })).toHaveCount(1);
  expect(await page.evaluate(() => window.__grawlixTest.diffFetchesSent())).toBe(0);
});

test('closing the dialog frees its retained diff', async ({ page }) => {
  const feed = { body: INITIAL };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);

  feed.body = UPDATED;
  await scopeViaSelector(page, 'John Kugelman');
  await barKebabAction(page, 'Fetch');

  const dialog = page.locator('#update-summary-dialog');
  await expect(dialog).toBeVisible();
  const diffId = await page.evaluate(() => window.__grawlixTest.updateDialogDiffId());
  expect(diffId).not.toBeNull();

  const served = await page.evaluate(id =>
    window.__grawlixTest.fetchWorkerDiffRows(id, 'rescored', 590, 600).then(r => r && r.rows.length), diffId);
  expect(served).toBeGreaterThan(0);

  await dialog.locator('.dialog-close-btn').click();
  await expect(dialog).toBeHidden();

  // Same fetch resolves null once freed (the worker drops an absent diffId silently,
  // so the bridge times out to null).
  await expect.poll(() => page.evaluate(id =>
    window.__grawlixTest.fetchWorkerDiffRows(id, 'rescored', 590, 600, 1500).then(r => r === null), diffId)
  ).toBe(true);
});

test('two retained diffs are independently windowable (per-diffId, not a single slot)', async ({ page }) => {
  const feed = { body: INITIAL };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);

  // Auto-update ON so a changed list re-fetches silently and stacks a Details toast
  // (no dialog) — letting two diffs coexist, one per toast.
  await page.locator('#btn-settings').click();
  await page.locator('#auto-update-seg .seg-btn[data-val="on"]').click();
  await page.keyboard.press('Escape');

  feed.body = UPDATED;
  await page.evaluate(() => checkForUpdates());
  await expect(page.locator('.toast')).toHaveCount(1);

  feed.body = UPDATED2;
  await page.evaluate(() => checkForUpdates());
  await expect(page.locator('.toast')).toHaveCount(2);

  // Open Details on the FIRST (older) toast after the second update landed: its diff
  // must still window fully — a single latest-wins slot would have lost it.
  await page.locator('.toast').first().locator('.toast-action').click();
  const dialog = page.locator('#update-summary-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.usd-pill-rescored')).toHaveText('600 rescored');

  await page.evaluate(() => {
    const el = document.querySelector('#update-summary-scroll');
    el.scrollTop = el.scrollHeight;
  });
  await expect(scrollEntries(page).filter({ hasText: 'res0599' })).toHaveCount(1);
});
