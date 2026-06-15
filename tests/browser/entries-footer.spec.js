// The entries-table footer composes two independent lines at the end of the
// table: "No matches." whenever the result is empty, and "Expecting more?
// Switch to All Wordlists" whenever the scope isn't All Wordlists. Either,
// both, or neither — see entries-table.js `_renderFooter`.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo } = require('./helpers');

const search = (page, pattern) => page.evaluate(
  p => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: p } }]), pattern);

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Small', entries: ['cat', 'dog'], scores: [50, 50],
  }));
});

test('scoped to a source with results: the footer offers a switch to All Wordlists', async ({ page }) => {
  await scopeTo(page, 'Small');

  const footer = page.locator('.entries-footer');
  await expect(footer).toBeVisible();
  await expect(footer).toContainText('Expecting more? Switch to All Wordlists');
  await expect(footer).not.toContainText('No matches.');

  await page.locator('.entries-footer-btn').click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
  await expect(footer).toHaveCount(0);
});

test('scoped to a source with no results: the footer shows both lines', async ({ page }) => {
  await scopeTo(page, 'Small');
  await search(page, 'zzzz');
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const footer = page.locator('.entries-footer');
  await expect(footer).toContainText('No matches.');
  await expect(footer).toContainText('Expecting more? Switch to All Wordlists');
});

test('All Wordlists with results: no footer', async ({ page }) => {
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#vs-host .entry-row').first()).toBeVisible();
  await expect(page.locator('.entries-footer')).toHaveCount(0);
});

test('All Wordlists with no results: the footer shows only No matches', async ({ page }) => {
  await search(page, 'zzzz');
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await expect(page.locator('.entries-footer')).toHaveText('No matches.');
  await expect(page.locator('.entries-footer-btn')).toHaveCount(0);
});
