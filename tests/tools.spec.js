// Tool pipeline seam — see docs/design.md § Tool gallery & stack and
// docs/plans/tools.md.
//
// These tests cover the chain-row pipeline: the per-row tool API
// (`run(entry, params, wordlist)`), the executor that branches transforms
// into stacked atoms, and the chain of wirings (stack mutations → scroller
// refresh, param keystroke → scroller refresh, URL → stack on boot) all sit
// downstream of the merged-view path, so the same regressions that would
// silently break merge tests would break these.
//
// `getVisibleEntries` returns a string per 1-atom row and an array of atom
// entry strings per multi-atom chain row.

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

test('anagram param is case-insensitive', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  // The runtime lowercases the param identically to wlEntry.entry,
  // so typing in any case produces the same query.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'LindSey' } }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);
});

test('typing in the row input live-filters the entries table', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  // Click the Anagram gallery card to add the tool to the stack.
  await page.locator('.gallery-card[data-tool="anagram"]').click();

  const input = page.locator('.tool-row input[data-key="entry"]');
  await expect(input).toBeFocused();
  await input.fill('LINDSEY');

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible.sort()).toEqual(['lindsey', 'snidely']);
});

test('clicking gallery cards appends them to the stack in order', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  // Each card click appends — the second click chains onto the first rather
  // than replacing it.
  await page.locator('.gallery-card[data-tool="anagram"]').click();
  await page.locator('.gallery-card[data-tool="search"]').click();

  const userStack = await page.evaluate(() =>
    ToolStack.getUserStack().map(r => r.tool));
  expect(userStack).toEqual(['anagram', 'search']);
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

// ─── Transform output (semordnilap) ─────────────────────────────────────────
//
// A transform branches each input row into one chain row per output, stacking
// a new atom under the originator. Multi-atom rows behave differently along
// every axis the 1-atom view does — sort axes swap to min/max-score, search
// filters on the last atom, score range filters on the row minimum. These
// tests pin those differences.
//
// Semordnilap emits both directions of each pair; the post-executor
// `unifyMirrorRows` pass collapses the mirror pair into one row with a ↔
// glyph. A downstream transform breaks the symmetry and the directions stay
// as separate → rows.

async function addSemordnilapFixture(page) {
  // Min scores: DEVIL/LIVED=70, DESSERTS/STRESSED=40, LOOPS/SPOOL=20. Tests
  // that pin row order select the Min score axis explicitly (it sorts
  // descending, so DEVIL/LIVED comes first, LOOPS/SPOOL last). RACECAR is a
  // palindrome and must NOT appear. CAT/DOG are filler so the wordlist isn't
  // all-semordnilap.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Semordnilaps',
    entries: ['STRESSED', 'DESSERTS', 'LIVED', 'DEVIL', 'LOOPS', 'SPOOL', 'RACECAR', 'CAT', 'DOG'],
    scores:  [        60,        40,      80,      70,      30,      20,        50,    40,    40],
  }));
}

test('semordnilap unifies mirror rows into one chain in min-score-desc order', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await page.locator('#search-bar-sort .sort-axis-select').selectOption('min-score');

  // Semordnilap emits both DEVIL→LIVED and LIVED→DEVIL; unifyMirrorRows
  // collapses each mirror pair to one row, keeping the executor's first
  // (merged-alphabetical) direction.
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([
    ['devil',    'lived'   ],   // min 70
    ['desserts', 'stressed'],   // min 40
    ['loops',    'spool'   ],   // min 20
  ]);
});

test('a unified semordnilap row carries the ↔ relation glyph', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // The collapsed row's second atom is glyphed ↔ — the pass promotes the
  // directed → to ↔ once it knows the mirror exists.
  const row = page.locator('.entry-row', { hasText: 'devil' });
  await expect(row.locator('.atom').nth(1).locator('.atom-glyph')).toContainText('↔');
});

test('a downstream transform keeps the two semordnilap directions separate', async ({ page }) => {
  await gotoApp(page);
  // STAR↔RATS is a semordnilap pair; beheading the tail diverges the two
  // directions — STAR→RATS→behead gives ats, RATS→STAR→behead gives tar — so
  // the rows are no longer mirrors and stay separate with directed → glyphs.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'DivergeChain',
    entries: ['STAR', 'RATS', 'TAR', 'ATS'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }, { tool: 'behead' }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([
    ['star', 'rats', 'ats'],
    ['rats', 'star', 'tar'],
  ]);
  // No ↔ anywhere — the rows failed the mirror test, so every glyph is →.
  await expect(page.locator('#vs-host .atom-glyph', { hasText: '↔' })).toHaveCount(0);
  await expect(page.locator('#vs-host .atom-glyph', { hasText: '→' }).first()).toBeVisible();
});

test('semordnilap excludes palindromes', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PalindromeOnly', entries: ['RACECAR', 'KAYAK', 'LEVEL'], scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([]);
});

// ─── Search as a pipeline tool ──────────────────────────────────────────────
//
// Search is a filter tool — a permanent final row driven by the search bar,
// and also addable from the gallery. Because it runs *before* unifyMirrorRows,
// the two directions of a semordnilap pair are searched independently: when
// both survive, unification merges their highlights into one ↔ row; when only
// one survives, the row degrades to a directed →.

test('both directions surviving search merge into one ↔ row, highlighted on each atom', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // 'ss' is in both DESSERTS and STRESSED, so semordnilap's two directed rows
  // both pass search; unification collapses them and merges the per-direction
  // highlights — the surviving row is highlighted on *both* atoms and keeps ↔.
  await page.locator('#search-input').fill('ss');
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([['desserts', 'stressed']]);

  const row = page.locator('.entry-row', { hasText: 'desserts' });
  await expect(row.locator('.atom', { hasText: 'desserts' }).locator('mark')).toContainText('ss');
  await expect(row.locator('.atom', { hasText: 'stressed' }).locator('mark')).toContainText('ss');
  await expect(row.locator('.atom').nth(1).locator('.atom-glyph')).toContainText('↔');
});

test('a one-sided search query degrades a unified row to a directed →', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // 'tress' is only in STRESSED. Search kills the DESSERTS→STRESSED... no —
  // it kills whichever direction's tail doesn't match: STRESSED→DESSERTS goes
  // (tail 'desserts' has no 'tress'), DESSERTS→STRESSED survives. With its
  // mirror gone there's nothing to unify, so the row stays a directed →.
  await page.locator('#search-input').fill('tress');
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([['desserts', 'stressed']]);

  const row = page.locator('.entry-row', { hasText: 'desserts' });
  await expect(row.locator('.atom').nth(1).locator('.atom-glyph')).toContainText('→');
  await expect(row.locator('.atom', { hasText: 'stressed' }).locator('mark')).toContainText('tress');
  await expect(row.locator('.atom', { hasText: 'desserts' }).locator('mark')).toHaveCount(0);
});

test('Search is a gallery tool and can be chained into the stack', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  // Click the Search gallery card — it's a tool like any other.
  await page.locator('.gallery-card[data-tool="search"]').click();
  const input = page.locator('.tool-row input[data-key="query"]');
  await expect(input).toBeFocused();
  await input.fill('cat');

  // The mid-stack Search row filters; the permanent (empty) Search is a no-op.
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual(['cat']);
});

test('a gallery Search tool and the permanent Search bar both round-trip through the URL', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  // Two `search=` keys: the first is a stack tool, the last is the bar.
  await page.evaluate(() => {
    location.hash = '#/workshop?search=ca&search=cat';
    Router.applyURL();
    renderWorkshopMergedDetail();
  });

  // Decode splits them — the added Search row survives as a user tool, it
  // doesn't collapse into the bar (the bug this scheme fixes).
  const state = await page.evaluate(() => ({
    userStack: ToolStack.getUserStack().map(r => ({ tool: r.tool, params: r.params })),
    barQuery: WorkshopView.searchQuery,
  }));
  expect(state.userStack).toEqual([{ tool: 'search', params: { query: 'ca' } }]);
  expect(state.barQuery).toBe('cat');

  // Both rows run: "ca" then "cat" leaves only CAT.
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual(['cat']);

  // Re-encoding reproduces the URL verbatim.
  const hash = await page.evaluate(() => { Router.navigate(); return location.hash; });
  expect(hash).toBe('#/workshop?search=ca&search=cat');
});

test('whole-word rides as a bare key on its Search row and round-trips', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  // whole-word is a successive param of the first Search row; the trailing
  // empty `search=` is the permanent bar (not elided — preceded by a Search).
  await page.evaluate(() => {
    location.hash = '#/workshop?search=cat&whole-word&search=';
    Router.applyURL();
    renderWorkshopMergedDetail();
  });

  const userStack = await page.evaluate(() =>
    ToolStack.getUserStack().map(r => ({ tool: r.tool, params: r.params })));
  expect(userStack).toEqual([{ tool: 'search', params: { query: 'cat', 'whole-word': true } }]);

  const hash = await page.evaluate(() => { Router.navigate(); return location.hash; });
  expect(hash).toBe('#/workshop?search=cat&whole-word&search=');
});

test('score range filters chain rows on the row minimum', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // 50+ leaves only DEVIL/LIVED (min 70). DESSERTS/STRESSED (min 40) and
  // LOOPS/SPOOL (min 20) drop out — even though STRESSED is 60, the rule is
  // the row minimum, not "any atom".
  await page.locator('#score-range-input').fill('50+');
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([['devil', 'lived']]);
});

test('stats bar counts chain rows as entries', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // Three chain rows visible — the label is always "Entries"; the count is
  // per row, not per flattened atom.
  await expect(page.locator('#workshop-stats .stats-bar')).toContainText('Entries');
  await expect(page.locator('#workshop-stats .stats-bar')).toContainText('3');

  // Remove the tool — the merged view's nine entries.
  await page.locator('.tool-row-remove').click();
  await expect(page.locator('#workshop-stats .stats-bar')).toContainText('Entries');
});

test('clicking an atom in a chain row opens the popover for that atom', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // Click STRESSED specifically (the second atom of the DESSERTS↔STRESSED
  // chain). The popover's score input must show STRESSED's score (60), not
  // DESSERTS's (40) — that's the data-atom wiring on the click handler.
  await page.locator('.entry-row .atom', { hasText: 'stressed' }).locator('.atom-entry').click();
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

test('1-atom: score desc tiebreaks by length desc, then entry asc', async ({ page }) => {
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

test('1-atom: score asc keeps length desc tiebreaker (no junk-float)', async ({ page }) => {
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

test('chains: min-score desc tiebreaks by length desc, then last-atom asc', async ({ page }) => {
  await gotoApp(page);
  // Build a fixture where multiple semordnilap chains share min-score=50, so
  // tiebreakers carry the order. Chains and their min-scores:
  //   PALINDROMES↔SEMORDNILAP — 11 letters, min 50 (top by length tie)
  //   ABUT↔TUBA              —  4 letters, min 50 (last atom 'tuba')
  //   ADOS↔SODA              —  4 letters, min 50 (last atom 'soda')
  //   AGES↔SEGA              —  4 letters, min 50 (last atom 'sega')
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TieChains',
    entries: ['PALINDROMES', 'SEMORDNILAP', 'ABUT', 'TUBA', 'ADOS', 'SODA', 'AGES', 'SEGA'],
    scores:  [50, 50, 50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await page.locator('#search-bar-sort .sort-axis-select').selectOption('min-score');

  // length desc surfaces the 11-letter chain first; the three 4-letter chains
  // tiebreak by the last atom's entry ascending (sega < soda < tuba).
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([
    ['palindromes', 'semordnilap'],
    ['ages', 'sega'],
    ['ados', 'soda'],
    ['abut', 'tuba'],
  ]);
});

test('chain sort axis swap: min-score → max-score reorders rows', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await page.locator('#search-bar-sort .sort-axis-select').selectOption('min-score');

  // EVIL/LIVE: EVIL=99, LIVE=10 ⇒ chain min=10, max=99. By min it sorts last
  // (10 < 20 < 40 < 70); by max it sorts first (99 > 80 > 60 > 30). Swapping
  // the axis flips its row from bottom to top. (EVIL < LIVE ⇒ chain runs
  // evil → live.)
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AsymChain', entries: ['EVIL', 'LIVE'], scores: [99, 10],
  }));
  const before = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(before[0]).toEqual(['devil', 'lived']);                       // min 70 (top)
  expect(before[before.length - 1]).toEqual(['evil', 'live']);         // min 10 (bottom)

  await page.locator('#search-bar-sort .sort-axis-select').selectOption('max-score');
  const after = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(after[0]).toEqual(['evil', 'live']);                          // max 99 (top)
});

// Adding or removing a tool shifts the atom-count tier, swapping the available
// sort axes (1-atom: Entry/Length/Score; multi-atom: Entry/Length/Min score/
// Max score). The user's chosen axis must carry across the boundary rather
// than snapping to a tier default: Entry and Length exist in both tiers and
// pass through untouched; Score ⇄ Min score, and Max score collapses to Score.

test('sort axis carries across the tool tier boundary', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  const axis = page.locator('#search-bar-sort .sort-axis-select');

  // Length exists in both tiers — adding then removing a tool keeps it.
  await axis.selectOption('length');
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await expect(axis).toHaveValue('length');
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await expect(axis).toHaveValue('length');

  // Score has no multi-atom counterpart — it maps to Min score when a tool is
  // added and back to Score when the tool is removed.
  await axis.selectOption('score');
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await expect(axis).toHaveValue('min-score');
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await expect(axis).toHaveValue('score');

  // Max score also collapses to Score on removal.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await axis.selectOption('max-score');
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await expect(axis).toHaveValue('score');
});

// ─── Behead, Curtail, and the removed-letter highlight ──────────────────────
//
// Transform tools that drop one letter to get from the originator to a new
// word. Each emits a `removed` highlight on the *input* atom (the originator)
// at the position of the dropped character; the renderer wraps that range in
// `<span class="hl-removed">`, the CSS gives it the line-through + fade
// treatment. These tests pin both the matching logic (the dropped form must
// be a real wordlist entry) and the input-atom highlight emission.

async function addBeheadCurtailFixture(page) {
  // Each transform pair: SLING/LING (behead), PARTY/PART (curtail),
  // BREAD/READ (behead), DOG (no match).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'BeheadCurtailTest',
    entries: ['SLING', 'LING', 'PARTY', 'PART', 'BREAD', 'READ', 'DOG'],
    scores:  [   50,    40,     60,      55,     45,      50,     40],
  }));
}

test('behead chains the originator with its first-letter-dropped form', async ({ page }) => {
  await gotoApp(page);
  await addBeheadCurtailFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));
  await page.locator('#search-bar-sort .sort-axis-select').selectOption('min-score');

  // Min score desc: BREAD/READ min 45, SLING/LING min 40.
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([
    ['bread', 'read'],
    ['sling', 'ling'],
  ]);
});

test('curtail chains the originator with its last-letter-dropped form', async ({ page }) => {
  await gotoApp(page);
  await addBeheadCurtailFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'curtail' }]));

  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([
    ['party', 'part'],
  ]);
});

test('behead marks the dropped first letter on the originator atom', async ({ page }) => {
  await gotoApp(page);
  await addBeheadCurtailFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  // Originator atom: `<span class="hl-removed">` wraps the first character.
  // Output atom: no removed highlight (nothing was dropped from it).
  const slingRow = page.locator('.entry-row', { hasText: 'sling' });
  await expect(slingRow.locator('.atom').nth(0).locator('.hl-removed')).toHaveText('s');
  await expect(slingRow.locator('.atom').nth(1).locator('.hl-removed')).toHaveCount(0);
});

test('atoms truncate long entries with ellipsis + full-text title', async ({ page }) => {
  await gotoApp(page);
  // The originator entry is way over the 20-char ENTRY_SLOT_CAP; its beheaded
  // form is too. The atom must clip to its track via CSS ellipsis rather than
  // spilling into the score column — and the full text must live in a `title`
  // attribute so the user can hover to see it.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'LongChain',
    entries: ['SHEJUSTSAYINGWHATWEVEALLBEENTHINKING', 'HEJUSTSAYINGWHATWEVEALLBEENTHINKING'],
    scores:  [60, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  const originatorAtom = page.locator('.entry-row .atom').first().locator('.atom-entry');
  await expect(originatorAtom).toHaveAttribute('title', 'shejustsayingwhatweveallbeenthinking');
  // The track must clamp the atom — its rendered width should be far less
  // than the natural text width. Tested via scrollWidth > offsetWidth, the
  // standard signal that CSS truncation kicked in.
  const truncated = await originatorAtom.evaluate(el => el.scrollWidth > el.offsetWidth);
  expect(truncated).toBe(true);
});

test('curtail marks the dropped last letter on the originator atom', async ({ page }) => {
  await gotoApp(page);
  await addBeheadCurtailFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'curtail' }]));

  const partyRow = page.locator('.entry-row', { hasText: 'party' });
  await expect(partyRow.locator('.atom').nth(0).locator('.hl-removed')).toHaveText('y');
  await expect(partyRow.locator('.atom').nth(1).locator('.hl-removed')).toHaveCount(0);
});
