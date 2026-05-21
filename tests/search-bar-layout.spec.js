// Pixel-position layout tests. Overrides the usual "no style tests" rule
// because this bar regressed three times across related changes (compact
// trigger, replace-vs-pattern width, asides alignment). Assertions read
// bounding boxes only, never computed CSS.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function searchBarBoxes(page) {
  await page.locator('.search-bar').waitFor();
  return await page.evaluate(() => {
    const bar = document.querySelector('.search-bar');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, cy: (r.top + r.bottom) / 2 };
    };
    const pick = (sel) => box(bar.querySelector(sel));
    return {
      bar: box(bar),
      drag: pick('.drag-handle'),
      label: pick('.tool-label'),
      caret: pick('.find-replace-caret'),
      pattern: pick('.tool-row-param-text:not(.tool-row-replace) input'),
      replace: pick('.tool-row-replace input'),
      wholeWord: pick('.tool-row-asides input[type="checkbox"]'),
      overflow: pick('.search-bar-overflow'),
      compactBtn: pick('.search-adjust-btn'),
      compact: bar.classList.contains('compact'),
    };
  });
}

test.describe('Workshop search bar layout', () => {
  test('at 1000px viewport: pattern ~200px, whole-word next to it, controls vertically centered', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoApp(page);

    const b = await searchBarBoxes(page);

    expect(b.compact).toBe(false);

    expect(b.pattern.width).toBeGreaterThanOrEqual(180);
    expect(b.pattern.width).toBeLessThanOrEqual(210);

    const patternToWord = b.wholeWord.left - b.pattern.right;
    expect(patternToWord).toBeGreaterThanOrEqual(0);
    expect(patternToWord).toBeLessThanOrEqual(60);

    expect(b.bar.right - b.overflow.right).toBeLessThanOrEqual(20);

    const cy = b.pattern.cy;
    for (const el of [b.drag, b.label, b.caret, b.wholeWord, b.overflow]) {
      expect(Math.abs(el.cy - cy)).toBeLessThanOrEqual(3);
    }

    await expect(page.locator('.search-bar #score-range-input')).toBeVisible();
    await expect(page.locator('.search-bar #search-bar-sort .sort-axis-select')).toBeVisible();
    await expect(page.locator('.search-bar .search-adjust-btn')).toBeHidden();
  });

  test('at 390px viewport: bar goes compact, expanded replace matches pattern', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await gotoApp(page);

    const collapsed = await searchBarBoxes(page);

    expect(collapsed.compact).toBe(true);
    expect(collapsed.pattern.width).toBeGreaterThanOrEqual(80);
    expect(collapsed.pattern.width).toBeLessThanOrEqual(200);

    const patternToWord = collapsed.wholeWord.left - collapsed.pattern.right;
    expect(patternToWord).toBeGreaterThanOrEqual(0);
    expect(patternToWord).toBeLessThanOrEqual(60);

    expect(collapsed.compactBtn).not.toBeNull();
    expect(collapsed.bar.right - collapsed.compactBtn.right).toBeLessThanOrEqual(20);

    await expect(page.locator('.search-bar #score-range-input')).toBeHidden();
    await expect(page.locator('.search-bar #search-bar-sort .sort-axis-select')).toBeHidden();
    await expect(page.locator('.search-bar .search-adjust-btn')).toBeVisible();

    await page.locator('.search-bar .search-adjust-btn').click();
    await expect(page.locator('.search-adjust-popover #score-range-input')).toBeVisible();
    await expect(page.locator('.search-adjust-popover #search-bar-sort .sort-axis-select')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('.search-bar .find-replace-caret').click();

    const expanded = await searchBarBoxes(page);

    expect(Math.abs(expanded.replace.left  - expanded.pattern.left )).toBeLessThanOrEqual(1);
    expect(Math.abs(expanded.replace.right - expanded.pattern.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(expanded.replace.width - expanded.pattern.width)).toBeLessThanOrEqual(1);

    const verticalGap = expanded.replace.top - expanded.pattern.bottom;
    expect(verticalGap).toBeGreaterThanOrEqual(0);
    expect(verticalGap).toBeLessThanOrEqual(20);

    const cy = expanded.pattern.cy;
    for (const el of [expanded.drag, expanded.label, expanded.caret, expanded.wholeWord, expanded.compactBtn]) {
      expect(Math.abs(el.cy - cy)).toBeLessThanOrEqual(3);
    }
  });

  test('at 1000px viewport: expanded replace matches pattern', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoApp(page);
    await page.locator('.search-bar .find-replace-caret').click();

    const b = await searchBarBoxes(page);

    expect(Math.abs(b.replace.left  - b.pattern.left )).toBeLessThanOrEqual(1);
    expect(Math.abs(b.replace.right - b.pattern.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.replace.width - b.pattern.width)).toBeLessThanOrEqual(1);
  });

  test('caret is fully rendered and gaps are tight', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoApp(page);

    const b = await searchBarBoxes(page);

    expect(b.caret.width).toBeGreaterThanOrEqual(14);

    const caretToPattern = b.pattern.left - b.caret.right;
    expect(caretToPattern).toBeGreaterThanOrEqual(4);
    expect(caretToPattern).toBeLessThanOrEqual(10);

    const patternToWord = b.wholeWord.left - b.pattern.right;
    expect(patternToWord).toBeGreaterThanOrEqual(8);
    expect(patternToWord).toBeLessThanOrEqual(18);
  });

  test('adjust button stays on-screen at iPhone widths', async ({ page }) => {
    for (const width of [390, 393, 402]) {
      await page.setViewportSize({ width, height: 700 });
      await gotoApp(page);
      const b = await searchBarBoxes(page);
      expect(b.compact, `viewport ${width}: bar should be compact`).toBe(true);
      expect(b.compactBtn.right, `viewport ${width}: adjust button off-screen`).toBeLessThanOrEqual(width + 1);
    }
  });
});
