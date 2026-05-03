# Grawlix

**Live site:** https://grawlix.wtf (hosted via GitHub Pages)

Grawlix is a browser-based wordlist manager for crossword constructors. Wordlists in the wild are each scored on their own arbitrary scales, making it hard to combine them. Grawlix solves this with per-list rescoring rules that map everything to a common scale, then merges the results into a single unified view. It ships with curated default rules for four popular wordlists so most users get a good experience out of the box, with full customization available for those who want it.

All code lives in a single file: `docs/index.html`. Read and edit only that file.

## Architecture

One HTML file: `<style>` block, a minimal HTML body (app shell only — no dialog or overlay elements), then one big `<script>` block. No build step, no npm, no frameworks — plain HTML/CSS/JS that runs directly in the browser.

Sections within the `<script>` block are delimited by banner comments like:
```
// ─── Parsing ──────────────────────────────────────────
```

## Data model

`state` holds `inputLists` (the per-list data), `selected`, search state, and `outputScoring` (tier labels for the output list view). Each list has metadata, `rawEntries` (parsed words), and `rescoreRules`.

**List fields** — every input list carries:
- `dbKey` — opaque `crypto.randomUUID()` string; used exclusively as the IndexedDB storage key. Never appears in HTML or UI code. `state.selected` stores the selected list object (or `OUTPUT_ID`) — not the dbKey.
- `type` — `'edits'` for My Edits; absent for all regular input lists. Nothing uses a string constant like `EDITS_ID` anymore — check `list.type === 'edits'`.
- `icon` — HTML string (one of three SVG formats), or `''`. `buildInitialsIconHTML` returns a colored SVG rect with initials text; `buildEmojiIconHTML` returns an SVG with an emoji `<text>` node; preset image icons are `<img class="list-icon-img">` tags. Stored directly on the list. `getListIcon(list)` returns `list.icon` if set, otherwise auto-generates an initials icon. The color is derived by `colorSeed(obj)` = `obj.url || obj.originalFilename || obj.dbKey || obj.name` — same function works on both list objects and presets, ensuring preset-based lists look consistent for all users.
- `originalFilename` — the filename last used to import or fetch data into this list (e.g. `'jkugelman-wordlist.txt'`). Set by both `importToList` and `fetchList`. Used as the default download filename and as a fallback color seed. Importing a file clears `list.url`; a list is either auto-fetch or file-based, not both.
- `presetId` — optional weak reference to the preset last applied (`'xwi'`, `'jkugelman'`, etc.). Display/reset purposes only; never a behavioral gate.

**Presets** (`LIST_PRESETS`) — the four known wordlists (JK, XWI, STWL, Broda) are config bundles, not identities. Each has `id`, `name`, `icon`, `url`, `filenamePatterns`, `defaultRules`, and `neutralRules`. `getPreset(list)` looks up by `list.presetId`. There is no function that checks whether a list's key matches a preset — `getTemplate` is gone.

**Wordlist file format** — one entry per line:
```
WORD;SCORE
WORD;SCORE;COMMENT
```

**Rescore rules** map an input score range + optional word-length filter to an output score (or `'ignore'` to drop the entry). First matching rule wins; a catch-all is auto-appended.

## Persistence

- **localStorage** (prefix `grawlix_`): list metadata and settings. `persistMeta()` saves all list metadata.
- **IndexedDB**: raw wordlist text per list. Lists can be hundreds of thousands of words, too large for localStorage. `persistData(list, text)` saves one list's text, keyed by `list.dbKey`.

**Reset localStorage when needed during development.** Stale localStorage from a previous session can mask bugs — the app loads old serialized data and ignores code changes to field formats or defaults. Reset via Settings → Reset all data whenever you change: the format of a stored field (e.g. `icon` HTML format), default values set only on first boot (e.g. `EDITS_ICON`), or the shape of the stored metadata object.

## Key concepts

**My Edits** — a special list created automatically on first boot, identified by `list.type === 'edits'`. It has no rescore rules (scores pass through as-is). Clicking a score or comment cell in any view opens an inline editor; saving upserts the entry into My Edits. From the My Edits view the user can also add new words and delete entries (with undo). It is reorderable like any other list (position determines merge priority). The UI enforces: not deletable, always enabled.

**Override and rescore display** — When viewing an input list, score and comment cells always show the *effective* value (what actually appears in the merged output), not the raw value from that list. A red superscript asterisk (`*`) indicates the displayed value differs from what the list itself contains. An instant HTML popover (`#cell-popover`) explains why: the original score for rescored entries, or the overriding list's name for overrides. Both conditions can apply simultaneously. The overrideMap (built by `buildOverrideMap`) stores `{ listName, score, comment }` from the highest-priority list above the current one; a comment override only applies when that list has a non-empty comment. Editing an overridden cell pre-fills the input with the effective value (not the raw value) so the user is editing what actually matters — the result always lands in My Edits regardless.

**Output list** — `OUTPUT_ID = '__output__'` selects a union of all enabled lists, deduped by word. The highest rescored value wins; losers are shown faded with a tooltip. Displayed as "All Merged" in the UI.

**Score tiers** — `great` (≥60), `good` (≥50), `fair` (≥40), `meh` (≥30), `bad` (<30). Drive score badge colors via `data-tier` and `--score-{tier}-{bg,fg}` CSS vars.

**Search syntax** — `?` (any letter), `#` (consonant), `@` (vowel), `*` (any substring), `[abc]` (character class). Whole-word toggle anchors the pattern.

**Virtual scroller** — `VirtualScroller` renders only visible rows. Row height is fixed.

**Event delegation** — list card interactions (click, keydown, change, drag) use delegated listeners on `#lists-container`. At render time, `renderInputLists()` sets `card._list = list` on each `.list-card[data-list]` DOM element. Handlers retrieve the list via `e.target.closest('.list-card[data-list]')._list`. No list ID or `dbKey` appears in HTML attributes.

## CSS custom properties

All colors are CSS variables on `html.dark-mode` / `html.light-mode`. The naming convention:
- `--bg`, `--surface`, `--surface2` — background layers
- `--border`, `--border2`, `--border3` — border layers
- `--text`, `--muted`, `--faint` — text strength layers
- `--accent`, `--accent-hover` — brand purple
- `--score-{tier}-bg/fg` — score badge colors

## Commit messages

After completing changes that are ready to commit, always output a suggested commit message in conventional commit format (`feat:`, `fix:`, `refactor:`, `chore:`, etc.). Keep it concise. No parenthetical scope — just `fix:` not `fix(scope):`.

## Coding style

- **No inline styles.** Prefer adding CSS to the `<style>` block over `style="..."` attributes on elements.
- **Dark mode and light mode have equal weight.** Don't treat one as the default and the other as an override — both get first-class parallel treatment in the CSS.
- **"Download" means output only.** Use "download" exclusively for saving a processed wordlist from Grawlix to disk (`downloadOutputList`, `downloadIndividualList`, etc.). Use "fetch" for getting a wordlist into Grawlix from a URL (`fetchList`), and "import" for the user loading a file. Template properties that refer to a third-party source page use `sourcePage` / `sourceNote`.

## Component architecture

The JS is organized into two patterns:

**HTML builders** (`buildXxxHTML`) — pure functions that return HTML strings. Stateless. Used for repeated elements and sub-components inside template literals.

**Lifecycle components** — own their DOM subtree, generate their own HTML, and wire their own events. Two forms:
- *IIFE* (`const XxxComponent = (() => { ... })()`) — singletons: dialogs, panels, sidebars
- *Class* (`class XxxComponent`) — multi-instance: scrollers, rule editors, word tables

Every lifecycle component **creates its own DOM element** (`document.createElement(...)`) and appends it to the document at init time. Dialog and overlay elements are **never** baked into the static HTML body — if you're adding a dialog, create it in JS, not in HTML.

All builders live in the `// ─── Components ───` section. Nothing outside a component should reach into its DOM subtree.

## Understanding Grawlix

Before making changes to Grawlix, read the help modal in `docs/index.html` for a description of all user-facing features and the two main use cases. The help dialog HTML lives inside the `HelpModal` IIFE — search for `const HelpModal` to find it.

When you add or change a user-facing feature, update the relevant slide in the help modal to reflect it.
