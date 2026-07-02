// Shared helpers for the Playwright smoke suite. Keep these small — the goal
// is for individual tests to read top-to-bottom without indirection. Helpers
// here exist only when several tests would otherwise repeat the same setup.

import { expect } from '@playwright/test';
import { TOOLS } from '../../site/src/engine/tools.js';

// Stub the publisher wordlist fetches so the app boots in CI without touching
// the real network. Four publisher wordlists fetch on boot:
//
//   jkugelman → raw.githubusercontent.com
//   stwl      → raw.githubusercontent.com
//   nediger   → raw.codeberg.page
//   broda     → raw.githubusercontent.com
//
// (XWI has no auto-fetch URL — it's subscriber-import-only.) The fetch
// happens after init() completes, fire-and-forget. By default each publisher
// gets an empty body, which keeps them unpopulated. Tests that want a
// publisher populated pass `bodies` keyed by publisher id.
//
// Call from a test's `beforeEach` before navigation.
async function stubPublisherFetches(page, bodies = {}) {
  await page.route(/raw\.githubusercontent\.com|raw\.codeberg\.page/, route => {
    const url = route.request().url();
    let body = '';
    if (url.includes('jkugelman-wordlist.txt'))        body = bodies.jkugelman ?? '';
    else if (url.includes('spreadthewordlist.txt'))    body = bodies.stwl ?? '';
    else if (url.includes('Nediger'))                  body = bodies.nediger ?? '';
    else if (url.includes('peter-broda-wordlist.txt')) body = bodies.broda ?? '';
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { 'content-length': String(body.length) },
      body,
    });
  });
}

// Stub the external entry-lookup APIs the edit panel auto-fires on open
// (Datamuse, Wikipedia, Dictionary) so tests never reach the real network.
// Empty/404 bodies leave every inline section hidden — all the panel tests
// need — while the link row still renders.
async function stubLookupFetches(page) {
  await page.route(/api\.datamuse\.com/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(/wikipedia\.org|dictionaryapi\.dev/, route =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
}

// Navigate to the app with the given route. Defaults to the bare URL.
// Polls until init() has finished opening the IndexedDB so callers can
// immediately call test-API functions that persist data.
async function gotoApp(page, route = '/', { seedScoreRange = true } = {}) {
  await stubLookupFetches(page);
  // Mark the visitor returning and every tool already seen, so the new-tools
  // reveal — a full-screen overlay — never fires and swallows clicks in tests.
  await page.addInitScript(() => localStorage.setItem('grawlix_returningVisitor', '1'));
  await page.addInitScript(slugs => localStorage.setItem('grawlix_seenTools', JSON.stringify(slugs)), Object.keys(TOOLS));
  // The suite asserts against an unfiltered corpus, but new users now default to
  // 20+, so seed the filter off. Seed only when absent: addInitScript re-runs on
  // every navigation, so an unconditional set would clobber a range the test set
  // and silently break reloadApp persistence. seedScoreRange:false → real default.
  if (seedScoreRange) await page.addInitScript(() => {
    if (localStorage.getItem('grawlix_scoreRange') === null) localStorage.setItem('grawlix_scoreRange', '');
  });
  await page.goto(route);
  await whenBootSettled(page);
}

// The reload counterpart to gotoApp (the addInitScript returningVisitor persists across
// the reload). Gate reload tests on this, not on polling a data property like
// `populated`: keying off when a field happens to be set couples the test to boot
// timing and breaks silently when that timing changes.
async function reloadApp(page) {
  await page.reload();
  await whenBootSettled(page);
}

async function whenBootSettled(page) {
  // Wait for init() to fully complete before touching the app — NOT the old
  // `_db !== null` gate. `_db` goes true early (in openDB), before init's tail
  // runs Router.applyURL() + the boot first render; a test resuming on `_db`
  // mutates the stack mid-boot and init's tail then resets it over the test —
  // a stable wrong state polling can't rescue (a boot-vs-test race).
  await page.evaluate(() => window.__grawlixTest.whenReady());
  // Then let the boot publisher fetches settle: init() kicks them off fire-and-
  // forget at its tail, and each re-renders the panel. Left pending, that
  // re-render lands mid-test on WebKit and races the test's setStack/edit.
  await page.evaluate(() => window.__grawlixTest.loadIdle());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Scope the table + tools to a source by name (or 'All Wordlists' / omit for the
// merged view) via the test API, then wait for the re-rendered pipeline to settle.
async function scopeTo(page, name) {
  // setScope no-ops when the scope is unchanged — re-entering All Wordlists, the
  // boot-default scope, forces no fresh run. A seed-then-read test then trusts
  // seedCorpus's one-shot scroller paint, which an under-load strand can leave
  // empty; force a re-pull from the settled worker so the read can't race it.
  const changed = await page.evaluate(n => window.__grawlixTest.setScope(n), name);
  if (!changed) await page.evaluate(() => window.__grawlixTest.refreshScroller());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Scope by driving the real selector UI, not the test API — use this (over
// scopeTo) when the test's subject is the selector itself.
async function scopeViaSelector(page, name) {
  await page.locator('#wordlist-bar .wls-trigger').click();
  await page.locator('#wordlist-bar .wls-menu .wordlist-card')
    .filter({ has: page.locator('.card-name', { hasText: name }) })
    .first().click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Expand the wordlist bar's inline rescore/scoring editor. Its content is keyed
// to the current scope, so scope first, then open.
async function openRescoreEditor(page) {
  const toggle = page.locator('#wordlist-bar .rescore-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('#rescore-editor')).toBeVisible();
}

// Edits in the rescore editor are batched into a draft; Apply commits them.
async function applyRescoreEditor(page) {
  await page.locator('#rescore-editor .rescore-apply').click();
  await expect(page.locator('#rescore-editor')).toBeHidden();
}

async function openManagePanel(page) {
  await page.locator('#wordlist-bar .wls-trigger').click();
  await page.locator('#wordlist-bar .wls-configure-footer').click();
  await expect(page.locator('#manage-dialog')).toBeVisible();
}

// Importing data force-enables a list, so disabling has to happen after
// population through this real toggle path, then Apply to reach canonical state.
async function setEnabledViaPanel(page, name, enabled) {
  await openManagePanel(page);
  const toggle = page.locator(
    `#manage-dialog .wordlist-card label.toggle[aria-label="Toggle ${name}"]`);
  const input = toggle.locator('input[type="checkbox"]');
  if ((await input.isChecked()) !== enabled) await toggle.click();
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
}

async function barKebabAction(page, label) {
  const kebab = page.locator('#wordlist-bar .wls-actions .wls-kebab');
  await kebab.locator('.more-menu-btn').click();
  await expect(kebab).toHaveClass(/open/);
  await kebab.locator('.split-btn-menu button', { hasText: label }).click();
}

async function addTool(page, toolKey) {
  await page.locator('#tool-picker-search').click();
  await expect(page.locator('#featured-row')).toHaveClass(/expanded/);
  await page.evaluate((key) => {
    document.querySelector(`#featured-row .picker-gallery .tool-card[data-tool="${key}"]`)?.click();
  }, toolKey);
  await expect(page.locator('#featured-row')).not.toHaveClass(/expanded/);
}

// ─── Reading async pipeline output ────────────────────────────────────────
//
// The entries pipeline is async — setStack / a search / an edit repaints the
// scroller a frame or two later. A single snapshot read races that repaint:
// green on chromium/firefox, flaky on webkit under load. Always poll. The
// anti-pattern and its history live in docs/testing.md § "Reading async
// pipeline output".
async function expectVisible(page, expected, { ordered = false } = {}) {
  const norm = arr => (ordered ? arr : [...arr].sort());
  await expect.poll(async () => norm(await readVisible(page))).toEqual(norm(expected));
}

async function expectGroups(page, project, expected) {
  await expect.poll(async () => project(await readGroups(page))).toEqual(expected);
}

// Raw reads — ONLY for a follow-up assertion after expectVisible/expectGroups
// already polled the state to a settle, or inside your own expect.poll. A bare
// read as a test's first/only assertion is the flake.
function readVisible(page) { return page.evaluate(() => window.__grawlixTest.getVisibleEntries()); }
function readGroups(page)  { return page.evaluate(() => window.__grawlixTest.getVisibleGroups()); }

export {
  stubPublisherFetches,
  gotoApp,
  reloadApp,
  scopeTo,
  scopeViaSelector,
  openRescoreEditor,
  applyRescoreEditor,
  openManagePanel,
  setEnabledViaPanel,
  barKebabAction,
  addTool,
  expectVisible,
  expectGroups,
  readVisible,
  readGroups,
};
