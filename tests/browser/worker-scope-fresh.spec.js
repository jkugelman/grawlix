import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, settleWindow, runSearch } from './helpers.js';

// Scope-aware-build oracle (setScope): scoping away from merged and back must NOT
// permanently disable merged rich rows. The pre-setScope model cleared freshness
// in the snapshot handler last, so after a round-trip nothing re-set it; the
// ownedScope + scope-equality model (setScope re-sets fresh) keeps them engaged.
// Non-vacuity hinges on richRowsConsumed > 0 on the post-round-trip scroller — a
// regression back to index-only would still match the before-round-trip render.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const COUNT = 300;
// Well past VS_BUFFER (60) so the windowed path misses its top cache and re-fetches.
const DEEP_TOP = 160 * 24;

const STEMS = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE', 'FROND', 'GRAPE', 'HOUSE', 'INLET', 'JOUST'];

async function seedCorpus(page) {
  await page.evaluate(({ count, stems }) => {
    const mk = (offset, scoreBase) => {
      const entries = [], scores = [], comments = [];
      for (let i = 0; i < count; i++) {
        entries.push(stems[(i + offset) % stems.length] + String(i).padStart(3, '0'));
        scores.push(scoreBase + (i % 50));
        comments.push(i % 3 === 0 ? 'note' + i : '');
      }
      return { entries, scores, comments };
    };
    const a = mk(0, 10), b = mk(3, 200);
    window.__grawlixTest.addCustomWordlist({ name: 'Alpha', ...a });
    return window.__grawlixTest.addCustomWordlist({ name: 'Bravo', ...b });
  }, { count: COUNT, stems: STEMS });
}

function skeletonCount(page) {
  return page.evaluate(() => document.querySelectorAll('#vs-host .entry-row.skeleton').length);
}

function captureRows(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#vs-host .entry-row:not(.skeleton)')];
    return rows.map(r => ({
      top: r.style.top,
      text: (r.textContent || '').trim(),
      marks: [...r.querySelectorAll('mark')].map(m => m.textContent),
      html: r.innerHTML,
    })).sort((a, b) => parseFloat(a.top) - parseFloat(b.top));
  });
}

function richRowsConsumed(page) {
  return page.evaluate(() => window.__grawlixTest.windowedFlatDebug().richRowsConsumed);
}

async function mergedRichPass(page, pattern) {
  await runSearch(page, pattern);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settleWindow(page);
  expect(await skeletonCount(page)).toBe(0);
  // Non-vacuous: a fresh scroller (each search remounts one, zeroing the counter)
  // must consume rich rows, or a silent regression to index-only would still
  // match the local baseline.
  expect(await richRowsConsumed(page)).toBeGreaterThan(0);
  const top = await captureRows(page);
  expect(top.length).toBeGreaterThan(0);

  await page.evaluate(t => window.scrollTo(0, t), DEEP_TOP);
  await settleWindow(page);
  expect(await skeletonCount(page)).toBe(0);
  const deep = await captureRows(page);
  expect(deep[0].top).not.toBe(top[0].top);   // we actually scrolled
  return { top, deep };
}

async function assertScopeRoundTripKeepsMergedRich(page, pattern) {
  // syncWorkerConfig MUST run after the seeding snapshots, else ownedCorpusFresh is
  // already cleared and the rich assertions vacuously fall back to index-only.
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  const before = await mergedRichPass(page, pattern);

  await page.evaluate(() => window.__grawlixTest.setScope('Alpha'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setScope());   // back to All Wordlists
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  // The round-trip is the regression target: the old model left merged rich rows
  // permanently off after scoping back. They must STILL engage (mergedRichPass
  // asserts richRowsConsumed > 0) and render the same rows as before the round-trip.
  const after = await mergedRichPass(page, pattern);
  expect(after.top).toEqual(before.top);
  expect(after.deep).toEqual(before.deep);
}

test('merged rich rows survive a scope round-trip (plain rows)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertScopeRoundTripKeepsMergedRich(page, '');
});

test('merged rich rows survive a scope round-trip (highlighted search)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertScopeRoundTripKeepsMergedRich(page, '[aeiou]');
});
