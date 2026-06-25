// Fetch status (download-manager panel) — see docs/design.md § Fetch status.
//
// The panel is a read-only progress indicator: it shows a row per in-flight
// fetch (name + byte counter + a stripe bar that moves with the download) and
// nothing else. A quick successful fetch shows nothing; a failure goes to a
// closeable toast carrying a Retry, not to the panel.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeViaSelector, barKebabAction } from './helpers.js';

const JK_BODY = 'alpha;50\nbeta;50\n';

// feed.hang returns without resolving the route, leaving the request pending —
// a stalled fetch. Register after the broad publisher stub so it wins for the
// jkugelman URL (Playwright matches the last-registered route first).
function routeJK(page, feed) {
  return page.route(/jkugelman-wordlist/, route => {
    if (feed.hang) return;
    if (feed.fail) { route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' }); return; }
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { 'content-length': String(JK_BODY.length) },
      body: JK_BODY,
    });
  });
}

test('a quick successful boot shows no panel', async ({ page }) => {
  await stubPublisherFetches(page, { jkugelman: 'alpha;50\n' });
  await gotoApp(page);

  await expect(page.locator('#fetch-status')).toBeHidden();
});

test('a manual fetch shows a progress row immediately', async ({ page }) => {
  const feed = { fail: false, hang: false };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);

  // A huge threshold: a user-initiated (non-silent) fetch must ignore it, so the
  // stalled row showing up at all proves the manual fetch revealed immediately.
  await page.evaluate(() => window.__grawlixTest.setFetchRevealDelay(99999));
  feed.hang = true;

  await scopeViaSelector(page, 'John Kugelman');
  await barKebabAction(page, 'Fetch');

  const row = page.locator('#fetch-status .fetch-row');
  await expect(row).toBeVisible();
  await expect(row.locator('.fetch-row-meta')).toContainText('Downloaded 0 B');
  await expect(row.locator('.fetch-bar')).toBeVisible();
});

test('a failed fetch shows an error toast with retry, not a panel row', async ({ page }) => {
  const feed = { fail: true, hang: false };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);

  const toast = page.locator('#toast-container .toast', { hasText: 'John Kugelman' });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Couldn't load");
  await expect(toast.locator('.toast-action')).toHaveText('Retry');
  await expect(page.locator('#fetch-status')).toBeHidden();
});

test('the error toast retry re-fetches the wordlist', async ({ page }) => {
  const feed = { fail: true, hang: false };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);
  await expect(page.locator('#toast-container .toast', { hasText: 'John Kugelman' })).toBeVisible();

  feed.fail = false;
  await page.locator('#toast-container .toast-action', { hasText: 'Retry' }).click();

  await page.evaluate(() => window.__grawlixTest.loadIdle());
  const entries = await page.evaluate(() => window.__grawlixTest.dumpSourceEntries('John Kugelman'));
  expect(entries.map(e => e.entry).sort()).toEqual(['alpha', 'beta']);
});

test('several simultaneous fetches share one panel, one row each', async ({ page }) => {
  const feed = { fail: false, hang: false };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await page.route(/peter-broda-wordlist/, route => {
    if (feed.hang) return;
    route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'content-length': String(JK_BODY.length) }, body: JK_BODY });
  });
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.setFetchRevealDelay(99999));
  feed.hang = true;

  await scopeViaSelector(page, 'John Kugelman');
  await barKebabAction(page, 'Fetch');
  await scopeViaSelector(page, 'Peter Broda');
  await barKebabAction(page, 'Fetch');

  await expect(page.locator('#fetch-status')).toHaveCount(1);
  await expect(page.locator('#fetch-status .fetch-row')).toHaveCount(2);
});
