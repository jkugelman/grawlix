import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function setup(page) {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['bagel'], scores: [50],
  }));
  await scopeTo(page, 'All Wordlists');
}

const panel = page => page.locator('#entry-panel');
const entryInput = page => page.locator('#entry-panel-entry');
const lengthValue = page => page.locator('#entry-panel .entry-panel-length-value');

async function openPanel(page) {
  const cell = page.locator('.entry-row[data-entry="bagel"] .atom-entry');
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(panel(page)).toBeVisible();
}

test('the panel shows the entry length and re-counts as you type', async ({ page }) => {
  await setup(page);
  await openPanel(page);
  await expect(lengthValue(page)).toHaveText('5');   // bagel

  await entryInput(page).fill('grawlix');
  await expect(lengthValue(page)).toHaveText('7');
});

test('length counts the norm, not the raw display text', async ({ page }) => {
  await setup(page);
  await openPanel(page);
  await entryInput(page).fill('the IRS');            // norm "theirs" — 6, not 7
  await expect(lengthValue(page)).toHaveText('6');
});
