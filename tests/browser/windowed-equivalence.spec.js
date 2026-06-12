const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Equivalence guard for promoting windowed flat-tier rendering to the default:
// the local and windowed render paths share materializeFlatRow / _renderChainRow,
// so their visible rows must be identical at every scroll position. A divergence
// here is a real rendering bug — do not weaken the assertions to make it pass.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const COUNT = 300;
// Well past VS_BUFFER (60) so the windowed path misses its top cache and re-fetches.
const DEEP_TOP = 160 * 24;

const STEMS = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE', 'FROND', 'GRAPE', 'HOUSE', 'INLET', 'JOUST'];

async function seedCorpus(page) {
  await page.evaluate(({ count, stems }) => {
    const entries = [], scores = [], comments = [];
    for (let i = 0; i < count; i++) {
      // Distinct and globally sorted so the worker's order matches the local one.
      entries.push(stems[i % stems.length] + String(i).padStart(3, '0'));
      scores.push(10 + (i % 50));
      comments.push(i % 3 === 0 ? 'note' + i : '');
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Seq', entries, scores, comments });
  }, { count: COUNT, stems: STEMS });
}

async function runSearch(page, pattern) {
  await page.evaluate(p => window.__grawlixTest.setStack(
    p === '' ? [] : [{ tool: 'search', params: { pattern: p } }]), pattern);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function settle(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.__grawlixTest.windowIdle());
  // The fetch reply re-renders; let that paint land before reading the DOM.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
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
    })).sort((a, b) => parseFloat(a.top) - parseFloat(b.top));
  });
}

async function assertEquivalent(page, pattern) {
  // Windowed is the default now, so force it OFF for the local capture — else
  // this compares windowed-to-windowed and silently proves nothing.
  await page.evaluate(() => window.__grawlixTest.setWindowedFlatForTest(false));
  await runSearch(page, pattern);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  expect(await skeletonCount(page)).toBe(0);
  const localDbg = await page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
  expect(localDbg.wouldEngageWindowing).toBe(false);
  const localTop = await captureRows(page);
  expect(localTop.length).toBeGreaterThan(0);

  await page.evaluate(top => window.scrollTo(0, top), DEEP_TOP);
  await settle(page);
  const localDeep = await captureRows(page);
  expect(localDeep[0].top).not.toBe(localTop[0].top);   // we actually scrolled

  await page.evaluate(() => window.__grawlixTest.setWindowedFlatForTest(true));
  await runSearch(page, pattern);   // flag is read at render time — re-render to engage it
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  // Without this the test silently degrades to a vacuous local-vs-local compare
  // if windowed mode failed to engage — false confidence right before the flip.
  const dbg = await page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
  expect(dbg.wouldEngageWindowing).toBe(true);
  expect(dbg.winCacheSize).toBeGreaterThan(0);   // the worker fetch actually populated the cache
  expect(await skeletonCount(page)).toBe(0);
  const windowedTop = await captureRows(page);

  await page.evaluate(top => window.scrollTo(0, top), DEEP_TOP);
  await settle(page);
  expect(await skeletonCount(page)).toBe(0);
  const windowedDeep = await captureRows(page);

  expect(windowedTop).toEqual(localTop);
  expect(windowedDeep).toEqual(localDeep);

  await page.evaluate(() => window.__grawlixTest.setWindowedFlatForTest(false));
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__grawlixTest?.setWindowedFlatForTest(false)).catch(() => {});
});

test('plain rows: windowed render matches local on All Wordlists', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  // All Wordlists scope (gotoApp default) renders the Source column into the text.
  await assertEquivalent(page, '');
});

test('highlighted search: windowed render matches local with <mark> projection', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertEquivalent(page, '[aeiou]');
});
