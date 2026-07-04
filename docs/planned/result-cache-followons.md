# Planned: result-cache follow-ons — coroutine resume, IDB durability

Forward-looking extensions of the shipped **in-memory pipeline caches** (see [`design.md`](../design.md) § *Streaming results* and the `Pipeline caches` section of [`worker.js`](../../site/src/engine/worker.js)). Neither is being built now; this records the thinking so it isn't lost.

Both reuse the shipped caches' substrate — the `GdsCache` (byte budget, GreedyDual-Size eviction) and corpus-**object-identity** invalidation (bind an entry to the corpus object it was built against; a rebuild swaps the object and the identity test misses; an in-place splice's `replaced` flag drives a keep-or-purge). Anchors below were valid at writing; code moves — re-verify before building.

## §1. Parked: coroutine resumption

The expensive alternative to the shipped partial-run cache: continue an unfinished expensive scan **without** the catch-up redo. Suspend the tool's continuation at a cooperative yield point — JS async functions/generators already capture their full internal state for free — and resume it later. It is the **only** mechanism that skips the redo entirely (the partial-run cache re-does the catch-up work invisibly behind the frozen paint; a coroutine never re-scans).

Its costs, and why it's parked:
- It pins the unbounded **working set** (the scan's live intermediate state), far larger than the bounded partial join the partial-run cache keeps.
- JS gives no way to **measure** a suspended continuation's retained heap, so a byte-bounded LRU can't govern it (unlike the partial-run cache's bounded, measurable join).
- It **rewrites** the load-bearing "a superseded run posts nothing and aborts" invariant: a parked run must *not* abort — it must suspend and stay resumable — which ripples through supersession. (The partial-run cache keeps the invariant: the run still aborts; the stash is a side effect of aborting.)

If pursued, the safe shape is **investment-gated** (the partial-run cache reuses the finished cache's 1s recompute floor for exactly this), with a small count cap and investment-weighted eviction, invalidated by a structural corpus change (it closed over the corpus). Umiaq resumability specifically: the **probe** path (a linear pool scan) resumes cleanly from a cursor; the **bucket** path's expensive Phase 1 is a monolithic buffer with no partial emits, so mid-Phase-1 there is nothing to resume and a restart re-pays it.

Only reach for the coroutine if the partial-run cache's redundant catch-up work proves too expensive in practice — a run so slow that re-scanning to the abort point is itself a multi-second wait the user notices. That is the one weakness the partial-run cache's cost/benefit note in `design.md` names: it saves *perceived* latency, not compute.

## §2. Also parked (pointer): IndexedDB durability as an L2

Separate from the resumption ideas: an IDB layer beneath the in-memory L1 for **reload-survival** and **cross-scope single-list serving**. Its whole burden is a durable **corpus-signature** (object identity is meaningless across a reload) — a manifest hash over enabled sources' content + rescore rules + merge order + scoring tiers + referenced data-asset versions, with My Edits (edited in place every keystroke) as the wrinkle needing a real content hash or edit stamp. Full detail in git history (the retired `result-cache.md` §11) and a compressed note in `design.md`. Out of scope here; recorded so it isn't forgotten.
