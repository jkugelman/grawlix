// Pixel-geometry layout tests — a DELIBERATE, user-authorized exception to the
// "visual/layout stays manual" rule in docs/testing.md and the no-computed-style
// convention. The search bar accumulated repeated fiddly layout regressions that
// manual play-throughs kept missing, so its geometry (input widths, control gaps,
// vertical centering) is pinned here on purpose. Do NOT delete these as
// philosophy drift — see docs/testing.md § "What stays manual".

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

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
      pattern: pick(':scope > .tool-row-param-text input'),
      replace: pick('.tool-row-replace .tool-row-param-text input'),
      wholeWord: pick('.tool-row-asides input[type="checkbox"]'),
    };
  });
}

test.describe('Search bar layout', () => {
  test('at 1000px viewport: pattern ~200px, whole-word next to it, controls vertically centered', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoApp(page);

    const b = await searchBarBoxes(page);

    expect(b.pattern.width).toBeGreaterThanOrEqual(180);
    expect(b.pattern.width).toBeLessThanOrEqual(210);

    const patternToWord = b.wholeWord.left - b.pattern.right;
    expect(patternToWord).toBeGreaterThanOrEqual(0);
    expect(patternToWord).toBeLessThanOrEqual(60);

    const cy = b.pattern.cy;
    for (const el of [b.drag, b.label, b.caret, b.wholeWord]) {
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
});
