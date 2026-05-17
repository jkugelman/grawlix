// Wordlist updates — see docs/design.md § Fetching & updates.
//
// Re-fetching a URL-backed wordlist diffs old vs. new entries into
// added / deleted / rescored. Manual updates report the diff in a dialog;
// the hourly check either flags `_updateAvailable` (auto-update off) or
// silently re-fetches and toasts the counts (auto-update on).

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary, focusWordlist } = require('./helpers');

// The two bodies must differ in byte length — checkForUpdates' HEAD poll
// detects updates by Content-Length, so equal-length bodies look unchanged.
const INITIAL = 'alpha;50\nbeta;50\ndelta;50\n';
const UPDATED = 'alpha;50\nbeta;60\nepsilon;50\n'; // delta removed, beta rescored, epsilon added

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
  ).toBe(3);
}

async function focusJK(page) {
  await openLibrary(page);
  await focusWordlist(page, 'John Kugelman');
}

test('updating a wordlist applies the new version and summarizes the diff', async ({ page }) => {
  const feed = { updated: false };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);
  await waitForJKPopulated(page);

  feed.updated = true;
  await focusJK(page);
  await page.locator('.wld-pane-actions .split-btn-main').click();

  const dialog = page.locator('#update-summary-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#update-summary-title')).toHaveText('John Kugelman Updated');
  await expect(dialog.locator('.usd-pill-added')).toHaveText('1 added');
  await expect(dialog.locator('.usd-pill-deleted')).toHaveText('1 deleted');
  await expect(dialog.locator('.usd-pill-rescored')).toHaveText('1 rescored');

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.entries.map(e => e.entry).sort()).toEqual(['alpha', 'beta', 'epsilon']);
  expect(wl.entries.find(e => e.entry === 'beta').score).toBe(60);
});

test('re-fetching unchanged content reports no changes', async ({ page }) => {
  const feed = { updated: false }; // never flipped — the fetch returns identical content
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);
  await waitForJKPopulated(page);

  await focusJK(page);
  await page.locator('.wld-pane-actions .split-btn-main').click();

  await expect(page.locator('#alert-dialog')).toBeVisible();
  await expect(page.locator('#alert-dialog-msg')).toContainText('already up to date');
  await expect(page.locator('#update-summary-dialog')).toBeHidden();
});

test('the update check flags a changed wordlist with a green bubble', async ({ page }) => {
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
  expect(wl.entries.length).toBe(3);
  expect(wl.updateAvailable).toBe(true);
  await expect(page.locator('.toast')).toHaveCount(0);

  await openLibrary(page);
  const card = page.locator('.wordlist-card[data-wordlist]', { hasText: 'John Kugelman' });
  await expect(card.locator('.severity-bubble[data-severity="info"]')).toBeVisible();
});

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

  await expect(page.locator('.toast')).toContainText('John Kugelman auto-updated: 1 added, 1 deleted, 1 rescored');

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('John Kugelman'));
  expect(wl.entries.map(e => e.entry).sort()).toEqual(['alpha', 'beta', 'epsilon']);
  expect(wl.entries.find(e => e.entry === 'beta').score).toBe(60);
  expect(wl.updateAvailable).toBe(false);
});
