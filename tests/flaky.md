# Flaky-test ledger

The Playwright suite has a small population of tests that fail intermittently — almost always on **webkit**, only under **parallel-worker load** (a full `npm test` / `--project=webkit` run), essentially never in single-file runs or on chromium. A normal re-run usually won't reproduce them, so this file is the durable record: which tests flake, how often, why, and what's been fixed. Update it with the `/test-failure` skill whenever a transient failure shows up — capture the evidence *before* it's overwritten (see Gotchas).

Lines here are unwrapped (per `docs/style.md`).

## Failure tally

One row per test, by count. "Seen" = number of distinct runs it has failed in. Identify tests by spec + title — **line numbers drift**, counts don't. `wk`/`ch`/`ff` = webkit/chromium/firefox.

| Seen | Spec — test | Browsers | Last seen | Cause / status |
|------|-------------|----------|-----------|----------------|
| 3 | persistence — a custom wordlist survives a page reload with its entries and rules intact | wk, ch | 2026-06-02 | #1 — **fixed** |
| 3 | severity-priority — info alone renders an info bubble | wk | 2026-06-03 | #5 — **fixed** (boot race, see #3) |
| 2 | tools/kangaroos — the input itself is excluded; a kangaroo must be longer than its joey | wk | 2026-06-02 | #3 — **fixed** |
| 2 | tools — a wildcard-only search holds its atom even though it highlights nothing | wk | 2026-06-02 | #3 — **fixed** |
| 2 | tools/restricted_alphabet — keeps entries whose letters all belong to the input alphabet | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools — score range trims junk before the grouped tool clusters | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools — a one-sided search query degrades a unified row to a directed → | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools — a transform chain prefixes the new-word atom with its relation glyph; a filter chain is bare | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools — a transform chained after the grouped tool emits a pair atom per surviving chain | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools — stats bar counts chain rows as entries | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/curtail — marks the dropped last letter on the originator atom only | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/curtail — Count drops that many trailing letters and marks them | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/scrabble — the param is matched case-insensitively | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/scrabble — keeps entries spelled from any subset of the input tiles | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/search — a literal query matches anywhere in the entry | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/monovocalics — a Y-only entry matches as Y-monovocalic; a vowel-less entry drops | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/space_out — passes single-word entries through when no split improves on the whole word | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/space_out — renders the synthetic split entry with the input entry score | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/behead — Count drops that many leading letters and marks them | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/consonantcy — matches entries sharing the same consonant skeleton in order | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/letter_bank — keeps entries that contain every input letter and only those letters | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/letter_bank — grouped: within a group, members sort by score desc then entry asc | wk | 2026-06-02 | #3 — **fixed** |
| 1 | export — Filename includes tool keys for chained pipeline | ch | 2026-06-02 | #3 — **fixed** (the only chromium sighting) |
| 1 | export — JSON keeps catalog group cols on grouped pipelines but drops `count` | wk | 2026-06-02 | #3 — **fixed** |
| 1 | my-edits — editing My Edits patches the merged cache in place instead of rebuilding it | wk | 2026-06-02 | #2 — addressed (not recurred) |
| 1 | tool-error — fixing the broken tool clears the ⚠ icon on the next successful run | wk | 2026-06-02 | #3 — **fixed** (not recurred) |
| 1 | tools/regex — filter colors the user's own capture groups when the pattern has them | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/search — replace highlights the matched span in and the replacement out, same color | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/space_out — never splits in the middle of a digit run | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools — grouped column sort tiebreaks by count desc before min score | wk | 2026-06-02 | #4 — **fixed** (boot race, see #3) |
| 1 | tools — chains: min-score desc tiebreaks by length desc, then last-atom asc | wk | 2026-06-02 | #4 — **fixed** (boot race, see #3) |
| 1 | tools/search — a filled replacement rewrites matched entries as a transform | wk | 2026-06-02 | #3 — **fixed** |
| 1 | tools/regex — matching is case-insensitive | wk | 2026-06-02 | #3 — **fixed** |
| 1 | rich-entries — an accent in the pattern requires that accent in the display | wk | 2026-06-03 | #3 — **fixed** |
| 1 | rich-entries — length column counts norm letters, not display chars | wk | 2026-06-03 | #3 — **fixed** (also a bare-snapshot read; polling already added) |
| 1 | tools — only one group tool per pipeline — all-toggle disabled on others, URL dedups | wk | 2026-06-03 | #3 — **fixed** (boot first render re-mounted the tool stack mid-test) |

## Run log

Append a row per `npm test` (or `--project=webkit`) run that produced failures. Totals are the matrix totals (3 browsers) where known.

| Date | Command | Result | Tree state | Failures |
|------|---------|--------|------------|----------|
| 2026-06-02 | (baseline notes) | — | HEAD before this session | persistence ×3, tool-error, severity "info alone", tools "transform chained… per surviving chain", space_out "synthetic split entry", export "Filename includes tool keys" |
| 2026-06-02 | `npm test` | 4 failed | fix #1 committed | my-edits "patches merged cache", tools "wildcard-only search", curtail "marks dropped last letter", tools "score range trims junk" |
| 2026-06-02 | `npm test` | 726 passed, 9 failed | + fix #2 | severity "info alone", curtail "Count drops trailing", kangaroos, monovocalics, scrabble "case-insensitive", search "literal query", space_out "passes single-word", tools "one-sided search →", tools "transform chain prefixes glyph" |
| 2026-06-02 | `npm test` | 726 passed, 9 failed | + fix #3 (then reverted) | export "JSON keeps catalog group cols", behead "Count drops leading", consonantcy, kangaroos, letter_bank ×2, restricted_alphabet, scrabble "subset of tiles", tools "stats bar counts chain rows" |
| 2026-06-02 | `npm test` | 767 passed, 4 failed | output-format feature (uncommitted) | regex "colors own capture groups", search "replace highlights span, same color", space_out "never splits mid digit run", tools "grouped column sort count desc before min score" (selectOption timeout). All 4 passed on isolated webkit re-run. |
| 2026-06-02 | `npm test` (user-run) | 5 failed | output-format feature, staged | tools "chains: min-score tiebreaks" (#4), tools "wildcard-only search", tools/search "filled replacement transform", tools/restricted_alphabet "input alphabet", tools/regex "matching is case-insensitive" |
| 2026-06-03 | `npm test` (user-run) | 1 failed | clean main @ 67d1970 ("first-boot welcome popup") | severity-priority "info alone renders an info bubble" — failed at line 53 (`updateAvailable` false on the backend snapshot, *before* the Library was opened) |
| 2026-06-03 | `npm test` (user-run) | 3 failed | + polling conversion (uncommitted), drain fix `980740b` | rich-entries "accent in the pattern" (setStack search stranded on unfiltered view; `expectVisible` polled 5s, never settled), rich-entries "length column counts norm letters" (`.atom-len` snapshot `[]`), tools "only one group tool per pipeline" (2nd tool-row `.all-toggle` not found) |
| 2026-06-04 | CI `26921532444` @ `05bdff3` | webkit 27 failed + timed out (10m15s); ch/ff passed | sharded CI + polling `05bdff3` + drain `980740b` | webkit: 27 tests, all at the `expect.poll` line — #3 boot race (the late boot first render `setEntries`'d the unfiltered set over the test's filtered scroller). |
| 2026-06-04 | CI `26921918290` @ `8c5d6c1` | webkit ~40+ failed + timed out (10m14s); chromium 256 passed / **3 flaky**; firefox 259 passed | same tree (+ flaky-doc commit) | webkit: broad #3 boot race (export, merge, my-edits, rich-entries, tool-error, most tool specs). **chromium flaky:** "chain sort axis swap" (#4), export "Copy lists group members per line", anagrams "case-insensitive" — same race, occasionally landing on chromium. |
| 2026-06-04 | `CI=1 … --project=webkit` (full suite, after the `whenReady` fix) | **259 passed, 0 flaky (3.8m)** | gotoApp `whenReady` fix (uncommitted) | none — webkit shard green, no timeout. chromium + firefox: 518 passed. |

## Known causes

### #1 — Wrong post-condition after `reload()` — **fixed** (committed)

`persistence.spec.js` and `my-edits.spec.js` polled `_db !== null` then immediately read the wordlist. DB-open and wordlist-load-into-`state.sources` are separate async steps; on a slow webkit reload the DB was open while `getWordlist` still returned `null`, so the next line threw. Fix: poll the real post-condition (`getWordlist(name)?.populated` / `?.entries`) at a 10s ceiling, matching `gotoApp`. See `tests/helpers.js` `gotoApp`'s `_db` comment for the original 5s→flake history.

### #2 — Boot publisher fetches re-rendering mid-test — **fixed** (`gotoApp`)

The three auto-fetch publishers (JK/STWL/Broda) fetch fire-and-forget from `init()` *after* `_db` is set, and `gotoApp` used to return as soon as `_db` was non-null. When a fetch resolves, `applyWordlistText` runs `invalidateWordlistCaches` + `repaintAfterCacheChange` — it flips the publisher `enabled`, rebuilds the merged cache, and re-renders the Workshop. On webkit under load these resolve *mid-test* and the re-render races the assertions. Fix: after `_db`, `gotoApp` waits until every URL-backed source has populated (the stubs all return 200), then `pipelineIdle()`, so no boot fetch lands mid-test. (Still in place; it now runs *after* the #3 `whenReady` gate.)

### #3, #4, #5 — one root cause: `gotoApp` returned mid-`init()` — **FIXED** (2026-06-04)

**Root cause (proven by runtime instrumentation, not static reasoning).** `gotoApp` resumed the test the moment `_db !== null`, but `_db` is set inside `openDB()` — *early* in `init()`, long before init's tail runs `Router.applyURL()` (which resets the tool stack to the URL default) and `renderAll()` (the boot first render). The second gate, `state.sources.every(w => !w.url || w.populated)`, is vacuously `true` while `sources$` is still its initial `signal([])`. So both gates passed while `init()` was suspended at the double-`requestAnimationFrame` (`init()` line ~4837) in its middle, and `gotoApp` returned *into the middle of boot*. The test then ran its `addCustomWordlist` + `setStack` and rendered correctly — and then init's tail executed and clobbered it. Three faces of the one race:

- **#3 (wrong / unfiltered tool output).** The boot first render re-ran the pipeline with the reset `[search]` stack and `setEntries`'d the *unfiltered* merged set over the test's filtered scroller — a **stable** wrong state, which is why `expect.poll` ran its full 5s and never settled. The instrumented log was unambiguous: `detail-set rows:3` (the test's setStack, correctly filtered) → `init-after-applyURL tools:[search]` → `boot-first-render tools:[search]` → `detail-set rows:5` (unfiltered, clobbering it). The earlier "consonantcy got the unfiltered 6 entries for 5s" is exactly this.
- **#4 (sort-axis `<select>` detached / not-ready).** The same late boot first render re-mounts the Workshop panel (`mountWorkshopPanel` rebuilds the stats bar and its sort `<select>`), detaching the element the test had grabbed exactly as `selectOption` fired — "element was detached from the DOM, retrying."
- **#5 (`severity-priority` "info alone" reads `updateAvailable: false`).** init's `state.sources = await Promise.all(meta.map(wordlistFromMeta))` rebuilds the 'Clean' object from meta *after* the test set `wl._updateAvailable = true`; the transient flag isn't persisted to meta, so the rebuilt object reads `false`. The 2026-06-03 trace's premise — "no path rebuilds the object; all `wordlistFromMeta` sites are boot-load, done before `gotoApp` returns" — was the wrong assumption: that boot-load runs *after* `gotoApp` returns when the test wins the `_db` race. (This is why the badge-vs-line-53 question never resolved: the rebuild drops the flag regardless of which assertion reads it.)

**Why webkit / why worse single-worker.** The race window is the gap between `_db` being set and init finishing the first render; the double-rAF + disk-boot probe sit inside it. WebKit's rAF/scheduler is slower and more variable under single-worker CPU pressure, so the test wins that race far more often there — hence webkit-dominant and worse under `CI=1`. chromium/firefox usually *lose* the race (init finishes before the test acts), which is why they passed — but the rare chromium sightings (#4 "chain sort axis swap", export "Filename includes tool keys") were the same race landing occasionally.

**Fix.** `init()` resolves a module-level `_ready` promise at its very end (after applyURL, the first render, and the publisher fetches are kicked off), exposed as `window.__grawlixTest.whenReady()`. `gotoApp` now `await`s `whenReady()` in place of polling `_db`, so the test never touches the app until boot is fully settled. The #2 populated-poll + `pipelineIdle()` stay (they still drain the fire-and-forget boot fetches). `smoke.spec.js`'s API-shape assertion gains `whenReady`.

**Verified.** Full suite under `CI=1` (single-worker, retries=2 — the shard's exact config): webkit **259 passed / 0 flaky in 3.8 min** (was: timeout at 10 min, ~30–40 failed); chromium + firefox 518 passed. The reliable local repro (`CI=1 … {consonantcy,neckouts,search,vowelcy,letter_bank} --project=webkit`, and a copied-failing-tests file at `--repeat-each=8`) went from ~3–7 flaky to 0.

**Earlier hypotheses, all wrong (recorded so they aren't re-tried).** The `_preSearchCache` pipeline-cache theories — stale reuse on a data change, a write-after-abort poisoning the cache, the `addCustomWordlist` drain not awaiting the scroller write — were red herrings. `_preSearchCache` *is* invalidated on every data change (`invalidateWordlistCaches` → `invalidateSourceCounts` → `invalidatePreSearchCache`), and `setStack`'s `invalidatePreSearchCache()` → next run's cache read are synchronously contiguous, so the test's own `setStack` run was *always* correct (the instrumentation confirms `exec-write chains:3`, the right count). The bug was never in the pipeline; it was a boot-vs-test ordering race in the harness. The polling conversion (`05bdff3`) and the `addCustomWordlist` `pipelineIdle()` drain (`980740b`) are still good hygiene but were not the fix — and the handoff doc's "do not guess-fix the pipeline / instrument under `CI=1`" advice was correct: the instrumentation is what cracked it.

## How to reproduce

Was load-dependent; now fixed. To re-confirm the fix (or catch a regression):
1. `CI=1 npx playwright test --project=webkit` — single-worker + retries=2, the shard's exact config. Should be 259 passed, 0 flaky.
2. The old repro set, still the fastest signal: `CI=1 npx playwright test tests/tools/{consonantcy,neckouts,search,vowelcy,letter_bank}.spec.js --project=webkit`.
3. If a boot-race regression is suspected, instrument `init()` / `renderWorkshopMergedDetail` / `runPipeline` to a `window.__plog` buffer and dump it from an `afterEach` on failure — the ordering (`detail-set` then a late `boot-first-render`) is the tell.

## Gotchas

- **`test-results/` is wiped at the start of *every* `playwright test` run** — even a one-file run. The saved `.last-run.json` + per-failure folders reflect only the most recent run. Capture `test-results/<dir>/error-context.md` (error + page snapshot) **before** running any other test command. This is exactly what `/test-failure` automates.
- Each failure dir also holds `test-failed-1.png` and `trace.zip`; the error-context's accessibility-tree snapshot is usually more precise than the screenshot for structural assertions.
- Local config runs `retries: 0`, so a flake is a hard failure locally; CI uses `retries: 2`, so the same flake there is reported "flaky" but stays green.
- A changing failure set between runs is strong evidence of flakiness rather than a real regression.

## Maintaining this file

Run `/test-failure` after a transient failure: it captures `test-results/` into the tally + run log above, and optionally debugs. `/test-failure debug` documents *and* investigates; bare `/test-failure` only documents (when you don't want to interrupt other work).
