// Related-entries (word-family) section at the bottom of the entry panel: lists
// the clicked entry's whole family (the entry itself highlighted) with scores,
// and navigates to a relative on click.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('the entries table sorts a multi-word base ahead of its inflections', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src',
    entries: ['lather', 'lathered', 'lathering', 'lathers',
              'lather up', 'lathered up', 'lathering up', 'lathers up'],
    scores: [50, 50, 50, 50, 50, 50, 50, 50],
  }));
  // The base leads each family: "lather up" sorts ahead of its inflections, the
  // way "lather" leads its own — entries collate by display, so the space wins.
  await expectVisible(page, [
    'lather', 'lathered', 'lathering', 'lathers',
    'lather up', 'lathered up', 'lathering up', 'lathers up',
  ], { ordered: true });
});

const TIERS = [{ input: '50', note: 'Good' }, { input: '30', note: 'Meh' }, { input: '0', note: 'Junk' }];

async function setup(page) {
  await gotoApp(page);
  await page.evaluate(t => window.__grawlixTest.setScoring(t), TIERS);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['cat', 'cats', 'dog'], scores: [50, 30, 50],
  }));
}

const panel = page => page.locator('#entry-panel');
const items = page => page.locator('.entry-family-item');
const current = page => page.locator('.entry-family-item--current');
const sibling = page => page.locator('.entry-family-item:not(.entry-family-item--current)');

async function openPanelFor(page, norm) {
  const cell = page.locator(`.entry-row[data-entry="${norm}"] .atom-entry`);
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(panel(page)).toBeVisible();
}

test('the panel lists the family with the current entry highlighted', async ({ page }) => {
  await setup(page);
  await openPanelFor(page, 'cat');
  await expect(items(page)).toHaveCount(2);            // cat (current) + cats; dog is a different family
  await expect(current(page)).toContainText('cat');
  await expect(sibling(page)).toContainText('cats');
  await expect(sibling(page).locator('.score-badge')).toHaveText('30');
});

test('clicking a relative navigates the panel, keeping the family list stable', async ({ page }) => {
  await setup(page);
  await openPanelFor(page, 'cat');
  await sibling(page).click();
  await expect(panel(page).locator('.entry-input')).toHaveValue('cats');
  await expect(items(page)).toHaveCount(2);            // same family, highlight moved
  await expect(current(page)).toContainText('cats');
  await expect(sibling(page)).toContainText('cat');
});
