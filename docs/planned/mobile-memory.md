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
- **`ownedEntryToIndex` → per-entry `_i` slot.** The `Map(entry → index)` (~30 MB at the measured 663K-row merge) is gone; each merged row carries its position in `ownedCorpus.entries` as an `_i` slot, stamped once per corpus build/splice by `indexCorpusEntries`. Same O(1) flat-result encoding; the scoped-vs-merged read guard (`leanRowFor` reads `_i` only when `ownedCorpus === ownedMerged`) is preserved. **Measured ~10 MB at the in-object step** (440 → 430 MB), short of the Map's full size — the rest never showed cleanly against a noisy ~440 MB total, the reason a per-structure readout (below) is wanted before the bigger levers. **Lesson for those levers:** `_i` must be declared in the corpus-row *literal*, not added post-construction — adding a 7th property to a fully-packed 6-property object spills one `PropertyArray` per row (heap-snapshot-confirmed: PropertyArray count rose by exactly the `_i`-stamped row count, then fell back when the slot was moved into the literal). Any new per-entry field on these hot objects has the same trap.
- **Evict tool assets when their tool leaves the stack** (`evictUnusedAssets`). The unigram corpus / CMU dict (~100 MB+) no longer sit resident for the whole session: every run frees any loaded asset its stack no longer references. `invalidate()` keeps the IDB record, so a re-add reloads locally without a network re-fetch. (Confirmed: assets load lazily on tool-add / first `prepare()`, never eagerly at boot, so there's nothing to evict on a fresh load.)
- **Collapse the single-element `_rescoredByNorm` arrays.** `getRescoredByNorm` now stores `norm → entry` (a bare entry) for the ~99.99% of norms with one rescored entry, `norm → entry[]` only for the rare display-variant norm; every consumer reads through the `groupEntries` accessor and a shape-aware `isDistinguishing`. **Measured 430 → 317 MB — a 113 MB / 26% drop, the largest single lever of the effort** (heap snapshot: `Array`/`(array)` each fell ~1.23M, exactly the singleton norms, and the per-source maps stopped retaining the pile, ~196 → ~81 MB). **Calibration lesson:** the per-structure readout estimated only ~42 MB because it modelled a single-element array at ~36 B; V8's real `[]`-then-`.push` array is ~92 B (wrapper + a backing store grown to capacity ≥4), ~2.5× more. The array *counts* the readout reports are exact; trust the heap snapshot for bytes.

Everything remaining below is **worker-side**, where essentially all of the budget is now spent.

## Where the memory goes (validated)

All anchors are against the worker, [`../../site/src/engine/worker.js`](../../site/src/engine/worker.js), and the engine modules it imports. Line numbers are a snapshot and will drift; the function/structure names are stable.

Default load is four auto-fetched wordlists — Broda (~527K entries), Nediger (~345K), STWL (~280K), JK (fetched, size unmeasured) — plus XWI (~281K) if a subscriber has imported it. The worker holds, simultaneously:

1. **`ownedBuilt`** — every source, *enabled and disabled*, each as an array of `{ norm, display, score, comment }` wordlist-entry objects, built in `buildAllSourcesWordlists` ([worker.js:1276](../../site/src/engine/worker.js#L1276)). ~1.25M+ objects before the merge even runs.
2. **Per-source derived indexes** — each source additionally caches `_rescored` (a second array, with fresh objects wherever a rescore rule changed the score) and `_rescoredByNorm` (a `Map` of norm → entries), in `getRescoredEntries` / `getRescoredByNorm` ([rescore.js](../../site/src/engine/rescore.js)). The measured `byNormGroups` ≈ `byNormEntries` 1:1 for every source (e.g. XWI 280776 / 280776), so **nearly every norm held a single-element wrapper array** — almost pure per-array overhead. **(Shipped — `_rescoredByNorm` now stores a bare entry per single-entry norm, an array only for the rare variant norm; see *Shipped*. The ~113 MB win.)** The `_rescored` arrays still duplicate every entry whose score a rule changed into a fresh object (measured: ~1.07M such `{ …, rawScore }` objects) — not yet addressed.
3. **`ownedMerged`** — the deduped union: a fresh `entries` array of all merged rows (new objects, *not* shared with the per-source arrays), plus a `byKey` Map whose keys are freshly-allocated `norm\0display` strings, plus a `byNorm` Map, built in `resolveCorpus` ([corpus.js:41-84](../../site/src/engine/corpus.js#L41-L84)).
4. **`ownedEntryToIndex`** — a `Map` of *every* merged entry object → its integer index, existing only to encode the flat result's survivor indices, built in `setOwnedCorpus` ([worker.js:1309](../../site/src/engine/worker.js#L1309)). **(Shipped — now a per-entry `_i` slot; see *Shipped*.)**
5. **`_initialChains`** — the executor seeds each pipeline run from `new Array(entries.length)` of `{ atoms: [{ wlEntry, highlights, glyph }] }`, one chain + one single-element `atoms` array + one atom object **per corpus entry**, cached on the merged corpus in `buildInitialChains` ([executor.js:71-79](../../site/src/engine/executor.js#L71-L79)). Built lazily, but the first pipeline run happens at boot (the table renders), so the full-corpus materialization is effectively always resident — measured ~70 MB of objects plus its share of the array pile.
6. **Lazy data assets** — the unigram corpus (wordfreq `large_en`, a ~1M-key word→float `Map`) and the CMU pronunciation dict load on first use of Space-out / Rhymes (`loadUnigramCorpus` [segmenter.js:121](../../site/src/engine/segmenter.js#L121), `loadCmuDict` [phonetics.js:88](../../site/src/engine/phonetics.js#L88)). **(Shipped — now evicted when their tool leaves the stack, not only on a remote refresh; see *Shipped*.)** (Both were *unloaded* in the measurement below, so the figures are a floor.)

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
- **`performance.memory` is unavailable in worker scope** (Chrome), so a programmatic readout can't read bytes directly. Instead walk the resident structures and *estimate* bytes from entry counts and string lengths with fixed per-unit constants. The **counts are exact and device-independent — trust those; treat the byte estimate as a lower bound.** The `_rescoredByNorm` collapse proved the trap: the readout estimated −42 MB but the heap dropped −113 MB, because a single-element `[]`-then-`.push` array is ~92 B in V8 (wrapper + a backing store grown to capacity ≥4), not the ~36 B a naive `header + 4·len` model assumes. Whenever a lever changes an *array* count, confirm bytes against a heap snapshot, not the readout.
- **Heap snapshots force a GC**, so they report *retained* bytes (the structural peak), not the higher total-heap figure a live graph shows (which includes transient build garbage). Use snapshots for apples-to-apples before/after; the live graph is noisy.
- **Drive it from `__grawlixTest`** (the every-layer bridge in [`test-api.js`](../../site/src/test-api.js)) via a worker message + reply pair routed through [`pipeline-worker.js`](../../site/src/ui/pipeline-worker.js), mirroring the existing `dumpWorkerCorpus` bridge. Run against the dev server (`/dev-server`), not `dist`.

## Remaining options, by impact ÷ effort

### Low effort, high value

The two original entries here — evicting assets on tool-removal and dropping `ownedEntryToIndex` to an `_i` slot — have both shipped (see *Shipped*). One small follow-on remains:

- **Also evict assets on `pagehide`.** The tool-leaves-stack trigger covers the in-use case; a `pagehide` trigger would additionally free assets when iOS keeps the page+worker alive in the back/forward cache after a navigation. Marginal next to the stack trigger — it only helps the bfcache-retained case, and the much larger corpus stays resident regardless — so weigh it against the bigger move of freeing the whole owned corpus on `pagehide` (a bfcache-restore-sensitive change: the restored page would need a full rebuild).

### Medium effort

- **Don't materialize `_initialChains` for the whole corpus** (now the #1 remaining array lever — ~70 MB of objects + ~663K arrays + ~663K atom objects, the `{ atoms } ×662,977` / `{ wlEntry, highlights, glyph } ×662,977` lines that dominate the post-collapse heap). The executor seeds every run from one chain per corpus entry ([executor.js:71-79](../../site/src/engine/executor.js#L71-L79)); seeding lazily per window, or from indices rather than pre-wrapped `{ atoms: [...] }` objects, removes a full-corpus resident copy. This is the executor's input model, so it is the most invasive of the medium tier — but the payoff is large.
- **Don't fully build disabled sources.** `ownedBuilt` keeps disabled wordlists' `rawEntries` and indexes resident so a re-enable is instant and the provenance panel can show them. Building a disabled list's `_rescoredByNorm` lazily — only when the provenance walk asks for it — frees a disabled list's bulk while it sits out of the merge. Re-enable then pays a one-time build, acceptable for an infrequent action.
- **Stream the parser.** `parseWordlist` does `text.split('\n')` ([norm.js:103](../../site/src/engine/norm.js#L103)), materializing ~500K substrings on top of the entry array during boot. An index-based line scan removes that boot-window transient. Modest, but it lands during the most memory-vulnerable window (first load, before anything has settled).
- **Mobile-aware defaults.** On `isMobile()` ([../../site/src/core/platform.js](../../site/src/core/platform.js)), auto-fetch fewer or smaller default wordlists, or defer building the merge until first interaction. This is the largest baseline cut, but it touches the "All Wordlists on first run" product tenet ([`../design.md`](../design.md) § Landing) — a deliberate product call, not a pure optimization.

### Large effort, largest structural win

- **Columnar (structure-of-arrays) entry storage** — replace per-entry objects with parallel typed arrays plus a packed string pool, eliminating most of the object-header overhead (often 40–50% of the total). Caveat: `engine/snapshot.js` *used* to carry a columnar pack/unpack and it was deliberately removed ([`../worker-protocol.md`](../worker-protocol.md) § Building the corpus notes "the columnar pack/unpack it once held is gone"). Understand *why* it was dropped before reintroducing it. The columnar move would subsume the array and rescored-duplicate levers, so re-evaluate it once the cheaper wins land.

## Recommended sequencing

The `_i`-slot drop, asset-eviction, and the `_rescoredByNorm` collapse (the 113 MB win) have shipped (see *Shipped*). What remains, in order:

1. **De-materialize `_initialChains`** — now the largest remaining array lever (the `{atoms}` + atom-object pile, ~663K of each, plainly visible in the post-collapse heap). The most invasive, since it's the executor's input model.
2. If the phone still struggles: lazy disabled-source indexes, then the streaming parser.
3. Only then weigh the product-level mobile-defaults question and the columnar rearchitecture.

## To verify during implementation

- Re-measure after each fix (rebuild the readout + a worker heap snapshot per *Measurement methodology*) to confirm the structure's MB drops by the predicted amount; the per-fix savings are projected, not yet measured. **Still outstanding for the two shipped levers** — they were verified for *correctness* (the worker golden/fetchrows/edit specs for `_i`; [`tests/browser/asset-eviction.spec.js`](../../tests/browser/asset-eviction.spec.js) for eviction + no-refetch) but the byte savings haven't been measured on-device.
- If lazy disabled-source indexes are built: confirm the provenance panel and a re-enable both still produce byte-identical merges to a full rebuild (the lockstep discipline the worker already keeps for in-place edits).
- Re-check every `file:line` anchor in this doc against the code before acting on it; they are a snapshot.
