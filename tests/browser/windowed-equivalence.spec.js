const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Windowed flat-tier rendering guard: the worker serves windowed rows and main
// projects them through materializeFlatRow / _renderChainRow. The visible rows
// must engage windowing, render without skeletons, and stay self-consistent at
// every scroll position. A divergence here is a real rendering bug — do not weaken
// the assertions to make it pass.

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

async function setScoreRange(page, range) {
  await page.evaluate(r => {
    const input = document.querySelector('#score-range-input');
    input.value = r;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, range);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function assertFilteredWindowed(page, pattern, range) {
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await runSearch(page, pattern);
  await setScoreRange(page, range);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const dbg = await page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
  expect(dbg.scoreFilterActive).toBe(true);
  expect(dbg.winCacheSize).toBeGreaterThan(0);
  expect(await skeletonCount(page)).toBe(0);
  const top = await captureRows(page);
  expect(top.length).toBeGreaterThan(0);

  await page.evaluate(t => window.scrollTo(0, t), DEEP_TOP);
  await settle(page);
  expect(await skeletonCount(page)).toBe(0);
  const deep = await captureRows(page);
  expect(deep[0].top).not.toBe(top[0].top);   // we actually scrolled to a new window

  await setScoreRange(page, '');
  return { top, deep };
}

async function captureWindowed(page, pattern) {
  await runSearch(page, pattern);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const dbg = await page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
  expect(dbg.winCacheSize).toBeGreaterThan(0);   // the worker fetch actually populated the cache
  expect(await skeletonCount(page)).toBe(0);
  const top = await captureRows(page);
  expect(top.length).toBeGreaterThan(0);

  await page.evaluate(t => window.scrollTo(0, t), DEEP_TOP);
  await settle(page);
  expect(await skeletonCount(page)).toBe(0);
  const deep = await captureRows(page);
  expect(deep[0].top).not.toBe(top[0].top);   // we actually scrolled to a new window
  return { top, deep };
}

test('plain rows: windowed render produces sorted leading rows on All Wordlists', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  // All Wordlists scope (gotoApp default) renders the Source column into the text.
  const { top } = await captureWindowed(page, '');
  // Row text is prefixed by the row number ("1." etc.); the entry leads the rest.
  expect(top[0].text).toContain('ABLE000');
  const leading = top.slice(0, 5).map(r => r.text);
  expect([...leading].sort()).toEqual(leading);
});

test('highlighted search: windowed render projects a <mark> into every leading row', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  const { top } = await captureWindowed(page, 'A');
  for (const row of top.slice(0, 5)) expect(row.marks.length).toBeGreaterThan(0);
});

// Score-range scores span 10..59; '15-50' cuts a meaningful chunk off both ends
// while leaving enough rows to scroll DEEP_TOP (row 160) into.
test('filtered plain rows: worker-filtered windowed render stays engaged', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertFilteredWindowed(page, '', '15-50');
});

test('filtered highlighted search: worker-filtered windowed render stays engaged', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertFilteredWindowed(page, '[aeiou]', '15-50');
});

test('mid-typing unparseable range shows all rows, not an empty filter', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await runSearch(page, '');
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const unfiltered = await captureRows(page);
  expect(unfiltered.length).toBeGreaterThan(0);

  await setScoreRange(page, '15-');
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const dbg = await page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
  expect(dbg.scoreFilterActive).toBe(false);   // main parseRange('15-') === null
  expect(await captureRows(page)).toEqual(unfiltered);

  await setScoreRange(page, '');
});
