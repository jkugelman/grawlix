import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, readVisible, addTool } from './helpers.js';

// The sibling of human-typing.spec.js: interactions that span several runs, or land in
// the middle of one, rather than a single settled run. Each test here covers a sequence
// the suite asserted only the endpoints of -- the stack's ORDER but not its rows, a
// settled view op but not one arriving mid-stream, a mid-stream fetch at the protocol
// level but never through the scroller a user actually scrolls.
//
// The forced 1ms yield is load-bearing in the two streaming tests: at the shipped 30ms
// budget this corpus finishes in one batch, so the interaction would land after the run
// instead of during it and the test would quietly assert nothing. Both check they
// really caught the run mid-flight rather than trusting the timing.

const FILLER = 12000;
const AFFIX = ['BAK', 'BAKE', 'BAKED'];

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function seed(page) {
  await page.evaluate(async ({ affix, filler }) => {
    const entries = [...affix], scores = affix.map(() => 50);
    for (let i = 0; i < filler; i++) { entries.push('W' + String(i).padStart(5, '0')); scores.push(10 + (i % 60)); }
    await window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
    await window.__grawlixTest.syncWorkerConfig();
  }, { affix: AFFIX, filler: FILLER });
}

const settle = page => page.evaluate(() => window.__grawlixTest.pipelineIdle());

test('a stack built one tool at a time lands where the same stack applied at once does', async ({ page }) => {
  await gotoApp(page);
  await seed(page);

  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'back_off', params: { pattern: 'ed' } },
    { tool: 'search', params: { pattern: 'bak' } },
  ]));
  await settle(page);
  const atOnce = await readVisible(page);
  expect(atOnce.length).toBeGreaterThan(0);

  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await settle(page);

  const params = page.locator('.tool-row input[data-key="pattern"]');
  await addTool(page, 'back_off');
  await params.nth(0).fill('ed');
  await settle(page);
  await addTool(page, 'search');
  await params.nth(1).fill('bak');

  await expect.poll(() => readVisible(page)).toEqual(atOnce);
});

test('a sort change landing mid-stream reprojects the run instead of restarting it', async ({ page }) => {
  await gotoApp(page);
  await seed(page);

  const out = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(1);
    const cap = T.captureWorkerPartialsForTest();
    const started = T.setStack([{ tool: 'search', params: { pattern: 'W*' } }]);

    let streamRunId = null;
    for (let i = 0; i < 4000 && streamRunId == null; i++) {
      const p = cap.peek();
      if (p.length) streamRunId = p[0].runId; else await new Promise(r => setTimeout(r, 1));
    }
    const streamingAtChange = !!document.querySelector('#entries-table-panel.pipeline-streaming');
    T.applySort('score', 'desc');

    await started;
    await T.pipelineIdle();
    const partialRunIds = [...new Set(cap.stop().map(p => p.runId))];
    T.setWorkerYieldIntervalForTest(30);
    const finalRunId = T.lastCompletedRunId();
    const reply = await T.fetchWorkerRows(0, 12, finalRunId);
    return { streamRunId, finalRunId, streamingAtChange, partialRunIds, top: reply.rows.map(r => r.score) };
  });

  expect(out.streamRunId).not.toBeNull();
  expect(out.streamingAtChange).toBe(true);
  expect(out.partialRunIds).toEqual([out.streamRunId]);
  expect(out.finalRunId).toBe(out.streamRunId);
  expect(out.top).toEqual([...out.top].sort((a, b) => b - a));
});

test('scrolling mid-stream paints real rows, and the run still settles correctly', async ({ page }) => {
  await gotoApp(page);
  await seed(page);

  const out = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    // Read the DOM directly: getVisibleEntries awaits pipelineIdle, so mid-stream it
    // blocks until the run settles and hands back the SETTLED view -- this test would
    // pass while never once looking at the screen during a stream.
    const rowsNow = () => [...document.querySelectorAll('#vs-host .entry-row')]
      .map(r => (r.querySelector('.atom-entry')?.textContent ?? '').trim())
      .filter(Boolean);

    T.setWorkerYieldIntervalForTest(1);
    const run = (async () => {
      await T.setStack([{ tool: 'search', params: { pattern: 'W*' } }]);
      await T.pipelineIdle();
    })();

    let mid = null, countAtScroll = 0;
    for (let i = 0; i < 8000 && !mid; i++) {
      const count = T.scrollerRowCount();
      if (count > 600) {
        countAtScroll = count;
        window.scrollTo(0, 300 * 24);
        await T.windowIdle();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rows = rowsNow();
        if (rows.length) mid = rows;
      }
      if (!mid) await new Promise(r => setTimeout(r, 0));
    }

    await run;
    T.setWorkerYieldIntervalForTest(30);
    return { mid, countAtScroll, settled: T.scrollerRowCount() };
  });

  expect(out.mid).not.toBeNull();
  expect(out.countAtScroll).toBeLessThan(FILLER);
  expect(out.mid.length).toBeGreaterThan(0);
  for (const row of out.mid) expect(row).toMatch(/^w\d{5}$/i);
  expect(new Set(out.mid).size).toBe(out.mid.length);
  expect(out.settled).toBe(FILLER);
});
