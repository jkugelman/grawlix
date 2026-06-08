// Scoped-corpus engine (Stage 1a of the unify redesign). Pins the contract
// that scoping the table + tools to a single source shows that source as
// itself — no other publisher's opinion mixed in — but with the My Edits
// overlay applied, and that returning to All restores the merged view. Scope
// is driven through the `setScope` test API; there is no scope UI yet.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo, expectVisible, openLibrary, focusWordlist } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('scope shows the source itself (no other publisher mixed in); back-to-All re-merges', async ({ page }) => {
  await gotoApp(page);

  // Two sources sharing OCEAN. Hi sits above Lo (added first = higher
  // priority), so the All merge resolves OCEAN to Hi's 90 and includes
  // ZEBRA, which only Hi carries.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  await expectVisible(page, ['ocean', 'tide', 'zebra']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 90, wordlist: 'Hi' });

  // Scope to Lo: only Lo's word set, with Lo's own scores — Hi's higher OCEAN
  // is not mixed in, and ZEBRA (Hi-only) is absent.
  await scopeTo(page, 'Lo');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Lo' });
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('ZEBRA'))).toBeNull();

  await scopeTo(page, 'All');
  await expectVisible(page, ['ocean', 'tide', 'zebra']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 90, wordlist: 'Hi' });
});

test('the My Edits overlay travels into a scoped source', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Pub', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  // Override tide in My Edits (before scoping, so the scoped corpus is built
  // fresh with the edit present). My Edits is you, not a publisher, so it
  // follows you into every scope at top priority. All-lowercase keeps display
  // null, matching the source's variant so the override supersedes in place.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('tide', 'tide', 55));

  await scopeTo(page, 'Pub');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('TIDE')))
    .toMatchObject({ score: 55, wordlist: 'My Edits' });
  // OCEAN, untouched by My Edits, reads the source's own score.
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Pub' });
});

test('a disabled source is still viewable when scoped to it', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Off', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  // Disable via the Library toggle — importing data force-enables a list, so
  // disabling has to happen after population, through the real toggle path.
  await page.locator('.header-nav-item[data-view="library"]').click();
  await page.getByLabel('Toggle Off').uncheck();
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN'))).toBeNull();

  // Scope means "look at this list," not "merge it" — a disabled list is still
  // viewable when scoped to it.
  await scopeTo(page, 'Off');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Off' });
});

// Read the Workshop stats bar's label→value readouts (Entries, Min, Max). The
// histogram + these numbers must reflect whatever corpus is in scope, so a
// scoped source with a narrower score range reads a different Max than All.
async function readWorkshopStats(page) {
  return page.evaluate(() => {
    const out = {};
    for (const stat of document.querySelectorAll('#workshop-stats .stats-bar .stat')) {
      const label = stat.querySelector('.stat-label')?.textContent;
      const value = stat.querySelector('.stat-value')?.textContent;
      if (label) out[label] = value;
    }
    return out;
  });
}

test('editing My Edits while scoped updates the scoped view immediately', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Pub', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  await scopeTo(page, 'Pub');
  await expectVisible(page, ['ocean', 'tide']);

  // Override an existing entry: the scoped view must show the new score, not the
  // source's, even though the only patch path patchMergedForNorms knows is the
  // merged cache. The scoped corpus is rebuilt on edit instead.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('tide', 'tide', 55));
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('TIDE')))
    .toMatchObject({ score: 55, wordlist: 'My Edits' });
  await expectVisible(page, ['ocean', 'tide']);

  // Add a brand-new entry while scoped.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('reef', 'reef', 60));
  await expectVisible(page, ['ocean', 'reef', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('REEF')))
    .toMatchObject({ score: 60, wordlist: 'My Edits' });

  // Delete a My Edits-only entry while scoped — its row leaves the view.
  await page.evaluate(() => window.__grawlixTest.deleteMyEdit('reef'));
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('REEF'))).toBeNull();

  // Back to All, the merged cache carries the surviving edit (TIDE override).
  await scopeTo(page, 'All');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('TIDE')))
    .toMatchObject({ score: 55, wordlist: 'My Edits' });
});

test('the histogram + stats reflect the scoped corpus, not All', async ({ page }) => {
  await gotoApp(page);
  // Two sources with disjoint score ranges. All spans 40–90; scoping to Lo
  // narrows the stats + histogram to 30–40.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 80],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['tide', 'reef'], scores: [40, 30],
  }));

  await expectVisible(page, ['ocean', 'reef', 'tide', 'zebra']);
  const allStats = await readWorkshopStats(page);
  expect(allStats.Entries).toBe('4');
  expect(allStats.Max).toBe('90');
  expect(allStats.Min).toBe('30');

  await scopeTo(page, 'Lo');
  await expectVisible(page, ['reef', 'tide']);
  const loStats = await readWorkshopStats(page);
  expect(loStats.Entries).toBe('2');
  expect(loStats.Max).toBe('40');
  expect(loStats.Min).toBe('30');

  await scopeTo(page, 'All');
  const backStats = await readWorkshopStats(page);
  expect(backStats.Entries).toBe('4');
  expect(backStats.Max).toBe('90');
});

test('a tool runs against the scoped corpus, not All', async ({ page }) => {
  await gotoApp(page);
  // CAT/ACT anagram pair split across two lists: ACT lives only in Other.
  // Scoped to Main, the anagram tool must not surface ACT.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Main', entries: ['cat', 'dog'], scores: [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Other', entries: ['act'], scores: [50],
  }));

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'CAT' } }]));
  await expectVisible(page, ['act', 'cat']);

  // The same pipeline, scoped to Main, runs against Main only — ACT is gone.
  await scopeTo(page, 'Main');
  await expectVisible(page, ['cat']);

  await scopeTo(page, 'All');
  await expectVisible(page, ['act', 'cat']);
});

// The source column tells you which list a merged row came from. Scoped to one
// source every row shares it, so the column is dropped — header and cells both.
// Asserted via the cells' absence (and the header class), never computed CSS.
test('the source column is shown for All and hidden when scoped', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  // The default 1280px viewport clears the 960px breakpoint that gates the
  // column, so at All the header and per-row cells are present.
  await expectVisible(page, ['ocean', 'tide', 'zebra']);
  await expect(page.locator('#detail-panel')).not.toHaveClass(/no-source-col/);
  await expect(page.locator('.entry-headers .col-source')).toHaveCount(1);
  expect(await page.locator('.entry-row .atom-source').count()).toBeGreaterThan(0);

  await scopeTo(page, 'Lo');
  await expectVisible(page, ['ocean', 'tide']);
  await expect(page.locator('#detail-panel')).toHaveClass(/no-source-col/);
  await expect(page.locator('.entry-headers .col-source')).toHaveCount(0);
  await expect(page.locator('.entry-row .atom-source')).toHaveCount(0);

  await scopeTo(page, 'All');
  await expectVisible(page, ['ocean', 'tide', 'zebra']);
  await expect(page.locator('#detail-panel')).not.toHaveClass(/no-source-col/);
  await expect(page.locator('.entry-headers .col-source')).toHaveCount(1);
  expect(await page.locator('.entry-row .atom-source').count()).toBeGreaterThan(0);
});

// Reads a histogram's axis bounds from the bars' data-lo/data-hi (the layout's
// slot boundaries), not pixel geometry. Within a `selector` scope so the
// Workshop and Library bars are read independently.
async function readHistogramAxis(page, selector) {
  return page.evaluate(sel => {
    const bars = [...document.querySelectorAll(`${sel} .histogram-bar`)];
    if (!bars.length) return null;
    return {
      min: Number(bars[0].dataset.lo),
      max: Number(bars[bars.length - 1].dataset.hi),
    };
  }, selector);
}

// Stage 1b made getHistogramLayout read the global scope; the still-present
// Library view also calls it. This is the regression guard for Stage 2b's fix:
// scoping the Workshop must NOT shift the Library's histogram axis (it's a fixed
// all-sources scale), while the Workshop's axis DOES follow the scope.
test('a Workshop scope does not leak into the Library histogram axis', async ({ page }) => {
  await gotoApp(page);
  // Disjoint score ranges: All spans 30–90, Lo alone spans 30–40. Four distinct
  // scores stay under the discrete-histogram threshold, so the axis bounds read
  // straight off the first/last slot.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 80],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['tide', 'reef'], scores: [40, 30],
  }));

  await expectVisible(page, ['ocean', 'reef', 'tide', 'zebra']);
  expect(await readHistogramAxis(page, '#workshop-stats')).toEqual({ min: 30, max: 90 });

  // Scope the Workshop to Lo: its histogram narrows to 30–40.
  await scopeTo(page, 'Lo');
  await expectVisible(page, ['reef', 'tide']);
  expect(await readHistogramAxis(page, '#workshop-stats')).toEqual({ min: 30, max: 40 });

  // Now open the Library while the Workshop is still scoped to Lo. The Library's
  // histogram must reflect ALL sources (30–90), not the leaked Lo scope (30–40).
  await openLibrary(page);
  await focusWordlist(page, 'Hi');
  expect(await readHistogramAxis(page, '#library-view')).toEqual({ min: 30, max: 90 });
  await focusWordlist(page, 'Lo');
  expect(await readHistogramAxis(page, '#library-view')).toEqual({ min: 30, max: 90 });
});
