# Breaking up the monolith — a real file structure

Grawlix is one file: `site/index.html` holds the `<style>` block, the app-shell HTML, and ~10,500 lines of JavaScript in a single `<script>`. The single-file form was a self-imposed constraint kept for aesthetic reasons more than technical ones, and it has started to cost more than it returns. Two concrete efforts have run into it:

- **The unit-test tier** can't `import` anything, because there's nothing to import from — the code is trapped inside an HTML file. It works around this by fencing pure functions with `// #region nodetest:` markers and slicing them out of the source string with a `vm` + string-indexing harness ([`tests/unit/support/extract.mjs`](../../tests/unit/support/extract.mjs)). It works, but it's a contraption: the test tier reaches into the source text instead of calling exports.
- **The web-worker plan** ([`web-workers.md`](web-workers.md)) needs the pipeline executor as a DOM-free island the worker can load. With everything in one HTML file, the plan resorts to a dedicated `<script id="pipeline-core">` block whose `.textContent` is read at boot, wrapped in a worker epilogue, and spun up from a `Blob` URL — a workaround whose entire job is to recover "a module the worker can import" from a file that has no modules.

Both pain points have the same root cause and the same fix: **real ES modules in real files.** This doc plans the split — not a mechanical pluck-and-drop of the existing banner sections, but a layered reorganization that also relocates the code that drifted away from its relatives during years of LLM-assisted edits.

## The constraint was already softer than it looked

The instinct is that splitting the file means giving up "no build step, runs directly in the browser." On inspection, that property is mostly mythology:

- **There is already a build step.** Deploy runs `npm run build` ([`scripts/build.mjs`](../../scripts/build.mjs)), which minifies `site/index.html` into `dist/` via `html-minifier-terser` (including `minifyJS`, i.e. terser over the inline script).
- **The app is always served over HTTP.** The Playwright suite runs against `python3 -m http.server` on `site/` ([`playwright.config.js`](../../playwright.config.js) — the `webServer` block), and GitHub Pages serves `dist/` over HTTP. Nothing depends on opening `index.html` from `file://`.

That last fact is the whole game. ES modules are blocked over `file://` by CORS but load fine over `http://` — and Grawlix is already behind an HTTP server everywhere it runs. So moving to ES modules costs nothing on the harness side, and it dissolves both pain points directly:

- **Unit tests** become `import { toNorm } from '../../src/engine/norm.js'`. The entire `extract.mjs` harness and every `// #region nodetest:` marker get deleted.
- **The worker** becomes `new Worker(url, { type: 'module' })`, and the worker `import`s the engine modules. The `<script id="pipeline-core">` block, the `.textContent` read, the epilogue concatenation, the `Blob` URL — all gone. The web-worker plan gets *simpler* once this lands.

## Build toolchain: native modules in dev, esbuild bundle at deploy

The shipped artifact and the dev artifact are deliberately different things, and the split is what keeps local development trivially simple.

**Dev (`site/`): plain static files, no tooling.** The source is authored as native ES modules. A native module is just a `.js` file the browser fetches and interprets itself — there is nothing to compile. Any static server (`python3 -m http.server` on port 8000, as today) serves the tree verbatim; the browser walks the `import` graph on its own. Edit a file, refresh, done. **No build step, no watch process, no bundler in the local loop** — the dev server stays a dumb static file server, exactly as now. This is a hard requirement: local development must remain "serve `site/` and hit `http://localhost:8000/`."

**Deploy (`dist/`): one bundled, minified file.** `npm run build` runs **esbuild** — a single small, fast, near-zero-config dependency — which starts at `src/main.js`, follows every `import`, and emits one tree-shaken, minified bundle. The HTML shell is minified as today. esbuild touches `dist/` only; it never goes near `site/`.

### What "bundling" is, and why only at deploy

A bundler does ahead-of-time, on the build machine, the work the browser would otherwise do at load: starting from the entry module, follow every `import`, and concatenate all the modules into one self-contained file with the imports rewritten away. It also minifies (strip comments/whitespace, shorten local names) and tree-shakes (drop exports nothing imports). Bundling is behavior-preserving — concatenation, renaming, dead-code removal — never a semantic change.

The reason to bundle at all is load performance: unbundled, a cold load waterfalls through dozens of small HTTP requests following the dependency graph, none of them minified. Bundled, it's one cacheable request. The reason to do it *only at deploy* is that dev doesn't care about that cost and benefits from the directness of editing the real files the browser runs.

### The dev/prod seam, and why it's safe

Dev serves the unbundled module graph; prod serves the bundle. Because bundling is behavior-preserving this rarely bites — and the seam is already continuously verified: [`playwright.config.js`](../../playwright.config.js) parameterizes the served directory via `GRAWLIX_SITE_DIR`, so CI runs the full suite against the bundled `dist/` while local runs hit `site/`. The divergence is tested, not trusted.

### Alternatives rejected

- **No bundler (ship the raw module graph).** Simplest in principle, but the unbundled waterfall is slow on cold load, and the files would ship unminified unless a per-file JS minifier is added anyway — and today's minifier only touches inline HTML script, not separate `.js` files. So "no bundler" doesn't actually avoid adding a JS tool; it just gives up the single-file payload while keeping most of the work.
- **Vite (or any dev-server bundler).** In dev, Vite is not a static file server — it transforms files on the fly as the browser requests them, so the dev workflow becomes "run `vite`," not "serve static files." That collides head-on with the static-serve requirement. It's the right tool for an app that wants HMR and a framework; it's overkill here.

## The file tree

`src/`, organized by **dependency layer** — imports flow strictly downward, lower layers never import upper ones. This is finer-grained than the current banner sections on purpose: it makes the worker boundary and the test imports crisp, and it gives the misplaced code an obvious home.

```
site/
  index.html              # shell: head FOUC script, <link> css, <script type=module src=src/main.js>
  css/
    theme.css             # CSS-variable palettes (:root, dark-mode, light-mode), kept table-aligned
    app.css               # everything else (split further if it helps: shell / table / dialogs / tools)
  src/
    main.js               # boot entry — imports everything, runs the mount() sequence (see below)
    core/                 # ── leaf utilities, no app dependencies ──
      constants.js        # LS_PREFIX, MERGED_ID/MERGED_NAME, palettes, WORDLIST_PUBLISHERS, DEFAULT_SCORING
      platform.js         # BROWSER, isMobile, _hoverCapable (relocated out of "Components")
      signals.js          # signal / effect / batchUpdate
      util.js             # esc, pluralize, plural, timeAgo, nameFromPath
    engine/               # ── PURE, DOM-free, worker-ready ──
      norm.js             # toNorm, stripAccents, FOLD_MAP/FOLD_RE, buildNormToDisplay, projectRangesToDisplay, parse*
      range.js            # parseRange, matchesRange, rangeSpan — shared by executor and rescoring
      search.js           # buildSearchPattern, searchRangesFor, renderHighlightedText, isLiteralQuery
      regex.js            # analyzeRegexPattern, runRegexReplace, parseReplacement, …
      segmenter.js        # unigram corpus: state + decode + segmenter + loadUnigramCorpus(IO injected at boot); exports corpus mutators (used by checkForUpdates AND the Test API) + invalidate
      tools.js            # TOOLS catalog, TOOL_CATEGORIES, FEATURED_TOOLS, makeToolRow, shape predicates, groupColumnCSS() (pure)
      executor.js         # executePipeline, runToolStage, bucketize, unify, makeYielder, rowLastEntry; owns _preSearchCache + its invalidator
      stats.js            # computeStatsRaw, computeStats (pure cores); exports invalidateStatsCache
      histogram.js        # getHistogramLayout (owns _layoutCache), bucketCounts, slotIntersectsRange (pure cores); exports invalidateHistogramLayout
      worker.js           # message loop importing the above  (future — web-workers.md)
    data/                 # ── state, persistence, and everything derived from state (below presentation) ──
      state.js            # state, sources$, cacheVersion$, the reactive plumbing
      storage.js          # Storage facade, IDB (openDB/idbGet/idbSet), localStorage (lsLoad/lsSave)
      migrations.js       # SCHEMA_VERSION, MIGRATIONS, the migration runner
      persist.js          # persistMeta, batchUpdate, the setWordlistX mutators, reorderSources
      rescoring.js        # compile/apply/rescoreEntry/getRescoredEntries (+per-wordlist _rescored caches), dirty, propagation, auto-seed; editsLegend/getWordlistDefaultRules (read state.scoring — data, NOT model)
      merge.js            # buildMergedWordlist, buildScopedCorpus, getActiveCorpus, patchMergedForNorms — OWNS the merged/scoped/count caches
      derived.js          # allSourcesScores, scopedHistogramLayout, allSourcesHistogramLayout — state-reading wrappers that CALL engine/stats+histogram (the caches stay in engine; derived holds none)
      invalidate.js       # invalidateWordlistCaches — composes the per-layer invalidators downward (see § The invalidation graph)
      disk-sync.js        # sync targets/status, MirrorSync; notifies UI via callback/signal, never imports dialogs
      publishers.js       # getPublisher (relocated next to its WORDLIST_PUBLISHERS data)
    model/                # ── thin domain layer above data, below ui ──
      scoring.js          # tier-label logic ONLY: makeTierLookup, updateScoringDirty, propagateDefaults, makeScoringRowStub, scoringRulesEqual (the scoring-tier CRUD/UI lives in ui/rescore-editor.js)
      score-display.js    # scoreColor (reads derived → state-coupled), SCORE_COLOR_STOPS, buildScoreBadgeHTML, buildScoreCellHTML
    ui/                   # ── components, scrollers, dialogs, rendering ──
      components.js       # generic builders (segctrl, clearable/text input, param, help), PopupHelp, Collapsible, makeReorderable
      icons.js            # buildIconHTML family (relocated out of "Wordlist icons" at the file's end)
      toasts.js           # the toast system (relocated out of "Utility")
      dialogs/
        dialog.js         # createDialog / showDialog factory
        confirm.js        # showConfirm / showAlert / showMergeConflict + the edits-conflict dialog
        settings.js  welcome.js  sync.js  configure-wordlist.js  import-guide.js  update-summary.js
      app-view.js  scope-selector.js  manage-panel.js  discovery-banner.js
      tool-stack.js       # ToolStack + ToolPicker UI + group-column <style> injection (relocated out of "Pipeline runtime")
      entries-table.js    # BaseVirtualScroller, EntriesScroller, GroupMorePopover, AtomPopover, ErrorPopover
      rescore-editor.js   # rule-management UI + handlers for BOTH rescore rules and scoring tiers (renderScoringRules, saveScoringField, addScoringRow, deleteScoringRow, applyScoringChange, alongside their rescore-rule twins)
      histogram-view.js   # histogram rendering + pointer interaction
      rendering.js        # renderAll, setupRenderEffect, the render/cosmetic effects, publishBarHeights, renderMergedDetail
      sync-indicators.js  # renderSyncIndicators + severity helpers (relocated out of "Components")
    app/                  # ── orchestration ──
      router.js           # URL state
      actions.js          # WordlistActions dispatcher + fetch/import/update, my-edits add/delete, merge & download, export, rename
    test-api.js           # window.__grawlixTest = {…}; imported LAST by main.js (see § The Test API)
```

The split folds in the misplacements the audit surfaced — this is the "ambitious, not mechanical" part. The notable relocations:

| Code | Lives today in | Moves to | Why |
|---|---|---|---|
| `ToolStack` / `ToolPicker` (~570 lines of UI) | "Pipeline runtime" | `ui/tool-stack.js` | It's the tool-stack *UI*, mis-filed under pipeline *execution*; the cleanest worker-boundary cut |
| Scoring / rescoring logic | scattered across 5 sections (Rescoring, Scoring tier labels, Score colors, Rescore rule management, Mutation helpers) | `engine/range.js` (pure primitives) + `data/rescoring.js` (per-wordlist transform, consumed by merge) + `model/scoring.js` + `model/score-display.js` + `ui/rescore-editor.js` (the shared rule editor) | One tangled domain split by layer; rescoring sits in `data/` next to merge, *not* above it — see § Breaking the cycles |
| Toast system | "Utility" | `ui/toasts.js` | A lifecycle DOM component hiding in a catch-all |
| `buildScoreBadgeHTML` / `buildScoreCellHTML` | "Components" | `model/score-display.js` | Score rendering, belongs next to `scoreColor` |
| Severity helpers (`maxSeverity`, `wordlistSeverity`, `syncSignHTML`, …) | "Components" | `ui/sync-indicators.js` | Sync-status domain logic, not generic builders |
| `BROWSER` / `isMobile` | "Components" | `core/platform.js` | Platform detection, not a component |
| Icon builders | "Wordlist icons" (file's end) | `ui/icons.js` | Pure `buildXxxHTML` builders, belong with components |
| `getPublisher` | "Publisher lookup" (file's end) | `data/publishers.js` | A 2-line function ~9,000 lines from its `WORDLIST_PUBLISHERS` data |
| `rowLastEntry` | "Virtual Scroller" | `engine/executor.js` | The executor needs it; the scroller is the wrong home |
| `updateScoringDirty` / `propagateDefaults` / `makeScoringRowStub` | "Rescoring" | `model/scoring.js` | Tier-label concerns filed under rescoring |
| The edits-conflict dialog | unbannered, buried in Disk sync | `ui/dialogs/confirm.js` | A merge-conflict dialog ~6,500 lines from its sibling `showMergeConflict` |

## The linchpin: side-effect-free imports

The single hard problem in module-izing this code is **import-time side effects**, and getting it right is the prerequisite for everything else.

Today many things do real work *at the moment the script is evaluated*. Under one shared scope this is fine because nothing runs until `init()` at the bottom; under ES modules every top-level statement runs *at import*, in dependency-graph order, so each of these becomes a fragile ordering constraint or a temporal-dead-zone error (a module using a binding from a module that hasn't finished evaluating). The full inventory the carve must neutralize:

- **Dialog singletons** (`SettingsDialog`, `ManagePanel`, `WelcomeDialog`, the confirm/alert/sync dialogs) build their DOM in their constructing IIFE.
- **`WelcomeDialog` and `ManagePanel` register live `effect()`s** at construction that read `state` and call `buildMergedWordlist` — the riskiest, since they run app logic at import.
- **The `MERGED_ICON = buildEmojiIconHTML('⭐')` landmine** in Constants *executes* a UI-layer function during constant init, inverting the dependency direction (core → ui).
- **The group-column `<style>` IIFE** inside the `TOOLS` catalog does `document.head.appendChild` at eval — *physically inside the module bound for worker-loaded `engine/tools.js`*, so it's both an import-time side effect and a DOM access in a worker module. It would throw `document is not defined` the instant a worker imports the catalog.
- **Bare top-level delegated listeners** — the clearable-input `document.addEventListener('input'/'click')` handlers and `Collapsible`'s document listener attach at eval, and they live in no mountable singleton.

To be precise about the rule, since "importing does nothing else" is stated absolutely: the bar is *no DOM, no effect registration, no cross-layer reach* at import — not "no top-level statements." Pure, idempotent top-level computation is fine and stays put. The two `for` loops that backfill default `key`s on the `TOOLS` params/columns run at import of `engine/tools.js`, touch nothing outside the module, and survive as-is.

The fix is also just better architecture, and it was independently agreed before this doc: **importing a module defines things and does nothing else.** Every one of the above moves into an explicit `mount()` (or `mountX()` for the bare listeners) called in a deliberate order from `src/main.js` at boot — which is essentially what `init()` already orchestrates; we make it total. The group-column CSS splits: a pure `groupColumnCSS()` builder stays in `engine/tools.js`, and the `appendChild` becomes a one-liner in `ui/tool-stack.js`'s mount. `MERGED_ICON` becomes lazy (a getter or a call at use-site). Once imports are side-effect-free, import order stops being a correctness concern — it's just whatever the dependency graph implies, and the worker can import `engine/tools.js` without a DOM.

This deferral is its own early step in the sequencing, landed and verified before any large code movement.

## Breaking the cycles, and the layering that actually holds

The current single scope hides several couplings that become illegal `import` loops once the layers are real modules. The non-obvious one — caught only on review — reshapes the layering, so it comes first.

**`merge → rescore` forces rescoring *down* into `data/`, not up into `model/`.** The tempting split is "merge is data, rescoring is domain logic, so rescoring is `model/` above data." That inverts the real dependency: `buildMergedWordlist` *consumes* rescored entries (`getRescoredEntries`/`getRescoredByNorm`) to bucket contributors. Merge depends on rescore, so if merge is `data/` and rescore is `model/` (data < model), `data/` imports upward — the exact loop we're trying to kill. **Resolution:** rescoring is a per-wordlist transform over `rawEntries` (using `engine/range.js`'s pure `parseRange`/`matchesRange`/`rangeSpan`) with per-wordlist `_rescored` caches — it *is* derived-from-state data. It lives in `data/rescoring.js`, *below* `data/merge.js` in intra-layer order. `model/` shrinks to what genuinely sits above the data layer: tier labels (`scoring.js`) and the state-coupled display helpers (`score-display.js`). The governing principle is cleaner stated outright: **`data/` is state plus everything derived from it (rescore, merge, stats-over-state); `model/` is the thin band of user-facing config and display logic above it.** Nothing in `data/` imports `model/`.

Two helpers straddle the seam *in appearance only*, and the doc places them deliberately to keep the rule above true: `editsLegend` and `getWordlistDefaultRules` (consulted by rescore-rule dirty-tracking, reset, propagation, and `reconcileEditsRulesAfterImport`) read `state.scoring` and `getPublisher` — both `data/`. They live in `data/rescoring.js`. Filing them in `model/scoring.js` *because* they touch tier labels would be the trap: `data/rescoring.js` already imports them, so a `model/` home makes data import model — the exact upward edge this section exists to prevent. "Reads `state.scoring`" decides the layer, not "is about scoring."

**The stats/histogram derived wrappers are state-coupled and need an explicit home.** The pure cores (`computeStatsRaw`, `getHistogramLayout`, `bucketCounts`) are `engine/`. But the wrappers that feed them — `allSourcesScores`, `scopedHistogramLayout`, `allSourcesHistogramLayout` — read global `state` and call `getActiveCorpus`, and `scoreColor` transitively depends on them. These are *not* pure, so they can't sit in `engine/` alongside the cores they wrap. They live in `data/derived.js` (above merge, reading state); `model/score-display.js`'s `scoreColor` imports them downward. So `score-display.js` is explicitly state-coupled, not a pure builder — the doc names it as such rather than pretending otherwise. Crucially, `data/derived.js` holds *no cache of its own*: the layout cache `_layoutCache` belongs to `engine/histogram.js`'s `getHistogramLayout` (which `invalidateHistogramLayout` clears), and `_statsCache` to `engine/stats.js`. `data/derived.js` only *calls* `getHistogramLayout(source, key)` / `computeStats` and threads the cache key — the caches stay in the engine cores they key.

**`data ⇄ ui`.** Disk sync calls `showAlert` and `renderSyncIndicators` (ui) directly, while `SyncDialog` (ui) reads `syncTargets`/`syncStatus` and triggers attach/detach (data). **Resolution:** the data layer never imports dialogs. The `showAlert` calls already live in the attach/detach *action-orchestration* functions, which belong in `app/actions.js` (`app/` legally imports `ui/`), so those are fine where they sit. The edge to break is the low-level one: `SyncStatus.set/clear` calling `renderSyncIndicators` directly. That's a *targeted* indicator repaint, so it routes through a **dedicated sync-status signal** the indicators subscribe to — deliberately *not* `cacheVersion$`, which drives the full-table repaint and would be a sledgehammer for a status-dot change. Data bumps the sync signal; ui subscribes. The dependency is then one-directional: ui → data.

### The invalidation graph

The genuine cache knot is not "caches declared in Stats, written in merge" — it's `invalidateWordlistCaches`, a single function that today fans out across caches owned by several modules: per-wordlist `_rescored` (data/rescoring), `_mergedWordlistCache`/`_scopedWordlistCache` (data/merge), `_statsCache` (engine/stats), `_preSearchCache` (engine/executor), and `_layoutCache` (engine/histogram). Under modules this can't be one function reaching across everything. **Resolution:** each owning module exports its own narrow invalidator — `engine/executor.js` → `invalidatePreSearchCache`, `engine/stats.js` → `invalidateStatsCache`, `engine/histogram.js` → `invalidateHistogramLayout`, `data/rescoring.js` and `data/merge.js` their own. A single `data/invalidate.js` imports all of them **downward** (data may import engine; engine imports nothing upward) and composes `invalidateWordlistCaches`. UI and mutation callers import the composed invalidator from `data/`. This makes the fan-out a legal one-directional graph instead of a hidden god-function.

One residual coupling to note rather than hide: `data/merge.js`'s `patchMergedForNorms` splices `cache._initialChains`, a field that `engine/executor.js` (`buildInitialChains`) creates and reads. The merged cache object is a shared data structure owned by `data/merge.js`; `_initialChains` is the executor's seed-chain view attached to it. Data mutating an engine-shaped field on a data-owned object is acceptable, but the ownership (data owns the object, engine defines the field's shape) should be commented at both sites so the contract is explicit.

## The pure engine and the worker boundary

The `engine/` layer is the DOM-free island the web-worker plan needs. "DOM-free" is the precise claim, and it holds: the executor (`executePipeline`, `runToolStage`, `bucketize`, `unify`), the tool catalog's `run`/`prepare`/`group` functions, `toNorm`, `buildSearchPattern`, the regex helpers, and the phrase segmenter touch no `document`, `window`, `localStorage`, or `navigator`. (The `state` referenced inside `executePipeline` is a *local* shadow variable, not the global — verified; not a coupling.) `makeYielder` uses `scheduler.yield`/`setTimeout`/`performance.now`, all of which exist in worker scope.

"DOM-free" is not the same as "stateless," and the distinction matters: `engine/` owns mutable module-level caches — `_preSearchCache` (executor), the unigram frequency maps (segmenter), `_statsCache` (stats). These are worker-safe (a worker has its own copy), but they're real state, which is why each engine module exports its own invalidator into the graph above.

A handful of functions straddle the DOM line and get split during the carve:

- **`loadUnigramCorpus`** mixes pure decode (`gunzip`/`msgpackDecode`/`buildCorpusFromMsgpack`) with I/O. `fetch` and IDB are both worker-safe; only the `localStorage` size-note isn't. **The whole loader stays in `engine/segmenter.js`**, but with its I/O *injected*: it takes an `{ idbGet, idbPut, onSize }` bundle so it never imports `data/storage.js` (which would be an engine→data upward edge). On the main thread, boot injects `data/storage`'s IDB primitives and an `onSize` that updates the localStorage note; in the worker, the host injects worker-native IDB and a no-op `onSize`. This keeps the segmenter self-contained — the phrase tool's `prepare` calls the segmenter's own loader, an engine-internal call, not a reach into `data/`. The loader must *not* live in `data/`: the phrase tool would then import it from there, and since the tool catalog is `engine/`, that's an engine→data upward edge — the precise loop the injection avoids. The injection is a one-time **boot call** — `segmenter.configureIO({ idbGet, idbPut, onSize })` — that stashes the deps in segmenter module state, and `loadUnigramCorpus` closes over them. It does *not* flow through `ctx`/`prepare`: the executor's `ctx` carries no IDB, so a tool's `prepare` just calls the already-configured loader. (This is also where the corpus mutators the Test API and `checkForUpdates` need — set/reset corpus, read `unigramFetchedSize` — are exported; see § The Test API.)
- **`runPipeline`** mixes the abort/single-flight controller (pure-ish, worker-relevant) with DOM dimming (`panel.classList.add('pipeline-running')`). The DOM dimming stays main-thread.
- The **group-column `<style>` injection** inside the tool catalog is pure key-gathering plus a `document.head.appendChild`. The gathering becomes a pure `groupColumnCSS()` export in `engine/tools.js`; the injection moves to `ui/tool-stack.js`'s mount (see § The linchpin — it's also an import-time side effect).
- **`buildHelpHTML`** is referenced at tool-catalog evaluation time but lives in the UI layer. It's a pure string builder, so either it moves to `core/util.js` or the tools' `help` fields become lazy — the worker never renders help, so it shouldn't drag a UI dependency into `engine/`.

This carve is worthwhile on its own merits (a clean pure core is easier to test and reason about) and is the concrete prerequisite that lets [`web-workers.md`](web-workers.md) delete its single-file workarounds.

## The Test API

`window.__grawlixTest` (the bottom of today's file) is the single largest cross-layer surface in the codebase: it exposes ~40 internal bindings spanning every layer — `addNewWordlist`, `applyWordlistText`, `setWordlistRescoreRules`, `buildMergedWordlist`, `getActiveCorpus`, `toNorm`, `TOOLS`, `ToolStack`, `renderMergedDetail`, `threeWayMergeEdits`, `attachMirrorSync`, and more — and the Playwright suite drives the app almost entirely through it. It needs deliberate handling, not an afterthought:

- It lives in its own `src/test-api.js`, imported **last** by `main.js` — it's the one module allowed to import from every layer (engine, data, model, ui, app) to assemble the object.
- `window.__grawlixTest = {…}` stays a real `window` global assignment. That survives bundling untouched, and Playwright reaching it via `page.evaluate(() => window.__grawlixTest…)` is unaffected by module scoping (it's a window property, not a lexical binding). Same goes for the suite's `addInitScript` monkeypatching of `window.showSaveFilePicker`/`showOpenFilePicker`/`matchMedia` — those are genuine browser-global properties the app already reads off `window`, so module-scoping doesn't touch them.
- The catch: the Test API **directly mutates engine module-level `let`s** today (`unigramLogFreqs`, `unigramMinLogFreq`, `unigramLoadPromise`) to stub the corpus, and a module can't reassign another module's binding from outside. So `engine/segmenter.js` must export explicit corpus mutators — a setter for the stub, a reset, and an accessor for `unigramFetchedSize`. This is **not** a test-only concern: the production `checkForUpdates` path (`app/actions.js`) *also* nulls `unigramLogFreqs`/`unigramLoadPromise` and reads `unigramFetchedSize` to force a corpus re-fetch. So these mutators are part of the segmenter's normal API, shared by `checkForUpdates` and the Test API alike — the one spot where modularization turns an implicit cross-binding poke into a named seam rather than a pure move.
- Keeping `__grawlixTest` exposed unconditionally also means the bundle ships these internals as reachable — fine (it's the status quo, and the suite needs the production bundle to expose them), just noted.

## CSS

The `<style>` block lifts out into `css/` via `<link>`. At minimum: `theme.css` for the CSS-variable palettes (kept multi-line and table-aligned per [`style.md`](../style.md)) and `app.css` for the rest. Splitting `app.css` further along the obvious seams — shell/layout, entries table, dialogs, tool stack — is fine and encouraged, but lower-stakes than the JS split and carries no module-ordering risk. The deploy minifies CSS as it does today.

## The head FOUC script

The synchronous `<head>` script that sets the dark/light class before first paint must stay a plain inline (non-module) script — module scripts are deferred and would run after first paint, reintroducing the flash. It currently shares `const LS_PREFIX` with the main script as a cross-`<script>` global; under modules the main module has its own scope and can't see it. The fix is trivial: `core/constants.js` declares its own `LS_PREFIX`, and the head script keeps its own copy of the one-line literal. The two are independent by design.

## Sequencing — each step ships green

The Playwright suite runs against the served site, so it is the safety net for every stage. Each step is independently shippable and leaves the app working.

1. **CSS out.** Lift `<style>` into `css/` + `<link>`. Zero JS risk; ships alone.
2. **One-module bootstrap.** Turn the entire current script into a single `src/main.js` loaded as `type="module"`; wire esbuild into `build.mjs`; add an `npm run dev` that serves `site/` statically (same `python3 -m http.server` the tests use); handle the head script's `LS_PREFIX`. This proves "it runs as a module and deploys as a bundle" *before* any code moves — the riskiest unknown, de-risked first. **The `LS_PREFIX` fix must land in this same step, and the step's green bar must include a persistence-exercising test** — module-scoping silently orphans the cross-script global, but `lsLoad`/`lsSave` aren't called at eval, so a bare smoke check would pass while every storage read throws `LS_PREFIX is not defined` at runtime. A load-only check is not enough proof here.
3. **Side-effect-free imports.** Move *all* import-time side effects out into `mount()` functions called from `main.js`: dialog DOM construction, the `WelcomeDialog`/`ManagePanel` effect registration, the group-column `<style>` injection, and the bare clearable-input/`Collapsible` delegated listeners; make `MERGED_ICON` lazy. Still one big module, but now import-time-clean — the prerequisite for splitting (and for a worker ever importing the tool catalog).
4. **Carve `engine/`.** Extract the pure core (norm, range, search, regex, segmenter, tools, executor, stats, histogram). **Prerequisites within this step:** split the group-column CSS into a pure `groupColumnCSS()` (step 3 already moved the injection), and give `engine/segmenter.js` the injected-I/O loader so `engine/tools.js` is a clean leaf rather than reaching into `data/`. Then rewrite the unit tests as direct imports. **Caveat on deleting `extract.mjs`:** verify each `// #region nodetest:` region's symbols are all engine-pure before deleting the harness — some regions (notably the merge ones) deliberately *skip* state-coupled neighbours (see the comment in [`extract.mjs`](../../tests/unit/support/extract.mjs)), so those tests re-home to `data/` imports rather than `engine/`, and a few may need a light test-double for `state`. Delete markers per-region as each region's symbols land in real modules, not in one sweep.
5. **Carve `data/` + `model/`.** Pull rescoring, merge + caches, and the derived stats/histogram wrappers into `data/` (rescoring *below* merge); stand up `data/invalidate.js` composing the per-layer invalidators; route disk-sync notifications through the signal seam — breaking the cycles. `model/` gets the thin scoring/score-display band.
6. **Carve `ui/` + `app/`, then `test-api.js`.** Apply the remaining relocations (dialogs together, toasts out of Utility, icons to components, score rendering to model, tool-stack UI out of pipeline runtime, severity to sync-indicators); finalize the boot/mount order in `main.js`; and split `window.__grawlixTest` into `src/test-api.js` imported last, adding the `engine/segmenter.js` test setters the direct-mutation pokes now require.

## What stays the same

- **Stored data.** This is a pure code reorganization — no `meta`/IDB shape change, so no `SCHEMA_VERSION` bump and no migration. All `localStorage` keys keep their exact `grawlix_` strings; URL keys and tool slugs are untouched. Existing users notice nothing.
- **The data model, caches, reactivity, disk-sync, and merge architecture** — relocated across files, not redesigned. `cacheVersion$` stays the decoupling seam between mutation and repaint; it simply becomes a literal import boundary too.
- **The tool catalog and pipeline semantics** — same shapes, new files.
- **The test surface.** `window.__grawlixTest` stays a `window` global (just assembled in `src/test-api.js`), and the Playwright suite — including its `addInitScript` patching of `window.*` browser APIs — runs unchanged. The only addition is named test setters on `engine/segmenter.js` for the corpus stubs the suite previously poked directly (see § The Test API).
- **The deploy target.** GitHub Pages still serves a `dist/` produced by `npm run build`; the only change is that `build.mjs` now bundles before it minifies.

## Testing impact

- The unit tier converts from region-grep to direct module imports. [`extract.mjs`](../../tests/unit/support/extract.mjs) and all `// #region nodetest:` markers are deleted. The separate in-flight effort to build out that region-marker unit tier is partly obsoleted by this — the *tests* it writes stay valuable; only their extraction mechanism changes, mechanically, from `extract('parsing', […])` to `import`.
- The Playwright suite is unchanged in shape. Its `GRAWLIX_SITE_DIR` indirection keeps doing exactly what it does — `site/` locally, `dist/` in CI — which now also means CI verifies the bundle, dev verifies the module graph.

## Docs to update when this lands

[`CLAUDE.md`](../../CLAUDE.md) and [`style.md`](../style.md) both assert "all code lives in one file" and describe order *inside* the file — both get rewritten for the module layout (with per-file ordering conventions replacing the single-file section order). [`testing.md`](../testing.md) drops the region-marker mechanism. [`web-workers.md`](web-workers.md) loses its single-file workarounds — its "Carving a DOM-free core, delivered single-file" section collapses to "the worker imports `engine/`."

## Open questions and risks

- **esbuild output shape.** One bundle, or a main bundle plus a separately-emitted `engine/worker.js` bundle for the future worker? The worker can't share the main bundle's scope, so when the worker lands it needs its own entry build. esbuild does multiple entry points trivially; flag it now so the build script is structured for two outputs from the start rather than retrofitted.
- **The corpus-loader injection seam, when the worker lands.** This doc keeps `loadUnigramCorpus` in `engine/segmenter.js` with injected I/O, which is clean for the module split today. But the worker world has a second option the web-worker plan floats — build the frequency map on the main thread and *ship* it to the worker rather than have the worker fetch+decode independently. Whether the injected-loader seam or the ship-the-map approach wins is a worker-era decision; the injection seam is chosen now because it's the smaller, worker-agnostic move.
- **Bundle vs. module-graph divergence in practice.** Believed safe (behavior-preserving transform, CI tests the bundle), but the first deploy after step 2 should be eyeballed in a real browser against a local module-graph run to confirm nothing surprising (e.g. an import esbuild tree-shakes that a side effect secretly depended on — which the side-effect-free-imports work in step 3 is precisely meant to prevent).
- **Source maps.** With a bundle, a production stack trace points into minified code. esbuild emits source maps cheaply; decide whether to ship them (they're useful for the rare field bug report and cost only a separate `.map` file GitHub Pages serves on demand).
- **`mount()` ordering is a new explicit contract.** Today the boot order is implicit in `init()`'s call sequence; making it the load-bearing thing means a wrong order surfaces as a runtime error rather than a hoisting non-issue. The order should be derived from the layer graph and commented at the one place it's wired (`main.js`).
- **CSS request count.** Splitting CSS into several `<link>`s adds requests in dev; trivial locally, and the deploy can concatenate them (or esbuild's CSS bundling can) if it ever matters. Not a blocker.
- **Line-number drift.** This doc cites code by section name and symbol rather than line number on purpose: `site/index.html` is being edited concurrently (the unit-test work), so any absolute offsets would already be stale. Re-locate by symbol when executing.

## Related

- [`web-workers.md`](web-workers.md) — the worker plan this unblocks; its single-file `<script id="pipeline-core">` workaround is exactly what real modules replace.
- [`../design.md`](../design.md) — the architecture (caches, reactivity, pipeline, disk sync) that relocates across files without changing shape.
- [`../style.md`](../style.md) — file layout, banner comments, naming; rewritten for the module tree when this lands.
