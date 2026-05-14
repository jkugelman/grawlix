// Tool pipeline seam — see docs/design.md § Tool gallery & stack and
// docs/plans/tools.md.
//
// These tests cover Phase 1: the anagram tool runs against the merged wordlist
// and feeds the Workshop entries table. The pipeline executor, the entryNorm
// runtime normalization, and the chain of wirings (stack mutations → scroller
// refresh, param keystroke → scroller refresh, URL → stack on boot) all sit
// downstream of the merged-view path, so the same regressions that would
// silently break merge tests would break these.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Default Workshop display case is lowercase, so visible entry text comes
// back lowercase regardless of how the wordlist stored it.
async function addAnagramFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AnagramTest',
    entries: ['LINDSEY', 'SNIDELY', 'CAT', 'ACT', 'DOG'],
    scores: [60, 50, 40, 40, 40],
  }));
}

test('anagram via URL filters the merged view', async ({ page }) => {
  await stubPublisherFetches(page);
  await gotoApp(page);
  await addAnagramFixture(page);
  // Re-navigate to land on the anagram URL after the wordlist is loaded;
  // applying the URL on a populated app exercises the same boot path a
  // shared link would.
  await page.evaluate(() => {
    location.hash = '#/workshop?anagram=LINDSEY';
    Router.applyURL();
    renderWorkshopMergedDetail();
  });

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);
});

test('empty anagram input passes through (full merged view)', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: '' } }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['act', 'cat', 'dog', 'lindsey', 'snidely']);
});

test('anagram + search compose (search filters tool output)', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => {
    location.hash = '#/workshop?anagram=LINDSEY&search=sni';
    Router.applyURL();
    renderWorkshopMergedDetail();
  });

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual(['snidely']);
});

test('anagram matches across whitespace and case in entries', async ({ page }) => {
  await gotoApp(page);
  // RUN AMOK and MURK ANO share the same letter bank as RUNAMOK after the
  // runtime strips whitespace (and lowercases) on every wlEntry's entryNorm.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Whitespace', entries: ['RUN AMOK', 'MURK ANO', 'MOURNAK', 'CAT'], scores: [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'RUNAMOK' } }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['mournak', 'murk ano', 'run amok']);
});

test('anagram param strips whitespace before sorting letters', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  // Typing LIND SEY with a space is the same query as LINDSEY — the runtime
  // normalizes the param identically to wlEntry.entryNorm.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'LIND SEY' } }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);
});

test('typing in the row input live-filters the entries table', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  // Click the Anagram gallery card (no chain — body click replaces the stack).
  await page.locator('.gallery-card[data-tool="anagram"]').click();

  const input = page.locator('.tool-row input[data-key="entry"]');
  await expect(input).toBeFocused();
  await input.fill('LINDSEY');

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);
});

test('removing the tool row reverts to the full merged view', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'LINDSEY' } }]));

  // Sanity: tool is filtering.
  let visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);

  // Click the row's X.
  await page.locator('.tool-row-remove').click();

  visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['act', 'cat', 'dog', 'lindsey', 'snidely']);
});

test('pipeline output preserves wlEntry refs (popover opens, source/score intact)', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'LINDSEY' } }]));

  // Open the popover on an entry produced by the pipeline.
  await page.locator('.entry-row .atom-entry', { hasText: 'snidely' }).click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  // The score input reflects the entry's actual score from the merged view,
  // confirming the pipeline handed back the original wlEntry rather than a
  // synthesized lookalike.
  await expect(page.locator('#atom-pop-score')).toHaveValue('50');
});

// ─── Pair output (semordnilaps) ─────────────────────────────────────────────
//
// Pair-mode rows render two atoms flanking a relation glyph and behave
// differently along every axis the words view does — sort axes swap to
// min/max-score, search matches either side, score-range filters on min,
// stats says "N pairs". These tests pin those differences so they don't
// regress when more pair tools land. Semordnilaps' canonical-direction dedup
// (smaller entryNorm on the `a` side) is also asserted here since it's the
// only producing tool wired up today.

async function addSemordnilapFixture(page) {
  // Min scores: DEVIL/LIVED=70, DESSERTS/STRESSED=40, LOOPS/SPOOL=20. Default
  // pair sort is min-score descending, so visible row order is DEVIL/LIVED
  // first, LOOPS/SPOOL last. RACECAR is a palindrome and must NOT appear.
  // CAT/DOG are filler so the wordlist isn't all-semordnilap and the
  // pass-through path exists if anyone clears the stack.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Semordnilaps',
    entries: ['STRESSED', 'DESSERTS', 'LIVED', 'DEVIL', 'LOOPS', 'SPOOL', 'RACECAR', 'CAT', 'DOG'],
    scores:  [        60,        40,      80,      70,      30,      20,        50,    40,    40],
  }));
}

test('semordnilaps renders dedup\'d pairs in min-score-desc order', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilaps' }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([
    { a: 'devil',    b: 'lived'    },   // min 70
    { a: 'desserts', b: 'stressed' },   // min 40
    { a: 'loops',    b: 'spool'    },   // min 20
  ]);
});

test('semordnilaps excludes palindromes', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PalindromeOnly', entries: ['RACECAR', 'KAYAK', 'LEVEL'], scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilaps' }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([]);
});

test('pair-mode search filters when either side matches', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilaps' }]));

  await page.locator('#search-input').fill('esser');
  // 'esser' lives only inside DESSERTS — the pair surfaces because the b-side
  // (in a-then-b canonical order, the bigger entryNorm) matches.
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([{ a: 'desserts', b: 'stressed' }]);
});

test('pair-mode score range filters on min(score)', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilaps' }]));

  // 50+ leaves only DEVIL/LIVED (min 70). DESSERTS/STRESSED (min 40) and
  // LOOPS/SPOOL (min 20) drop out — even though STRESSED is 60, the rule is
  // min, not "any side".
  await page.locator('#score-range-input').fill('50+');
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([{ a: 'devil', b: 'lived' }]);
});

test('stats bar labels count "Pairs" in pair mode and reverts to "Entries"', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilaps' }]));

  // Three pairs visible — the label is the user-facing test of "this view
  // counts rows, not flattened atoms."
  await expect(page.locator('#workshop-stats .stats-bar')).toContainText('Pairs');
  await expect(page.locator('#workshop-stats .stats-bar')).toContainText('3');

  // Remove the tool — words mode, label flips back.
  await page.locator('.tool-row-remove').click();
  await expect(page.locator('#workshop-stats .stats-bar')).toContainText('Entries');
});

test('clicking an atom in a pair row opens the popover for that side', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilaps' }]));

  // Click STRESSED specifically (the b-side of the second row). The popover's
  // score input must show STRESSED's score (60), not DESSERTS's (40) — that's
  // the data-side wiring on the click handler.
  await page.locator('.pair-row .atom-entry[data-side="b"]', { hasText: 'stressed' }).click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  await expect(page.locator('#atom-pop-score')).toHaveValue('60');
});

// ─── Sort tiebreakers ───────────────────────────────────────────────────────
//
// Pin the multi-column tiebreaker behavior: primary direction flips with the
// user's asc/desc toggle, tiebreakers keep their declared "most interesting
// first" direction (longer entries first, higher scores first). The whole
// point of the tiebreaker pass is that flipping a primary doesn't let short
// junk float to the top of a tied bucket.

test('words: score desc tiebreaks by length desc, then entry asc', async ({ page }) => {
  await gotoApp(page);
  // All score=50; pin tiebreaker behavior cleanly: AAA (3-letter), CAT (3),
  // DOG (3), BAGEL (5), CAKE (4). Expected order (score desc → length desc →
  // entry asc): BAGEL, CAKE, AAA, CAT, DOG.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TieScore',
    entries: ['CAT', 'AAA', 'BAGEL', 'DOG', 'CAKE'],
    scores:  [  50,    50,      50,    50,     50],
  }));
  // Score axis defaults desc, which is what we want — no manual toggle.
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await page.locator('#search-bar-sort .sort-axis-select').selectOption('score');

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual(['bagel', 'cake', 'aaa', 'cat', 'dog']);
});

test('words: score asc keeps length desc tiebreaker (no junk-float)', async ({ page }) => {
  await gotoApp(page);
  // Flip primary direction — tiebreakers should NOT flip. Same fixture as
  // above but the test asserts that "short junk" doesn't float to the top of
  // the tied bucket just because the primary was reversed.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TieScoreAsc',
    entries: ['CAT', 'AAA', 'BAGEL', 'DOG', 'CAKE'],
    scores:  [  50,    50,      50,    50,     50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await page.locator('#search-bar-sort .sort-axis-select').selectOption('score');
  // Flip to ascending — primary now goes 50→50→50 (all equal), tiebreakers
  // still apply in their declared direction (length desc, entry asc). Result
  // should match the desc test: BAGEL, CAKE, AAA, CAT, DOG.
  await page.locator('#search-bar-sort .sort-dir-btn').click();

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual(['bagel', 'cake', 'aaa', 'cat', 'dog']);
});

test('pairs: min-score desc tiebreaks by length desc, then a.entry asc', async ({ page }) => {
  await gotoApp(page);
  // Build a fixture where multiple semordnilap pairs share min-score=50, so
  // tiebreakers carry the order. Pairs and their min-scores:
  //   PALINDROMES/SEMORDNILAP — 11 letters, min 50 (top by length tie)
  //   ABUT/TUBA              —  4 letters, min 50 (a.entry='abut')
  //   ADOS/SODA              —  4 letters, min 50 (a.entry='ados')
  //   AGES/SEGA              —  4 letters, min 50 (a.entry='ages')
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TiePairs',
    entries: ['PALINDROMES', 'SEMORDNILAP', 'ABUT', 'TUBA', 'ADOS', 'SODA', 'AGES', 'SEGA'],
    scores:  [50, 50, 50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilaps' }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([
    { a: 'palindromes', b: 'semordnilap' },  // length 11 wins length tiebreaker
    { a: 'abut', b: 'tuba' },                // a-side alphabetically asc
    { a: 'ados', b: 'soda' },
    { a: 'ages', b: 'sega' },
  ]);
});

test('pair-mode sort axis swap: min-score → max-score reorders rows', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilaps' }]));

  // Switch sort axis to Max score. STRESSED=60 has the highest max in any
  // pair, beating LIVED=80 — wait, no: max(70,80)=80 for DEVIL/LIVED beats
  // max(60,40)=60 for DESSERTS/STRESSED, which beats max(30,20)=30 for
  // LOOPS/SPOOL. Same ordering as min-score in this fixture, but the sort
  // axis was definitely changed. Use a fixture asymmetric enough to prove
  // it: a max-only winner that doesn't win min.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AsymPair', entries: ['EVIL', 'LIVE'], scores: [99, 10],
  }));
  // Now EVIL/LIVE: min=10, max=99. By min, it's last (10 < 20 < 40 < 70).
  // By max, it's first (99 > 80 > 60 > 30). Swapping axes flips its row.
  // The wordlist sits after Semordnilaps in source order, so EVIL/LIVE's
  // canonical direction is e<l ⇒ a=EVIL b=LIVE.
  // (Both EVIL and LIVE are 4 letters; reversing LIVE = EVIL.)
  const before = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(before[0]).toEqual({ a: 'devil',   b: 'lived'    });   // min 70 (top)
  expect(before[before.length - 1]).toEqual({ a: 'evil', b: 'live' }); // min 10 (bottom)

  await page.locator('#search-bar-sort .sort-axis-select').selectOption('max-score');
  const after = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(after[0]).toEqual({ a: 'evil', b: 'live' });                  // max 99 (top)
});
