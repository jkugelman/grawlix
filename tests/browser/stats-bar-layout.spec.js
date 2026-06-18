import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function statsBarBoxes(page) {
  await page.locator('#stats .stats-bar').waitFor();
  return await page.evaluate(() => {
    const bar = document.querySelector('#stats .stats-bar');
    const box = (el) => {
      if (!el || el.offsetWidth === 0) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    };
    const pick = (sel) => box(bar.querySelector(sel));
    return {
      bar: box(bar),
      counts: pick('.stats-bar-counts'),
      distribution: pick('.stats-bar-distribution'),
      controls: pick('.stats-bar-controls'),
      histogram: pick('.histogram'),
      min: pick('.stat-far:nth-of-type(1)'),
      max: pick('.stat-far:nth-of-type(2)'),
    };
  });
}

async function seedWordlist(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Test', scores: [10, 50, 90],
  }));
}

// Poll the stats bar's responsive visibility to a settle. setViewportSize
// drives the show/hide through refreshStatsBarOverflow's ResizeObserver, which
// fires a task after the resize — a single read races it (the webkit flake).
async function expectStatsShape(page, shape) {
  await expect.poll(async () => {
    const b = await statsBarBoxes(page);
    return { min: b.min !== null, max: b.max !== null, histogram: b.histogram !== null };
  }).toEqual(shape);
}

async function settledStatsVisibility(page) {
  let last = null, stable = 0;
  await expect.poll(async () => {
    const b = await statsBarBoxes(page);
    const cur = JSON.stringify({ min: b.min !== null, max: b.max !== null, histogram: b.histogram !== null });
    if (cur === last) stable++; else { stable = 0; last = cur; }
    return stable;
  }).toBeGreaterThanOrEqual(2);
  return JSON.parse(last);
}

test.describe('Stats bar layout', () => {
  test('at iPhone width: stats-bar sections do not overlap', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoApp(page);
    await seedWordlist(page);
    await expectStatsShape(page, { min: false, max: false, histogram: false });

    const b = await statsBarBoxes(page);

    expect(b.counts.right).toBeLessThanOrEqual(b.controls.left + 1);
    if (b.distribution) {
      expect(b.counts.right).toBeLessThanOrEqual(b.distribution.left + 1);
      expect(b.distribution.right).toBeLessThanOrEqual(b.controls.left + 1);
    }
    expect(b.controls.right).toBeLessThanOrEqual(b.bar.right + 1);
  });

  test('Min/Max hide before the histogram as the viewport narrows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoApp(page);
    await seedWordlist(page);

    // Breakpoint widths are font-metric-dependent — they shift between rendering
    // environments. Assert the hide priority, never a specific width; pinning one
    // reintroduces a flake that only surfaces under a different font.
    const widths = [1280, 1040, 880, 760, 680, 620, 560, 500, 460, 420, 380, 340];
    const samples = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      samples.push({ width, ...(await settledStatsVisibility(page)) });
    }

    expect(samples.at(0)).toMatchObject({ min: true, max: true, histogram: true });
    expect(samples.at(-1)).toMatchObject({ min: false, max: false, histogram: false });

    for (const s of samples) {
      expect(s.min).toBe(s.max);
      if (s.min) expect(s.histogram).toBe(true);
    }

    const hiddenBelow = (key) => Math.max(...samples.filter((s) => !s[key]).map((s) => s.width));
    expect(hiddenBelow('min')).toBeGreaterThan(hiddenBelow('histogram'));
  });
});
