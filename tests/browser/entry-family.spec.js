// Related-entries (word-family) section at the bottom of the entry panel: lists
// the clicked entry's whole family (the entry itself highlighted) with scores,
// and navigates to a relative on click.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible, scopeTo } from './helpers.js';

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

test('Entry desc reverses families fully — clusters and the members inside each', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['cat', 'cats', 'dog', 'dogs'], scores: [50, 50, 50, 50],
  }));
  await expectVisible(page, ['cat', 'cats', 'dog', 'dogs'], { ordered: true });

  await page.locator('.col-entry .col-sort').click();
  expect(await page.evaluate(() => AppView.sortDir)).toBe('desc');
  await expectVisible(page, ['dogs', 'dog', 'cats', 'cat'], { ordered: true });
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

test('Related entries ignores scope: a relative in another wordlist still shows', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'A', entries: ['cat'],  scores: [50] }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'B', entries: ['cats'], scores: [30] }));

  // Scope the table to A (no 'cats'), then open 'cat'. Related still lists 'cats'
  // from B: the section reflects the whole merged wordlist, not the scoped view.
  await scopeTo(page, 'A');
  await openPanelFor(page, 'cat');
  await expect(items(page)).toHaveCount(2);
  await expect(current(page)).toContainText('cat');
  await expect(sibling(page)).toContainText('cats');
});

test('Related entries update live as the entry is retyped', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['primary care center', 'primarycarecenters'], scores: [50, 50],
  }));
  await openPanelFor(page, 'primarycarecenters');
  await expect(items(page)).toHaveCount(0);   // the solid spelling shares no family yet

  // Retyping with spaces reduces 'centers' → 'center', joining that family — live,
  // before any save.
  await panel(page).locator('.entry-input').fill('primary care centers');
  await expect(sibling(page)).toContainText('primary care center');
});

test('a live rename drops the entry being renamed from its own Related list', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['7layerdips', '7-layer dip'], scores: [20, 60],
  }));
  await openPanelFor(page, '7layerdips');

  await panel(page).locator('.entry-input').fill('7-layer dips');

  // The singular relative shows; the bare entry being renamed does NOT — it would
  // unify into the new spelling on save, so it's not a sibling of it.
  await expect(page.locator('.entry-family-item .entry-family-entry')).toHaveText(['7-layer dip']);
});

test('navigating to a relative seeds its winner score and offers My Edits adopt', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['cat', 'cats'], scores: [50, 40],
  }));
  await openPanelFor(page, 'cat');
  await sibling(page).click();

  // The sibling opens on its real winner — score seeded, adopt offered — exactly
  // like clicking that row in the table.
  await expect(panel(page).locator('.entry-input')).toHaveValue('cats');
  await expect(page.locator('#entry-panel-score')).toHaveValue('40');
  await expect(panel(page).locator('.entry-panel-adopt-btn')).toBeVisible();
});
