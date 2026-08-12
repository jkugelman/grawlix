import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, readVisible, addTool } from './helpers.js';

// Typing is a SEQUENCE of superseding runs; setStack and fill() are one run each, so a
// suite built on them cannot see a run inherit state from the run it replaced. That is
// a whole interaction mode, not one bug: anything the worker retains between runs (the
// anchor map, the retained join, a stashed partial) is reachable only from here.
//
// Two things make the sequence observable and both are load-bearing. A family, because
// the per-run state a keystroke can corrupt is keyed by family -- with unrelated
// entries every run rebuilds from nothing and the tests pass against any build. And a
// forced 1ms yield, because these runs must take the STREAMING path; on a corpus this
// small the shipped 30ms budget finishes in one batch and silently exercises the
// buffered path instead, which is not the path a real user's corpus takes.
const FAMILY = ['keeping it in-house', 'keep it in-house', 'keeps it in-house', 'kept it in-house'];
const QUERY = 'itinhouse';

// Spread across the score range the filter test types, so that filter admits SOME of
// the family. Give them one score and it admits all four or none, and the typed and
// pasted results match no matter what the reproject did.
const FAMILY_SCORES = [20, 40, 50, 60];

// Back off pairs an entry with itself minus a matching tail, so these three give that
// tool a different result per keystroke of "ed": BAKE loses "e" to BAK, BAKED loses
// "ed" to the same. Without the shared BAK stem neither keystroke yields a row.
const AFFIX = ['BAK', 'BAKE', 'BAKED'];

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function seed(page) {
  await page.evaluate(async ({ family, familyScores, affix }) => {
    const entries = [...family, ...affix], scores = [...familyScores, ...affix.map(() => 50)];
    for (let i = 0; i < 12000; i++) { entries.push('W' + String(i).padStart(5, '0')); scores.push(10 + (i % 60)); }
    await window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
    await window.__grawlixTest.syncWorkerConfig();
    window.__grawlixTest.setWorkerYieldIntervalForTest(1);
  }, { family: FAMILY, familyScores: FAMILY_SCORES, affix: AFFIX });
}

const searchInput = page => page.locator('.search-bar input[data-key="pattern"]');

async function settle(page) {
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

test('a query typed one character at a time lands where the same query pasted does', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  const input = searchInput(page);

  await input.fill(QUERY);
  await expect.poll(async () => (await readVisible(page)).length).toBe(FAMILY.length);
  const pasted = await readVisible(page);

  await input.fill('');
  await expect.poll(async () => (await readVisible(page)).length).toBeGreaterThan(FAMILY.length);

  await input.pressSequentially(QUERY, { delay: 30 });
  await expect.poll(() => readVisible(page)).toEqual(pasted);
});

test('no keystroke leaves a duplicated row behind', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  const input = searchInput(page);
  await page.evaluate(() => { window.__typingCapture = window.__grawlixTest.captureWorkerPartialsForTest(); });

  let typed = '';
  for (const ch of QUERY) {
    await input.pressSequentially(ch);
    typed += ch;
    await settle(page);
    // Polled, not read once: a raw read can catch the scroller mid-repaint holding one
    // row from each of two snapshots, which reads as a duplicate that was never on
    // screen. Poll to a settle and a real duplicate still fails -- it never clears.
    await expect.poll(async () => {
      const rows = (await readVisible(page)).filter(Boolean);
      return rows.length - new Set(rows).size;
    }, { message: `duplicate row after typing "${typed}"` }).toBe(0);
  }

  const streamed = await page.evaluate(() => window.__typingCapture.stop().length);
  expect(streamed, 'the runs never streamed, so this no longer covers the streaming path').toBeGreaterThan(0);
});

test('backspacing to a prefix lands where that prefix typed fresh does', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  const input = searchInput(page);
  const PREFIX = QUERY.slice(0, -4);

  await input.fill(PREFIX);
  await expect.poll(async () => (await readVisible(page)).length).toBe(FAMILY.length);
  const fresh = await readVisible(page);

  await input.fill(QUERY);
  await settle(page);
  for (let i = 0; i < 4; i++) {
    await input.press('Backspace');
    await settle(page);
  }
  await expect.poll(() => readVisible(page)).toEqual(fresh);
});

// The same sequence with no settle between keys, so most runs are superseded in flight
// rather than completing -- the abort/stash path, which retains different state than a
// run that finishes.
test('typing faster than the pipeline settles still converges', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  const input = searchInput(page);

  await input.fill(QUERY);
  await expect.poll(async () => (await readVisible(page)).length).toBe(FAMILY.length);
  const pasted = await readVisible(page);

  await input.fill('');
  await expect.poll(async () => (await readVisible(page)).length).toBeGreaterThan(FAMILY.length);

  await input.pressSequentially(QUERY);
  await expect.poll(() => readVisible(page)).toEqual(pasted);
});

// The score box reprojects the retained result rather than re-running it, so its
// keystroke sequence exercises a different path than the search box's.
test('a score range typed one character at a time lands where the same range pasted does', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  const range = page.locator('#score-range-input');

  await searchInput(page).fill(QUERY);
  await expect.poll(async () => (await readVisible(page)).length).toBe(FAMILY.length);

  await range.fill('45-55');
  await expect.poll(async () => (await readVisible(page)).length).toBe(1);
  const pasted = await readVisible(page);

  await range.fill('');
  await expect.poll(async () => (await readVisible(page)).length).toBe(FAMILY.length);

  await range.pressSequentially('45-55', { delay: 30 });
  await expect.poll(() => readVisible(page)).toEqual(pasted);
});

test('a tool param typed one character at a time lands where the same param pasted does', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await addTool(page, 'back_off');
  const param = page.locator('.tool-row input[data-key="pattern"]');

  await param.fill('ed');
  await expect.poll(async () => (await readVisible(page)).length).toBe(1);
  const pasted = await readVisible(page);

  await param.fill('');
  await settle(page);

  await param.pressSequentially('e', { delay: 30 });
  await expect.poll(async () => (await readVisible(page)).length).toBe(1);
  expect(await readVisible(page)).not.toEqual(pasted);

  await param.pressSequentially('d', { delay: 30 });
  await expect.poll(() => readVisible(page)).toEqual(pasted);
});

// Filling a chain's two steps in the other order runs the same pipeline off a different
// sequence of intermediate results -- a filter-then-transform run, or a transform over
// the whole corpus first. Users assemble a stack both ways; only one order is tested
// anywhere else.
test('a chain configured in either order lands in the same place', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await addTool(page, 'back_off');
  const param = page.locator('.tool-row input[data-key="pattern"]');

  await searchInput(page).fill('bak');
  await settle(page);
  await param.fill('ed');
  await expect.poll(async () => (await readVisible(page)).length).toBe(1);
  const filterFirst = await readVisible(page);

  await searchInput(page).fill('');
  await param.fill('');
  await settle(page);

  await param.fill('ed');
  await settle(page);
  await searchInput(page).fill('bak');
  await expect.poll(() => readVisible(page)).toEqual(filterFirst);
});
