import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// P9 oracle: when a new pipeline result lands while the edit panel is open, the
// table RE-ANCHORS the panel to its entry's row (EntriesScroller.updateEntries →
// EntryPanel.rebindEntry → scroller.findResultEntry / resultHasEntry). The worker
// resolves the open panel's target against its owned corpus and ships the answer
// ON the run's result (rebindQuery/rebindEntry/rebindExists), mirroring
// existsInScope — including for an entry filtered OUT of the visible view (the
// worker's full-corpus byKey→byNorm lookup re-anchors to it anyway).
//
// Non-vacuity hinges on rebindAnswersConsumedDebug() advancing — without it a
// regression that silently stopped consuming the worker's answer would still pass.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const sync = page => page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
const rebindConsumed = page =>
  page.evaluate(() => window.__grawlixTest.rebindAnswersConsumedDebug());
const resetRebindConsumed = page =>
  page.evaluate(() => window.__grawlixTest.resetRebindAnswersConsumedForTest());

// Alpha > Bravo by priority. CRANE is Alpha-only (high), EAGLE is Alpha-only (mid),
// GRAPE Alpha-only (low). OVER is in both (Alpha wins). The score spread feeds the
// score-range-filter case (filter EAGLE out of view but keep it in the full corpus).
async function seedCorpus(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha',
    entries: ['CRANE', 'EAGLE', 'GRAPE', 'OVER'],
    scores: [90, 50, 20, 70],
    comments: ['big bird', 'raptor', 'fruit', 'finished'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo',
    entries: ['OVER', 'BIRD'],
    scores: [40, 30],
  }));
}

// Drive the REAL search-bar input (not setStack, which recreates the scroller and
// closes the panel). Typing here re-runs via refreshMergedScroller → updateEntries
// → rebindEntry, the path that keeps the panel open and re-anchors it.
async function setSearch(page, pattern) {
  await page.locator('.search-bar input[data-key="pattern"]').fill(pattern);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function setScoreRange(page, range) {
  await page.evaluate(r => {
    const input = document.querySelector('#score-range-input');
    input.value = r;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, range);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function openPanelOnEntry(page, entryText, field = 'score') {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await expect(row).toBeVisible();
  // A neutral click first clears any lingering capture-phase document listener and
  // moves focus off the search input. Without it, a real (Playwright) mousedown
  // after a prior open → search → Escape choreography intermittently fails to
  // re-open the panel — a test-harness quirk, not the behavior under test.
  await page.mouse.click(5, 5);
  // These tests run in All Wordlists, where the score cell opens the quick picker;
  // the panel opens from the entry cell in any scope, so default there.
  const cell = field === 'comment' ? '.atom-comment' : '.atom-entry';
  await row.locator(cell).click();
  await expect(page.locator('#entry-panel')).toBeVisible();
}

async function closePanel(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#entry-panel')).toBeHidden();
}

// Everything the re-bind must reproduce: the panel is visible, anchored to the
// same norm (via the seed/inputs), with byte-identical fields, footer, provenance.
function captureRebound(page) {
  return page.evaluate(() => ({
    visible: !document.querySelector('#entry-panel')?.hasAttribute('hidden'),
    entry: document.querySelector('#entry-panel-entry')?.value ?? null,
    score: document.querySelector('#entry-panel-score')?.value ?? null,
    comment: document.querySelector('#entry-panel-comment')?.value ?? null,
    foot: document.querySelector('#entry-panel .entry-panel-foot')?.innerHTML ?? '',
    prov: document.querySelector('#entry-panel .entry-panel-prov-wrap')?.innerHTML ?? '',
  }));
}

async function syncWorker(page) {
  await sync(page);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// ─── Case 1: entry still present after the re-run → re-binds to it ────────────
test('re-binds to an entry still present after the re-run', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await syncWorker(page);

  // Open on CRANE, then narrow the search to a pattern CRANE still matches ('R') —
  // the result changes (rows drop) but CRANE survives, so the panel re-anchors.
  await openPanelOnEntry(page, 'CRANE');
  await resetRebindConsumed(page);
  await setSearch(page, 'R');
  const reb = await captureRebound(page);
  expect(reb.visible).toBe(true);
  expect(reb.entry).toBe('CRANE');
  expect(await rebindConsumed(page)).toBeGreaterThan(0);   // non-vacuous: worker path taken
  await closePanel(page);
});

// ─── Case 2: filtered OUT of the visible view but present in the FULL corpus ──
// This is the case the worker's byKey→byNorm FULL-corpus resolution exists for:
// a score-range filter hides EAGLE from the rendered rows, yet the panel must
// still re-anchor to it (full-corpus lookup), not fall to the !found path.
test('re-binds to an entry filtered OUT of the visible view (full-corpus lookup)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await syncWorker(page);

  await openPanelOnEntry(page, 'EAGLE');
  await resetRebindConsumed(page);
  // EAGLE scores 50; filter to 80+ so it leaves the visible view but stays in the
  // full corpus. The re-bind's full-corpus lookup must still find it.
  await setScoreRange(page, '80+');
  const reb = await captureRebound(page);
  expect(reb.visible).toBe(true);
  expect(reb.entry).toBe('EAGLE');
  expect(reb.score).toBe('50');
  expect(await rebindConsumed(page)).toBeGreaterThan(0);
  // Sanity: EAGLE is genuinely filtered out of the rendered rows.
  await expect(page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: /^EAGLE$/ }),
  })).toHaveCount(0);
  await closePanel(page);
  await setScoreRange(page, '');
});

// ─── Case 3: entry no longer present (the !found path) ────────────────────────
// The panel stays as it was (no re-render): with a score search that excludes
// the open entry from BOTH the view and the corpus, the re-bind finds nothing and
// rebindEntry's !found branch leaves it be.
test('entry no longer present after a re-run (the !found path) holds the panel', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // Scope to My Edits and add GULL there, so a re-run that drops GULL from the
  // result (search that excludes it) leaves it genuinely absent from the merged
  // result — the !found path. Captured via the panel staying put.
  await page.evaluate(() => window.__grawlixTest.reimport('My Edits', ['GULL;60;seabird'].join('\n')));
  await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  await syncWorker(page);

  await openPanelOnEntry(page, 'GULL');
  // 'CRANE' literal search → GULL is not in the result at all; the panel holds.
  await setSearch(page, 'CRANE');
  const reb = await captureRebound(page);
  expect(reb.visible).toBe(true);
  expect(reb.entry).toBe('GULL');   // unchanged: !found left it in place
  await closePanel(page);
  await setSearch(page, '');
});

// ─── Case 4: the save path resolves the right target ──────────────────────────
// Open the panel, type a new score, save; the edit's target (resolved from the
// panel's seed) must land in the merged corpus.
test('the save path resolves the right target', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.reimport('My Edits', ['GULL;60;seabird'].join('\n')));
  await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  await syncWorker(page);

  await openPanelOnEntry(page, 'OVER');
  await page.locator('#entry-panel-score').fill('15');
  await page.locator('#entry-panel .entry-panel-save').click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#entry-panel')).toBeHidden();

  const merged = await page.evaluate(() => window.__grawlixTest.dumpMainCorpus('__merged__'));
  const over = merged.find(e => e[0] === 'over');
  expect(over).toBeTruthy();
  expect(over[2]).toBe(15);
});
