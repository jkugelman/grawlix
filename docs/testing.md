# Testing

A small Playwright smoke suite covers the user-visible behaviors that are hardest to verify by hand — features whose surface depends on a particular *data shape* (specific score distributions, simultaneous warning states, edits that flip a dirty flag, etc.). Visual / layout regressions stay manual.

Background and policy live in [`plans/ci-testing.md`](plans/ci-testing.md). This doc is the day-to-day handbook.

## Strategy

**Hybrid setup-via-API, assert-via-DOM.** Constructing the data shapes the tests want (a custom wordlist with three specific scores, an existing wordlist with rules removed, a wordlist with both an update available *and* uncovered scores) through pure UI clicks would be slow, brittle, and tied to copy. Pure backend assertions miss what the user actually sees. So tests:

1. Build preconditions via `window.__grawlixTest` — a tiny API exposed by `site/index.html` that wraps real internal helpers (`addNewWordlist`, `applyWordlistText`, `setWordlistRescoreRules`). It's a fixture builder, not a backdoor — the data flows through the same plumbing the UI uses.
2. Drive user actions through the real DOM (click cards, type into rule inputs, click reset buttons).
3. Assert against the DOM — the rendered bubbles, banners, badges, and badges-on-badges that the user sees.

**Publisher fetches are stubbed.** The three auto-fetching publisher wordlists (JK, STWL, Broda) hit `raw.githubusercontent.com` and `grawlix.wtf` on boot. Tests intercept via `page.route()` and return empty bodies by default; tests that need a publisher populated pass their own body. See [`tests/helpers.js`](../tests/helpers.js).

**Fresh browser context per test.** Playwright's default. Each test gets clean localStorage + IndexedDB, so test order doesn't matter and no teardown is needed.

**One browser today.** Chromium only. WebKit and Firefox are easy to flip on in `playwright.config.js` if the multi-browser signal earns its keep.

**No screenshot diffing, no unit tests, no PR gating.** All three intentional — see [`plans/ci-testing.md`](plans/ci-testing.md).

## First-time setup

Requires **Node 18+** (Playwright dropped Node 16). On Ubuntu's older system Node, install via nvm:

```sh
nvm install 20
nvm use 20
```

Then:

```sh
npm install
npx playwright install chromium
npx playwright install-deps chromium    # first time only, may need sudo
```

## Cheat sheet

```sh
npm test                         # all tests, headless — what CI runs
npm test -- tests/smoke.spec.js  # one file
npm test -- -g "auto-seed"       # one test by name (grep)
CI=1 npm test                    # reproduce CI conditions (1 worker, 2 retries)
npm run test:headed              # opens a real browser window
npm run test:ui                  # interactive runner with time-travel
npm run test:report              # serve the HTML report from the last run
```

`CI=1` is worth knowing: local runs default to parallel workers, but CI uses one worker, which surfaces timing races (e.g. a click handler that hands off async work that the next assertion reads too early). If a test passes locally but fails in CI, run with `CI=1` first.

`npm run test:report` serves on `localhost:9323`; open it in your browser to inspect failures with screenshots, traces, and step-by-step playback. **This is the easiest way to debug from WSL** — failed-test artifacts are recorded automatically (`trace: retain-on-failure`).

## Running headed under WSL

WSL2 on Windows 11 ships with WSLg (X11/Wayland for free), so `npm run test:headed` opens a Linux Chrome window on your Windows desktop. On older WSL builds without WSLg, stick with headless + the HTML report.

## `window.__grawlixTest` API

Exposed unconditionally in `site/index.html` (see the *Test API* section near the bottom). Small and stable; routes through real internal codepaths.

| Function | What it does |
|---|---|
| `addCustomWordlist({name, scores, comments?, enabled?})` | Add a populated custom wordlist (no `publisherId`). Goes through `applyWordlistText`, so the auto-seed path fires. |
| `setRescoreRules(name, rules)` | Replace a wordlist's rescore rules via `setWordlistRescoreRules`. Rules shape: `{input, length, output, note?}`. |
| `setUpdateAvailable(name, value)` | Toggle the transient `_updateAvailable` flag and repaint. Used to put info + warning severities on the same wordlist. |
| `getWordlist(name)` | Read-only snapshot of the fields tests care about (`rescoreRules`, `uncovered`, `dirty`, `updateAvailable`, etc.). |

Adding a function is fine; renaming or repurposing an existing one means updating every test that uses it.

## Adding a test

Pattern:

```js
const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary, focusWordlist } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('feature does the right thing', async ({ page }) => {
  await gotoApp(page);

  // Set up preconditions.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Test', scores: [10, 50, 90],
  }));

  // Drive the UI.
  await openLibrary(page);
  await focusWordlist(page, 'Test');

  // Assert against the DOM.
  await expect(page.locator('#rescore-rules .rule-row')).toHaveCount(3);
});
```

**Don't use `waitForTimeout`.** Use `expect.poll` or auto-retrying assertions (`expect(locator).toBeVisible()`). The smoke suite has zero hardcoded sleeps; keep it that way.

## CI

GitHub Actions runs the suite on push to `main` only — no PR gating. Failed runs upload traces and screenshots as artifacts; download from the run page to inspect.

## When a test breaks

- **Intentional behavior change**: update the test in the same commit. Don't leave a stale test sitting in `.skip()`.
- **Flake**: don't paper over with `waitForTimeout` — fix the root cause (an assertion that races a render, a missing `await`, an unstubbed network call).
- **More trouble than it's worth**: delete it. A smoke suite is allowed to shrink.
