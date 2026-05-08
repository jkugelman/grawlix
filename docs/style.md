# Coding style

Conventions Grawlix code follows. Pure formatting and naming choices live here; architectural rules (cache contracts, component shapes, persistence layout, reactivity) live in [`design.md`](design.md).

The line between style and architecture is sometimes blurry. When in doubt, the question is "would someone implementing the same feature differently need to follow this?" If yes, it's architecture. If it's "we just like it this way," it's style.

## File layout

All code lives in [`site/index.html`](../site/index.html). Order inside the file:

1. `<style>` block.
2. Minimal HTML body — the app shell only. No dialogs or overlays — components create those in JS.
3. `<script>` block.

No build step, no npm, no frameworks.

## Banner comments

Major sections of the `<script>` block are delimited by full-width banner comments at column 0:

```
// ─── Parsing ─────────────────────────────────────────────────────────────────
```

Sub-sections inside a component or other indented scope use a shorter form, two dashes, indented to match the surrounding code:

```
  // ── Rail event delegation ─────────────────────────────────────────────────────
```

These are anchors for grepping and for orientation; keep them stable.

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

**No inline `style="..."` attributes** — add CSS to the `<style>` block instead.

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

The choice of word matters and is enforced consistently.

- **Download** — output only. Saving from Grawlix to disk (`downloadMergedWordlistFromPanel`, `downloadIndividualWordlist`).
- **Fetch** — pulling a wordlist into Grawlix from a URL (`fetchWordlist`).
- **Import** — the user loading a file from disk into Grawlix.
- **Source page** — third-party page that hosts a wordlist; the property is `sourcePage` / `sourceNote`.
- **Wordlist** is the canonical noun, both in UI strings and in code identifiers. Older "source"/"list" naming was retired across the codebase.

## Commit messages

- Conventional commits.
- **No parenthetical scope.** Use `fix:` not `fix(rail):`.
- Lowercase subject, imperative mood.
- Bodies are appreciated for most commits, but subject-only is fine if the body adds nothing useful.
