# Flaky-test ledger

The Playwright suite has a small population of tests that fail intermittently — almost always on **webkit**, only under **parallel-worker load** (a full `npm test` / `--project=webkit` run), essentially never in single-file runs or on chromium. A normal re-run usually won't reproduce them, so this file is the durable record: which tests flake, how often, why, and what's been fixed. Update it with the `/test-failure` skill whenever a transient failure shows up — capture the evidence *before* it's overwritten (see Gotchas).

Lines here are unwrapped (per `docs/style.md`).

## Failure tally

One row per test, by count. "Seen" = number of distinct runs it has failed in. Identify tests by spec + title — **line numbers drift**, counts don't. `wk`/`ch`/`ff` = webkit/chromium/firefox.

| Seen | Spec — test | Browsers | Last seen | Cause / status |
|------|-------------|----------|-----------|----------------|
| 3 | persistence — a custom wordlist survives a page reload with its entries and rules intact | wk, ch | 2026-06-02 | #1 — **fixed** |
| 3 | severity-priority — info alone renders an info bubble | wk | 2026-06-03 | #5 — backend read `updateAvailable: false`; provably not an app-logic reset (60× isolated pass) |
| 2 | tools/kangaroos — the input itself is excluded; a kangaroo must be longer than its joey | wk | 2026-06-02 | #3 — open |
| 2 | tools — a wildcard-only search holds its atom even though it highlights nothing | wk | 2026-06-02 | #3 — open (highlight-coloring face) |
| 2 | tools/restricted_alphabet — keeps entries whose letters all belong to the input alphabet | wk | 2026-06-02 | #3 — open |
| 1 | tools — score range trims junk before the grouped tool clusters | wk | 2026-06-02 | #3 — open |
| 1 | tools — a one-sided search query degrades a unified row to a directed → | wk | 2026-06-02 | #3 — open |
| 1 | tools — a transform chain prefixes the new-word atom with its relation glyph; a filter chain is bare | wk | 2026-06-02 | #3 — open |
| 1 | tools — a transform chained after the grouped tool emits a pair atom per surviving chain | wk | 2026-06-02 | #3 — open |
| 1 | tools — stats bar counts chain rows as entries | wk | 2026-06-02 | #3 — open |
| 1 | tools/curtail — marks the dropped last letter on the originator atom only | wk | 2026-06-02 | #3 — open |
| 1 | tools/curtail — Count drops that many trailing letters and marks them | wk | 2026-06-02 | #3 — open |
| 1 | tools/scrabble — the param is matched case-insensitively | wk | 2026-06-02 | #3 — open |
| 1 | tools/scrabble — keeps entries spelled from any subset of the input tiles | wk | 2026-06-02 | #3 — open |
| 1 | tools/search — a literal query matches anywhere in the entry | wk | 2026-06-02 | #3 — open |
| 1 | tools/monovocalics — a Y-only entry matches as Y-monovocalic; a vowel-less entry drops | wk | 2026-06-02 | #3 — open |
| 1 | tools/space_out — passes single-word entries through when no split improves on the whole word | wk | 2026-06-02 | #3 — open |
| 1 | tools/space_out — renders the synthetic split entry with the input entry score | wk | 2026-06-02 | #3 — open |
| 1 | tools/behead — Count drops that many leading letters and marks them | wk | 2026-06-02 | #3 — open |
| 1 | tools/consonantcy — matches entries sharing the same consonant skeleton in order | wk | 2026-06-02 | #3 — open |
| 1 | tools/letter_bank — keeps entries that contain every input letter and only those letters | wk | 2026-06-02 | #3 — open |
| 1 | tools/letter_bank — grouped: within a group, members sort by score desc then entry asc | wk | 2026-06-02 | #3 — open |
| 1 | export — Filename includes tool keys for chained pipeline | ch | 2026-06-02 | #3 — open (the only chromium sighting) |
| 1 | export — JSON keeps catalog group cols on grouped pipelines but drops `count` | wk | 2026-06-02 | #3 — open |
| 1 | my-edits — editing My Edits patches the merged cache in place instead of rebuilding it | wk | 2026-06-02 | #2 — addressed (not recurred) |
| 1 | tool-error — fixing the broken tool clears the ⚠ icon on the next successful run | wk | 2026-06-02 | open (already polls correctly; not recurred) |
| 1 | tools/regex — filter colors the user's own capture groups when the pattern has them | wk | 2026-06-02 | #3 — open (highlight-coloring face) |
| 1 | tools/search — replace highlights the matched span in and the replacement out, same color | wk | 2026-06-02 | #3 — open (highlight-coloring face) |
| 1 | tools/space_out — never splits in the middle of a digit run | wk | 2026-06-02 | #3 — open |
| 1 | tools — grouped column sort tiebreaks by count desc before min score | wk | 2026-06-02 | #4 — sort-axis `<select>` race |
| 1 | tools — chains: min-score desc tiebreaks by length desc, then last-atom asc | wk | 2026-06-02 | #4 — sort-axis `<select>` race |
| 1 | tools/search — a filled replacement rewrites matched entries as a transform | wk | 2026-06-02 | #3 — open |
| 1 | tools/regex — matching is case-insensitive | wk | 2026-06-02 | #3 — open |
| 1 | rich-entries — an accent in the pattern requires that accent in the display | wk | 2026-06-03 | #3 — open (setStack search stranded on the unfiltered fixture; `expectVisible` polled 5s, output never settled) |
| 1 | rich-entries — length column counts norm letters, not display chars | wk | 2026-06-03 | #3 — open (`.atom-len` bare DOM snapshot read `[]`; not reached by the getVisible* polling conversion) |
| 1 | tools — only one group tool per pipeline — all-toggle disabled on others, URL dedups | wk | 2026-06-03 | open — 2nd `.tool-row`'s `.all-toggle` never rendered (tool-stack re-render race) |

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
| 2026-06-04 | CI `26921532444` @ `05bdff3` | webkit 27 failed + timed out (10m15s); ch/ff passed | sharded CI + polling `05bdff3` + drain `980740b` | webkit: 27 tests, all at the `expect.poll` line (`helpers.js` L93/L97) — #3 persistent stranding (filter shows unfiltered). See #3. |
| 2026-06-04 | CI `26921918290` @ `8c5d6c1` | webkit ~40+ failed + timed out (10m14s); chromium 256 passed / **3 flaky**; firefox 259 passed | same tree (+ flaky-doc commit) | webkit: broad #3 stranding (export, merge, my-edits, rich-entries, tool-error, most tool specs — all at `expect.poll`). **chromium flaky:** `tools` "chain sort axis swap: min-score → max-score reorders rows" (30s `selectOption` timeout — **#4, first chromium sighting**), export "Copy lists group members per line", anagrams "the param is matched case-insensitively". |

## Known causes

### #1 — Wrong post-condition after `reload()` — **fixed** (committed)

`persistence.spec.js` and `my-edits.spec.js` polled `_db !== null` then immediately read the wordlist. DB-open and wordlist-load-into-`state.sources` are separate async steps; on a slow webkit reload the DB was open while `getWordlist` still returned `null`, so the next line threw. Fix: poll the real post-condition (`getWordlist(name)?.populated` / `?.entries`) at a 10s ceiling, matching `gotoApp`. See `tests/helpers.js` `gotoApp`'s `_db` comment for the original 5s→flake history.

### #2 — Boot publisher fetches re-rendering mid-test — **fixed** (`gotoApp`)

The three auto-fetch publishers (JK/STWL/Broda) fetch fire-and-forget from `init()` *after* `_db` is set, and `gotoApp` used to return as soon as `_db` was non-null. When a fetch resolves, `applyWordlistText` runs `invalidateWordlistCaches` + `repaintAfterCacheChange` — it flips the publisher `enabled`, rebuilds the merged cache, and re-renders the Workshop. On webkit under load these resolve *mid-test* and the re-render races the assertions; the clearest victim was `my-edits` "patches merged cache in place" (the racing fetch rebuilt the cache the test was checking stayed stamped). Fix: after `_db`, `gotoApp` waits until every URL-backed source has populated (the stubs all return 200), then `pipelineIdle()`, so no boot fetch lands mid-test. Holds across all runs since.

### #3 — Wrong tool output under load — read-race **fixed**; a persistent `setStack`-stranding is **NOT fixed** (CI webkit still fails + times out)

**Resolved.** Two compounding causes, both fixed:

1. **Single-snapshot reads raced the async repaint (the dominant mechanism).** The tool/pipeline specs read `getVisibleEntries`/`getVisibleGroups` *once*, right after `setStack`/search/edit, and asserted on that frozen value. The pipeline repaints the scroller a frame or two later, so on webkit-under-load the read landed pre-settle — the output wasn't wrong, the read was early. Fix: all reads now poll via `expectVisible` / `expectGroups` (`tests/helpers.js`), which retry until the DOM reflects the settled result. See [`docs/testing.md`](../docs/testing.md) § *Reading async pipeline output*.
2. **`addCustomWordlist` returned with a refresh still in flight (the amplifier — the lead at the bottom of this section, now confirmed).** Its `applyWordlistText` cache bump fires the render effect, which kicks off a *fire-and-forget* `refreshWorkshopMergedScroller`. The helper didn't await it, so a following `setStack` aborted that run mid-flight and stranded the scroller on its pre-filter rows — the "whole fixture" / empty-`[]` variant, and the source of the highlight-absent sightings too. Fix: `addCustomWordlist` now `await pipelineIdle()` before returning, matching `gotoApp`'s settle contract.

Together these took the webkit suite from ~9/735 flaking (and timing the shard out under the retry storm) to **643 passed under `--repeat-each=3`, zero failures**. A webkit-under-load flake can't be *proven* gone, but the mechanism is understood and the stress signal is clean.

**Residual (2026-06-03, full `npm test`).** The read-too-early variant is closed where converted, but two faces survived a full-matrix run. (1) `rich-entries` "accent in the pattern" flaked with `expectVisible` polling the full 5s while the view stayed *unfiltered* — the `setStack`-triggered search filter never applied, so polling can't rescue it (the correct output never appears). The drain fix only covers the `addCustomWordlist` trigger; this is the same stranding via a `setStack` render, the deeper lead below. (2) `rich-entries` "length column counts norm letters" reads `.atom-len` as a bare DOM snapshot — a read the `getVisibleEntries`/`getVisibleGroups` conversion never reached, so it still races and is trivially closed by polling it. (A third 2026-06-03 failure, `tools` "only one group tool", is unrelated — the 2nd tool-row's `.all-toggle` failing to render, a tool-stack DOM race, not pipeline output.)

**CI confirms the polling did NOT fix the webkit shard (2026-06-04, run `26921532444` @ `05bdff3`, polling committed).** chromium (2m53s) and firefox (3m37s) passed; the **webkit shard failed 27 tests and timed out at 10m15s** — and *every* failure is at the `expect.poll` line (`helpers.js` L93/L97), i.e. the poll ran its full timeout because the output never settled. `consonantcy` "consonant skeleton" got the **unfiltered 6 entries** (`Received +2`) for the whole 5s — the `setStack` tool filter genuinely didn't apply. So polling can't rescue this; it only turns a fast wrong-read into a slow timeout, and 27 × (5s × 3 retries) is itself a big slice of the 10-minute cap. **Reproduces locally with `CI=1` (single-worker)**: `CI=1 npx playwright test tests/tools/{consonantcy,neckouts,search,vowelcy,letter_bank}.spec.js --project=webkit` → ~7 flaky (fail-then-pass-on-retry); `--workers=4` (parallel) flakes *less* but still hits `search.spec.js`, so it is not purely single-worker. Static tracing points at `_preSearchCache`: `executePipeline` reuses a cached pre-search state; a no-tool `addCustomWordlist` run caches the *unfiltered* set, and although the drain + `invalidatePreSearchCache()` on `setStack` *should* clear it before the tool run, on webkit something defeats that serialization. **Not root-caused, not fixed** — the next step is runtime instrumentation under `CI=1`, not another static guess (the reverted `_preSearchCache` guard is the precedent). The earlier "643 passed under `--repeat-each=3`" was a *parallel, multi-spec* run that happened to dodge it; it overstated the fix.

---

*Original diagnosis, kept for history:* A tool or search emits output that's *close but wrong* — usually **one entry too many** (scrabble lets `tiger` through, kangaroos keeps `kanga`, monovocalics keeps `shhh`), occasionally the whole fixture (`search` "literal query", `tools` "one-sided search →"). The failing set changes every webkit run (~9 of 735), which is itself the signature of a load race rather than a logic bug. Same family as the chromium `export` "Filename includes tool keys" sighting (where `ToolStack.getStack()` momentarily read empty → `grawlix-all`).

Highlight/coloring assertions share the symptom: `tools/regex` "colors own capture groups" and `tools/search` "replace highlights span, same color" flake when the rendered atom highlight is briefly absent or miscolored under load, not just when entry counts are off — same near-miss-render signature, applied to the highlight ranges rather than the row set.

**Disproven so far:** a superseded empty-stack pipeline run poisoning the shared `_preSearchCache`. `setStack`'s `invalidatePreSearchCache()` and the next run's cache-read are *synchronously contiguous* (no `await` between), so the newer run can't read a poisoned cache. Adding `throwIfAborted` before the `_preSearchCache` write did not reduce failures and was reverted.

**Leading leads to pursue next:**
- `_preSearchCache` (or `_mergedWordlistCache`) going **stale on a data change that doesn't change the stack** — data mutations (`addCustomWordlist`/fetch) call `invalidateWordlistCaches` + `repaintAfterCacheChange` but **not** `invalidatePreSearchCache`, which is only called on stack changes. A pipeline run that reuses a pre-search state computed from older data would emit a near-miss result. Start here.
- A concurrent `addCustomWordlist` repaint run interacting with `setStack`'s run on the shared scroller / caches in a way the single-flight abort doesn't fully serialize.

### #4 — Sort-axis `<select>` detached / not-ready under load — **OPEN (test-side)**

`selectOption('#stats-bar-sort .sort-axis-select')` times out on webkit, the call log showing either "element was detached from the DOM, retrying" or "did not find some options." Seen on `tools` "grouped column sort tiebreaks" and "chains: min-score tiebreaks." **Now also on chromium** (run `26921918290`): `tools` "chain sort axis swap: min-score → max-score reorders rows" hit a 30s `selectOption` timeout waiting for `#stats-bar-sort .sort-axis-select` — so it is *not* webkit-only. The stats bar re-renders when the pipeline settles (a tool/group change rebuilds the available sort axes), so the `<select>` the test grabbed gets replaced — or its `<option>`s aren't populated yet — exactly as `selectOption` fires. Distinct from #3: this is a DOM-timing race on the control, not wrong pipeline output. Likely fix is test-side — wait for the expected `<option>` to be present (or set the sort via the test API) before selecting. Not yet attempted.

### #5 — `severity-priority` "info alone" backend snapshot reads `updateAvailable: false` — **OPEN, not root-caused; provably not an app-logic reset**

`severity-priority` "info alone" failed on webkit at **line 53** — `expect(wl.updateAvailable).toBe(true)` received `false` — the *backend snapshot* assertion, **before** `openLibrary`. The test does three separate `page.evaluate` calls: `addCustomWordlist({name:'Clean', scores:[10,30,50]})` (awaited), then `setUpdateAvailable('Clean', true)`, then `getWordlist('Clean')`.

**Traced 2026-06-03 (`/test-failure debug`).** The flag cannot be reset by app logic in this scenario:
- Every `_updateAvailable` write was enumerated. The only writes that *clear* it are in `applyWordlistText` (gated on `fetchedSize !== null` / `clearUrl`), which fire only on a fetch. The 'Clean' wordlist has `url: null`, so it never fetches — once `setUpdateAvailable` (`wl._updateAvailable = !!value`, synchronous, before `renderSources()`) sets it, nothing clears it.
- No path rebuilds the 'Clean' object after `addNewWordlist` pushes it. All `wrapWordlist`/`wordlistFromMeta` sites are boot-load (done before `gotoApp` returns) or folder-sync (needs a disk handle — not in tests). The render/cosmetic effects only repaint the DOM; they never replace `state.sources` entries.
- `setUpdateAvailable`'s write and `getWordlist`'s read are synchronous, in separate awaited `page.evaluate`s, on the page's single thread — the read *must* observe the write. A `false` read needs either the write to not happen (then `_lookup` throws → failure at line 49, not 53) or the object to be swapped (no such path).
- `checkForUpdates` (fire-and-forget at boot) early-returns: its candidates need `url && rawEntries.length > 0 && fetchedSize`, and the stubbed publishers have empty bodies (0 entries). So nothing is pending mid-test that touches 'Clean'.

**Differentiator from the passing sibling.** The first test ("Both", 11 scores) asserts the same `updateAvailable === true` and has never been tallied. The only behavioral difference is that "Clean" (3 scores) goes through `maybeAutoSeedRescoreRules` while "Both" stays above `AUTO_SEED_SCORE_LIMIT` — but auto-seed is synchronous and flag-neutral, so it's a timing correlate, not a cause.

**Reproduction.** Not reproducible in isolation: `severity-priority.spec.js --project=webkit --repeat-each=30 --workers=4` → 60/60 passed. Confirms load-dependence, consistent with the logic being sound.

**Status / leads.** No code fix applied — the trace shows no mechanism, and guessing here already burned us once (the reverted `_preSearchCache` guard, #3). Likely either a harness/scheduling artifact under webkit CPU starvation, or the two earlier 2026-06-02 sightings were actually at the **badge assertions (lines 57–58)** — a render-settle race in the #3 family — and only this run hit line 53. **Next time it fails, capture the failure line.** If line 53 recurs, the pragmatic hardening is to `expect.poll` the backend snapshot (lines 51–53) or drop it in favor of the badge contract (lines 56–58) which is what the test actually pins — but that masks rather than explains, so hold it until a reproduction with logged values exists.

## How to reproduce

Load is the trigger; a single-file run usually won't fail.
1. `npm test` (full matrix + parallel workers) or `npx playwright test --project=webkit`. Repeat a few times.
2. Hammer a suspect: `npx playwright test tools.spec.js --project=webkit --repeat-each=20`.
3. To force the boot-fetch class (cause #2, now fixed) deterministically: add a delay to the route fulfillment in `stubPublisherFetches` so fetches reliably resolve mid-test.

## Gotchas

- **`test-results/` is wiped at the start of *every* `playwright test` run** — even a one-file run. The saved `.last-run.json` + per-failure folders reflect only the most recent run. Capture `test-results/<dir>/error-context.md` (error + page snapshot) **before** running any other test command. This is exactly what `/test-failure` automates.
- Each failure dir also holds `test-failed-1.png` and `trace.zip`; the error-context's accessibility-tree snapshot is usually more precise than the screenshot for structural assertions.
- Local config runs `retries: 0`, so a flake is a hard failure locally; CI uses `retries: 2`, so the same flake there is reported "flaky" but stays green.
- A changing failure set between runs is strong evidence of flakiness rather than a real regression.

## Maintaining this file

Run `/test-failure` after a transient failure: it captures `test-results/` into the tally + run log above, and optionally debugs. `/test-failure debug` documents *and* investigates; bare `/test-failure` only documents (when you don't want to interrupt other work).
