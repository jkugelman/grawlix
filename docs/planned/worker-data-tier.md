# Worker data tier — the worker owns the wordlists, main is a thin view

The pipeline worker is the **sole owner of the wordlist data**, and the main thread is a thin, asynchronous view over it. The worker reads each source's text from IndexedDB, parses, rescores, and merges it, builds every scoped view, runs the pipeline, and computes the stats/histograms; main holds no merged or scoped corpus — only the small per-wordlist config and the DOM. This rearchitecture has **shipped**. Its design and the whys behind it now live with the code they describe:

- [`../design.md`](../design.md) § *Cooperative runtime* — the worker-owns-corpus model, why it removed the cold-boot / scope-switch / fetch-import freezes a main-resident corpus left behind, the main-heap / GC payoff, and the windowed flat + grouped result tiers (with the grouped-render freeze root cause: a letter-bank-`*` result is ~53k mostly-small groups, so the group-ROW list — not the chains per group — is what had to be windowed). The transform tier stays fully materialized by deliberate decision.
- [`../worker-protocol.md`](../worker-protocol.md) — the main↔worker contract: data ownership, every message (`syncConfig`, `run`, the windowed `fetchRows`/`fetchGroups`/`fetchGroupChains` fetches, the `editEntry`/`deleteEntry` commands, `serializeFor`), the deferred-run queue, and the cancellation/supersession rules.

This doc tracks only what has **not** yet shipped, plus the standing reasoning for the boundaries this rearchitecture deliberately did not cross.

## Not yet shipped: the disk-sync tail

Disk sync is still partly main-resident. The remaining move:

- **The My Edits 3-way disk merge moves worker-side.** Today main reads the file and runs the merge; the target is a `mergeDisk { fileText }` command — the worker runs the 3-way merge against its live data **and its own stored baseline**, applies the result, and persists the new baseline. The baseline lives with the data it's merged against.
- **The disk-sync IDB record splits, which needs a `SCHEMA_VERSION` bump.** Today one record (`sync_<dbKey | __merged__>`) bundles the non-transferable `FileSystemFileHandle` with the My Edits baseline. The handle must stay main-side (permission requests need a document gesture); the baseline moves worker-side. So the record splits in two — a main-written handle record and a worker-written baseline record. Per [`../migration.md`](../migration.md), this requires bumping `SCHEMA_VERSION`, registering a `MIGRATIONS` step that rewrites each old combined record into the two new ones, and a frozen before→after fixture — and it is the change that builds the **first IDB-record migration adapter** (today's runner transforms only the localStorage settings blob, and `migration.md`'s standing "disk sync needs no migration" note must be updated when this lands). The baseline is deliberately **not** special-cased to "small enough to keep on main" — uniform ownership (data + baseline in the worker) is worth the one-time migration. This touches real stored user data, so the fixture wants human eyes before it commits.
- **Per-source serialize on the worker.** The merged serialize (`serializeFor` for `MERGED_ID`) already runs worker-side; a per-source `serializeFor { sourceId }` for individual-wordlist download and the one-way output mirror completes the picture.

## Optional further win (not committed)

Because the worker can re-read wordlist text from IndexedDB itself, it *could* drop the resident raw entries and re-parse from text only when rescore rules change (the one time raw is needed). That trades a re-parse on rule edits for one fewer big resident copy — a memory-vs-recompute call. The current design keeps raw entries resident; revisit only if worker memory becomes a measured problem.

## Out of scope — and why

- **SharedArrayBuffer / shared-memory rendering.** It would allow synchronous reads of the corpus from main — no async scroller, no placeholders, dissolving the windowing complexity entirely — but `SharedArrayBuffer` needs COOP/COEP cross-origin-isolation headers that **GitHub Pages cannot set** (a `coi-serviceworker` hack exists but is fragile), and a mutable shared corpus needs hand-rolled `Atomics` locking (`Atomics.wait` is forbidden on the main thread). Set aside in favor of the portable message-passing model. Recorded so the reasoning survives if the host ever changes.
- **Multiple workers** (e.g. a dedicated data worker). A second worker would need the corpus resident too — separate address space, so *more* memory, not less — unless shared memory, which is out per the above. Single worker only.
- **Fetch content-diff.** The fetch/import path reprocesses an unchanged wordlist end to end; a content-diff (compare fetched text to stored, reparse only what changed) would turn a one-entry update near-instant. Orthogonal to the thread move (it would help on any architecture) and independently shippable; flagged so it isn't lost. With the data tier shipped, fetch/import is "responsive but reprocesses everything"; the content-diff is the difference between that and "near-instant."
