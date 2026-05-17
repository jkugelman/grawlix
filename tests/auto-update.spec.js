// Auto-update wordlists — see docs/design.md § Fetching & updates.
//
// A Content-Length change on a URL-backed wordlist either flags
// `_updateAvailable` (setting off) or silently re-fetches and toasts the
// add/remove/change counts (setting on). These tests pin which path the
// setting selects, through a real HEAD + GET round-trip.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary } = require('./helpers');

const INITIAL = 'alpha;50\nbeta;50\n';
const UPDATED = 'alpha;50\nbeta;60\ngamma;50\n'; // beta rescored 50→60, gamma added

// Boot fetches INITIAL; flipping `feed.updated` makes the next HEAD report a
// new Content-Length and the next GET serve UPDATED. Must be registered after
// the broad publisher stub so it wins for the jkugelman URL.
function routeJK(page, feed) {
  return page.route(/jkugelman-wordlist/, route => {
    const body = feed.updated ? UPDATED : INITIAL;
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { 'content-length': String(body.length) },
      body,
    });
  });
}

async function waitForJKPopulated(page) {
  await expect.poll(() =>
    page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman')?.entries.length)
  ).toBe(2);
}

test('with auto-update on, a changed wordlist is re-fetched and a toast shows the counts', async ({ page }) => {
  const feed = { updated: false };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);
  await waitForJKPopulated(page);

  // Toggling the setting on kicks an immediate update check — no manual
  // checkForUpdates() call needed.
  feed.updated = true;
  await page.locator('#btn-settings').click();
  await page.locator('#auto-update-seg .seg-btn[data-val="on"]').click();

  await expect(page.locator('.toast')).toContainText('John Kugelman auto-updated: +1 ~1');

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.entries.length).toBe(3);
  expect(wl.entries.find(e => e.entry === 'gamma')).toBeTruthy();
  expect(wl.entries.find(e => e.entry === 'beta').score).toBe(60);
  expect(wl.updateAvailable).toBe(false);
});

test('with auto-update off, a changed wordlist shows a green bubble instead of updating', async ({ page }) => {
  const feed = { updated: false };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);
  await waitForJKPopulated(page);

  await page.locator('#btn-settings').click();
  await expect(page.locator('#auto-update-seg .seg-btn[data-val="off"]')).toHaveClass(/active/);
  await page.keyboard.press('Escape');

  feed.updated = true;
  await page.evaluate(() => checkForUpdates());

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.entries.length).toBe(2);
  expect(wl.updateAvailable).toBe(true);
  await expect(page.locator('.toast')).toHaveCount(0);

  await openLibrary(page);
  const card = page.locator('.wordlist-card[data-wordlist]', { hasText: 'John Kugelman' });
  await expect(card.locator('.severity-bubble[data-severity="info"]')).toBeVisible();
});
