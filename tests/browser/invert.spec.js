// The invert toggle — the tool icon doubles as it, so the mode costs no row width.
// See docs/design.md § Tool gallery & stack.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, addTool, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function fixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'InvertTest',
    entries: ['cat', 'cot', 'cut', 'dog', 'level'],
    scores: [60, 55, 50, 45, 40],
  }));
}

const barIcon = page => page.locator('.search-bar .tool-row-invert');
const url = page => new URL(page.url()).search;

test('clicking the search bar icon inverts the filter and marks the URL', async ({ page }) => {
  await gotoApp(page);
  await fixture(page);

  await page.fill('.search-bar input[data-key="pattern"]', 'c?t');
  await expectVisible(page, ['cat', 'cot', 'cut']);

  await barIcon(page).click();
  await expectVisible(page, ['dog', 'level']);
  expect(url(page)).toContain('not');
  await expect(barIcon(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(barIcon(page)).toHaveClass(/active/);

  await barIcon(page).click();
  await expectVisible(page, ['cat', 'cot', 'cut']);
  expect(url(page)).not.toContain('not');
  await expect(barIcon(page)).toHaveAttribute('aria-pressed', 'false');
});

test('a `not` URL boots inverted', async ({ page }) => {
  await gotoApp(page);
  await fixture(page);
  await gotoApp(page, '?search=c%3Ft&not');
  await expectVisible(page, ['dog', 'level']);
  await expect(barIcon(page)).toHaveAttribute('aria-pressed', 'true');
});

test('a param-less tool row inverts from its own icon', async ({ page }) => {
  await gotoApp(page);
  await fixture(page);
  await addTool(page, 'isograms');
  await expectVisible(page, ['cat', 'cot', 'cut', 'dog']);

  await page.locator('.tool-row .tool-row-invert').click();
  await expectVisible(page, ['level']);
});

test('a tool row inverts from its name too, and the label carries the tooltip', async ({ page }) => {
  await gotoApp(page);
  await fixture(page);
  await addTool(page, 'isograms');
  await expectVisible(page, ['cat', 'cot', 'cut', 'dog']);

  await page.locator('.tool-row .tool-row-name').click();
  await expectVisible(page, ['level']);
  await expect(page.locator('.tool-row .tool-row-invert')).toHaveClass(/active/);
  await expect(page.locator('.tool-row .tool-label')).toHaveAttribute('title', 'Keep matches');
});

// The mutual exclusion: Search's kind is params-derived, so a replacement makes the
// row a transform mid-keystroke. The flag has to clear, or the URL keeps a `not` no
// stage honors and the row shows a mode it isn't in.
test('typing a replacement clears invert and disables the toggle', async ({ page }) => {
  await gotoApp(page);
  await fixture(page);
  await page.fill('.search-bar input[data-key="pattern"]', 'c?t');
  await barIcon(page).click();
  expect(url(page)).toContain('not');

  await page.locator('.search-bar .find-replace-caret').click();
  await page.fill('.search-bar .tool-row-replace input', 'zzz');

  expect(url(page)).not.toContain('not');
  await expect(barIcon(page)).toHaveClass(/disabled/);
  await expect(barIcon(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(barIcon(page)).not.toHaveClass(/active/);
});

test('a disabled toggle ignores clicks', async ({ page }) => {
  await gotoApp(page);
  await fixture(page);
  await page.fill('.search-bar input[data-key="pattern"]', 'c?t');
  await page.locator('.search-bar .find-replace-caret').click();
  await page.fill('.search-bar .tool-row-replace input', 'zzz');

  await barIcon(page).click({ force: true });
  expect(url(page)).not.toContain('not');
  await expect(barIcon(page)).toHaveAttribute('aria-pressed', 'false');
});
