// Scoped-corpus engine (unify redesign). Pins the contract that scoping the
// table + tools to a single source shows that source's OWN data only — no other
// publisher's opinion and no My Edits overlay mixed in — and that returning to
// All Wordlists restores the merged view. A My Edits edit therefore appears only in All Wordlists or
// when scoped to My Edits itself.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo, expectVisible, setEnabledViaPanel } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('scope shows the source itself (no other publisher mixed in); back-to-All Wordlists re-merges', async ({ page }) => {
  await gotoApp(page);

  // Two sources sharing OCEAN. Hi sits above Lo (added first = higher
  // priority), so the All Wordlists merge resolves OCEAN to Hi's 90 and includes
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

  await scopeTo(page, 'All Wordlists');
  await expectVisible(page, ['ocean', 'tide', 'zebra']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 90, wordlist: 'Hi' });
});

test('a My Edits edit does not appear in a scoped source view — only in All Wordlists', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Pub', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  // Override tide to 55 in My Edits. All-lowercase keeps display null, matching
  // the source's variant so the override would supersede in place if it traveled.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('tide', 'tide', 55));

  // Scoped to Pub the view is Pub's own data only — the My Edits override is
  // absent and tide reads Pub's own 40.
  await scopeTo(page, 'Pub');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('TIDE')))
    .toMatchObject({ score: 40, wordlist: 'Pub' });
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Pub' });

  // In All Wordlists, the edit surfaces: My Edits wins TIDE at 55.
  await scopeTo(page, 'All Wordlists');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('TIDE')))
    .toMatchObject({ score: 55, wordlist: 'My Edits' });
});

test('a disabled source is still viewable when scoped to it', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Off', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  await setEnabledViaPanel(page, 'Off', false);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN'))).toBeNull();

  // Scope means "look at this list," not "merge it" — a disabled list is still
  // viewable when scoped to it.
  await scopeTo(page, 'Off');
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('OCEAN')))
    .toMatchObject({ score: 70, wordlist: 'Off' });
});

// Entries comes off the stats bar; Min/Max are no longer displayed but the worker
// still computes them per scoped run, so read those from workerSummariesDebug. The
// histogram + these numbers must reflect whatever corpus is in scope, so a scoped
// source with a narrower score range reports a different Max than All Wordlists.
async function readStats(page) {
  return page.evaluate(() => {
    const out = {};
    for (const stat of document.querySelectorAll('#stats .stats-bar .stat')) {
      const label = stat.querySelector('.stat-label')?.textContent;
      const value = stat.querySelector('.stat-value')?.textContent;
      if (label) out[label] = value;
    }
    const ws = window.__grawlixTest.workerSummariesDebug().workerStats;
    out.Min = ws ? String(ws.min) : null;
    out.Max = ws ? String(ws.max) : null;
    return out;
  });
}

test('editing My Edits while scoped: a regular source is unchanged, All Wordlists reflects it, My Edits itself updates', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Pub', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  // Scoped to a regular source, a My Edits edit leaves that source's view
  // untouched (the scope shows Pub's own data) but does flow into All Wordlists.
  await scopeTo(page, 'Pub');
  await expectVisible(page, ['ocean', 'tide']);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('tide', 'tide', 55));
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('TIDE')))
    .toMatchObject({ score: 40, wordlist: 'Pub' });
  // A pure add to My Edits also stays out of the scoped source view.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('reef', 'reef', 60));
  await expectVisible(page, ['ocean', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('REEF'))).toBeNull();

  await scopeTo(page, 'All Wordlists');
  await expectVisible(page, ['ocean', 'reef', 'tide']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('TIDE')))
    .toMatchObject({ score: 55, wordlist: 'My Edits' });
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('REEF')))
    .toMatchObject({ score: 60, wordlist: 'My Edits' });

  // Scoped to My Edits itself, an edit there must rebuild its own view in place —
  // the cache-invalidate hook in applyEditsChange covers exactly this case.
  await scopeTo(page, 'My Edits');
  await expectVisible(page, ['reef', 'tide']);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('kelp', 'kelp', 50));
  await expectVisible(page, ['kelp', 'reef', 'tide']);
  await page.evaluate(() => window.__grawlixTest.deleteMyEdit('reef'));
  await expectVisible(page, ['kelp', 'tide']);
});

test('the histogram + stats reflect the scoped corpus, not All Wordlists', async ({ page }) => {
  await gotoApp(page);
  // Two sources with disjoint score ranges. All Wordlists spans 40–90; scoping to Lo
  // narrows the stats + histogram to 30–40.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 80],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['tide', 'reef'], scores: [40, 30],
  }));

  await expectVisible(page, ['ocean', 'reef', 'tide', 'zebra']);
  const allStats = await readStats(page);
  expect(allStats.Entries).toBe('4');
  expect(allStats.Max).toBe('90');
  expect(allStats.Min).toBe('30');

  await scopeTo(page, 'Lo');
  await expectVisible(page, ['reef', 'tide']);
  const loStats = await readStats(page);
  expect(loStats.Entries).toBe('2');
  expect(loStats.Max).toBe('40');
  expect(loStats.Min).toBe('30');

  await scopeTo(page, 'All Wordlists');
  const backStats = await readStats(page);
  expect(backStats.Entries).toBe('4');
  expect(backStats.Max).toBe('90');
});

test('a tool runs against the scoped corpus, not All Wordlists', async ({ page }) => {
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

  await scopeTo(page, 'All Wordlists');
  await expectVisible(page, ['act', 'cat']);
});

test('the Sources matrix shows cross-list presence and colors only contributing lists', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Hi', entries: ['ocean', 'zebra'], scores: [90, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Lo', entries: ['ocean', 'tide'], scores: [70, 40],
  }));

  // The default 1280px viewport clears the 960px breakpoint that gates the column.
  await expectVisible(page, ['ocean', 'tide', 'zebra']);
  await expect(page.locator('.entry-headers .col-source')).toHaveCount(1);
  expect(await page.locator('.entry-row .atom-source').count()).toBeGreaterThan(0);

  await scopeTo(page, 'Lo');
  await expectVisible(page, ['ocean', 'tide']);
  await expect(page.locator('.entry-headers .col-source')).toHaveCount(1);
  // 'ocean' is in both lists → Hi's slot is filled; 'tide' is Lo-only → Hi's isn't.
  await expect(page.locator('.entry-row[data-entry="ocean"] .src-slot[title^="Hi"]')).toHaveCount(1);
  await expect(page.locator('.entry-row[data-entry="tide"] .src-slot[title^="Hi"]')).toHaveCount(0);
  await expect(page.locator('.entry-row[data-entry="ocean"] .src-slot[title="Lo"]')).not.toHaveClass(/src-slot--muted/);
  await expect(page.locator('.entry-row[data-entry="ocean"] .src-slot[title="Hi (overridden)"]')).toHaveClass(/src-slot--muted/);

  await scopeTo(page, 'All Wordlists');
  await expectVisible(page, ['ocean', 'tide', 'zebra']);
  await expect(page.locator('.entry-headers .col-source')).toHaveCount(1);
  expect(await page.locator('.entry-row .src-slot--muted').count()).toBeGreaterThan(0);
});
