# Web worker protocol — the main ↔ pipeline-worker contract

This is the **source-of-truth interface contract** between the main thread and the pipeline web worker: who owns which data, every message that crosses the boundary (fields + what each one *does* on receipt), and the cancellation/supersession rules. Code is not the only source of truth — when you add or change a message, a data structure, or the supersession policy, **update this doc in the same commit.**

**Why a worker at all, and the deeper *why* behind each decision** live in [`design.md` § Cooperative runtime](design.md) (why the off-thread move, the lean-columnar-transfer reasoning, the merge-stays-on-main choice, the rejected alternatives). This doc is the *what the interface is*, present-tense; the status markers below track which pieces are wired.

## Status legend

The worker is being built incrementally; this doc describes the full contract and marks how far each piece is:

- ✅ **live** — implemented and wired into normal operation.
- 🔶 **staged** — code exists (and is tested) but is not yet sent/used over the wire.
- ⬜ **planned** — designed here, not yet built.

> **Where we are now:** the worker runs **every pipeline run** (✅ — B4b) and, for the flat (filter-only) tier, **pre-sorts** the result and ships it index-backed (✅ — B5). `runPipeline` ([`ui/tool-stack.js`](../site/src/ui/tool-stack.js)) posts a `run` (with the active `sort`) to the worker (via the client [`ui/pipeline-worker.js`](../site/src/ui/pipeline-worker.js)). For the transform/grouped tiers the client materializes the by-index `result` back into rich rows; for the flat tier it hands the scroller a bare index array + scores + width hints, and the scroller materializes + re-derives highlights for only its visible window (so a 1-letter-matches-1M search no longer ships or materializes a million rows/highlights). The client owns run-id tracking, settling a superseded run as aborted, dropping stale results, and the per-run `_error` reset/assignment. `snapshot` ingest, the macrotask-yield supersession loop, the flat/transform/grouped encodings, flat-tier sort routing, segmenter I/O, and `cancel` are all live (`engine/worker.js`). Sort for the transform/grouped tiers still runs on main (the scroller sorts the materialized rows); a flat-tier sort-axis change re-runs the pipeline so the worker re-sorts. A worker crash falls the pipeline back to the **main-thread engine**, rescues the in-flight run, and respawns a fresh worker — permanently degrading to main after `MAX_CRASHES` (✅ — C2; see *Worker lifecycle*). A My Edits add/edit/delete now ships a small `patch` (touched norms only) instead of re-packing the whole corpus (✅ — C1; see the `patch` message). Every message in this contract is now live.

---

## Data ownership

The dividing line: **the worker owns letters and scores; the main thread owns presentation and all of `state`.** The worker reasons about norms/displays/scores and never renders, so it never needs `comment`, the `wordlist` source reference, or any DOM.

### Main thread owns

| Data | Shape | Notes |
|---|---|---|
| `state` | sources, scoring (tier labels), search state | the app's root state; never crosses the boundary |
| **rich merged array** `mergedWordlist.entries` | `[{ norm, display, score, rawScore, comment, wordlist }]` | what renders; the worker gets a lean subset |
| `byNorm` | `Map<norm, wlEntry>` | canonical row per norm, built via shared `buildByNorm` (see *Invariants*) |
| `byKey` | `Map<mergeKey, wlEntry>` | per `(norm, display)` variant; **main-only** — not consumed in `engine/`, never shipped |
| `_initialChains`, `sourceCounts` | seed chain rows / per-source tallies | |
| merge / rescore / cache / disk-sync / persistence | — | the whole data layer stays on main (Option 1) |
| score-range view filter, histogram, stats, virtual scroller, rendering | — | all main-thread; the score-range filter is a *view* over the worker's returned set, not a pipeline stage. Transform/grouped sort here too; the flat tier arrives pre-sorted from the worker |
| the pipeline-worker **client** | run-id → promise tracking; transform/grouped result → rich-row mapping, flat result → index-backed handoff | `site/src/ui/pipeline-worker.js` |

### Worker thread owns ✅

| Data | Shape | Notes |
|---|---|---|
| unpacked corpus `entries` | `[{ norm, display, score }]` | **lean** — no `comment`, no `wordlist`; index-aligned with main's rich array |
| `byNorm` | `Map<norm, row>` | rebuilt by the **same** `buildByNorm`; no `byKey` |
| `_initialChains` | seed chain rows | lazily built by the executor's `buildInitialChains` over `entries` |
| `_preSearchCache` | pipeline state up to just before the search row | mirrors today's main-thread cache, so a keystroke re-runs only the search row |
| the executor + full tool catalog | `executePipeline` / `runToolStage` / `bucketize` / `unify` + every tool's `run`/`prepare`/`group` | imported directly from `engine/` (the worker runs the identical module text the main thread would) |
| segmenter I/O (unigram corpus) | `configureIO({ idbGet, idbPut, onSize })`, called once at worker boot | `idbGet`/`idbPut` live in `data/storage.js` (not importable from `engine/`), so the worker opens the **same** IndexedDB DB/store (`grawlix`/`data`, v1) directly — the cached unigram corpus is per-origin, shared with main. `onSize` is a no-op (the LS corpus-size note is main-only). Lets transform tools that need the corpus (Space out's `prepare` → `loadUnigramCorpus`) run in the worker. |

### The relationship: index agreement

Main builds the merge **in order** and ships it in order; the worker unpacks in order; so **index *N* names the same entry on both threads.** This is the load-bearing invariant — every result the worker returns is expressed as indices into this shared order, and the main thread maps them back to its rich rows for rendering. See *Invariants*.

---

## The snapshot wire format

✅ Pure functions in [`site/src/engine/snapshot.js`](../site/src/engine/snapshot.js); `packSnapshot`/`snapshotTransferables` ship the corpus, `unpackSnapshot` ingests it in the worker.

The corpus crosses the boundary **columnar and transferred**, not as an array of objects. Per-object `structuredClone` of ~1M tiny objects is ~200 ms of main-thread jank; packing the same data into flat buffers and *transferring* ownership of the `ArrayBuffer`s makes the send ~1 ms. Only the three fields the pipeline reads are packed (`norm`, `display`, `score`); `comment`/`wordlist` stay on main.

`packSnapshot(entries)` → an object with:

| Field | Type | Meaning |
|---|---|---|
| `count` | number | entry count (drives decode loops) |
| `scores` | `ArrayBuffer` (Int32) | one score per entry, index-aligned. **Int32** — scores are always integers; a fractional one would truncate silently |
| `norms` | `{ bytes: ArrayBuffer, offsets: ArrayBuffer }` | `bytes` = UTF-8 of all norms concatenated; `offsets` = `Uint32Array` length `count+1`, cumulative — norm *i* is `bytes[offsets[i] .. offsets[i+1]]`. `TextEncoder`/`TextDecoder` for exact multibyte round-trip |
| `displays` | `{ present: ArrayBuffer, bytes, offsets }` | **sparse**: `present` is a 1-bit-per-entry `Uint8Array` bitmap (set = display is non-null); only non-null displays are encoded into `bytes`/`offsets`, in entry order. An unset bit unpacks to `display: null` — deliberately **not** collapsed to `norm` (the pipeline reads the raw field; `displayOf` does the norm fallback at read time) |

`unpackSnapshot(snapshot)` → `{ entries, byNorm }`. `_initialChains` is **not** rebuilt here — it's left to the executor's lazy `buildInitialChains` (so `snapshot.js` doesn't import `executor.js`, keeping the engine layer acyclic).

`snapshotTransferables(snapshot)` → the six backing `ArrayBuffer`s (`scores`, `norms.bytes/offsets`, `displays.present/bytes/offsets`) for the `postMessage` transfer list. **Transferring detaches them on the sender** — fine, because main keeps its separate *rich* array; it never needs the packed buffers after the send.

---

## Message encoding & packing

Two encodings cross the boundary, by design — a deliberate **mix**, not "objects everywhere" nor "binary everywhere." The split is by size:

**1. The control envelope — a small structured-clone object.** Every message is a plain object with a `type` discriminator and a handful of scalar fields (`runId`, `snapshotId`, the serialized `stack`, `sort`). These ride `postMessage`'s default structured clone, and that's the right call *because they're tiny and bounded* — cloning a few integers plus a small stack descriptor (≈ what the URL encodes) is negligible. Control data stays objects.

**2. Bulk payloads — raw binary, transferred (never objects, never per-row).** Anything O(corpus) or O(results) is packed into `ArrayBuffer`s and handed to `postMessage`'s **transfer list**, which moves ownership instead of copying — a multi-megabyte buffer crosses in ~1 ms. This is the whole performance premise: an array of ~1M `{norm,display,score}` objects costs ~200 ms of main-thread structured-clone; the same data as flat buffers transfers in ~1 ms.

The bulk binary uses three column types:
- **numbers → typed arrays.** Scores are an `Int32Array`; a result's survivor list is an `Int32Array` of indices. The backing `ArrayBuffer` is transferred.
- **strings → a UTF-8 byte blob + a `Uint32Array` offset table.** One `ArrayBuffer` holds every string's UTF-8 bytes concatenated; the offsets array (length `count+1`, cumulative) makes string *i* = `bytes[offsets[i] .. offsets[i+1]]`. `TextEncoder`/`TextDecoder` give exact multibyte round-trips. (The snapshot's `norms` and sparse `displays` are the worked example, above.)
- **presence / flags → a bit-packed `Uint8Array`.** e.g. the displays "is-non-null" bitmap.

**Why binary and not one big delimited string?** A single tab/newline-delimited string clones reasonably fast (~3 ms in the benchmark) and is simpler — but a JS string is **not transferable**, so it's always *copied*, and the worker would have to re-split it on every receipt. Binary columns transfer zero-copy, keep numbers in native typed form (no parse), and need no splitting on unpack. So for the bulk path, strings become *bytes*, not a JS string.

**Results cross as indices, not entries.** The single biggest "don't send objects" lever: the worker never returns entry objects. A surviving row is an integer index into the shared corpus order (one `Int32`), and the main thread maps it back to its own rich row. Only *synthetic* atoms (tool outputs that exist in no wordlist) travel inline as a small `{norm,display,score}` — and those tiers are heavily filtered, so the clone cost there is trivial.

**Small, already-filtered payloads stay objects.** Transform-chain atom sequences and grouped-result group objects are sent as ordinary structured-clone objects — small because those tiers are heavily filtered. The flat tier (the one that *can* match everything) ships no objects at all: just the transferred index + score buffers, with highlights re-derived on main for the visible window (B5) — the predicted "don't ship highlights for the match-everything case" outcome.

### Encoding at a glance

| Payload | Encoding | Transport |
|---|---|---|
| message envelope (`type`, `runId`, `snapshotId`, `stack`, `sort`) | plain object | structured clone (tiny) |
| corpus scores | `Int32Array` | **transferred** |
| corpus norms / displays (strings) | UTF-8 byte blob + `Uint32` offsets | **transferred** |
| display presence bitmap | `Uint8Array` | **transferred** |
| flat result: survivor indices (sorted) + parallel scores | `Int32Array` ×2 | **transferred** |
| flat result: column width hints | small `{ maxDisplayLen, maxLenDigits, maxScoreDigits }` object | structured clone (tiny) |
| flat result: highlights | **not shipped** — re-derived on main for the visible window | — |
| transform-chain atoms / group objects | tagged-atom objects (`{i}` index / `{s}` synthetic + `h`/`g`); groups add `key`/`anchor`/stats | structured clone (small) |

The rule of thumb for a new message: **scalars and small/filtered structures go as the object; anything that scales with the corpus or the full result set gets packed into a transferable `ArrayBuffer`.**

---

## Messages

Messages on one `Worker` are **FIFO**, which gives ordering for free (a `snapshot`/`patch` always arrives before a `run` that depends on it). Every message is a plain object with a `type` discriminator (see *Message encoding & packing* for how its fields and any bulk payload are encoded).

### Main → worker

#### `ping` ✅
`{ type: 'ping' }` — liveness / spawn check. Worker replies `pong`. The only message wired today; a useful health check that will likely stay.

#### `snapshot` ✅
`{ type: 'snapshot', snapshotId, count, norms, displays, scores }` — **replace the worker's entire corpus.**
- `snapshotId` — monotonic; identifies this corpus version. Bumps on a `patch` too.
- `count` / `norms` / `displays` / `scores` — the columnar payload above; the buffers are **transferred**.
- **Sent:** at boot (the first run's ship), and after *every* merge-affecting mutation (reorder, enable/disable, import, scoring-rule edit) — i.e. anything that already rebuilds the merge on main. A My Edits in-place edit ships a `patch` instead (below), *not* a full snapshot, when the worker is holding the merged corpus. The client (`ui/pipeline-worker.js`) ships from `ensureSnapshot`, called at the top of every `run` dispatch, when the active corpus changed since the last ship by either identity (a new object: scope switch, merge rebuild) or a monotonic `_snapVersion` that `patchMergedForNorms` bumps (an in-place splice keeps the same object, so identity alone misses it — but a `patch` having already advanced `lastShippedVersion` lets the next run skip the reship). FIFO ordering then guarantees the `snapshot` arrives before the `run` that depends on it.
- **On receipt (implemented):** worker `unpackSnapshot`s, replaces `entries` + `byNorm` wholesale, rebuilds the identity `entryToIndex` map (entry object → corpus index, the key to decoding results), records the `snapshotId`, and invalidates `_preSearchCache` (and drops the lazy `_initialChains`). The next `run` rebuilds caches against the new corpus.

#### `patch` ✅
`{ type: 'patch', snapshotId, norms }` — **the My Edits in-place exception** to whole-corpus resync.
- `snapshotId` — monotonic, like `snapshot`'s; the client increments the same `shippedSnapshotId` for a patch, so a patch's id is the snapshot id + 1.
- `norms` — an array of `{ norm, rows }`: each touched norm and its recomputed **lean** `{ norm, display, score }` rows (no `comment`/`wordlist` — the worker's entries are lean). `patchMergedForNorms` returns this descriptor from the same `rows` it splices into main's merged array.
- **Sent:** only on a My Edits add/edit/delete, which on main splices the merged array in place (`patchMergedForNorms`) rather than rebuilding — avoiding a full reship of an O(all-entries) pack for an O(sources) edit. The client (`sendPatch`) ships it **only when the worker is holding the merged corpus** (`corpus === shippedCorpus`). If the worker holds a *different* corpus — e.g. the user is scoped to My Edits, so the worker has a scoped corpus — `sendPatch` **returns without shipping**: reshipping here would mirror the wrong corpus; the next merged run's `ensureSnapshot` reships fresh instead. When degraded to main (C2) it also no-ops (main runs against its own in-place-patched cache). A sent patch advances `shippedSnapshotId` and sets `lastShippedVersion` to the cache's new `_snapVersion`, so the subsequent run's `ensureSnapshot` (same object, version now in sync) skips a full reship.
- **Ordering:** `applyEditsChange` calls `sendPatch` synchronously, *before* the caller's refresh posts the `run` — FIFO then guarantees the worker applies the splice before running against it.
- **On receipt:** worker binary-searches `entries` for each norm's run (in main's `norm.localeCompare` order — the search **must** match that order or the splice lands wrong), splices in the new lean rows, splices `_initialChains` in parallel (same atom shape `buildInitialChains` produces), and sets `byNorm` for the norm to `canonicalNormRow(newRows)` (or deletes it when empty). Because a count-changing splice shifts every later index, it then **rebuilds `entryToIndex` from scratch** (correct, and still far cheaper than a reship — no string codec), invalidates `_preSearchCache` (the corpus changed), and records the `snapshotId`. Because both sides apply the identical splice and share `canonicalNormRow`, **index agreement and `byNorm` are preserved without reshipping.**
- **Defensive:** if the worker has no `corpus`, or `snapshotId` isn't the expected next id (it missed the base snapshot this patch builds on), the patch is dropped — a later `ensureSnapshot`/reship recovers. A `patch` arriving when `corpus == null` never throws.

#### `run` ✅
`{ type: 'run', runId, snapshotId, stack, sort }` — **execute the pipeline.**
- `runId` — monotonic; the supersession key (see *Cancellation*).
- `snapshotId` — which corpus this run expects; a defensive cross-check (FIFO already guarantees the right corpus is loaded). Echoed back on the `result` (falling back to the worker's current `snapshotId` if the run omits it).
- `stack` — the serialized tool stack: an array of `{ tool, params, grouped }` descriptors (≈ what the URL encodes), plucked off each `ToolStack.getStack()` row by the client. The worker rebuilds each row via `makeToolRow(tool)` then overlays `params`/`grouped` — the same defaults-then-override order `router.js applyURL` uses, so the executor sees the identical row shape. The tool **code** is looked up in the worker's own copy of the catalog; functions never cross the boundary. An unknown `tool` key is skipped.
- `sort` — `{ key, dir }` (axis + direction). **Honored for the flat tier (B5):** the worker sorts the survivor indices by this axis before shipping them, mirroring the scroller's single-tier `SORT_AXES` (`entry`/`length`/`score`, each with its fixed-direction tiebreaker chain) — those axes read only `corpus.entries[idx].{norm,score}` + `norm.length`, all worker-resident. Even `entry`/asc is sorted (native merge order ties by display, the `entry` axis by score), so main never re-sorts. The transform/grouped tiers still ignore `sort` (their axes need every atom → the scroller sorts the materialized rows). A flat-tier sort-axis change re-runs the pipeline rather than re-sorting on main.
- **On receipt:** worker sets `latestRunId = runId`, stashes the request as `pending`, and drives a drain-to-latest run loop: `executePipeline(corpus, stack, signalShim)` against its cached pre-/post-search state, then posts `result` — unless superseded first. The signal shim's `aborted` is `thisRunId !== latestRunId`. **The worker drops its `_preSearchCache` when the user-stack portion of the stack changes between runs** (it compares a signature of `stack` minus the trailing search bar): main's `ToolStack` mutation handlers invalidate the cache via in-realm signals the worker never sees, so the worker must detect the user-stack change itself — otherwise a tool add/remove/edit runs against the previous stack's stale pre-search state.

#### `cancel` 🔶
`{ type: 'cancel' }` — explicit supersession, for teardown / search-cleared. Optional given that a newer `run` implicitly supersedes (see *Cancellation*).
- **On receipt (implemented):** worker advances `latestRunId` past every live run and clears `pending`, so the in-flight shim aborts at its next yield and no run is queued. No reply.

### Worker → main

#### `pong` ✅
`{ type: 'pong' }` — reply to `ping`.

#### `result` ✅ (all three tiers)
`{ type: 'result', runId, snapshotId, grouped, atomCount, payload }` — **pipeline output, expressed by index wherever it can be, never as corpus entry objects.**
- `runId` / `snapshotId` — main **drops stale results** whose `runId` isn't the latest dispatched; `snapshotId` guards against a corpus mismatch.
- `grouped` — whether the bottom row is grouped (shapes `payload`).
- `atomCount` — atoms per row (the scroller also derives this from the stack alone, so row heights don't block on the result).
- The **atom encoding** — the shared unit of the transform/grouped tiers. An atom is a small tagged object, exactly one of:
  - `{ i: <index> }` — a corpus atom: `i` is `entryToIndex.get(wlEntry)`, the entry's index into the shared corpus order. Decode via main's rich row at that index.
  - `{ s: { norm, display, score } }` — a **synthetic** atom: a tool output that exists in no wordlist (`wlEntry.wordlist === null`, the `[string, score]` tool-output form). Inline, **not** looked up in `byNorm` on receipt.
  - plus optional `h` (the atom's `highlights`, omitted when null) and `g` (its `glyph`, one of `'→' | '↔' | '⊃'`, omitted when null).
- `payload` — tiered:
  - **filter/search** ✅ (the common, laggy case): all transferred, **no highlights, no per-row objects** (B5). `payload = { indices: <ArrayBuffer>, scores: <ArrayBuffer>, widthHints }`. `indices` is an `Int32Array` of survivor indices, **already sorted** by the run's `sort` axis/dir; the survivor index for a row is `entryToIndex.get(row.atoms[0].wlEntry)` (every atom in a flat row is the same word, so `atoms[0]` names the row). `scores` is an `Int32Array` parallel to `indices` (one score per survivor, in sorted order) — the main thread scans it for stats/histogram without touching the corpus. `widthHints = { maxDisplayLen, maxLenDigits, maxScoreDigits }` is the one-pass column-width summary the scroller needs to size its grid tracks without scanning all rows. The full survivor set, not a window — stats and the histogram consume the whole output; the main thread windows the table itself and **re-derives the search highlights for only its visible window** (it reconstructs each active highlighting filter's match ranges via `engine/search.js buildSearchPattern(...).searchRanges`, replaying the executor's `runToolStage` + `collapseRepeatAtoms` per visible entry). This is the single biggest lag lever: the pathological 1-letter-matches-1M case used to structured-clone a 1M-element highlights array (~3.2 s) and materialize 1M rows; now it transfers two buffers in ~1 ms and materializes ~50 rows.
  - **transform chains** ✅: `payload = { chains: [{ atoms: [<atom>, ...] }, ...] }` — one chain per row, each atom in the encoding above. Fires when any row is *rich* — carries a glyph, spans more than one word (an atom whose `wlEntry` differs from `atoms[0]`'s), or holds a synthetic — i.e. the flat index encoding (which keeps only `atoms[0]`'s index) would be lossy. Structured-cloned, not transferred: this tier is heavily filtered, so it's small.
  - **grouped** ✅: `payload = { groups: [<group>, ...] }`. Each group is `{ key, anchor, _minScore, _maxScore, _count, chains: [{ atoms: [<atom>, ...] }, ...] }`. `key` is the tool-derived group key, structured-cloneable as-is (string/number/structured — no functions). `anchor` is `null` or the **atom encoding** (`{i}`/`{s}`, never `h`/`g`) for the group's anchor entry. `_minScore`/`_maxScore`/`_count` are the precomputed group stats. Structured-cloned, not transferred.
- **On receipt:** the client guards `result.snapshotId === shippedSnapshot().snapshotId` (a stale id means the worker answered against a corpus main no longer holds → drop as aborted) and that the `runId` is the latest dispatched (else drop). For the **flat tier** it returns an index-backed result — `{ flat: true, corpus, indices, scores, widthHints, atomCount, grouped: false }` (no `rows`) — and the scroller stores the index array + scores + hints, materializing `corpus.entries[idx]` rows and re-deriving their highlights only for the visible window. For the **transform/grouped tiers** it walks each atom — `{i}` → its rich row at that index, `{s}` → a freshly built synthetic `wlEntry` matching `synthWlEntry`'s shape (`{ norm, display, score, comment: '', wordlist: null }`, **not** looked up in `byNorm`) — reattaching `h`/`g` and the group `key`/`anchor`/stats, returning `{ rows, atomCount, grouped }`. Either result settles the run's pending promise; `runPipeline` decrements the in-flight counter that gates `pipelineIdle()`. The score-range view filter then runs on main (flat: it filters the index array by `scores`, order-preserving; transform/grouped: over the rows). Flat results arrive pre-sorted; transform/grouped are sorted on main.

#### `error` ✅
`{ type: 'error', runId, stackRowIndex, message }` — a tool threw (a `ToolStageError`). `stackRowIndex` is the row's position in the run's stack (or `null` if it can't be located).
- **On receipt:** the client sets `stack[stackRowIndex]._error = message` → the red `⚠` row marker + `ErrorPopover`, and settles the run's promise with the errored shape (`{ aborted: false, errored: true, rows: [], atomCount, grouped: false }`). Main owns the per-run `_error` *reset* now too — the client clears stale marks on every row at dispatch (before posting the run), since the executor's old per-run reset runs in the worker's realm and never touches main's live rows.

---

## Cancellation / supersession

Single thread → **at most one run executes at a time**, the same invariant today's main-thread `AbortController` holds. Supersession becomes message-driven:

1. Each `run` carries a monotonic `runId`. The worker stores `latestRunId` (written by its own `onmessage`, so no shared memory).
2. A **newer `run` implicitly supersedes** an older one — no explicit `cancel` needed for the fast-typist case. `cancel` exists only for teardown / search-cleared.
3. The worker's yielder, at each due point, does a **macrotask yield** so a queued `run`/`cancel` message can fire, then checks `if (thisRunId !== latestRunId) throw AbortError`. The throw unwinds the superseded run exactly like today's abort path; a tiny scheduler then starts whatever run is latest.

**The yield must be a macrotask, and `setTimeout(0)` is the one to use** — empirically confirmed by the B1 spike, which proved it preempts an in-flight run within one yield window on all three engines, and (a fresh callback per call) is naturally **re-entrant**. Re-entrancy matters because superseding runs overlap by construction — run #2 starts before run #1 has unwound — and a shared single-slot yield resolver silently orphans the older run (the spike reproduced this). A *microtask* yield (`queueMicrotask`, resolved promise) drains only microtasks and **never** delivers the `message` task — the spike's negative control confirmed an in-flight run runs clean to completion under a microtask yield. `scheduler.yield()` is **forbidden** in the worker: the spike confirmed its boosted-priority continuation **starves** the `message` on Chromium (it preempts on Firefox, is absent on WebKit), so relying on it would silently break cancellation on the dominant engine. A `MessageChannel` self-ping also works but gave no latency win and would need a fresh channel per call, so it's not worth it over `setTimeout(0)`.

**A superseded run sends NO reply** (it throws `AbortError` internally and moves on). The main client therefore **must settle that `runId`'s pending promise itself** (as aborted) — otherwise `pipelineIdle()` (which the whole Playwright suite awaits after a keystroke) dangles and every post-keystroke assertion times out, suite-wide. **Reap superseded runs by `runId`, not by waiting for a terminal message:** the spike showed an abandoned run's terminal event can arrive *after* the winner's `result`, or (with a non-re-entrant yield) never — so the client tracks in-flight `runId`s and settles the stale one on dispatch of the newer run, rather than depending on the worker to report each abandonment.

The worker yields **coarsely** (~30–50 ms) — it has no UI to keep at 60 fps, so it yields only often enough to honor cancellation, which also makes the compute itself faster than the main thread's ~6 ms cadence.

---

## Worker lifecycle

- **Spawn:** lazily via `getWorker()` on first use, one worker per tab — but that first use is the boot-time snapshot, so in practice it comes up at boot. Spawned via `new Worker(new URL('./engine/worker.js', baseURL), { type: 'module' })`, where `baseURL` is **`main.js`'s `import.meta.url`**, injected at boot through `configurePipelineWorker({ baseURL })`. (Anchoring on `main.js` is load-bearing — bundling inlines the `new URL` literal verbatim without rewriting its relative path, and the client module sits at a different depth than the bundle, so a client-anchored URL is dev-passing/prod-404. See [`site/src/ui/pipeline-worker.js`](../site/src/ui/pipeline-worker.js).)
- **Memory:** each tab's worker holds its own corpus copy → roughly **2× peak corpus memory** (rich array on main + lean array in worker, each with its `byNorm`/`_initialChains`). Real for a constructor merging four large wordlists; measure it.
- **Crash → fallback → respawn (✅ — C2):** a worker crash — the parent `Worker`'s `error` / `messageerror` event, **distinct from a tool `error` *message*** (which the worker still posts cleanly over a live connection) — falls the pipeline back to the **main-thread engine** (`executePipeline`, the identical `engine/` module text the main thread already imports), recovers the in-flight run, and lets the next run respawn a fresh worker. The full sequence:
  - **Crash detection.** The client (`ui/pipeline-worker.js`) wires `error` and `messageerror` listeners on the `Worker` at spawn, both → `onWorkerCrash`. (Both are catch-alls for a dead worker; neither carries a usable error payload for recovery — the run is simply re-run.)
  - **Teardown + forced reship.** `onWorkerCrash` removes the dead worker's listeners, `terminate()`s it, and nulls `worker`. It **also nulls `shippedCorpus` / `lastShippedVersion`** — a respawned worker boots with no corpus, so `ensureSnapshot` must reship rather than assume the dead worker's load carried over (the same identity/version check it always uses; a stale "already shipped" state would silently run the respawned worker against an empty corpus).
  - **In-flight rescue.** The dead worker owes no reply, so the run it was executing would strand its awaiter — and `pipelineIdle()` (which the whole suite gates on) with it. `onWorkerCrash` re-runs that run's exact `{corpus, stack}` on main via `runMainThread` and resolves the **original** promise. To make this possible the worker-path `pendingRun` carries the run's `corpus` (`{runId, resolve, stack, corpus}`). The rescue is **supersession-safe**: if the user types again during it, the new run advances the shared `runCounter`, so the rescue's signal shim reports `aborted` and it resolves `{aborted:true}` (harmlessly dropped) rather than clobbering the live result.
  - **The main-thread run (`runMainThread`).** A self-contained async run mirroring the worker's `runOne`: resets every stack row's `_error`, takes a `runId = ++runCounter` and a signal shim `{ get aborted() { return runId !== runCounter; } }` (mirrors the worker's `makeSignalShim`), and `await executePipeline(corpus, stack, signal)`. On success it returns `{rows, atomCount, grouped, aborted:false}` (the pre-worker rich-row shape — `result.flat` is falsy, so the scroller takes its rich-row path); if superseded, `{aborted:true}`. On a tool throw it mirrors the worker's error handling exactly — `AbortError`/superseded → `{aborted:true}`; otherwise it locates `stack.indexOf(e.stackRow)`, sets that row's `_error`, and returns the errored shape `{aborted:false, errored:true, rows:[], atomCount: currentAtomCount(stack), grouped:false}`. `runMainThread` never touches `pendingRun` (worker-path-only); its supersession is purely the `runCounter` check. The pre-search cache lives in main's own executor realm and is kept coherent by `ToolStack`'s existing `invalidatePreSearchCache()` calls, so the fallback does **not** manage it.
  - **Respawn.** Automatic: with `worker = null` after a crash, the next `runOnWorker` calls `getWorker()`, which respawns, and `ensureSnapshot` reships (because the corpus state was nulled). No explicit respawn code beyond the teardown.
  - **Permanent degrade (`MAX_CRASHES = 2`).** `onWorkerCrash` increments `crashCount`; once it reaches `MAX_CRASHES`, `useMainThread` latches `true` for the rest of the session and `runOnWorker` short-circuits to `runMainThread` on its first line — a hard ceiling on a crash → respawn → recrash loop.
  - **Test hooks.** `engine/worker.js` has a test-only `__testCrash` `onmessage` case that throws uncaught, firing the parent `Worker`'s `error` event (the real crash signal). The client exposes `crashWorkerForTest()` (posts `__testCrash` — exercises the real event wiring) and `forceWorkerCrashForTest()` (calls `onWorkerCrash` directly — deterministic, no dependence on the browser firing `error`), plus `pipelineWorkerState()` → `{ degraded, crashCount }`. The oracle is [`tests/browser/worker-crash-fallback.spec.js`](../tests/browser/worker-crash-fallback.spec.js): it crashes the worker and asserts a real run's survivors still match an in-page `executePipeline`, that an in-flight run settles (no hang), and that two crashes degrade permanently.

---

## Invariants (do not break these)

1. **Index agreement.** Index *N* names the same entry on both threads. Main builds and ships the merge in order; the worker unpacks in order; results are by index. The `patch` message exists specifically to keep this true across an in-place My Edits splice. Breaking it silently corrupts every rendered row.
2. **`byNorm` cannot drift.** Both threads build `byNorm` via the one shared `buildByNorm(entries)` ([`engine/snapshot.js`](../site/src/engine/snapshot.js)) — canonical row = the **code-unit-minimum** display per norm. The per-norm patch path uses the sibling `canonicalNormRow(rows)`, which applies the **same** rule to one norm's rows; `patchMergedForNorms` (main) and the worker's patch reindex both route through it, so they can't disagree on case variants (`'CAT'` vs `'Cat'`). Never reimplement the canonical-row selection on one side.
3. **Worker = letters + scores; main = presentation.** The worker never holds `comment`, the `wordlist` ref, or DOM, and `engine/` stays DOM-free (enforced by `tests/unit/engine-dom-free.test.mjs`). Anything display-only is resolved on main.

---

## Adding a message

When the protocol grows (new request/response/sync types are expected): pick a `type` string, add a row to the appropriate Main→worker / Worker→main section above with **direction, every field, what happens on receipt (which state updates), and any ordering/supersession interaction**, implement the symmetric handlers, and commit the doc change alongside the code. Keep the status marker honest (⬜→🔶→✅).

## Related

- [`design.md` § Cooperative runtime](design.md) — the design rationale (why a worker, the lean-columnar-transfer reasoning, the merge-stays-on-main choice, rejected alternatives). The *why* behind this *what*.
- [`design.md` § Pipeline execution / § Caches / § The pure engine and the worker boundary](design.md) — the main-thread architecture the worker relocates the pipeline out of.
