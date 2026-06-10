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
const { stubPublisherFetches, gotoApp, addTool, expectVisible, expectGroups, readVisible, readGroups } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Default display case is lowercase, so visible entry text comes
// back lowercase regardless of how the wordlist stored it.
async function addAnagramFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AnagramTest',
    entries: ['lindsey', 'snidely', 'cat', 'act', 'dog'],
    scores: [60, 50, 40, 40, 40],
  }));
}

test('anagram via URL filters the merged view', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  // Re-navigate to land on the anagram URL after the wordlist is loaded;
  // applying the URL on a populated app exercises the same boot path a
  // shared link would.
  await page.evaluate(() => {
    history.replaceState(null, '', '?anagrams=LINDSEY');
    Router.applyURL();
    renderMergedDetail();
  });

  await expectVisible(page, ['lindsey', 'snidely']);
});

test('anagram + search compose (search filters tool output)', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => {
    history.replaceState(null, '', '?anagrams=LINDSEY&search=sni');
    Router.applyURL();
    renderMergedDetail();
  });

  await expectVisible(page, ['snidely']);
});

test('typing in the row input live-filters the entries table', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  await addTool(page, 'anagrams');

  const input = page.locator('.tool-row input[data-key="entry"]');
  await expect(input).toBeFocused();
  await input.fill('LINDSEY');

  await expectVisible(page, ['lindsey', 'snidely']);
});

test('adding tools from the picker appends them to the stack in order', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  await addTool(page, 'anagrams');
  await addTool(page, 'search');

  const userStack = await page.evaluate(() =>
    ToolStack.getUserStack().map(r => r.tool));
  expect(userStack).toEqual(['anagrams', 'search']);
});

test('removing the tool row reverts to the full merged view', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'LINDSEY' } }]));

  // Sanity: tool is filtering.
  await expectVisible(page, ['lindsey', 'snidely']);

  // Click the row's X.
  await page.locator('.tool-row-remove').click();

  await expectVisible(page, ['act', 'cat', 'dog', 'lindsey', 'snidely']);
});

test('pipeline output preserves wlEntry refs (popover opens, source/score intact)', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'LINDSEY' } }]));

  // Open the popover on an entry produced by the pipeline.
  await page.locator('.entry-row .atom-entry', { hasText: 'snidely' }).click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  // The score input reflects the entry's actual score from the merged view,
  // confirming the pipeline handed back the original wlEntry rather than a
  // synthesized lookalike.
  await expect(page.locator('#atom-pop-score')).toHaveValue('50');
});

// ─── Search rows below the permanent bar ────────────────────────────────────
//
// Drag drives the real pointer path (native HTML5 drag never fires from touch),
// like wordlist-reorder.spec.

// Taller viewport keeps the rows on screen so the drag's edge-auto-scroll never
// fires mid-gesture (same coupling as wordlist-reorder.spec).
test.describe('dropping a Search row below the permanent bar', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  // The +10 nudge clears makeReorderable's drag-start threshold; the final move
  // below the bar's vertical center is what selects the below-bar drop slot.
  async function dragRowBelowBar(page, rowLocator) {
    const h = await rowLocator.locator('.drag-handle').boundingBox();
    const b = await page.locator('.search-bar').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 10);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height + 6, { steps: 12 });
    await page.mouse.up();
  }

  test('a Search row dragged below the bar becomes the new bar', async ({ page }) => {
    await gotoApp(page);
    await addTool(page, 'search');
    const userRow = page.locator('.tool-row', { has: page.locator('input[data-key="pattern"]') });
    await userRow.locator('input[data-key="pattern"]').fill('FOO');

    await dragRowBelowBar(page, userRow);

    await expect.poll(() => page.evaluate(() => ({
      bar: ToolStack.getSearchBarRow().params.pattern || '',
      user: ToolStack.getUserStack().map(r => ({ tool: r.tool, pattern: r.params.pattern || '' })),
    }))).toEqual({ bar: 'FOO', user: [{ tool: 'search', pattern: '' }] });
  });

  test('a non-Search row stays above the bar', async ({ page }) => {
    await gotoApp(page);
    await addAnagramFixture(page);
    await addTool(page, 'anagrams');
    const userRow = page.locator('.tool-row', { has: page.locator('input[data-key="entry"]') });
    await userRow.locator('input[data-key="entry"]').fill('LINDSEY');

    await dragRowBelowBar(page, userRow);

    await expect.poll(() => page.evaluate(() => ({
      bar: ToolStack.getSearchBarRow().tool,
      barPattern: ToolStack.getSearchBarRow().params.pattern || '',
      user: ToolStack.getUserStack().map(r => r.tool),
    }))).toEqual({ bar: 'search', barPattern: '', user: ['anagrams'] });
  });
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
    entries: ['stressed', 'desserts', 'lived', 'devil', 'loops', 'spool', 'racecar', 'cat', 'dog'],
    scores:  [        60,        40,      80,      70,      30,      20,        50,    40,    40],
  }));
}

test('semordnilap unifies mirror rows into one chain in min-score-desc order', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await page.locator('#stats-bar-sort .sort-axis-select').selectOption('min-score');
  await page.locator('#stats-bar-sort .sort-dir-btn').click();

  // Semordnilap emits both DEVIL→LIVED and LIVED→DEVIL; unify
  // collapses each mirror pair to one row, keeping the executor's first
  // (merged-alphabetical) direction.
  await expectVisible(page, [
    ['devil',    'lived'   ],   // min 70
    ['desserts', 'stressed'],   // min 40
    ['loops',    'spool'   ],   // min 20
  ], { ordered: true });
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
    entries: ['star', 'rats', 'tar', 'ats'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }, { tool: 'behead' }]));

  // Entry sort projects off the first atom, so rows order rats < star.
  await expectVisible(page, [
    ['rats', 'star', 'tar'],
    ['star', 'rats', 'ats'],
  ], { ordered: true });
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
  await page.locator('input[data-key="pattern"]').fill('ss');
  await expectVisible(page, [['desserts', 'stressed']]);

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
  await page.locator('input[data-key="pattern"]').fill('tress');
  await expectVisible(page, [['desserts', 'stressed']]);

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
    { tool: 'search', params: { pattern: 'lin' } },
    { tool: 'search', params: { pattern: 'nds' } },
    { tool: 'search', params: { pattern: 'sey' } },
  ]));
  await expectVisible(page, ['lindsey']);

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
    { tool: 'search', params: { pattern: 'cat' } },
    { tool: 'search', params: { pattern: '*' } },
  ]));
  await expectVisible(page, ['cat']);

  const row = page.locator('#vs-host .entry-row', { hasText: 'cat' });
  await expect(row.locator('.atom')).toHaveCount(2);
  await expect(row.locator('.atom').nth(0).locator('mark')).toContainText('cat');
  await expect(row.locator('.atom').nth(1).locator('mark')).toHaveCount(0);
});

test('Search is a tool addable from the picker and can be chained into the stack', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  await addTool(page, 'search');
  const input = page.locator('.tool-row input[data-key="pattern"]');
  await expect(input).toBeFocused();
  await input.fill('cat');

  // The mid-stack Search row filters; the permanent (empty) Search is a no-op.
  await expectVisible(page, ['cat']);
});

test('a stack Search tool and the permanent Search bar both round-trip through the URL', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  // Two `search=` keys: the first is a stack tool, the last is the bar.
  await page.evaluate(() => {
    history.replaceState(null, '', '?search=ca&search=cat');
    Router.applyURL();
    renderMergedDetail();
  });

  // Decode splits them — the added Search row survives as a user tool, it
  // doesn't collapse into the bar (the bug this scheme fixes).
  const state = await page.evaluate(() => ({
    userStack: ToolStack.getUserStack().map(r => ({ tool: r.tool, params: r.params })),
    barQuery: AppView.searchQuery,
  }));
  expect(state.userStack).toEqual([{ tool: 'search', params: { pattern: 'ca' } }]);
  expect(state.barQuery).toBe('cat');

  // Both rows run: "ca" then "cat" leaves only CAT.
  await expectVisible(page, ['cat']);

  // Re-encoding reproduces the URL verbatim.
  const search = await page.evaluate(() => { Router.navigate(); return location.search; });
  expect(search).toBe('?search=ca&search=cat');
});

test('whole-word rides as a bare key on its Search row and round-trips', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);
  // whole-word is a successive param of the first Search row; the trailing
  // empty `search=` is the permanent bar (not elided — preceded by a Search).
  await page.evaluate(() => {
    history.replaceState(null, '', '?search=cat&whole-word&search=');
    Router.applyURL();
    renderMergedDetail();
  });

  const userStack = await page.evaluate(() =>
    ToolStack.getUserStack().map(r => ({ tool: r.tool, params: r.params })));
  expect(userStack).toEqual([{ tool: 'search', params: { pattern: 'cat', 'whole-word': true } }]);

  const search = await page.evaluate(() => { Router.navigate(); return location.search; });
  expect(search).toBe('?search=cat&whole-word&search=');
});

test('the caret expands a Search row into find/replace; collapsing clears it but keeps the text', async ({ page }) => {
  await gotoApp(page);
  await addAnagramFixture(page);

  await addTool(page, 'search');
  const row = page.locator('.tool-row', { has: page.locator('input[data-key="pattern"]') });
  const replace = row.locator('input[data-key="replace"]');
  const caret = row.locator('.find-replace-caret');
  const replaceParam = () => page.evaluate(() => ToolStack.getUserStack()[0].params.replace);

  await expect(replace).toBeHidden();

  await caret.click();
  await expect(replace).toBeVisible();
  await replace.fill('dog');
  expect(await replaceParam()).toBe('dog');

  await caret.click();
  await expect(replace).toBeHidden();
  expect(await replaceParam()).toBeUndefined();
  await expect(replace).toHaveValue('dog');

  await caret.click();
  await expect(replace).toBeVisible();
  expect(await replaceParam()).toBe('dog');
});

test('score range drops chains whose journey touched an out-of-range atom', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  await page.locator('#score-range-input').fill('50+');
  await expectVisible(page, [['devil', 'lived']]);
});

test('stats bar counts chain rows as entries', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  // Three chain rows visible — the count is per row, not per flattened atom
  // (each semordnilap row pairs two atoms).
  await expect(page.locator('#stats .stats-bar')).toContainText('3');

  // Remove the tool — the count falls back to the merged view's nine entries.
  await page.locator('.tool-row-remove').click();
  await expect(page.locator('#stats .stats-bar')).toContainText('9');
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
    entries: ['cat', 'aaa', 'bagel', 'dog', 'cake'],
    scores:  [  50,    50,      50,    50,     50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await page.locator('#stats-bar-sort .sort-axis-select').selectOption('score');
  await page.locator('#stats-bar-sort .sort-dir-btn').click();

  await expectVisible(page, ['bagel', 'cake', 'aaa', 'cat', 'dog'], { ordered: true });
});

test('1-atom: score asc keeps length desc tiebreaker (no junk-float)', async ({ page }) => {
  await gotoApp(page);
  // Flip primary direction — tiebreakers should NOT flip. Same fixture as
  // above but the test asserts that "short junk" doesn't float to the top of
  // the tied bucket just because the primary was reversed.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TieScoreAsc',
    entries: ['cat', 'aaa', 'bagel', 'dog', 'cake'],
    scores:  [  50,    50,      50,    50,     50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await page.locator('#stats-bar-sort .sort-axis-select').selectOption('score');

  await expectVisible(page, ['bagel', 'cake', 'aaa', 'cat', 'dog'], { ordered: true });
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
    entries: ['palindromes', 'semordnilap', 'abut', 'tuba', 'ados', 'soda', 'ages', 'sega'],
    scores:  [50, 50, 50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await page.locator('#stats-bar-sort .sort-axis-select').selectOption('min-score');

  // length desc surfaces the 11-letter chain first; the three 4-letter chains
  // tiebreak by the last atom's entry ascending (sega < soda < tuba).
  await expectVisible(page, [
    ['palindromes', 'semordnilap'],
    ['ages', 'sega'],
    ['ados', 'soda'],
    ['abut', 'tuba'],
  ], { ordered: true });
});

test('chain sort axis swap: min-score → max-score reorders rows', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));
  await page.locator('#stats-bar-sort .sort-axis-select').selectOption('min-score');
  await page.locator('#stats-bar-sort .sort-dir-btn').click();

  // EVIL/LIVE: EVIL=99, LIVE=10 ⇒ chain min=10, max=99. By min it sorts last
  // (10 < 20 < 40 < 70); by max it sorts first (99 > 80 > 60 > 30). Swapping
  // the axis flips its row from bottom to top. (EVIL < LIVE ⇒ chain runs
  // evil → live.)
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AsymChain', entries: ['evil', 'live'], scores: [99, 10],
  }));
  await expect.poll(async () => {
    const rows = await readVisible(page);
    return [rows[0], rows[rows.length - 1]];
  }).toEqual([['devil', 'lived'], ['evil', 'live']]);                   // min 70 top, min 10 bottom

  await page.locator('#stats-bar-sort .sort-axis-select').selectOption('max-score');
  await expect.poll(async () => (await readVisible(page))[0]).toEqual(['evil', 'live']);   // max 99 (top, desc carries over)
});

// Adding or removing a transform shifts the sort tier, swapping the available
// sort axes (filter-only: Entry/Length/Score; with a transform: Entry/Length/
// Min score/Max score). The user's chosen axis must carry across the boundary rather
// than snapping to a tier default: Entry and Length exist in both tiers and
// pass through untouched; Score ⇄ Min score, and Max score collapses to Score.

test('sort axis carries across the tool tier boundary', async ({ page }) => {
  await gotoApp(page);
  await addSemordnilapFixture(page);
  const axis = page.locator('#stats-bar-sort .sort-axis-select');

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
    entries: ['spark', 'park', 'clamp', 'lamp', 'bridge', 'ridge',
              'wheat', 'heat', 'scare', 'care', 'cat', 'dog'],
    scores:  Array(12).fill(50),
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([]));

  // Tool-less Entry order (default sort), narrowed to the five survivors.
  const originators = ['spark', 'clamp', 'bridge', 'wheat', 'scare'];
  await expect.poll(async () => (await readVisible(page)).length).toBe(12);
  const toolless = await readVisible(page);
  const beforeOrder = toolless.filter(e => originators.includes(e));

  // Adding behead chains each survivor and drops the rest; the chains keep
  // their tool-less first-atom order because Entry sort projects off atom 0.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));
  await expect.poll(async () => (await readVisible(page))[0]).toEqual(['bridge', 'ridge']);  // behead really ran
  const chained = await readVisible(page);
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
    entries: ['shejustsayingwhatweveallbeenthinking', 'hejustsayingwhatweveallbeenthinking'],
    scores:  [60, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  const originatorAtom = page.locator('.entry-row .atom').first().locator('.atom-entry');
  await expect(originatorAtom).toHaveAttribute('title', 'shejustsayingwhatweveallbeenthinking');
  // Poll, don't read once: webkit applies the grid track width a beat after the
  // title lands, so a single read races the layout and flakes on loaded CI only.
  await expect.poll(() => originatorAtom.evaluate(el => el.scrollWidth > el.offsetWidth)).toBe(true);
});

async function addLetterSetFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'LetterSetTest',
    entries: ['opt', 'pot', 'top', 'act', 'cat', 'dog'],
    scores: [50, 40, 30, 60, 20, 70],
  }));
}

test('score range trims junk before the grouped tool clusters', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'JunkTest',
    entries: ['opt', 'pot', 'top', 'oopt'],
    scores: [50, 40, 30, 0],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  await expectGroups(page, gs => gs.flatMap(g => g.chains.map(c => c[0])).sort(), ['oopt', 'opt', 'pot', 'top']);

  await page.locator('#score-range-input').fill('1+');
  await expectGroups(page, gs => gs.length, 1);
  await expectGroups(page, gs => gs.flatMap(g => g.chains.map(c => c[0])).sort(), ['opt', 'pot', 'top']);
});

test('search chained after the grouped tool keeps only matching chains, highlighted', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'letter_bank', grouped: true },
    { tool: 'search', params: { pattern: 'pt' } },
  ]));

  await expectGroups(page, gs => gs.length, 1);
  const groups = await readGroups(page);
  expect(groups[0].count).toBe(1);
  expect(groups[0].chains).toEqual([['opt']]);

  await expect(page.locator('#vs-host .group-chain .atom-entry mark').first()).toBeVisible();
});

test('a transform chained after the grouped tool emits a pair atom per surviving chain', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'BeheadTest',
    entries: ['spot', 'tops', 'opts', 'pot', 'ops', 'top'],
    scores: [50, 40, 30, 20, 20, 20],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'letter_bank', grouped: true },
    { tool: 'behead', params: {} },
  ]));

  await expectGroups(page,
    gs => gs.find(g => g.chains.some(c => c[0] === 'spot'))?.count ?? null, 2);
  const opst = (await readGroups(page)).find(g => g.chains.some(c => c[0] === 'spot'));
  const sorted = opst.chains.slice().sort((a, b) => a[0].localeCompare(b[0]));
  expect(sorted).toEqual([['spot', 'pot'], ['tops', 'ops']]);

  const row = page.locator('.group-row', { hasText: 'spot' });
  await expect(row.locator('.hl-removed')).toHaveCount(2);
});

test('a transform chained before the grouped tool carries its atom forward into each chain', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'BeforeGroupTest',
    entries: ['aopt', 'bpot', 'ctop', 'opt', 'pot', 'top'],
    scores: [50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'behead', params: {} },
    { tool: 'letter_bank', grouped: true },
  ]));

  await expectGroups(page, gs => gs.length, 1);
  const groups = await readGroups(page);
  const sorted = groups[0].chains.slice().sort((a, b) => a[0].localeCompare(b[0]));
  expect(sorted).toEqual([['aopt', 'opt'], ['bpot', 'pot'], ['ctop', 'top']]);

  const row = page.locator('.group-row').first();
  await expect(row.locator('.hl-removed')).toHaveCount(3);
});

test('a transform chain prefixes the new-word atom with its relation glyph; a filter chain is bare', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'GlyphTest',
    entries: ['spot', 'tops', 'opts', 'pot', 'ops', 'top'],
    scores: [50, 40, 30, 20, 20, 20],
  }));

  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'letter_bank', grouped: true },
    { tool: 'behead', params: {} },
  ]));
  const transformChain = page.locator('.group-row', { hasText: 'spot' }).locator('.group-chain').first();
  await expect(transformChain.locator('.atom').nth(0).locator('.atom-glyph')).toHaveCount(0);
  await expect(transformChain.locator('.atom').nth(1).locator('.atom-glyph')).toHaveText('→ ');

  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'letter_bank', grouped: true },
    { tool: 'search', params: { pattern: 'pt' } },
  ]));
  const filterRow = page.locator('.group-row', { hasText: 'opt' });
  await expect(filterRow.locator('.atom-glyph')).toHaveCount(0);
});

test('group rows sort by Count and the axis round-trips through the URL', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => {
    history.replaceState(null, '', '?letter_bank&all&sort=count&sort-dir=desc');
    Router.applyURL();
    renderMergedDetail();
  });

  await expectGroups(page, gs => gs.map(g => g.count), [3, 2]);

  await page.evaluate(() => Router.navigate());
  expect(page.url()).toContain('sort=count');
});

test('sort axis crosses the group tier boundary', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  const axis = page.locator('#stats-bar-sort .sort-axis-select');

  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await expect(axis).toHaveValue('entry');
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));
  await expect(axis).toHaveValue('entry');
  await page.evaluate(() => Router.navigate());
  expect(page.url()).not.toContain('sort=');

  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await axis.selectOption('score');
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));
  await expect(axis).toHaveValue('min-score');
  await page.evaluate(() => Router.navigate());
  expect(page.url()).toContain('sort=min-score');
});

test('a group member is individually editable through the atom popover', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  await page.locator('.group-row .group-chain .atom', { hasText: 'opt' }).first().locator('.atom-score').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  await expect(page.locator('#atom-pop-score')).toHaveValue('50');

  await page.locator('#atom-pop-score').fill('15');
  await page.locator('#atom-pop-score').press('Enter');
  const edited = await page.evaluate(() => window.__grawlixTest.getMergedEntry('opt'));
  expect(edited.score).toBe(15);
});

test('only one group tool per pipeline — all-toggle disabled on others, URL dedups', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => {
    history.replaceState(null, '', '?letter_bank&all&anagrams&all');
    Router.applyURL();
    renderMergedDetail();
  });
  const stack = await page.evaluate(() => ToolStack.getUserStack().map(r => ({ tool: r.tool, grouped: r.grouped })));
  expect(stack).toEqual([{ tool: 'letter_bank', grouped: true }]);

  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'letter_bank', grouped: true },
    { tool: 'anagrams' },
  ]));
  const anagramsRow = page.locator('.tool-row').nth(1);
  await expect(anagramsRow.locator('.tool-row-all-toggle')).toHaveClass(/disabled/);
});

test('grouped tool exposes its tool-defined sort axis', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  const axis = page.locator('#stats-bar-sort .sort-axis-select');
  await expect(axis.locator('option', { hasText: 'Letters' })).toHaveCount(1);

  await axis.selectOption('letters');
  await expectGroups(page, gs => gs.map(g => g.chains.map(c => c[0]).sort()), [
    ['opt', 'pot', 'top'],
    ['act', 'cat'],
  ]);
});

test('grouped column sort tiebreaks by count desc before min score', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'CountTiebreak',
    entries: ['opt', 'pot', 'top', 'act', 'cat'],
    scores: [30, 30, 30, 80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));
  await page.locator('#stats-bar-sort .sort-axis-select').selectOption('letters');

  await expectGroups(page, gs => gs.map(g => g.chains.map(c => c[0]).sort()), [
    ['opt', 'pot', 'top'],
    ['act', 'cat'],
  ]);
});
