// Space-out hint in the entry panel: an unspaced entry gets a "Rename to <spaced
// form>" link that fills the field and drops the panel into its rename flow. The
// worker corpus is seeded directly so the hint skips the multi-MB network fetch.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const panel = page => page.locator('#entry-panel');
const link = page => panel(page).locator('.entry-panel-suggest-link');

// Seed the corpus AFTER the wordlist settles: adding a wordlist runs the pipeline,
// and a run with no space-out tool evicts the unigram asset — injecting first would
// wipe it. Opening the panel fires no run, so the seeded corpus survives from here.
async function seed(page, wordlist, corpus) {
  await gotoApp(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), wordlist);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), corpus);
}

async function openPanelFor(page, norm) {
  const cell = page.locator(`.entry-row[data-entry="${norm}"] .atom-entry`);
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(panel(page)).toBeVisible();
}

test('suggests a spacing and applies it as a rename', async ({ page }) => {
  await seed(page,
    { name: 'Src', entries: ['hasagraspon', 'has', 'a', 'grasp', 'on'], scores: [50, 50, 50, 50, 50] },
    { has: -2, a: -2, grasp: -3, on: -2 });

  await openPanelFor(page, 'hasagraspon');
  await expect(link(page)).toHaveText('has a grasp on');

  await link(page).click();
  await expect(panel(page).locator('.entry-input')).toHaveValue('has a grasp on');
  await expect(panel(page).locator('.entry-panel-save')).toHaveText('Rename');
  await expect(link(page)).toHaveCount(0);
});

test('offers no spacing for an entry that is already a whole word', async ({ page }) => {
  await seed(page,
    { name: 'Src', entries: ['graspon', 'grasp', 'on'], scores: [50, 50, 50] },
    { grasp: -2, on: -2 });

  // Open on the concatenation first — its hint appearing proves the query path is
  // live, so the subsequent clear is a real negative, not an un-resolved query.
  await openPanelFor(page, 'graspon');
  await expect(link(page)).toHaveText('grasp on');

  await panel(page).locator('.entry-input').fill('grasp');
  await expect(link(page)).toHaveCount(0);
});

// The first open must happen corpus-less -- seeding up front like the other tests
// skips the un-ready answer this pins. The trailing wait is the assertion: the erase
// lands on the 600ms canonical pass, after the hint is already showing.
test('does not cache a spacing the worker was not ready to give', async ({ page }) => {
  const wordlist = { name: 'Src', entries: ['raceagainst', 'race', 'against'], scores: [50, 50, 50] };
  await gotoApp(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), wordlist);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await openPanelFor(page, 'raceagainst');
  await expect(link(page)).toHaveCount(0);
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();

  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), { race: -2, against: -2 });

  await openPanelFor(page, 'raceagainst');
  await expect(link(page)).toHaveText('race against');
  await page.waitForTimeout(900);
  await expect(link(page)).toHaveText('race against');
});

// The recomputed hint is byte-identical to the erased one, which is exactly why nothing
// downstream notices it went missing.
test('keeps the hint through a re-render that recomputes the same spacing', async ({ page }) => {
  await seed(page,
    { name: 'Src', entries: ['raceagainst', 'race', 'against'], scores: [50, 50, 50] },
    { race: -2, against: -2 });

  await openPanelFor(page, 'raceagainst');
  await expect(link(page)).toHaveText('race against');

  // Adding a list (not a tool) keeps the stack signature, so the unigram asset survives
  // the run — a stack change evicts it and clears the hint for an unrelated reason.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist(
    { name: 'Other', entries: ['unrelated'], scores: [50] }));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(link(page)).toHaveText('race against');
});

const relative = (page, entry) =>
  panel(page).locator('.entry-family-item', { has: page.locator('.entry-family-entry', { hasText: new RegExp(`^${entry}$`) }) });

// Don't await the relative's own hint between the clicks: leaving it unresolved is
// what keeps the cached suggestion on `raceagainst`, so the return visit recomputes an
// unchanged value. Awaiting it there passes with the no-op-guard bug reintroduced.
test('re-paints an unchanged hint after hopping to a relative and back', async ({ page }) => {
  await seed(page,
    { name: 'Src', entries: ['raceagainst', 'racesagainst', 'race', 'races', 'against'], scores: [50, 50, 50, 50, 50] },
    { race: -2, races: -3, against: -2 });

  await openPanelFor(page, 'raceagainst');
  await expect(link(page)).toHaveText('race against');

  // Straight back out, giving the relative's own hint no time to resolve and
  // displace the cached one.
  await relative(page, 'racesagainst').click();
  await relative(page, 'raceagainst').click();

  await expect(link(page)).toHaveText('race against');
});
