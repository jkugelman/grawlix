// Atom-popover seeding (unify redesign, Stage 3c). The editor seeds its three
// fields from the All Wordlists merge winner for the clicked entry — never the
// viewed/scoped wordlist's own value. Decision A: the score field edits My
// Edits' RAW score, so a non-pass-through My Edits entry seeds from raw and
// shows the raw → rescored mapping. Decision B: a bare click whose norm has no
// bare merged row but does have spelled variants edits the first-alphabetical
// variant, seeded from its merged row.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Open the popover on a row by its visible entry text (the display string),
// clicking the score cell. data-entry is the norm, which collides across
// spellings, so match the row by its rendered entry instead.
async function openPopoverOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-score').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
}

test('seeds the score from the merged winner, not the lower-priority scoped list', async ({ page }) => {
  await gotoApp(page);

  // Hi added first = higher priority; both carry OCEAN. Scoped to Lo the table
  // shows Lo's 60, but the editor must seed the merge winner's 90 (from Hi).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean'], scores: [90],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean'], scores: [60],
  }));

  await scopeTo(page, 'Lo');
  await openPopoverOnEntry(page, 'ocean');
  await expect(page.locator('#atom-pop-score')).toHaveValue('90');
});

test('seeds entry/score/comment from the merged winner across all three fields', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean'], scores: [90], comments: ['big'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean'], scores: [60], comments: ['small'],
  }));

  await scopeTo(page, 'Lo');
  await openPopoverOnEntry(page, 'ocean');
  await expect(page.locator('#atom-pop-entry')).toHaveValue('ocean');
  await expect(page.locator('#atom-pop-score')).toHaveValue('90');
  await expect(page.locator('#atom-pop-comment')).toHaveValue('big');
});

test('a bare click with no bare merged row edits the first-alphabetical spelled variant', async ({ page }) => {
  await gotoApp(page);

  // W1 carries two spaced spellings of SEEINGASHOW; W2 carries the bare
  // lowercase form. Scoped to W2, clicking its bare entry seeds the editor from
  // the first-alphabetical spelled variant in the merge ('seeing a show').
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'W1', entries: ['seeing a show', 'seeing as how'], scores: [80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'W2', entries: ['seeingashow'], scores: [60],
  }));

  await scopeTo(page, 'W2');
  await openPopoverOnEntry(page, 'seeingashow');
  await expect(page.locator('#atom-pop-entry')).toHaveValue('seeing a show');
  await expect(page.locator('#atom-pop-score')).toHaveValue('80');
});

test('a non-pass-through My Edits entry seeds the raw score and shows the rescore mapping', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));

  // Give My Edits a remapping rule: a raw 5 rescores to 90. Save BAGEL into My
  // Edits at raw 5 so My Edits wins the merge with effective 90.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('My Edits', [
    { input: '5', length: '', output: '90', note: '' },
  ]));
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('bagel', 'bagel', 5));
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL')))
    .toMatchObject({ score: 90, wordlist: 'My Edits' });

  await openPopoverOnEntry(page, 'bagel');
  // The score field edits raw, so it shows 5 (not the effective 90), and the
  // raw → rescored mapping is surfaced so the lossy edit isn't silent.
  await expect(page.locator('#atom-pop-score')).toHaveValue('5');
  await expect(page.locator('.atom-pop-rescore-note')).toBeVisible();
  await expect(page.locator('.atom-pop-rescore-note')).toContainText('90');
});

test('a pass-through My Edits entry seeds the effective score with no rescore note', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));
  // My Edits ships pass-through (blank-output legend), so a saved raw equals its
  // effective — no rescore surprise.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('bagel', 'bagel', 77));

  await openPopoverOnEntry(page, 'bagel');
  await expect(page.locator('#atom-pop-score')).toHaveValue('77');
  await expect(page.locator('.atom-pop-rescore-note')).toHaveCount(0);
});

// The flat-tier click→edit path resolves the clicked row's wlEntry from a stash
// set on the row element at render time. Flag-on (WORKER_OWNS_CORPUS + windowing)
// that stash is the worker's reconstructed rich-row wlEntry (wordlist re-resolved
// from sourceId); flag-off it's the resident corpus record. Both must seed the
// popover identically.
test('a windowed flat-row popover seeds from the worker-reconstructed row', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => {
    const COUNT = 300;   // enough rows that windowing engages and re-fetches
    const STEMS = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE'];
    const mk = (offset, scoreBase) => {
      const entries = [], scores = [], comments = [];
      for (let i = 0; i < COUNT; i++) {
        entries.push(STEMS[(i + offset) % STEMS.length] + String(i).padStart(3, '0'));
        scores.push(scoreBase + (i % 50));
        comments.push(i % 3 === 0 ? 'note' + i : '');
      }
      return { entries, scores, comments };
    };
    window.__grawlixTest.addCustomWordlist({ name: 'Alpha', ...mk(0, 10) });
    return window.__grawlixTest.addCustomWordlist({ name: 'Bravo', ...mk(3, 200) });
  });

  const ENTRY = 'ABLE000';   // Alpha's first norm-sorted row: score 10, comment note0

  const captureSeed = () => page.evaluate(() => ({
    entry: document.querySelector('#atom-pop-entry').value,
    score: document.querySelector('#atom-pop-score').value,
    comment: document.querySelector('#atom-pop-comment').value,
  }));

  await scopeTo(page, 'Alpha');
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.__grawlixTest.windowIdle());

  const dbg = await page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
  // Non-vacuous: rich worker rows were consumed, so the clicked top row's stash is
  // the worker-reconstructed wlEntry — the only flat-row source post-flip.
  expect(dbg.isFlatTier).toBe(true);
  expect(dbg.richRowsConsumed).toBeGreaterThan(0);

  await openPopoverOnEntry(page, ENTRY);
  expect(await captureSeed()).toEqual({ entry: 'ABLE000', score: '10', comment: 'note0' });
});

test('editing a merged-seeded row still saves to My Edits', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean'], scores: [90],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean'], scores: [60],
  }));

  // Seeded from Hi's 90 (the merge winner); the saved edit must land in My
  // Edits, leaving the scoped Lo source untouched.
  await scopeTo(page, 'Lo');
  await openPopoverOnEntry(page, 'ocean');
  await page.locator('#atom-pop-score').fill('95');
  await page.locator('#atom-pop-score').press('Enter');

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'ocean', display: 'ocean', score: 95, comment: '' }]);
  const lo = await page.evaluate(() => window.__grawlixTest.getWordlist('Lo'));
  expect(lo.entries).toEqual([{ entry: 'ocean', display: null, score: 60, comment: '' }]);
});
