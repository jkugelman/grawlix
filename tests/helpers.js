// Shared helpers for the Playwright smoke suite. Keep these small — the goal
// is for individual tests to read top-to-bottom without indirection. Helpers
// here exist only when several tests would otherwise repeat the same setup.

const { expect } = require('@playwright/test');

// Stub the publisher wordlist fetches so the app boots in CI without touching
// the real network. Four publisher wordlists fetch on boot:
//
//   jkugelman → raw.githubusercontent.com
//   stwl      → grawlix.wtf
//   nediger   → grawlix.wtf
//   broda     → grawlix.wtf
//
// (XWI has no auto-fetch URL — it's subscriber-import-only.) The fetch
// happens after init() completes, fire-and-forget. By default each publisher
// gets an empty body, which keeps them unpopulated. Tests that want a
// publisher populated pass `bodies` keyed by publisher id.
//
// Call from a test's `beforeEach` before navigation.
async function stubPublisherFetches(page, bodies = {}) {
  await page.route(/raw\.githubusercontent\.com|grawlix\.wtf/, route => {
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

// Navigate to the app with the given route. Defaults to the bare URL
// (Workshop). Polls until init() has finished opening the IndexedDB so
// callers can immediately call test-API functions that persist data.
async function gotoApp(page, route = '/') {
  // Suppress the first-boot welcome modal: as a showModal() dialog its backdrop
  // would swallow clicks in every test. The welcome test in smoke.spec.js skips
  // this helper to exercise the real first boot.
  await page.addInitScript(() => localStorage.setItem('grawlix_welcomeSeen', '1'));
  await page.goto(route);
  // Wait for init() to fully complete before touching the app — NOT the old
  // `_db !== null` gate. `_db` goes true early (in openDB), before init's tail
  // runs Router.applyURL() + the boot first render; a test resuming on `_db`
  // mutates the stack mid-boot and init's tail then resets it over the test —
  // a stable wrong state polling can't rescue (a boot-vs-test race).
  await page.evaluate(() => window.__grawlixTest.whenReady());
  // Then drain the boot publisher fetches: init() kicks them off fire-and-
  // forget at its tail, and each re-renders the Workshop. Left pending, that
  // re-render lands mid-test on WebKit and races the test's setStack/edit.
  // Wait for every URL-backed source to populate, then let the pipeline settle.
  await expect.poll(
    async () => page.evaluate(() => state.sources.every(w => !w.url || w.populated)),
    { timeout: 10000 }
  ).toBe(true);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Switch to the Library view via the brand-bar nav button.
async function openLibrary(page) {
  await page.locator('.header-nav-item[data-view="library"]').click();
  await expect(page.locator('#library-view')).toBeVisible();
}

// Click a wordlist card by name in the Library list. Library must be open.
async function focusWordlist(page, name) {
  await page.locator('.wordlist-card[data-wordlist]', { hasText: name }).first().click();
}

// Scope the table + tools to a source by name (or 'All' / omit for the merged
// view) via the test API, then wait for the re-rendered pipeline to settle.
async function scopeTo(page, name) {
  await page.evaluate(n => window.__grawlixTest.setScope(n), name);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Scope by driving the real selector UI, not the test API — use this (over
// scopeTo) when the test's subject is the selector itself.
async function scopeViaSelector(page, name) {
  await page.locator('#workshop-wordlist-bar .wls-trigger').click();
  await page.locator('#workshop-wordlist-bar .wls-option', { hasText: name }).first().click();
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Expand the Workshop bar's inline rescore/scoring editor. Its content is keyed
// to the current scope, so scope first, then open.
async function openRescoreEditor(page) {
  const toggle = page.locator('#workshop-wordlist-bar .workshop-rescore-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('#workshop-rescore-editor')).toBeVisible();
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
// The Workshop pipeline is async — setStack / a search / an edit repaints the
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

module.exports = {
  stubPublisherFetches,
  gotoApp,
  openLibrary,
  focusWordlist,
  scopeTo,
  scopeViaSelector,
  openRescoreEditor,
  addTool,
  expectVisible,
  expectGroups,
  readVisible,
  readGroups,
};
