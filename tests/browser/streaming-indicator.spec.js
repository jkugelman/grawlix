import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The VISUAL TREATMENT of streaming, driven deterministically. While a flat scan
// streams survivors the entries panel suppresses the stale-results dim/ring (it
// gains .pipeline-streaming), the stats bar grows three "still finding" dots, and
// the whole bar — count, Min/Max, histogram — tracks the streamed-so-far set rather
// than going stale or waiting for completion. The terminal result clears all of it.
//
// Rather than race a real slow scan (fragile + slow), this feeds synthetic
// `partial`-shaped batches straight into the live scroller via streamSyntheticBatch
// and steps frame by frame, so every assertion is on a known state. Structure and
// class membership only — no computed-style assertions (CSS is verified by eye);
// the distribution-hidden regression is checked by the ABSENCE of the overflow
// classes that would hide it, not by reading `display`. See streaming-render.spec.js
// for the worker-side mechanism and width-hints.test.js for the no-jump invariant.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Read off the live DOM: panel state + the stats-bar readouts. Returns the dots
// element so the caller can assert NODE IDENTITY across batches (a rebuilt node
// restarts the CSS animation — the bug this guards).
const READ_STATE = `() => {
  const panel = document.getElementById('entries-table-panel');
  const bar = document.querySelector('#stats .stats-bar');
  const val = sel => bar?.querySelector(sel)?.querySelector('.stat-value')?.textContent.trim() ?? null;
  const far = [...(bar?.querySelectorAll('.stats-bar-numbers .stat-far') ?? [])];
  const histBars = bar ? [...bar.querySelectorAll('.histogram-bar')].filter(b => parseFloat(b.style.height) > 0).length : 0;
  return {
    dotsEl: bar?.querySelector('.stream-dots') ?? null,
    streaming: !!panel?.classList.contains('pipeline-streaming'),
    barClass: bar?.className ?? null,
    count: val('.stat-entries') ?? val('.stats-bar-counts .stat'),
    min: far[0]?.querySelector('.stat-value')?.textContent.trim() ?? null,
    max: far[1]?.querySelector('.stat-value')?.textContent.trim() ?? null,
    histBars,
  };
}`;

test('the panel marks streaming and the stats bar tracks the streamed-so-far set, then the terminal result clears it', async ({ page }) => {
  await gotoApp(page);

  const result = await page.evaluate(async (readSrc) => {
    const T = window.__grawlixTest;
    const read = new Function('return (' + readSrc + ')()');
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // A real corpus for the terminal settle (the synthetic stream needs no corpus).
    // Its score span (10..69) sets the histogram layout the synthetic scores bucket
    // into — out-of-range synthetic scores would land in no bucket and show no bars.
    await T.addCustomWordlist({ name: 'Settle', entries: ['ZEBRA', 'ZIGZAG', 'ZILCH'], scores: [10, 40, 69] });
    await T.pipelineIdle();

    const rows = (lo, hi, stem, score) =>
      Array.from({ length: hi - lo }, (_, k) => ({ norm: stem + (lo + k), display: stem + (lo + k), score, atoms: [{}] }));

    T.streamSyntheticBatch({
      runId: 'syn', version: 1, total: 10,
      scores: Array(10).fill(10),
      firstRows: rows(0, 10, 'SHORT', 10),
      widthHints: { maxDisplayLen: 6, maxLenDigits: 1, maxScoreDigits: 2, maxRawDigits: 0 },
    });
    await frame();
    const b1 = read();

    // Cumulative snapshot: the 10 score-10 survivors plus 10 new score-69 ones.
    T.streamSyntheticBatch({
      runId: 'syn', version: 2, total: 20,
      scores: [...Array(10).fill(10), ...Array(10).fill(69)],
      firstRows: rows(10, 20, 'WIDE', 69),
      widthHints: { maxDisplayLen: 6, maxLenDigits: 1, maxScoreDigits: 2, maxRawDigits: 0 },
    });
    await frame();
    const b2 = read();

    const sameDotsNode = !!b1.dotsEl && b1.dotsEl === b2.dotsEl;

    // Terminal result: a real fast search settles the run through _ingestResult.
    await T.setStack([{ tool: 'search', params: { pattern: 'Z*' } }]);
    await T.pipelineIdle();
    await frame();
    const settled = read();

    const strip = s => ({ ...s, dotsEl: undefined, dots: !!s.dotsEl });
    return { b1: strip(b1), b2: strip(b2), settled: strip(settled), sameDotsNode };
  }, READ_STATE);

  const num = c => (c == null ? 0 : parseInt(c.replace(/[^\d]/g, ''), 10) || 0);

  expect(result.b1.streaming).toBe(true);
  expect(result.b1.dots).toBe(true);
  expect(num(result.b1.count)).toBe(10);
  expect(result.b1.min).toBe('10');
  expect(result.b1.max).toBe('10');
  expect(result.b1.histBars).toBe(1);
  // The distribution stays visible: the overflow logic never hides it on a normal
  // viewport, so the bar must NOT carry the classes that would (regression guard for
  // the dots disrupting the stats-bar grid).
  expect(result.b1.barClass).not.toContain('stats-no-hist');
  expect(result.b1.barClass).not.toContain('stats-narrow');

  expect(result.b2.streaming).toBe(true);
  expect(result.b2.dots).toBe(true);
  expect(num(result.b2.count)).toBe(20);
  expect(result.b2.min).toBe('10');
  expect(result.b2.max).toBe('69');                 // Max tracked the stream, not stale/final-only
  expect(result.b2.histBars).toBeGreaterThan(result.b1.histBars);   // a bucket filled in live
  expect(result.b2.barClass).not.toContain('stats-no-hist');

  // The dots are ONE persistent node across batches — a rebuilt node would restart
  // the CSS animation every frame and freeze it.
  expect(result.sameDotsNode).toBe(true);

  expect(result.settled.streaming).toBe(false);
  expect(result.settled.dots).toBe(false);
  expect(num(result.settled.count)).toBe(3);
});
