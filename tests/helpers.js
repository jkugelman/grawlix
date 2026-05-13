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
// (Workshop). Awaits the busy overlay disappearing so callers can interact
// immediately.
async function gotoApp(page, route = '/') {
  await page.goto(route);
  // The busy overlay covers the page during init() and is removed on the
  // post-fade transitionend. Waiting for it to be detached is the cleanest
  // ready-signal we have.
  await expect(page.locator('#busy-overlay')).toHaveCount(0, { timeout: 5000 });
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

module.exports = {
  stubPublisherFetches,
  gotoApp,
  openLibrary,
  focusWordlist,
};
