# Per-row reactive virtual scroller

**Status.** Speculative future direction. The hybrid reactivity model that ships today (see [`../design.md`](../design.md#reactivity)) handles state and view dispatch reactively but keeps the virtual scroller imperative — `_render()` redraws the full visible window on any cache change. This plan covers what it would take to push reactivity all the way through to per-row rendering, and the prerequisite of swapping the hand-rolled signals primitive for a vendored library.

## Motivation

Two related architectural simplifications:

- **Drop the bridge layer.** Today's hybrid uses `cacheVersion$` to bridge imperative caches to the reactive view. With reactive collections (`_mergedWordlistCache.byWord` as an observable Map, per-wordlist `_overrideMap` as the same), consumers subscribe at the key level and the bridge disappears.
- **Per-cell update granularity.** A score edit re-renders one cell instead of the visible window. Today's window redraw is sub-millisecond, so the user-felt win is small — but the rendering pipeline ends up on one consistent abstraction.

This is an architectural cleanup, not a perf fix. Worth doing when the hybrid starts straining (more derived caches, more views), or when an actual feature pulls in the same direction.

## Why hand-rolled fine-grained doesn't work

The current hybrid's hand-rolled signals primitive is ~50 lines. Pushing further into fine-grained collections needs:

- Per-key subscription tracking with lazy creation (otherwise `keySubs` grows to the data size).
- Per-effect cleanup on re-runs (otherwise effects accumulate stale subscriptions and leak).
- Reentrant write detection (a signal write inside an effect, ordering of re-runs).
- Batching across signals beyond the simple `batchUpdate` we have.
- Cyclic dependency handling.

These are the things production signal libraries spent years getting right. Hand-rolling produces subtle bugs that surface late.

## Inline a vendored library

MIT-licensed reactivity libraries can be inlined into `site/index.html` as a vendored block, preserving grawlix's "no build step, no npm" property:

- **`@preact/signals-core`** — ~1.5 KB minified+gzipped. `signal`, `computed`, `effect`, `batch`. Simplest API surface; closest to the hand-rolled primitive in shape.
- **Solid** standalone reactive primitives — similar size. Includes `createStore` for fine-grained collection observation, which is what makes per-key subscription on `_mergedWordlistCache.byWord` natural.
- **`@vue/reactivity`** — Vue's reactivity primitives standalone. Slightly larger; uses Proxy-based deep observation, which makes "just mutate the entry object" work without explicit `set` calls.

License compliance is mechanical: paste the upstream banner comment plus the minified IIFE at the top of the script section, expose the few names used. MIT only requires preserving the copyright notice; nothing about the file structure or distribution channel.

For grawlix's use, Solid's `createStore` is the most natural fit — its fine-grained reactivity model maps cleanly to the existing patch protocol (`patchCachesForEditsChange` becomes mutations on a reactive store; consumers subscribe to specific keys). Preact signals is the smallest and simplest if collection-level fine-grained isn't critical.

## What changes

- **Replace the hand-rolled signals primitive** with the inlined library's. Mostly mechanical — the API is similar (`signal()`, `effect()`). Drops ~50 lines of hand-rolled code, adds ~1.5 KB of vendored library.
- **Replace imperative caches with reactive collections.** `_mergedWordlistCache.byWord` becomes an observable Map. `_overrideMap` per wordlist becomes the same. `patchCachesForEditsChange` mutates them; consumers subscribe at the key level. The `cacheVersion$` bridge signal goes away.
- **Rewrite the virtual scroller as per-row reactive components.** Each visible row is a small effect that subscribes to its specific entry. Row mount/unmount lifecycle as rows enter and leave the viewport; framework cleanup tracking handles subscription release.
- **`refreshDerivedDisplays` and `repaintAfterCacheChange` go away.** The render effects fire automatically on collection mutations.
- **Helpers shrink to signal sets.** `setWordlistEnabled` becomes `wl.enabled$.set(value)` with no manual repaint dispatch — the relevant effects subscribe to `enabled$` directly.

## Performance tradeoffs

- **Point edits**: ~50× cheaper. A score edit re-renders one cell instead of the visible window. Today's window redraw is sub-millisecond, so this is "imperceptibly fast" → "imperceptibly faster" — not user-felt.
- **Scroll**: probably regression vs. today, possibly noticeable. Current `_render()` reads `entries[start..end]` and bulk-writes innerHTML — a tight loop with no framework overhead. Per-row reactive mounts new row components as they enter the viewport, each carrying subscription tracking. Modern frameworks handle this at 60fps with care; the question is implementation quality, not theoretical limit.
- **Initial render after wordlist switch**: probably regression. ~50 component mounts vs. one bulk write. Solid's compile-time optimizations help but we'd be running it without compilation (vendored runtime only).
- **Memory**: +50–100 KB for active subscription sets. Negligible against wordlist data sizes.

## Code size

Plausibly neutral or slight savings.

- Adds: ~1.5 KB inlined library.
- Subtracts: hand-rolled signals primitive (~50 lines, ~1 KB), `cacheVersion$` plumbing, `refreshDerivedDisplays`, `repaintAfterCacheChange`, parts of `repaintVisibleRows`.
- Virtual scroller decomposition could go either way — currently ~470 lines of imperative DOM management; reactive equivalent might be ~300–400 if elegant, ~500+ if it accumulates row-lifecycle ceremony.

## Why we haven't done it

- The hybrid works. Performance is good. No user-felt regression.
- The decision blocker is "willing to inline a third-party library?" — once that's yes, the path opens. Today's grawlix has zero external code; preserving that is a cultural choice, not a technical one.
- The architectural cleanup is real but the user-felt value is small. Better invested when an actual feature pulls in the same direction (e.g., per-tool projections of the merged wordlist that need their own reactive views, or row-level interactions that strain the bulk-redraw model).

## When to revisit

- If the renderer accumulates more responsibilities (per-row hover popovers beyond the current ones, drag-to-reorder rows, per-row editing of multiple fields) that strain the imperative shape.
- If a future feature wants reactive views of cached state that don't fit the current `cacheVersion$ → render effect` dispatcher cleanly. The tool gallery and lookup integrations from [`tools.md`](tools.md) and [`lookup.md`](lookup.md) are candidates.
- If a contributor wants to take it on as a focused refactor and the no-dependency cultural choice is open for discussion.

## Distillation

When this ships, fold the present-tense description into [`../design.md`](../design.md) — replace the "imperative caches + `cacheVersion$` bridge" portion of § Reactivity with "reactive collections + per-row effects." The hand-rolled signals primitive section gets replaced by a brief note about the vendored library and where its banner lives.
