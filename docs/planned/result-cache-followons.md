# Planned: result-cache follow-ons — partial runs, coroutine resume

Forward-looking extensions of the shipped **in-memory pipeline caches** (see [`design.md`](../design.md) § *Streaming results* and the `Pipeline caches` section of [`worker.js`](../../site/src/engine/worker.js)). None is being built now; this records the thinking so it isn't lost. (The third idea once tracked here — **§2 intermediate-step reuse**, a keyed prefix-state cache — has since shipped as the `prefixCache`; see `design.md` § *Streaming results*, "Editing a non-trailing tool row reuses its untouched prefix".)

They share one insight: **both reuse the shipped caches' substrate** — the `GdsCache` (a worker-owned keyed map, a byte budget with GreedyDual-Size / investment-weighted eviction) and corpus-**object-identity** invalidation (bind an entry to the corpus object it was built against; a rebuild swaps the object and the identity test misses; an in-place splice's `replaced` flag drives a keep-or-purge). What differs is *what* each caches and *how* it resumes:

| Idea | What it caches | Resume mechanism |
|---|---|---|
| §1 Partial-run retention | an **incomplete** final join | re-run from start + catch up (cheap, deterministic) |
| §3 Coroutine resume (parked) | a suspended **continuation** | resume the scan from its yield point (no redo) |

§1 and §3 are two answers to the same question (continue an unfinished run); §1 is the pragmatic 80%, §3 the expensive "actually skip the redo" 20%.

Anchors below were valid at writing (post-`feat: retain finished pipeline results across runs`); code moves — re-verify before building.

## §1. Partial-run retention (re-run + catch up)

**Motivation.** Value tracks how much the user **invested** in a run, not whether it finished — a 60-second, 4000-row Umiaq scroll is worth more than a completed keystroke artifact. Two workflows want it: iterative query editing where the user judges a query from its first screenful and backtracks without letting it finish, and explicitly setting a slow run aside to detour through another tool, then returning to it.

**Mechanism — stash on abort, re-run on resume.** A superseded run already aborts at its next yield and posts nothing ([`runOne` bails at `if (signal.aborted) return`, worker.js:280](../../site/src/engine/worker.js#L280)). Add: in that abort branch, if the run cleared an **investment gate**, stash the current display slot's join (incomplete) into the cache keyed `(scope, stack-signature)` like a finished entry but flagged `complete: false`. On a later `run` for the same key, probe the finished cache first (a completed result wins); on a partial hit, **paint the partial instantly** and **re-run from the start**, suppressing the re-run's output until it catches up.

This deliberately avoids the coroutine (§3): the re-run is **deterministic** against the unchanged corpus (the finished cache already relies on this determinism for reproject), so it reproduces the exact partial and continues past it. The load-bearing "a superseded run posts nothing and aborts" invariant is untouched — the run still aborts; the stash is a side effect of aborting, not a suspension.

**One join, a validation cursor (no duplication) — flat and tuple.** The flat join is stored in **scan order** ([`join.push(e._i)` in `makeStreamEmitter`, worker.js:356](../../site/src/engine/worker.js#L356)), with the sorted `indices` a separate view. So the re-run's join is a **position-wise prefix** of the cached join: `reRunJoin[i] === cachedJoin[i]` at every `i`. Therefore keep exactly **one** join — the cached partial, which serves all display and `fetchRows` (fully scrollable via its sorted `indices`, so no skeletons while frozen). The re-run's emitter builds nothing; it **validates** each emitted `_i` against `cachedJoin[cursor]` and advances the cursor. While `cursor < length`, ship no snapshot — the count stays frozen with a spinner. At `cursor === length`, the cached join *becomes* the live join and the emitter switches to append-and-ship; the count rises past the abort point. A **divergence** (`emitted _i !== cachedJoin[cursor]`) shouldn't occur once the corpus-identity check passed at resume, so treat it as corruption: purge the partial and fall back to a normal run. The check is cheap insurance.

The **tuple** tier gets the same one-join treatment (validated): both Umiaq solver paths emit deterministically and append-only — the probe path is a nested DFS over the norm-ordered pool ([umiaq.js:428](../../site/src/engine/umiaq.js#L428)), the bucket path an explicit DFS work-stack over insertion-ordered buckets ([umiaq.js:485](../../site/src/engine/umiaq.js#L485)), and `emit`'s Set only *skips* duplicates without reordering ([umiaq.js:402](../../site/src/engine/umiaq.js#L402)) — and a group is never mutated after `join.push(g)` ([worker.js:466](../../site/src/engine/worker.js#L466)). Validate on the group `key` instead of `_i`.

**Transform needs rebuild-and-swap instead (validated) — but still seamless.** Two things break the pure one-join model for transform, *neither* a determinism failure. First, its join is the **post-fold survivor set** (`seen.values()`), not the raw emitted rows: the raw stream carries *both* mirror directions and folds down to one survivor, so a re-run can't be validated against the cached prefix without replaying the fold-state. Second, a survivor's **content mutates** — when a mirror arrives, an already-inserted row's glyph is promoted to `↔` ([worker.js:529](../../site/src/engine/worker.js#L529)) — so the cached rows aren't frozen the way flat/tuple's are. The redeeming fact: the survivor **sequence** is deterministic (the corpus emits in norm order, so the lower-norm direction is always inserted first — [worker.js:504](../../site/src/engine/worker.js#L504)), so the fallback — rebuild `seen` on resume in a transient second structure, keep serving the frozen cached partial for display during catch-up, swap at the crossover — produces **no reshuffle**. Transform simply forgoes the zero-copy optimization; it pays a transient fold-state during the ~1s catch-up, which is exactly the two-structure cost §1 was trying to avoid *elsewhere* but is unavoidable here.

**The admission gate is the crux.** ~99% of superseded runs are per-keystroke transients; stashing them all would thrash. Options, cleanest first: an **explicit "set aside" gesture** (a deliberate park), which removes the guessing; failing that, a heuristic gate — produced ≥ N rows, or ran ≥ T seconds. Eviction should be **investment-weighted**, not recency (a bigger investment is worth holding longer). This gate is the difference between the feature feeling magic and feeling noisy.

**UX.** Frozen count + spinner during catch-up. The summaries (histogram / stats) shown are the partial's *cumulative* ones, so they fill in as the re-run passes the abort point — provisional, but that matches streaming behavior.

**Scope: streaming tiers only.** A tool that emits no partials has nothing to stash — e.g. a bucket-path Umiaq mid-Phase-1 (a monolithic buffer that produces nothing until Phase 1 finishes). Restrict to the tiers that actually stream, which is exactly the set with a partial to keep.

**Cost/benefit.** Saves **perceived** latency (instant paint, no count-rewind), **not** compute — the re-run pays the full scan; the catch-up is redundant work hidden behind the frozen display. Narrower than the finished cache, which saves the whole recompute.

## §3. Parked: coroutine resumption

The expensive alternative to §1. Suspend the tool's continuation at a cooperative yield point — JS async functions/generators already capture their full internal state for free — and resume it later. The **only** mechanism that continues an unfinished expensive scan **without redo** (§1 re-does the catch-up work invisibly; a coroutine skips it entirely).

Its costs, and why it's parked:
- It pins the unbounded **working set** (the scan's live intermediate state), far larger than the bounded result.
- JS gives no way to **measure** a suspended continuation's retained heap, so a byte-bounded LRU can't govern it (unlike §1's bounded, measurable partial join).
- It **rewrites** the load-bearing "a superseded run posts nothing and aborts" invariant: a parked run must *not* abort — it must suspend and stay resumable — which ripples through supersession.

If pursued, the safe shape is **investment-gated** (as §1), with a small count cap and investment-weighted eviction, invalidated by a structural corpus change (it closed over the corpus). Umiaq resumability specifically: the **probe** path (a linear pool scan) resumes cleanly from a cursor; the **bucket** path's expensive Phase 1 is a monolithic buffer with no partial emits, so mid-Phase-1 there is nothing to resume and a restart re-pays it.

**Build §1 first.** Only reach for the coroutine if §1's redundant catch-up work proves too expensive in practice (e.g. a run so slow that re-scanning to the abort point is itself a multi-second wait the user notices).

## §4. Also parked (pointer): IndexedDB durability as an L2

Separate from the three above: an IDB layer beneath the in-memory L1 for **reload-survival** and **cross-scope single-list serving**. Its whole burden is a durable **corpus-signature** (object identity is meaningless across a reload) — a manifest hash over enabled sources' content + rescore rules + merge order + scoring tiers + referenced data-asset versions, with My Edits (edited in place every keystroke) as the wrinkle needing a real content hash or edit stamp. Full detail in git history (the retired `result-cache.md` §11) and a compressed note in `design.md`. Out of scope here; recorded so it isn't forgotten.

## §5. Validated vs uncertain

**Validated (load-bearing, checked against current code):**
- The re-run is deterministic against an unchanged corpus — scan order is corpus order, and the finished cache already relies on this for reproject.
- The flat join is stored in scan order ([worker.js:356](../../site/src/engine/worker.js#L356)), making it a position-wise prefix, so §1's cursor validation is sound for flat.
- The **tuple** tier gets the same one-join cursor trick: both Umiaq solver paths ([probe umiaq.js:428](../../site/src/engine/umiaq.js#L428), [bucket umiaq.js:485](../../site/src/engine/umiaq.js#L485)) emit deterministically and append-only, `emit`'s dedup Set only skips ([umiaq.js:402](../../site/src/engine/umiaq.js#L402)), and a group is never mutated after push. Validate on the group `key`.
- The **transform** tier does *not* get the one-join trick (its join is the post-fold survivor set, and folds mutate already-inserted rows' glyphs — [worker.js:529](../../site/src/engine/worker.js#L529)), but its survivor *sequence* is deterministic ([worker.js:504](../../site/src/engine/worker.js#L504)), so the rebuild-and-swap fallback is seamless. §1 therefore branches: one-join for flat/tuple, rebuild-and-swap for transform.
- The authoritative executor **buffers between user-stack stages**, so every stage boundary's inter-stage `state` is materialized mid-run and cheap to snapshot (`cloneState` shares chain arrays by reference). This is what the shipped `prefixCache` snapshots — and it means a `state` a §1 catch-up rebuilds is likewise cheap.
- The corpus-object-identity + `replaced`-hook invalidation substrate (now the shared `GdsCache`) applies unchanged to both remaining ideas (a partial or a continuation binds the corpus object like a finished join or a prefix tile).

**Uncertain — decide during implementation:**
- §1's admission gate: explicit "set aside" gesture vs heuristic thresholds (N rows / T seconds), and whether both.

## §6. Verify during implementation

- **§1 equivalence (flat/tuple):** a resumed partial's first-N rows equal a fresh run's first-N exactly (deterministic prefix), and the crossover appends with no reshuffle or count-rewind.
- **§1 transform crossover:** the rebuild-and-swap path swaps with no reshuffle (survivor order is deterministic), and a mirror whose two directions straddle the abort point promotes its glyph to `↔` in *live* mode past the crossover — never a flicker on the frozen partial.
- **§1 no skeletons:** scrolling the frozen partial during catch-up always serves real rows (from the cached partial's `indices`), never skeletons.
- **§1 invalidation:** a corpus change between stash and resume purges the partial (identity), and a mid-catch-up divergence purges + falls back to a normal run cleanly.
- **§1 gate:** the keystroke-transient flood never stashes (assert ~99% of superseded runs produce no partial entry).
