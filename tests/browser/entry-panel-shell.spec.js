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
  expect(panel.width).toBeGreaterThan(400);
  expect(panel.width).toBeLessThan(600);

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

test('browser Back out of a dirty panel confirms; cancelling restores the panel and its URL', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  await page.locator('#entry-panel-score').fill('60');

  await page.goBack();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog #btn-confirm-cancel').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page.locator('#entry-panel-score')).toHaveValue('60');
  await expect(page).toHaveURL(/entry=ocean/);

  await page.goBack();
  await page.locator('#confirm-dialog #btn-confirm-ok').click();
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(page).not.toHaveURL(/entry=/);
});

test('a Forward-reopened panel closes consistently, leaving it Forward-reachable again', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');

  await openPanelOnEntry(page, 'ocean');                 // push
  await page.keyboard.press('Escape');                    // close pops it → entry is now Forward
  await expect(page.locator('#entry-panel')).toBeHidden();

  await page.goForward();                                 // re-open via the lit Forward button
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page).toHaveURL(/entry=ocean/);

  await page.keyboard.press('Escape');                    // must pop again, not strip in place
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(page).not.toHaveURL(/entry=/);

  await page.goForward();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page).toHaveURL(/entry=ocean/);
});

test('a Forward-reopened panel is view-first: it does not steal focus into the score box', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');

  await openPanelOnEntry(page, 'ocean');
  await page.keyboard.press('Escape');
  await expect(page.locator('#entry-panel')).toBeHidden();

  await page.goForward();
  await expect(page.locator('#entry-panel')).toBeVisible();
  // The score fills from an async worker seed; assert focus only after it lands, or
  // the check runs before any focus could fire and passes vacuously.
  await expect(page.locator('#entry-panel-score')).toHaveValue('50');
  await expect(page.locator('#entry-panel-score')).not.toBeFocused();
});

test('the open panel is modal: it covers the page and an outside click closes it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');

  // elementFromPoint over another row returns the scrim, proving it intercepts
  // the click: there is no re-targeting and the page behind stays inert.
  const river = page.locator('#vs-host .entry-row', { hasText: 'river' }).locator('.atom-entry');
  const box = await river.boundingBox();
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.id,
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hit).toBe('entry-panel-backdrop');

  await page.locator('#entry-panel-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(page).not.toHaveURL(/entry=/);
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

test('the reserved entry key is not parsed as a removed tool', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  await expect(page).toHaveURL(/entry=ocean/);
  // Reload re-parses the URL from scratch — the path where a stray tool slug toasts.
  await reloadApp(page);
  await expect(page.locator('#entry-panel')).toBeVisible();
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
