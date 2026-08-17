// A `?entry=` link opens its panel BEFORE the worker's corpus build, so the whole
// pre-build window is user-visible surface: what paints, what is inert, and what is
// marked as still coming. The window is invisible at this fixture's size, so these
// hold the build open (`__grawlixStallBuild`) and release it on purpose — without
// that the suite would assert against an already-finished boot and prove nothing.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

const ENTRIES = ['bagel', 'bagels', 'lox', 'Boney M.', 'Boney M'];
const SCORES  = [50, 40, 60, 70, 30];

const panel     = page => page.locator('#entry-panel');
const splash    = page => page.locator('#splash-screen');
const provSkel  = page => page.locator('.entry-panel-prov-skel');
const provTable = page => page.locator('.entry-panel-prov');
const scoreInp  = page => page.locator('#entry-panel-score');
const entryInp  = page => page.locator('#entry-panel-entry');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function seed(page) {
  await gotoApp(page);
  await page.evaluate(async ([entries, scores]) =>
    window.__grawlixTest.addCustomWordlist({ name: 'Src', entries, scores }), [ENTRIES, SCORES]);
  // Last route wins, so this replaces gotoApp's empty-thesaurus stub.
  await page.route(/api\.datamuse\.com/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ word: 'beigel' }, { word: 'roll' }]),
  }));
}

// Holds the NEXT navigation's corpus build open. Must be an init script: the boot build
// starts inside init(), long before a test can call into the page.
const armStall  = page => page.addInitScript(() => { window.__grawlixStallBuild = true; });
const release   = page => page.evaluate(() => window.__grawlixTest.releaseWorkerBuildForTest());

// Deliberately not gotoApp/reloadApp: both wait on init() completing, which a held build
// never does. The panel is up long before that, which is the whole claim under test.
async function bootStalled(page, route) {
  await armStall(page);
  await page.goto(route);
  await expect(panel(page)).toBeVisible();
  await settled(page);
}

// The panel slides in, and `toBeVisible` resolves the moment it is displayed — so anything
// measuring geometry has to wait out the transform or it reads a half-arrived panel.
const settled = page => expect.poll(() => page.evaluate(() => {
  const t = getComputedStyle(document.getElementById('entry-panel')).transform;
  return t === 'none' ? 0 : new DOMMatrixReadOnly(t).m41;
})).toBe(0);

test('the panel opens while the corpus build is still running', async ({ page }) => {
  await seed(page);
  await bootStalled(page, '/?entry=bagel');

  await expect(splash(page)).toBeVisible();              // boot has NOT finished…
  await expect(page.locator('.entry-row')).toHaveCount(0);  // …and no corpus has landed
  await expect(entryInp(page)).toHaveValue('bagel');     // yet the entry is already named
});

test('the lookup section is live before the wordlists are', async ({ page }) => {
  await seed(page);
  await bootStalled(page, '/?entry=bagel');

  const lookup = page.locator('.entry-panel-lookup');
  await expect(lookup.getByRole('link', { name: /Wikipedia/ })).toBeVisible();
  await expect(lookup.getByRole('link', { name: /Wiktionary/ })).toBeVisible();
  await expect(lookup.getByRole('link', { name: /XWord Info/ })).toBeVisible();
  await expect(lookup).toContainText('beigel');          // the stubbed thesaurus reply

  await expect(splash(page)).toBeVisible();              // still pre-build the whole time
});

test('the panel paints above the splash', async ({ page }) => {
  await seed(page);
  await bootStalled(page, '/?entry=bagel');
  await expect(splash(page)).toBeVisible();

  // Hit-test rather than compare z-index: stacking depends on context, not just the number.
  const topmostIsPanel = await page.evaluate(() => {
    const r = document.getElementById('entry-panel').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit?.closest('#entry-panel');
  });
  expect(topmostIsPanel).toBe(true);
});

test('the fields are inert until the seed arrives, and typing cannot beat it', async ({ page }) => {
  await seed(page);
  await bootStalled(page, '/?entry=bagel');

  await expect(entryInp(page)).toBeDisabled();
  await expect(scoreInp(page)).toBeDisabled();
  await expect(page.locator('#entry-panel .comment-input')).toBeDisabled();
  await expect(page.locator('.entry-panel-save')).toBeDisabled();
  await expect(page.locator('.score-combo-toggle')).toBeDisabled();

  await scoreInp(page).fill('99', { timeout: 1000 }).catch(() => {});   // refused: disabled
  await expect(scoreInp(page)).toHaveValue('');

  await release(page);
  await expect(scoreInp(page)).toBeEnabled();
  await expect(scoreInp(page)).toHaveValue('50');        // the corpus value, not the typed one
});

test('pending placeholders show while the build runs and are replaced by real content', async ({ page }) => {
  await seed(page);
  await bootStalled(page, '/?entry=bagel');

  await expect(provSkel(page)).toBeVisible();
  await expect(provSkel(page).locator('.skeleton-bar').first()).toBeVisible();
  await expect(page.locator('.entry-panel-prov-skel .lookup-sec-head')).toHaveText('Appears in');
  await expect(panel(page)).toHaveClass(/seed-pending/);
  await expect(provTable(page)).toHaveCount(0);          // no real table yet

  await release(page);

  await expect(provSkel(page)).toHaveCount(0);
  await expect(panel(page)).not.toHaveClass(/seed-pending/);
  await expect(provTable(page)).toBeVisible();
  await expect(provTable(page)).toContainText('Src');
});

test('releasing the build retires the splash and leaves the panel open on its entry', async ({ page }) => {
  await seed(page);
  await bootStalled(page, '/?entry=bagel');
  await expect(splash(page)).toBeVisible();

  await release(page);

  await expect(splash(page)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(entryInp(page)).toHaveValue('bagel');
  await expect(page.locator('.entry-row').first()).toBeVisible();   // the table filled in behind it
});

test('a placeholder is never left shimmering for an entry no wordlist has', async ({ page }) => {
  await seed(page);
  await bootStalled(page, '/?entry=ZZZQQQ');
  await release(page);

  // Enabled-and-blank is the honest answer here, and it must be reachable — a pending
  // marker that outlived its query would claim the score is still coming, forever.
  await expect(scoreInp(page)).toBeEnabled();
  await expect(scoreInp(page)).toHaveValue('');
  await expect(panel(page)).not.toHaveClass(/seed-pending/);
  await expect(provSkel(page)).toHaveCount(0);
  await expect(entryInp(page)).toHaveValue('ZZZQQQ');    // not rewritten — nothing to rewrite to
});

// ─── Case routing ────────────────────────────────────────────────────────────
// Links are typed by hand and written by other apps, and crossword tooling writes
// uppercase; every one of those used to open on a blank score.

for (const linked of ['BAGEL', 'Bagel', 'bAgEl']) {
  test(`?entry=${linked} resolves to the entry as the wordlist spells it`, async ({ page }) => {
    await seed(page);
    await page.goto(`/?entry=${linked}`);
    await expect(panel(page)).toBeVisible();

    await expect(scoreInp(page)).toBeEnabled();
    await expect(scoreInp(page)).toHaveValue('50');
    await expect(entryInp(page)).toHaveValue('bagel');   // retitled to the real spelling
    await expect(provTable(page)).toContainText('Src');
  });
}

test('an exact spelling still wins over its same-norm rival', async ({ page }) => {
  await seed(page);

  await page.goto('/?entry=' + encodeURIComponent('Boney M.'));
  await expect(panel(page)).toBeVisible();
  await expect(scoreInp(page)).toBeEnabled();
  await expect(entryInp(page)).toHaveValue('Boney M.');
  await expect(scoreInp(page)).toHaveValue('70');

  await page.goto('/?entry=' + encodeURIComponent('Boney M'));
  await expect(scoreInp(page)).toBeEnabled();
  await expect(entryInp(page)).toHaveValue('Boney M');
  await expect(scoreInp(page)).toHaveValue('30');
});

// ─── Chrome the modal does not occlude ───────────────────────────────────────

// elementsFromPoint, not elementFromPoint: over the header the topmost hit is the
// backdrop (full-bleed for click-outside), so only the whole stack shows which of the
// header and the splash is actually painted over the other.
const headerOverSplash = page => page.evaluate(() => {
  const r = document.querySelector('header').getBoundingClientRect();
  const stack = document.elementsFromPoint(r.left + 40, r.top + r.height / 2);
  const at = pred => stack.findIndex(pred);
  return at(e => e.closest('header')) < at(e => e.id === 'splash-screen');
});

test('an ordinary boot keeps the solo splash, header not shown', async ({ page }) => {
  await seed(page);
  await armStall(page);
  await page.goto('/');                                  // no ?entry= — no panel
  await expect(splash(page)).toBeVisible();

  expect(await headerOverSplash(page)).toBe(false);
});

test('a deep-linked panel shows the header over the splash, and it stays once dismissed', async ({ page }) => {
  await seed(page);
  await bootStalled(page, '/?entry=bagel');
  await expect(splash(page)).toBeVisible();
  expect(await headerOverSplash(page)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(panel(page)).not.toBeVisible();

  // Latched, not tied to the panel: leaving with it and coming back when the splash
  // retires is the flicker this pins against.
  await expect(splash(page)).toBeVisible();
  expect(await headerOverSplash(page)).toBe(true);
});

test('the header still closes the panel on click, undimmed but not interactive', async ({ page }) => {
  await seed(page);
  await page.goto('/?entry=bagel');
  await expect(panel(page)).toBeVisible();

  // Raw mouse, not locator.click: the backdrop covers the header for hit-testing, which
  // is the point — a locator click would refuse it as intercepted rather than exercise it.
  await page.mouse.click(300, 10);
  await expect(panel(page)).not.toBeVisible();
});
