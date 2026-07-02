# Planned: cross-run result cache (finished runs)

Re-running an expensive pipeline is reflexively wasteful. A complex Umiaq query scans the whole corpus (~1s) and joins before its first tuple; navigate to another tool and back, or re-enter the same query later, and Grawlix pays that cost again from zero. Today the worker retains exactly **one** result per tier and drops it on the next run — so a revisit is always a recompute. Users work around this by juggling browser tabs to stash a query. (User ask: `TODO.md` "Cache Umiaq results".)

This plan retains **finished** results across runs, keyed so that re-entering an identical pipeline against an unchanged corpus serves instantly instead of re-joining. It builds directly on the shipped join/view separation (§1); it is the last un-built piece of that effort. Partial (in-flight) runs are **out of scope** here and recorded as a parked follow-on (§10).

**The open decision is where the cache lives — in memory or in IndexedDB (§4).** The two differ in more than storage: IDB forces a serialization format and a durable content-signature, while in-memory reuses the live retained-result objects and the staleness signal B already computes. §4 lays out the comparison and a recommendation; the rest of the plan is written to be neutral to that choice, calling out where the two diverge.

Scope in one line: **cache the buffered/expensive tiers (grouped, tuple, transform) as retained finished joins; skip the flat tier; validate against corpus identity; bounded LRU.**

## 1. The foundation this builds on (already shipped)

The join/view separation is in place, so most of the machinery already exists — this plan adds a retention layer around it, not a new result model.

- Each tier retains its result in a single mutable slot — `lastFlatResult` / `lastGroupedResult` / `lastTransformResult` ([worker.js:124-126](../../site/src/engine/worker.js#L124); the inline comments there are stale — see the real shapes in [`docs/worker-protocol.md`](../worker-protocol.md) *Data ownership*). Each is `{ runId, version, join, view, viewSpec, scope, stack, summaries, … }`: the **join** is every produced row/group/chain, unfiltered and order-agnostic; the **view** is the sorted+filtered projection.
- A **view change** (sort, score-range, set-preserving rescore) **reprojects** over the retained join — it re-derives the view and ships a `reprojected` snapshot without re-running the pipeline ([`handleReproject`, worker.js:563-606](../../site/src/engine/worker.js#L563)). The emitters build the join incrementally and adopt-on-terminal (streaming is authoritative).
- The three slots are **mutually exclusive** and dropped/overwritten on the next run — the emitter's first batch nulls the other two ([worker.js:462-464](../../site/src/engine/worker.js#L462), [531](../../site/src/engine/worker.js#L531)). **This single-slot-overwritten-on-next-run is exactly what the cache generalizes: retain N finished joins instead of 1.**
- The result encoders emit plain, structured-clone-able objects — `encodeChain` / `encodeGroup` / `encodeGroupFull` ([worker.js:1070-1103](../../site/src/engine/worker.js#L1070)) — the same rich, self-contained rows the worker ships to main. These are what an IDB variant would serialize; an in-memory variant retains the pre-encode join objects instead.
- The worker already opens the app's IndexedDB directly (`grawlix`/`data`) with `idbGet`/`idbPut`/`idbDelete` ([worker.js:40-81](../../site/src/engine/worker.js#L40)) and owns all corpus I/O. Either variant is worker-owned.

## 2. What is cached

**The unfiltered join, in reprojectable form.** For each finished result, retain its **unfiltered join** plus the metadata needed to rehydrate its retained-result slot (`scope`, `stack`, `laneKind`, `summaries`). The `viewSpec` is *not* retained — the revisiting run supplies its own sort/score-range, which reproject over the join on a hit. Everything downstream of the slot (`fetchGroups`, `fetchGroupChains`, `reproject`, export) is unchanged.

**Cache the grouped/tuple and transform tiers; skip flat.** The buffered/combination tiers (`laneKind` `'record'`/`'set'`, and the transform tier) are the expensive, bounded, self-contained ones — precisely the ~1s-scan pain. The **flat tier is not cached**: it is cheap (a streamed per-entry filter, sub-second even at corpus scale) and it is corpus-position-coupled (`Int32Array` of `_i` indices resolved as `corpus.entries[indices[i]]`, [worker.js:750](../../site/src/engine/worker.js#L750)), so retaining it across a corpus rebuild is friction for a tier that re-runs faster than the round-trip. (Flat caching is a possible later extension; not worth the coupling work now.)

Because only bounded/capped results are stored (a tuple result is capped, [umiaq.js](../../site/src/engine/umiaq.js) `numResults`/`capped`; a transform result self-filters small), the retained set stays modest either way and the byte-bounded LRU (§7) has a measurable quantity to bound.

## 3. Where it lives, physically

Both variants generalize the same single slot into a keyed set the worker owns:

- **In-memory:** a `Map<key, retainedResult>` holding the live join objects — the exact shapes the slots hold today, no longer nulled on the next run. A hit points the tier's slot at the entry and reprojects. Validity is in-memory (§5, in-memory).
- **IndexedDB:** a `result_<key>` record family in the `grawlix`/`data` store, holding the **encoded** join (`encode*` output) + rehydration metadata + a durable **corpus-signature** (§5, IDB). A hit `idbGet`s, decodes, rehydrates the slot, and reprojects.

## 4. The decision: in-memory vs IndexedDB

The two are not just "RAM vs disk" — they force different designs. IDB buys durability and RAM headroom at the cost of a serialization format and a content-addressed signature; in-memory is far simpler and reprojects for free, but is volatile and spends the scarce budget.

| Axis | In-memory | IndexedDB |
|---|---|---|
| **Serialization / format** | None — retain the live join objects the slots already hold | **Encode to self-contained rows** (`encode*`) on write, decode on read — a real format layer |
| **Validity signal** | Object identity + the `replaced`/rebuild **structural signal B already computes**; eager-purge on structural change | A **durable corpus-signature** (content hash of sources + rules + order + scoring + asset versions) — new design work, incl. the My Edits wrinkle |
| **Reproject on hit** | Free — the entry *is* the live reprojectable join | Decode + rehydrate the slot first, then reproject |
| **Hit latency** | Synchronous pointer-swap | Async `idbGet` + decode |
| **Memory** | Holds N joins in RAM — **jetsam-counted**, competes with the ~100 MB corpus + ~100 MB data assets | Disk-backed — does **not** count against the iOS jetsam budget |
| **Survives reload / respawn** | **No** — lost on page reload or worker crash; repopulates cold | **Yes** — reopen Grawlix and the finished result is still there |
| **Cross-scope serving** | Only while the result's corpus is resident — a **merged** join survives scope detours (`ownedMerged` is stable across `setScope`), an inactive single-list scope's does not (its corpus is rebuilt) | Self-contained — servable whenever the signature matches, regardless of the active scope's resident corpus |
| **New machinery** | Small — a `Map`, stop nulling, an eager-purge, a byte-estimate LRU | Larger — record family, signature computation, async probe, decode/rehydrate, byte accounting |

**Two facts sharpen the trade for this scope (finished, bounded results):**

- The memory worry is **milder than the earlier (partial-inclusive) framing implied.** A finished tuple/transform result is capped/small, so N of them is tens of MB, not a second corpus. But that byte budget lives in RAM for the in-memory variant and on disk for IDB — and on iOS, jetsam kills on *RAM* footprint, so the same budget is genuinely riskier in memory. It is a question of *placement* of a similar number of bytes, not of order-of-magnitude.
- The corpus-signature is IDB's **largest open risk** (§5): it must capture *everything the result is a pure function of* — sources, rules, order, scoring, **and** data-asset versions for asset-dependent tools, plus a real content stamp for in-place-edited My Edits — or it silently serves a stale result. In-memory sidesteps this entirely by reusing object identity + B's structural signal.

**Recommendation: start in-memory; treat IDB as a later durability upgrade.** In-memory is the smaller change, reprojects for free, and — critically — dodges the signature-design risk, while fully covering the dominant pain (revisit within a session after tab-hopping). IDB's unique wins are reload-survival and cross-scope serving of single-list results, both secondary to the in-session revisit. If reload-survival proves worth its weight, IDB can be added later as a durable **L2** beneath the in-memory **L1** (the encoders already produce the serializable form) — or the in-memory variant swapped for it — without disturbing the shared design above. The choice is the user's; this plan stays neutral to it below, flagging the divergent steps.

## 5. Validity and invalidation

The key's shared part is **`(pipeline-signature, scope)`**:

- **pipeline-signature** — the serialized tool `stack` that already crosses on `run`, JSON-stringified. Purely-view fields (sort, score-range) are excluded — they ride separate `run` fields and reproject on a hit, so two revisits with different sorts hit the same entry. (Note: the pre-search cache's `lastUserStackSig` drops the trailing search row, [worker.js:229](../../site/src/engine/worker.js#L229) — the cache key wants the **whole** stack including the search.)
- **scope** — `MERGED_ID` or the scoped source's `dbKey`, already retained per result.

The third component — proving the corpus hasn't changed under the entry — is where the variants diverge:

**In-memory:** bind each entry to the corpus object it was built against and validate by **object identity + the structural signal**. A structural splice (`replaced`) or a rebuild invalidates a scope's entries; a pure rescore leaves them (shared entry objects mutate in place, so scores flow through — the same property B's pin relies on). This is the model B already uses to decide staleness locally, generalized to a set: **eager-purge a scope's entries on a structural change to that scope; keep them on a rescore.** No global generation counter (it over-bumps across scopes — B's conclusion). `ownedMerged`'s stability across `setScope` is what lets a merged entry survive scope detours.

**IndexedDB:** across a reload, object identity is meaningless, so an entry carries a **durable corpus-signature** and validity is a signature comparison at lookup (a mismatch is a miss and a purge candidate). The signature must capture **everything the result is a pure function of**, or it serves stale:

- Enabled sources' content + rescore rules + merge order + scoring tiers. Durable material exists per source (`fetchedSize`, `lastUpdated`, [persist.js:25-26](../../site/src/data/persist.js#L25); `rescoreRules`; enabled + position) — a **manifest hash** over those is a strong content proxy. **My Edits is the wrinkle** — edited in place every keystroke without a natural size/timestamp bump, so its contribution needs a real content hash or a monotonic edit stamp.
- **Data-asset versions for asset-dependent tools.** A tool declaring `def.asset` (e.g. Space-out → the unigram corpus) is a pure function of that asset too, and assets refresh independently (`check-assets`). `DATA_ASSETS` carry a stored content-length ([assets.js:17](../../site/src/engine/assets.js#L17), `sizeIdbKey`) usable as a version. The signature must fold in the referenced assets' versions.

Either way there is **no global generation counter** — staleness is a scope-precise, content-derived fact.

## 6. Serving flow

The cache is a retention layer *around* the existing retained-result slot, so the run path gains a load-before-compute and a save-on-finish; nothing downstream changes.

1. **On `run`** for `(stack, scope)`: look up the entry. In-memory: a synchronous `Map` get + identity/structural check. IDB: an async `idbGet` + signature compare (the corpus-signature may hash durable material).
2. **Hit:** install the entry into the tier's retained slot (in-memory: point at it; IDB: decode → rehydrate), set its `viewSpec` to the run's requested sort/score-range, reproject to derive the view, and ship a `reprojected`-shaped snapshot — instant, no scan. Bump the entry's LRU access time. Main ingests it exactly as it ingests any reproject/repatch snapshot (**no new client path, no new message**).
3. **Miss:** run as today. **On completion of a streamed run** (finished only — never a mid-stream partial), insert the join under the key (in-memory: retain the live objects; IDB: `idbPut` the encoded form + signature + format tag) and update the byte accounting.

Only the **terminal** writes the cache — consistent with "streaming is authoritative, completion is bookkeeping" ([`docs/worker-protocol.md`](../worker-protocol.md)). A capped/truncated result is cacheable but records its `capped` flag so a served entry renders the trailing `+` truthfully.

## 7. Bounds and eviction

Byte-bounded LRU over the entries. Estimate each entry's footprint (encoded size, or a per-object estimate for the in-memory join), keep a running total, and evict least-recently-*accessed* entries when a write would exceed the budget. Because only bounded finished results are stored, the estimate is reliable. The budget differs by variant: in-memory is bounded tightly (a few to low tens of MB, jetsam-counted alongside the corpus + assets); IDB is generous (tens to low hundreds of MB, disk-backed). Access time bumps on every hit so a frequently-revisited query survives while a one-off ages out.

## 8. Disposable derived data (both variants)

The result cache is **derived and disposable** — every entry is recomputable from the corpus — so it is **exempt from the migrate-don't-wipe policy** ([`docs/migration.md`](../migration.md)) that governs canonical stored data:

- On any invalidation (in-memory: structural change; IDB: signature or format-tag mismatch), the entry is simply dropped and recomputed — no migration step, and (IDB) **no `SCHEMA_VERSION` bump on the cache's account**: cache records carry their own format tag.
- The canonical corpus text and metadata are untouched by this feature and continue to follow the migration policy.
- On worker respawn the in-memory retained slots are lost (as today); an IDB cache is unaffected and repopulates the slot on the next matching run.

## 9. Protocol / doc deltas

- The `run` handler gains a cache probe before dispatch and a cache write on the streamed terminal. A hit reuses the `reprojected` reply channel — **no new main↔worker message** either way.
- **IDB variant only:** a `result_<key>` record family + a small byte-accounting record in the `grawlix`/`data` store.
- Update [`docs/worker-protocol.md`](../worker-protocol.md) (the `run` receipt behavior, and — IDB — a note under *Worker thread owns*) in the same commit as the code. Distill into [`docs/design.md`](../design.md) (*Caches & reactivity* / *Cooperative runtime*) when it ships, per the `distill-design-doc` convention.

## 10. Parked: caching partial (in-flight) runs

Explicitly **out of scope**, recorded so the thinking isn't lost. Partial runs are *not* less valuable than finished ones — value tracks how much the user **invested** in a run (a 60-second, 4000-row Umiaq run they scrolled through is worth more than a completed keystroke-artifact), not whether it completed. Completion only determines *storage cost and shape*. Two real workflows want partial retention: iterative query editing where the user judges a query from its first screenful and backtracks without letting it finish, and explicitly setting a slow run aside to detour through another tool, then restoring it and **continuing** past where it was.

Two mechanisms, at different cost points:

- **Partial output cache (cheap).** Retain the streamed partial *output* (the rows already produced) keyed like a finished entry; on backtrack, redisplay it instantly. Bounded like the finished cache. Covers "backtrack to a query I glanced at" — but cannot continue the computation.
- **Parked coroutine (expensive, memory-unmeasurable).** Suspend the tool's continuation at a cooperative yield point (JS async functions/generators already capture their full internal state — the `buckets`/`frames` — for free, so the executor stays internals-agnostic) and resume it later. The *only* mechanism that continues an unfinished expensive scan without redo. Its costs: it pins the unbounded *working set* (far larger than the bounded result), JS gives no way to *measure* a suspended continuation's retained heap (so a byte-bounded LRU can't govern it), and it rewrites the load-bearing "a superseded run posts nothing and aborts" invariant.

If pursued, the safe shape is **investment-gated**: park a coroutine only when the run invested enough (produced ≥ N rows, active ≥ T seconds, or was *explicitly* set aside) — the 99% of partial runs that are per-keystroke artifacts never qualify, so they never consume memory — with a small count cap and **investment-weighted** (not recency-based) eviction, so keystroke-backtracking through intermediate query strings can't evict the dwelt-on run the user is reaching for. A parked coroutine is invalidated by a structural corpus change (it closed over the corpus), composing with the finished cache's invalidation. Umiaq resumability specifically: the *probe* path (a linear pool scan) resumes cleanly from a cursor; the *bucket* path's expensive Phase 1 is a monolithic buffer with no partial emits, so mid-Phase-1 there is nothing to resume and a restart re-pays it — see the executor-resumability analysis in the `/tmp` A design notes.

## 11. Rejected / superseded alternatives

- **A global `structuralGeneration` counter** as the key's generation (an earlier plan's spine). Never adopted — it over-bumps across scopes (a background update to list A falsely marks a list-B result stale); scope-precise validity (object identity, or a content-addressed signature) is correct. Consistent with B's shipped local-staleness decision.
- **Retaining corpus-coupled joins in IDB** (`Int32Array` `_i` indices, or live entry-object references). Neither survives serialization/reload — indices are position-encoded against a specific build, references don't serialize. This is *why* the IDB variant must encode to self-contained rows (§4); it is not a reason against caching, only against a naive IDB shape.
- **Patch-in-place of a cached result on a corpus change.** Out — a combination result can gain a member from an added entry partnering an existing one; an incremental patch misses those. An invalidation → recompute is the correct tool for the set channel (the same reasoning that makes combination tiers pin-and-chip rather than repatch under refresh-on-consent).

## 12. Uncertain — decide during implementation

- **In-memory vs IDB (§4)** — the primary decision. The recommendation is in-memory first; confirm reload-survival isn't a must-have before ruling IDB out for v1.
- **(IDB) the corpus-signature's exact composition**, especially **My Edits' contribution** (in-place edits without a natural size/timestamp bump). Must be complete (under-capture → stale serve) and cheap (computed per `run`).
- **(IDB) a cheap, stable, engine-layer hash.** `hashStringMod` exists but lives in `ui/` ([icons.js:15](../../site/src/ui/icons.js#L15)) and is a mod-hash; the signature wants a full-width stable hash reachable from `engine/`.
- **(In-memory) scope-detour serving** — confirm a merged entry survives `setScope` detours (`ownedMerged` stable) and that inactive single-list-scope entries are purged/ignored rather than resolved against the wrong resident corpus.
- **Byte budget and footprint-estimation grain** for each variant.
- **Async lookup latency on the `run` hot path** (IDB) — the probe adds an `idbGet` (+ a hash) before dispatch; confirm it doesn't regress the common miss case and composes with the deferred-run queue / freshness gates.
- **Interaction with the `capped` flag** on a served entry, and with the `existsInScope`/`rebindQuery` echoes a fresh `run` computes but a cache hit must reproduce or omit honestly.

## 13. Verify during implementation

- **Re-anchor every `file:line` above against current code first** — several are exploration-sourced and the retained-slot comments at [worker.js:124-126](../../site/src/engine/worker.js#L124) are known-stale.
- **A cache hit must equal a fresh run**, byte-for-byte in the shipped rows, under the same `viewSpec` — including sort/filter reproject over the rehydrated join, group `+N more` paging, and export.
- **Invalidation detects every result-affecting change**: a source re-fetch, a rescore-rule edit, an enable/order change, a scoring-tier change, a My Edits edit, and (IDB) a **data-asset update** for an asset-dependent tool. Each must miss the cache.
- **Terminal-only writes**: never cache a mid-stream partial; a superseded run writes nothing.
- **(IDB) reload survival**: a finished result written before a reload is served after it — and is *not* served if the corpus changed while the app was closed (e.g. a background auto-update on next open).
- **Disposability**: an invalidation drops the entry silently; no migration, no `SCHEMA_VERSION` bump on the cache's account; canonical corpus/meta untouched.
- **LRU eviction** holds the byte budget under a session of many distinct expensive queries, and a frequently-revisited query survives while one-offs age out.
