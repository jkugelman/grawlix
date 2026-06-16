// Gesture-wired interactions driven through REAL DOM events (pointer drags,
// clicks, matchMedia changes) rather than the test API — guarding wiring a
// green suite sails past: inline on*= handlers resolving through `window` and
// document-level listeners mounted at boot. An unexposed histogram pointer
// handler once stayed green through exactly this gap.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function barCenter(page, idx) {
  return page.evaluate(i => {
    const cols = document.querySelectorAll('#stats .histogram .histogram-col');
    const r = cols[i].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, idx);
}

test('dragging across the histogram applies the score-range filter', async ({ page }) => {
  await gotoApp(page);
  // Five distinct scores stay under HIST_DISCRETE_THRESHOLD, so each renders as
  // its own bar with lo === hi — binned buckets would break the idx→score map.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hist',
    entries: ['aaa', 'bbb', 'ccc', 'ddd', 'eee'],
    scores: [10, 30, 50, 70, 90],
  }));
  await scopeTo(page, 'Hist');
  await expectVisible(page, ['aaa', 'bbb', 'ccc', 'ddd', 'eee']);

  await expect(page.locator('#stats .histogram .histogram-col')).toHaveCount(5);

  const start = await barCenter(page, 1);
  const end   = await barCenter(page, 3);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // An intermediate move flips the handler's `moved` flag, so pointerup commits
  // a range rather than the click-to-toggle-one-bar path.
  await page.mouse.move((start.x + end.x) / 2, start.y);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();

  await expect(page.locator('#score-range-input')).toHaveValue('30-70');
  await expectVisible(page, ['bbb', 'ccc', 'ddd']);
  await expect(page.locator('#stats .histogram .histogram-rect')).toBeVisible();
});

test('the gear button opens Settings', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#btn-settings').click();
  const dialog = page.locator('#settings-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#dark-mode-seg .seg-btn', { hasText: 'Dark' })).toBeVisible();
});

test('the ? menu opens the Welcome dialog', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#btn-help').click();
  await page.locator('#menu-welcome').click();
  const dialog = page.locator('#welcome-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#welcome-title')).toContainText('Welcome to Grawlix');
  await dialog.getByRole('button', { name: 'Get started' }).click();
  await expect(dialog).toBeHidden();
});

test('the ? menu opens the Acknowledgements dialog', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#btn-help').click();
  await page.locator('#menu-acknowledgements').click();
  const dialog = page.locator('#acknowledgements-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#acks-title')).toContainText('Acknowledgements');
  await expect(dialog.getByRole('link', { name: 'Spread the Word(list)' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Wordlisted' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
});

test('the sync sign opens the Sync dialog', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Synced', entries: ['cat'], scores: [50],
  }));
  await scopeTo(page, 'Synced');
  await page.locator('#sync-sign').click();
  const dialog = page.locator('#sync-dialog');
  await expect(dialog).toBeVisible();
  // Disk sync (File System Access) is Chromium-only; elsewhere the dialog shows a notice, not attach choices.
  const diskSupported = await page.evaluate(() => 'showSaveFilePicker' in window);
  if (diskSupported) {
    await expect(dialog.locator('.sync-choice')).toHaveCount(2);
  } else {
    await expect(dialog.locator('.sync-choice')).toHaveCount(0);
    await expect(dialog.locator('.sync-dialog-lead')).toContainText('Chromium');
  }
});

async function kebabAction(page, label) {
  const kebab = page.locator('#wordlist-bar .wls-actions .wls-kebab');
  await kebab.locator('.more-menu-btn').click();
  await expect(kebab).toHaveClass(/open/);
  await kebab.locator('.split-btn-menu button', { hasText: label }).click();
}

test('the kebab Configure item opens the ConfigureWordlist dialog and its icon picker', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Configurable', entries: ['cat'], scores: [50],
  }));
  await scopeTo(page, 'Configurable');

  await kebabAction(page, 'Configure');
  const dialog = page.locator('#configure-wordlist-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#config-name-input')).toHaveValue('Configurable');

  const popup = dialog.locator('#icon-picker-popup');
  await expect(popup).toBeHidden();
  await dialog.locator('#icon-picker-trigger').click();
  await expect(popup).toBeVisible();
  await expect(popup.locator('.icon-picker-tab', { hasText: 'Emoji' })).toBeVisible();
});

test('the kebab Import item opens the ImportGuide dialog', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Importable', entries: ['cat'], scores: [50],
  }));
  await scopeTo(page, 'Importable');

  await kebabAction(page, 'Import');
  const dialog = page.locator('#import-guide-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#guide-title')).toContainText('Import Importable');
  await expect(dialog.locator('.guide-drop-zone')).toBeVisible();
});

test('clicking outside an open split menu dismisses it', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Menu', entries: ['cat'], scores: [50],
  }));
  await scopeTo(page, 'Menu');

  const kebab = page.locator('#wordlist-bar .wls-actions .wls-kebab');
  await kebab.locator('.more-menu-btn').click();
  await expect(kebab).toHaveClass(/open/);

  await page.locator('header h1').click();
  await expect(kebab).not.toHaveClass(/open/);
});

// The matchMedia('change') listener (armed in SettingsDialog.mount) re-applies
// 'auto' dark mode on an OS flip, but only when no explicit override is stored.
// gotoApp leaves no darkMode key, so this is the genuine auto-follow condition.
test('with no stored override, the app follows the OS color scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoApp(page);
  expect(await page.evaluate(() => localStorage.getItem('grawlix_darkMode'))).toBeNull();

  const html = page.locator('html');
  await expect(html).toHaveClass(/light-mode/);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/dark-mode/);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveClass(/light-mode/);
});

test('with an explicit light override, the OS flipping to dark is ignored', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('grawlix_darkMode', 'light'));
  await gotoApp(page);

  const html = page.locator('html');
  await expect(html).toHaveClass(/light-mode/);

  await page.emulateMedia({ colorScheme: 'dark' });
  // Open Settings as a positive settle: the matchMedia handler is synchronous
  // with the emulateMedia change, but a bare "class didn't flip" assertion could
  // pass before the handler ran at all. A visible dialog proves the page is live
  // and past that change before we assert the override held.
  await page.locator('#btn-settings').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await expect(html).toHaveClass(/light-mode/);
  await expect(html).not.toHaveClass(/dark-mode/);
});
