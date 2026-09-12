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
      overflow: bar.scrollWidth - bar.clientWidth,
      name: bar.querySelector('.tool-row-name').textContent,
      drag: pick('.drag-handle'),
      label: pick('.tool-label'),
      caret: pick('.find-replace-caret'),
      pattern: pick(':scope > .tool-row-param-text input'),
      replace: pick('.tool-row-replace .tool-row-param-text input'),
      matchToggle: pick('.tool-row-asides input[type="checkbox"]'),
      matchMenuBtn: pick('.tool-row-asides .match-mode-arrow'),
      invert: pick('.tool-row-invert'),
    };
  });
}

test.describe('Search bar layout', () => {
  test('at 1000px viewport: pattern ~200px, match toggle next to it, controls vertically centered', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoApp(page);

    const b = await searchBarBoxes(page);

    expect(b.pattern.width).toBeGreaterThanOrEqual(180);
    expect(b.pattern.width).toBeLessThanOrEqual(210);

    const patternToToggle = b.matchToggle.left - b.pattern.right;
    expect(patternToToggle).toBeGreaterThanOrEqual(0);
    expect(patternToToggle).toBeLessThanOrEqual(60);

    const cy = b.pattern.cy;
    for (const el of [b.drag, b.label, b.caret, b.matchToggle, b.matchMenuBtn]) {
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

    const patternToToggle = b.matchToggle.left - b.pattern.right;
    expect(patternToToggle).toBeGreaterThanOrEqual(8);
    expect(patternToToggle).toBeLessThanOrEqual(18);
  });

  test('at 375px viewport: the bar named Replace fits without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await gotoApp(page);

    const before = await searchBarBoxes(page);
    await page.locator('.search-bar .find-replace-caret').click();
    const b = await searchBarBoxes(page);

    expect(b.name).toBe('Replace');
    expect(b.overflow).toBeLessThanOrEqual(0);
    expect(b.label.right).toBeLessThanOrEqual(b.caret.left);
    expect(b.pattern.width).toBeGreaterThanOrEqual(64);
    expect(b.pattern.width).toBeGreaterThanOrEqual(before.pattern.width - (b.label.width - before.label.width) - 1);
    for (const el of [b.label, b.caret, b.pattern, b.matchToggle, b.matchMenuBtn, b.invert]) {
      expect(el.right).toBeLessThanOrEqual(b.bar.right + 0.5);
    }
  });
});
