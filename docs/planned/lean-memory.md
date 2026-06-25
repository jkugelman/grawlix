# Lean memory — keeping the worker's footprint small

Grawlix holds four full wordlists — well over a million wordlist entries — plus a deduped merge of them, all resident in the pipeline worker. That is a lot of memory for what is, on the page, a search box over a list. Nothing is broken: it loads, runs, and stays within budget. This doc is not chasing a bug — an earlier round of work already settled the iOS memory reloads that first prompted it.

What remains is leanness for its own sake — a courtesy, not a fix. A smaller footprint leaves headroom on the user's machine, lets them keep several Grawlix tabs open at once without the browser straining, and is just better engineering than carrying weight we can shed. Lean beats bloated. Everything below is discretionary refinement; none of it is load-bearing.

The big structural lever has shipped: the cold per-source pile is now a columnar store (typed arrays + packed string buffers, [`engine/sources.js`](../../site/src/engine/sources.js)), which removed the per-entry object shells, the `_rescored` score-changed duplicates, and the `_rescoredByNorm` Maps. On the full default load a worker heap snapshot measured **~330 MB → ~200 MB total** resident (179 MB retained, no tool assets) — a ~40% cut. What is left is smaller and more discretionary, and the cold pile is no longer the bulk.

## Where the memory goes

Anchors are against the worker, [`../../site/src/engine/worker.js`](../../site/src/engine/worker.js), and the engine modules it imports; line numbers drift, structure names are stable. Default load is four auto-fetched wordlists — Broda (~527K entries), Nediger (~345K), STWL (~280K), JK — plus XWI (~281K) for a subscriber. By the heap snapshot, the worker's resident bulk now divides roughly into thirds:

1. **`ownedMerged` / `ownedCorpus` objects** (~28%) — the deduped merge, ~751K rows of `{ norm, display, score, rawScore, comment, wordlist, _i }`, still **objects** by design (`resolveCorpus`, [corpus.js](../../site/src/engine/corpus.js)), plus its `byKey`/`byNorm` Maps. The pipeline seeds straight off `entries` and the executor/tools/sort read these every keystroke — the hot path, deliberately left as objects (a `RegExp` needs a real `norm` string).
2. **Strings** (~34%, the largest single category) — almost entirely the merged corpus's own `norm`/`display`/`comment` content. The columns hold *bytes*, so these strings are the merged rows', materialized once when the merge decodes the column views. Read by `RegExp` every keystroke, so they can't be pooled. Together with (1), the merged corpus — objects **and** strings — is now the dominant resident cost.
3. **The columnar per-source store** (~30%, `ArrayBuffer`s) — every non-Edits source's entries as parallel typed arrays plus packed `norm`/`display`/`comment` byte buffers, sorted by norm. Read only through `sourceAccessor`; My Edits stays object-backed (mutated each keystroke). This is the whole cold pile now — the structure the columnar work shrank.
4. **Tool assets** — the unigram corpus + CMU dict (~100 MB+) load on first use of Space-out / Rhymes; evicted when the tool leaves the stack, so resident only while in use (excluded from the figures above).

The shift to remember: the merged corpus (objects + strings, ~60% of resident) is now the bulk, and it is *deliberately* objects. The remaining cold-pile levers below act on the ~30% columnar slice, so their ceiling is smaller than before — weigh them against that.

## Measurement methodology

Rebuild a temporary readout per fix (it's worth it — several techniques are non-obvious), driven from `__grawlixTest` via a worker message + reply pair routed through [`pipeline-worker.js`](../../site/src/ui/pipeline-worker.js), mirroring the `dumpWorkerCorpus` bridge. Run against the dev server (`/dev-server`), not `dist`.

- **Measure the worker, not the page.** The corpus lives in the pipeline worker — a *separate* JS realm. In Chrome DevTools → Memory → Heap snapshot, pick the **`worker.js`** instance in the "Select JavaScript VM instance" list; a page-context snapshot misses the corpus entirely.
- **Counts are exact; treat the readout's byte estimate as a lower bound.** A single-element `[]`-then-`.push` array is ~92 B in V8 (wrapper + a backing store grown to capacity ≥4), ~2.5× the naive `header + 4·len` a readout assumes. Whenever a lever changes an *array* count, confirm bytes against a heap snapshot, not the readout.
- **Heap snapshots force a GC**, so they report *retained* bytes (the structural peak), not the higher total-heap figure a live graph shows. Use snapshots for apples-to-apples before/after; the live graph is noisy.

## Options, by impact ÷ effort

### Low effort

- **Also evict assets on `pagehide`.** The tool-leaves-stack trigger covers the in-use case; a `pagehide` trigger would additionally free assets when the browser keeps the page+worker alive in the back/forward cache after a navigation. Marginal next to the stack trigger — it only helps the bfcache-retained case, and the much larger corpus stays resident regardless — so weigh it against the bigger move of freeing the whole owned corpus on `pagehide` (a bfcache-restore-sensitive change: the restored page would need a full rebuild).
- **Stream the *object* parser.** `parseWordlist` ([norm.js](../../site/src/engine/norm.js)) still does `text.split('\n')`, materializing a substring array during boot. The columnar parser (`parseWordlistColumns`) already streams; only My Edits and the transient fetch/import parses still go through the object path, and those are small — so this is a marginal trim of a transient GC reclaims anyway. Revisit only if a boot-transient snapshot says it matters.

### Medium effort

- **Don't build columns for disabled sources eagerly.** `ownedBuilt` keeps disabled wordlists' columns resident so a re-enable is instant and the provenance panel can show them. Parsing a disabled list's columns lazily — only when a re-enable or the provenance walk asks — frees its bulk while it sits out of the merge. Re-enable then pays a one-time build, acceptable for an infrequent action. (Disabled sources are uncommon, so this helps a minority of loads.)

### Large effort, the remaining string lever

- **Cross-source `norm` dedup — a shared, deduped string/byte pool.** The one structural win the columnar store deliberately left on the table: each source packs its own `norm` bytes, so a norm held across 4–5 lists is stored 4–5×. But it lives inside the ~30% columnar slice, and the *headers* (the expensive part) are already gone — deduping the remaining short-ASCII norm *bytes* is roughly break-even against the pool's index/offset indirection, and a shared mutable pool adds refcount/compaction lifecycle and breaks the per-source independence the merge relies on (`bucketContributors` treats each source separately, `applyFetched` rebuilds one source's columns in isolation). The snapshot bears this out: the duplicated bytes are a slice of a slice, dwarfed by the merged corpus. Pick it up only if a snapshot ever shows it pays — and keep it an isolated follow-up.

## Recommended sequencing

1. The cheap, clean trims first — lazy disabled-source columns, and the `pagehide` asset eviction. They shed weight without spending the codebase's legibility, so they fit the leanness motivation exactly.
2. Treat cross-source string dedup as a standing *maybe*, not a next step. It is the only lever left that moves the duplicated-norm floor, but its complexity cost is real and the saving is marginal by estimate; pick it up only if a snapshot ever shows it pays.

## To verify

- If lazy disabled-source columns are built: confirm the provenance panel and a re-enable both produce byte-identical merges to a full rebuild (the lockstep discipline the worker already keeps for in-place edits).
- Re-check every `file:line` anchor against the code before acting on it; they are a snapshot.
