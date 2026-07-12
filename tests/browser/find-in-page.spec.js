// Custom find-in-page (Ctrl/Cmd+F): native find can't see windowed-out rows, so
// find is a worker scan that navigates + highlights across the whole result.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const TIERS = [{ input: '50', note: 'Okay' }];

async function setup(page, { entries, scores, comments } = {}) {
  await gotoApp(page);
  await page.evaluate(t => window.__grawlixTest.setScoring(t), TIERS);
  await page.evaluate(cfg => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: cfg.entries, scores: cfg.scores, comments: cfg.comments,
  }), { entries, scores: scores ?? entries.map(() => 50), comments });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const bar = page => page.locator('.find-bar');
const input = page => page.locator('.find-input');
const count = page => page.locator('.find-count');
const rowFor = (page, entry) => page.locator(`.entry-row[data-entry="${entry}"]`);
const listbox = page => page.locator('.entries-table-rows');
const openFind = async page => { await page.keyboard.press('Control+f'); await expect(bar(page)).toBeVisible(); };

// apple / grape / maple / staple each hold exactly one "ap", so under the Entry
// sort the four matches are one-per-row and next/prev order is predictable.
const AP = ['apple', 'grape', 'maple', 'staple'];

test('Ctrl+F opens the find bar and focuses its input', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await expect(input(page)).toBeFocused();
});

test('typing highlights matches, counts them, and marks the first as current', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('ap');
  await expect(count(page)).toHaveText('1/4');
  await expect(page.locator('.entry-row .find-hit')).toHaveCount(4);
  await expect(page.locator('.entry-row[data-entry="apple"] .find-current')).toHaveText('ap');
});

test('Enter steps to the next match and wraps at the end; Shift+Enter steps back', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('ap');
  await expect(count(page)).toHaveText('1/4');
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('2/4');
  await expect(page.locator('.entry-row[data-entry="grape"] .find-current')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('4/4');
  await page.keyboard.press('Enter');                 // wrap
  await expect(count(page)).toHaveText('1/4');
  await page.keyboard.press('Shift+Enter');           // wrap backward
  await expect(count(page)).toHaveText('4/4');
});

test('matching is case-insensitive', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('AP');
  await expect(count(page)).toHaveText('1/4');
});

test('Escape closes the bar and clears the highlights', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('ap');
  await expect(page.locator('.entry-row .find-hit')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(bar(page)).toBeHidden();
  await expect(page.locator('.entry-row .find-hit')).toHaveCount(0);
});

test('Escape closes find even when focus has left the input', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('ap');
  await page.locator('.entry-row[data-entry="grape"] .atom-len').click();   // focus moves to the listbox
  await page.keyboard.press('Escape');
  await expect(bar(page)).toBeHidden();
});

test('find adopts the match as the selection; Esc hands off so Enter opens the panel', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('ap');
  await expect(count(page)).toHaveText('1/4');
  await expect(rowFor(page, 'apple')).toHaveClass(/selected/);
  await page.keyboard.press('Enter');                        // next match — selection follows
  await expect(count(page)).toHaveText('2/4');
  await expect(rowFor(page, 'grape')).toHaveClass(/selected/);
  await expect(rowFor(page, 'apple')).not.toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  await expect(listbox(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#entry-panel')).toBeVisible();
});

test('the open entry panel suppresses Ctrl+F', async ({ page }) => {
  await setup(page, { entries: AP });
  await rowFor(page, 'apple').locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await page.keyboard.press('Control+f');
  await expect(bar(page)).toBeHidden();
});

test('opening the entry panel closes an open find', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('ap');
  await expect(count(page)).toHaveText('1/4');
  await rowFor(page, 'apple').locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(bar(page)).toBeHidden();
  await expect(page.locator('.entry-row .find-hit')).toHaveCount(0);
});

test('a comment match highlights the comment cell', async ({ page }) => {
  await setup(page, { entries: ['xylophone'], comments: ['a music cue'] });
  await openFind(page);
  await input(page).fill('music');
  await expect(count(page)).toHaveText('1/1');
  await expect(page.locator('.entry-row[data-entry="xylophone"] .atom-comment .find-current')).toHaveText('music');
});

test('a space-free query matches a spaced entry via its norm', async ({ page }) => {
  await setup(page, { entries: ['Mother Teresa'] });
  await openFind(page);
  await input(page).fill('motherteresa');
  await expect(count(page)).toHaveText('1/1');
  await expect(page.locator('.entry-row[data-entry="motherteresa"] .find-current')).toHaveText('Mother Teresa');
});

test('stepping among on-screen matches does not scroll the page', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('ap');
  await expect(count(page)).toHaveText('1/4');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('2/4');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('a match below the fold scrolls into view and is highlighted', async ({ page }) => {
  const entries = Array.from({ length: 220 }, (_, i) => `row${String(i).padStart(3, '0')}`);
  await setup(page, { entries });
  await openFind(page);
  await input(page).fill('row200');
  await expect(count(page)).toHaveText('1/1');
  const hit = page.locator('.entry-row[data-entry="row200"] .find-current');
  await expect(hit).toBeVisible();
  await expect(hit).toBeInViewport();
});

test('no matches shows "No results"', async ({ page }) => {
  await setup(page, { entries: AP });
  await openFind(page);
  await input(page).fill('zzzz');
  await expect(count(page)).toHaveText('No results');
  await expect(page.locator('.entry-row .find-hit')).toHaveCount(0);
});

// One "hot" group of 100 "H.. of T.." phrases + the HOT anchor. Members sort
// alphabetically, so "Hall of Tan" (first) is a visible inline member while
// "Home of Tip" (deep in the list) sits past both the inline slot and firstChains
// (64) — exercising the hidden-member reveal + chain fetch. Both are unique.
function initialismsFixture() {
  const entries = ['HOT'], scores = [9000];
  let score = 5000;
  const firsts = ['Helen', 'House', 'Heart', 'Hall', 'Hat', 'Hill', 'Hope', 'Hand', 'Head', 'Home'];
  const lasts = ['Troy', 'Tudor', 'Texas', 'Time', 'Tin', 'Tea', 'Top', 'Toe', 'Tan', 'Tip'];
  for (const f of firsts) for (const l of lasts) { entries.push(`${f} of ${l}`); scores.push(score--); }
  return { name: 'Phrases', entries, scores };
}

async function setupGrouped(page) {
  await gotoApp(page);
  await page.evaluate(f => window.__grawlixTest.addCustomWordlist(f), initialismsFixture());
  await page.evaluate(() => window.__grawlixTest.setScope('Phrases'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'initialisms', grouped: true }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('grouped: a hit in a visible member is highlighted in the row', async ({ page }) => {
  await setupGrouped(page);
  await openFind(page);
  await input(page).fill('Hall of Tan');
  await expect(count(page)).toHaveText('1/1');
  await expect(page.locator('#vs-host .group-row .group-chain .find-current')).toContainText('Hall of Tan');
});

test('grouped: a hit in a hidden member opens the +N-more popover and highlights it', async ({ page }) => {
  await setupGrouped(page);
  await openFind(page);
  await input(page).fill('Home of Tip');
  await expect(count(page)).toHaveText('1/1');
  const hit = page.locator('.group-popover .group-chain .find-current');
  await expect(hit).toBeVisible();
  await expect(hit).toContainText('Home of Tip');
});
