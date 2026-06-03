// Shared helpers for the Playwright smoke suite. Keep these small — the goal
// is for individual tests to read top-to-bottom without indirection. Helpers
// here exist only when several tests would otherwise repeat the same setup.

const { expect } = require('@playwright/test');

// Stub the publisher wordlist fetches so the app boots in CI without touching
// the real network. Three publisher wordlists fetch on boot:
//
//   jkugelman → raw.githubusercontent.com
//   stwl      → grawlix.wtf
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
    if (url.includes('jkugelman-wordlist.txt'))       body = bodies.jkugelman ?? '';
    else if (url.includes('spreadthewordlist.txt'))   body = bodies.stwl ?? '';
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
  // Don't wait on the busy overlay — it's removed synchronously by the boot
  // scaffolding when localStorage is empty, before init() even runs. _db
  // going non-null is the actual signal that init()'s `await openDB()` has
  // resolved (Chromium wins this race incidentally; Firefox doesn't, and 5s
  // isn't enough under heavy parallel-worker load — was flaking ~5%).
  await expect.poll(async () => page.evaluate(() => _db !== null), { timeout: 10000 }).toBe(true);
  // Then drain the boot publisher fetches: init() kicks them off fire-and-
  // forget after _db is set, and each re-renders the Workshop. Left pending,
  // that re-render lands mid-test on WebKit and races the test's setStack/edit.
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

async function addTool(page, toolKey) {
  await page.locator('#tool-picker-search').click();
  await expect(page.locator('#featured-row')).toHaveClass(/expanded/);
  await page.evaluate((key) => {
    document.querySelector(`#featured-row .picker-gallery .tool-card[data-tool="${key}"]`)?.click();
  }, toolKey);
  await expect(page.locator('#featured-row')).not.toHaveClass(/expanded/);
}

module.exports = {
  stubPublisherFetches,
  gotoApp,
  openLibrary,
  focusWordlist,
  addTool,
};
