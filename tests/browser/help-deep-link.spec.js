// Help deep links — every FAQ answer is addressable at #/help/<slug>, and the
// sync dialog's Ingrid walkthrough link rides on that.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const help = page => page.locator('#help-dialog');
const item = (page, slug) => page.locator(`#faq-${slug}`);
const openItems = page => page.locator('#help-dialog .faq-item[open]');

test('#/help opens the dialog with every answer collapsed', async ({ page }) => {
  await gotoApp(page, '/#/help');

  await expect(help(page)).toBeVisible();
  await expect(openItems(page)).toHaveCount(0);
});

test('#/help/<slug> opens the dialog with just that answer expanded', async ({ page }) => {
  await gotoApp(page, '/#/help/ingrid');

  await expect(help(page)).toBeVisible();
  await expect(item(page, 'ingrid')).toHaveAttribute('open', '');
  await expect(openItems(page)).toHaveCount(1);
});

test('an unknown slug still opens Help rather than dropping the reader', async ({ page }) => {
  await gotoApp(page, '/#/help/no-such-answer');

  await expect(help(page)).toBeVisible();
  await expect(openItems(page)).toHaveCount(0);
});

// A duplicate or malformed slug silently shadows an answer's public URL, which
// no other test would notice.
test('every answer carries a unique, well-formed slug', async ({ page }) => {
  await gotoApp(page, '/#/help');

  const ids = await page.locator('#help-dialog .faq-item').evaluateAll(els => els.map(el => el.id));
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.filter(id => /^faq-[a-z0-9-]+$/.test(id))).toEqual(ids);
  expect(new Set(ids).size).toBe(ids.length);
});

test('closing Help clears the slug from the URL', async ({ page }) => {
  await gotoApp(page, '/#/help/ingrid');

  await help(page).locator('.dialog-cancel-btn').click();
  await expect(help(page)).toBeHidden();
  expect(await page.evaluate(() => location.hash)).toBe('');
});

test('a link between answers expands the target without collapsing the rest', async ({ page }) => {
  await gotoApp(page, '/#/help/sync-setup');

  await item(page, 'sync-setup').locator('a[href="#/help/ingrid"]').click();

  await expect(item(page, 'ingrid')).toHaveAttribute('open', '');
  await expect(item(page, 'sync-setup')).toHaveAttribute('open', '');
});

test('the sync dialog links to the Ingrid walkthrough', async ({ page }) => {
  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => [];
    window.showSaveFilePicker = async () => ({});
  });
  await gotoApp(page);

  await page.locator('#sync-sign').click();
  await expect(page.locator('#sync-dialog')).toBeVisible();

  await page.locator('#sync-dialog .sync-dialog-help a').click();

  await expect(page.locator('#sync-dialog')).toBeHidden();
  await expect(help(page)).toBeVisible();
  await expect(item(page, 'ingrid')).toHaveAttribute('open', '');
});
