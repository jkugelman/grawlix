# Mobile memory — shrinking the worker's footprint on iOS

Grawlix crashed intermittently on iPhone. The cause is memory: it builds and holds four full wordlists — well over a million wordlist entries — plus a deduped merge of them in the pipeline worker, and on iOS that worker heap counts against the same per-tab limit Safari jetsams. The symptom is the tab reloading itself ("this webpage was reloaded because it was using significant memory"). It does not reproduce on desktop, where there are gigabytes of headroom.

A 2026-06 series of commits cut the worker's steady state to **~281 MB** on the full default load (no tool assets), down from a ~770 MB rebuild peak — both full-corpus figures; see `git log` for the shipped levers. This doc is what **remains**.

## Why iPhone specifically

On iOS, a page's Web Worker runs as a thread inside the same WebContent process as the tab — there is no separate budget. The worker's heap and the page's heap share one jetsam limit, and iOS enforces it far more aggressively than desktop (commonly a few hundred MB on 2–4 GB devices, lower under system pressure). The same footprint that is invisible on desktop is fatal on the phone. This is why the data-ownership inversion (worker owns the whole corpus — see [`../worker-protocol.md`](../worker-protocol.md)), a latency win, does not help memory on mobile: moving the corpus off the main thread did not move it out of the process.

## Where the remaining memory goes

Anchors are against the worker, [`../../site/src/engine/worker.js`](../../site/src/engine/worker.js), and the engine modules it imports; line numbers drift, structure names are stable. Default load is four auto-fetched wordlists — Broda (~527K entries), Nediger (~345K), STWL (~280K), JK — plus XWI (~281K) for a subscriber. After the shipped levers, the worker's resident bulk is:

1. **Per-source entry objects** — `ownedBuilt` holds every source (enabled *and* disabled) as `{ norm, display, score, comment }` objects (`buildAllSourcesWordlists`), and `_rescored` duplicates every entry whose score a rule changed into a fresh `{ …, rawScore }` object (~1.07M such objects). ~2.5M entry objects across all sources before the merge.
2. **`ownedMerged`** — the deduped union: a fresh `entries` array of all merged rows (new objects), a `byKey` Map keyed by freshly-allocated `norm\0display` strings, and a `byNorm` Map (`resolveCorpus`, [corpus.js](../../site/src/engine/corpus.js)). The pipeline seeds straight off this `entries` array, so no per-entry seed chain is materialized.
3. **Strings** — norm/display/comment content, ~66 MB, shared across `rawEntries` / `_rescored` / merged. A floor that nothing short of a columnar string pool touches.
4. **Tool assets** — the unigram corpus + CMU dict (~100 MB+) load on first use of Space-out / Rhymes; now evicted when the tool leaves the stack, so resident only while in use.

Current total is **~281 MB** resident with no assets loaded (worker heap snapshot). The merged corpus plus the per-source entry/rescored-duplicate objects are now the bulk; the strings and per-object headers are the floor only a columnar rewrite moves.

## Measurement methodology

Rebuild a temporary readout per fix (it's worth it — several techniques are non-obvious), driven from `__grawlixTest` via a worker message + reply pair routed through [`pipeline-worker.js`](../../site/src/ui/pipeline-worker.js), mirroring the `dumpWorkerCorpus` bridge. Run against the dev server (`/dev-server`), not `dist`.

- **Measure the worker, not the page.** The corpus lives in the pipeline worker — a *separate* JS realm. In Chrome DevTools → Memory → Heap snapshot, pick the **`worker.js`** instance in the "Select JavaScript VM instance" list; a page-context snapshot misses the corpus entirely.
- **Counts are exact; treat the readout's byte estimate as a lower bound.** A single-element `[]`-then-`.push` array is ~92 B in V8 (wrapper + a backing store grown to capacity ≥4), ~2.5× the naive `header + 4·len` a readout assumes — array-collapse levers have run well under their readout estimates on the real heap. Whenever a lever changes an *array* count, confirm bytes against a heap snapshot, not the readout.
- **Heap snapshots force a GC**, so they report *retained* bytes (the structural peak), not the higher total-heap figure a live graph shows. Use snapshots for apples-to-apples before/after; the live graph is noisy.

## Remaining options, by impact ÷ effort

### Low effort

- **Also evict assets on `pagehide`.** The tool-leaves-stack trigger covers the in-use case; a `pagehide` trigger would additionally free assets when iOS keeps the page+worker alive in the back/forward cache after a navigation. Marginal next to the stack trigger — it only helps the bfcache-retained case, and the much larger corpus stays resident regardless — so weigh it against the bigger move of freeing the whole owned corpus on `pagehide` (a bfcache-restore-sensitive change: the restored page would need a full rebuild).

### Medium effort

- **Don't fully build disabled sources.** `ownedBuilt` keeps disabled wordlists' `rawEntries` and indexes resident so a re-enable is instant and the provenance panel can show them. Building a disabled list's `_rescoredByNorm` lazily — only when the provenance walk asks for it — frees a disabled list's bulk while it sits out of the merge. Re-enable then pays a one-time build, acceptable for an infrequent action.
- **Stream the parser.** `parseWordlist` does `text.split('\n')` ([norm.js:103](../../site/src/engine/norm.js#L103)), materializing ~500K substrings on top of the entry array during boot. An index-based line scan removes that boot-window transient. Modest, but it lands during the most memory-vulnerable window (first load, before anything has settled).
- **Mobile-aware defaults.** On `isMobile()` ([../../site/src/core/platform.js](../../site/src/core/platform.js)), auto-fetch fewer or smaller default wordlists, or defer building the merge until first interaction. This is the largest baseline cut, but it touches the "All Wordlists on first run" product tenet ([`../design.md`](../design.md) § Landing) — a deliberate product call, not a pure optimization.

### Large effort, largest structural win

- **Columnar (structure-of-arrays) entry storage** — replace per-entry objects with parallel typed arrays plus a packed string pool, eliminating most of the object-header overhead (often 40–50% of the total) and the shared string floor. Caveat: `engine/snapshot.js` *used* to carry a columnar pack/unpack and it was deliberately removed ([`../worker-protocol.md`](../worker-protocol.md) notes "the columnar pack/unpack it once held is gone"). Understand *why* it was dropped before reintroducing it. This subsumes the per-source entry, the `_rescored` duplicate, and the string-content levers at once.

## Recommended sequencing

The big per-entry array piles are already gone; what remains is mostly per-object and string overhead, which only the columnar rewrite moves in bulk. If the phone still struggles:

1. Lazy disabled-source indexes and the streaming parser (the two cheap remaining wins).
2. Then weigh the product-level mobile-defaults question and the columnar rearchitecture.

## To verify

- **Validate on a real iPhone** under jetsam pressure. The shipped wins were confirmed in desktop heap snapshots, not on-device — that gates whether the remaining levers are even needed.
- If lazy disabled-source indexes are built: confirm the provenance panel and a re-enable both produce byte-identical merges to a full rebuild (the lockstep discipline the worker already keeps for in-place edits).
- Re-check every `file:line` anchor against the code before acting on it; they are a snapshot.
