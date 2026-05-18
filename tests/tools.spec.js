// Tool pipeline seam — see docs/design.md § Tool gallery & stack and
// docs/planned/tools.md.
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
// `unify` pass collapses the mirror pair into one row with a ↔
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

  // Semordnilap emits both DEVIL→LIVED and LIVED→DEVIL; unify
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
  // Entry sort projects off the first atom, so rows order rats < star.
  expect(visible).toEqual([
    ['rats', 'star', 'tar'],
    ['star', 'rats', 'ats'],
  ]);
  // No ↔ anywhere — the rows failed the mirror test, so every glyph is →.
  await expect(page.locator('#vs-host .atom-glyph', { hasText: '↔' })).toHaveCount(0);
  await expect(page.locator('#vs-host .atom-glyph', { hasText: '→' }).first()).toBeVisible();
});

// ─── Search as a pipeline tool ──────────────────────────────────────────────
//
// Search is a filter tool — a permanent final row driven by the search bar,
// and also addable from the gallery. Because it runs *before* unification,
// the two directions of a semordnilap pair are searched independently: when
// both survive, unification collapses them into one ↔ row that keeps the
// survivor's highlight; when only one survives, the row degrades to a directed →.

test('both directions surviving search collapse to one ↔ row keeping the survivor highlight', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // 'ss' is in both DESSERTS and STRESSED, so semordnilap's two directed rows
  // both pass search; unification collapses them into one ↔ row. The survivor
  // is the lexicographically-smaller chain (desserts→stressed) and keeps only
  // its own direction's highlight — on its stressed tail, not on desserts.
  await page.locator('#search-input').fill('ss');
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([['desserts', 'stressed']]);

  const row = page.locator('.entry-row', { hasText: 'desserts' });
  await expect(row.locator('.atom', { hasText: 'stressed' }).locator('mark')).toContainText('ss');
  await expect(row.locator('.atom', { hasText: 'desserts' }).locator('mark')).toHaveCount(0);
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

test('three search tools stack three separately-highlighted atoms on one row', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  // Each highlighting tool emits its own same-word atom; only the originator
  // and the first search fold together, so three searches that all match
  // LINDSEY leave a three-atom row, one highlight per atom.
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'search', params: { query: 'lin' } },
    { tool: 'search', params: { query: 'nds' } },
    { tool: 'search', params: { query: 'sey' } },
  ]));
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual(['lindsey']);

  const row = page.locator('#vs-host .entry-row', { hasText: 'lindsey' });
  await expect(row.locator('.atom')).toHaveCount(3);
  await expect(row.locator('.atom').nth(0).locator('mark')).toContainText('lin');
  await expect(row.locator('.atom').nth(1).locator('mark')).toContainText('nds');
  await expect(row.locator('.atom').nth(2).locator('mark')).toContainText('sey');
});

test('a wildcard-only search holds its atom even though it highlights nothing', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  // 'cat' highlights CAT; '*' matches it but produces no ranges. The '*' atom
  // is still a highlight slot, so unification doesn't fold it away — the row
  // stays two atoms, its height matched to the static atom count. Keying the
  // fold on whether ranges came back would collapse it and desync the count.
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'search', params: { query: 'cat' } },
    { tool: 'search', params: { query: '*' } },
  ]));
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual(['cat']);

  const row = page.locator('#vs-host .entry-row', { hasText: 'cat' });
  await expect(row.locator('.atom')).toHaveCount(2);
  await expect(row.locator('.atom').nth(0).locator('mark')).toContainText('cat');
  await expect(row.locator('.atom').nth(1).locator('mark')).toHaveCount(0);
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

test('score range pre-filters the wordlist before tools run', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // 50+ trims the merged wordlist before semordnilap sees it. DEVIL/LIVED
  // (70/80) survive and pair. STRESSED is 60 — in range — but its partner
  // DESSERTS (40) is trimmed away, so the pair can't form: a tool never sees
  // an out-of-range word, not even as a lookup target.
  await page.locator('#score-range-input').fill('50+');
  const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(visible).toEqual([['devil', 'lived']]);
});

test('stats bar counts chain rows as entries', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // Three chain rows visible — the count is per row, not per flattened atom
  // (each semordnilap row pairs two atoms).
  await expect(page.locator('#workshop-stats .stats-bar')).toContainText('3');

  // Remove the tool — the count falls back to the merged view's nine entries.
  await page.locator('.tool-row-remove').click();
  await expect(page.locator('#workshop-stats .stats-bar')).toContainText('9');
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

// Adding or removing a transform shifts the sort tier, swapping the available
// sort axes (filter-only: Entry/Length/Score; with a transform: Entry/Length/
// Min score/Max score). The user's chosen axis must carry across the boundary rather
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

// Entry and Length sort project off the *first* atom — the merged-wordlist
// entry the row grew from — so adding a 1-output transform (or a filter)
// can't reshuffle the table: every surviving row keeps its tool-less slot.

test('Entry sort holds row order when a 1-output transform is added', async ({ page }) => {
  await gotoApp(page);
  // Five originators that behead into a real entry; the beheaded forms and the
  // two loners (CAT, DOG) behead into nothing, so adding behead drops them.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'BeheadStable',
    entries: ['SPARK', 'PARK', 'CLAMP', 'LAMP', 'BRIDGE', 'RIDGE',
              'WHEAT', 'HEAT', 'SCARE', 'CARE', 'CAT', 'DOG'],
    scores:  Array(12).fill(50),
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([]));

  // Tool-less Entry order (default sort), narrowed to the five survivors.
  const originators = ['spark', 'clamp', 'bridge', 'wheat', 'scare'];
  const toolless = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  const beforeOrder = toolless.filter(e => originators.includes(e));

  // Adding behead chains each survivor and drops the rest; the chains keep
  // their tool-less first-atom order because Entry sort projects off atom 0.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));
  const chained = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(chained[0]).toEqual(['bridge', 'ridge']);          // behead really ran
  expect(chained.map(row => row[0])).toEqual(beforeOrder);
});

// ─── Atom rendering ─────────────────────────────────────────────────────────

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

// M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@ Group tools (letter_clusters) M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@M-bM-^TM-^@
// A group tool clusters the whole merged view into GroupRow[] M-bM-^@M-^T count +
// bullet-separated members M-bM-^@M-^T rather than per-entry chain rows. See
// docs/planned/tools.md M-BM-' Groups view.

// OPT/POT/TOP share the distinct-letter set {o,p,t}; ACT/CAT share {a,c,t};
// DOG is a singleton and drops (a group needs 2+ members).
async function addLetterSetFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'LetterSetTest',
    entries: ['OPT', 'POT', 'TOP', 'ACT', 'CAT', 'DOG'],
    scores: [50, 40, 30, 60, 20, 70],
  }));
}

test('letter_clusters clusters merged entries that share a distinct-letter set', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '3' } }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  // One line per group (just the cluster); DOG (a singleton) never appears.
  const clusters = groups.map(g => g.lines[0].words.slice().sort()).sort();
  expect(clusters).toEqual([['act', 'cat'], ['opt', 'pot', 'top']]);
  expect(groups.map(g => g.lines[0].count).sort()).toEqual([2, 3]);
});

test('letter_clusters with no size is inert — the row is transparent', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: {} }]));

  // No size entered: the tool does nothing, like an empty search bar — the
  // merged view shows through as ordinary chain rows, no groups.
  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  expect(groups).toEqual([]);
  const entries = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(entries.sort()).toEqual(['act', 'cat', 'dog', 'opt', 'pot', 'top']);
});

test('letter_clusters size param constrains clusters to that many distinct letters', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SizeTest',
    entries: ['OPT', 'POT', 'AB', 'BA'],
    scores: [50, 40, 30, 20],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '2' } }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  // Only {a,b} has exactly 2 distinct letters; the size-3 {o,p,t} cluster is
  // excluded by the param.
  expect(groups.map(g => g.lines[0].words.slice().sort())).toEqual([['ab', 'ba']]);
});

test('score range trims junk out of the wordlist before letter_clusters clusters it', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'JunkTest',
    entries: ['OPT', 'POT', 'TOP', 'OOPT'],
    scores: [50, 40, 30, 0],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '3' } }]));

  // All four share {o,p,t}, so unfiltered they cluster together.
  let groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  expect(groups[0].lines[0].words.slice().sort()).toEqual(['oopt', 'opt', 'pot', 'top']);

  // "1+" drops OOPT@0 before letter_clusters sees it — the cluster survives at 3.
  // (Pre-filtering, not a min-score filter that would hide the whole group.)
  await page.locator('#score-range-input').fill('1+');
  groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  expect(groups.length).toBe(1);
  expect(groups[0].lines[0].words.slice().sort()).toEqual(['opt', 'pot', 'top']);
});

test('search chained after letter_clusters adds a filtered subset line', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'letter_clusters', params: { size: '3' } },
    { tool: 'search', params: { query: 'pt' } },
  ]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  // The {o,p,t} cluster keeps its line plus a second line of the "pt"-matching
  // subset; {a,c,t} has no "pt" word, so its subset line is empty and it drops.
  expect(groups.length).toBe(1);
  expect(groups[0].lines.length).toBe(2);
  expect(groups[0].lines[0].words.slice().sort()).toEqual(['opt', 'pot', 'top']);
  expect(groups[0].lines[1].words).toEqual(['opt']);

  // The subset line's word carries the search highlight.
  const lit = await page.evaluate(() =>
    [...document.querySelectorAll('#vs-host .group-line')][1]
      ?.querySelector('.group-cell mark') !== null);
  expect(lit).toBe(true);
});

test('a transform chained after letter_clusters adds a line of its output set', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'BeheadTest',
    entries: ['SPOT', 'TOPS', 'OPTS', 'POT', 'OPS', 'TOP'],
    scores: [50, 40, 30, 20, 20, 20],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'letter_clusters', params: { size: '4' } },
    { tool: 'behead', params: {} },
  ]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  // Line 1 is the {o,p,s,t} cluster; line 2 is behead's output set — SPOT→POT,
  // TOPS→OPS land (real words), OPTS→PTS doesn't.
  expect(groups.length).toBe(1);
  expect(groups[0].lines.length).toBe(2);
  expect(groups[0].lines[0].words.slice().sort()).toEqual(['opts', 'spot', 'tops']);
  expect(groups[0].lines[1].words.slice().sort()).toEqual(['ops', 'pot']);

  // Behead marks the dropped first letter on the cluster line — SPOT and TOPS
  // produced real words, OPTS didn't, so two cluster cells carry the strike.
  const clusterLine = page.locator('.group-row .group-line').first();
  await expect(clusterLine.locator('.hl-removed')).toHaveCount(2);
});

test('group rows sort by Count and the axis round-trips through the URL', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => {
    location.hash = '#/workshop?letter_clusters=3&sort=count&sort-dir=desc';
    Router.applyURL();
    renderWorkshopMergedDetail();
  });

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  expect(groups.map(g => g.lines[0].count)).toEqual([3, 2]);

  await page.evaluate(() => Router.navigate());
  expect(page.url()).toContain('sort=count');
});

test('sort axis crosses the group tier boundary', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  const axis = page.locator('#search-bar-sort .sort-axis-select');

  // Entry exists in every tier, so it carries into the group tier unchanged
  // rather than resetting — and it's the group default, so the URL stays bare.
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await expect(axis).toHaveValue('entry');
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '3' } }]));
  await expect(axis).toHaveValue('entry');
  await page.evaluate(() => Router.navigate());
  expect(page.url()).not.toContain('sort=');

  // Score has no group counterpart — it remaps to Min score. reconcileSort
  // settles that synchronously, so Router.navigate writes the remapped axis,
  // not a stale sort=score.
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await axis.selectOption('score');
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '3' } }]));
  await expect(axis).toHaveValue('min-score');
  await page.evaluate(() => Router.navigate());
  expect(page.url()).toContain('sort=min-score');
});

test('a group member is individually editable through the atom popover', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '3' } }]));

  // Click OPT's score badge inside its group row — the popover must open on
  // that word's wlEntry, showing its own score (50).
  await page.locator('.group-row .group-cell', { hasText: 'opt' }).locator('.atom-score').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  await expect(page.locator('#atom-pop-score')).toHaveValue('50');

  // The edit routes into My Edits like any merged-view edit.
  await page.locator('#atom-pop-score').fill('15');
  await page.locator('#atom-pop-score').press('Enter');
  const edited = await page.evaluate(() => window.__grawlixTest.getMergedEntry('opt'));
  expect(edited.score).toBe(15);
});

test('only one group tool per pipeline M-bM-^@M-^T gallery card disabled, URL dedups', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  // A URL naming letter_clusters twice M-bM-^@M-^T only the first is accepted.
  await page.evaluate(() => {
    location.hash = '#/workshop?letter_clusters=3&letter_clusters=4';
    Router.applyURL();
    renderWorkshopMergedDetail();
  });
  const stack = await page.evaluate(() => ToolStack.getUserStack().map(r => r.tool));
  expect(stack).toEqual(['letter_clusters']);

  // With a group tool in the stack, its gallery card is disabled.
  await expect(page.locator('.gallery-card[data-tool="letter_clusters"]')).toHaveClass(/disabled/);
});
