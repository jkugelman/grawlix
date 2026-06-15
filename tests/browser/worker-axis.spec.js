import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// ch6α oracle: the worker computes the scope-stable badge-gradient axis and
// ships it on selfReady; main substitutes it for the local all-sources axis.
// allSourcesHistogramLayout() is the accessor the badge gradient (scoreColor)
// reads, returning the shipped axis — so it's the exact value a badge sees.
//
// Same footgun as worker-corpus.spec.js: re-run syncWorkerConfig() after ANY
// change to sources/rules, or the worker answers against stale config.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const sync = page => page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
const axis = page => page.evaluate(() => window.__grawlixTest.allSourcesHistogramLayout());
const axisVersion = page => page.evaluate(() => window.__grawlixTest.shippedAllSourcesAxisVersion());

test('the shipped axis covers the all-sources score union', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ABLE', 'CRANE', 'EAGLE'], scores: [90, 80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo', entries: ['BIRD', 'DELTA', 'FROND'], scores: [60, 50, 40],
  }));

  await sync(page);
  const shipped = await axis(page);
  expect(shipped.slots.length).toBeGreaterThan(0);
  expect(shipped.min).toBe(40);
  expect(shipped.max).toBe(90);
});

test('axis is scope-stable across runs and scope switches', async ({ page }) => {
  await gotoApp(page);

  const alpha = await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ABLE', 'CRANE', 'EAGLE'], scores: [90, 80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo', entries: ['BIRD', 'DELTA', 'FROND'], scores: [60, 50, 40],
  }));

  await sync(page);
  const initial = await axis(page);
  expect(initial.slots.length).toBeGreaterThan(0);

  // A search run (the keystroke path) must not recompute the axis.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'matches', params: { pattern: 'A' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await axis(page)).toEqual(initial);

  // Scope to a single source — the scoped histogram is a different score source,
  // but the all-sources badge axis must hold.
  await page.evaluate(k => window.__grawlixTest.setScope(
    window.state.sources.find(s => s.dbKey === k).name), alpha);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await axis(page)).toEqual(initial);

  // Back to merged, then clear the search.
  await page.evaluate(() => window.__grawlixTest.setScope());
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await axis(page)).toEqual(initial);
});

test('axis recomputes (and version bumps) after a rules edit + re-sync', async ({ page }) => {
  await gotoApp(page);

  // Tides' raw 350 sits far above everything; a rule pulling it to 80 narrows the
  // distribution, so the recomputed axis must differ.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Tides', entries: ['OCEAN', 'TIDE', 'WAVE'], scores: [350, 50, 40],
  }));

  await sync(page);
  const before = await axis(page);
  const beforeVersion = await axisVersion(page);
  expect(before.max).toBe(350);

  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Tides', [
    { input: '350', length: '', output: '80', note: '' },
  ]));
  await sync(page);
  // Poll, don't read once: the rule edit's own auto-re-sync supersedes this manual
  // sync, so the recomputed axis lands a beat later (a read-once flakes on webkit).
  await expect.poll(() => axis(page).then(a => a.max)).toBe(80);
  const after = await axis(page);
  const afterVersion = await axisVersion(page);

  expect(afterVersion).toBeGreaterThan(beforeVersion);
  expect(after).not.toEqual(before);
});

test('disabled sources widen the axis (their scores are included)', async ({ page }) => {
  await gotoApp(page);

  // Enabled source: scores 40–90. Disabled source: a far-out 500 that no
  // enabled/merged corpus would contain — if the worker built the axis from the
  // enabled-only deduped ownedCorpus instead of the all-sources union, max would
  // stay 90.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Enabled', entries: ['ABLE', 'CRANE', 'EAGLE'], scores: [90, 80, 40],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Disabled', entries: ['ZEBRA'], scores: [500], enabled: false,
  }));

  await sync(page);
  const withDisabled = await axis(page);
  expect(withDisabled.max).toBe(500);
});
