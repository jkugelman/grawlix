# Web workers — moving the pipeline off the main thread

Grawlix evaluates its tool pipeline on the main thread. The work is split into small cooperatively-yielded chunks (`makeYielder`, a ~6 ms budget, `scheduler.yield()`) so the UI stays responsive between chunks — and on a fast machine it does. But a user has reported **noticeable lag while typing in the search box**, the most basic operation in the app. Cooperative yielding prevents a hard *freeze*, but it can't prevent *lag*: each ~6 ms chunk still runs on the main thread, competing with input and paint, and on a slower machine the chunks add up to dropped frames between keystrokes. This doc plans moving the pipeline executor into a web worker so that per-keystroke search, filtering, and sorting stop touching the main thread at all.

This reopens a decision. [`design.md` § Cooperative runtime](../design.md) ends with *"Workers — considered and rejected,"* whose stated revisit trigger was narrow: *"a built-in tool whose work fundamentally can't fit the cooperative budget."* The actual trigger turned out to be different and stronger — **search itself**, the bread-and-butter path, lags on real hardware. The old rejection also rested on a specific failure mode (*"copy 500 K entries every keystroke serializes ~25 MB through structured clone"*) that, on inspection, only bites the naïve shape; see *Resync is cheap* below. When this ships, that design.md section gets rewritten (via `distill-design-doc`) to record the worker architecture instead of the rejection.

## Scope

This plan covers **only the entries-table side: the tool pipeline, search, and sort.** That is where the reported lag lives and where the mature, already-yielding executor makes the move tractable.

The other expensive operations a constructor might want offloaded — adding / removing / reordering wordlists, editing scoring rules, fetching / importing — are **out of scope as work to move into the worker.** They survive in this design only as the *events that trigger a resync* of the worker's data snapshot. Moving the merge itself into the worker (which would de-jank those mutations too) is a real future step — *Option 2* below — but it relocates the entire cache/merge layer across the boundary and is deliberately deferred.

## The hard constraint, and why it isn't the bytes

Data can't be shared between threads cheaply — `postMessage` *copies* (structured clone), and it can't transfer functions or DOM at all. The instinct is therefore to keep data **local on both sides** and have them communicate by **index** rather than by shipping entry objects: if the worker and the main thread hold the same merged list in the same order, "entry N survived the filter" is a single integer, not an object.

The cost that matters is a **full resync** — shipping the whole merged list to the worker when the merged data changes. Benchmarked on the reporting user's machine, 1 M synthetic merged entries (`{norm, display, score, comment}`):

| representation | main-thread block (the jank) | round-trip |
|---|---|---|
| array of entry objects (naïve structured clone) | ~202 ms | ~435 ms |
| one flat tab/newline-delimited string | **~3 ms** | ~8 ms |
| UTF-8 bytes of that string, **transferred** | **~1 ms** | ~1 ms |
| `structuredClone(objects)` (both directions, main) | ~520 ms | — |

The bytes were never the problem — 14.5 MB moves in single-digit milliseconds. The expense is the **per-object** structured-clone tax: a million tiny objects each get walked and serialized. Pack the same data into one flat buffer and the transfer nearly vanishes; transfer ownership of an `ArrayBuffer` and the send is free.

**Two costs the table does not show, and both are real:**

- **Pack** (main thread): packing entries into the flat form is ~99 ms, O(N). It runs only on a *mutation*, never per keystroke, and mutations already pay a ~700 ms merge rebuild today, so it is noise on an already-occasional, Apply-gated event.
- **Unpack + reindex** (worker thread): the worker cannot run the pipeline against a flat string. The executor consumes `mergedWordlist.entries` (an array of `{norm,display,score}`), `byNorm` (`Map<norm, row>`, used by Semordnilap, Behead, Curtail, Space out, the Initialisms anchor, and every transform lookup), `byKey`, and `_initialChains` (the seed chain-row array). So on every snapshot the worker must parse the buffer back into ~1 M objects and rebuild those two Maps and the seed array — an O(N) cost comparable to or exceeding the pack. This is duplicated work (the main thread built the same indexes during the merge), but it lands **off the main thread**, so it costs *latency-to-first-answer after a resync*, not UI jank.

So "resync is cheap" means **transfer-cheap**; the reconstruction is not free, it is just not on the main thread. For an occasional mutation that latency is fine. The honest figure is "~99 ms main-thread pack + a near-free transfer + a ~100–200 ms worker rebuild before the worker can answer the next query."

**Conclusion: a full resync is transfer-cheap, so the design *starts* simple — full-resync on every merge-affecting change, no general incremental diff/patch protocol yet.** On any such change the main thread rebuilds the merge (as it does today), packs it, and ships the whole thing; the worker replaces its copy wholesale. The naïve-object path is never used.

This is a provisional baseline, not a principle. Full-resync is the simplest thing that works, not the end state — incremental fast-paths are *expected* to accrete as profiling exposes the costly events, and the architecture should stay amenable to them rather than painting itself into a full-resync corner. The seam is the message protocol itself: `snapshot` is the wholesale path, and `patch`-style messages are how targeted incremental updates attach. The **My Edits in-place patch** below is the first such fast-path — added now because it's plainly needed (see *My Edits edits*), with others likely to follow.

## Architecture

### Data ownership: main builds the merge, the worker is the engine (Option 1)

The main thread keeps the entire merge / rescore / cache architecture exactly where it is ([`design.md` § Caches](../design.md)). It remains the owner of `state`, the merged-wordlist cache, disk sync, and every mutation helper. On a merge-affecting change it rebuilds the merged view as it does today, then ships a flat snapshot to the worker.

This is chosen over *Option 2* (worker owns the merge too) for the smallest blast radius and zero regression: the main thread already pays the merge cost on mutations, so we add ~100 ms of pack-and-ship to events that already take ~700 ms, in exchange for moving the per-keystroke search loop entirely off the main thread — which is the reported bug. *Option 2* — the worker owning sources and the merge, so even the rebuild leaves the main thread — is the natural future step for de-janking mutations, and is parked, not rejected.

### The snapshot is lean and columnar — letters and scores only

The worker does not need the whole `wlEntry`. It reasons about **letters and scores**; it never renders. So the snapshot carries only the three fields the pipeline logic actually consumes:

- `norm` — dual-arm search, the `matchOn: 'norm' | 'both'` tools, `norm.length` for the Length axis and histogram bins, the merge/equivalence keys for group tools.
- `display` — the display search arm, `matchOn: 'display' | 'both'` tools (Initialisms' word boundaries, etc.).
- `score` — Min/Max sort axes, group stats, the post-pipeline score-range filter.

**`comment` and the source / `wordlist` reference stay on the main thread only.** Comment fall-through is resolved during the merge (already done, on main), and source attribution is a display-only column — neither feeds any pipeline decision. This is a clean conceptual line: *the worker owns letters and scores; the main thread owns presentation.* The snapshot is therefore columnar — a `norms` blob, a sparse `displays` blob, a `scores` typed array — which is smaller still than the benchmark assumed and ships as transferable buffers.

The main thread retains its **rich** merged array — the full `wlEntry`s with `wordlist` refs and comments — because it is what renders. The two copies share index positions by construction: the main thread built the merge and shipped it in order, so index *N* names the same entry on both sides.

### My Edits edits: the one deliberate exception to whole-snapshot resync

Index agreement has a sharp edge. My Edits edits do **not** rebuild the merge — `applyEditsChange` → `patchMergedForNorms` splices the merged `entries` array (and `_initialChains`) **in place**, per affected norm. When an edit changes a norm's display-variant count (a new entry, a delete, a rename) the spliced replacement differs in length from what it replaced, and **every index after the splice point shifts.** A worker holding the pre-splice snapshot would now disagree about what index *N* names. This is the app's deliberately-fast hot path — a single-norm edit is O(sources), not the O(all-entries) of a full rebuild — so "just reship the whole snapshot on every My Edits edit" would *delete that fast path*, turning each edit into a ~99 ms pack plus a ~100–200 ms worker rebuild. My Edits edits are discrete (a popover save, not held-key repeat), so a hitch would be tolerable — but it is avoidable, and avoiding it is cheap.

The fix is a **narrow `patch` message that mirrors `patchMergedForNorms` across the boundary.** The main thread already computes the affected norms' new rows; it sends just those (`{type: 'patch', norms, rows}`), and the worker applies the *identical* in-place splice to its own unpacked entry array and re-indexes only those norms in `byNorm`/`byKey`/`_initialChains`. Because both sides apply the same splice, their arrays stay in lockstep and index agreement is preserved without reshipping anything. This is the first incremental fast-path past the full-resync baseline, justified now because My Edits is the *only* in-place mutation path — every other merge change (reorder, enable/disable, import, scoring-rule edit) rebuilds the whole merge anyway, so a full reship is the natural shape there. More patch-style fast-paths may follow as profiling warrants; this is where they attach. (The worker holds its corpus as an unpacked JS array, not the columnar transfer buffers, so the splice is an ordinary `Array.prototype.splice` — the columnar form is purely the wire format.)

### The whole executor runs in the worker

Not a search-only slice. Once the pipeline core is carved out (next section), running only search in the worker would leave most of that carved code unused on the main thread and create a split-brain pipeline — transforms on main, search in the worker, with a handoff between them. So the entire executor — `executePipeline`, `runToolStage`, `bucketize`, `unify`, every tool's `run` / `prepare` / `group`, the cooperative yielder — lives behind the boundary. The main thread, in the steady state, runs no pipeline code at all.

The worker keeps its own caches, mirroring today's main-thread ones: the seed chains and the `_preSearchCache` (pipeline state up to just before the search row) live in the worker, so a keystroke re-runs only the search row over cached pre-search state, exactly as now — just on the other thread.

### Carving a DOM-free core, delivered single-file

The executor and everything it transitively calls must become a **self-contained, DOM-free island**: the tools, `toNorm`, `buildSearchPattern`, the phrase segmenter, the unigram corpus — none of it may touch `document`, `window`, `localStorage`, or `navigator`. This carving is the actual engineering of the project, and it is a worthwhile code-cleanliness exercise on its own merits, independent of workers. It is *not* a purely mechanical move — there are real violations to resolve:

- **The unigram corpus loader touches `localStorage`.** `loadUnigramCorpus` (Space out's `prepare` dependency) reads/writes `UNIGRAM_CORPUS_SIZE_KEY` via `lsLoad`/`lsSave`, and `localStorage` is unavailable in a worker (it throws on access). The `fetch` + IDB caching are worker-safe; only the size bookkeeping isn't. Fix: drop the size note from the worker path (it powers a main-thread "newer corpus available" check, not the segmenter), or hoist corpus loading to main and ship the compiled frequency `Map` to the worker.
- `compileRescoreRules` and the rescore layer are **not** part of the core — rescoring runs *before* the merge, and the worker receives entries already rescored and already merged. Drawing the boundary precisely: the worker gets the merged, rescored result; it never rescores.

A worker always loads its code from a URL and runs in a blank parallel global — it cannot see the page's variables, and `postMessage` cannot hand it a live function. To stay single-file, the core lives in a **dedicated pure `<script id="pipeline-core" type="text/javascript">` block**:

- It is real `type="text/javascript"`, so it executes on the main thread normally — the main thread needs those same functions (for `currentAtomCount`, for any non-worker fallback, for shared constants).
- It is authored as ordinary, highlighted, lintable, syntax-checkable JS — no string slab, no `fn.toString()` closure discipline to maintain.
- It is pure by construction, so it is safe to run in a worker.
- At boot the main thread reads the block's `.textContent`, appends a small worker epilogue (the message loop), wraps it in a `Blob`, and spawns the worker from the object URL. The worker runs the *identical text*, so a tool's `run` cannot drift between threads.

Rejected alternatives: shipping the **whole app script** with `if (isWorker)` guards fails because the IIFE singleton components build their DOM at module-eval (top level), so each throws in the worker before any message handler runs, and guarding them all leaves a silent invariant (a future top-level `document.…` breaks the worker at boot with nothing on main noticing). A literal source **string** loses tooling. `fn.toString()` works and is the fallback if a single block proves awkward, but its accidental-closure footgun (a reference to an outer variable compiles on main, throws in the worker) makes the dedicated block preferable.

Single-file is **not** what makes this hard — keeping it costs ~10 lines of `textContent` glue. Whether to drop the single-file constraint is a separate, broader decision (module imports, project structure) that would save those ten lines and nothing else here.

> A deployment note: a Blob-URL worker needs `worker-src blob:` if a Content-Security-Policy is ever set. Grawlix on GitHub Pages has no restrictive CSP today, so this is a non-issue — just a thing to remember if a CSP ever lands. `SharedArrayBuffer` is also off the table for the same family of reasons (it needs COOP/COEP cross-origin-isolation headers GitHub Pages can't set); the design does not need it.

### Returning results by index

The worker returns rows expressed by **index**, never as entry objects. Each **atom** is either:

- a **merged-array index** (the common case — a real merged entry the main thread already holds), or
- an inline **synthetic** `{norm, display, score}` (a tool output that exists in no wordlist, `wlEntry.wordlist === null`),

plus the atom's small `highlights` ranges (`{kind, start, end, coord}`) and its relation `glyph`. The main thread maps indices back to its rich merged array and builds synthetic `wlEntry`s for the inline ones, then the virtual scroller renders only the ~50 rows actually on screen.

**The worker returns the *entire* result set, not just a visible window.** The scroller renders ~50 rows, but the stats bar's counts/min/max (`computeStatsRaw`) and the histogram both consume the *whole* pipeline output — the histogram specifically sources the **unfiltered** bottom-line atom scores so it can show what dragging the score range would trim. So "communicate by index" shrinks the *per-row* payload (an int, not an object) but cannot shrink the *row count*: the worker returns all survivors (the flat `Int32Array` is the full sorted survivor list) so the main thread can draw the histogram and stats and window the table itself. The score-range filter stays a main-thread view filter over that full returned set, as today, so dragging the range re-windows without a worker round-trip.

The three pipeline tiers shape the payload:

- **Filter / search** (the 95 % case, and the laggy one) collapses to a flat list of survivor indices in display order. Ship it as a **transferable `Int32Array`** so even the worst case — a one-letter query matching ~1 M rows — returns in ~1 ms; the main thread holds the full sorted index array and windows it. Highlights ride alongside as a parallel array (cheap in practice: a wildcard query produces none, and a literal query selective enough to match a million rows is unusual).
- **Transform chains** return rows as short atom sequences (`RELEARNING → ELEARNING → LEARNING → EARNING`), each atom encoded as above. Heavily filtered, so these result sets are small.
- **Grouped** returns an array of groups, each carrying the worker-precomputed column values, the anchor's index, the Min/Max group stats used for sorting, and its surviving chains.

### The worker owns filter *and* sort

The scroller's current trick — pre-sort the corpus once into `_sortedSource`, then `.filter()`, which preserves order so the result is already sorted — can't span the thread boundary. So the worker holds the data sorted and returns indices **already in display order**; the main thread does nothing but slice the visible window. This keeps the main thread free even in the worst case (a short query matching almost everything would otherwise force a ~1 M-element sort on main — exactly the jank we are removing). A sort-axis change is just another run against the worker's cached survivors; the worker re-sorts and returns the new index order.

### Cancellation across the thread boundary

The subtle piece. Today supersession is a module-level `AbortController` — each new run aborts the previous, and the yielder checks `signal.aborted`. Across threads this must become messages, and the obvious version silently fails.

**`postMessage({type: 'cancel'})` does not interrupt a running worker.** It queues a `message` *task*, and that task is dispatched only when the worker returns to its event loop. A worker grinding through a synchronous million-entry loop never sees the cancel until the loop ends — so a fast typist's superseded runs would each run to completion, and the latest result would land late. The worker must keep yielding so the message can fire — and the yield must be the **right kind**:

- A **microtask** yield (a resolved promise, `queueMicrotask`) drains only microtasks and never delivers the `message` task. Definitively useless here.
- A plain **macrotask** yield — `setTimeout(0)`, or a `MessageChannel` self-ping for sub-4 ms granularity — unconditionally returns to the event loop and lets the queued `message` fire. **This is the one to use** — it's the only yield *guaranteed* by the event-loop model to deliver the message.
- `scheduler.yield()` is the one to *avoid* in the worker, and the reasoning needs care. Its continuations run at a boosted `"user-visible"` priority, scheduled ahead of same-priority `postTask` work; a worker `message` event, however, is an ordinary task with no spec-defined Prioritized-Task-Scheduling priority, so whether the continuation actually *starves* the message is a Chromium-implementation question, not a spec guarantee (and it differs from the main-thread `setTimeout`-timer starvation [`design.md`](../design.md) documents — a different task source). The safe framing: a macrotask is the *guaranteed* drain; `scheduler.yield()` is at best unnecessary here and at worst starves the cancel. **Verify the cancellation path empirically before building on it** rather than trusting the analogy.

The mechanism, mirroring today's controller but driven by messages:

1. The main thread tags each run with a monotonic id: `postMessage({type: 'run', runId: ++seq, stack, sort})`.
2. The worker's `onmessage` sets `latestRunId = runId` and stashes the request.
3. The worker's yielder, at each due point, does a macrotask yield (pending `run` / `cancel` messages flow in), then checks `if (thisRunId !== latestRunId) throw AbortError`. The throw unwinds the superseded run exactly like the abort path does today; a tiny scheduler then starts whatever run is latest.

A *newer* run implicitly supersedes an older one, so no explicit cancel is needed for the typist case; an explicit `{type: 'cancel'}` is kept for teardown and search-cleared. At most one run executes at a time (single thread), the same invariant the main-thread controller holds. The supersession flag lives in the worker's own scope, written by its own handler — no shared memory required.

### The worker yields coarsely — compute gets faster

A bonus falls out. The main-thread yielder fires every ~6 ms because it is protecting 60 fps paint and input. **The worker has no UI.** The only reason it yields at all is to let a cancel message through, so a much coarser interval — ~30–50 ms — cancels within a couple of frames of wall-clock while spending far less time on yield ceremony. So moving the executor off-main doesn't only unblock the UI; the compute itself runs *faster*, because it can stop apologizing to the frame clock. `makeYielder` becomes environment-specific: on main, `scheduler.yield()` tuned to ~6 ms for smoothness; in the worker, a coarse macrotask yield tuned only to cancellation latency.

A second bonus: the **slow-run indicator** can return to a simple JS timer. Today it is CSS-driven specifically because `scheduler.yield()`'s continuations starved a JS `setTimeout` on CPU-bound runs ([`design.md` § Cooperative runtime](../design.md)). With the compute in the worker, the main thread is idle while a run is in flight, so a plain `setTimeout(100)` started when the run is dispatched — and cleared when the result arrives — is no longer at risk of starvation. (Keeping the CSS approach is also fine; the point is the constraint that forced it is gone.)

## Message protocol

Small vocabulary; it falls out of the decisions above. Messages on one `Worker` are FIFO, which gives ordering for free.

**Main → worker:**

- `{type: 'snapshot', snapshotId, norms, displays, scores}` — replace the worker's merged data. Sent at boot and after every merge-affecting mutation *except a My Edits in-place edit*. Columnar; the buffers are transferred. `snapshotId` is monotonic, and bumps on a patch too.
- `{type: 'patch', snapshotId, norms, rows}` — the My Edits exception (see *My Edits edits*). Carries only the affected norms' recomputed rows; the worker applies the same in-place splice `patchMergedForNorms` applies on main, keeping the two index spaces in lockstep without a reship.
- `{type: 'run', runId, snapshotId, stack, sort}` — run the pipeline. `stack` is the serialized tool stack (tool keys + params + `grouped` flags + the search row's pattern — essentially what the URL already encodes); the worker looks up the tool *code* in its own copy of the catalog. `sort` is the axis + direction. The worker reuses its pre-search and post-search caches keyed on the stack, so a query-only change re-runs just search and a sort-only change just re-sorts — mirroring today's layered caching. Because `snapshot` precedes its dependent `run` in FIFO order, the worker always runs against the right data; `snapshotId` on the run is a defensive cross-check.
- `{type: 'cancel'}` — explicit supersession for teardown / search-cleared. Optional given implicit run-id supersession.

**Worker → main:**

- `{type: 'result', runId, snapshotId, grouped, atomCount, payload}` — the pipeline output, indices-not-objects as above; flat tier's index list is a transferred `Int32Array`. Tagged with `runId` so the main thread drops stale results, and `snapshotId` as a guard.
- `{type: 'error', runId, stackRowIndex, message}` — a tool threw. Maps to today's `ToolStageError` → `stackRow._error` → the red `⚠` row marker and `ErrorPopover`.

The main thread computes `currentAtomCount(stack)` itself (it is derivable from the stack alone, no data needed) for the scroller's stride, so a result need not block rendering of row heights.

## What stays the same

- The merge, rescore, cache, disk-sync, and reactivity architecture on the main thread — untouched. This plan is additive: a new execution venue for the pipeline, not a rewrite of the data model.
- The tool catalog and the chain-row / group-row / unify semantics — they move venue but keep their shape.
- `AtomPopover` editing, My Edits routing, the score-range post-filter, the histogram — all main-thread, all unchanged. The score-range filter still applies on main over the worker's returned rows (it is a view filter, not a pipeline stage), so dragging the range re-windows without a worker round-trip, as today.

## Open questions and risks

- **First paint vs. a persisted non-default sort.** Boot now needs: build merge → ship snapshot → issue initial run → await result → render, and worker spin-up (Blob creation + parsing the core + the first unpack/reindex) adds latency to first paint. The mitigation "main paints the at-rest view directly" only fully works for the **default alphabetical-ascending** landing, because the merged array is already norm-sorted at build, so that case needs no sort. But the at-rest view honors the user's *persisted* sort axis/direction, and a by-score or descending landing needs a sort this design just moved into the worker. So the contradiction has to be resolved deliberately, not left as "leaning toward": either (a) the main thread keeps a minimal sort path for first paint only (a little of the duplication the design otherwise avoids), or (b) first paint is alpha-asc-only and a non-default landing briefly shows alpha before the worker re-sorts — a one-frame flash on cold boot. Leaning (b): accept the cold-boot flash; it is cheaper than a duplicate sort implementation and only affects users whose last session left a non-default sort.
- **Memory: ~2× the corpus resident.** The main thread keeps the full rich merged array + `byNorm` + `byKey` + `_initialChains` (it renders); the worker keeps its own unpacked entry array + `byNorm` + `byKey` + `_initialChains` + `_preSearchCache`, plus transient pack/transfer buffers during a resync. That roughly doubles peak corpus memory — real for a constructor merging four large wordlists. Not a blocker, but it should be measured, and it is another point in *Option 2*'s favor long-term (one owner, one copy).
- **The test bridge must survive an async, abandonable pipeline.** `__grawlixTest.pipelineIdle()` resolves when `_pipelineRunning === 0`, and the whole Playwright suite awaits it after a keystroke. With the worker, `runPipeline` becomes "post `run`, await the `result` message," so the counter must increment at dispatch and decrement on `result`/`error`. The new trap: a **superseded run sends no reply** (the worker throws `AbortError` internally and moves on), so the main thread's pending promise for that `runId` must be settled on supersession too — otherwise `pipelineIdle()` hangs and every post-keystroke assertion times out, suite-wide. Build the run-tracking so an abandoned `runId` resolves (as aborted) rather than dangling.
- **Mutations still jank.** This plan de-janks *typing*, not *mutations* — the ~700 ms merge rebuild stays on the main thread (and gains the ~99 ms pack). Accepted: mutations are occasional and Apply-gated; typing is constant. *Option 2* is the eventual answer if mutation jank becomes the next complaint.
- **The carve has a maintenance invariant.** The `pipeline-core` block must stay DOM-free forever. A test should boot the worker and assert it doesn't throw, so an accidental `document.…`/`localStorage.…` in the core is caught in CI rather than as a silent worker-boot failure in the field. (The unigram-corpus localStorage violation above is exactly the class of bug this guards.)
- **Cancellation latency grows during `prepare`.** A tool's `async prepare` drives the same cooperative yielder, so the worker's coarse ~30–50 ms yield interval means a cancel arriving mid-`prepare` (e.g. while indexing a 1 M working set) is honored up to ~50 ms later instead of ~6 ms. Almost certainly fine, but it is a behavior change the "compute gets faster" framing glosses — name it so it isn't a surprise.
- **Worker lifecycle.** Unspecified and needs a story: spawn at boot (vs. lazily on first pipeline use), never torn down within a session, one worker per tab (each holding its own corpus copy — compounds the memory point above). Handle `onerror`/`messageerror` (a worker *crash*, distinct from a tool `error` message) by falling back to the main-thread core and re-spawning.
- **Browsers without workers** are not a concern (workers are universal), but the fallback path — running the core on the main thread, which it already can since the block executes there — is worth keeping wired as a safety net and for worker-spawn/crash recovery. The cost is that `_preSearchCache` then exists in two venues; the fallback must own cache coherence when it takes over.
- **Highlights payload encoding** is left simple (a parallel array) to start; if a pathological literal-match-everything case ever shows up, switch to a flat offset-encoded buffer.

## Related

- [`design.md` § Pipeline execution](../design.md), [§ Cooperative runtime](../design.md), [§ Caches](../design.md), [§ Reactivity](../design.md) — the current main-thread architecture this plan relocates. The *"Workers — considered and rejected"* note in *Cooperative runtime* is what this doc supersedes.
- [`tools.md`](tools.md) — the tool-catalog and chaining track; the worker runs whatever that catalog defines.
