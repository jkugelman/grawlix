import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The transform tier windows like the flat tier: the worker sorts + retains the
// full chain list and ships only a first window, serving later windows via
// fetchTransformRows. A result larger than the first window, scrolled deep, must
// fill real rows from the cache and never leave skeletons — which only works if the
// scroller sizes from the worker's chainCount and the windowed fetch path runs.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const COUNT = 300;

async function seedTransform(page) {
  await page.evaluate((count) => {
    const entries = [], scores = [];
    // A search-replace transform keeps an output only when it's a real entry, so
    // seed both the abcNNN inputs and the xyzNNN outputs (600 entries total).
    for (let i = 0; i < count; i++) {
      const n = String(i).padStart(3, '0');
      entries.push('abc' + n, 'xyz' + n);
      scores.push(10 + (i % 50), 10 + (i % 50));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Seq', entries, scores });
  }, COUNT);
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() =>
    window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'abc', replace: 'xyz' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const inputAtoms = page => page.evaluate(async () =>
  (await window.__grawlixTest.getVisibleEntries()).map(r => Array.isArray(r) ? r[0] : r).filter(Boolean));

const skeletonCount = page => page.evaluate(() =>
  document.querySelectorAll('#vs-host .entry-row.skeleton').length);

async function settle(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.__grawlixTest.windowIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('transform tier windows: the top window fills with real sorted rows', async ({ page }) => {
  await gotoApp(page);
  await seedTransform(page);
  await settle(page);

  expect(await skeletonCount(page)).toBe(0);
  const rows = await inputAtoms(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]).toBe('abc000');
  expect(rows).toEqual(rows.map((_, i) => 'abc' + String(i).padStart(3, '0')));
});

test('transform tier windows: a deep scroll past the first window fills real rows', async ({ page }) => {
  await gotoApp(page);
  await seedTransform(page);
  await settle(page);

  // stride = atomCount(2) × ROW_HEIGHT(24) = 48px; scroll well past FIRST_WINDOW (60).
  await page.evaluate(() => window.scrollTo(0, 160 * 48));
  await settle(page);

  expect(await skeletonCount(page)).toBe(0);
  const rows = await inputAtoms(page);
  expect(rows.length).toBeGreaterThan(0);
  // A row past the first window only renders if it was fetched into the cache.
  const first = parseInt(rows[0].slice('abc'.length), 10);
  expect(first).toBeGreaterThan(60);
  expect(rows).toEqual(rows.map((_, i) => 'abc' + String(first + i).padStart(3, '0')));
});
