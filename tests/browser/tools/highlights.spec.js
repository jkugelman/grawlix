// The tool tier's render residue: the one DOM shape nothing else covers — a
// find/replace transform painting its *output* atom's marks. Don't add per-tool
// tests here; tool logic and highlight ranges live in the unit tier. See
// docs/testing.md § Tool specs.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('search replace paints the output atom and echoes the match color', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SearchReplace', entries: ['cat', 'cats', 'scat', 'dog', 'dogs'], scores: Array(5).fill(50),
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'search', params: { pattern: 'cat', replace: 'dog' } }]));
  await expectVisible(page, [['cat', 'dog'], ['cats', 'dogs']]);

  const row = page.locator('#vs-host .entry-row', { hasText: 'dogs' });
  const inMarks = row.locator('.atom').nth(0).locator('mark');
  const outMarks = row.locator('.atom').nth(1).locator('mark');
  await expect(inMarks).toHaveText(['cat']);
  await expect(outMarks).toHaveText(['dog']);
  await expect(outMarks.nth(0)).toHaveClass(await inMarks.nth(0).getAttribute('class'));
});

test('regex replace keeps each capture group color as it swaps positions', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'RegexSwap', entries: ['cats', 'cast', 'arc', 'car'], scores: Array(4).fill(50),
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'regex', params: { pattern: '(t)(s)$', replace: '$2$1' } }]));
  await expectVisible(page, [['cats', 'cast']], { ordered: true });

  const row = page.locator('#vs-host .entry-row', { hasText: 'cast' });
  const inMarks = row.locator('.atom').nth(0).locator('mark');
  const outMarks = row.locator('.atom').nth(1).locator('mark');
  await expect(inMarks).toHaveText(['t', 's']);
  await expect(outMarks).toHaveText(['s', 't']);
  await expect(outMarks.nth(1)).toHaveClass(await inMarks.nth(0).getAttribute('class'));
});
