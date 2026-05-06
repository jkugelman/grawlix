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

The hash carries the tool stack and result-view filter as query parameters:

```
/#/                                        → empty stack, no filter (rare — see Load behavior)
/#/?stack=search:CAT                       → one Search row, pattern CAT
/#/?stack=search:CAT|anagram:LINDSEY       → Search then Anagram
/#/?stack=anagram:LINDSEY|beheadment       → Anagram then Beheadment (no input)
/#/?stack=search:CAT&min=40                → Search row, min-score filter on results
```

Per-tool input encoding inside `stack=` is owned by `tools.md` and finalized as each tool lands. Each tool gets:

- A stable URL ID (slug) — lowercase, hyphenated (`anagram`, `beheadment`, `phrase-parsing`).
- A serialization function: tool inputs → URL fragment.
- A deserialization function: URL fragment → tool inputs.

The pipe-delimited form sketched above is one option; a numbered-keys form (`?t1=search&q1=CAT&t2=anagram&q2=LINDSEY`) is another. Decision deferred to the first tool implementation. Either way, all values pass through `encodeURIComponent` — Grawlix search syntax includes `?`, `#`, `@`, `*`, `[`, `]`, several of which are reserved in URLs (`#` in particular conflicts with the hash delimiter).

## Always replace

Only `replaceState` is used. Every change to the tool stack — adding a row, editing an input, removing a row, adjusting min-score — replaces the URL in place. No history entries are pushed; the browser's back button does what it would do on any single-page site (navigate away from Grawlix), not navigate within the stack.

The visible tool rows are the user's history. Removing a row is the explicit undo; a back button would be redundant or actively confusing ("did I lose my whole stack?"). Stack edits debounce ~250ms so the URL bar doesn't flicker per keystroke.

## Load behavior

On page load:

1. Parse the hash into stack-config + filter.
2. Restore base app state from localStorage and IndexedDB as today (lists, rules, selected list, settings).
3. Apply the URL on top: build the rows, populate inputs, run the pipeline.

If the URL has no `stack` param, the app falls back to the default landing — one pre-populated Search row (see `tools.md`). A truly empty `/#/` only happens when the user has explicitly removed the default Search row.

If the URL references a tool that no longer exists (a removed tool, an unknown ID), drop that row and surface a brief toast: *"That link references a tool that's no longer available."* The rest of the stack still renders. See **Stale links** below.

## Stale links & tool aliases

Once a URL schema is public, removing things in it is a breaking change. The rule:

- **Don't remove tools.** If a tool is superseded, keep it as a thin alias that redirects to the new tool, or keep it indefinitely.
- **Don't rename tool IDs.** If a tool's display name changes, the URL ID stays.
- **If a rename or removal is unavoidable**, register the old ID in an alias table that maps to the new ID (or to a sensible fallback) and `replaceState` the URL to the canonical form on load.

## Implementation sketch

A single `Router` IIFE in the `// ─── Components ───` section, owning:

- **Parse:** `parseHash() → { stack, filter }` reading `location.hash`.
- **Serialize:** `buildHash({ stack, filter }) → string` producing the canonical hash form.
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
- **Stack encoding format.** Pipe-delimited (`stack=search:CAT|anagram:LINDSEY`) vs. numbered keys (`t1=search&q1=CAT&t2=anagram&q2=LINDSEY`). Decision deferred to the first tool implementation; readability of shared links is the deciding factor.
