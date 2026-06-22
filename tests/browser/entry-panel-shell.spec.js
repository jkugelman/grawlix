import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp, scopeTo } from './helpers.js';

// Pixel-geometry of the entry panel's docked and full-screen shells. These read
// boundingBox, not computed style: geometry is the contract under test, unlike
// the repo's barred toHaveCSS styling assertions.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  // Without this the overlay's slide-in transition leaves boundingBox reads
  // mid-animation, so the narrow-shell geometry would flake.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const addList = (page, opts) => page.evaluate(o => window.__grawlixTest.addCustomWordlist(o), opts);

async function openPanelOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
}

test('wide: the panel docks to the right edge and floats over the table without narrowing it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');

  const tableBefore = await page.locator('#detail-panel').boundingBox();
  await openPanelOnEntry(page, 'ocean');

  const panel = await page.locator('#entry-panel').boundingBox();
  const vw = page.viewportSize().width;
  expect(panel.x + panel.width).toBeGreaterThan(vw - 20);   // flush to the right edge
  expect(panel.width).toBeGreaterThan(300);
  expect(panel.width).toBeLessThan(460);

  const tableAfter = await page.locator('#detail-panel').boundingBox();
  expect(Math.abs(tableAfter.width - tableBefore.width)).toBeLessThan(2);   // no reflow
  expect(panel.x).toBeLessThan(tableAfter.x + tableAfter.width);            // overlaps the table
});

test('the frame pins header and footer outside the scrolling body', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');

  await expect(page.locator('#entry-panel > .entry-panel-header .entry-input')).toBeVisible();
  await expect(page.locator('#entry-panel > .entry-panel-foot .entry-panel-save')).toBeVisible();
  await expect(page.locator('#entry-panel > .entry-panel-body > .entry-panel-lookup')).toBeAttached();
  await expect(page.locator('.entry-panel-foot .entry-panel-lookup')).toHaveCount(0);
});

test('narrow: the panel is a full-screen overlay that reserves no table width', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');

  const tableBefore = await page.locator('#detail-panel').boundingBox();
  await openPanelOnEntry(page, 'ocean');

  const panel = await page.locator('#entry-panel').boundingBox();
  const vw = page.viewportSize().width;
  expect(panel.x).toBeLessThan(2);                 // flush left
  expect(panel.width).toBeGreaterThan(vw - 4);     // full width

  const tableAfter = await page.locator('#detail-panel').boundingBox();
  expect(Math.abs(tableAfter.width - tableBefore.width)).toBeLessThan(2);   // no reflow

  await expect(page.locator('#entry-panel .entry-panel-close-back')).toBeVisible();
  await expect(page.locator('#entry-panel .entry-panel-close-x')).toBeHidden();
});

test('the browser Back gesture closes the panel without navigating away', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  const url = page.url();
  await openPanelOnEntry(page, 'ocean');
  await page.goBack();
  await expect(page.locator('#entry-panel')).toBeHidden();
  expect(page.url()).toBe(url);
});

test('re-targeting then Back closes the panel with a single Back', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  await openPanelOnEntry(page, 'river');
  await expect(page.locator('#entry-panel-entry')).toHaveValue('river');
  await page.goBack();
  await expect(page.locator('#entry-panel')).toBeHidden();
});

test('clicking the open row’s own number (a non-editable cell) closes the panel', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  // The active row's count cell has no click action of its own; it must dismiss.
  await page.locator('#vs-host .entry-row.active .atom-count').click();
  await expect(page.locator('#entry-panel')).toBeHidden();
});

test('clicking another entry re-targets rather than closing', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  await page.locator('#vs-host .entry-row', { hasText: 'river' }).locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page.locator('#entry-panel-entry')).toHaveValue('river');
});

// ─── Routable URL ─────────────────────────────────────────────────────────────

test('opening writes ?entry= to the URL and closing strips it', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['BAGEL'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'BAGEL');
  await expect(page).toHaveURL(/[?&]entry=BAGEL(&|$)/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(page).not.toHaveURL(/entry=/);
});

test('the entry param leads and coexists with the pipeline', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['BAGEL', 'BAGELS'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await page.locator('.search-bar .tool-row-param-text input').first().fill('BAGEL*');
  await page.waitForFunction(() => location.search.includes('search='));
  await openPanelOnEntry(page, 'BAGEL');
  await expect(page).toHaveURL(/\?entry=BAGEL&.*search=BAGEL/);
});

test('a re-target replaces the entry param (one Back still closes), no unknown-tool toast', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  await expect(page).toHaveURL(/entry=ocean/);
  await openPanelOnEntry(page, 'river');
  await expect(page).toHaveURL(/entry=river/);
  await page.goBack();
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(page).not.toHaveURL(/entry=/);
  // The reserved `entry` key must not read as a removed tool.
  await expect(page.locator('.toast', { hasText: 'no longer available' })).toHaveCount(0);
});

test('reloading a ?entry= URL re-opens the panel on that entry', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  await expect(page).toHaveURL(/entry=ocean/);

  await reloadApp(page);
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page.locator('#entry-panel-entry')).toHaveValue('ocean');
  // The deep-link open seeds off the worker (no clicked row), so the score lands too.
  await expect(page.locator('#entry-panel-score')).toHaveValue('50');
});

test('a UI close pops its history entry, so Back afterward does not just re-consume it', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  await page.keyboard.press('Escape');
  await expect(page.locator('#entry-panel')).toBeHidden();
  // Proxy for "Escape left no dangling entry": reopen and confirm a single Back
  // still closes cleanly, which a corrupted history stack would break.
  await openPanelOnEntry(page, 'ocean');
  await page.goBack();
  await expect(page.locator('#entry-panel')).toBeHidden();
});
