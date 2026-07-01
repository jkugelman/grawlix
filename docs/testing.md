# Testing

Two tiers. A **Playwright browser suite** ([`tests/browser/`](../tests/browser/)) covers user-visible behaviors whose breakage would survive a manual play-through — silent data corruption, cross-feature regressions, browser-specific quirks; visual and layout regressions stay manual. A **`node:test` unit tier** ([`tests/unit/`](../tests/unit/)) covers pure logic — parsing, rescoring, the 3-way merge, schema migrations, every tool's run/group output — by importing the `engine/` and `data/` modules directly and running them with no browser, so branchy arithmetic and ordering that's awkward to reach through the DOM gets pinned directly.

End-to-end smoke is the right shape for this vanilla-JS app: subtle cross-feature breakage like "editing a score in My Edits patches the merged cache wrong" is exactly what it catches. Targeted tests at the seams beat comprehensive coverage. CI is a passive monitor, not a gate.

## What earns a test

The suite covers what manual testing structurally misses. Manual already catches visual layout, copy, feel, mobile, and anything obvious within the feature you're actively using — so those don't need automation. Automation pays off for:

- **Silent data corruption.** UI looks fine, underlying state is wrong (the merged-cache patch diverging from a full rebuild is the archetype).
- **Cross-feature regressions.** Touching A breaks B; you'd only notice next time you used B.
- **Cross-browser quirks.** You only run one browser locally; the suite runs three.
- **Async/timing races.** Flakes that surface intermittently under parallelism.

**Add a test when** the behavior has cross-cutting reach (the merged-cache patch, cache invalidation, persistence boundaries), the bug would survive a five-minute manual play-through, or the behavior sits at a seam where plausible future refactors could re-break it.

**Skip when** the change is purely visual, localized to code with no neighbors that affect it, or experimental code about to be rewritten.

**Regression budget — not automatic.** When a bug is fixed, ask: seam, or typo in bounded code? Seam earns a test; typo doesn't. A refactor-heavy codebase makes "every bug gets a test" the wrong default — it locks the codebase against changes that need to happen.

**The one always-test exception: schema migrations.** Every `MIGRATIONS` step ships a permanent before→after fixture test, no judgment call. A migration must keep transforming *historical* data correctly forever, and only a frozen old-version fixture catches a step that later code churn silently breaks. See [`migration.md` § Testing migrations](migration.md#testing-migrations).

**AI-coded caveat.** AI writes and updates tests cheaply, so the suite can grow without much keystroke tax. The subtler cost: AI biases toward "make the test pass," which means a broken assertion gets adjusted instead of investigated. Write assertions where adjusting them is obviously suspicious — see *Strategy* below.

## Strategy

**Hybrid setup-via-API, assert-via-DOM.** Constructing the data shapes the tests want (a custom wordlist with three specific scores, an existing wordlist with rules removed, a wordlist with an update available) through pure UI clicks would be slow, brittle, and tied to copy. Pure backend assertions miss what the user actually sees. So tests:

1. Build preconditions via `window.__grawlixTest` — a tiny API (assembled in [`site/src/test-api.js`](../site/src/test-api.js)) that wraps real internal helpers (`addNewWordlist`, `applyWordlistText`, `setWordlistRescoreRules`). It's a fixture builder, not a backdoor — the data flows through the same plumbing the UI uses.
2. Drive user actions through the real DOM (click cards, type into rule inputs, click reset buttons).
3. Assert against the DOM by default — the rendered bubbles, banners, badges, and badges-on-badges that the user sees. Fall back to state snapshots via `__grawlixTest.getWordlist()` when the DOM doesn't reasonably expose the thing being asserted (e.g. "which wordlist sourced this entry" lives in `rawEntries`, not visible markup). Never assert something the user can't observe — no private `_isBuggy` hooks.

**Assertions describe user-meaningful outcomes** ("BAGEL has score 50"), not implementation details ("rule[3].output equals 50"). Implementation-level assertions break on harmless refactors, produce noise instead of signal, and are easy to "fix" by adjusting them to match the new code — silently watering down what the suite guarantees.

**Don't assert element counts or static UI copy.** How many buttons a dialog renders, or a label's exact words, is markup and copy — not behavior. It churns constantly, so a test pinned to it breaks on every wording or layout tweak without catching a real regression (it tests the copy). Assert the outcome the controls produce — a sync attaches, an entry is written, a badge appears — not that there are two buttons reading X and Y. When a design change makes such a test fail, delete it rather than rewrite it, unless it guards genuine behavior.

**Publisher fetches are stubbed.** The four auto-fetching publisher wordlists (JK, STWL, Broda, Nediger) hit `raw.githubusercontent.com` and `grawlix.wtf` on boot. Tests intercept via `page.route()` and return empty bodies by default; tests that need a publisher populated pass their own body. See [`tests/browser/helpers.js`](../tests/browser/helpers.js).

**Fresh browser context per test.** Playwright's default. Each test gets clean localStorage + IndexedDB, so test order doesn't matter and no teardown is needed.

**Three browsers.** Chromium, Firefox, and WebKit. The full suite runs against all three on every push. Cross-browser catches the rare Chrome-only API leak; on a smoke suite the maintenance is cheap because tests target user-visible behavior, not browser-specific quirks. Run one browser at a time during local iteration: `npm run test:browser -- --project=chromium`.

## What stays manual

**Visual / layout bugs.** Screenshot diffing (compare each test's rendered PNG against a saved baseline) catches "the icon moved 5px" bugs but is brittle: antialiasing noise, constant baseline updates on every UI tweak, cross-browser font rendering differences. Not worth the maintenance burden for a solo project. Substitute: open the site on Safari, Firefox, and a phone before any release.

**One sanctioned exception: [`tests/browser/search-bar-layout.spec.js`](../tests/browser/search-bar-layout.spec.js).** The search bar earned dedicated pixel-geometry tests (input widths, control gaps, vertical centering, all via `getBoundingClientRect`) after a run of fiddly layout regressions that manual play-throughs kept missing — the user explicitly authorized them. They are a deliberate carve-out from the rule above, not drift; don't delete them on a philosophy pass. If the search-bar layout is intentionally reworked, update the measurements rather than removing the file. (`tests/browser/stats-bar-layout.spec.js` mixes geometry with genuine responsive show/hide behavior — keep the show/hide assertions regardless.) [`tests/browser/entry-panel-shell.spec.js`](../tests/browser/entry-panel-shell.spec.js) is the same kind of carve-out: it measures the entry panel's docked column (floating over the table without narrowing it) versus its full-screen overlay shell via `boundingBox` — geometry that the two responsive shells turn on and that play-throughs miss.

**Real mobile Safari.** Playwright's WebKit is a Linux build that approximates Safari but isn't it. iOS-specific bugs only surface on actual devices.

**Real File System Access.** The native file pickers and permission prompts can't be driven headless. `tests/browser/disk-sync.spec.js` installs an in-memory fake for `showOpenFilePicker` / `showSaveFilePicker` / the handle, so the app's own attach/reconcile/write code is exercised, but the picker UI, permission grant, and boot reconnect-splash flow stay manual. The 3-way merge — the deletion-resurrection risk — is also covered directly via `sync.merge3`, which needs no fake at all. The action-row **sync pill** is asserted at the DOM level against the same fake — that it reflects sync state (the synced filename) once a list is attached. The sync **dialog's** button layout and copy aren't pinned by tests — that's brittle markup/copy (see *Strategy*); the doors' behavior is exercised through the attach paths (`sync.attachMirror` with and without `{ existing }`, `attachEditsExisting`/`attachEditsNew`), including that a mirror's "use existing" overwrites the target file with rescored output.

## Unit tier (`tests/unit/`)

Pure logic — parsing, rescoring, the My Edits 3-way merge, schema migrations — lives in real `engine/` and `data/` modules, so the unit tier just **imports it directly**:

- **Direct imports.** A spec imports the functions under test straight from their module — `import { toNorm } from '../../site/src/engine/norm.js'`, `import { threeWayMergeEdits } from '../../site/src/engine/edits-merge.js'`. No extraction harness, no source-text slicing; the `engine/` layer is DOM-free by construction (see [`design.md` § Code structure](design.md#code-structure)), so it loads in plain Node with nothing to stub. [`tests/unit/engine-dom-free.test.js`](../tests/unit/engine-dom-free.test.js) *enforces* that property rather than trusting it: it imports every `engine/` module under throwing getters on `document`/`window`/`localStorage`, so a stray DOM reach fails CI. The few `data/` functions the unit tier reaches are pure, param-driven entry points (the migration blob-transformers); anything `state`- or DOM-coupled stays in the browser tier.
- **The runner.** `node:test` + `node:assert/strict`, no new dependencies. Specs are `tests/unit/*.test.js`; run `npm run test:unit` (or `node --test tests/unit/`). CI runs it in the build job, gating the browser matrix.

**What belongs here:** deterministic transforms with no browser-specific behavior — string→string, score mapping, dedup, sort/priority ordering, serialization, the 3-way merge, migration blob-transformers. Especially the branchy paths that are awkward to reach through Playwright: rescore range-output scaling and N+ shift, the rule-priority tie-break with *overlapping* rules, malformed-line parsing, `detectCase`'s ratio threshold.

**What stays in the browser tier:** anything touching `state`, the DOM, persistence, or rendering — the `state`-reading wrappers (`editsLegend`, `getRescoredEntries`'s cache), the whole `ui/`/`app/` surface, and the rendered scroller. The executor itself is `engine/`, so the *pipeline's* pure core (tool runs, `bucketize`, `unify`) is unit-tested; only its rendering and the surrounding wiring stay here. The layering is the guide: if a function lives in `engine/` or is a pure `data/` transform, it's unit-testable; if importing it would drag in `state` or DOM, it belongs in the browser tier. Schema migrations keep their mandated frozen before→after fixture in [`tests/unit/migrations.test.js`](../tests/unit/migrations.test.js).

Each tool's full contract lives in the unit tier. Every tool is its own `engine/tools/<slug>.js`, and the executor (`executePipeline`/`bucketize`/`unify`) is a DOM-free export, so a spec drives a tool the way the app does — params + a fixture in, rows/atoms/highlights out — against the real pipeline with no browser. See *Per-tool specs* below.

## Out of scope

- **PR gating / branch protection.** CI runs on push to `main` only. For a solo project, automation is a regression *signal*, not a release gate.
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
npm test              # both tiers: unit, then the browser suite against the bundled dist/
npm run test:unit     # node:test unit tier (fast, no browser)
npm run test:browser  # browser suite against the unbundled site/ — what CI's matrix jobs run
npm run test:dist     # build + browser suite against the bundled dist/ (what npm test invokes)
npm run test:headed   # opens a real browser window
npm run test:ui       # interactive runner with time-travel
npm run test:report   # serve the HTML report from the last run

# Targeted browser runs pass Playwright args through test:browser:
npm run test:browser -- --project=chromium           # one browser (fast)
npm run test:browser -- tests/browser/smoke.spec.js  # one file
npm run test:browser -- -g "auto-seed"               # one test by name (grep)
CI=1 npm run test:browser                            # reproduce CI (1 worker, 2 retries)
```

`CI=1` is worth knowing: local runs default to parallel workers, but CI uses one worker, which surfaces timing races (e.g. a click handler that hands off async work that the next assertion reads too early). If a test passes locally but fails in CI, run with `CI=1` first.

`npm run test:report` serves on `localhost:9323`; open it in your browser to inspect failures with screenshots, traces, and step-by-step playback. **This is the easiest way to debug from WSL** — failed-test artifacts are recorded automatically (`trace: retain-on-failure`).

## Running headed under WSL

WSL2 on Windows 11 ships with WSLg (X11/Wayland for free), so `npm run test:headed` opens a Linux Chrome window on your Windows desktop. On older WSL builds without WSLg, stick with headless + the HTML report.

## `window.__grawlixTest` API

Assembled in [`site/src/test-api.js`](../site/src/test-api.js) — the one module that imports from every layer, loaded last by `main.js`, which assigns `window.__grawlixTest` unconditionally (the assignment survives bundling). Small and stable; routes through real internal codepaths.

| Function | What it does |
|---|---|
| `addCustomWordlist({name, scores, entries?, comments?, enabled?})` | Add a populated custom wordlist (no `publisherId`). Goes through `applyWordlistText`, so the auto-seed path fires. Pass `entries` to specify entry names (parallel to `scores`); defaults to auto-named `WORD001`, `WORD002`, … |
| `setRescoreRules(name, rules)` | Replace a wordlist's rescore rules via `setWordlistRescoreRules`. Rules shape: `{input, length, output, note?}`. |
| `setScoring(rules)` | Replace the tier scale (`state.scoring`) via the editor-Save data path (persist + propagate to non-dirty legends), bypassing the draft the editor edits live. |
| `propagateDefaults()` | Run the boot-time `propagateDefaults()` directly — used to assert that a non-dirty list with rules in a non-default order is renormalized without being marked dirty. |
| `setUpdateAvailable(name, value)` | Toggle the transient `_updateAvailable` flag and repaint. Used to put info + warning severities on the same wordlist. |
| `moveBefore(name, beforeName)` | Reorder `state.sources` so `name` lands at `beforeName`'s position. Routes through `reorderSources` so caches invalidate the same way a drag does. |
| `getMergedEntry(entry)` | Read-only snapshot of the merged `All Wordlists` view for a single entry: `{score, comment, wordlist}`. The sourcing wordlist is observable via the row's entry panel, but `.atom-source` is hidden at narrow viewport widths. |
| `getWordlist(name)` | Read-only snapshot of the fields tests care about (`entries`, `rescoreRules`, `dirty`, `updateAvailable`, etc.). |
| `exportText(format)` | Run an export builder against the current pipeline output and return its result. `format` is `'copy'`, `'wordlist'`, `'csv'`, or `'json'`. Returns a string for copy/csv, an object `{text, count, skipped}` for wordlist, and the data object for json. Awaits `pipelineIdle` first. |
| `exportFilename(ext)` | Run the same filename builder Download menu items use, against the current tool stack. Returns the sanitized filename including extension. |
| `sync.merge3(base, file, idb)` | Run the pure My Edits 3-way merge over three wordlist-text inputs. Returns `{resolved: [...], conflicts: [...]}` for asserting deletion-doesn't-resurrect and conflict detection without any file I/O. |
| `sync.attachMirror(name, {existing}?)` / `attachEditsExisting()` / `attachEditsNew()` / `reconcileEdits()` / `isSynced(name)` / `filename(name)` / `flushWrites()` | Drive the real disk-sync attach/reconcile/write paths against the fake File System Access layer the test installs (`name === 'All Wordlists'` targets the merged mirror; `attachMirror`'s `{existing: true}` exercises the write-to-existing-file door). See [`tests/browser/disk-sync.spec.js`](../tests/browser/disk-sync.spec.js). |

Adding a function is fine; renaming or repurposing an existing one means updating every test that uses it.

## Adding a test

Pattern:

```js
const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeViaSelector, openRescoreEditor } = require('./helpers');

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
  await scopeViaSelector(page, 'Test');
  await openRescoreEditor(page);

  // Assert against the DOM.
  await expect(page.locator('#rescore-rules .rule-row')).toHaveCount(3);
});
```

**Don't use `waitForTimeout`.** Use `expect.poll` or auto-retrying assertions (`expect(locator).toBeVisible()`). The smoke suite has zero hardcoded sleeps; keep it that way.

### Per-tool specs live in the unit tier

Every gallery tool gets its own spec under `tests/unit/tools/`, named for the tool's key in `TOOLS` — `tests/unit/tools/<tool>.test.js`. The shared [`harness.js`](../tests/unit/tools/harness.js) builds a merged wordlist from a compact fixture (a string is the entry; an object carries `score`/`comment`/`display`) and runs the tool through the real exported `executePipeline`, so the spec asserts that tool's *own* contract — params, filter / transform / group behavior, the inert cases, and highlight ranges — exactly as the app produces them, no browser. `visible(fixture, stack)` returns the words per row (mirroring `getVisibleEntries` — a lone word is a string, a chain an array), `groups(...)` the grouped projection (seeds, count, anchor), and `highlightTexts(atom)` the marked substrings. The existing files (`anagrams.test.js`, `behead.test.js`, `search.test.js`) are the template. **When you add a tool to `TOOLS`, add its unit spec.**

Keep each file to the tool's own contract. Cross-tool *pipeline* mechanics — unification across tools, sort tiers, URL round-trips, the permanent search bar, atom truncation, popovers — stay in the browser-tier [`tests/browser/tools.spec.js`](../tests/browser/tools.spec.js), which drives the rendered DOM. The browser `tests/browser/tools/` directory keeps a single file, [`highlights.spec.js`](../tests/browser/tools/highlights.spec.js): the one render shape nothing else covers — a find/replace transform painting its output atom's marks with the match color echoed. Highlight-range *computation* is unit-tested ([`search-highlight.test.js`](../tests/unit/search-highlight.test.js), [`regex-tool.test.js`](../tests/unit/regex-tool.test.js)), and the range→`<mark>`/`<span>` mapping is pinned by `renderHighlightedText` there, so per-tool highlight rendering needs no browser.

### Reading async pipeline output

The results pipeline is **asynchronous**: `setStack`, a search keystroke, or an entry edit kicks off a fire-and-forget run that repaints the entries scroller a frame or two later. A test that reads the rendered rows *once*, right after the interaction —

```js
const visible = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
expect(visible.sort()).toEqual(['kayak', 'noon', 'racecar']);   // ❌ races the repaint
```

— passes on chromium/firefox (they settle fast) and flakes on webkit under load (it doesn't). The output isn't wrong; the read lands before the pipeline finishes painting. (The big 2026-06 webkit shard failure turned out to be a separate boot-vs-test race in `gotoApp`, not this — but the snapshot read is still a genuine flake class, so poll regardless.)

**Always poll the read.** [`tests/browser/helpers.js`](../tests/browser/helpers.js) provides the wrappers — use them instead of a bare `getVisibleEntries` / `getVisibleGroups` snapshot:

| Helper | Use for |
|---|---|
| `expectVisible(page, expected, { ordered? })` | the visible entry rows. Order-independent by default (sorts both sides); pass `{ ordered: true }` when the test pins row order. |
| `expectGroups(page, project, expected)` | grouped output — `project` maps the raw groups array (cluster seeds, counts, anchors) before comparing. |
| `readVisible(page)` / `readGroups(page)` | raw reads — only for a *follow-up* assertion on state a preceding `expectVisible` / `expectGroups` already polled to a settle, or inside your own `expect.poll`. A bare read as the first/only assertion is the flake. |

```js
await expectVisible(page, ['kayak', 'noon', 'racecar']);            // ✅ retries until settled
```

Playwright's own locator assertions (`expect(locator).toHaveText(...)`, `.toHaveCount(...)`) already auto-retry, so they're fine as-is — the trap is specifically the frozen `page.evaluate(...)` snapshot, which doesn't. For an "assert empty / assert absent" check, poll a *positive* settle signal first (a count, a present member) so the absence can't pass before the pipeline has even run.

## CI

GitHub Actions runs the suite on push to `main` only — no PR gating. CI first builds the bundled production artifact (`npm run build` → `dist/`, where esbuild bundles the module graph and minifies) and runs the suite against *that*, not the `site/` source — so a bundling- or minification-induced break fails the build before it can deploy. The deploy job ships the exact `dist/` artifact the tests ran against. Failed runs upload traces and screenshots as artifacts; download from the run page to inspect.

To reproduce the bundled build locally: `npm run test:dist` (it runs `npm run build`, then the browser suite against `dist/`). `npm test` runs the unit tier then `test:dist`, so its full matrix runs against the bundle — not the raw `site/`. `npm run test:browser` is the browser tier alone against the unbundled `site/` (what CI's matrix jobs invoke, with the unit tier gating them in the build job); reach for it only for single-browser chromium iteration, since the unbundled matrix flakes on webkit (below).

**Run the full matrix against `dist`, not `site/`.** Dev serves the raw module graph (~75 small files), and the browser matrix against `site/` makes every page load waterfall through that graph — which flakes on **webkit** under parallel-worker load (`page.goto` "waiting until load" timeouts). The bundled `dist` is one request, no waterfall, and runs clean. So use `npm run test:dist` for the full three-browser matrix — it builds `dist/` and runs the suite against it (CI does the equivalent already); single-browser chromium iteration against `site/` is fine.

## When a test breaks

- **Intentional behavior change**: update the test in the same commit. Don't leave a stale test sitting in `.skip()`.
- **Assertion no longer matches but the contract didn't change**: rewrite the assertion at a user-visible level, don't just nudge numbers. Over-specified assertions break on harmless refactors and are at risk of being silently watered down to make the suite green.
- **Flake**: don't paper over with `waitForTimeout` — fix the root cause (an assertion that races a render, a missing `await`, an unstubbed network call). See *Debugging a flake* below for how to find it.
- **More trouble than it's worth**: delete it. A smoke suite is allowed to shrink.

### Debugging a flake

**Preserve the failure artifacts before you re-run — Playwright deletes them.** A failing run records a `trace.zip`, screenshot, and `error-context.md` under `test-results/<test-dir>/`, plus the failed-test IDs in `test-results/.last-run.json`. But Playwright clears a test's output dir at the *start* of every run and rewrites `.last-run.json` for the whole run — so re-running the failed test, **even filtered to just it and even when the re-run passes**, deletes its trace and flips the record to green. Since a flake may not recur, that first trace is often the only recording you get, and the trace (step-by-step DOM/network playback) is the one artifact that actually locates the race. So before *any* re-run — including the reflexive one to confirm it's a flake — copy the dir aside: `cp -r test-results/<failed-test-dir> /tmp/flake-<name>/`. The captured stdout of the full-matrix run survives a re-run and carries the text error + failing line, but **not** the trace — if that log is all you kept, you've lost the recording. Open a preserved trace with `npx playwright show-trace <dir>/trace.zip` (or `npm run test:report` before re-running).

Re-running to *induce* a flake rarely works. A load-dependent one often surfaces only under the full parallel matrix: a local `npm test` runs fully parallel with no retries, while CI runs serial with 2 retries — so a flake you hit locally is often load contention, not a logic bug, and won't reproduce in isolation no matter how many times you re-run.

Instead, **form a theory about the race, then surgically modify code to trigger it deterministically** — inject a delay, force the suspect state, add the missing `await`. Confirm the theory by reproducing the *exact* failure, confirm the fix by checking it passes with the artificial trigger still in place, then revert the trigger. Two worked examples:

- *A streamed snapshot mismatched the settled result on webkit.* Theory: a snapshot's `entries` is the viewport window, not the whole result, and a transient narrow viewport shrank it. Forcing the emitter's window to `[0,1]` reproduced the failure byte-for-byte; the fix compares the window as a sorted prefix plus the window-independent `total`. (`streaming-transform-exact`)
- *`whenBootSettled` timed out on webkit ("browser has been closed").* Theory: a cold boot under contention exceeds the 30s default. Injecting a 33s delay before `_signalReady()` reproduced the timeout; re-running above 30s passed, proving the boot is slow-not-hung — so the fix is timeout headroom, not code. (`playwright.config.js` `timeout`)
