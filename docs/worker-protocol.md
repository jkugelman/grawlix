# Web worker protocol — the main ↔ pipeline-worker contract

This is the **source-of-truth interface contract** between the main thread and the pipeline web worker: who owns which data, every message that crosses the boundary (fields + what each one *does* on receipt), and the cancellation/supersession rules. Code is not the only source of truth — when you add or change a message, a data structure, or the supersession policy, **update this doc in the same commit.**

**Why a worker at all, and the deeper *why* behind each decision** live in [`planned/web-workers.md`](planned/web-workers.md) (benchmarks, the full-resync-baseline reasoning, the rejected alternatives). **Execution status** — which chunk is done — lives in [`planned/web-workers-plan.md`](planned/web-workers-plan.md). This doc is the *what the interface is*, present-tense.

## Status legend

The worker is being built incrementally; this doc describes the full contract and marks how far each piece is:

- ✅ **live** — implemented and wired into normal operation.
- 🔶 **staged** — code exists (and is tested) but is not yet sent/used over the wire.
- ⬜ **planned** — designed here, not yet built.

> **Where we are now:** the worker bundle spawns and answers a `ping` (✅); the columnar snapshot pack/unpack and the shared `byNorm` builder exist as pure functions (🔶); the executor does **not** yet run in the worker — `runPipeline` is still main-thread, and no `snapshot`/`run`/`result` traffic flows yet (⬜). As the flip lands, flip these markers and reconcile the message tables against the real handlers.

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
| score-range view filter, histogram, stats, virtual scroller, rendering | — | all main-thread; the score-range filter is a *view* over the worker's returned set, not a pipeline stage |
| the pipeline-worker **client** | run-id → promise tracking, result→rich-row mapping | `site/src/ui/pipeline-worker.js` |

### Worker thread owns (⬜ until the flip)

| Data | Shape | Notes |
|---|---|---|
| unpacked corpus `entries` | `[{ norm, display, score }]` | **lean** — no `comment`, no `wordlist`; index-aligned with main's rich array |
| `byNorm` | `Map<norm, row>` | rebuilt by the **same** `buildByNorm`; no `byKey` |
| `_initialChains` | seed chain rows | lazily built by the executor's `buildInitialChains` over `entries` |
| `_preSearchCache` | pipeline state up to just before the search row | mirrors today's main-thread cache, so a keystroke re-runs only the search row |
| the executor + full tool catalog | `executePipeline` / `runToolStage` / `bucketize` / `unify` + every tool's `run`/`prepare`/`group` | imported directly from `engine/` (the worker runs the identical module text the main thread would) |

### The relationship: index agreement

Main builds the merge **in order** and ships it in order; the worker unpacks in order; so **index *N* names the same entry on both threads.** This is the load-bearing invariant — every result the worker returns is expressed as indices into this shared order, and the main thread maps them back to its rich rows for rendering. See *Invariants*.

---

## The snapshot wire format

🔶 Implemented as pure functions in [`site/src/engine/snapshot.js`](../site/src/engine/snapshot.js); not yet sent over the wire.

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

**Small, already-filtered payloads stay objects.** Transform-chain atom sequences, grouped-result group objects, and (initially) the highlights parallel array are sent as ordinary structured-clone objects — small because those tiers are heavily filtered. Highlights move to a flat offset-encoded buffer only if a pathological literal-matches-everything case ever shows up.

### Encoding at a glance

| Payload | Encoding | Transport |
|---|---|---|
| message envelope (`type`, `runId`, `snapshotId`, `stack`, `sort`) | plain object | structured clone (tiny) |
| corpus scores | `Int32Array` | **transferred** |
| corpus norms / displays (strings) | UTF-8 byte blob + `Uint32` offsets | **transferred** |
| display presence bitmap | `Uint8Array` | **transferred** |
| filter/search result (survivor indices) | `Int32Array` | **transferred** |
| highlights | parallel array (object); maybe binary later | structured clone |
| transform-chain atoms / group objects | objects (inline indices + small synthetics) | structured clone (small) |

The rule of thumb for a new message: **scalars and small/filtered structures go as the object; anything that scales with the corpus or the full result set gets packed into a transferable `ArrayBuffer`.**

---

## Messages

Messages on one `Worker` are **FIFO**, which gives ordering for free (a `snapshot`/`patch` always arrives before a `run` that depends on it). Every message is a plain object with a `type` discriminator (see *Message encoding & packing* for how its fields and any bulk payload are encoded).

### Main → worker

#### `ping` ✅
`{ type: 'ping' }` — liveness / spawn check. Worker replies `pong`. The only message wired today; a useful health check that will likely stay.

#### `snapshot` ⬜
`{ type: 'snapshot', snapshotId, count, norms, displays, scores }` — **replace the worker's entire corpus.**
- `snapshotId` — monotonic; identifies this corpus version. Bumps on a `patch` too.
- `count` / `norms` / `displays` / `scores` — the columnar payload above; the buffers are **transferred**.
- **Sent:** at boot, and after *every* merge-affecting mutation (reorder, enable/disable, import, scoring-rule edit) — i.e. anything that already rebuilds the merge on main — **except a My Edits in-place edit** (that's `patch`).
- **On receipt:** worker `unpackSnapshot`s, replaces `entries` + `byNorm` wholesale, and invalidates `_preSearchCache` (and drops the lazy `_initialChains`). The next `run` rebuilds caches against the new corpus.

#### `patch` ⬜
`{ type: 'patch', snapshotId, norms, rows }` — **the My Edits in-place exception** to whole-corpus resync.
- `norms` — the affected norms; `rows` — their recomputed **lean** `{norm,display,score}` rows.
- **Sent:** only on a My Edits edit, which on main splices the merged array in place (`patchMergedForNorms`) rather than rebuilding — avoiding a full reship of an O(all-entries) pack for an O(sources) edit.
- **On receipt:** worker applies the *same* in-place splice to its `entries` array and re-indexes only those norms in `byNorm`/`_initialChains`. Because both sides apply the identical splice, **index agreement is preserved without reshipping.**
- ⚠️ **Open divergence** — see *Invariants* and the plan doc: today `patchMergedForNorms` picks a norm's canonical `byNorm` row *localeCompare-first* while `resolveCorpus`/`buildByNorm` pick it *code-unit-first*. These must converge (route the patch through `buildByNorm`) before this message ships, or the worker's reindex disagrees with main.

#### `run` ⬜
`{ type: 'run', runId, snapshotId, stack, sort }` — **execute the pipeline.**
- `runId` — monotonic; the supersession key (see *Cancellation*).
- `snapshotId` — which corpus this run expects; a defensive cross-check (FIFO already guarantees the right corpus is loaded).
- `stack` — the serialized tool stack: tool keys + params + `grouped` flags + the search row's pattern (≈ what the URL encodes). The worker looks up the tool **code** in its own copy of the catalog; functions never cross the boundary.
- `sort` — sort axis + direction. The worker owns sort: it returns indices **already in display order**.
- **On receipt:** worker sets `latestRunId = runId`, runs against its cached pre-/post-search state (caches keyed on `stack`, so a query-only change re-runs just search and a sort-only change just re-sorts), then posts `result` — unless superseded first.

#### `cancel` ⬜
`{ type: 'cancel' }` — explicit supersession, for teardown / search-cleared. Optional given that a newer `run` implicitly supersedes (see *Cancellation*).

### Worker → main

#### `pong` ✅
`{ type: 'pong' }` — reply to `ping`.

#### `result` ⬜
`{ type: 'result', runId, snapshotId, grouped, atomCount, payload }` — **pipeline output, expressed by index, never as entry objects.**
- `runId` / `snapshotId` — main **drops stale results** whose `runId` isn't the latest dispatched; `snapshotId` guards against a corpus mismatch.
- `grouped` — whether the bottom row is grouped (shapes `payload`).
- `atomCount` — atoms per row (the scroller also derives this from the stack alone, so row heights don't block on the result).
- `payload` — tiered:
  - **filter/search** (the common, laggy case): a transferred `Int32Array` of survivor indices in display order + a parallel highlights array. The full survivor set, not a window — stats and the histogram consume the whole output; the main thread windows the table itself.
  - **transform chains**: short atom sequences, each atom a merged-array **index** or an inline synthetic `{norm,display,score}` (a tool output that exists in no wordlist, `wlEntry.wordlist === null`).
  - **grouped**: groups carrying precomputed column values, the anchor index, group Min/Max stats, and surviving chains.
- **On receipt:** main maps indices → its rich rows, builds synthetic `wlEntry`s for inline atoms (these are **not** looked up in `byNorm`), feeds scroller/stats/histogram, settles the run's pending promise, and decrements the in-flight counter.

#### `error` ⬜
`{ type: 'error', runId, stackRowIndex, message }` — a tool threw (today's `ToolStageError`).
- **On receipt:** main sets `stack[stackRowIndex]._error = message` → the red `⚠` row marker + `ErrorPopover`, and settles the run's promise. (Main owns the per-run `_error` *reset* now too — clear stale marks on each dispatch, since the executor's old per-run reset moved into the worker.)

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

- **Spawn:** at boot (not lazy), one worker per tab. Spawned via `new Worker(new URL('./engine/worker.js', baseURL), { type: 'module' })`, where `baseURL` is **`main.js`'s `import.meta.url`**, injected at boot through `configurePipelineWorker({ baseURL })`. (Anchoring on `main.js` is load-bearing — bundling inlines the `new URL` literal verbatim without rewriting its relative path, and the client module sits at a different depth than the bundle, so a client-anchored URL is dev-passing/prod-404. See [`site/src/ui/pipeline-worker.js`](../site/src/ui/pipeline-worker.js).)
- **Memory:** each tab's worker holds its own corpus copy → roughly **2× peak corpus memory** (rich array on main + lean array in worker, each with its `byNorm`/`_initialChains`). Real for a constructor merging four large wordlists; measure it.
- **Crash:** `onerror` / `messageerror` (a worker crash, distinct from a tool `error` *message*) → fall back to the **main-thread engine** (which imports `engine/` too) and re-spawn. The fallback must own `_preSearchCache` coherence while it's in charge.

---

## Invariants (do not break these)

1. **Index agreement.** Index *N* names the same entry on both threads. Main builds and ships the merge in order; the worker unpacks in order; results are by index. The `patch` message exists specifically to keep this true across an in-place My Edits splice. Breaking it silently corrupts every rendered row.
2. **`byNorm` cannot drift.** Both threads build `byNorm` via the one shared `buildByNorm(entries)` ([`engine/snapshot.js`](../site/src/engine/snapshot.js)) — canonical row = the **code-unit-minimum** display per norm. Never reimplement the canonical-row selection on one side. (`patchMergedForNorms` is the one place that still picks differently; converging it is a tracked open item — see [`planned/web-workers-plan.md`](planned/web-workers-plan.md#open-items-surfaced-during-execution).)
3. **Worker = letters + scores; main = presentation.** The worker never holds `comment`, the `wordlist` ref, or DOM, and `engine/` stays DOM-free (enforced by `tests/unit/engine-dom-free.test.mjs`). Anything display-only is resolved on main.

---

## Adding a message

When the protocol grows (new request/response/sync types are expected): pick a `type` string, add a row to the appropriate Main→worker / Worker→main section above with **direction, every field, what happens on receipt (which state updates), and any ordering/supersession interaction**, implement the symmetric handlers, and commit the doc change alongside the code. Keep the status marker honest (⬜→🔶→✅).

## Related

- [`planned/web-workers.md`](planned/web-workers.md) — the design rationale (why a worker, benchmarks, the full-resync baseline, rejected alternatives). The *why* behind this *what*.
- [`planned/web-workers-plan.md`](planned/web-workers-plan.md) — execution status, chunk sequencing, open items.
- [`design.md` § Pipeline execution / § Cooperative runtime / § Caches / § The pure engine and the worker boundary](design.md) — the current main-thread architecture this relocates.
