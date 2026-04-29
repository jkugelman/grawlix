# Grawlix

Grawlix is a browser-based wordlist manager for crossword constructors. Wordlists in the wild are each scored on their own arbitrary scales, making it hard to combine them. Grawlix solves this with per-list rescoring rules that map everything to a common scale, then merges the results into a single unified view. It ships with curated default rules for four popular wordlists so most users get a good experience out of the box, with full customization available for those who want it.

All code lives in a single file: `grawlix.html`. Read and edit only that file.

## Architecture

One HTML file: `<style>` block, HTML body with dialogs, then one big `<script>` block. No build step, no npm, no frameworks — plain HTML/CSS/JS that runs directly in the browser.

Sections within the `<script>` block are delimited by banner comments like:
```
// ─── Parsing ──────────────────────────────────────────
```

## Data model

`state` holds `inputLists` (the per-list data), `selectedId`, search state, and `mergedScoring` (tier labels for the merged view). Each list has metadata, `rawEntries` (parsed words), and `rescoreRules`.

**Wordlist file format** — one entry per line:
```
WORD;SCORE
WORD;SCORE;COMMENT
```

**Rescore rules** map an input score range + optional word-length filter to an output score (or `'ignore'` to drop the entry). First matching rule wins; a catch-all is auto-appended.

## Persistence

- **localStorage** (prefix `grawlix_`): list metadata and settings. `persistMeta()` saves all list metadata.
- **IndexedDB**: raw wordlist text per list. Lists can be hundreds of thousands of words, too large for localStorage. `persistData(id, text)` saves one list's text.

## Key concepts

**Merged view** — `MERGED_ID = '__merged__'` selects a union of all enabled lists, deduped by word. The highest rescored value wins; losers are shown faded with a tooltip.

**Score tiers** — `great` (≥60), `good` (≥50), `fair` (≥40), `meh` (≥30), `bad` (<30). Drive score badge colors via `data-tier` and `--score-{tier}-{bg,fg}` CSS vars.

**Search syntax** — `?` (any letter), `#` (consonant), `@` (vowel), `*` (any substring), `[abc]` (character class). Whole-word toggle anchors the pattern.

**Virtual scroller** — `VirtualScroller` renders only visible rows. Row height is fixed.

## CSS custom properties

All colors are CSS variables on `html.dark-mode` / `html.light-mode`. The naming convention:
- `--bg`, `--surface`, `--surface2` — background layers
- `--border`, `--border2`, `--border3` — border layers
- `--text`, `--muted`, `--faint` — text strength layers
- `--accent`, `--accent-hover` — brand purple
- `--score-{tier}-bg/fg` — score badge colors

## Coding style

- **No inline styles.** Prefer adding CSS to the `<style>` block over `style="..."` attributes on elements.
- **Dark mode and light mode have equal weight.** Don't treat one as the default and the other as an override — both get first-class parallel treatment in the CSS.
- **Avoid duplicating functionality.** Unify JS, HTML, and CSS when reasonable. Prefer a single abstraction over copy-pasted variants to keep the UI consistent and maintainable.
