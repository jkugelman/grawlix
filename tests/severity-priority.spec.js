// Severity priority — see docs/design.md § Rescore rules & tier alignment.
//
// When a single wordlist has both an info cause (update available) and a
// warning cause (uncovered scores), the card bubble should render as warning.
// `wordlistSeverity` checks uncovered first and short-circuits — this test
// pins that contract.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('warning overrides info when both conditions apply to the same wordlist', async ({ page }) => {
  await gotoApp(page);

  // 11 distinct scores → above the auto-seed threshold, so rescoreRules stays
  // empty and every score is uncovered (warning condition).
  const scores = Array.from({ length: 11 }, (_, i) => (i + 1) * 5);
  await page.evaluate(s => window.__grawlixTest.addCustomWordlist({ name: 'Both', scores: s }), scores);

  // Add the info condition on top.
  await page.evaluate(() => window.__grawlixTest.setUpdateAvailable('Both', true));

  // Backend snapshot: both conditions present.
  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Both'));
  expect(wl.uncovered.length).toBeGreaterThan(0);
  expect(wl.updateAvailable).toBe(true);

  // Card bubble renders as warning, not info.
  await openLibrary(page);
  const card = page.locator('.wordlist-card[data-wordlist]', { hasText: 'Both' });
  await expect(card.locator('.severity-bubble[data-severity="warning"]')).toBeVisible();
  await expect(card.locator('.severity-bubble[data-severity="info"]')).toHaveCount(0);
});

test('info alone renders an info bubble', async ({ page }) => {
  // Sanity test: without it, the priority test above can't distinguish
  // "warning wins" from "info never renders at all."
  await gotoApp(page);

  // A wordlist with rescore rules covering all its scores (no uncovered),
  // then layer on update-available. Three auto-seeded rules cover [10,30,50]
  // — no warning condition remains.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Clean', scores: [10, 30, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setUpdateAvailable('Clean', true));

  const wl = await page.evaluate(() => window.__grawlixTest.getWordlist('Clean'));
  expect(wl.uncovered).toEqual([]);
  expect(wl.updateAvailable).toBe(true);

  await openLibrary(page);
  const card = page.locator('.wordlist-card[data-wordlist]', { hasText: 'Clean' });
  await expect(card.locator('.severity-bubble[data-severity="info"]')).toBeVisible();
  await expect(card.locator('.severity-bubble[data-severity="warning"]')).toHaveCount(0);
});
