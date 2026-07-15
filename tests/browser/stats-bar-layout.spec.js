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
      scores: pick('.score-range-label'),
      streamDots: pick('.stream-dots'),
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
async function settledStatsVisibility(page) {
  let last = null, stable = 0;
  await expect.poll(async () => {
    const b = await statsBarBoxes(page);
    const cur = JSON.stringify({ histogram: b.histogram !== null, scores: b.scores !== null });
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
    // The score filter never sheds; the histogram does under this width.
    await expect.poll(async () => (await statsBarBoxes(page)).scores !== null).toBe(true);
    await settledStatsVisibility(page);

    const b = await statsBarBoxes(page);
    expect(b.scores).not.toBeNull();

    expect(b.counts.right).toBeLessThanOrEqual(b.controls.left + 1);
    if (b.distribution) {
      expect(b.counts.right).toBeLessThanOrEqual(b.distribution.left + 1);
      expect(b.distribution.right).toBeLessThanOrEqual(b.controls.left + 1);
    }
    expect(b.controls.right).toBeLessThanOrEqual(b.bar.right + 1);
  });

  test('the histogram hides as the viewport narrows, but the score filter never does', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoApp(page);
    await seedWordlist(page);

    const shown = key => async () => (await statsBarBoxes(page))[key] !== null;

    // Poll the terminal visibility, not the old settle heuristic: under a slow cold load
    // the ResizeObserver fires late and "stable for N reads" reads a stale value (the flake).
    await expect.poll(shown('histogram')).toBe(true);
    await expect.poll(shown('scores')).toBe(true);

    // Font-metric-dependent breakpoints shift between environments, so assert the hide
    // priority (histogram sheds, score filter never does), never a specific width.
    const widths = [1040, 880, 760, 680, 620, 560, 500, 460, 420, 380, 340];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(shown('scores')).toBe(true);
    }
    await expect.poll(shown('histogram'), { timeout: 15000 }).toBe(false);
  });

  // Guards the overflow budget counting the streaming spinner: it sits at the right
  // end of the distribution cell, so if excluded it overlaps the Share menu at any
  // width where the histogram still fits but leaves less slack than the dots need.
  test('the streaming spinner never overlaps the controls as the viewport narrows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoApp(page);
    await seedWordlist(page);

    await page.evaluate(() => {
      const rows = Array.from({ length: 10 }, (_, k) => ({ norm: 'ROW' + k, display: 'ROW' + k, score: 50, atoms: [{}] }));
      window.__grawlixTest.streamSyntheticBatch({
        runId: 'syn', version: 1, total: 10,
        scores: Array(10).fill(50),
        firstRows: rows,
        widthHints: { maxDisplayLen: 5, maxLenDigits: 1, maxScoreDigits: 2, maxRawDigits: 0 },
      });
    });
    await expect.poll(async () => (await statsBarBoxes(page)).streamDots !== null).toBe(true);

    const widths = [1040, 880, 760, 680, 620, 560, 500, 460, 420, 380, 340];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await settledStatsVisibility(page);
      const b = await statsBarBoxes(page);
      expect(b.streamDots, `spinner present at width ${width}`).not.toBeNull();
      expect(b.streamDots.right, `no overlap at width ${width}`).toBeLessThanOrEqual(b.controls.left + 1);
    }
  });
});
