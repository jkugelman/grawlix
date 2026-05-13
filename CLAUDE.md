# Grawlix

**Live site:** https://grawlix.wtf (hosted via GitHub Pages)

Grawlix is a browser-based wordlist manager for crossword constructors. Wordlists in the wild are each scored on their own arbitrary scales, making it hard to combine them. Grawlix solves this with per-wordlist rescoring rules that map everything to a common scale, then merges the results into a single unified view. It ships with curated default rules for four popular wordlists so most users get a good experience out of the box, with full customization available for those who want it.

All code lives in a single file: `site/index.html`. Don't bother searching for other HTML, JS, or CSS files.

`TODO.md` at the repo root is the user's personal scratchpad — never edit it. Reading it is fine but do not touch it.

**Don't smoke-test by running `python -m http.server`.** It's a static HTML file with no build step or templating; serving it locally only verifies that the filesystem can read it, which is theatre. For real verification, syntax-check inline JS with `node ~/.claude/scripts/check-syntax.js site/index.html`, read the diff carefully, and say "I can't visually verify" when that's the truth — visual inspection requires the user's browser. A future Playwright suite is planned in [`docs/plans/ci-testing.md`](docs/plans/ci-testing.md).

## Before non-trivial work: read the relevant docs

For any feature work, redesign, brainstorming, or structural change — **not** targeted bug fixes or small tweaks — open the docs that touch the area before proposing or implementing. Adjacent docs may share screen real estate or constrain the answer; treat the topical index below as a checklist, not a suggestion.

Design and manual:
- [`docs/design.md`](docs/design.md) — present-tense design + whys: shell, Workshop / Library views, tool gallery & stack, entries table, URL state, caches & reactivity, non-features.
- [`docs/manual.md`](docs/manual.md) — user-facing manual. Update when shipping user-facing changes.
- [`docs/style.md`](docs/style.md) — coding-style conventions: CSS, JS, Markdown, terminology, commit messages. Read before formatting changes.
- [`docs/wordlisted.md`](docs/wordlisted.md) — reference catalogue of Wordlisted's search modes; source material for the tool gallery.

Plans (forward-looking, not yet shipped):
- [`docs/plans/ci-testing.md`](docs/plans/ci-testing.md) — Playwright smoke suite (deferred).
- [`docs/plans/help.md`](docs/plans/help.md) — separating welcome tour from returning-user reference manual.
- [`docs/plans/lookup.md`](docs/plans/lookup.md) — click-a-word lookup (definitions, Wikipedia, NYT history, semantic search).
- [`docs/plans/migration.md`](docs/plans/migration.md) — when to graduate from schema-version resets to layered migrations.
- [`docs/plans/mobile.md`](docs/plans/mobile.md) — mobile/responsive design.
- [`docs/plans/puz-to-pdf.md`](docs/plans/puz-to-pdf.md) — feasibility sketch for in-browser .PUZ → printable PDF rendering.
- [`docs/plans/sync.md`](docs/plans/sync.md) — three-tier persistence (backup nag, disk file, cloud sync) for All + My Edits.
- [`docs/plans/tools.md`](docs/plans/tools.md) — tool execution/catalog, chaining, pair/group output, OneLook/Datamuse/Umiaq. Gallery + stack are shipped (see `design.md`).

When a plan ships, run the `distill-design-doc` skill to fold it into `design.md` and/or `manual.md`. (There used to be an in-app welcome tour with copy that needed updating per shipped feature; it was removed pending a redesign — see [`docs/plans/help.md`](docs/plans/help.md). The header `?` button is a deactivated placeholder until that lands.)

## Architecture

One HTML file: `<style>` block, a minimal HTML body (app shell only — no dialog or overlay elements), then one big `<script>` block. No build step, no npm, no frameworks — plain HTML/CSS/JS that runs directly in the browser.

Sections within the `<script>` block are delimited by banner comments like:
```
// ─── Parsing ──────────────────────────────────────────
```

## Data model

`state` holds `sources` (the per-wordlist data), `scoring` (tier labels for the unified score scale, used everywhere scores are displayed — the merged All view shows them as a legend), `scoringDirty` (true when tier labels diverge from `DEFAULT_SCORING`), and search state. Each wordlist has metadata, `rawEntries` (parsed wordlist-entry records, shape `{ entry, score, comment }`), `rescoreRules`, and a `dirty` flag against its publisher's `defaultRules` (or `getMyEditsDefaultRules()` for My Edits). Transient `wordlist._uncovered` / `state._scoringUncovered` carry the list of scores not covered by any rule — see *Rescore rules & tier alignment* in `docs/design.md`.

**Terminology** — *wordlist* (data source), *wordlist entry* (`wlEntry`, the `{ entry, score, comment }` record), *entry* (the string field — `wlEntry.entry`), *word* (reserved for literal English, e.g. "Whole word" search). Full glossary in [`docs/style.md`](docs/style.md#terminology).

**Wordlist fields** — every source carries:
- `dbKey` — opaque `crypto.randomUUID()` string; used exclusively as the IndexedDB storage key. Never appears in HTML or UI code. `state.selected` stores the selected wordlist object (or `MERGED_ID`) — not the dbKey.
- `type` — `'edits'` for My Edits; absent for all regular sources. Nothing uses a string constant like `EDITS_ID` anymore — check `wordlist.type === 'edits'`.
- `icon` — a descriptor object (or `null` for auto-generated initials). Two shapes: `{ type: 'emoji', value: '✏️' }` or `{ type: 'img', url: 'https://…' }`. **Never store generated HTML** — render at display time via `buildIconHTML(descriptor, name, seed)`, which dispatches to `buildEmojiIconHTML`, `buildImgIconHTML`, or `buildInitialsIconHTML`. `getWordlistIcon(wordlist)` is the standard call site. The color seed is derived by `colorSeed(obj)` = `obj.url || obj.originalFilename || obj.dbKey || obj.name` — same function works on both wordlist objects and publishers, ensuring publisher-based wordlists look consistent for all users.
- `originalFilename` — the filename last used to import or fetch data into this wordlist (e.g. `'jkugelman-wordlist.txt'`). Set by both `importToWordlist` and `fetchWordlist`. Used as the default download filename and as a fallback color seed. Importing a file clears `wordlist.url`; a wordlist is either auto-fetch or file-based, not both.
- `publisherId` — optional weak reference to the publisher last applied (`'xwi'`, `'jkugelman'`, etc.). Display/reset purposes only; never a behavioral gate.

**Publishers** (`WORDLIST_PUBLISHERS`) — the four known wordlists (JK, XWI, STWL, Broda) are config bundles, not identities. Each has `id`, `name`, `icon`, `url`, `filenamePatterns`, `defaultRules`, and `neutralRules`. `getPublisher(wordlist)` looks up by `wordlist.publisherId`. There is no function that checks whether a wordlist's key matches a publisher — `getTemplate` is gone.

**Wordlist file format** — one entry per line:
```
ENTRY;SCORE
ENTRY;SCORE;COMMENT
```

**Rescore rules** (every wordlist, including My Edits) map an input score range + optional entry-length filter to an output score (or `'ignore'` to drop the entry). First matching rule wins. Raw scores not matched by any length-filter-free rule are collected into `wordlist._uncovered` — a transient list that drives the Unhandled-scores banner in the editor and the warning-severity bubble on the wordlist's card.

**Scoring rules** (`state.scoring`) are the user's tier labels for the unified score scale: single source of truth for what each score range means. Edited from All's right pane in the Library view. Same uncovered-scores pattern (`state._scoringUncovered`) flags merged output scores that no tier label covers.

## Persistence

- **localStorage** (prefix `grawlix_`): wordlist metadata and settings. `persistMeta()` saves all wordlist metadata.
- **IndexedDB**: raw wordlist text per wordlist. Wordlists can be hundreds of thousands of entries, too large for localStorage. `persistData(wordlist, text)` saves one wordlist's text, keyed by `wordlist.dbKey`.

**Never store generated code (HTML, SVG markup) in localStorage or IndexedDB — store the parameters and render at read time.** Otherwise users with stale data continue to render with the old code shape after you change the renderer.

**Bump `SCHEMA_VERSION` when you change the shape of stored data.** Any change to `meta`'s field formats, the descriptor objects it contains, default values set only on first boot, or the IDB entry shape requires a bump. On load, a mismatch between the stored version and `SCHEMA_VERSION` prompts the user to reset their local data; without the bump, they'll silently load incompatible data and the app will misbehave.

**No migration, cleanup, or compatibility code pre-launch.** This is venue-agnostic — applies to localStorage, IndexedDB, *and* URL routing. When you remove a feature, rename a stored field, drop a URL key, or otherwise strand existing data or shared links, just make the change cleanly. Don't `lsDel` orphaned localStorage keys to garbage-collect them. Don't write IndexedDB migration runners or tolerate-then-drop old shapes in the parser. Don't register URL alias tables for renamed tool slugs or fall-through routes for the old form. The user clears their own storage and re-shares their own links if they care. The `SCHEMA_VERSION` wipe prompt is the *one* compatibility mechanism that earns its keep today; everything else is dead weight for a userbase that doesn't exist yet. See [`docs/plans/migration.md`](docs/plans/migration.md) (storage) and [`docs/design.md`](docs/design.md) § *Stable links* (URL keys) for when each policy flips.

## Key concepts

**My Edits** — a special wordlist created automatically on first boot, identified by `wordlist.type === 'edits'`. Carries rescore rules like any other wordlist; ships with inert defaults derived from `state.scoring` (via `getMyEditsDefaultRules`) so a fresh-install tier-covered edit doesn't trip the misalignment bubble. Clicking a score or comment cell in any view opens an inline editor; saving upserts the entry into My Edits. From the My Edits view the user can also add new entries and delete entries (with undo). It is reorderable like any other wordlist (position determines merge priority). The UI enforces: not deletable, always enabled.

**Override and rescore display** — When viewing a wordlist, score and comment cells always show the *effective* value (what actually appears in the merged output), not the raw value from that wordlist. A red superscript asterisk (`*`) indicates the displayed value differs from what the wordlist itself contains. An instant HTML popover (`#cell-popover`) explains why: the original score for rescored entries, or the overriding wordlist's name for overrides. Both conditions can apply simultaneously. The overrideMap (built by `buildOverrideMap`) stores `{ wordlistName, score, comment }` from the highest-priority wordlist above the current one; a comment override only applies when that wordlist has a non-empty comment. Editing an overridden cell pre-fills the input with the effective value (not the raw value) so the user is editing what actually matters — the result always lands in My Edits regardless.

**Merged wordlist** — `MERGED_ID = '__merged__'` selects a union of all enabled sources, deduped by entry. The highest rescored value wins; losers are shown faded with a tooltip. Displayed as `All` (the value of `MERGED_NAME`) at the top of the wordlist card list in the left rail's Wordlist section.

**Virtual scroller** — `VirtualScroller` renders only visible rows. Row height is fixed.

**Event delegation** — wordlist card interactions (click, keydown, change, drag) use delegated listeners on the Library view's rail (`#wld-rail-wordlist`). At render time, the rail sets `card._wordlist = wordlist` on each `.wordlist-card[data-wordlist]` DOM element. Handlers retrieve the wordlist via `e.target.closest('.wordlist-card[data-wordlist]')._wordlist`. No wordlist ID or `dbKey` appears in HTML attributes.

## CSS custom properties

All colors are CSS variables on `html.dark-mode` / `html.light-mode`. The naming convention:
- `--bg`, `--surface`, `--surface2` — background layers
- `--border`, `--border2`, `--border3` — border layers
- `--text`, `--muted`, `--faint` — text strength layers
- `--accent`, `--accent-hover` — brand purple
- `--score-{tier}-bg/fg` — score badge colors

## Commit messages

After completing changes that are ready to commit, always output a suggested commit message in conventional commit format (`feat:`, `fix:`, `refactor:`, `chore:`, etc.). No parenthetical scope — just `fix:` not `fix(scope):`. Include a body unless the commit is trivial.

## Coding style

- **Don't over-comment.** Well-named identifiers and short functions do the work; self-explanatory code doesn't need commentary. Comment the **why**, not the **what** — a reader can see *what* the code does, but *why* vanishes silently and is expensive to reconstruct. The exception is when the *what* itself is hard to reconstruct.
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
