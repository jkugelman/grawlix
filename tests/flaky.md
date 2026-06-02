# Flaky-test ledger

The Playwright suite has a small population of tests that fail intermittently — almost always on **webkit**, only under **parallel-worker load** (a full `npm test` / `--project=webkit` run), essentially never in single-file runs or on chromium. A normal re-run usually won't reproduce them, so this file is the durable record: which tests flake, how often, why, and what's been fixed. Update it with the `/test-failure` skill whenever a transient failure shows up — capture the evidence *before* it's overwritten (see Gotchas).

Lines here are unwrapped (per `docs/style.md`).

## Failure tally

One row per test, by count. "Seen" = number of distinct runs it has failed in. Identify tests by spec + title — **line numbers drift**, counts don't. `wk`/`ch`/`ff` = webkit/chromium/firefox.

| Seen | Spec — test | Browsers | Last seen | Cause / status |
|------|-------------|----------|-----------|----------------|
| 3 | persistence — a custom wordlist survives a page reload with its entries and rules intact | wk, ch | 2026-06-02 | #1 — **fixed** |
| 2 | tools/kangaroos — the input itself is excluded; a kangaroo must be longer than its joey | wk | 2026-06-02 | #3 — open |
| 2 | severity-priority — info alone renders an info bubble | wk | 2026-06-02 | open, unclassified (likely a Library-badge render-settle race, not #3) |
| 1 | tools — a wildcard-only search holds its atom even though it highlights nothing | wk | 2026-06-02 | #3 — open |
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
| 1 | tools/restricted_alphabet — keeps entries whose letters all belong to the input alphabet | wk | 2026-06-02 | #3 — open |
| 1 | export — Filename includes tool keys for chained pipeline | ch | 2026-06-02 | #3 — open (the only chromium sighting) |
| 1 | export — JSON keeps catalog group cols on grouped pipelines but drops `count` | wk | 2026-06-02 | #3 — open |
| 1 | my-edits — editing My Edits patches the merged cache in place instead of rebuilding it | wk | 2026-06-02 | #2 — addressed (not recurred) |
| 1 | tool-error — fixing the broken tool clears the ⚠ icon on the next successful run | wk | 2026-06-02 | open (already polls correctly; not recurred) |

## Run log

Append a row per `npm test` (or `--project=webkit`) run that produced failures. Totals are the matrix totals (3 browsers) where known.

| Date | Command | Result | Tree state | Failures |
|------|---------|--------|------------|----------|
| 2026-06-02 | (baseline notes) | — | HEAD before this session | persistence ×3, tool-error, severity "info alone", tools "transform chained… per surviving chain", space_out "synthetic split entry", export "Filename includes tool keys" |
| 2026-06-02 | `npm test` | 4 failed | fix #1 committed | my-edits "patches merged cache", tools "wildcard-only search", curtail "marks dropped last letter", tools "score range trims junk" |
| 2026-06-02 | `npm test` | 726 passed, 9 failed | + fix #2 | severity "info alone", curtail "Count drops trailing", kangaroos, monovocalics, scrabble "case-insensitive", search "literal query", space_out "passes single-word", tools "one-sided search →", tools "transform chain prefixes glyph" |
| 2026-06-02 | `npm test` | 726 passed, 9 failed | + fix #3 (then reverted) | export "JSON keeps catalog group cols", behead "Count drops leading", consonantcy, kangaroos, letter_bank ×2, restricted_alphabet, scrabble "subset of tiles", tools "stats bar counts chain rows" |

## Known causes

### #1 — Wrong post-condition after `reload()` — **fixed** (committed)

`persistence.spec.js` and `my-edits.spec.js` polled `_db !== null` then immediately read the wordlist. DB-open and wordlist-load-into-`state.sources` are separate async steps; on a slow webkit reload the DB was open while `getWordlist` still returned `null`, so the next line threw. Fix: poll the real post-condition (`getWordlist(name)?.populated` / `?.entries`) at a 10s ceiling, matching `gotoApp`. See `tests/helpers.js` `gotoApp`'s `_db` comment for the original 5s→flake history.

### #2 — Boot publisher fetches re-rendering mid-test — **fixed** (`gotoApp`)

The three auto-fetch publishers (JK/STWL/Broda) fetch fire-and-forget from `init()` *after* `_db` is set, and `gotoApp` used to return as soon as `_db` was non-null. When a fetch resolves, `applyWordlistText` runs `invalidateWordlistCaches` + `repaintAfterCacheChange` — it flips the publisher `enabled`, rebuilds the merged cache, and re-renders the Workshop. On webkit under load these resolve *mid-test* and the re-render races the assertions; the clearest victim was `my-edits` "patches merged cache in place" (the racing fetch rebuilt the cache the test was checking stayed stamped). Fix: after `_db`, `gotoApp` waits until every URL-backed source has populated (the stubs all return 200), then `pipelineIdle()`, so no boot fetch lands mid-test. Holds across all runs since.

### #3 — Wrong tool output under load — **OPEN, not root-caused**

The dominant remaining flake. A tool or search emits output that's *close but wrong* — usually **one entry too many** (scrabble lets `tiger` through, kangaroos keeps `kanga`, monovocalics keeps `shhh`), occasionally the whole fixture (`search` "literal query", `tools` "one-sided search →"). The failing set changes every webkit run (~9 of 735), which is itself the signature of a load race rather than a logic bug. Same family as the chromium `export` "Filename includes tool keys" sighting (where `ToolStack.getStack()` momentarily read empty → `grawlix-all`).

**Disproven so far:** a superseded empty-stack pipeline run poisoning the shared `_preSearchCache`. `setStack`'s `invalidatePreSearchCache()` and the next run's cache-read are *synchronously contiguous* (no `await` between), so the newer run can't read a poisoned cache. Adding `throwIfAborted` before the `_preSearchCache` write did not reduce failures and was reverted.

**Leading leads to pursue next:**
- `_preSearchCache` (or `_mergedWordlistCache`) going **stale on a data change that doesn't change the stack** — data mutations (`addCustomWordlist`/fetch) call `invalidateWordlistCaches` + `repaintAfterCacheChange` but **not** `invalidatePreSearchCache`, which is only called on stack changes. A pipeline run that reuses a pre-search state computed from older data would emit a near-miss result. Start here.
- A concurrent `addCustomWordlist` repaint run interacting with `setStack`'s run on the shared scroller / caches in a way the single-flight abort doesn't fully serialize.

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
