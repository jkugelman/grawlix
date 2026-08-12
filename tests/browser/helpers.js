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

// Stub the external entry-lookup APIs the edit panel auto-fires on open (Datamuse,
// Wikipedia, Wiktionary) so tests never reach the real network. A 404 reads as a
// genuine empty — every inline section hidden and the canonical resolver empty-
// handed, all the panel tests need — while the link row and the segmenter-driven
// rename hint still render. A 5xx/network error would instead read as a failure.
async function stubLookupFetches(page) {
  await page.route(/api\.datamuse\.com/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(/wik(ipedia|tionary)\.org/, route =>
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
  // the trash-tier filter (`1+`), so seed the filter off. Seed only when absent:
  // addInitScript re-runs on every navigation, so an unconditional set would
  // clobber a range the test set and silently break reloadApp persistence.
  // seedScoreRange:false → real default.
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

// Chromium under matrix contention drops a frame's main-world context out from
// under an in-flight evaluate — verified: no navigation, no crash, the document
// still rendering — and Playwright blames "a navigation" that never happened.
// So this is a re-ask of a settled condition, not a retry papering over a race.
async function awaitSettle(page, fn, arg) {
  try {
    return await page.evaluate(fn, arg);
  } catch (e) {
    if (!/Execution context was destroyed/.test(e.message)) throw e;
    await page.waitForFunction(() => !!window.__grawlixTest);
    return await page.evaluate(fn, arg);
  }
}

async function whenBootSettled(page) {
  // Wait for init() to fully complete before touching the app — NOT the old
  // `_db !== null` gate. `_db` goes true early (in openDB), before init's tail
  // runs Router.applyURL() + the boot first render; a test resuming on `_db`
  // mutates the stack mid-boot and init's tail then resets it over the test —
  // a stable wrong state polling can't rescue (a boot-vs-test race).
  await awaitSettle(page, () => window.__grawlixTest.whenReady());
  // Then let the boot publisher fetches settle: init() kicks them off fire-and-
  // forget at its tail, and each re-renders the panel. Left pending, that
  // re-render lands mid-test on WebKit and races the test's setStack/edit.
  await awaitSettle(page, () => window.__grawlixTest.loadIdle());
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
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
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
}

// Scope by driving the real selector UI, not the test API — use this (over
// scopeTo) when the test's subject is the selector itself.
async function scopeViaSelector(page, name) {
  await page.locator('#wordlist-bar .wls-trigger').click();
  await page.locator('#wordlist-bar .wls-menu .wordlist-card')
    .filter({ has: page.locator('.card-name', { hasText: name }) })
    .first().click();
  await awaitSettle(page, () => window.__grawlixTest.pipelineIdle());
}

// Expand the wordlist bar's inline rescore/scoring editor. Its content is keyed
// to the current scope, so scope first, then open.
async function openRescoreEditor(page) {
  const toggle = page.locator('#wordlist-bar .rescore-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('#rescore-editor')).toBeVisible();
}

// Edits in the rescore editor are batched into a draft; Apply commits them.
// Gate on the toggle, which Apply flips in the same synchronous handler that
// commits. Gating on the editor's `hidden` instead couples every caller to the
// collapse animation — it lands from a transitionend, which a transition that
// never runs never fires — and strands them with the commit long since done,
// reporting as whatever the caller was asserting about the commit. The teardown
// has its own test in wordlist-selector.spec.js.
async function applyRescoreEditor(page) {
  await page.locator('#rescore-editor .rescore-apply').click();
  await expect(page.locator('#wordlist-bar .rescore-toggle'))
    .toHaveAttribute('aria-expanded', 'false');
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

async function runSearch(page, pattern) {
  await page.evaluate(p => window.__grawlixTest.setStack(
    p === '' ? [] : [{ tool: 'search', params: { pattern: p } }]), pattern);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function settleWindow(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.__grawlixTest.windowIdle());
  // The fetch reply re-renders; let that paint land before reading the DOM.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function settleGroupWindow(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.__grawlixTest.groupWindowIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
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
  awaitSettle,
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
  runSearch,
  settleWindow,
  settleGroupWindow,
  expectVisible,
  expectGroups,
  readVisible,
  readGroups,
};
