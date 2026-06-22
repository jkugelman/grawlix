# Grawlix

**Live site:** https://grawlix.wtf (hosted via GitHub Pages)

Grawlix is a browser-based wordlist manager for crossword constructors. Wordlists in the wild are each scored on their own arbitrary scales, making it hard to combine them. Grawlix solves this with per-wordlist rescoring rules that map everything to a common scale, then merges the results into a single unified view. It ships with curated default rules for four popular wordlists so most users get a good experience out of the box, with full customization available for those who want it.

Code lives in ES modules under `site/src/` (`site/index.html` is just the shell; CSS is in `site/css/`). See the *Architecture* section below and [`docs/design.md`](docs/design.md) § *Code structure* for the layout.

`TODO.md` at the repo root is the user's personal scratchpad — never edit it. Reading it is fine but do not touch it.

**Don't smoke-test by running `python -m http.server`.** Serving the module graph locally only verifies that the filesystem can read it, which is theatre. For real verification, syntax-check changed JS modules with `node --check <file>` (the pre-approved `check-syntax.js` is a classic-script parser and can't read ESM), read the diff carefully, and say "I can't visually verify" when that's the truth — visual inspection requires the user's browser. Two test tiers: the Playwright browser suite ([`tests/browser/`](tests/browser/), `npm run test:browser`) covers user-visible behavior; a `node:test` unit tier ([`tests/unit/`](tests/unit/), `npm run test:unit`) covers pure logic by importing the engine/data modules directly. `npm test` runs both (unit, then the browser matrix against the bundled `dist` via `test:dist`). See [`docs/testing.md`](docs/testing.md) for what's covered and what isn't. **The full browser matrix must run against the bundled `dist`, not the raw `site/`** — `npm test` and `npm run test:dist` both do; `npm run test:browser` runs against the unbundled `site/`, which flakes on webkit under the cold-load module waterfall, so use it only for single-browser chromium iteration. **Don't re-run the suite just to recover results you already have** — the last run is saved under `test-results/` (`.last-run.json` for status + failed-test IDs, one folder per failed test). Read those instead of re-running, and prefer targeted runs (`npx playwright test <file> --project=chromium`) over the full matrix when verifying a fix.

**For tricky bugs, ask for dev-tools output.** If you're having difficulty reasoning through a complicated bug or feature, write a console snippet and ask the user to paste the result.

## Before non-trivial work: read the relevant docs

For any feature work, redesign, brainstorming, or structural change — **not** targeted bug fixes or small tweaks — open the docs that touch the area before proposing or implementing. Adjacent docs may share screen real estate or constrain the answer; treat the topical index below as a checklist, not a suggestion.

Design and manual:
- [`docs/design.md`](docs/design.md) — present-tense design + whys: shell, the single-screen app view, scope selector, disk sync, tool gallery & stack, entries table, URL state, code structure (the ES-module layering + dev/prod build), caches & reactivity, non-features.
- [`docs/manual.md`](docs/manual.md) — user-facing manual. Update when shipping user-facing changes.
- [`docs/style.md`](docs/style.md) — coding-style conventions: CSS, JS, Markdown, terminology, commit messages. Read before formatting changes.
- [`docs/testing.md`](docs/testing.md) — two-tier test handbook (Playwright browser suite + `node:test` unit tier) + strategy. Read before adding/modifying tests.
- [`docs/worker-protocol.md`](docs/worker-protocol.md) — the main↔pipeline-worker contract: data ownership, the message protocol, cancellation/supersession. Read before touching the worker boundary; keep it current in the same commit as any protocol change.
- [`docs/migration.md`](docs/migration.md) — storage migration policy: every `SCHEMA_VERSION` bump registers a `MIGRATIONS` step that carries data forward (no more wipe-on-mismatch); the reset prompt survives only as the floor.
- [`docs/tools.md`](docs/tools.md) — **single source of truth for the tool catalog**: every shipped and planned tool, with its card's icon, name, description, example, and implementation status. `design.md`, `manual.md`, and `planned/tools.md` all defer to it. Read before adding, renaming, or recategorizing any tool.
- [`docs/wordlisted.md`](docs/wordlisted.md) — reference catalogue of Wordlisted's search modes; source material for the tool gallery.

Plans (forward-looking, not yet shipped). `docs/planned/` is for plans that stay in version control for a while and aren't about to be implemented. A plan written to think through imminent work — one you'll implement right away and then discard — is ephemeral: write it to `/tmp`, not `docs/planned/`, and don't commit it. For a substantial rearchitecture whose feasibility is hard to judge up front, write the plan as a standalone doc (ephemeral → `/tmp`, long-lived → `docs/planned/`) and have an independent agent vet it before writing code; structure it so a reviewer can check the reasoning — load-bearing claims with `file:line` anchors, validated separated from uncertain, and a closing list of what to verify during implementation.
- [`docs/planned/tools.md`](docs/planned/tools.md) — runtime support sequencing, gallery polish (category picker, search), result download, tool API extensions (indexed lookups, annotations, escape hatches), open questions. The chain-row pipeline (executor, per-row tool API, symmetric unification, search-as-tool, per-atom-count sort, highlights) and the group-row model (group tools, group rows, the +N-more reveal) are shipped — see `design.md`. The tool catalog itself lives in `docs/tools.md`.

Future (longer-horizon ideas, not actively planned):
- [`docs/future/puz-to-pdf.md`](docs/future/puz-to-pdf.md) — feasibility sketch for in-browser .PUZ → printable PDF rendering.

When a plan ships, run the `distill-design-doc` skill to fold it into `design.md` and/or `manual.md`. (The header `?` button opens the in-app Help dialog (`FaqDialog`) — an FAQ with a folded-in Acknowledgements section, deep-linkable at `#/help`, that renders its diagrams and credits from the live catalog.)

## Architecture

ES modules under `site/src/`, organized by dependency layer — imports flow strictly **downward**, a lower layer never importing an upper one:

```
core  <  engine  <  data  <  model  <  ui  <  app
```

- `core/` — leaf utilities (constants, platform, the signals primitive, string helpers).
- `engine/` — pure, DOM-free, worker-ready core: norm, range, search/regex, segmenter, the tool catalog (each tool its own `engine/tools/<slug>.js`; `engine/tools.js` is the thin assembler), the executor, pure stats/histogram cores.
- `data/` — `state` and everything derived from it: storage, migrations, rescoring, merge, derived stats/histogram wrappers, disk-sync, persist, publishers.
- `model/` — thin band: tier-label logic + state-coupled score-display.
- `ui/` — components, dialogs, scrollers, rendering.
- `app/` — router + action dispatcher.

`main.js` is the thin boot entry; `test-api.js` is the only every-layer importer (imported last). `site/index.html` is just the shell (FOUC script + `<link>`s + `<script type="module" src="src/main.js">`); CSS lives in `site/css/`.

**Importing a module only *defines*** — no DOM, no `effect()`, no `window` touch, no cross-layer reach at import time. All side effects run from one ordered `boot()` in `main.js`, whose mount/inject order is a load-bearing contract. Cross-layer calls that would point upward (ui→app, or into a not-yet-available dep) are inverted via `configureX({...})` injection seams wired at boot; disk-sync repaints route through a `syncStatus$` signal rather than calling ui directly. Intra-`ui` circular imports are permitted (the strict rule is cross-layer acyclicity). The whys for all of this live in [`docs/design.md`](docs/design.md) § *Code structure*.

**Dev serves the raw module graph; deploy bundles it.** No build step in the local loop — serve `site/` statically and refresh. `npm run build` runs esbuild from `main.js` into one minified `dist/` bundle (run by [`.github/workflows/ci.yml`](.github/workflows/ci.yml)). CI tests the bundle (`GRAWLIX_SITE_DIR=dist`).

Sections within a module are delimited by banner comments like:
```
// ─── Parsing ──────────────────────────────────────────
```

## Data model

`state` holds `sources` (the per-wordlist data), `scoring` (tier labels for the unified score scale, used everywhere scores are displayed — the merged All Wordlists view shows them as a legend), `scoringDirty` (true when tier labels diverge from `DEFAULT_SCORING`), and search state. Each wordlist has metadata, `rawEntries` (parsed wordlist-entry records, shape `{ entry, score, comment }`), `rescoreRules` (My Edits seeds `editsLegend()`, the blank-output legend mirroring the live `state.scoring` tiers; custom lists start `[]`), and a `dirty` flag against `getWordlistDefaultRules` (the legend for My Edits, the publisher's `defaultRules` for publisher-bound lists, null for custom lists — propagation skips null). Scores that no rule maps and no tier labels cover pass through silently — Grawlix does not flag misalignment; see *Rescore rules* in `docs/design.md`.

**Terminology** — *wordlist* (data source), *wordlist entry* (`wlEntry`, the `{ entry, score, comment }` record), *entry* (the string field — `wlEntry.entry`), *word* (reserved for literal English, e.g. "Whole word" search). Full glossary in [`docs/style.md`](docs/style.md#terminology).

**Wordlist fields** — every source carries:
- `dbKey` — opaque `newDbKey()` string; used exclusively as the IndexedDB storage key. Never appears in HTML or UI code. `state.selected` stores the selected wordlist object (or `MERGED_ID`) — not the dbKey.
- `type` — `'edits'` for My Edits; absent for all regular sources. Nothing uses a string constant like `EDITS_ID` anymore — check `wordlist.type === 'edits'`.
- `icon` — a descriptor object (or `null` for auto-generated initials). Two shapes: `{ type: 'emoji', value: '✏️' }` or `{ type: 'img', url: 'https://…' }`. **Never store generated HTML** — render at display time via `buildIconHTML(descriptor, name, seed)`, which dispatches to `buildEmojiIconHTML`, `buildImgIconHTML`, or `buildInitialsIconHTML`. `getWordlistIcon(wordlist)` is the standard call site. The color seed is derived by `colorSeed(obj)` = `obj.url || obj.name` — same function works on both wordlist objects and publishers, ensuring publisher-based wordlists look consistent for all users. Limited to fields present at creation so the color doesn't shift as transient fields like `dbKey` or `originalFilename` populate during the import lifecycle.
- `originalFilename` — the filename last used to import or fetch data into this wordlist (e.g. `'jkugelman-wordlist.txt'`). Set by both `importToWordlist` and `fetchWordlist`. Used as the default download filename. Importing a file clears `wordlist.url`; a wordlist is either auto-fetch or file-based, not both.
- `publisherId` — optional weak reference to the publisher last applied (`'xwi'`, `'jkugelman'`, etc.). Display/reset purposes only; never a behavioral gate.

**Publishers** (`WORDLIST_PUBLISHERS`) — the four known wordlists (JK, XWI, STWL, Broda) are config bundles, not identities. Each has `id`, `name`, `icon`, `url`, `filenamePatterns`, `defaultRules`, and `neutralRules`. `getPublisher(wordlist)` looks up by `wordlist.publisherId`. There is no function that checks whether a wordlist's key matches a publisher — `getTemplate` is gone.

**Wordlist file format** — one entry per line:
```
ENTRY;SCORE
ENTRY;SCORE;COMMENT
```

**Rescore rules** (every wordlist, including My Edits) map an input score range + optional entry-length filter to an output score. First matching rule wins; rescoring is total — every raw entry maps to exactly one rescored entry, never dropped. Rescoring is optional: raw scores not matched by any rule pass through unchanged, and nothing nags the user about the gap.

**Scoring rules** (`state.scoring`) are the user's tier labels for the unified score scale: single source of truth for what each score range means. Edited from the inline editor on the wordlist bar when the `All Wordlists` scope is selected (the same editor slot shows the rescore editor for any other scope). Labeling is optional too — merged scores with no tier label still display, just without a tooltip name.

## Persistence

- **localStorage** (prefix `grawlix_`): wordlist metadata and settings. `persistMeta()` saves all wordlist metadata.
- **IndexedDB**: raw wordlist text per wordlist (keyed `data_<dbKey>`) plus per-list disk-sync targets (keyed `sync_<dbKey | __merged__>`: a `FileSystemFileHandle` + My Edits' baseline). Wordlists can be hundreds of thousands of entries, too large for localStorage. `Storage.writeWordlist(wordlist, text)` saves one wordlist's text.

**Disk sync is a per-list layer on IDB, not a backend.** IDB is always canonical; `Storage` is the sole storage object (no dispatch, no `DiskBackend`/`NullBackend`). A list optionally syncs to a file: My Edits is bidirectional (watched + 3-way merged against a baseline), every other list is a one-way output mirror. See [`docs/design.md`](docs/design.md) § *Disk sync*.

**Never store generated code (HTML, SVG markup) in localStorage or IndexedDB — store the parameters and render at read time.** Otherwise users with stale data continue to render with the old code shape after you change the renderer.

**Bump `SCHEMA_VERSION` and ship a migration when you change the shape of stored data.** Any change to `meta`'s field formats, the descriptor objects it contains, default values set only on first boot, or the IDB record shape requires a bump. Grawlix is live with real users, so register a `MIGRATIONS` step (keyed by the *from* version) — plus a frozen before→after fixture test, always — that upgrades existing data in place rather than letting the version-mismatch dialog wipe it. The reset prompt is now only a last-resort floor (data newer than this code, older than the squash horizon, or corrupt) — see [`docs/migration.md`](docs/migration.md). Without the bump, old and new code silently disagree about the stored shape and the app misbehaves.

**Migrate stored data; don't wipe it, and keep the parser strict.** localStorage and IndexedDB are past the pre-launch "just reset everyone" policy — schema changes migrate forward (above). Migrations upgrade the stored blob *before* parse, so `wordlistFromMeta` and the rest of the read path only ever see the current shape — never tolerate-then-drop old shapes inline. Cleanup-for-its-own-sake still isn't worth it: don't `lsDel` orphaned localStorage keys to garbage-collect them; an unused key costs nothing.

**URL routing: ask before breaking a shared link.** The link is public, so renaming or dropping a tool slug or URL key breaks links in the wild. Don't decide that unilaterally in either direction — surface the break and let the user choose case-by-case whether to keep the old form working (an alias/fallback to the new key) or let it rot. A broken link costs a re-share, not data, so neither answer is forced. See [`docs/design.md`](docs/design.md) § *Stable links*.

## Key concepts

**My Edits** — a special wordlist created automatically on first boot, identified by `wordlist.type === 'edits'`. It carries rescore rules like any source (no special-casing in `compileRescoreRules` / `getRescoredEntries`); user-typed scores are stored raw in `rawEntries` and rescored into the merge. It ships seeded with `editsLegend()` (the blank-output tier legend, mirroring the live `state.scoring` tiers); `getWordlistDefaultRules` returns it so reset/dirty/propagation apply, and `reconcileEditsRulesAfterImport` swaps it for an auto-seed when an imported file's scores don't fit the tiers. For My Edits (as for any non-`All Wordlists` scope) the inline editor slot on the wordlist bar shows the ordinary rescore editor; the scoring (tier-label) editor appears in that same slot only when the `All Wordlists` scope is selected. It gets the same split Download / Download original as other sources. Clicking a score or comment cell in the entries table opens an inline editor (`AtomPopover`); saving routes the edit into My Edits regardless of which wordlist sourced the row. From the My Edits scope the user can also add new entries and delete entries (with undo). It is reorderable and can be disabled like any other wordlist (position sets merge priority on ties); it's created on top and enabled, but neither is pinned — edits still route into it from any scope regardless of where it sits or whether it's enabled. The only special rule the UI enforces is that it's not deletable.

**Merged wordlist** — `MERGED_ID = '__merged__'` selects a union of all enabled sources, deduped by entry. The highest-priority enabled source that contributes wins, not the highest score. Displayed as `All Wordlists` (the value of `MERGED_NAME`) at the top of the scope selector dropdown (`WordlistSelector`). the worker builds the merge (`buildCorpus`/`resolveCorpus`, `engine/corpus.js`), resolving the winner per `(norm, display)` while bucketing all enabled sources' rescored entries (highest-priority eligible contributor wins); main holds no merged corpus, only the already-resolved rows the worker ships, so the entries scroller has no raw-vs-effective distinction of its own. My Edits edits apply optimistically via `applyEditsChange` (write-set into `rawEntries` + cache invalidation) and drive an `editEntry`/`deleteEntry` worker command that splices the worker's owned corpus in O(affected norms); the merged view then refreshes by re-running the pipeline (`refreshMergedScroller`), not by patching a cached main-side merge.

**Virtual scroller** — `VirtualScroller` renders only visible rows. Row height is fixed.

**Event delegation** — wordlist-card interactions use delegated listeners, and the bound object is stashed on the DOM element at render time rather than encoded in HTML attributes; handlers retrieve it via `e.target.closest('.wordlist-card')`. No wordlist ID or `dbKey` appears in HTML attributes. Two surfaces use cards: the scope selector dropdown (`WordlistSelector`) stashes `card._scope` (a source or `MERGED_ID`) and dispatches clicks to `setScope`; the Manage wordlists dialog (`ManagePanel`) stashes `card._wordlist` and dispatches enable-toggle and drag-reorder against its staging shadow.

## CSS custom properties

All colors are CSS variables on `html.dark-mode` / `html.light-mode`. The naming convention:
- `--bg`, `--surface` — background layers (`--bg` is the page; `--surface` is a slightly-tinted layer for sticky bars, sidebars, popovers)
- `--border`, `--border2`, `--border3` — border layers
- `--text`, `--muted`, `--faint` — text strength layers
- `--accent`, `--accent-hover` — brand purple
- `--score-{tier}-bg/fg` — score badge colors

## Committing

When changes reach a complete, shippable point, commit them — don't stop at proposing a message. Group work into atomic, independently-shippable commits.

When I ask for tweaks to something you just committed, prefer amending over a new commit whenever the changes belong with the original — especially bug fixes to code that hasn't been pushed yet. When several commits from this session are in play, that can mean rebasing and squashing a fix back into the older commit it fixes, not just amending the latest one.

If amending is the right call but the target commit has already been pushed, ask me first rather than rewriting published history on your own. Sometimes I'll want a fresh commit; other times I'll approve amending and force-pushing to fix a buggy commit that got deployed — I'm the only developer, so rewriting recent published history is fine when I okay it.

Message format: conventional commit prefix (`feat:`, `fix:`, `refactor:`, `chore:`, etc.), no parenthetical scope — just `fix:` not `fix(scope):`. Include a body unless the commit is trivial. Hard-wrap the body at 72 columns — including when writing it to a file or heredoc, not only when suggesting it in chat.

## Coding style

- **Don't over-comment.** Well-named identifiers and short functions do the work; self-explanatory code doesn't need commentary. Comment the **why**, not the **what** — *why* vanishes silently and is expensive to reconstruct. A comment is earned by *stakes*, not by mere non-obviousness: before writing one, ask what breaks if it's missing. If the answer is a glitch someone would spot immediately, or a detail verifiable by looking at the running result — most CSS tuned by eye, a value that just matches a sibling — that's minutia; leave it bare. Reserve comments for what fails silently and is costly to rediscover, and keep them proportional: a clause, never a three-line block over one fiddly value. A hard-to-reconstruct *what* earns a comment only when getting it wrong is also costly — clever alone doesn't qualify.
- **No inline styles.** Prefer adding CSS to `site/css/` over `style="..."` attributes on elements.
- **Dark mode and light mode have equal weight.** Don't treat one as the default and the other as an override — both get first-class parallel treatment in the CSS.
- **"Download" means output only.** Use "download" exclusively for saving a processed wordlist from Grawlix to disk (`downloadMergedWordlistFromPanel`, `downloadIndividualWordlist`, etc.). Use "fetch" for getting a wordlist into Grawlix from a URL (`fetchWordlist`), and "import" for the user loading a file. Template properties that refer to a third-party source page use `sourcePage` / `sourceNote`.

## Component architecture

The JS is organized into two patterns:

**HTML builders** (`buildXxxHTML`) — pure functions that return HTML strings. Stateless. Used for repeated elements and sub-components inside template literals.

**Lifecycle components** — own their DOM subtree, generate their own HTML, and wire their own events. Two forms:
- *IIFE* (`const XxxComponent = (() => { ... })()`) — singletons: dialogs, panels, sidebars
- *Class* (`class XxxComponent`) — multi-instance: scrollers, rule editors, entry tables

Every lifecycle component **creates its own DOM element** (`document.createElement(...)`) and appends it to the document at init time. Dialog and overlay elements are **never** baked into the static HTML body — if you're adding a dialog, create it in JS, not in HTML.

Generic builders live in `ui/components.js`; domain builders live in their consumer module. Nothing outside a component should reach into its DOM subtree.

**Dialog helpers** — `createDialog(id, opts)` returns `{el, body}` and delegates dismiss clicks (backdrop, `.dialog-close-btn`, `.dialog-cancel-btn`) to close the dialog. `showDialog(el, onClose?)` opens the dialog: captures the opener for refocus-on-close, clears `el.returnValue`, runs an optional close callback, and falls back to focusing the dialog body itself when no descendant has `autofocus`. Put `autofocus` on the primary input/button if there is one — otherwise the helper handles initial focus. Don't manually wire backdrop close, dismiss-button onclick, `tabIndex=-1`, or post-`showModal` `.focus()` calls.

**Promise-returning dialogs** (Confirm, Alert, Download, MergeConflict) wrap their body in `<form method="dialog">`. Result-producing buttons declare their result via the standard `value` attribute; the browser closes the dialog and sets `el.returnValue` to the clicked button's value on submit. The close callback reads `el.returnValue` to resolve the promise. The X close button stays *outside* the form and is `type="button"`; cancel buttons are inside the form but `type="button"` so they close via `.dialog-cancel-btn` delegation rather than submitting an empty value. For dialogs whose primary button has a computed result (Download), do the harvest in the close callback after checking `el.returnValue === 'ok'`.

## Understanding Grawlix

Grawlix today serves two activities: building a unified wordlist (curation, rescoring, merging, downloading) and using it as a construction aid (search/filter while filling a grid). For a description of all user-facing features, read [`docs/manual.md`](docs/manual.md).
