# Mobile memory — shrinking the worker's footprint on iOS

Grawlix crashes intermittently on iPhone. The cause is memory: it builds and holds four full wordlists — well over a million wordlist entries — plus a deduped merge of them in the pipeline worker, and on iOS that worker heap counts against the same per-tab limit Safari jetsams. The user-visible symptom is the tab reloading itself ("this webpage was reloaded because it was using significant memory"). It does not reproduce on desktop, where there are gigabytes of headroom.

This doc is the remaining work. The diagnosis below (with `file:line` anchors a reviewer can check) and the measured baseline stay because the open levers depend on them; the levers already shipped are listed under *Shipped* and not re-explained.

## Why iPhone specifically

On iOS, a page's Web Worker runs as a thread inside the same WebContent process as the tab — there is no separate budget. The worker's heap and the page's heap share one jetsam limit, and iOS enforces it far more aggressively than desktop (commonly a few hundred MB on 2–4 GB devices, lower under system pressure). The same footprint that is invisible on desktop is fatal on the phone. This is why the data-ownership inversion (worker owns the whole corpus — see [`../worker-protocol.md`](../worker-protocol.md)), a latency win, does not help memory on mobile: moving the corpus off the main thread did not move it out of the process.

## Shipped

These landed already and are folded into the codebase; they are not open work.

- **Free the prior corpus before a `syncConfig` rebuild** (`releasePriorCorpus`). Eliminated the transient 2× where the worker briefly held two complete corpora during a rebuild — **770 MB → 402 MB** at the rebuild peak (measured, 6-list corpus). The follow-up `ownedCorpusReady`-on-`ownedBuilt` fix keeps edit/merge handlers working in the post-free rebuild gap.
- **The main-thread inversion** — main now holds only My Edits' `rawEntries`; every other source is metadata-only, built by the worker from its own IDB. **~200 MB → ~30 MB on main.** This subsumed freeing the main-thread `_rescored` / `_rescoredByNorm` caches, dropping the main-thread histogram fallback, planning My Edits writes in the worker, and shipping per-source totals from the worker. Main and the worker share the one iOS budget, so this stacks with the worker-side levers below.
- **Update-summary diff windowing** — a full-replace re-import no longer re-materializes its ~600k diff rows on main: the worker retains the full diff and the dialog virtual-scrolls it (`fetchDiffRows`/`freeDiff`; see [`../worker-protocol.md`](../worker-protocol.md)). Bounded by the few live update affordances, each freed when its toast/dialog ends.

Everything remaining below is **worker-side**, where essentially all of the budget is now spent.

## Where the memory goes (validated)

All anchors are against the worker, [`../../site/src/engine/worker.js`](../../site/src/engine/worker.js), and the engine modules it imports. Line numbers are a snapshot and will drift; the function/structure names are stable.

Default load is four auto-fetched wordlists — Broda (~527K entries), Nediger (~345K), STWL (~280K), JK (fetched, size unmeasured) — plus XWI (~281K) if a subscriber has imported it. The worker holds, simultaneously:

1. **`ownedBuilt`** — every source, *enabled and disabled*, each as an array of `{ norm, display, score, comment }` wordlist-entry objects, built in `buildAllSourcesWordlists` ([worker.js:1276](../../site/src/engine/worker.js#L1276)). ~1.25M+ objects before the merge even runs.
2. **Per-source derived indexes** — each source additionally caches `_rescored` (a second array, with fresh objects wherever a rescore rule changed the score) and `_rescoredByNorm` (a `Map` of norm → *array* of entries), in `getRescoredEntries` / `getRescoredByNorm` ([rescore.js:94-117](../../site/src/engine/rescore.js#L94-L117)). The measured `byNormGroups` ≈ `byNormEntries` 1:1 for every source (e.g. XWI 280776 / 280776), so **nearly every one of those ~1.5M arrays holds a single element** — almost pure per-array header overhead. The `_rescored` arrays also duplicate every entry whose score a rule changed into a fresh object (measured: ~1.07M such `{ …, rawScore }` objects).
3. **`ownedMerged`** — the deduped union: a fresh `entries` array of all merged rows (new objects, *not* shared with the per-source arrays), plus a `byKey` Map whose keys are freshly-allocated `norm\0display` strings, plus a `byNorm` Map, built in `resolveCorpus` ([corpus.js:41-84](../../site/src/engine/corpus.js#L41-L84)).
4. **`ownedEntryToIndex`** — a `Map` of *every* merged entry object → its integer index, existing only to encode the flat result's survivor indices, built in `setOwnedCorpus` ([worker.js:1309](../../site/src/engine/worker.js#L1309)).
5. **`_initialChains`** — the executor seeds each pipeline run from `new Array(entries.length)` of `{ atoms: [{ wlEntry, highlights, glyph }] }`, one chain + one single-element `atoms` array + one atom object **per corpus entry**, cached on the merged corpus in `buildInitialChains` ([executor.js:71-79](../../site/src/engine/executor.js#L71-L79)). Built lazily, but the first pipeline run happens at boot (the table renders), so the full-corpus materialization is effectively always resident — measured ~70 MB of objects plus its share of the array pile.
6. **Lazy data assets, never freed in normal use** — the unigram corpus (wordfreq `large_en`, a ~1M-key word→float `Map`) and the CMU pronunciation dict load on first use of Space-out / Rhymes (`loadUnigramCorpus` [segmenter.js:121](../../site/src/engine/segmenter.js#L121), `loadCmuDict` [phonetics.js:88](../../site/src/engine/phonetics.js#L88)). They are evicted *only* on a detected remote refresh in `handleCheckAssets` — never when the tool leaves the stack, never under pressure. Once loaded they stay resident. (Both were *unloaded* in the measurement below, so the figures are a floor.)

### Dead weight worth noting

`getRescoredMap` / `_rescoredMap` ([rescore.js:98-104](../../site/src/engine/rescore.js#L98-L104)) is never called anywhere — it costs no memory (never populated) but is invalidated in two places and should be removed for clarity, not for footprint.

## Measured (2026-06-23)

Measured in desktop Chrome (V8) against the five real lists a subscriber runs — JK (73,651 entries), Nediger (346,936), XWI (280,776), STWL (314,822), Broda (527,347), plus My Edits — via a temporary worker readout cross-checked against a Chrome heap snapshot. V8 ≠ iOS's JSC, but object/string/Map/array overhead is the same order of magnitude, and the *counts* are device-independent (same lists everywhere). The two methods agreed: **readout estimate 476.8 MB, heap snapshot 489 MB retained** — within 3%, so the per-structure split below is trustworthy. **Both tool assets were unloaded**, so this is a floor; Space-out / Rhymes add ~100 MB+ on top.

Per-structure (from the readout, MB):

- **Merged corpus — 155 MB** (`entries`/`byKey`/`byNorm`, 751,441 rows each). The single biggest named structure.
- **Per-source — ~281 MB total**: Broda 94, Nediger 69, STWL 56, XWI 50, JK 13. Each is rawEntries + the rescored-duplicate objects + the `_rescoredByNorm` map and its per-norm arrays.
- **`ownedEntryToIndex` — 40 MB** (751,441-entry Map).
- **`_initialChains` — ~70 MB** of objects (not in the readout's total; seen in the snapshot as `{atoms} ×751,443` + `{wlEntry, highlights, glyph} ×751,443`).

The heap snapshot's **biggest single category is arrays**: `(array) ×2,295,773`, ~222 MB shallow. That count is ~1.5M single-element `_rescoredByNorm` wrappers + ~751K single-element `_initialChains` `atoms` arrays + a handful of huge backing arrays (the `_rescored` / `entries` arrays). The per-entry *array wrapping* — not the entry objects, not the Maps — is the largest lever. Strings are next at ~67 MB (`(string) ×2,770,655`).

The takeaway: at **~400–490 MB resident with no assets loaded**, the steady state alone is already in iOS jetsam range on most iPhones. The `syncConfig` rebuild 2× that once pushed this to **770 MB** on a single config change is fixed (see *Shipped*), so what remains is the steady-state floor.

## Measurement methodology

The instrumentation behind the numbers above was temporary and has been removed; rebuild it per fix (it's worth it — several techniques were non-obvious). Key points:

- **Measure the worker, not the page.** The corpus lives in the pipeline worker — on iOS it shares the tab's jetsam budget but is a *separate* JS realm. In Chrome DevTools → Memory → Heap snapshot, pick the **`worker.js`** instance in the "Select JavaScript VM instance" list; a page-context snapshot misses the corpus entirely.
- **`performance.memory` is unavailable in worker scope** (Chrome), so a programmatic readout can't read bytes directly. Instead walk the resident structures and *estimate* bytes from entry counts and string lengths with fixed per-unit constants (object ~56 B, Map entry ~56 B, array header ~32 B, string header ~16 B + content). This estimate matched a real worker heap snapshot within 3%, so the *counts* — device-independent — are the trustworthy part.
- **Heap snapshots force a GC**, so they report *retained* bytes (the structural peak), not the higher total-heap figure a live graph shows (which includes transient build garbage). Use snapshots for apples-to-apples before/after; the live graph is noisy.
- **Drive it from `__grawlixTest`** (the every-layer bridge in [`test-api.js`](../../site/src/test-api.js)) via a worker message + reply pair routed through [`pipeline-worker.js`](../../site/src/ui/pipeline-worker.js), mirroring the existing `dumpWorkerCorpus` bridge. Run against the dev server (`/dev-server`), not `dist`.

## Remaining options, by impact ÷ effort

### Low effort, high value

- **Evict the unigram / CMU assets when their tool leaves the stack** (and/or on `pagehide`). The eviction primitive already exists (`asset.invalidate()`, used by `handleCheckAssets`); this just adds a second trigger. Reclaims ~100 MB+ deterministically when the user moves off Space-out / Rhymes.
- **Replace `ownedEntryToIndex` (a full Map) with an `_i` slot written onto each entry object** during `setOwnedCorpus`. Same O(1) lookup, one structure's worth of Map overhead removed (~40 MB). The pairing discipline (`ownedEntryToIndex` must stay total with `ownedCorpus`) is preserved automatically because the index then lives on the entry itself.

### Medium effort

- **Collapse single-element `_rescoredByNorm` arrays** (the #1 array lever). With ~1.5M of these arrays nearly all holding one element, store `norm → entry | entry[]` (scalar when one, array only for the rare multi-display norm) — or restructure consumers to read the flat `_rescored` with a norm→index map. The merge resolver iterates `for (const wlE of group)` ([corpus.js:31](../../site/src/engine/corpus.js#L31), and the worker's per-norm `computeMergedBucket`), so every consumer must handle the scalar-or-array shape in lockstep; that coupling is the cost. Reclaims a large fraction of the ~222 MB array pile.
- **Don't materialize `_initialChains` for the whole corpus** (the #2 array lever, ~70 MB of objects + ~751K arrays). The executor seeds every run from one chain per corpus entry ([executor.js:71-79](../../site/src/engine/executor.js#L71-L79)); seeding lazily per window, or from indices rather than pre-wrapped `{ atoms: [...] }` objects, removes a full-corpus resident copy. This is the executor's input model, so it is the most invasive of the medium tier — but the payoff is large and it compounds with the array-collapse above.
- **Don't fully build disabled sources.** `ownedBuilt` keeps disabled wordlists' `rawEntries` and indexes resident so a re-enable is instant and the provenance panel can show them. Building a disabled list's `_rescoredByNorm` lazily — only when the provenance walk asks for it — frees a disabled list's bulk while it sits out of the merge. Re-enable then pays a one-time build, acceptable for an infrequent action.
- **Stream the parser.** `parseWordlist` does `text.split('\n')` ([norm.js:103](../../site/src/engine/norm.js#L103)), materializing ~500K substrings on top of the entry array during boot. An index-based line scan removes that boot-window transient. Modest, but it lands during the most memory-vulnerable window (first load, before anything has settled).
- **Mobile-aware defaults.** On `isMobile()` ([../../site/src/core/platform.js](../../site/src/core/platform.js)), auto-fetch fewer or smaller default wordlists, or defer building the merge until first interaction. This is the largest baseline cut, but it touches the "All Wordlists on first run" product tenet ([`../design.md`](../design.md) § Landing) — a deliberate product call, not a pure optimization.

### Large effort, largest structural win

- **Columnar (structure-of-arrays) entry storage** — replace per-entry objects with parallel typed arrays plus a packed string pool, eliminating most of the object-header overhead (often 40–50% of the total). Caveat: `engine/snapshot.js` *used* to carry a columnar pack/unpack and it was deliberately removed ([`../worker-protocol.md`](../worker-protocol.md) § Building the corpus notes "the columnar pack/unpack it once held is gone"). Understand *why* it was dropped before reintroducing it. The columnar move would subsume the array and rescored-duplicate levers, so re-evaluate it once the cheaper wins land.

## Recommended sequencing

1. **Collapse the single-element `_rescoredByNorm` arrays** and **drop `ownedEntryToIndex` to an `_i` slot** — the largest measured steady-state levers that don't touch the executor.
2. **Evict assets on tool-removal** — keeps the assets from compounding the floor once a user touches Space-out / Rhymes.
3. If the phone still struggles: de-materialize `_initialChains`, then lazy disabled-source indexes, then the streaming parser.
4. Only then weigh the product-level mobile-defaults question and the columnar rearchitecture.

## To verify during implementation

- Re-measure after each fix (rebuild the readout + a worker heap snapshot per *Measurement methodology*) to confirm the structure's MB drops by the predicted amount; the per-fix savings are projected, not yet measured.
- Confirm the `_i`-slot change keeps `ownedEntryToIndex`'s pairing invariant — every flat-result index must still decode to the correct merged row after a corpus rebuild.
- If lazy disabled-source indexes are built: confirm the provenance panel and a re-enable both still produce byte-identical merges to a full rebuild (the lockstep discipline the worker already keeps for in-place edits).
- Confirm asset eviction on tool-removal doesn't thrash: adding then removing then re-adding Space-out should not re-fetch the corpus from the network each time (the IDB cache should still serve it).
- Re-check every `file:line` anchor in this doc against the code before acting on it; they are a snapshot.
