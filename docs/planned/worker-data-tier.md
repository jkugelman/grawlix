# Worker data tier — the worker owns the wordlists, main is a thin view

A follow-on rearchitecture to the shipped web-worker pipeline (see [`../design.md`](../design.md) § *The pipeline runs in a web worker* and [`../worker-protocol.md`](../worker-protocol.md)). The pipeline already runs off-thread; this moves the **data itself** off-thread, making the worker the sole owner of the wordlists and the main thread a thin, asynchronous view over them. This doc has been through one adversarial vetting pass; the conversion table and the resolved decisions below reflect it.

## Why

With the pipeline in the worker but the data still on main, three freezes remain, and they share one root cause: **the data layer lives on the main thread, and the worker holds only a single finished view** (the active scope's corpus). Concretely:

- **Scope switch** re-packs and re-ships a whole corpus to the worker — the `encodeInto` pack is faster now but still a main-thread cost proportional to the corpus.
- **Cold boot** reads, parses, rescores, and merges every wordlist on main — seconds of frozen UI behind the splash, dominated by the merge build (`bucketContributors`).
- **Fetch/import** re-parses and rebuilds on main. A background jkugelman update that changed *one entry* froze the UI ~30s at 4× throttle, *after* the splash had faded — the worst instance, because nothing covered it.
- The worker also duplicates the *active view*, so peak memory carries a ~2× term (rich on main + lean in worker) — and the whole bulk sits on the main thread, which feeds the long-open-tab GC smell that started this effort.

Every one of these is "the main thread is doing — or holding — data-layer work." The fix is to stop it doing and holding that work at all.

## The idea

The worker becomes the **sole owner** of the wordlist data; the main thread becomes a **thin, asynchronous view** over it. The worker holds every wordlist's entries, builds the merge and each scoped view, runs the pipeline, computes stats/histograms, and loads/parses the data at boot and on fetch/import. Main holds **no corpus** — it holds the small config (wordlist metadata, rescore rules, scoring tiers, enabled/order) as the UI's editable state, renders the DOM, and **requests the rows it needs to display** from the worker.

Because there is exactly **one owner**, there is **no two-copy synchronization problem** — the silent-divergence danger that sank the "both sides keep a full copy" alternative simply doesn't exist. Mutations are *commands* to the one owner, not reconciliations between two authorities.

## What lives where

**Worker — sole owner of the bulk data and everything derived from it:**
- Every wordlist's entries — raw parsed + rescored. **Rich**, not lean: because the worker now serves rows for rendering, it holds `comment` and the source `wordlist` identity too. This **reverses the earlier lean-snapshot invariant** (norm/display/score only), which existed precisely because main held the rich copy — main no longer does, so the rich data lives in the worker.
- The merge/scope build (today's `bucketContributors`/`resolveCorpus`), rescoring, the pipeline executor, stats/histogram computation, the segmenter corpus.
- Data loading: reads wordlist text from IndexedDB, parses, rescores, and builds — at boot and on fetch/import.

**Main — presentation + the small config:**
- The DOM, the virtual scroller, every UI surface.
- The small per-wordlist **metadata** (name, icon, url, enabled, order, publisherId) and **config** (rescore rules, scoring tiers). This is the UI's editable state; it syncs the bits the worker needs (rules to rescore, enabled/order to merge) down to the worker.
- A **window cache**: the rows currently on screen plus a prefetch buffer, fetched from the worker. Nothing more.
- The disk-sync `FileSystemFileHandle`s and permission state (the data, and the 3-way-merge baseline that goes with it, live in the worker).

The dividing line: **main owns presentation and the small config; the worker owns the bulk data and everything computed from it.** Per-wordlist metadata is tiny (one record per wordlist, not per entry), so main rendering the source column from a `sourceId` the worker ships is cheap — main maps the id to the name/icon it already holds.

## Memory: what actually changes

Be precise about this — it's *not* a total-footprint halving. The dominant memory term is every wordlist's raw entries plus the memoized rescored entries, and **that was never the duplicated part** — it only ever lived on main. Today's "~2×" is specifically the *active corpus* existing twice (rich on main + lean in worker), not all the data doubled.

What actually improves:
- **The 2× active-corpus duplication collapses to 1×** — the active view exists once, rich, in the worker; main holds none of it.
- **Main's heap drops to almost nothing** — and this is the win that matters: the stale-tab GC jank is a *main-thread* problem (GC pauses freeze the UI), so emptying main's heap is what relieves it. The bulk now sits on the worker, where GC doesn't jank the UI.

What does **not** shrink: total cross-thread memory stays roughly the same (modestly less, since the lean active-view duplicate and the scoped-cache pile-up go away). The raw + rescored bulk relocates from main to the worker — same bytes, better thread.

**Optional further win (not baked in):** because the worker can re-read wordlist text from IndexedDB itself, it *could* drop the resident raw entries and re-parse from text only when rescore rules change (the one time raw is needed). That trades a re-parse on rule edits for one fewer big resident copy — a memory-vs-recompute call the main-thread design can't easily make. Note it; decide during execution.

## Asynchronous rendering — the crux

The virtual scroller no longer reads a local array; it **requests its visible window from the worker** and renders what comes back.

- After any run or mutation, the worker posts a `result { runId, count, atomCount, sort, ... }` summary first. Main needs `count` + `atomCount` (row height = `atomCount × ROW_HEIGHT`) + the sort axis **before** it can compute which indices are visible — so `result` always precedes any `fetchRows`. Between "stack changed" and "result arrived," the scroller renders placeholders against the *last known* count (or a thin loading state if the count itself changed).
- On scroll, main computes the visible index range and requests `[start − buffer, end + buffer]` from the worker via `fetchRows`. Responses are matched by `requestId`; a response superseded by a newer request is dropped — the same supersession discipline runs already use.
- A main-side **window cache** holds the last fetched range plus the prefetch buffer above and below the viewport, so ordinary slow scrolling is served locally with **no round-trip**. Only scrolling *past* the buffer reaches the worker.
- Rows not yet fetched render as **skeleton placeholders**, filled when the response lands (typically within a frame or two).
- The worker computes **highlights** and attaches them to each row it ships, so main never re-derives them. (This relocates today's `compileFlatHighlighters`/`materializeFlatRow` logic, which carries a real subtlety — it must reproduce `collapseRepeatAtoms`/the executor's atom shaping exactly. It's relocation of fragile code, not free deletion. And it is only affordable *because rows are windowed* — shipping per-row highlights for a 1M-row result would re-introduce the structured-clone catastrophe the flat-tier work fixed. Highlights ride with windowed rows, never with a whole result.)
- **The shipped row shape:** `{ norm, display, score, rawScore, comment, sourceId, highlights, glyph }`. `rawScore` is included so the rescore-preview arrow (raw → rescored) still renders when the rescore editor is open; `comment` + `sourceId` feed the comment and Source columns.

**Grouped rows are special — they can't be windowed like flat rows.** A group row carries its whole chain list (the "+N more" reveal needs all of them), potentially thousands. So a grouped result windows by **group summary** (`key`, anchor, count, score range, the first few chains for the collapsed preview), and expanding a group fetches *that group's* chains on demand (`fetchGroupChains`). A group row never ships its full chain array eagerly.

**Column widths** are sized from the whole result today (`_computeSlotWidths` / `_computeFlatSlotWidths` / `_computeGroupSlotWidths` scan every row). Under windowing main no longer has every row, so the worker ships **width hints for all three tiers** in the `result` summary (the flat tier already does this — extend it to transform max-atom-count and grouped max-chains / per-column / anchor widths).

This is the established "virtualized list over an async data source" pattern (how a data grid backed by a database behaves). It is also the part most likely to feel bad if done poorly: **getting prefetch + placeholder behavior smooth is the central engineering task and the make-or-break risk of the whole rearchitecture.**

## Responsiveness: when the worker is unavoidably busy

A single worker can't serve a row fetch while it's mid-computation on an *uninterruptible* chunk. The predictable cases and their handling:

- **Initial boot load** (read IDB → parse → rescore → merge): the splash covers it; nothing is scrollable yet, so a tight loop is fine. The worker posts `ready` when the first window is available, and main dismisses the splash then. (`firstPaint` already gates the splash on the first real result, so this is the existing mechanism, not a new one.)
- **Scope switch / merge rebuild** (no view caching — every switch rebuilds, including back to All Wordlists): **chunk the rebuild with cooperative yields** (as `buildInitialChains` already does) so the worker keeps serving scroll fetches and the UI stays live. Switching to All Wordlists rebuilds the merge each time — responsive (chunked), not instant. We deliberately do **not** cache built views: the per-source data is always resident (the premise), and a view is a transient derivation over it. (One resident merged view was considered and rejected — not worth the standing memory or the special-case.)
- **Fetch/import processing** (parse + rescore + rebuild for a fetched or imported wordlist): **chunk it**, and show an explicit **"Updating <wordlist>…" busy indicator** on the affected source. This is the 30s-at-4× case; the user is doing something else, so a clear status beats a frozen tab.
- **`sort()`** of a large result: native and uninterruptible — **accept the brief blip.** It's fast unless the result is enormous, lands at the end of a run where the slow-run indicator is already showing, and isn't worth contorting around.
- **Heavy transforms**: already covered by the slow-run indicator.

Policy: chunk the loops we control (rebuild, fetch/import); lean on the existing splash and slow-run indicator elsewhere; add one explicit per-source "updating" indicator for fetch/import; accept the sort blip. Don't pre-place spinners speculatively — add them only where testing shows a specific case feels bad.

**Yield cadence.** The worker yields *coarsely* today (~30–50 ms) because it had no UI obligation. Now it does: a `fetchRows` that lands mid-compute can wait up to one yield window (~50 ms) before it's served — visible as a placeholder flash on a fast scroll that races a run. So the worker should **tighten its yield (and prioritize a pending `fetchRows` ahead of resuming compute)** while a fetch is outstanding. This is a real tuning point, not free.

**Companion optimization (separate, recommended).** The 30s-for-one-changed-entry fetch is also *wasteful* — it reprocesses an unchanged wordlist end to end. A content-diff (compare fetched text to the stored text; only reparse/rescore what changed) would turn it near-instant. Orthogonal to the thread move — it would help on today's architecture too — and can be done independently. Flagged so it isn't lost; it's the difference between fetch/import being "responsive but 30s" and "near-instant."

## Synchronous corpus call sites that must become async

The thin-client premise only holds if *every* place main reads corpus data today is converted. The vetting pass enumerated these; the executing session must handle each (this is the bulk of the work, and the easiest place to get stuck). Each becomes either an async worker query or a value the worker ships proactively in `result`.

| Call site (today) | Reads | Conversion |
|---|---|---|
| **Export of the result** (`exportRows` → `exportCopy/CSV/JSON`, `app/actions.js`) | the *entire* filtered/sorted/grouped result, with `comment` + source for CSV/JSON provenance | new `exportResult { format, includeProvenance }` command → worker serializes the current result (it has the stack + rich data) → returns a Blob. Distinct from `serializeFor { wordlistId }`. For a grouped result this is a **full-result walk worker-side** (every group's full chains), not an assembly of windowed `fetchGroupChains` calls. |
| **Download a wordlist / merged** (`downloadMergedWordlistFromPanel`) | the merged/scoped corpus | `serializeFor { wordlistId \| merged }` → Blob. |
| **Inline-editor seed** (`resolveSeed`, `entries-table.js`) | merge winner via `byKey`/`byNorm`/`mergedRowsForNorm`, plus My Edits' *raw* score | `fetchEditSeed { norm, display }` → worker returns the seed (winner + My Edits raw score). |
| **Editor provenance table** (`gatherProvenance`) | every source's rescored entry for one norm | `fetchProvenance { norm, display }` → worker returns the per-source rows. |
| **Editor live preview** (`previewWlEntry`/`currentPreview`, per keystroke) | `buildMergedWordlist().byNorm` on each keystroke | `fetchEditSeed`-style query, debounced; or compute the preview from data already in the open editor where possible. |
| **Post-edit re-bind** (`findResultEntry`/`resultHasEntry`/`rebindEntry`) | `_flatCorpus.byKey`/`byNorm` to keep the open popover on the live row through a re-render | the re-bind keys on `(norm, display)`; after an edit the worker's `result` (or the edit ack) carries the new index for that key. |
| **No-match quip + add-FAB seed** (`_renderEmptyState`, `newEntrySeedQuery`) | `byNorm.has(query)` to choose "Add it" vs. link to the existing entry | the worker ships an `existsInScope` flag for the current query in `result`; no synchronous lookup on the render path. |
| **Histogram axis + counts** (`scopedHistogramLayout`) | the *unfiltered scope* corpus scores (deliberately, to keep out-of-range bars clickable) | worker ships the **scope histogram layout + bucket counts** in `result` — distinct from the result's own stats. |
| **Score-badge color gradient** (`allSourcesHistogramLayout`) | *all sources'* rescored scores — a fixed axis that must **not** shift on scope change | worker ships the **all-sources color axis**, cached on main. To avoid re-shipping a fixed axis on every run, the worker tracks a sources/rules version and includes the axis in `result` only when that version changed; otherwise main keeps its cached copy. (Today main invalidates it via `invalidateHistogramLayout` off the rescore/source-count caches — that plumbing moves into the version check.) |
| **Result stats readout** (`computeStatsRaw` on the filtered set) | the result's scores | worker ships **result stats** in `result`. (So `result` carries *three* score-derived summaries: result stats, scope histogram, all-sources axis — don't conflate them.) |
| **Per-source counts — "X of Y used"** (`wordlistCardMeta` + the Download / "Last updated" gates in `scope-selector.js`, the Manage-dialog card meta in `manage-panel.js`, the update-summary readout) | the merge-**contribution** count *and* each wordlist's **total** `rawEntries.length` — different numbers, rendered together as "X of Y" | worker ships `sourceCounts` (contribution, from the merge) **and** `sourceTotals` (per-wordlist `rawEntries.length`). Both are needed — `sourceCounts` alone is only the "X". The totals also gate the Download button and the "Last updated" slot, so they can't be skipped. |
| **Welcome / discovery counts** | corpus/source sizes | shipped counts. |

`stats.js` and `histogram.js` already accept raw numeric score arrays, so the three summaries are a small worker-side step, not a rewrite. The work is the *plumbing* (the messages + the main-side wiring), and there's a lot of it.

## Message protocol (sketch — the executing session refines it and updates [`../worker-protocol.md`](../worker-protocol.md))

Main → worker:
- `fetchRows { requestId, start, end }` — a window of the current result.
- `fetchGroupChains { requestId, groupKey, start, end }` — a grouped result's per-group chains, on expand.
- `run { runId, stack, sort, scope }` — run the pipeline; `scope` selects merged or a source.
- queries: `fetchEditSeed { norm, display }`, `fetchProvenance { norm, display }`.
- mutations, one per kind: `editEntry`, `addEntry`, `deleteEntry`, `setRescoreRules { wordlistId, rules }`, `setScoring { tiers }`, `setEnabled`/`reorder`, `importText { wordlistId, text }`, `setFetchedText { wordlistId, text }`, `addWordlist`/`removeWordlist`.
- `serializeFor { wordlistId | merged }` / `exportResult { format, includeProvenance }` — disk write / download; worker replies with a Blob.
- `mergeDisk { wordlistId, fileText }` — the My Edits 3-way merge against the worker's own baseline (see *Disk sync*).
- `dumpCorpus` (test-only).

Worker → main:
- `ready` — initial load complete, first window available.
- `rows { requestId, start, rows: [{ norm, display, score, rawScore, comment, sourceId, highlights, glyph }] }`.
- `groupChains { requestId, chains }`.
- `result { runId, count, atomCount, sort, stats, scopeHistogram, allSourcesAxis, sourceCounts, existsInScope, widthHints }` — everything main needs to lay out and render without holding the corpus.
- `progress { op, wordlistId?, phase }` — long-op bracket; drives busy indicators.
- `blob { requestId, blob }`, `mergeResult { ... }`, `editAck { norm, display, index }`, `error { … }`.

Encoding (carries forward the existing protocol's rules): control messages are small structured-clone objects; **bulk text crosses as Blobs or transferable byte buffers, never as arrays of objects**. Row windows are one screen plus buffer, so per-row objects are fine there — the volume that forced columnar packing (the whole corpus) never crosses anymore.

## Disk sync

Main keeps the **handle / permission / UI coordination** (the file picker, the sync sign, watching for external changes). The worker owns all the **data operations** — including the My Edits 3-way-merge **baseline**, which lives with the data it's merged against:

- **Write** (one-way mirror, and My Edits → disk): the worker serializes the wordlist to a **Blob** and posts it; main writes the Blob to the `FileSystemFileHandle` (the writable stream accepts a Blob directly). The cross-thread handoff is near-free — Blobs pass by reference, no byte copy — so the disk write itself is the only real cost; several MB is a non-issue. (`regenerateFillOutputs` fans this out over every synced source plus merged on an output-format change — N serialize round-trips; fine, but expect the fan-out.)
- **Read** (external file change → My Edits 3-way merge): main reads the file and sends `mergeDisk { wordlistId, fileText }` to the worker; the worker runs the 3-way merge against its live data **and its own stored baseline**, applies the result, and **persists the new baseline**. Main gets the result back to write to disk and repaint.

**This needs a `SCHEMA_VERSION` bump.** Today one IndexedDB record (`sync_<dbKey>`) bundles the non-transferable `FileSystemFileHandle` with the baseline. The handle must stay main-side (permission requests need a document gesture); the baseline moves worker-side to live with the data. So the record **splits in two** — a main-written handle record and a worker-written baseline record — a stored-shape change. Per [`../migration.md`](../migration.md): bump `SCHEMA_VERSION`, register a `MIGRATIONS` step (keyed by the from-version) that reads each old combined `sync_*` record and rewrites it into the two new records, and ship a frozen before→after fixture test. **Budget for new plumbing, not just a new step:** today's `MIGRATIONS` runner transforms only the localStorage settings blob, and `migration.md` explicitly says disk-sync's IDB records need *no* migration and that IDB-record migration machinery gets built "when a change first demands it." This split is that moment — it requires building the IDB-record migration adapter and updating `migration.md`'s standing "disk sync needs no migration" statement. We deliberately do **not** special-case "the baseline is small enough to keep on main" — that's an assumption about My Edits size that could be wrong, and it would leave the baseline split from the data it merges against. Uniform ownership (data + baseline in the worker) is worth the one-time migration.

## Mutations as commands

Every mutation is a command to the worker: it applies the change, recomputes, and posts back a `result` summary (+ a `progress` bracket if long, + an `editAck` for the popover re-bind). Main then re-fetches the visible window. There is no optimistic local mutation of a main-side corpus (there isn't one) — main reflects what the worker reports. Edits and imports aren't latency-critical the way scrolling is, so the command round-trip is fine. This is the payoff of the single-owner model: a mutation is one message to one authority, with nothing to keep in sync.

## Boot orchestration

Moving "data loading" to the worker pulls more than reading bytes: the worker must run `parseWordlist` + `compileRescoreRules` + the merge, and the boot-seed logic (`defaultSources` / `ensureEdits` / `propagateDefaults` / `reconcileEditsRulesAfterImport`) currently lives in `app/actions.js` (the top layer) over `data/` + `model/`. That seed orchestration either moves worker-side or runs on main against synced config with the worker doing only parse/rescore/merge — an execution-time call. Main still reads the small per-wordlist **metadata** from localStorage to render the chrome (the wordlist bar, scope selector) while the worker loads entries from IDB; that split already exists (metadata in localStorage, text in IDB) and holds for *reading bytes*, just not for the parse/rescore/merge pipeline.

## Staging — each stage independently testable and roughly shippable

1. **Worker owns the data; main still renders from its own copy.** Move loading/parsing/merge/rescore into the worker; main keeps its current corpus and renders exactly as today. Purely additive; oracle = worker-loaded data equals main-loaded data, a **new** full-corpus fixture diff (`dumpCorpus`), not just the executor-output check `workerMirrorsMain` does today. Temporary ~2× *active-view* memory (today's reality already). De-risks the data move without touching rendering. **This stage alone is a partial win** (the merge build moves off main → cold boot and scope switch un-freeze), so the effort can stop here if stage 2 proves too risky — without the main-heap reduction.
2. **Async scroller.** Flip the scroller to fetch its window from the worker (prefetch buffer + placeholders + `requestId` supersession). **Be honest about the cost:** the scroller already branches flat-vs-rich pervasively (`_render`, `_flatRowAt`, `_getSortedSource`, `_computeSlotWidths`, `_statsViewEntries`, `_histogramEntries`, `exportRows`, `findResultEntry`, the click handler). Adding a windowed mode *alongside* the local fallback makes it temporarily **tri-modal** — the riskiest file in the codebase gets harder before it gets simpler, and "fallback in place" means carrying both paths at once. Worth it for the A/B safety, but not free.
3. **Cut main's copy.** Remove the main-side corpus → main heap drops to ~nothing; cold-boot, scope-switch, and fetch/import all fully off the main thread, and the scroller loses its local-path branches.
4. **Mutations → commands; then disk sync, export, and stats/histogram summaries** move worker-side, completing the thin-client picture, and the conversion table above is fully discharged.

## Testing

- A test-only `dumpCorpus` from the worker, diffed against fixtures, is the stage-1 oracle (a new fixture-diff test — *not* a generalization of `workerMirrorsMain`, which builds the corpus on main; here both sides must load/parse/rescore/merge identically and be compared in full).
- The existing browser behavior tests still hold — they drive the UI, which now reflects the worker; they don't care where the data lives.
- New coverage: async-scroll tests (scroll past the buffer → rows fill correctly and in order; scroll during a long run → no stale or blank rows persist) and a fetch/import-doesn't-freeze test (drive a fetch, assert the UI stays responsive).

## Out of scope

- **SharedArrayBuffer / shared-memory rendering.** It would allow synchronous reads of the corpus from main (no async scroller, no placeholders — it would dissolve the crux risk), but `SharedArrayBuffer` needs COOP/COEP cross-origin-isolation headers that **GitHub Pages cannot set** (a `coi-serviceworker` hack exists but is fragile), and a mutable shared corpus needs hand-rolled `Atomics` locking (and `Atomics.wait` is forbidden on the main thread). Set aside in favor of the portable message-passing model. Recorded here so the reasoning survives if the host ever changes.
- **Multiple workers** (e.g., a dedicated data worker). A second worker would need the corpus resident too — separate address space → *more* memory, not less — unless shared memory, which is out per the above. Single worker only.

## Risks and open questions

- **The async scroller is make-or-break.** Fast-fling-past-buffer is the case that flashes; the prefetch buffer size, the placeholder treatment, and the worker's yield-while-fetch-pending behavior decide whether it feels good. Prototype scroll-during-worst-case-run early — it is the stage-2 go/no-go gate.
- **The stage-2 tri-modal scroller** is the riskiest, ugliest interim state; budget for it.
- **The My Edits 3-way disk merge** moving worker-side (data + baseline both in the worker, file text from main); design and test it hard. The baseline-record split carries a `SCHEMA_VERSION` bump + migration + frozen fixture.
- **Grouped-row windowing** (group summaries + on-demand chains) is a new shape — make sure the "+N more" reveal and group stats all work off summaries + fetched chains.
- **Fetch content-diff** — fold it in or keep it separate? Recommended separate, but it determines whether fetch/import is "responsive but 30s" or "near-instant."
- **Memory** — measure after stage 3: confirm main's heap drops and the stale-tab GC smell relieves (the point of the whole thing). Total footprint is ~unchanged; main's is what matters.
- **The optional drop-resident-raw further win** — decide during execution (memory vs. re-parse-on-rule-change).
