# Mobile memory — shrinking the worker's footprint on iOS

Grawlix crashes intermittently on iPhone. The cause is memory: Grawlix builds and holds four full wordlists — well over a million wordlist entries — plus a deduped merge of them, entirely in the pipeline worker, and on iOS that worker heap counts against the same per-tab limit Safari jetsams. This doc captures the diagnosis (with `file:line` anchors so a reviewer can check it) and the menu of options, separated into validated findings and estimates. Nothing here is implemented yet.

The user-visible symptom is the tab reloading itself ("this webpage was reloaded because it was using significant memory"), which the user experiences as a crash. It does not reproduce on desktop, where there are gigabytes of headroom.

## Why iPhone specifically

On iOS, a page's Web Worker runs as a thread inside the same WebContent process as the tab — there is no separate budget. The worker's heap and the page's heap share one jetsam limit, and iOS enforces it far more aggressively than desktop (commonly a few hundred MB on 2–4 GB devices, lower under system pressure). The same footprint that is invisible on desktop is fatal on the phone. This is why the architecture's data-ownership inversion (worker owns the whole corpus — see [`../worker-protocol.md`](../worker-protocol.md)), which is a latency win, does not help memory on mobile: moving the corpus off the main thread did not move it out of the process.

## Where the memory goes (validated)

All anchors are against the worker, [`../../site/src/engine/worker.js`](../../site/src/engine/worker.js), and the engine modules it imports. Line numbers are a snapshot and will drift; the function/structure names are stable.

Default load is four auto-fetched wordlists — Broda (~527K entries), Nediger (~345K), STWL (~280K), JK (fetched, size unmeasured) — plus XWI (~281K) if a subscriber has imported it. The worker holds, simultaneously:

1. **`ownedBuilt`** — every source, *enabled and disabled*, each as an array of `{ norm, display, score, comment }` wordlist-entry objects, built in `buildAllSourcesWordlists` ([worker.js:1198-1211](../../site/src/engine/worker.js#L1198-L1211)). ~1.25M+ objects before the merge even runs.
2. **Per-source derived indexes** — each source additionally caches `_rescored` (a second array, with fresh objects wherever a rescore rule changed the score) and `_rescoredByNorm` (a `Map` of norm → array of entries), in `getRescoredEntries` / `getRescoredByNorm` ([rescore.js:92-116](../../site/src/engine/rescore.js#L92-L116)). The `_rescoredByNorm` maps across all sources are one of the single largest line items.
3. **`ownedMerged`** — the deduped union: a fresh `entries` array of all merged rows (new objects, *not* shared with the per-source arrays), plus a `byKey` Map whose keys are freshly-allocated `norm\0display` strings, plus a `byNorm` Map, built in `resolveCorpus` ([corpus.js:41-84](../../site/src/engine/corpus.js#L41-L84)).
4. **`ownedEntryToIndex`** — a `Map` of *every* merged entry object → its integer index, existing only to encode the flat result's survivor indices, built in `setOwnedCorpus` ([worker.js:1231-1237](../../site/src/engine/worker.js#L1231-L1237)).
5. **Lazy data assets, never freed in normal use** — the unigram corpus (wordfreq `large_en`, a ~1M-key word→float `Map`) and the CMU pronunciation dict load on first use of Space-out / Rhymes (`loadUnigramCorpus` [segmenter.js:121](../../site/src/engine/segmenter.js#L121), `loadCmuDict` [phonetics.js:88](../../site/src/engine/phonetics.js#L88)). They are evicted *only* on a detected remote refresh in `handleCheckAssets` ([worker.js:106](../../site/src/engine/worker.js#L106)) — never when the tool leaves the stack, never under pressure. Once loaded they stay resident.

The main thread is lean by comparison: it holds only My Edits' `rawEntries` and the windowed summaries the worker ships, so the worker is where essentially all of the budget is spent.

### The likely crash *trigger* (validated)

`syncConfig` rebuilds the corpus without freeing the old one first. In the `.then` at [worker.js:1424-1438](../../site/src/engine/worker.js#L1424-L1438) it builds a complete new `built` + `ownedMerged` + scope corpus + `ownedEntryToIndex`, and only reassigns the `owned*` module variables at the *end* of the callback. So mid-rebuild the worker references **two complete corpora** — a ~2× spike on every wordlist enable/disable, every rescore-rule Save, and every scope change that rebuilds. A baseline sitting just under the jetsam limit gets pushed over by this transient. This is the most probable thing tipping the phone over, more so than the steady-state size.

### Dead weight worth noting

`getRescoredMap` / `_rescoredMap` ([rescore.js:96-102](../../site/src/engine/rescore.js#L96-L102)) is never called anywhere — it costs no memory (never populated) but is invalidated in two places and should be removed for clarity, not for footprint.

## Estimates (unverified)

These are reasoned from JSC object/string/Map overhead, not measured on device. They establish the order of magnitude, not a precise figure.

- Per wordlist-entry object: ~48 bytes (4-slot object header) + the norm string (~24–32 bytes, mostly unique so not interned). Display is `null` for bare entries (no allocation); comment is usually `''` (shared).
- Across the structures above, steady-state worker footprint with the four default lists is plausibly **a few hundred MB** (rough split: per-source objects ~90 MB, rescored new objects ~40–60 MB, `_rescoredByNorm` maps ~100 MB, merged `entries` ~45 MB, `byKey` ~50 MB, `byNorm` ~35 MB, `ownedEntryToIndex` ~35 MB).
- The merge is estimated at ~600–800K deduped rows; the exact count is unmeasured.
- The unigram + CMU assets add ~100 MB+ when their tools are used.
- The iOS jetsam threshold itself is device- and pressure-dependent; "a few hundred MB" is a working assumption, not a measured ceiling.

**Measurement should precede any optimization.** Footprint scales with entry counts, which are device-independent, so a temporary worker-side readout (entry counts + estimated bytes per structure, logged for reading via Safari Web Inspector with the iPhone tethered to a Mac) would confirm which structure dominates before we optimize blind. The crash is not directly reproducible in this repo's test tiers — it is an on-device memory-pressure event — so device numbers are the ground truth.

## Options, by impact ÷ effort

### Low effort, high value

- **Free the old corpus before/at the start of the `syncConfig` rebuild** — eliminate the transient 2×. The constraint to respect is the "serve stale until commit" semantics (the worker intentionally keeps the prior `ownedCorpus` serveable while the async rebuild runs — [worker.js:1421-1423](../../site/src/engine/worker.js#L1421-L1423)). At minimum, the old `_rescoredByNorm` / `_rescored` / `ownedEntryToIndex` can be dropped early without breaking that, since stale *reads* don't need the index maps. This is expected to stop most crashes on its own.
- **Evict the unigram / CMU assets when their tool leaves the stack** (and/or on `pagehide`). The eviction primitive already exists (`asset.invalidate()`, used by `handleCheckAssets`); this just adds a second trigger. Reclaims ~100 MB+ deterministically when the user moves off Space-out / Rhymes.
- **Replace `ownedEntryToIndex` (a full Map) with an `_i` slot written onto each entry object** during `setOwnedCorpus`. Same O(1) lookup, one structure's worth of Map overhead removed. The pairing discipline (`ownedEntryToIndex` must stay total with `ownedCorpus`) is preserved automatically because the index then lives on the entry itself.

### Medium effort

- **Don't fully build disabled sources.** `ownedBuilt` keeps disabled wordlists' `rawEntries` and indexes resident so a re-enable is instant and the provenance panel can show them. Building a disabled list's `_rescoredByNorm` lazily — only when the provenance walk asks for it — frees a disabled list's bulk while it sits out of the merge. Re-enable then pays a one-time build, which is acceptable for an infrequent action.
- **Stream the parser.** `parseWordlist` does `text.split('\n')` ([norm.js:101-109](../../site/src/engine/norm.js#L101-L109)), materializing ~500K substrings on top of the entry array during boot. An index-based line scan removes that boot-window transient. Modest, but it lands during the most memory-vulnerable window (first load, before anything has settled).
- **Mobile-aware defaults.** On `isMobile()` ([../../site/src/core/platform.js](../../site/src/core/platform.js)), auto-fetch fewer or smaller default wordlists, or defer building the merge until first interaction. This is the largest baseline cut, but it touches the "All Wordlists on first run" product tenet ([`../design.md`](../design.md) § Landing) — a deliberate product call, not a pure optimization.

### Large effort, largest structural win

- **Columnar (structure-of-arrays) entry storage** — replace per-entry objects with parallel typed arrays plus a packed string pool, eliminating most of the object-header overhead (often 40–50% of the total). Caveat: `engine/snapshot.js` *used* to carry a columnar pack/unpack and it was deliberately removed ([`../worker-protocol.md`](../worker-protocol.md) § Building the corpus notes "the columnar pack/unpack it once held is gone"). Understand *why* it was dropped before reintroducing it — there is prior art and a prior reason it didn't survive.

## Recommended sequencing

1. **Measure** — wire the temporary worker-side readout; get real device numbers.
2. **Fix the `syncConfig` 2×** and **evict assets on tool-removal** — surgical, low-risk, hit the most probable trigger plus the worst secondary spike, and touch no product behavior.
3. Drop `ownedEntryToIndex` to an `_i` slot.
4. If the phone still struggles: lazy disabled-source indexes, then the streaming parser.
5. Only then weigh the product-level mobile-defaults question and the columnar rearchitecture.

## To verify during implementation

- Confirm on-device (Web Inspector, tethered) that worker footprint drops by roughly the predicted amount after the `syncConfig` fix and asset eviction — the estimates above are unverified.
- Confirm the "serve stale until commit" path still answers correctly when the old index maps are dropped early (a fetch landing in the rebuild gap must not read a half-freed corpus).
- Confirm asset eviction on tool-removal doesn't thrash: adding then removing then re-adding Space-out should not re-fetch the corpus from the network each time (the IDB cache should still serve it).
- Confirm the `_i`-slot change keeps `ownedEntryToIndex`'s pairing invariant — every flat-result index must still decode to the correct merged row after a corpus rebuild.
- If lazy disabled-source indexes are built: confirm the provenance panel and a re-enable both still produce byte-identical merges to a full rebuild (the lockstep discipline the worker already keeps for in-place edits).
- Re-check every `file:line` anchor in this doc against the code before acting on it; they are a snapshot.
