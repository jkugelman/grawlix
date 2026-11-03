import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, addTool } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const panel = page => page.locator('.assist-panel');
const bar = page => page.locator('.search-bar input[data-key="pattern"]');

test('the cheat sheet shows while the box has focus, and a row inserts at the caret', async ({ page }) => {
  await gotoApp(page);
  await bar(page).click();
  await expect(panel(page).locator('.assist-cheat')).toContainText('any consonant');
  await panel(page).locator('.assist-cheat-row', { hasText: 'any consonant' }).click();
  await expect(bar(page)).toHaveValue('#');
  await expect(bar(page)).toBeFocused();
  await expect(panel(page).locator('.assist-cheat')).toContainText('any consonant');
});

test('a Umiaq row inserts at the caret, not the end', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'umiaq');
  const input = page.locator('.tool-row[data-tool="umiaq"] input[data-key="query"]');
  await input.fill('AB');
  await input.press('ArrowLeft');
  await panel(page).locator('.assist-cheat-row', { hasText: 'the reverse of A' }).click();
  await expect(input).toHaveValue('A~B');
});

test('Umiaq variables are colored like their results and the query is read back', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'umiaq');
  const input = page.locator('.tool-row[data-tool="umiaq"] input[data-key="query"]');
  await input.fill('ABBA');
  const mirror = page.locator('.tool-row[data-tool="umiaq"] .assist-hl');
  await expect(mirror.locator('.hl-umiaq-var-0')).toHaveCount(2);
  await expect(mirror.locator('.hl-umiaq-var-1')).toHaveText('BB');
  await expect(panel(page).locator('.assist-reading')).toContainText('a chunk A, then a chunk B, then B again, then A again');
  await input.blur();
  await expect(panel(page)).toBeHidden();
});

test('a Regex capture group is colored like its match, and a plain regex is not', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'regex');
  const input = page.locator('.tool-row[data-tool="regex"] input[data-key="pattern"]');
  const mirror = page.locator('.tool-row[data-tool="regex"] .assist-hl');
  await input.fill('^(..)\\1$');
  await expect(mirror.locator('.search-match-0')).toHaveText('(..)');
  await input.fill('un.*ed');
  await expect(mirror.locator('[class*="search-match"]')).toHaveCount(0);
});

test('a Regex replacement colors `$N` like group N, following the pattern', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'regex');
  const row = page.locator('.tool-row[data-tool="regex"]');
  await row.locator('.find-replace-caret').click();
  await row.locator('input[data-key="pattern"]').fill('(.)(.)');
  const replace = row.locator('input[data-key="replace"]');
  await replace.fill('$2$1');
  const mirror = row.locator('.tool-row-replace .assist-hl');
  await expect(mirror.locator('.search-match-1')).toHaveText('$2');
  await expect(mirror.locator('.search-match-0')).toHaveText('$1');
  await expect(panel(page)).toBeHidden();
  await row.locator('input[data-key="pattern"]').fill('(.).');
  await expect(mirror.locator('.assist-bad')).toHaveText('$2');
});

test('a fix button rewrites the query', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'umiaq');
  const input = page.locator('.tool-row[data-tool="umiaq"] input[data-key="query"]');
  await input.fill('l.ve');
  await expect(page.locator('.tool-row[data-tool="umiaq"] .assist-hl .q-err')).toHaveText('.');
  await panel(page).locator('.assist-fix', { hasText: 'Use ?' }).click();
  await expect(input).toHaveValue('l?ve');
  await expect(panel(page).locator('.assist-error')).toHaveCount(0);
  expect(new URL(page.url()).search).toContain('umiaq=l%3Fve');
});

test('a Regex row typed in Search syntax can turn into a Search row', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'regex');
  await page.locator('.tool-row[data-tool="regex"] input[data-key="pattern"]').fill('un*ed');
  await panel(page).locator('.assist-fix', { hasText: 'Use Search' }).click();
  await expect(page.locator('.tool-row[data-tool="regex"]')).toHaveCount(0);
  await expect(page.locator('.tool-row[data-tool="search"] input[data-key="pattern"]')).toHaveValue('un*ed');
});

test('the search bar hands a query to a new tool row and empties itself', async ({ page }) => {
  await gotoApp(page);
  await bar(page).fill('^cat.*');
  await panel(page).locator('.assist-fix', { hasText: 'Use Regex' }).click();
  await expect(page.locator('.tool-row[data-tool="regex"] input[data-key="pattern"]')).toHaveValue('^cat.*');
  await expect(bar(page)).toHaveValue('');
});

test('the search cheat sheet stays while typing', async ({ page }) => {
  await gotoApp(page);
  await bar(page).fill('CARROT');
  await expect(panel(page).locator('.assist-cheat')).toContainText('any consonant');
});

test('Escape dismisses the panel until the next edit', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'umiaq');
  const input = page.locator('.tool-row[data-tool="umiaq"] input[data-key="query"]');
  await input.click();
  await expect(panel(page)).toBeVisible();
  await input.press('Escape');
  await expect(panel(page)).toBeHidden();
  await input.pressSequentially('A');
  await expect(panel(page)).toBeVisible();
});

test('the mirror follows the input font, so the caret stays on the letters', async ({ page }) => {
  await gotoApp(page);
  // Stands in for iOS, which raises inputs to 16px to stop focus-zoom.
  await page.addStyleTag({ content: '.search-bar input[data-key="pattern"] { font-size: 16px; }' });
  await bar(page).fill('incredibles');
  const widths = await bar(page).evaluate(input => {
    const probe = document.createElement('span');
    probe.style.font = getComputedStyle(input).font;
    probe.style.whiteSpace = 'pre';
    probe.style.position = 'absolute';
    probe.textContent = input.value;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return { input: w, mirror: input.parentElement.querySelector('.assist-hl-text').getBoundingClientRect().width };
  });
  expect(widths.mirror).toBeCloseTo(widths.input, 0);
});
