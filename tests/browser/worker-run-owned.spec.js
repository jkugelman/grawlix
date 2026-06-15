import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// P1 oracle: a run whose ownedCorpus is fresh and scope-matched executes the
// pipeline against ownedCorpus, shipping indices into it. The rows render in
// norm.localeCompare order with their scores and Source column intact.
//
// Non-vacuity hinges on windowedFlatDebug().ranAgainstOwned being true: without it
// a regression that silently kept running the snapshot would still pass a render
// compare. workerSummariesDebug().hasWorkerStats proves the worker shipped stats.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const COUNT = 300;
// Past VS_BUFFER (60) so a deep scroll lands on a different window than the top.
const DEEP_TOP = 160 * 24;

const STEMS = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE', 'FROND', 'GRAPE', 'HOUSE', 'INLET', 'JOUST'];

// Two overlapping lists so the merge resolves a priority winner per entry; the
// scoped view (Alpha) then shows only Alpha's rows. Distinct, globally-sorted
// entries so the worker's order matches main's.
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

const debug = page => page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
const stats = page => page.evaluate(() => window.__grawlixTest.workerSummariesDebug());

async function assertRunAgainstOwned(page, pattern, syncScope) {
  await page.evaluate(s => window.__grawlixTest.syncWorkerConfig(s), syncScope);
  await runSearch(page, pattern);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  expect(await skeletonCount(page)).toBe(0);
  const topDbg = await debug(page);
  expect(topDbg.ranAgainstOwned).toBe(true);   // non-vacuous: the run used ownedCorpus
  const top = await captureRows(page);
  expect(top.length).toBeGreaterThan(0);
  expect((await stats(page)).hasWorkerStats).toBe(true);

  await page.evaluate(t => window.scrollTo(0, t), DEEP_TOP);
  await settle(page);
  expect(await skeletonCount(page)).toBe(0);
  const deep = await captureRows(page);
  expect(deep[0].top).not.toBe(top[0].top);   // we actually scrolled to a new window
}

test('merged run executes against ownedCorpus (plain rows)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  // gotoApp default scope is All Wordlists; syncWorkerConfig() derives MERGED from state.
  await assertRunAgainstOwned(page, '', undefined);
});

test('merged run executes against ownedCorpus (highlighted search)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await assertRunAgainstOwned(page, '[aeiou]', undefined);
});

// The run-corpus selection is scope-gated (useOwned requires ownedScope === scope),
// so prove it for a scoped view too. Scope FIRST then sync so the worker builds
// ownedCorpus for Alpha and sets ownedScope = Alpha's dbKey.
test('scoped run executes against ownedCorpus (plain rows)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.setScope('Alpha'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await assertRunAgainstOwned(page, '', undefined);
});

test('scoped run executes against ownedCorpus (highlighted search)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.setScope('Alpha'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await assertRunAgainstOwned(page, '[aeiou]', undefined);
});
