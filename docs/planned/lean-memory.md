# Lean memory — keeping the worker's footprint small

Grawlix holds four full wordlists — well over a million wordlist entries — plus a deduped merge of them, all resident in the pipeline worker. That is a lot of memory for what is, on the page, a search box over a list. Nothing is broken: it loads, runs, and stays within budget. This doc is not chasing a bug — an earlier round of work already settled the iOS memory reloads that first prompted it.

What remains is leanness for its own sake — a courtesy, not a fix. A smaller footprint leaves headroom on the user's machine, lets them keep several Grawlix tabs open at once without the browser straining, and is just better engineering than carrying weight we can shed. Lean beats bloated. Everything below is discretionary refinement; none of it is load-bearing.

A 2026-06 series of commits cut the worker's steady state to **~281 MB** on the full default load (no tool assets), down from a ~770 MB rebuild peak — both full-corpus figures; see `git log` for the shipped levers. This doc is what is left to shave.

## Where the memory goes

Anchors are against the worker, [`../../site/src/engine/worker.js`](../../site/src/engine/worker.js), and the engine modules it imports; line numbers drift, structure names are stable. Default load is four auto-fetched wordlists — Broda (~527K entries), Nediger (~345K), STWL (~280K), JK — plus XWI (~281K) for a subscriber. After the shipped levers, the worker's resident bulk is:

1. **Per-source entry objects** — `ownedBuilt` holds every source (enabled *and* disabled) as `{ norm, display, score, comment }` objects (`buildAllSourcesWordlists`), and `_rescored` duplicates every entry whose score a rule changed into a fresh `{ …, rawScore }` object (~1.07M such objects). ~2.5M entry objects across all sources before the merge.
2. **`ownedMerged`** — the deduped union: a fresh `entries` array of all merged rows (new objects), a `byKey` Map keyed by freshly-allocated `norm\0display` strings, and a `byNorm` Map (`resolveCorpus`, [corpus.js](../../site/src/engine/corpus.js)). The pipeline seeds straight off this `entries` array, so no per-entry seed chain is materialized.
3. **Strings** — norm/display/comment content, ~66 MB, shared across `rawEntries` / `_rescored` / merged. A floor that nothing short of a columnar string pool touches.
4. **Tool assets** — the unigram corpus + CMU dict (~100 MB+) load on first use of Space-out / Rhymes; now evicted when the tool leaves the stack, so resident only while in use.

Current total is **~281 MB** resident with no assets loaded (worker heap snapshot). The merged corpus plus the per-source entry/rescored-duplicate objects are the bulk; the strings and per-object headers are the floor only a columnar rewrite moves.

## Measurement methodology

Rebuild a temporary readout per fix (it's worth it — several techniques are non-obvious), driven from `__grawlixTest` via a worker message + reply pair routed through [`pipeline-worker.js`](../../site/src/ui/pipeline-worker.js), mirroring the `dumpWorkerCorpus` bridge. Run against the dev server (`/dev-server`), not `dist`.

- **Measure the worker, not the page.** The corpus lives in the pipeline worker — a *separate* JS realm. In Chrome DevTools → Memory → Heap snapshot, pick the **`worker.js`** instance in the "Select JavaScript VM instance" list; a page-context snapshot misses the corpus entirely.
- **Counts are exact; treat the readout's byte estimate as a lower bound.** A single-element `[]`-then-`.push` array is ~92 B in V8 (wrapper + a backing store grown to capacity ≥4), ~2.5× the naive `header + 4·len` a readout assumes — array-collapse levers have run well under their readout estimates on the real heap. Whenever a lever changes an *array* count, confirm bytes against a heap snapshot, not the readout.
- **Heap snapshots force a GC**, so they report *retained* bytes (the structural peak), not the higher total-heap figure a live graph shows. Use snapshots for apples-to-apples before/after; the live graph is noisy.

## Options, by impact ÷ effort

### Low effort

- **Also evict assets on `pagehide`.** The tool-leaves-stack trigger covers the in-use case; a `pagehide` trigger would additionally free assets when the browser keeps the page+worker alive in the back/forward cache after a navigation. Marginal next to the stack trigger — it only helps the bfcache-retained case, and the much larger corpus stays resident regardless — so weigh it against the bigger move of freeing the whole owned corpus on `pagehide` (a bfcache-restore-sensitive change: the restored page would need a full rebuild).

### Medium effort

- **Don't fully build disabled sources.** `ownedBuilt` keeps disabled wordlists' `rawEntries` and indexes resident so a re-enable is instant and the provenance panel can show them. Building a disabled list's `_rescoredByNorm` lazily — only when the provenance walk asks for it — frees a disabled list's bulk while it sits out of the merge. Re-enable then pays a one-time build, acceptable for an infrequent action.
- **Stream the parser.** `parseWordlist` does `text.split('\n')` ([norm.js:103](../../site/src/engine/norm.js#L103)), materializing ~500K substrings on top of the entry array during boot. An index-based line scan removes that boot-time transient. Modest — it touches a peak that GC reclaims anyway — but it's a clean trim of the highest-water mark.

### Large effort, largest structural win

- **Columnar (structure-of-arrays) entry storage** — replace per-entry objects with parallel typed arrays plus a packed string pool, eliminating most of the object-header overhead (often 40–50% of the total) and the shared string floor. On the ~281 MB baseline that points at a ~40–50% cut (the ~66 MB string floor shrinks via a deduped pool; the rest is the object shells columnar removes). Confirm against a worker heap snapshot, not the readout — array-collapse levers have consistently beaten their readout estimates. This subsumes the per-source entry, the `_rescored` duplicate, and the string-content levers at once.

  **The prior pack/unpack was a *wire format*, not resident storage — there is no prior art for the hard part.** `engine/snapshot.js` once carried `packSnapshot`/`unpackSnapshot` ([`../worker-protocol.md`](../worker-protocol.md) notes it "is gone"), removed in `3a0bd49` ("move the wordlist corpus onto the pipeline worker"). It packed the corpus columnar only to *ship* it main→worker, then `unpackSnapshot` rebuilt `{ norm, display, score }` objects on the far side — entries lived as objects on both ends. It was dropped because the worker now owns and builds the corpus from IDB text, so there was nothing left to ship — **not** because columnar-at-rest failed. So restoring it is not "undo the deletion": keeping entries columnar *while they are read*, never unpacking, is a different and larger change. The old pack was also lossy by design (norm/display/score only — it dropped `comment`, `rawScore`, and `wordlist` provenance); a resident store needs every column the pipeline and UI read.

  **The hot field is `norm`, not the strings you'd most want to pool.** `norm` is read unconditionally on every entry every run and fed straight into a JS `RegExp` ([executor.js:71-72](../../site/src/engine/executor.js#L71) yields `.norm` per row; [search.js:64](../../site/src/engine/search.js#L64) `filterRe.test(wlEntry.norm)`; [regex.js:71](../../site/src/engine/tools/regex.js#L71)). A `RegExp` needs a real string, so a naive `norm` pool forces a decode per entry per keystroke. `display` and `comment` are cheap by contrast — `comment` is windowed by the scroller, and `display` is `null` for most rows and only a *fallback* arm behind a norm-test miss ([search.js:65-66](../../site/src/engine/search.js#L65)); it is read per-entry only at build-time sort (transient, already off-thread) and by display-coordinate tools (`useDisplay`, [executor.js:313](../../site/src/engine/executor.js#L313)).

  **The split that resolves it:** the searched corpus is already norm-unique (the merge dedups by `(norm, display)`; a single-source scope is a wordlist), so keep the *active scope's* `norm` as plain JS strings — the regex loop then never decodes, and the count matches today. The cross-source repetition (the same norm held 4–5× across lists, since V8 doesn't intern runtime strings) lives in the cold `ownedBuilt` pile, kept only for re-enable and provenance — pool `norm` *with dedup* there for the big win, materializing only on those rare reads. Pool `comment` and `display` freely everywhere. The columnar win thus lands on the cold bulk where it's free; the one hot field stays cheap. This dovetails with the disabled-source lazy-index lever above (same cold pile).

  Weigh this one differently from the rest, though. The motivation is leanness as a courtesy — and a columnar-at-rest corpus would be the single most intricate region of an otherwise clean codebase, permanently. That trades *conceptual* leanness for *byte* leanness, which partly works against the very value driving the work. The cheap levers carry no such tax. See the standing recommendation below.

## Recommended sequencing

The big per-entry array piles are already gone; what remains is mostly per-object and string overhead, which only the columnar rewrite moves in bulk.

1. The cheap, clean trims first — lazy disabled-source indexes and the streaming parser. They shed weight without spending the codebase's legibility, so they fit the leanness motivation exactly.
2. Treat columnar as a standing *maybe*, not a next step. It is the only lever that moves the string floor, but its permanent complexity cost is large and discretionary; pick it up only if shaving bytes ever outweighs keeping the corpus code simple.

## To verify

- If lazy disabled-source indexes are built: confirm the provenance panel and a re-enable both produce byte-identical merges to a full rebuild (the lockstep discipline the worker already keeps for in-place edits).
- Re-check every `file:line` anchor against the code before acting on it; they are a snapshot.
