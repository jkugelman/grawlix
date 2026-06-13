# Shared-memory rendering — a synchronous corpus on the main thread

A possible future alternative to the message-passing data tier ([`design.md` § Cooperative runtime](../design.md)). Not being pursued; recorded so the appeal and the blockers survive intact if the hosting situation ever changes.

## The idea

Put the corpus in a `SharedArrayBuffer` that the worker writes and the main thread reads. Main reads entries synchronously, straight out of shared memory, instead of asking the worker for windows of rows over `postMessage`.

## What it would buy

The entire windowing layer exists only because main can't read the worker's corpus synchronously — so it fetches windows asynchronously, paints skeleton placeholders on a miss, and caches what it has. A synchronous shared corpus dissolves all of that at once:

- No `fetchRows` / `fetchGroups` / `fetchGroupChains` round-trips, no first-window-inline payloads on the result, no `_winCache` / `_groupWinCache`, no skeleton rows.
- The scroller renders directly from the shared corpus by index — the way it did when main owned the corpus itself, but without main holding a second copy.
- Most of the flat and grouped render-windowing code in the entries table goes away.

So it isn't a performance tweak; it's a *simpler* architecture that gets the memory win (one copy, in the worker's buffer) and synchronous rendering together.

## Why it's set aside

Three blockers, in increasing order of how fundamental they are:

1. **Cross-origin isolation headers.** `SharedArrayBuffer` is only available in a cross-origin-isolated context, which requires the server to send `COOP: same-origin` and `COEP: require-corp` response headers. **GitHub Pages cannot set response headers.** A `coi-serviceworker` shim (a service worker that re-fetches resources and injects the headers) exists, but it's fragile: it inserts a service worker into the page lifecycle, races on first load (the worker isn't controlling the page until the second visit), and interacts awkwardly with caching. Moving to a host that can set headers removes this blocker.

2. **Synchronization.** A corpus the worker mutates while main reads needs hand-rolled coordination. `Atomics` provides the primitives, but `Atomics.wait` is forbidden on the main thread (it must never block the UI), so main can't take a blocking lock — the scheme has to be lock-free or wait-free on the read side, or fall back to a `postMessage` signal for "a write is in progress," which partly re-introduces the round-trips it set out to remove.

3. **The corpus is an object graph, not bytes.** This is the deepest one. A `SharedArrayBuffer` holds raw bytes; the corpus is a graph of JS objects — entries with `norm`/`display`/`score`/`comment`, `byNorm` / `byKey` maps, chains that reference entry objects. None of that lives in shared memory as-is. It would have to be re-expressed as a columnar binary layout over typed arrays: interned strings for the text, integer offsets instead of object references, a hand-built hash index instead of a `Map`. That's a substantial rewrite of the corpus representation — plausibly more work than the windowing it replaces — and it pushes complexity *into* the data structures even as it removes it from the render path.

## What would have to be true to pursue it

- A host that can set COOP/COEP (off GitHub Pages, or accepting the `coi-serviceworker` fragility).
- A binary, typed-array corpus layout with interned strings and integer-indexed references.
- A read-side synchronization scheme that never blocks the main thread.

Until those hold, the portable message-passing model — the worker owns the corpus, main is a thin async view — is the right call: it works on any static host, needs no special headers, and keeps the corpus as ordinary JS objects.
