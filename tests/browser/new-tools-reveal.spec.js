// Setup is inline rather than gotoApp: gotoApp pre-seeds seenTools to suppress
// the reveal, but these tests need it to actually fire.

import { test, expect } from '@playwright/test';
import { TOOLS } from '../../site/src/engine/tools.js';
import { stubPublisherFetches } from './helpers.js';

const ALL_SLUGS = Object.keys(TOOLS);

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function bootReturning(page, seen) {
  await page.addInitScript(() => localStorage.setItem('grawlix_returningVisitor', '1'));
  if (seen) await page.addInitScript(s => localStorage.setItem('grawlix_seenTools', JSON.stringify(s)), seen);
  await page.goto('/');
  await page.evaluate(() => window.__grawlixTest.whenReady());
}

test('returning user with no record sees the launch baseline reveal (caesar + cryptogram only)', async ({ page }) => {
  await bootReturning(page, null);

  await expect(page.locator('.nt-overlay.show')).toHaveCount(1);
  await expect(page.locator('.nt-overlay .tool-card')).toHaveCount(2);
  await expect(page.locator('.nt-overlay .tool-card[data-tool="caesar"]')).toHaveCount(1);
  await expect(page.locator('.nt-overlay .tool-card[data-tool="cryptogram"]')).toHaveCount(1);

  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('grawlix_seenTools')));
  expect(new Set(seen)).toEqual(new Set(ALL_SLUGS));
});

test('a generic newly-added tool is detected against an existing seen list', async ({ page }) => {
  await bootReturning(page, ALL_SLUGS.filter(s => s !== 'rebus'));

  await expect(page.locator('.nt-overlay.show')).toHaveCount(1);
  await expect(page.locator('.nt-overlay .tool-card')).toHaveCount(1);
  await expect(page.locator('.nt-overlay .tool-card[data-tool="rebus"]')).toHaveCount(1);
});

test('a returning user who has seen everything gets no reveal', async ({ page }) => {
  await bootReturning(page, ALL_SLUGS);
  await expect(page.locator('.nt-overlay.show')).toHaveCount(0);
});

test('a brand-new visitor is silently baselined and sees no reveal', async ({ page }) => {
  // No returningVisitor → first-time visitor; the reveal must not fire.
  await page.goto('/');
  await page.evaluate(() => window.__grawlixTest.whenReady());

  await expect(page.locator('.nt-overlay.show')).toHaveCount(0);
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('grawlix_seenTools')));
  expect(new Set(seen)).toEqual(new Set(ALL_SLUGS));
});

test('it cannot be dismissed early, then Esc closes it', async ({ page }) => {
  await bootReturning(page, null);
  await expect(page.locator('.nt-overlay.show')).toHaveCount(1);

  // During the build-up the dismiss affordance is inert — Esc is ignored.
  await page.keyboard.press('Escape');
  await expect(page.locator('.nt-overlay.show')).toHaveCount(1);

  await expect(page.locator('.nt-dismiss.show')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.nt-overlay.show')).toHaveCount(0);
});

test('the dismiss button closes it and restores scrolling', async ({ page }) => {
  await bootReturning(page, null);
  await expect(page.locator('html.nt-scroll-lock')).toHaveCount(1);
  await expect(page.locator('.nt-dismiss.show')).toBeVisible();
  await page.locator('.nt-dismiss').click();
  await expect(page.locator('.nt-overlay.show')).toHaveCount(0);
  await expect(page.locator('html.nt-scroll-lock')).toHaveCount(0);
});
