# Grawlix

**Live site:** https://grawlix.wtf (hosted via GitHub Pages)

Grawlix is a browser-based wordlist manager for crossword constructors. Wordlists in the wild are each scored on their own arbitrary scales, making it hard to combine them. Grawlix solves this with per-wordlist rescoring rules that map everything to a common scale, then merges the results into a single unified view. It ships with curated default rules for four popular wordlists so most users get a good experience out of the box, with full customization available for those who want it.

All code lives in a single file: `site/index.html`. Don't bother searching for other HTML, JS, or CSS files.

`TODO.md` at the repo root is the user's personal scratchpad — never edit it. Reading it is fine but do not touch it.

**Don't smoke-test by running `python -m http.server`.** It's a static HTML file with no build step or templating; serving it locally only verifies that the filesystem can read it, which is theatre. For real verification, syntax-check inline JS with `node ~/.claude/scripts/check-syntax.js site/index.html`, read the diff carefully, and say "I can't visually verify" when that's the truth — visual inspection requires the user's browser. The Playwright smoke suite covers some user-visible behaviors automatically; run `npm test` to verify. See [`docs/testing.md`](docs/testing.md) for what's covered and what isn't. **Don't re-run the suite just to recover results you already have** — the last run is saved under `test-results/` (`.last-run.json` for status + failed-test IDs, one folder per failed test). Read those instead of re-running, and prefer targeted runs (`npx playwright test <file> --project=chromium`) over the full matrix when verifying a fix. Known transient/flaky failures — a per-test tally, root causes, and reproduction — are tracked in [`tests/flaky.md`](tests/flaky.md).

**For tricky bugs, ask for dev-tools output.** If you're having difficulty reasoning through a complicated bug or feature, write a console snippet and ask the user to paste the result.

## Before non-trivial work: read the relevant docs

For any feature work, redesign, brainstorming, or structural change — **not** targeted bug fixes or small tweaks — open the docs that touch the area before proposing or implementing. Adjacent docs may share screen real estate or constrain the answer; treat the topical index below as a checklist, not a suggestion.

Design and manual:
- [`docs/design.md`](docs/design.md) — present-tense design + whys: shell, the single-screen app view, scope selector, disk sync, tool gallery & stack, entries table, URL state, caches & reactivity, non-features.
- [`docs/manual.md`](docs/manual.md) — user-facing manual. Update when shipping user-facing changes.
- [`docs/style.md`](docs/style.md) — coding-style conventions: CSS, JS, Markdown, terminology, commit messages. Read before formatting changes.
- [`docs/testing.md`](docs/testing.md) — Playwright smoke suite handbook + strategy. Read before adding/modifying tests.
- [`docs/migration.md`](docs/migration.md) — storage migration policy: every `SCHEMA_VERSION` bump registers a `MIGRATIONS` step that carries data forward (no more wipe-on-mismatch); the reset prompt survives only as the floor.
- [`docs/tools.md`](docs/tools.md) — **single source of truth for the tool catalog**: every shipped and planned tool, with its card's icon, name, description, example, and implementation status. `design.md`, `manual.md`, and `planned/tools.md` all defer to it. Read before adding, renaming, or recategorizing any tool.
- [`docs/wordlisted.md`](docs/wordlisted.md) — reference catalogue of Wordlisted's search modes; source material for the tool gallery.

Plans (forward-looking, not yet shipped):
- [`docs/planned/help.md`](docs/planned/help.md) — separating welcome tour from returning-user reference manual.
- [`docs/planned/tools.md`](docs/planned/tools.md) — runtime support sequencing, gallery polish (category picker, search), result download, tool API extensions (indexed lookups, annotations, escape hatches), open questions. The chain-row pipeline (executor, per-row tool API, symmetric unification, search-as-tool, per-atom-count sort, highlights) and the group-row model (group tools, group rows, the +N-more reveal) are shipped — see `design.md`. The tool catalog itself lives in `docs/tools.md`.

Future (longer-horizon ideas, not actively planned):
- [`docs/future/lookup.md`](docs/future/lookup.md) — click-a-word lookup (definitions, Wikipedia, NYT history, semantic search).
- [`docs/future/puz-to-pdf.md`](docs/future/puz-to-pdf.md) — feasibility sketch for in-browser .PUZ → printable PDF rendering.

When a plan ships, run the `distill-design-doc` skill to fold it into `design.md` and/or `manual.md`. (There used to be an in-app welcome tour with copy that needed updating per shipped feature; it was removed pending a redesign — see [`docs/planned/help.md`](docs/planned/help.md). The header `?` button is a deactivated placeholder until that lands.)

## Architecture

One HTML file: `<style>` block, a minimal HTML body (app shell only — no dialog or overlay elements), then one big `<script>` block. No dev build step, no frameworks — plain HTML/CSS/JS that runs directly in the browser. The deploy pipeline minifies the file via `npm run build` (`site/` → `dist/`, run by [`.github/workflows/ci.yml`](.github/workflows/ci.yml)); that's the only build step.

Sections within the `<script>` block are delimited by banner comments like:
```
// ─── Parsing ──────────────────────────────────────────
```

## Data model

`state` holds `sources` (the per-wordlist data), `scoring` (tier labels for the unified score scale, used everywhere scores are displayed — the merged All view shows them as a legend), `scoringDirty` (true when tier labels diverge from `DEFAULT_SCORING`), and search state. Each wordlist has metadata, `rawEntries` (parsed wordlist-entry records, shape `{ entry, score, comment }`), `rescoreRules` (My Edits seeds `editsLegend()`, the blank-output legend mirroring the live `state.scoring` tiers; custom lists start `[]`), and a `dirty` flag against `getWordlistDefaultRules` (the legend for My Edits, the publisher's `defaultRules` for publisher-bound lists, null for custom lists — propagation skips null). Scores that no rule maps and no tier labels cover pass through silently — Grawlix does not flag misalignment; see *Rescore rules* in `docs/design.md`.

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

**Scoring rules** (`state.scoring`) are the user's tier labels for the unified score scale: single source of truth for what each score range means. Edited from the inline editor on the wordlist bar when the `All` scope is selected (the same editor slot shows the rescore editor for any other scope). Labeling is optional too — merged scores with no tier label still display, just without a tooltip name.

## Persistence

- **localStorage** (prefix `grawlix_`): wordlist metadata and settings. `persistMeta()` saves all wordlist metadata.
- **IndexedDB**: raw wordlist text per wordlist (keyed `data_<dbKey>`) plus per-list disk-sync targets (keyed `sync_<dbKey | __merged__>`: a `FileSystemFileHandle` + My Edits' baseline). Wordlists can be hundreds of thousands of entries, too large for localStorage. `Storage.writeWordlist(wordlist, text)` saves one wordlist's text.

**Disk sync is a per-list layer on IDB, not a backend.** IDB is always canonical; `Storage` is the sole storage object (no dispatch, no `DiskBackend`/`NullBackend`). A list optionally syncs to a file: My Edits is bidirectional (watched + 3-way merged against a baseline), every other list is a one-way output mirror. See [`docs/design.md`](docs/design.md) § *Disk sync*.

**Never store generated code (HTML, SVG markup) in localStorage or IndexedDB — store the parameters and render at read time.** Otherwise users with stale data continue to render with the old code shape after you change the renderer.

**Bump `SCHEMA_VERSION` and ship a migration when you change the shape of stored data.** Any change to `meta`'s field formats, the descriptor objects it contains, default values set only on first boot, or the IDB record shape requires a bump. Grawlix is in beta with real users, so register a `MIGRATIONS` step (keyed by the *from* version) — plus a frozen before→after fixture test, always — that upgrades existing data in place rather than letting the version-mismatch dialog wipe it. The reset prompt is now only a last-resort floor (data newer than this code, older than the squash horizon, or corrupt) — see [`docs/migration.md`](docs/migration.md). Without the bump, old and new code silently disagree about the stored shape and the app misbehaves.

**Migrate stored data; don't wipe it, and keep the parser strict.** localStorage and IndexedDB are past the pre-launch "just reset everyone" policy — schema changes migrate forward (above). Migrations upgrade the stored blob *before* parse, so `wordlistFromMeta` and the rest of the read path only ever see the current shape — never tolerate-then-drop old shapes inline. Cleanup-for-its-own-sake still isn't worth it: don't `lsDel` orphaned localStorage keys to garbage-collect them; an unused key costs nothing.

**URL routing is still pre-launch-clean.** Shared-link stability has *not* flipped. When you rename or drop a tool slug or URL key, just make the change cleanly — don't register alias tables or fall-through routes for the old form. A user re-shares their own link if they care; a broken link doesn't destroy data the way a storage wipe would. See [`docs/design.md`](docs/design.md) § *Stable links* for when this policy flips too.

## Key concepts

**My Edits** — a special wordlist created automatically on first boot, identified by `wordlist.type === 'edits'`. It carries rescore rules like any source (no special-casing in `compileRescoreRules` / `getRescoredEntries`); user-typed scores are stored raw in `rawEntries` and rescored into the merge. It ships seeded with `editsLegend()` (the blank-output tier legend, mirroring the live `state.scoring` tiers); `getWordlistDefaultRules` returns it so reset/dirty/propagation apply, and `reconcileEditsRulesAfterImport` swaps it for an auto-seed when an imported file's scores don't fit the tiers. For My Edits (as for any non-`All` scope) the inline editor slot on the wordlist bar shows the ordinary rescore editor; the scoring (tier-label) editor appears in that same slot only when the `All` scope is selected. It gets the same split Download / Download original as other sources. Clicking a score or comment cell in the entries table opens an inline editor (`AtomPopover`); saving routes the edit into My Edits regardless of which wordlist sourced the row. From the My Edits scope the user can also add new entries and delete entries (with undo). It is reorderable like any other wordlist (position determines merge priority). The UI enforces: not deletable, always enabled.

**Merged wordlist** — `MERGED_ID = '__merged__'` selects a union of all enabled sources, deduped by entry. The highest-priority enabled source that contributes wins, not the highest score. Displayed as `All` (the value of `MERGED_NAME`) at the top of the scope selector dropdown (`WordlistSelector`). `buildMergedWordlist` resolves the winner per `(norm, display)` directly while bucketing all enabled sources' rescored entries (highest-priority eligible contributor wins); the entries scroller only ever receives the already-resolved merged entries, so it has no raw-vs-effective distinction of its own. My Edits edits patch the affected norms into the cached merged result in place via `applyEditsChange` / `patchMergedForNorms` rather than rebuilding it.

**Virtual scroller** — `VirtualScroller` renders only visible rows. Row height is fixed.

**Event delegation** — wordlist-card interactions use delegated listeners, and the bound object is stashed on the DOM element at render time rather than encoded in HTML attributes; handlers retrieve it via `e.target.closest('.wordlist-card')`. No wordlist ID or `dbKey` appears in HTML attributes. Two surfaces use cards: the scope selector dropdown (`WordlistSelector`) stashes `card._scope` (a source or `MERGED_ID`) and dispatches clicks to `setScope`; the Manage wordlists dialog (`ManagePanel`) stashes `card._wordlist` and dispatches enable-toggle and drag-reorder against its staging shadow.

## CSS custom properties

All colors are CSS variables on `html.dark-mode` / `html.light-mode`. The naming convention:
- `--bg`, `--surface` — background layers (`--bg` is the page; `--surface` is a slightly-tinted layer for sticky bars, sidebars, popovers)
- `--border`, `--border2`, `--border3` — border layers
- `--text`, `--muted`, `--faint` — text strength layers
- `--accent`, `--accent-hover` — brand purple
- `--score-{tier}-bg/fg` — score badge colors

## Commit messages

After completing changes that are ready to commit, always output a suggested commit message in conventional commit format (`feat:`, `fix:`, `refactor:`, `chore:`, etc.). No parenthetical scope — just `fix:` not `fix(scope):`. Include a body unless the commit is trivial.

## Coding style

- **Don't over-comment.** Well-named identifiers and short functions do the work; self-explanatory code doesn't need commentary. Comment the **why**, not the **what** — *why* vanishes silently and is expensive to reconstruct. A comment is earned by *stakes*, not by mere non-obviousness: before writing one, ask what breaks if it's missing. If the answer is a glitch someone would spot immediately, or a detail verifiable by looking at the running result — most CSS tuned by eye, a value that just matches a sibling — that's minutia; leave it bare. Reserve comments for what fails silently and is costly to rediscover, and keep them proportional: a clause, never a three-line block over one fiddly value. A hard-to-reconstruct *what* earns a comment only when getting it wrong is also costly — clever alone doesn't qualify.
- **No inline styles.** Prefer adding CSS to the `<style>` block over `style="..."` attributes on elements.
- **Dark mode and light mode have equal weight.** Don't treat one as the default and the other as an override — both get first-class parallel treatment in the CSS.
- **"Download" means output only.** Use "download" exclusively for saving a processed wordlist from Grawlix to disk (`downloadMergedWordlistFromPanel`, `downloadIndividualWordlist`, etc.). Use "fetch" for getting a wordlist into Grawlix from a URL (`fetchWordlist`), and "import" for the user loading a file. Template properties that refer to a third-party source page use `sourcePage` / `sourceNote`.

## Component architecture

The JS is organized into two patterns:

**HTML builders** (`buildXxxHTML`) — pure functions that return HTML strings. Stateless. Used for repeated elements and sub-components inside template literals.

**Lifecycle components** — own their DOM subtree, generate their own HTML, and wire their own events. Two forms:
- *IIFE* (`const XxxComponent = (() => { ... })()`) — singletons: dialogs, panels, sidebars
- *Class* (`class XxxComponent`) — multi-instance: scrollers, rule editors, entry tables

Every lifecycle component **creates its own DOM element** (`document.createElement(...)`) and appends it to the document at init time. Dialog and overlay elements are **never** baked into the static HTML body — if you're adding a dialog, create it in JS, not in HTML.

All builders live in the `// ─── Components ───` section. Nothing outside a component should reach into its DOM subtree.

**Dialog helpers** — `createDialog(id, opts)` returns `{el, body}` and delegates dismiss clicks (backdrop, `.dialog-close-btn`, `.dialog-cancel-btn`) to close the dialog. `showDialog(el, onClose?)` opens the dialog: captures the opener for refocus-on-close, clears `el.returnValue`, runs an optional close callback, and falls back to focusing the dialog body itself when no descendant has `autofocus`. Put `autofocus` on the primary input/button if there is one — otherwise the helper handles initial focus. Don't manually wire backdrop close, dismiss-button onclick, `tabIndex=-1`, or post-`showModal` `.focus()` calls.

**Promise-returning dialogs** (Confirm, Alert, Download, MergeConflict) wrap their body in `<form method="dialog">`. Result-producing buttons declare their result via the standard `value` attribute; the browser closes the dialog and sets `el.returnValue` to the clicked button's value on submit. The close callback reads `el.returnValue` to resolve the promise. The X close button stays *outside* the form and is `type="button"`; cancel buttons are inside the form but `type="button"` so they close via `.dialog-cancel-btn` delegation rather than submitting an empty value. For dialogs whose primary button has a computed result (Download), do the harvest in the close callback after checking `el.returnValue === 'ok'`.

## Understanding Grawlix

Grawlix today serves two activities: building a unified wordlist (curation, rescoring, merging, downloading) and using it as a construction aid (search/filter while filling a grid). For a description of all user-facing features, read [`docs/manual.md`](docs/manual.md).
