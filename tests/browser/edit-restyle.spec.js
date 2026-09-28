import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// A respelling that keeps its norm (spacing, case, punctuation) patches the displayed
// Search-only result in place, like a score edit: the worker swaps the new rows into
// their slots and main reprojects, so the runId holds and the page doesn't re-stream.
// Only when no row's Search verdict flips — else the edit re-runs. See restyleKeepsResult.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function seed(page, editsText, stack) {
  await page.evaluate(async ({ editsText, stack }) => {
    const T = window.__grawlixTest;
    await T.reimport('My Edits', editsText);
    await T.flushEditsToIdb();
    await T.syncWorkerConfig();
    await T.setStack(stack);
    await T.pipelineIdle();
  }, { editsText, stack });
}

// Worker replies arrive in order, so a round-trip after the rename lands behind its
// editAck (whose handler dispatches the refresh) and one after pipelineIdle lands
// behind a reproject. Polling rows instead can settle early: a same-position replace
// shows the new spelling through the OLD run before its re-run lands.
async function renameAndSettle(page, orig, raw) {
  return page.evaluate(async ({ orig, raw }) => {
    const T = window.__grawlixTest;
    const priorRunId = T.lastCompletedRunId();
    await T.renameFrom(orig, raw);
    await T.dumpWorkerCorpus('__merged__');
    await T.pipelineIdle();
    await T.dumpWorkerCorpus('__merged__');
    const reply = await T.fetchWorkerRows(0, 1e9);
    return { reran: T.lastCompletedRunId() !== priorRunId, displays: reply.rows.map(r => r.display ?? r.norm) };
  }, { orig, raw });
}

test('a respelling under a plain search reprojects and keeps the page scroll', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const entries = [], scores = [];
    for (let i = 0; i < 20000; i++) { entries.push('W' + String(i).padStart(5, '0')); scores.push(50); }
    await window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
  });
  await seed(page, 'W19990;50', [{ tool: 'search', params: { pattern: 'W*' } }]);

  const before = await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.scrollY;
  });
  const out = await renameAndSettle(page, { norm: 'w19990', display: 'W19990' }, 'W-19990');
  const after = await page.evaluate(() => window.scrollY);

  expect(before).toBeGreaterThan(0);
  expect(out.reran).toBe(false);
  expect(out.displays).toContain('W-19990');
  expect(out.displays).not.toContain('W19990');
  expect(after).toBe(before);
});

test('a whole-word search whose verdict holds reprojects the respelling', async ({ page }) => {
  await gotoApp(page);
  await seed(page, 'you know me;50\nknow;50', [{ tool: 'search', params: { pattern: 'know', mode: 'word' } }]);
  const out = await renameAndSettle(page, { norm: 'youknowme', display: 'you know me' }, 'You Know Me!');
  expect(out.reran).toBe(false);
  expect(out.displays).toContain('You Know Me!');
});

test('a respelling reprojects when another list carries the bare spelling', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Foreign', entries: ['dontyoudare', 'know'], scores: [60, 40] }));
  await seed(page, 'dontyoudare;50', [{ tool: 'search', params: { pattern: 'dontyou' } }]);
  const out = await renameAndSettle(page, { norm: 'dontyoudare', display: null }, "Don't You Dare");
  expect(out.reran).toBe(false);
  expect(out.displays).toEqual(["Don't You Dare"]);
});

test('a respelling that changes family reprojects into the order a fresh run gives', async ({ page }) => {
  await gotoApp(page);
  await seed(page, 'beatle;50\nbeatles;50\nbeatnik;50\nthebeatles;50', [{ tool: 'search', params: { pattern: 'beat' } }]);
  const before = await page.evaluate(async () => (await window.__grawlixTest.fetchWorkerRows(0, 1e9)).rows.map(r => r.display ?? r.norm));
  const out = await renameAndSettle(page, { norm: 'thebeatles', display: null }, 'The Beatles');
  const fresh = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.refreshScroller();
    return (await T.fetchWorkerRows(0, 1e9)).rows.map(r => r.display ?? r.norm);
  });
  expect(before).toEqual(['beatle', 'beatles', 'beatnik', 'thebeatles']);
  expect(out.reran).toBe(false);
  expect(out.displays).toEqual(['beatle', 'beatles', 'The Beatles', 'beatnik']);
  expect(out.displays).toEqual(fresh);
});

test('a respelling that flips the whole-word verdict re-runs, both ways', async ({ page }) => {
  await gotoApp(page);
  await seed(page, 'you knowme;50\nknow;50', [{ tool: 'search', params: { pattern: 'know', mode: 'word' } }]);

  const joins = await renameAndSettle(page, { norm: 'youknowme', display: 'you knowme' }, 'you know me');
  expect(joins.reran).toBe(true);
  expect(joins.displays).toContain('you know me');

  const leaves = await renameAndSettle(page, { norm: 'youknowme', display: 'you know me' }, 'you knowme');
  expect(leaves.reran).toBe(true);
  expect(leaves.displays).not.toContain('you knowme');
  expect(leaves.displays).not.toContain('you know me');
});

test('a respelling under a non-Search tool re-runs', async ({ page }) => {
  await gotoApp(page);
  await seed(page, 'you know me;50\nknow;50', [{ tool: 'regex', params: { pattern: 'know' } }]);
  const out = await renameAndSettle(page, { norm: 'youknowme', display: 'you know me' }, 'You Know Me!');
  expect(out.reran).toBe(true);
  expect(out.displays).toContain('You Know Me!');
});
