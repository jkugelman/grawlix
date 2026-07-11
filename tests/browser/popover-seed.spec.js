// Atom-panel seeding. A foreign single-list scope is a read-only inspector: the
// panel shows that list's own entry/score/comment, never the merged winner. In an
// editable scope (All Wordlists, My Edits) the fields seed the winner and edits route
// into My Edits. Decision A: the score field edits My Edits' RAW score, so a
// non-pass-through My Edits entry seeds from raw and shows the raw → rescored mapping.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Open the panel on a row by its visible entry text (the display string),
// clicking the entry cell. (In All Wordlists / My Edits the score cell opens the
// quick picker, not the panel; the entry cell opens the panel in any scope.)
// data-entry is the norm, which collides across spellings, so match the row by
// its rendered entry instead.
async function openPanelOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').dblclick();
  await expect(page.locator('#entry-panel')).toBeVisible();
}

test('a foreign scope is read-only and shows the scoped list value, not the merged winner', async ({ page }) => {
  await gotoApp(page);

  // Hi added first = higher priority; both carry OCEAN. Scoped to Lo the panel must
  // show Lo's own 60 (a read-only inspector), NOT the merge winner's 90 (from Hi).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean'], scores: [90],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean'], scores: [60],
  }));

  await scopeTo(page, 'Lo');
  await openPanelOnEntry(page, 'ocean');
  await expect(page.locator('#entry-panel-score')).toHaveValue('60');
  // Read-only: fields not editable (readonly, still readable), title flagged, no Save
  // button, a Close button instead.
  await expect(page.locator('#entry-panel .entry-panel-title')).toHaveText('View entry (read-only)');
  await expect(page.locator('#entry-panel-entry')).not.toBeEditable();
  await expect(page.locator('#entry-panel-score')).not.toBeEditable();
  await expect(page.locator('#entry-panel-comment')).not.toBeEditable();
  await expect(page.locator('.entry-panel-save')).toHaveCount(0);
  await expect(page.locator('.entry-panel-cancel')).toHaveText('Close');
});

test('a read-only foreign scope shows the scoped entry/score/comment across all three fields', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean'], scores: [90], comments: ['big'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean'], scores: [60], comments: ['small'],
  }));

  await scopeTo(page, 'Lo');
  await openPanelOnEntry(page, 'ocean');
  await expect(page.locator('#entry-panel-entry')).toHaveValue('ocean');
  await expect(page.locator('#entry-panel-score')).toHaveValue('60');
  await expect(page.locator('#entry-panel-comment')).toHaveValue('small');
});

test('a bare foreign-scope entry shows its own value, not a merged spelling', async ({ page }) => {
  await gotoApp(page);

  // W1 carries two spaced spellings of SEEINGASHOW; W2 carries the bare lowercase
  // form. Scoped to W2, its bare entry shows verbatim (rendered as the norm) at W2's
  // own 60 — it does not inherit W1's spelling or score.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'W1', entries: ['seeing a show', 'seeing as how'], scores: [80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'W2', entries: ['seeingashow'], scores: [60],
  }));

  await scopeTo(page, 'W2');
  await openPanelOnEntry(page, 'seeingashow');
  await expect(page.locator('#entry-panel-entry')).toHaveValue('seeingashow');
  await expect(page.locator('#entry-panel-score')).toHaveValue('60');
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

  await openPanelOnEntry(page, 'bagel');
  // The score field edits raw, so it shows 5 (not the effective 90); the raw →
  // rescored mapping surfaces in the My Edits provenance row's score cell.
  await expect(page.locator('#entry-panel-score')).toHaveValue('5');
  const editsRow = page.locator('.entry-panel-prov-row', { hasText: 'My Edits' });
  await expect(editsRow.locator('.atom-score-raw')).toHaveText('5');
  await expect(editsRow.locator('.score-badge')).toHaveText('90');
});

test('a pass-through My Edits entry seeds the effective score with no rescore mapping', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));
  // My Edits ships pass-through (blank-output legend), so a saved raw equals its
  // effective — no rescore surprise.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('bagel', 'bagel', 77));

  await openPanelOnEntry(page, 'bagel');
  await expect(page.locator('#entry-panel-score')).toHaveValue('77');
  const editsRow = page.locator('.entry-panel-prov-row', { hasText: 'My Edits' });
  await expect(editsRow.locator('.score-badge')).toHaveText('77');
  await expect(editsRow.locator('.atom-score-raw')).toHaveCount(0);
});

// The flat-tier click→edit path resolves the clicked row's wlEntry from a stash
// set on the row element at render time. Flag-on (WORKER_OWNS_CORPUS + windowing)
// that stash is the worker's reconstructed rich-row wlEntry (wordlist re-resolved
// from sourceId); flag-off it's the resident corpus record. Both must seed the
// panel identically.
test('a windowed flat-row panel seeds from the worker-reconstructed row', async ({ page }) => {
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
    entry: document.querySelector('#entry-panel-entry').value,
    score: document.querySelector('#entry-panel-score').value,
    comment: document.querySelector('#entry-panel-comment').value,
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

  await openPanelOnEntry(page, ENTRY);
  expect(await captureSeed()).toEqual({ entry: 'ABLE000', score: '10', comment: 'note0' });
});

test('editing from an editable scope saves to My Edits, leaving the source untouched', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean'], scores: [90],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean'], scores: [60],
  }));

  // From All Wordlists (editable) the clicked row is the merge winner (Hi 90); the
  // saved edit must land in My Edits, leaving the source lists untouched.
  await openPanelOnEntry(page, 'ocean');
  await page.locator('#entry-panel-score').fill('95');
  await page.locator('#entry-panel-score').press('Enter');

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'ocean', display: null, score: 95, comment: '' }]);
  const loEntries = await page.evaluate(() => window.__grawlixTest.dumpSourceEntries('Lo'));
  expect(loEntries).toEqual([{ entry: 'ocean', display: null, score: 60, comment: '' }]);
});
