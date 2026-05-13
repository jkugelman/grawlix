# Testing

A Playwright smoke suite covers user-visible behaviors whose breakage would survive a manual play-through — silent data corruption, cross-feature regressions, browser-specific quirks. Visual and layout regressions stay manual.

End-to-end smoke is the right shape for a single-file vanilla-JS app: subtle cross-feature breakage like "editing a score while a filter is active corrupts the override map" is exactly what it catches. Targeted tests at the seams beat comprehensive coverage. CI is a passive monitor, not a gate.

## What earns a test

The suite covers what manual testing structurally misses. Manual already catches visual layout, copy, feel, mobile, and anything obvious within the feature you're actively using — so those don't need automation. Automation pays off for:

- **Silent data corruption.** UI looks fine, underlying state is wrong (the override-map-during-filter case is the archetype).
- **Cross-feature regressions.** Touching A breaks B; you'd only notice next time you used B.
- **Cross-browser quirks.** You only run one browser locally; the suite runs three.
- **Async/timing races.** Flakes that surface intermittently under parallelism.

**Add a test when** the behavior has cross-cutting reach (override map, cache invalidation, persistence boundaries), the bug would survive a five-minute manual play-through, or the behavior sits at a seam where plausible future refactors could re-break it.

**Skip when** the change is purely visual, localized to code with no neighbors that affect it, or experimental code about to be rewritten.

**Regression budget — not automatic.** When a bug is fixed, ask: seam, or typo in bounded code? Seam earns a test; typo doesn't. Pre-launch refactor-heavy phase makes "every bug gets a test" the wrong default — it locks the codebase against changes that need to happen.

**AI-coded caveat.** AI writes and updates tests cheaply, so the suite can grow without much keystroke tax. The subtler cost: AI biases toward "make the test pass," which means a broken assertion gets adjusted instead of investigated. Write assertions where adjusting them is obviously suspicious — see *Strategy* below.

## Strategy

**Hybrid setup-via-API, assert-via-DOM.** Constructing the data shapes the tests want (a custom wordlist with three specific scores, an existing wordlist with rules removed, a wordlist with both an update available *and* uncovered scores) through pure UI clicks would be slow, brittle, and tied to copy. Pure backend assertions miss what the user actually sees. So tests:

1. Build preconditions via `window.__grawlixTest` — a tiny API exposed by `site/index.html` that wraps real internal helpers (`addNewWordlist`, `applyWordlistText`, `setWordlistRescoreRules`). It's a fixture builder, not a backdoor — the data flows through the same plumbing the UI uses.
2. Drive user actions through the real DOM (click cards, type into rule inputs, click reset buttons).
3. Assert against the DOM by default — the rendered bubbles, banners, badges, and badges-on-badges that the user sees. Fall back to state snapshots via `__grawlixTest.getWordlist()` when the DOM doesn't reasonably expose the thing being asserted (e.g. "which wordlist sourced this entry" lives in `rawEntries`, not visible markup). Never assert something the user can't observe — no private `_isBuggy` hooks.

**Assertions describe user-meaningful outcomes** ("BAGEL has score 50"), not implementation details ("rule[3].output equals 50"). Implementation-level assertions break on harmless refactors, produce noise instead of signal, and are easy to "fix" by adjusting them to match the new code — silently watering down what the suite guarantees.

**Publisher fetches are stubbed.** The three auto-fetching publisher wordlists (JK, STWL, Broda) hit `raw.githubusercontent.com` and `grawlix.wtf` on boot. Tests intercept via `page.route()` and return empty bodies by default; tests that need a publisher populated pass their own body. See [`tests/helpers.js`](../tests/helpers.js).

**Fresh browser context per test.** Playwright's default. Each test gets clean localStorage + IndexedDB, so test order doesn't matter and no teardown is needed.

**Three browsers.** Chromium, Firefox, and WebKit. The full suite runs against all three on every push. Cross-browser catches the rare Chrome-only API leak; on a smoke suite the maintenance is cheap because tests target user-visible behavior, not browser-specific quirks. Run one browser at a time during local iteration: `npm test -- --project=chromium`.

## What stays manual

**Visual / layout bugs.** Screenshot diffing (compare each test's rendered PNG against a saved baseline) catches "the icon moved 5px" bugs but is brittle: antialiasing noise, constant baseline updates on every UI tweak, cross-browser font rendering differences. Not worth the maintenance burden for a solo project. Substitute: open the site on Safari, Firefox, and a phone before any release.

**Real mobile Safari.** Playwright's WebKit is a Linux build that approximates Safari but isn't it. iOS-specific bugs only surface on actual devices.

## Out of scope

- **Unit tests.** No meaningful seams — logic is wired to DOM and persistence. Unit testing would mean either testing trivial pure helpers (low value) or rebuilding the DOM/IDB environment in jsdom (high cost, divergence risk).
- **PR gating / branch protection.** CI runs on push to `main` only. For a solo pre-launch project, automation is a regression *signal*, not a release gate.
- **Coverage metrics.** Smoke is the target, not comprehensive coverage. A coverage number would invite chasing it rather than chasing the bugs.

## First-time setup

Requires **Node 18+** (Playwright dropped Node 16). On Ubuntu's older system Node, install via nvm:

```sh
nvm install 20
nvm use 20
```

Then:

```sh
npm install
npx playwright install
sudo npx playwright install-deps   # first time only — installs OS-level browser deps
```

## Cheat sheet

```sh
npm test                              # all browsers, headless — what CI runs
npm test -- --project=chromium        # one browser (fast)
npm test -- tests/smoke.spec.js       # one file
npm test -- -g "auto-seed"            # one test by name (grep)
CI=1 npm test                         # reproduce CI conditions (1 worker, 2 retries)
npm run test:headed                   # opens a real browser window
npm run test:ui                       # interactive runner with time-travel
npm run test:report                   # serve the HTML report from the last run
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
- **Assertion no longer matches but the contract didn't change**: rewrite the assertion at a user-visible level, don't just nudge numbers. Over-specified assertions break on harmless refactors and are at risk of being silently watered down to make the suite green.
- **Flake**: don't paper over with `waitForTimeout` — fix the root cause (an assertion that races a render, a missing `await`, an unstubbed network call).
- **More trouble than it's worth**: delete it. A smoke suite is allowed to shrink.
