const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function statsBarBoxes(page) {
  await page.locator('#workshop-stats .stats-bar').waitFor();
  return await page.evaluate(() => {
    const bar = document.querySelector('#workshop-stats .stats-bar');
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

test.describe('Workshop stats bar layout', () => {
  test('at iPhone width: stats-bar sections do not overlap', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoApp(page);
    await seedWordlist(page);

    const b = await statsBarBoxes(page);

    expect(b.counts.right).toBeLessThanOrEqual(b.controls.left + 1);
    if (b.distribution) {
      expect(b.counts.right).toBeLessThanOrEqual(b.distribution.left + 1);
      expect(b.distribution.right).toBeLessThanOrEqual(b.controls.left + 1);
    }
    expect(b.controls.right).toBeLessThanOrEqual(b.bar.right + 1);
  });

  test('shrinking the viewport hides Min/Max first, then the histogram', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await gotoApp(page);
    await seedWordlist(page);

    let b = await statsBarBoxes(page);
    expect(b.min).not.toBeNull();
    expect(b.max).not.toBeNull();
    expect(b.histogram).not.toBeNull();

    await page.setViewportSize({ width: 600, height: 800 });
    b = await statsBarBoxes(page);
    expect(b.min).toBeNull();
    expect(b.max).toBeNull();
    expect(b.histogram).not.toBeNull();

    await page.setViewportSize({ width: 375, height: 667 });
    b = await statsBarBoxes(page);
    expect(b.min).toBeNull();
    expect(b.max).toBeNull();
    expect(b.histogram).toBeNull();
  });
});
