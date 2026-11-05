import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Engine paths only a tool shape no shipped tool has can reach, driven by the
// test-only tools in engine/fixture-tools.js.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function seed(page, entries) {
  await page.evaluate(() => window.__grawlixTest.installFixtureTools());
  await page.evaluate(e => window.__grawlixTest.addCustomWordlist({ name: 'Fixture', entries: e, scores: e.map(() => 50) }), entries);
  await page.evaluate(() => window.__grawlixTest.setScope('Fixture'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function renderedRows(page, stack) {
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => [...document.querySelectorAll('#vs-host .entry-row:not(.skeleton)')]
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    .map(r => ({ text: r.textContent.trim(), marks: [...r.querySelectorAll('mark')].map(m => m.textContent) })));
}

// A hidden-input transform's rows are lone corpus atoms, which look flat. A filter
// after it gives the stream plan no tier, so the run doesn't stream and the result
// tier must still come from the stack: the flat tier re-derives marks by replaying
// the stack's filters, dropping the transform's own marks.
test('a hidden-input transform keeps its own marks when it does not stream', async ({ page }) => {
  await gotoApp(page);
  await seed(page, ['apple', 'zzapple', 'pear']);

  const rows = await renderedRows(page, [{ tool: 'late_twin', params: { mark: '1' } }, { tool: 'search', params: { pattern: '*e*' } }]);
  expect(rows.map(r => r.marks)).toEqual([['a', 'e'], ['p', 'e']]);
});
