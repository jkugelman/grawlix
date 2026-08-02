# Coding style

Conventions Grawlix code follows. Pure formatting and naming choices live here; architectural rules (cache contracts, component shapes, persistence layout, reactivity) live in [`design.md`](design.md).

The line between style and architecture is sometimes blurry. When in doubt, the question is "would someone implementing the same feature differently need to follow this?" If yes, it's architecture. If it's "we just like it this way," it's style.

## File layout

Code is ES modules under [`site/src/`](../site/src/), organized by dependency layer (`core < engine < data < model < ui < app`) — see [`design.md` § Code structure](design.md#code-structure) for the layering rules and whys. [`site/index.html`](../site/index.html) is just the shell:

1. The synchronous `<head>` FOUC script — a plain non-module inline script, never converted to a module.
2. `<link>`s to [`site/css/`](../site/css/).
3. The app-shell HTML body only. No dialogs or overlays — components create those in JS.
4. `<script type="module" src="src/main.js">`.

Per-file conventions:

- **Imports at the top**, before any other code. A module imports only from layers below its own (or sibling `ui/` modules, where circular imports are allowed); never from a layer above it.
- **Importing a module only *defines*.** No DOM, no `effect()`, no `window` touch, no cross-layer reach at import time — all side effects run from `main.js`'s `boot()`. (Pure, idempotent top-level computation is fine.)
- Each module is `'use strict';` and ends its exports as named exports (per-tool files in `engine/tools/` `export default` their definition).

Dev serves the raw module graph statically (no build step in the local loop); `npm run build` bundles it with esbuild for deploy. No runtime framework.

## Banner comments

Major sections within a module are delimited by full-width banner comments at column 0:

```
// ─── Parsing ─────────────────────────────────────────────────────────────────
```

Sub-sections inside a component or other indented scope use a shorter form, two dashes, indented to match the surrounding code:

```
  // ── Event delegation ─────────────────────────────────────────────────────
```

[`app.css`](../site/css/app.css) carries the same banners in CSS comment syntax, one per family of rules, all padded to a uniform width:

```
/* ─── Tool rows ─────────────────────────────────────────────────────────────── */
```

Clusters within a section keep their own short label (`/* Split button */`, `/* Segmented control */`). Those name the concept in plain English, which is what a search for an existing component lands on — see [`components.md`](components.md).

These are anchors for grepping and for orientation; keep them stable. A small single-purpose module needs no banner; use them where a file has several distinct sections.

## Comments

**Don't over-comment.** Well-named identifiers and short functions do the work; self-explanatory code doesn't need commentary.

Comment the **why**, not the **what** — a reader can see *what* the code does, but *why* (hidden constraints, invariants, workarounds, alternatives tried and rejected) vanishes silently and is expensive to reconstruct. The exception is when the *what* itself is hard to reconstruct: shape annotations on state vars, non-obvious sequencing, data flow that would otherwise require digging through other files to follow.

If removing a comment wouldn't confuse a reader, remove it.

## CSS

**Single-line by default.** One declaration block per line, properties space-separated:

```css
.stat { display: flex; flex-direction: column; gap: 2px; }
```

No line length limit.

**Multi-line is preserved for:**

- The CSS-variable palette blocks (`:root`, `html.dark-mode`, `html.light-mode`) — values are vertically aligned (`--bg:        #1e1e1e;`) so the palette reads as a table. Single-lining loses that.
- `@keyframes` blocks — nested structure can't be compacted.
- `@media` query wrappers — the wrapper stays multi-line; rules inside are still single-line.

**No inline `style="..."` attributes** - add CSS to [`site/css/`](../site/css/) instead. One exception: passing per-instance computed values (CSS custom properties for theming, pixel dimensions for sizing) into a class whose stylesheet rule reads them. The rule and any static declarations live in `site/css/`; the inline attribute carries only the varying values. Use this for color-tinted atoms (`style="--score-bg:${bg}; --score-fg:${fg}"` on a `.score-badge`) and measured-out elements (histogram bar heights). Don't use it as a shortcut for declarations that could just be a class.

**Dark mode and light mode get equal weight.** Both palettes are first-class. Don't treat one as the default and the other as an override.

## JavaScript

### Function declarations

- `function` declarations for top-level helpers, HTML builders (`buildXxxHTML`), and lifecycle-component methods.
- Arrow functions for short callbacks (event handlers, `.map`/`.filter` callbacks, internal one-liners).

### Naming

- localStorage keys are camelCase with a `grawlix_` prefix (e.g. `grawlix_darkMode`, `grawlix_scoreRange`, `grawlix_lastBackup`). The prefix exists because `localStorage` shares scope across all paths under a domain — including local `file://` — so unprefixed keys would collide.
- HTML builders are `buildXxxHTML`. Singleton lifecycle components are `XxxComponent` and are created via IIFE (`const XxxComponent = (() => { ... })()`). Multi-instance lifecycle components are `class XxxComponent`.

## Markdown documentation

- **Lines are unwrapped.** No soft wrap at 80/100 columns; let editors wrap visually. Hard line breaks are paragraph breaks, not flow control.

## Terminology

Terminology is enforced consistently across UI, code, and docs.

### Wordlist, entry, wordlist entry — the data model

These four terms get tangled because everyday usage overloads them. The definitions are pinned, and everything in code, UI, and docs follows from these.

- **Wordlist** — a file (or in-memory equivalent) listing crossword fill candidates with metadata. Format: `ENTRY;SCORE[;COMMENT]`, one per line. The canonical noun for a data source — JK's wordlist, XWordInfo's wordlist, the user's My Edits, the merged All Wordlists view. *Wordlist* is the crossword-community standard and is never renamed, even though the contents aren't strictly "words" (many entries are multi-word phrases). Code: `wordlist` everywhere — variable names, CSS (`.wordlist-card`), file/function names (`fetchWordlist`, `buildWordlistNameHTML`).
- **Entry** — the string itself. Just `CROSSWORD`, or `ICE CREAM`, or whatever fills the grid. The user thinks of "the entry CROSSWORD" colloquially; the data model carries two slots — `norm` (canonical letter form: lowercase `[a-z0-9]+`, accents stripped, spaces and punctuation removed — what tools key on) and `display` (the rich form as written: `ICE CREAM`, `Mötley Crüe` — `null` on plain wordlists, where the rendered string falls back to lowercase `norm`). UI strings: "Add entry", "Sort by Entry", "Edit entry", "Entry length filter". Sort key: `'entry'`. CSS: `.atom-entry`, `.col-entry`, `.entry-row`.
- **Wordlist entry** (`wlEntry`) — a single record within a wordlist: `{ norm, display, score, comment }`. The record carries the canonical letters, the rich form (or `null` for plain sources), and the entry's metadata. Variable name when a record is in scope: `wlEntry` (singular) or just `e` for tight closures. The plural is *entries* (`rawEntries`, `allEntries`) — context disambiguates from string-entries.
- **Word** (the English noun) — reserved for places where we literally mean an English word, not the data concept. Allowed: the "Whole word" / "Spans words" match modes (they constrain matches against a phrase's literal words), tool descriptions like "drop the first letter to get a new word", the `getInitials` helper that splits a publisher name on whitespace. Forbidden in record-data contexts.

The mental model: a *wordlist* contains *wordlist entries*; each wordlist entry's primary value is its *entry* string. "Entry" lives at two granularities (just the string, vs. the whole record) — the qualifier *wordlist* disambiguates when both are in play in the same scope.

### Entries table

The at-rest results display below the search bar. "Table" is loose: it's a div-based virtual scroller with grid pseudo-columns, not a real `<table>`. CSS: `.entry-row`, `.entry-headers`, `#entries-table-panel`, `.entries-table-rows`. See [`design.md` § Entries table](design.md#entries-table).

### Other conventions

- **Download** — output only. Saving from Grawlix to disk (`downloadMergedWordlistFromPanel`, `downloadIndividualWordlist`).
- **Fetch** — pulling a wordlist into Grawlix from a URL (`fetchWordlist`).
- **Import** — the user loading a file from disk into Grawlix.
- **Source page** — third-party page that hosts a wordlist; the property is `sourcePage` / `sourceNote`.

## Commit messages

- Conventional commits.
- **No parenthetical scope.** Use `fix:` not `fix(parser):`.
- Lowercase subject, imperative mood.
- Bodies are appreciated for most commits, but subject-only is fine if the body adds nothing useful.
