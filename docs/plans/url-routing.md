# URL routing & deep links

## What this is

Use the History API (`replaceState` only) to keep the URL in sync with the tool stack. A user pasting a Grawlix link into a chat reproduces what the sender was looking at: same tools, same inputs, same order. Refreshing the page lands you back where you were.

The URL is the serialized answer to "what's in your tool stack."

## Scope

**In scope (URL-addressable):**
- Tool stack: ordered list of tools and their inputs (see `tools.md`)
- Result-view filter: minimum-score

**Out of scope (no URL representation):**
- Dialogs — Welcome tour, reference manual, settings, Manage sources, Sync & backup. These are transient UI state. Open them how you opened them; close them when you're done. No deep link, no history entry. KISS.
- Selected source from the left-rail dropdown. Sharing a link to "Anagram of LINDSEY in STWL" implies the recipient has STWL loaded; we don't pretend otherwise. The stack always reads from the recipient's currently-selected source (default `All`).
- My Edits, individual list views, Manage sources state — local-only.
- Confirmation dialogs and transient popovers (cell popovers, list-card menus, etc.).
- Scroll position within a result table.
- Edit-in-progress state (open inline editors).

## URL schema

Hash-based routing. GitHub Pages has no server-side routing, so deep paths would 404 on direct load. Hash routing is the standard escape hatch and keeps the structure path-like.

The hash is a **pseudo-path** — the tool stack rendered as ordered path segments, with result-view filters in a trailing query string:

```
/#/                                        → empty stack (just the permanent Search, empty)
/#/search/CAT                              → permanent Search "CAT"
/#/anagram/LINDSEY                         → Anagram, then permanent Search (empty)
/#/search/CAT/anagram/LINDSEY              → Search "CAT" → Anagram → permanent Search (empty)
/#/anagram/LINDSEY/search/DOG              → Anagram → permanent Search "DOG"
/#/anagram/LINDSEY/palindromes             → Anagram → Palindromes (no input) → permanent Search (empty)
/#/anagram/LINDSEY?min=40                  → Anagram with min-score 40 on results
```

Path segments come in tool/input pairs. Tools that take no input (Palindromes, Anagram families, etc.) occupy a single segment; the parser knows each tool's arity from the tool registry.

The URL encodes the **actual stack content**, not the rendered UI. The permanent Search row is just the last row of the stack — when its input is empty, no `search/...` segment appears at all (empty Search is a no-op pipeline step). The UI invariant — "always render a Search row at the bottom" — is a presentation rule that runs after parsing: if the parsed stack doesn't end in a Search, the UI appends an empty one for display. This keeps URLs minimal for the 95% case (`/#/anagram/LINDSEY` doesn't carry a redundant trailing `/search/`) and avoids two encodings for "the permanent search."

Each tool gets:

- A stable URL ID (slug) — lowercase, hyphenated (`anagram`, `beheadment`, `phrase-parsing`).
- A declared arity (number of inputs).
- A serialization function: tool inputs → URL segment(s).
- A deserialization function: URL segment(s) → tool inputs.

All values pass through `encodeURIComponent` — Grawlix search syntax includes `?`, `#`, `@`, `*`, `[`, `]`, several of which are reserved in URLs (`#` in particular conflicts with the hash delimiter; `/` is a path separator).

Multi-input tool encoding (regex with min-length, anagram with bank letters, etc.) is bikeshed-deferred to `tools.md` when the first such tool lands. Likely shape: a segment-internal delimiter or named subkeys.

## Always replace

Only `replaceState` is used. Every change to the tool stack — adding a row, editing an input, removing a row, adjusting min-score — replaces the URL in place. No history entries are pushed; the browser's back button does what it would do on any single-page site (navigate away from Grawlix), not navigate within the stack.

The visible tool rows are the user's history. Removing a row is the explicit undo; a back button would be redundant or actively confusing ("did I lose my whole stack?"). Stack edits debounce ~250ms so the URL bar doesn't flicker per keystroke.

## Load behavior

On page load:

1. Parse the hash path into an ordered list of `(toolId, inputs)` pairs, plus the trailing query into filters.
2. Restore base app state from localStorage and IndexedDB as today (lists, rules, selected list, settings).
3. Apply the URL on top: build the rows, populate inputs, append an empty Search row if the parsed stack doesn't end in one (UI invariant), run the pipeline.

`/#/` (and the bare site URL) lands the user with just the permanent empty Search row — the same as today's default landing.

If the URL references a tool ID that no longer exists, drop that segment-pair and surface a brief toast: *"That link references a tool that's no longer available."* The rest of the stack still renders. See **Stale links** below.

## Stale links & tool aliases

Once a URL schema is public, removing things in it is a breaking change. The rule:

- **Don't remove tools.** If a tool is superseded, keep it as a thin alias that redirects to the new tool, or keep it indefinitely.
- **Don't rename tool IDs.** If a tool's display name changes, the URL ID stays.
- **If a rename or removal is unavoidable**, register the old ID in an alias table that maps to the new ID (or to a sensible fallback) and `replaceState` the URL to the canonical form on load.

## Implementation sketch

A single `Router` IIFE in the `// ─── Components ───` section, owning:

- **Parse:** `parseHash() → { stack, filter }` reading `location.hash`. Walks path segments, consuming `arity + 1` segments per tool from a tool registry.
- **Serialize:** `buildHash({ stack, filter }) → string` producing the canonical hash form. Drops a trailing empty Search row.
- **Replace:** `navigate({ stack, filter })` wrapping `history.replaceState`. Debounced ~250ms for input-tweak callers; instant for structural changes (row added/removed).
- **Listen:** a `hashchange` handler for the rare case of a user pasting a different deep link into the URL bar without reloading. Routes through the same code path as initial load.

Existing state-mutation entry points (adding a row, editing a row's input, removing a row, changing min-score) call into the Router after updating their own state.

The Router lives alongside `state` — it is *not* a replacement. State remains the source of truth for app behavior; the URL is a serialized projection of the tool stack and result filter.

## Phasing

1. **Router skeleton + Search row.** Stand up the Router IIFE, parse/serialize/navigate, hashchange handler. Wire the pre-populated Search row's pattern and whole-word toggle, plus the min-score filter. Validate round-trip and debounce.
2. **Stack growth.** Adding/removing rows from the gallery touches the Router. Each tool implements its serialize/deserialize as it lands.

Phase 1 is small and self-contained — a good first commit, independent of any further tool gallery work.

## Open questions

- **Refresh during typing.** If the URL is `replaceState`d on a debounce and the user refreshes mid-debounce, they get the pre-debounce URL. Acceptable — at most they lose the last ~250ms of typing.
- **Multi-input encoding.** Tools with multiple inputs (regex with min-length, anagram with bank letters) need a segment-internal delimiter or named subkeys. Deferred to the first such tool — owned by `tools.md`.
