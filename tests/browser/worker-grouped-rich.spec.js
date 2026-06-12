const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Chunk oracle: GROUPED and TRANSFORM-CHAIN results ship their corpus atoms RICH
// (self-contained: norm/display/score/rawScore/comment/sourceId) — mirroring what
// the flat tier already does (worker-rich-windowed). The decoded rows must render
// the right entries, scores, anchors, and group chains. Synthetic { s } atoms — a
// tool output present in no wordlist — decode the same way; the transform stacks
// below emit some.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// One primary list carries the grouping fodder; an overlapping secondary list
// makes the merge resolve a priority winner per entry, so the merged-scope Source
// column is non-trivial and the rich atom's sourceId must reconstruct the winner.
//
// Fixture constraints (executor.js bucketize): a group needs >= 2 members, and
// an anchored tool (initialisms) drops a group whose key isn't itself an entry.
// Behead/Curtail only emit an output that's itself a corpus entry, so the chains
// stay corpus-atom (rich) — synthetic { s } atoms aren't reachable from these
// transforms and aren't this chunk's subject (they're untouched here and already
// covered round-tripping by worker-rich-tiers.spec.js).
//   - Anagram groups (string key): elvis/lives/evils/veils (4), stressed/desserts (2).
//   - Behead→Curtail chain: scare → care → car (each a corpus entry, 3 atoms).
const PRIMARY = [
  ['elvis', 70, 'king'],
  ['lives', 65, ''],
  ['evils', 30, 'plural'],
  ['veils', 25, ''],
  ['stressed', 80, ''],
  ['desserts', 75, 'sweet'],
  ['scare', 50, ''],
  ['care', 40, 'tend'],   // behead('scare',1) → 'care'
  ['car', 35, ''],        // curtail('care',1) → 'car'
  ['hot', 20, ''],        // initialism anchor for the colliding phrases below
];

// Three phrases whose initialisms all collide on "hot" (so the group has >= 2
// members), with "hot" present above as the anchor entry.
const PHRASES = [
  ['Helen of Troy', 90, ''],
  ['Heart of Texas', 85, 'song'],
  ['House of Tudor', 80, ''],
];

// Overlapping list, seeded FIRST below so it's the earlier (higher-priority)
// source — the merge winner for every shared norm is Beta, and the rich atom's
// sourceId must reconstruct it (not Alpha) for the Source column to match.
const SECONDARY = PRIMARY.map(([e, s]) => [e, s + 100, 'hi']);

function unzip(rows) {
  return {
    entries: rows.map(r => r[0]),
    scores: rows.map(r => r[1]),
    comments: rows.map(r => r[2]),
  };
}

async function seedCorpus(page) {
  await page.evaluate(({ primary, phrases, secondary }) => {
    window.__grawlixTest.addCustomWordlist({ name: 'Beta', ...secondary });
    window.__grawlixTest.addCustomWordlist({ name: 'Phrases', ...phrases });
    return window.__grawlixTest.addCustomWordlist({ name: 'Alpha', ...primary });
  }, {
    primary: unzip(PRIMARY),
    phrases: unzip(PHRASES),
    secondary: unzip(SECONDARY),
  });
}

async function setStack(page, stack) {
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function settle(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// Capture every rendered row (both flat-style .entry-row chains and grouped
// .group-row) by structural HTML so the compare is byte-exact, sorted by their
// pixel top so DOM order can't perturb it.
function captureRows(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#vs-host .entry-row:not(.skeleton), #vs-host .group-row')];
    return rows.map(r => ({
      top: r.style.top,
      text: (r.textContent || '').trim(),
      marks: [...r.querySelectorAll('mark')].map(m => m.textContent),
      html: r.innerHTML,
    })).sort((a, b) => parseFloat(a.top) - parseFloat(b.top));
  });
}

// The rich-atom decode is the only path, so a non-empty well-formed render IS the
// proof it decoded — there's no { i }-index fallback left to silently mask it.
async function renderRich(page, stack, syncScope) {
  await page.evaluate(s => window.__grawlixTest.syncWorkerConfig(s), syncScope);
  await setStack(page, []);            // clear so the next setStack is a real fresh run
  await setStack(page, stack);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const rows = await captureRows(page);
  expect(rows.length).toBeGreaterThan(0);
  return rows;
}

// ─── Transform-chain tier ─────────────────────────────────────────────────────

test('transform chain (Behead then Curtail) ships rich atoms that decode the chain', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  // Merged scope (gotoApp default) renders the Source column, so the rich atom's
  // sourceId reconstruction is exercised.
  await renderRich(page, [
    { tool: 'behead', params: { count: '1' } },
    { tool: 'curtail', params: { count: '1' } },
  ], undefined);

  const rows = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  const chain = rows.find(r => Array.isArray(r) && r.includes('car'));
  expect(chain).toEqual(['scare', 'care', 'car']);
});

test('single transform (Behead) with input highlights ships rich atoms', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await renderRich(page, [{ tool: 'behead', params: { count: '1' } }], undefined);

  const rows = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(rows.some(r => Array.isArray(r) && r[0] === 'scare' && r[1] === 'care')).toBe(true);
});

// ─── Grouped tier ─────────────────────────────────────────────────────────────

test('grouped anagrams (string key) ship rich atoms that decode the group', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await renderRich(page, [{ tool: 'anagrams', grouped: true }], undefined);

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const members = groups.flatMap(g => g.chains.flat());
  for (const word of ['elvis', 'lives', 'evils', 'veils']) expect(members).toContain(word);
  for (const g of groups) expect(g.count).toBeGreaterThanOrEqual(2);
});

test('grouped initialisms (display-keyed, with anchor) ship rich atoms', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await renderRich(page, [{ tool: 'initialisms', grouped: true }], undefined);

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const hot = groups.find(g => g.anchor?.entry === 'hot');
  expect(hot).toBeTruthy();
  const members = hot.chains.flat();
  for (const phrase of ['Helen of Troy', 'Heart of Texas', 'House of Tudor']) {
    expect(members).toContain(phrase);
  }
});

// ─── Scoped (single-source) view ──────────────────────────────────────────────
// The rich encoding is scope-gated (useOwned requires ownedScope === scope), so
// prove a scoped grouped run too. Scope FIRST, then sync, so the worker builds
// ownedCorpus for Alpha and sets ownedScope = Alpha's dbKey.

test('scoped grouped anagrams ship rich atoms that decode the group', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.setScope('Alpha'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await renderRich(page, [{ tool: 'anagrams', grouped: true }], undefined);

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const members = groups.flatMap(g => g.chains.flat());
  for (const word of ['elvis', 'lives', 'evils', 'veils']) expect(members).toContain(word);
});
