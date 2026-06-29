import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Regression guard for the click-during-streaming bug. A wholesale clear-and-rebuild
// swaps a row's node out between a click's mousedown and mouseup while snapshots stream,
// so the click fires on the bare sizer and silently opens nothing. Pinning that an
// unchanged row keeps its exact node across a re-render locks the reconciliation in
// place — for the flat tier and the tuple tier (shared _render, separate caches).

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// A capture-mode window scroll is how the scroller is driven to re-render; dispatching
// one with the position unchanged exercises _render without changing any row's content.
async function rerenderOutcome(page, rowSelector) {
  return page.evaluate((sel) => {
    const before = document.querySelector(sel);
    if (!before) return 'no-row';
    window.dispatchEvent(new Event('scroll'));
    const after = document.querySelector(sel);
    return after === before ? 'reused' : 'rebuilt';
  }, rowSelector);
}

test('the flat tier reuses an unchanged row node across a re-render', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Flat',
    entries: Array.from({ length: 60 }, (_, i) => 'word' + String(i).padStart(3, '0')),
    scores: Array.from({ length: 60 }, (_, i) => 10 + i),
  }));
  await page.evaluate(() => window.__grawlixTest.setScope('Flat'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#vs-host .entry-row').first()).toBeVisible();

  expect(await rerenderOutcome(page, '#vs-host .entry-row')).toBe('reused');
});

test('the tuple tier reuses an unchanged row node across a re-render', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const A = 'abcdefg', entries = [], scores = [];
    for (const a of A) for (const b of A) for (const c of A) for (const d of A) {
      entries.push(a + b + c + d);
      scores.push(10 + (entries.length % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Quads', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.setScope('Quads'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { patterns: 'AB;BA' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#vs-host .group-row').first()).toBeVisible();

  expect(await rerenderOutcome(page, '#vs-host .group-row')).toBe('reused');
});
