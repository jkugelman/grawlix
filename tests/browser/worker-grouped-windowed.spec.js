import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, settleGroupWindow } from './helpers.js';

// Equivalence net for grouped-tier windowing, outliving the pre-windowing
// all-chains path: the worker ships per-group summaries + a firstChains window
// and serves later windows via fetchGroupChains. These specs prove the windowed
// result REASSEMBLED (resident firstChains ++ every fetched window, per group, in
// order) equals the worker's full retained group — nothing dropped, duplicated,
// or reordered at the boundary. The big group must exceed GROUP_FIRST_WINDOW (64)
// or no boundary is crossed and the fetch path goes unexercised — the silent way
// this whole net could pass without testing anything.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const BIG = 100000;   // an end past any group's size — fetch the whole tail

// The fixture tool `prefix_group` (engine/fixture-tools.js) keys an entry by its
// norm minus trailing digits, so `ab000`..`ab069` is one 70-member group sorted
// by member norm. Distinct descending scores keep the within-group order total.
const pad = i => String(i).padStart(3, '0');

// "ab" crosses the 64-chain window; "abc" fits one window.
function bigGroupFixture() {
  const entries = [], scores = [];
  let score = 5000;
  for (let i = 0; i < 70; i++) { entries.push('ab' + pad(i)); scores.push(score--); }
  for (let i = 0; i < 5; i++) { entries.push('abc' + pad(i)); scores.push(score--); }
  return { name: 'Bank', entries, scores };
}

// 100 members under "hot", with `hot` itself present as the anchor.
function anchoredFixture() {
  const entries = ['hot'], scores = [9000];
  let score = 5000;
  for (let i = 0; i < 100; i++) { entries.push('hot' + pad(i)); scores.push(score--); }
  return { name: 'Anchored', entries, scores };
}

// Two-member groups keyed by strictly increasing letter triples ("abc", "abd", ...),
// for windowing the group LIST. Equal-length keys sort the groups lexicographically.
function tripleKeys(count) {
  const A = 'abcdefghijklmnopqrstuvwxyz', keys = [];
  for (let i = 0; i < A.length; i++)
    for (let j = i + 1; j < A.length; j++)
      for (let k = j + 1; k < A.length; k++) {
        keys.push(A[i] + A[j] + A[k]);
        if (keys.length >= count) return keys;
      }
  return keys;
}

function manyGroupsFixture(targetGroups = 150) {
  const entries = [], scores = [];
  let score = 9000;
  for (const key of tripleKeys(targetGroups)) {
    entries.push(key + '0', key + '1');
    scores.push(score--, score--);
  }
  return { name: 'Many', entries, scores };
}

async function seedScoped(page, fixture) {
  await page.evaluate(() => window.__grawlixTest.installFixtureTools());
  await page.evaluate(f => window.__grawlixTest.addCustomWordlist(f), fixture);
  await page.evaluate(n => window.__grawlixTest.setScope(n), fixture.name);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function runGrouped(page, stack) {
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.setStack([]));   // clear → next is a fresh run
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function reassemble(page) {
  return page.evaluate(async (BIG) => {
    const groups = window.__grawlixTest.workerGroupsDebug();
    const out = [];
    for (const g of groups) {
      const resident = g.residentChains.map(atoms => atoms.join('|'));
      let tail = [];
      if (resident.length < g.count) {
        const reply = await window.__grawlixTest.fetchWorkerGroupChains(g.key, resident.length, BIG);
        tail = (reply?.chains || []).map(c => c.atoms.map(a => a.wlEntry.norm).join('|'));
      }
      out.push({ key: g.key, count: g.count, chains: [...resident, ...tail] });
    }
    return out;
  }, BIG);
}

async function fullFetch(page, key) {
  return page.evaluate(async ({ key, BIG }) => {
    const reply = await window.__grawlixTest.fetchWorkerGroupChains(key, 0, BIG);
    return (reply?.chains || []).map(c => c.atoms.map(a => a.wlEntry.norm).join('|'));
  }, { key, BIG });
}

// ─── Golden reassembly ───────────────────────────────────────────────────────

test('grouped: windowed reassembly equals the full group, per group', async ({ page }) => {
  await gotoApp(page);
  await seedScoped(page, bigGroupFixture());
  await runGrouped(page, [{ tool: 'prefix_group', grouped: true }]);

  const reassembled = await reassemble(page);

  const ab = reassembled.find(g => g.key === 'ab');
  expect(ab).toBeTruthy();
  expect(ab.count).toBe(70);
  expect(ab.chains.length).toBe(70);   // crosses the 64 boundary (resident < count)

  const abc = reassembled.find(g => g.key === 'abc');
  expect(abc.count).toBe(5);
  expect(abc.chains.length).toBe(5);   // fits one window

  for (const g of reassembled) {
    const full = await fullFetch(page, g.key);
    expect(g.chains).toEqual(full);    // windowed == full — the equivalence proof
    expect(full.length).toBe(g.count);
  }

  // Pin the big group's seed order across the boundary (head resident, tail
  // fetched): the default grouped sort is Entry, so chains run by seed norm.
  expect(ab.chains.slice(0, 4)).toEqual(['ab000', 'ab001', 'ab002', 'ab003']);
  expect(ab.chains.slice(64)).toEqual(['ab064', 'ab065', 'ab066', 'ab067', 'ab068', 'ab069']);
});

test('anchored grouped: windowed reassembly equals the full group', async ({ page }) => {
  await gotoApp(page);
  await seedScoped(page, anchoredFixture());
  await runGrouped(page, [{ tool: 'prefix_group_anchored', grouped: true }]);

  const reassembled = await reassemble(page);
  const hot = reassembled.find(g => g.key === 'hot');
  expect(hot).toBeTruthy();
  expect(hot.count).toBe(100);
  expect(hot.chains.length).toBe(100);   // resident 64 + fetched 36

  const full = await fullFetch(page, 'hot');
  expect(hot.chains).toEqual(full);
  expect(full.length).toBe(100);
  // The anchor `hot` isn't a chain member; chains are the 100 members by seed norm.
  expect(hot.chains[0]).toBe('hot000');
});

// ─── Group-LIST windowed reassembly ──────────────────────────────────────────
// The flat-tier analogue one level up: the worker ships only the first window of
// group ROWS and serves the rest via fetchGroups. Reassemble inline-window ++ every
// later group window and assert it equals the worker's full sorted group list.
async function reassembleGroupList(page) {
  return page.evaluate(async () => {
    const { groupCount, residentKeys } = window.__grawlixTest.workerGroupListDebug();
    const keys = [...residentKeys];
    const WINDOW = 50;
    for (let start = residentKeys.length; start < groupCount; start += WINDOW) {
      const reply = await window.__grawlixTest.fetchWorkerGroups(start, start + WINDOW);
      for (const g of (reply?.groups || [])) keys.push(g.key);
    }
    return { groupCount, residentCount: residentKeys.length, keys };
  });
}

test('grouped: windowed group LIST reassembles to the full sorted group list', async ({ page }) => {
  await gotoApp(page);
  await seedScoped(page, manyGroupsFixture(150));
  await runGrouped(page, [{ tool: 'prefix_group', grouped: true }]);

  const { groupCount, residentCount, keys } = await reassembleGroupList(page);

  // Without resident < total the inline window already held everything and the
  // fetch path — the thing under test — never ran.
  expect(groupCount).toBe(150);
  expect(residentCount).toBeLessThan(groupCount);

  const full = await page.evaluate(async () => {
    const { groupCount } = window.__grawlixTest.workerGroupListDebug();
    const reply = await window.__grawlixTest.fetchWorkerGroups(0, groupCount);
    return (reply?.groups || []).map(g => g.key);
  });
  expect(keys.length).toBe(groupCount);
  expect(keys).toEqual(full);

  // Lexicographic under the default Entry grouped sort; freeze the head and tail
  // across the boundary.
  expect(keys.slice(0, 4)).toEqual(['abc', 'abd', 'abe', 'abf']);
  expect(keys.slice(-3)).toEqual(['aij', 'aik', 'ail']);
  expect(new Set(keys).size).toBe(keys.length);
  expect([...keys].sort()).toEqual(keys);
});

// ─── Export covers every chain past the window ───────────────────────────────
// Regression guard: post-windowing, a resident group carries only its firstChains
// window (≤64), so exporting from resident groups silently truncates any group
// over 64 chains. Export must round-trip the worker for the FULL chains. The "ab"
// group has 70 chains — past the 64 boundary — so a windowed export caps at 64 and
// this fails; the full-chains export emits all 70.

test('grouped export emits every chain of a >64-chain group, not just the window', async ({ page }) => {
  await gotoApp(page);
  await seedScoped(page, bigGroupFixture());
  await runGrouped(page, [{ tool: 'prefix_group', grouped: true }]);

  // The big group's true count exceeds the window — otherwise nothing is tested.
  const abCount = await page.evaluate(() =>
    window.__grawlixTest.workerGroupsDebug().find(g => g.key === 'ab').count);
  expect(abCount).toBe(70);
  expect(abCount).toBeGreaterThan(64);

  const json = await page.evaluate(() => window.__grawlixTest.exportText('json'));
  const wordlist = (await page.evaluate(() => window.__grawlixTest.exportText('wordlist'))).text;

  const abGroup = json.groups.find(g => g.group_key === 'ab');
  expect(abGroup).toBeTruthy();
  expect(abGroup.chains.length).toBe(abCount);   // 70, not 64

  // The wordlist text dedupes by tail entry; each chain has a distinct tail, so all
  // 70 land as distinct lines (none of the post-64 tail dropped).
  const abLines = wordlist.split('\n').filter(Boolean)
    .filter(l => /^ab\d+;/i.test(l));
  expect(abLines.length).toBe(abCount);

  const abcGroup = json.groups.find(g => g.group_key === 'abc');
  expect(abcGroup.chains.length).toBe(5);
});

// ─── Async "+N more" expand ──────────────────────────────────────────────────

test('+N more popover fetches later windows in order; a fetched chain is editable', async ({ page }) => {
  await gotoApp(page);
  await seedScoped(page, bigGroupFixture());
  await runGrouped(page, [{ tool: 'prefix_group', grouped: true }]);

  const moreBtn = page.locator('#vs-host .group-row .group-more:not([hidden])').first();
  await expect(moreBtn).toBeVisible();
  await moreBtn.click();
  await expect(page.locator('.group-popover')).toBeVisible();

  // Drive the IntersectionObserver past the resident window, then wait for the
  // fetched skeletons to fill.
  await page.locator('.group-popover').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(async () =>
    page.locator('.group-popover .group-chain.skeleton').count()
  ).toBe(0);

  const rendered = await page.locator('.group-popover .group-chain').evaluateAll(els =>
    els.map(e => parseInt(e.dataset.chain, 10))
  );
  expect(rendered).toEqual([...Array(70).keys()]);   // 0..69, in order, no gaps

  // A chain from a FETCHED window (index 65) edits correctly — the atom-edit
  // routing must resolve data-chain (absolute) to the right atom across windows.
  const fetchedChain = page.locator('.group-popover .group-chain[data-chain="65"]');
  await expect(fetchedChain).toHaveCount(1);
  const fetchedNorm = (await fetchedChain.locator('.atom-entry').first().innerText()).toLowerCase();
  await fetchedChain.locator('.atom-score').first().click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  const editingText = (await page.locator('#entry-panel').innerText()).toLowerCase();
  const editingInputs = await page.locator('#entry-panel input').evaluateAll(els =>
    els.map(e => (e.value || '').toLowerCase()));
  expect(editingText.includes(fetchedNorm) || editingInputs.some(v => v.includes(fetchedNorm))).toBe(true);
});

// ─── Collapsed row paints from the resident window ───────────────────────────

test('collapsed group rows paint from the resident window with no under-fill', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.resetGroupWindowUnderfillForTest());
  await seedScoped(page, bigGroupFixture());
  await runGrouped(page, [{ tool: 'prefix_group', grouped: true }]);

  // Only the popover ever shows a skeleton; collapsed rows render fully resident.
  await expect(page.locator('#vs-host .group-row .group-chain.skeleton')).toHaveCount(0);

  // The tripwire never fired: GROUP_FIRST_WINDOW over-covered the collapsed slot.
  const underfill = await page.evaluate(() => window.__grawlixTest.groupWindowUnderfillDebug());
  expect(underfill).toBe(0);

  // "+N more" reads the true total (_count=70), not the window length: shown +
  // collapsed-visible must reconstruct 70.
  const bigRow = page.locator('#vs-host .group-row')
    .filter({ has: page.locator('.group-count', { hasText: '70' }) });
  await expect(bigRow).toHaveCount(1);
  const moreText = await bigRow.locator('.group-more:not([hidden])').innerText();
  const shown = parseInt(moreText.replace(/\D+/g, ''), 10);
  const visibleChains = await bigRow.locator('.group-chain').count();
  expect(shown + visibleChains).toBe(70);
});

// ─── Scroll-fetch: later group ROWS fill in (skeleton → real) ─────────────────

// 80 two-member groups plus one 70-member group keyed "xyz", which sorts after
// every "a.." key and so lands past GROUP_ROW_WINDOW: the scroll-fetch and
// fetched-row "+N more" target.
function scrollFetchFixture() {
  const { entries, scores } = manyGroupsFixture(80);
  let score = 5000;
  for (let i = 0; i < 70; i++) { entries.push('xyz' + pad(i)); scores.push(score--); }
  return { name: 'Scroll', entries, scores };
}

function visibleGroupRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#vs-host .group-row')].map(row => ({
      idx: parseInt(row.dataset.idx, 10),
      skeleton: row.classList.contains('skeleton'),
      top: parseInt(row.style.top, 10),
    })));
}

test('grouped: scrolling past the first window fetches later group rows (skeleton → real, in order)', async ({ page }) => {
  await gotoApp(page);
  await seedScoped(page, scrollFetchFixture());
  await runGrouped(page, [{ tool: 'prefix_group', grouped: true }]);
  await settleGroupWindow(page);

  // Above the fold paints fully resident — no group-row skeletons on first screen.
  expect((await visibleGroupRows(page)).filter(r => r.skeleton)).toEqual([]);

  // Scroll to the bottom (the "xyz" group is the last row, ~index 80) — well past
  // GROUP_ROW_WINDOW, so its row misses the inline window and must be fetched.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await settleGroupWindow(page);

  // Every visible row is real (no skeleton left), absolute indices contiguous and
  // ascending (no gaps), and the bottom row's index is past the inline window.
  const rows = await visibleGroupRows(page);
  expect(rows.filter(r => r.skeleton)).toEqual([]);
  const idxs = rows.map(r => r.idx);
  expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  for (let i = 1; i < idxs.length; i++) expect(idxs[i]).toBe(idxs[i - 1] + 1);
  expect(idxs[idxs.length - 1]).toBeGreaterThan(60);

  // The "xyz" group rode a FETCHED window. It carries the right key (its rownum
  // column reflects its absolute position) and a working "+N more" over its 70
  // chains — the collapsed-visible + hidden count reconstructs 70.
  const xyzRow = page.locator('#vs-host .group-row')
    .filter({ has: page.locator('.group-count', { hasText: '70' }) });
  await expect(xyzRow).toHaveCount(1);
  const moreText = await xyzRow.locator('.group-more:not([hidden])').innerText();
  const shown = parseInt(moreText.replace(/\D+/g, ''), 10);
  const visibleChains = await xyzRow.locator('.group-chain').count();
  expect(shown + visibleChains).toBe(70);

  // The fetched group's "+N more" still opens and lists its chains.
  await xyzRow.locator('.group-more:not([hidden])').click();
  await expect(page.locator('.group-popover')).toBeVisible();
  await expect(page.locator('.group-popover .group-chain').first()).toBeVisible();
});
