import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp, expectVisible, awaitSettle } from './helpers.js';

// The stats-bar length filter. Its semantics are lane-kind dependent — see
// executor.js chainPredicate and design.md § Length filter — so each tier gets its
// own case here; the tuple case is the one where the control goes inert.

const SEED = {
  name: 'Src',
  entries: ['cat', 'cats', 'scat', 'scats', 'catnip', 'scatter'],
  scores: [50, 50, 50, 50, 50, 50],
};

async function seed(page) {
  await page.evaluate(s => window.__grawlixTest.addCustomWordlist(s), SEED);
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
}

async function setLength(page, value) {
  await page.locator('#length-range-input').fill(value);
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
}

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('a length filter narrows the flat view to matching entries', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await setLength(page, '4');
  await expectVisible(page, ['cats', 'scat']);
});

test('a length range keeps every entry inside it', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await setLength(page, '3-4');
  await expectVisible(page, ['cat', 'cats', 'scat']);
});

test('an open-ended length keeps everything at or above it', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await setLength(page, '6+');
  await expectVisible(page, ['catnip', 'scatter']);
});

test('clearing the length filter restores the full view', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await setLength(page, '4');
  await expectVisible(page, ['cats', 'scat']);
  await page.locator('.length-range-label .clear-btn').click();
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
  await expectVisible(page, SEED.entries);
});

test('an unparseable length reads as no filter and marks the field invalid', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await setLength(page, 'wat');
  await expect(page.locator('#length-range-input')).toHaveClass(/invalid/);
  await expectVisible(page, SEED.entries);
});

// ─── URL ─────────────────────────────────────────────────────────────────────

test('the length filter round-trips through the URL', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await setLength(page, '4');
  await expect(page).toHaveURL(/[?&]length=4/);
  await reloadApp(page);
  await expect(page.locator('#length-range-input')).toHaveValue('4');
  await expectVisible(page, ['cats', 'scat']);
});

test('length leads the query, ahead of the tool rows', async ({ page }) => {
  await gotoApp(page, '/?length=4');
  await seed(page);
  // Through the real search bar: the test API's setStack doesn't navigate, so it
  // would assert against a URL the Router never rebuilt.
  await page.locator('.search-bar input[data-key="pattern"]').fill('c*');
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
  const query = new URL(page.url()).search;
  expect(query).toContain('search=');
  expect(query.indexOf('length=')).toBeLessThan(query.indexOf('search='));
});

test('a deep-linked length filter applies on boot', async ({ page }) => {
  await gotoApp(page, '/?length=6');
  await seed(page);
  await expectVisible(page, ['catnip']);
});

// ─── Chain tier: length judges the tool's OUTPUT ─────────────────────────────
//
// The rule that makes the filter usable at all with a length-changing tool. Under
// score's every-atom rule these would return nothing, because the seed can't share
// the output's length.

test('a chain row is judged on its last atom, not its seed', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  // Head off "s": scat (4) → cat (3), scats (5) → cats (4), scatter (7) → catter (6).
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'head_off', params: { string: 's' } }]));
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
  await setLength(page, '3');
  await expectVisible(page, ['cat']);   // from the 4-letter seed `scat`
});

// ─── Tuple tier: the control goes inert ──────────────────────────────────────

test('a tuple result disables the length control but keeps its value', async ({ page }) => {
  await gotoApp(page, '/?length=4');
  await seed(page);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { query: 'AB;BA' } }]));
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());

  const input = page.locator('#length-range-input');
  await expect(input).toBeDisabled();
  await expect(input).toHaveValue('4');                       // kept, not blanked
  await expect(page.locator('.length-range-label')).toHaveClass(/length-range-off/);
  await expect(page).toHaveURL(/[?&]length=4/);               // and kept in the URL
});

test('a disabled length filter is inert, not just greyed', async ({ page }) => {
  // Same tuple stack with and without the param must produce the same result count;
  // a greyed control that still filtered would show up here and nowhere else.
  await gotoApp(page, '/?umiaq=AB%3BBA');
  await seed(page);
  const without = await readCount(page);

  await gotoApp(page, '/?length=4&umiaq=AB%3BBA');
  await seed(page);
  const with_ = await readCount(page);

  expect(without).toBeGreaterThan(0);   // else the comparison below proves nothing
  expect(with_).toBe(without);
});

test('dropping the tuple tool re-enables the filter and re-applies the kept value', async ({ page }) => {
  await gotoApp(page, '/?length=4');
  await seed(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { query: 'AB;BA' } }]));
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#length-range-input')).toBeDisabled();

  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#length-range-input')).toBeEnabled();
  await expect(page.locator('#length-range-input')).toHaveValue('4');
  await expectVisible(page, ['cats', 'scat']);
});

// ─── Histogram ───────────────────────────────────────────────────────────────
//
// The length filter narrows the histogram's source where the score range doesn't
// (worker-stats.spec.js pins the score half staying unfiltered). The two rules look
// like an inconsistency, so without this the "fix" is to make length stop narrowing.

test('the histogram bins only the length-matching entries', async ({ page }) => {
  await gotoApp(page);
  // Length and score correlate, so narrowing by length must empty a whole bucket.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hist',
    entries: ['cat', 'dog', 'crane', 'eagle'],
    scores: [50, 50, 90, 90],
  }));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());

  const counts = () => page.evaluate(() => window.__grawlixTest.workerSummariesDebug().workerHistogramCounts);
  const before = await counts();
  expect(before.reduce((a, b) => a + b, 0)).toBe(4);

  await setLength(page, '3');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = await counts();
  expect(after.reduce((a, b) => a + b, 0)).toBe(2);   // the two 5-letter/90-score entries left the bars
});

// ─── Stats bar ───────────────────────────────────────────────────────────────

test('focusing the length filter shows the length cheat sheet', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#length-range-input').focus();
  await expect(page.locator('.popup-help.open')).toContainText('exact length');
  await expect(page.locator('.popup-help.open')).toContainText('length range');
});

test('the length box sits after the score box in the stats bar', async ({ page }) => {
  await gotoApp(page);
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.stats-bar-distribution .range-filter')].map(e => e.querySelector('.stat-label').textContent));
  expect(order).toEqual(['Scores', 'Lengths']);
});

// The stats-bar count, not getVisibleEntries(): a tuple renders .group-row, not
// .entry-row, so the DOM-row read is 0 for every tuple regardless of the filter —
// which would make the inert-vs-greyed comparison pass without testing anything.
async function readCount(page) {
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
  const text = await page.locator('.stats-bar .stat-entries .stat-value').textContent();
  return Number(text.replace(/[^\d]/g, ''));
}
