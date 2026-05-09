# Grawlix

**Live site:** https://grawlix.wtf (hosted via GitHub Pages)

Grawlix is a browser-based wordlist manager for crossword constructors. Wordlists in the wild are each scored on their own arbitrary scales, making it hard to combine them. Grawlix solves this with per-wordlist rescoring rules that map everything to a common scale, then merges the results into a single unified view. It ships with curated default rules for four popular wordlists so most users get a good experience out of the box, with full customization available for those who want it.

All code lives in a single file: `site/index.html`. Read and edit only that file.

## Architecture

One HTML file: `<style>` block, a minimal HTML body (app shell only — no dialog or overlay elements), then one big `<script>` block. No build step, no npm, no frameworks — plain HTML/CSS/JS that runs directly in the browser.

Sections within the `<script>` block are delimited by banner comments like:
```
// ─── Parsing ──────────────────────────────────────────
```

## Data model

`state` holds `sources` (the per-wordlist data), `selected`, and search state. Each wordlist has metadata, `rawEntries` (parsed words), and `rescoreRules`. My Edits additionally has a `scoring` field — tier labels for the unified score scale, used everywhere scores are displayed (the merged All view shows them as a legend).

**Wordlist fields** — every source carries:
- `dbKey` — opaque `crypto.randomUUID()` string; used exclusively as the IndexedDB storage key. Never appears in HTML or UI code. `state.selected` stores the selected wordlist object (or `MERGED_ID`) — not the dbKey.
- `type` — `'edits'` for My Edits; absent for all regular sources. Nothing uses a string constant like `EDITS_ID` anymore — check `wordlist.type === 'edits'`.
- `icon` — a descriptor object (or `null` for auto-generated initials). Two shapes: `{ type: 'emoji', value: '✏️' }` or `{ type: 'img', url: 'https://…' }`. **Never store generated HTML** — render at display time via `buildIconHTML(descriptor, name, seed)`, which dispatches to `buildEmojiIconHTML`, `buildImgIconHTML`, or `buildInitialsIconHTML`. `getWordlistIcon(wordlist)` is the standard call site. The color seed is derived by `colorSeed(obj)` = `obj.url || obj.originalFilename || obj.dbKey || obj.name` — same function works on both wordlist objects and publishers, ensuring publisher-based wordlists look consistent for all users.
- `originalFilename` — the filename last used to import or fetch data into this wordlist (e.g. `'jkugelman-wordlist.txt'`). Set by both `importToWordlist` and `fetchWordlist`. Used as the default download filename and as a fallback color seed. Importing a file clears `wordlist.url`; a wordlist is either auto-fetch or file-based, not both.
- `publisherId` — optional weak reference to the publisher last applied (`'xwi'`, `'jkugelman'`, etc.). Display/reset purposes only; never a behavioral gate.

**Publishers** (`WORDLIST_PUBLISHERS`) — the four known wordlists (JK, XWI, STWL, Broda) are config bundles, not identities. Each has `id`, `name`, `icon`, `url`, `filenamePatterns`, `defaultRules`, and `neutralRules`. `getPublisher(wordlist)` looks up by `wordlist.publisherId`. There is no function that checks whether a wordlist's key matches a publisher — `getTemplate` is gone.

**Wordlist file format** — one entry per line:
```
WORD;SCORE
WORD;SCORE;COMMENT
```

**Rescore rules** (per source) map an input score range + optional word-length filter to an output score (or `'ignore'` to drop the entry). First matching rule wins; a catch-all is auto-appended. My Edits has no rescore rules — its scores pass through unchanged.

**Scoring rules** (My Edits' `scoring` field) are the user's tier labels for the unified score scale: a single source of truth for what each score range means to them. Edited from My Edits' right pane in the Wordlists dialog; surfaced as a read/write legend on the merged All view too. The catch-all auto-row reflects scores present in the merged view that aren't covered by any rule.

## Persistence

- **localStorage** (prefix `grawlix_`): wordlist metadata and settings. `persistMeta()` saves all wordlist metadata.
- **IndexedDB**: raw wordlist text per wordlist. Wordlists can be hundreds of thousands of words, too large for localStorage. `persistData(wordlist, text)` saves one wordlist's text, keyed by `wordlist.dbKey`.

**Never store generated code (HTML, SVG markup) in localStorage or IndexedDB — store the parameters and render at read time.** Otherwise users with stale data continue to render with the old code shape after you change the renderer.

**Bump `SCHEMA_VERSION` when you change the shape of stored data.** Any change to `meta`'s field formats, the descriptor objects it contains, default values set only on first boot, or the IDB entry shape requires a bump. On load, a mismatch between the stored version and `SCHEMA_VERSION` prompts the user to reset their local data; without the bump, they'll silently load incompatible data and the app will misbehave.

## Key concepts

**My Edits** — a special wordlist created automatically on first boot, identified by `wordlist.type === 'edits'`. It has no rescore rules (scores pass through as-is) but does carry the user's `scoring` (tier labels). Clicking a score or comment cell in any view opens an inline editor; saving upserts the entry into My Edits. From the My Edits view the user can also add new words and delete entries (with undo). It is reorderable like any other wordlist (position determines merge priority). The UI enforces: not deletable, always enabled.

**Override and rescore display** — When viewing a wordlist, score and comment cells always show the *effective* value (what actually appears in the merged output), not the raw value from that wordlist. A red superscript asterisk (`*`) indicates the displayed value differs from what the wordlist itself contains. An instant HTML popover (`#cell-popover`) explains why: the original score for rescored entries, or the overriding wordlist's name for overrides. Both conditions can apply simultaneously. The overrideMap (built by `buildOverrideMap`) stores `{ wordlistName, score, comment }` from the highest-priority wordlist above the current one; a comment override only applies when that wordlist has a non-empty comment. Editing an overridden cell pre-fills the input with the effective value (not the raw value) so the user is editing what actually matters — the result always lands in My Edits regardless.

**Merged wordlist** — `MERGED_ID = '__merged__'` selects a union of all enabled sources, deduped by word. The highest rescored value wins; losers are shown faded with a tooltip. Displayed as `All` (the value of `MERGED_NAME`) at the top of the wordlist dropdown in the left rail's Wordlist section.

**Score tiers** — `great` (≥60), `good` (≥50), `fair` (≥40), `meh` (≥30), `bad` (<30). Drive score badge colors via `data-tier` and `--score-{tier}-{bg,fg}` CSS vars.

**Search syntax** — `?` (any letter), `#` (consonant), `@` (vowel), `*` (any substring), `[abc]` (character class). Whole-word toggle anchors the pattern.

**Virtual scroller** — `VirtualScroller` renders only visible rows. Row height is fixed.

**Event delegation** — wordlist card interactions (click, keydown, change, drag) use delegated listeners on the Wordlists dialog's rail (`#wld-rail-wordlist`). At render time, the rail sets `card._wordlist = wordlist` on each `.wordlist-card[data-wordlist]` DOM element. Handlers retrieve the wordlist via `e.target.closest('.wordlist-card[data-wordlist]')._wordlist`. No wordlist ID or `dbKey` appears in HTML attributes.

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

- **Default to writing no comments.** Well-named identifiers and short functions do the work; self-explanatory code doesn't need commentary. Comment the **why**, not the **what** — a reader can see *what* the code does, but *why* vanishes silently and is expensive to reconstruct. The exception is when the *what* itself is hard to reconstruct.
- **No inline styles.** Prefer adding CSS to the `<style>` block over `style="..."` attributes on elements.
- **Dark mode and light mode have equal weight.** Don't treat one as the default and the other as an override — both get first-class parallel treatment in the CSS.
- **"Download" means output only.** Use "download" exclusively for saving a processed wordlist from Grawlix to disk (`downloadMergedWordlistFromPanel`, `downloadIndividualWordlist`, etc.). Use "fetch" for getting a wordlist into Grawlix from a URL (`fetchWordlist`), and "import" for the user loading a file. Template properties that refer to a third-party source page use `sourcePage` / `sourceNote`.

## Component architecture

The JS is organized into two patterns:

**HTML builders** (`buildXxxHTML`) — pure functions that return HTML strings. Stateless. Used for repeated elements and sub-components inside template literals.

**Lifecycle components** — own their DOM subtree, generate their own HTML, and wire their own events. Two forms:
- *IIFE* (`const XxxComponent = (() => { ... })()`) — singletons: dialogs, panels, sidebars
- *Class* (`class XxxComponent`) — multi-instance: scrollers, rule editors, word tables

Every lifecycle component **creates its own DOM element** (`document.createElement(...)`) and appends it to the document at init time. Dialog and overlay elements are **never** baked into the static HTML body — if you're adding a dialog, create it in JS, not in HTML.

All builders live in the `// ─── Components ───` section. Nothing outside a component should reach into its DOM subtree.

**Dialog helpers** — `createDialog(id, opts)` returns `{el, body}` and delegates dismiss clicks (backdrop, `.dialog-close-btn`, `.dialog-cancel-btn`) to close the dialog. `showDialog(el, onClose?)` opens the dialog: captures the opener for refocus-on-close, clears `el.returnValue`, runs an optional close callback, and falls back to focusing the dialog body itself when no descendant has `autofocus`. Put `autofocus` on the primary input/button if there is one — otherwise the helper handles initial focus. Don't manually wire backdrop close, dismiss-button onclick, `tabIndex=-1`, or post-`showModal` `.focus()` calls.

**Promise-returning dialogs** (Confirm, Alert, Download, MergeConflict) wrap their body in `<form method="dialog">`. Result-producing buttons declare their result via the standard `value` attribute; the browser closes the dialog and sets `el.returnValue` to the clicked button's value on submit. The close callback reads `el.returnValue` to resolve the promise. The X close button stays *outside* the form and is `type="button"`; cancel buttons are inside the form but `type="button"` so they close via `.dialog-cancel-btn` delegation rather than submitting an empty value. For dialogs whose primary button has a computed result (Download), do the harvest in the close callback after checking `el.returnValue === 'ok'`.

## Understanding Grawlix

Before making changes to Grawlix, read the help modal in `site/index.html` for a description of all user-facing features. Grawlix today serves two activities: building a unified wordlist (curation, rescoring, merging, downloading) and using it as a construction aid (search/filter while filling a grid). The help dialog HTML lives inside the `HelpModal` IIFE — search for `const HelpModal` to find it.

When you add or change a user-facing feature, update the relevant slide in the help modal to reflect it.

Documentation lives in `docs/`:

- **`docs/design.md`** — present-tense design documentation: UI shape, architecture, and the *whys* behind them. Single home for distilled design content.
- **`docs/manual.md`** — user-facing manual. Plain Markdown today; eventually will become an in-app manual.
- **`docs/plans/`** — forward-looking design docs for work that hasn't shipped. Speculative, future-tense. Once a plan ships, the `distill-design-doc` skill folds it into `design.md` and/or `manual.md`.
- **Top level of `docs/`** — the index plus reference catalogues that don't fit elsewhere.

See [`docs/README.md`](docs/README.md) for the index. Read the relevant plan or the design doc before making changes that touch its area, or when brainstorming UI shape or feature placement (adjacent content may share screen real estate or constrain the answer).
