// Related-entries (word-family) section at the bottom of the entry panel: lists
// the clicked entry's whole family (the entry itself highlighted) with scores,
// and navigates to a relative on click.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp, expectVisible, scopeTo } from './helpers.js';

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

test('a glued entry finds its spaced/inflected sibling, and adding a space keeps it', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['electric bill', 'electricbills'], scores: [50, 50],
  }));

  await openPanelFor(page, 'electricbills');
  await expect(sibling(page)).toContainText('electric bill');

  // Adding the space mid-rename must not drop the sibling — the friction this fixes.
  await panel(page).locator('.entry-input').fill('electric bills');
  await expect(sibling(page)).toContainText('electric bill');
});

test('Related entries reach an inflection buried behind a word boundary', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src',
    entries: ['breaksoutintosong', 'broke out into song', 'breaks', 'out', 'into', 'song'],
    scores: [50, 50, 50, 50, 50, 50],
  }));
  // Seed the segmenter corpus after the run settles (a tool-less run evicts it),
  // so the glued token can be split without the multi-MB network fetch.
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setWorkerUnigramCorpus(
    { breaks: -2, out: -2, into: -2, song: -3 }));

  await openPanelFor(page, 'breaksoutintosong');
  await expect(sibling(page)).toContainText('broke out into song');
});

test('a live rename shows the typed name as the bold anchor, not the old spelling', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['7layerdips', '7-layer dip'], scores: [20, 60],
  }));
  await openPanelFor(page, '7layerdips');
  await expect(current(page)).toContainText('7layerdips');   // the anchor at the start

  await panel(page).locator('.entry-input').fill('7-layer dips');

  // Post-save view: old spelling gone, typed spelling is the bold anchor, relative stays.
  await expect(page.locator('.entry-family-item .entry-family-entry')).toHaveText(['7-layer dip', '7-layer dips']);
  await expect(current(page)).toContainText('7-layer dips');
  await expect(sibling(page)).toContainText('7-layer dip');
});

test('editing the score updates the current entry\'s badge in Related entries', async ({ page }) => {
  await setup(page);
  await openPanelFor(page, 'cat');
  await expect(current(page).locator('.score-badge')).toHaveText('50');

  await page.locator('#entry-panel-score').fill('0');
  await expect(current(page).locator('.score-badge')).toHaveText('0');
});

test('a deep-link open shows the entry score on its Related-entries anchor', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['ocean', 'oceans'], scores: [50, 30],
  }));
  await openPanelFor(page, 'ocean');

  // Reload re-opens via ?entry=ocean, seeding the score async from the worker.
  await reloadApp(page);
  await expect(current(page)).toContainText('ocean');
  await expect(current(page).locator('.score-badge')).toHaveText('50');
});

test('a rescore committed by clicking a relative shows on the next panel and on return', async ({ page }) => {
  await setup(page);
  await openPanelFor(page, 'cat');
  await expect(current(page)).toContainText('cat');

  // Rescore 'cat' 50 → 0, then commit it by clicking its relative 'cats'. The
  // commit's worker command must land before the new panel's family query, or
  // 'cat' shows its stale 50 in the relative list (and, on return, its score box).
  await page.locator('#entry-panel-score').fill('0');
  await sibling(page).click();

  await expect(current(page)).toContainText('cats');
  await expect(sibling(page)).toContainText('cat');
  await expect(sibling(page).locator('.score-badge')).toHaveText('0');

  await sibling(page).click();   // back to 'cat'
  await expect(panel(page).locator('.entry-input')).toHaveValue('cat');
  await expect(page.locator('#entry-panel-score')).toHaveValue('0');
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
