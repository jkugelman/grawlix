import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// P4 oracle: a SCOPED view under a score filter stays worker-filtered + windowed.
// Two overlapping lists, scoped to ONE: a single-list corpus makes scoped == merged
// and silently proves nothing. The winCacheSize assertion is the proof windowing
// engaged under a scoped filter — weakening it makes the oracle vacuous.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const COUNT = 300;
// Well past VS_BUFFER (60) so the windowed path misses its top cache and re-fetches.
const DEEP_TOP = 160 * 24;

const STEMS = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE', 'FROND', 'GRAPE', 'HOUSE', 'INLET', 'JOUST'];

// Alpha scores span 10..59; Bravo's 200..249 sit out of any 10..59 filter, so the
// scoped Alpha view differs from merged and a leaked Bravo row would be obvious.
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
      html: r.innerHTML,
    })).sort((a, b) => parseFloat(a.top) - parseFloat(b.top));
  });
}

function captureStatsBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#stats .stats-bar');
    // The col's title encodes the bucket's count ("N entries scored …"), so
    // capturing it asserts the counts byte-for-byte, not just the bar-height ratio.
    const bars = [...bar.querySelectorAll('.histogram-col')].map(col => {
      const b = col.querySelector('.histogram-bar');
      return { lo: b.dataset.lo, hi: b.dataset.hi, height: b.style.height, title: col.title };
    });
    return { bars };
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

// syncWorkerConfig derives the build scope from state.selected, so scope FIRST then
// sync: the worker builds ownedCorpus for Alpha and sets ownedScope = Alpha's dbKey.
async function enterScopedMode(page) {
  await page.evaluate(() => window.__grawlixTest.setScope('Alpha'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

async function assertScopedFilteredWindowed(page, pattern, range) {
  await enterScopedMode(page);
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
}

// Alpha scores span 10..59; '15-50' cuts a meaningful chunk off both ends while
// leaving enough rows to scroll DEEP_TOP (row 160) into.
test('scoped filtered: worker-filtered windowed render stays engaged (plain rows)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertScopedFilteredWindowed(page, '', '15-50');
});

test('scoped filtered: worker-filtered windowed render stays engaged (highlighted search)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertScopedFilteredWindowed(page, '[aeiou]', '15-50');
});

// The score filter narrows ROWS + STATS but must NOT leak into the histogram: it
// stays the full scoped distribution so out-of-range bars remain clickable. The
// worker buckets BEFORE filtering, so the bars are identical with and without the
// filter active for the scoped view.
test('scoped filtered: the histogram stays the unfiltered scoped distribution', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await enterScopedMode(page);
  await runSearch(page, '');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const unfiltered = await captureStatsBar(page);
  expect(unfiltered.bars.length).toBeGreaterThan(0);

  await setScoreRange(page, '15-50');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const dbg = await page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
  expect(dbg.scoreFilterActive).toBe(true);
  expect(dbg.winCacheSize).toBeGreaterThan(0);   // P4: scoped+filter engages windowing
  const filtered = await captureStatsBar(page);

  // Histogram bars (ranges + heights + the count-bearing titles) are unchanged by
  // the filter: out-of-range bars survive, since the worker buckets before filtering.
  expect(filtered.bars).toEqual(unfiltered.bars);

  await setScoreRange(page, '');
});
