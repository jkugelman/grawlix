// Related-entries (word-family) section at the bottom of the entry panel: lists
// the clicked entry's whole family (the entry itself highlighted) with scores,
// and navigates to a relative on click.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp, expectVisible, scopeTo } from './helpers.js';
import { gzipSync } from 'node:zlib';

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

test('an unscored new entry wears no badge in Related entries', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['lather', 'lathered'], scores: [50, 30],
  }));
  await page.locator('#add-fab').click();
  await expect(panel(page)).toBeVisible();
  await panel(page).locator('.entry-input').fill('lathering');

  await expect(current(page)).toContainText('lathering');
  await expect(current(page).locator('.score-badge')).toHaveCount(0);
  await expect(sibling(page).locator('.score-badge')).toHaveText(['50', '30']);

  await page.locator('#entry-panel-score').fill('40');
  await expect(current(page).locator('.score-badge')).toHaveText('40');
});

test('an unscored new entry can still click through to a relative', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['lather', 'lathered'], scores: [50, 30],
  }));
  await page.locator('#add-fab').click();
  await expect(panel(page)).toBeVisible();
  await panel(page).locator('.entry-input').fill('lathering');
  await expect(sibling(page)).toHaveCount(2);

  // Nothing savable has been typed (no score), so leaving discards the create the
  // way the scrim and the X do — it must not block the navigation.
  await sibling(page).first().click();
  await expect(panel(page).locator('.entry-input')).toHaveValue('lather');
  await expect(current(page)).toContainText('lather');
});

test('typing an existing entry in the Add panel lists it once, not beside a twin', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['lather', 'lathered'], scores: [50, 30],
  }));
  await page.locator('#add-fab').click();
  await expect(panel(page)).toBeVisible();
  await panel(page).locator('.entry-input').fill('lathered');

  // The anchor IS the corpus row it renders as — appending a second, badge-less copy
  // beside it puts an inert look-alike where the real (clickable) row should be.
  await expect(items(page)).toHaveCount(2);
  await expect(current(page)).toHaveCount(1);
  await expect(current(page)).toContainText('lathered');
  await expect(sibling(page)).toContainText('lather');
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

// Segmented kin (raceagainst <-> racesagainst) are reachable only through the unigram
// asset, which loads lazily on first use -- so the very first query for a glued entry
// is the one that races it. Stubs the real asset URL rather than injecting the corpus,
// because injecting it is what makes the race disappear.
function unigramAsset(buckets) {
  const bytes = [0x90 | buckets.length];
  for (const words of buckets) {
    bytes.push(0x90 | words.length);
    for (const w of words) {
      const utf8 = Buffer.from(w, 'utf8');
      bytes.push(0xa0 | utf8.length, ...utf8);
    }
  }
  return gzipSync(Buffer.from(bytes));
}

test('a cold deep link lists the relatives that need the segmenter', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src',
    entries: ['raceagainst', 'racesagainst', 'race', 'races', 'against'],
    scores: [50, 50, 50, 50, 50],
  }));

  await page.route(/msgpack/, route => route.fulfill({
    status: 200, contentType: 'application/octet-stream',
    body: unigramAsset([[], ['race', 'races', 'against']]),
  }));

  // The panel opens straight from the URL, so its family query is the first thing to
  // touch the asset — no earlier interaction has warmed it.
  await gotoApp(page, '/?entry=raceagainst');
  await expect(panel(page)).toBeVisible();

  await expect(items(page)).toHaveCount(2);
  await expect(sibling(page)).toContainText('racesagainst');
});

test('a name links to the fuller names containing it, and back', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['Rigoberta', 'Rigoberta Menchu'], scores: [40, 60],
  }));

  await openPanelFor(page, 'rigoberta');
  await expect(items(page)).toHaveCount(2);
  await expect(sibling(page)).toContainText('Rigoberta Menchu');

  await sibling(page).click();
  await expect(items(page)).toHaveCount(2);
  await expect(sibling(page)).toContainText('Rigoberta');
});

test('a multi-word part of a name links as one unit', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['Medicine Hat', 'Medicine Hat, Alberta'], scores: [50, 50],
  }));
  await openPanelFor(page, 'medicinehat');
  await expect(sibling(page)).toContainText('Medicine Hat, Alberta');
});

test('people who merely share a name are not linked', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['Venus Williams', 'Serena Williams'], scores: [50, 50],
  }));
  await openPanelFor(page, 'venuswilliams');
  await expect(items(page)).toHaveCount(0);
});

test('an ordinary lowercase word never anchors a link', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['dead', 'dead sea'], scores: [50, 50],
  }));
  await openPanelFor(page, 'dead');
  await expect(items(page)).toHaveCount(0);
});

test('the family collates ahead of the name relatives, not interleaved', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src',
    entries: ['Nash', 'Nashes', 'Graham Nash', 'Ogden Nash'],
    scores: [50, 50, 50, 50],
  }));
  // Alphabetically 'Graham Nash' and 'Ogden Nash' would straddle 'Nash'/'Nashes';
  // the inflection must stay beside its own kind.
  await openPanelFor(page, 'nash');
  await expect(items(page)).toHaveText(['Nash 50', 'Nashes 50', 'Graham Nash 50', 'Ogden Nash 50']);
});

test('a name does not link where the longer entry lowercases it', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['Job', 'dream job', 'Book of Job'], scores: [50, 50, 50],
  }));
  await openPanelFor(page, 'job');
  await expect(sibling(page)).toHaveCount(1);
  await expect(sibling(page)).toContainText('Book of Job');
});

test('a very common name shows only its few best-scoring full names', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src',
    entries: ['James', 'James Bond', 'James Cook', 'James Dean', 'James Joyce'],
    scores: [40, 90, 80, 70, 10],
  }));
  await openPanelFor(page, 'james');
  await expect(sibling(page)).toHaveCount(3);
  await expect(items(page).filter({ hasText: 'James Joyce' })).toHaveCount(0);
});
