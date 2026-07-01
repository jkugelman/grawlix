// Refresh-on-consent — see docs/design.md § Fetching & updates.
//
// A BACKGROUND auto-update never yanks the displayed result. How it applies forks by
// tier: a FLAT result (base list / per-entry filter) re-derives in place — an add/delete
// is a cheap re-scan, so the set refreshes with no prompt (repatch). A COMBINATION tier
// (grouped/tuple/transform) can't be re-scanned safely — one added entry can partner an
// existing one into a new combination — so it pins the result and raises the "Refresh"
// chip instead, and consent (or a new search) re-joins.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

function routeJK(page, feed) {
  return page.route(/jkugelman-wordlist/, route => {
    const body = feed.updated ? feed.updatedBody : feed.initialBody;
    route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'content-length': String(body.length) }, body });
  });
}

async function enableAutoUpdate(page) {
  await page.locator('#btn-settings').click();
  await page.locator('#auto-update-seg .seg-btn[data-val="on"]').click();
  await page.keyboard.press('Escape');
}

test('a background structural auto-update to a FLAT result repatches it in place (no chip, no re-run)', async ({ page }) => {
  const feed = {
    updated: false,
    initialBody: 'alpha;50\nbeta;50\ndelta;50\n',
    updatedBody: 'alpha;50\nbeta;60\nepsilon;50\n',   // delta removed + epsilon added (structural), beta rescored
  };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);   // default scope = All Wordlists, no tools → a flat result
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const chip = page.locator('#stats .results-stale-chip');
  await expect(chip).toBeHidden();
  const before = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());

  feed.updated = true;
  await enableAutoUpdate(page);                                       // kicks an immediate background check

  // A repatch is not a run, so pipelineIdle doesn't cover it — poll until it lands.
  const shownNow = () => page.evaluate(id =>
    window.__grawlixTest.fetchWorkerRows(0, 1e9, id).then(r => r.rows.map(x => x.display ?? x.norm)), before);
  await expect.poll(shownNow).toContain('epsilon');                  // addition applied

  const rows = await page.evaluate(id => window.__grawlixTest.fetchWorkerRows(0, 1e9, id).then(r => r.rows), before);
  const shown = rows.map(r => r.display ?? r.norm);
  expect(shown).not.toContain('delta');                             // deletion applied
  expect(rows.find(r => (r.display ?? r.norm) === 'beta').score).toBe(60);   // rescore applied

  await expect(chip).toBeHidden();                                  // flat never chips
  const after = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  expect(after).toBe(before);                                       // repatched under the same run, not re-run
});

test('a background structural auto-update to a COMBINATION tier pins it and raises the refresh chip', async ({ page }) => {
  const feed = {
    updated: false,
    initialBody: 'salt;50\nlast;50\n',              // one anagram class {salt, last}
    updatedBody: 'salt;60\nlast;50\nslat;50\n',     // slat added — a new anagram of the class (structural), salt rescored
  };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', grouped: true }]));   // all-mode → grouped tier
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const chip = page.locator('#stats .results-stale-chip');
  await expect(chip).toBeHidden();
  const before = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  const members = () => page.evaluate(() =>
    window.__grawlixTest.getVisibleGroups().then(gs => gs.flatMap(g => g.chains.map(c => c[0])).sort()));
  expect(await members()).toEqual(['last', 'salt']);

  feed.updated = true;
  await enableAutoUpdate(page);

  await expect(chip).toBeVisible();                                 // combination change → chip
  expect(await members()).toEqual(['last', 'salt']);               // slat held (re-join needs consent)
  const after = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  expect(after).toBe(before);                                       // pinned — the run was NOT restarted

  await chip.click();                                              // consent
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(chip).toBeHidden();                                 // cleared on re-run
  await expect.poll(members).toEqual(['last', 'salt', 'slat']);    // slat folded in on re-join
  const refreshed = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  expect(refreshed).not.toBe(before);                             // re-ran on consent
});

// The chip path reprojects to keep live scores; that reproject re-buckets over the
// updated corpus, so its histogram layout can change slot count (discrete = one slot per
// distinct score). Main must adopt the shipped layout or its stale-length one mismatches
// the fresh counts, trips buildStatsBarHTML's length guard, and blanks every bar.
test('a background structural auto-update keeps the scoped histogram in sync (no blank bars)', async ({ page }) => {
  const feed = {
    updated: false,
    initialBody: 'salt;50\nlast;50\nalps;60\nslap;60\nxyz;70\n',                              // scores {50,60,70} → 3 slots
    updatedBody: 'salt;50\nlast;50\nalps;60\nslap;60\nxyz;70\ntarps;80\nstrap;80\nparts;90\n', // + {80,90} → 5 slots
  };
  await stubPublisherFetches(page);
  await routeJK(page, feed);
  await gotoApp(page);
  await scopeTo(page, 'John Kugelman');                                             // a single-source scope
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', grouped: true }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const cols = () => page.locator('#stats .histogram-col').count();                 // = the rendered layout's slot count
  const countsLen = () => page.evaluate(() => window.__grawlixTest.resultHistogramCounts()?.length ?? 0);
  expect(await countsLen()).toBe(await cols());                                     // in sync at rest (3 == 3)

  feed.updated = true;
  await enableAutoUpdate(page);
  await expect(page.locator('#stats .results-stale-chip')).toBeVisible();           // structural update landed

  // Counts re-bucket to 5 slots; the rendered layout must follow, or it stays at 3 and blanks.
  await expect.poll(async () => ({ counts: await countsLen(), cols: await cols() })).toEqual({ counts: 5, cols: 5 });
});
