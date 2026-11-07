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

test('an error more typing cannot fix shows as soon as it is typed; an unfinished one waits', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'umiaq');
  const umiaq = page.locator('.tool-row[data-tool="umiaq"] input[data-key="query"]');
  await umiaq.pressSequentially('l.');
  await expect(panel(page).locator('.assist-error')).toContainText('any letter');

  await addTool(page, 'regex');
  const regex = page.locator('.tool-row[data-tool="regex"] input[data-key="pattern"]');
  await regex.pressSequentially('(ab');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.assist-error')).toHaveCount(0);
  await regex.press('ArrowLeft');
  await expect(panel(page).locator('.assist-error')).toContainText('needs a closing');
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

const regexBox = page => page.locator('.tool-row[data-tool="regex"] input[data-key="pattern"]');

function panelLayout(page) {
  return page.evaluate(() => {
    const p = document.querySelector('.assist-panel');
    const box = document.querySelector('.tool-row[data-tool="regex"] .clearable-input').getBoundingClientRect();
    const r = p.getBoundingClientRect(), vv = window.visualViewport;
    const cheat = p.querySelector('.assist-cheat'), hint = p.querySelector('.assist-error, .assist-hint');
    return {
      open: p.matches(':popover-open'),
      clear: r.bottom <= box.top || r.top >= box.bottom,
      onScreen: r.top >= vv.offsetTop && r.bottom <= vv.offsetTop + vv.height,
      above: r.bottom <= box.top,
      cheatShown: !!cheat?.checkVisibility(),
      hintBelowCheat: hint && cheat ? hint.getBoundingClientRect().top >= cheat.getBoundingClientRect().bottom : null,
    };
  });
}

test('the panel sits whole on screen and never over the box, at any height', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'regex');
  await regexBox(page).fill('un*ed');
  for (const height of [900, 400, 250, 200, 120]) {
    await page.setViewportSize({ width: 1000, height });
    await regexBox(page).click();
    const L = await panelLayout(page);
    if (L.open) expect(L, `height ${height}`).toMatchObject({ clear: true, onScreen: true });
  }
});

test('the panel opens above with hints nearest the box, then drops the cheat sheet, then hides', async ({ page }) => {
  await gotoApp(page);
  await addTool(page, 'regex');
  await regexBox(page).fill('un*ed');
  await expect(panel(page).locator('.assist-error, .assist-hint')).toBeVisible();
  expect(await panelLayout(page)).toMatchObject({ above: true, cheatShown: true, hintBelowCheat: true });

  let L;
  for (let height = 500; height >= 100; height -= 10) {
    await page.setViewportSize({ width: 1000, height });
    await regexBox(page).click();
    L = await panelLayout(page);
    if (!L.cheatShown) break;
  }
  expect(L).toMatchObject({ open: true, clear: true, onScreen: true, cheatShown: false });

  await page.setViewportSize({ width: 1000, height: 60 });
  await regexBox(page).click();
  await expect(panel(page)).toBeHidden();
});

// Polls :popover-open, not visibility: WebKit can leave the panel open but at
// display: none, which toBeHidden passes.
const panelOpen = page => page.evaluate(() => document.querySelector('.assist-panel').matches(':popover-open'));

// The box sits below a 60px viewport until something scrolls it into view.
async function shrinkBelowBox(page) {
  await gotoApp(page);
  await addTool(page, 'regex');
  await regexBox(page).fill('un*ed');
  for (let height = 500; height >= 330; height -= 10) {
    await page.setViewportSize({ width: 1000, height });
    await regexBox(page).click();
  }
  await page.setViewportSize({ width: 1000, height: 60 });
}

test('the panel stays closed while its box is scrolled off screen', async ({ page }) => {
  await shrinkBelowBox(page);
  await expect.poll(() => panelOpen(page)).toBe(false);
});

test('a panel reopened mid-fade-out is measured at its real height', async ({ page }) => {
  await shrinkBelowBox(page);
  await regexBox(page).click();
  await expect.poll(() => panelOpen(page)).toBe(false);
});
