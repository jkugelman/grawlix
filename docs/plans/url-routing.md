# URL routing & deep links

## What this is

Use the History API (`replaceState` only) to keep the URL in sync with the tool stack. A user pasting a Grawlix link into a chat reproduces what the sender was looking at: same tools, same inputs, same order. Refreshing the page lands you back where you were.

The URL is the serialized answer to "what's in your tool stack."

## Scope

**In scope (URL-addressable):**
- Tool stack: ordered list of tools and their inputs (see `tools.md`)
- Result-view filters: `score=` today (range syntax: `40`, `40-49`, `50+`); future siblings like `length=`, `tier=` slot in the same way

**Out of scope (no URL representation):**
- Dialogs — Welcome tour, reference manual, settings, Wordlists, Sync & backup. These are transient UI state. Open them how you opened them; close them when you're done. No deep link, no history entry. KISS.
- Selected wordlist from the left-rail dropdown. Sharing a link to "Anagram of LINDSEY in STWL" implies the recipient has STWL loaded; we don't pretend otherwise. The stack always reads from the recipient's currently-selected wordlist (default `All`).
- My Edits, individual wordlist views, Wordlists dialog state — local-only.
- Confirmation dialogs and transient popovers (cell popovers, wordlist-card menus, etc.).
- Scroll position within a result table.
- Edit-in-progress state (open inline editors).

## URL schema

Real query string on the canonical site URL — no hash. Grawlix is a single-page app with no actual page navigation, and paths in the URL would suggest sections that don't exist. GitHub Pages serves `index.html` regardless of query string, so deep-loading any URL works without server-side routing.

The tool stack is encoded as ordered query parameters, one per tool row. Tools with input use `key=value`; tools without input use a bare key (no `=`):

```
https://grawlix.wtf/                                  → empty stack (just the permanent Search, empty)
https://grawlix.wtf/?search=CAT                       → permanent Search "CAT"
https://grawlix.wtf/?anagram=LINDSEY                  → Anagram, then permanent Search (empty)
https://grawlix.wtf/?search=CAT&anagram=LINDSEY       → Search "CAT" → Anagram → permanent Search (empty)
https://grawlix.wtf/?anagram=LINDSEY&search=DOG       → Anagram → permanent Search "DOG"
https://grawlix.wtf/?anagram=LINDSEY&palindromes      → Anagram → Palindromes (no input) → permanent Search (empty)
https://grawlix.wtf/?anagram=LINDSEY&score=40+        → Anagram, with score range 40+ applied to results
```

**Order is significant.** Parameter order is pipeline order — `?search=CAT&anagram=LINDSEY` runs Search before Anagram; the reverse runs them the other way. This breaks the common reader expectation that query strings are unordered, but the URL is mostly machine-generated and read back by Grawlix. Users who notice aren't going to care.

**Repeated keys are fine.** Two regex filters become two `regex=` entries: `?regex=A.*Z&regex=.*ED`. Their relative order is preserved like everything else.

**Tools without inputs** (Palindromes, Anagram families, etc.) appear as a bare key with no `=` at all: `?palindromes`. Technically valid query syntax — most parsers, URLSearchParams included, treat it as an empty-value entry, which is what we want.

**Empty Search is a no-op pipeline step**, so it doesn't appear in the URL. The UI invariant "always render a Search row at the bottom" is a presentation rule applied after parsing: if the parsed stack doesn't end in a Search, the UI appends an empty one for display. The URL stays minimal for the 95% case (`?anagram=LINDSEY` doesn't carry a redundant trailing `&search=`).

Each tool gets:

- A stable URL key (slug) — lowercase, hyphenated (`anagram`, `beheadment`, `phrase-parsing`).
- A declared shape — has-input or no-input.
- A serialization function: tool inputs → URL value.
- A deserialization function: URL value → tool inputs.

All values pass through `encodeURIComponent`. Grawlix search syntax includes `?`, `#`, `@`, `*`, `[`, `]`, `&` — several of which are reserved in URLs and need encoding.

Multi-input tools (regex with min-length, anagram with bank letters, etc.) use a value-internal delimiter (likely `:` or `|`) — bikeshed-deferred to `tools.md` when the first such tool lands.

## Parsing

`URLSearchParams` (a built-in browser parser for `?k=v&k=v` strings) handles most of this — it preserves insertion order and tolerates bare keys, returning them with an empty value. The one wrinkle is that it normalizes `?palindromes` and `?palindromes=` to the same thing, but we don't need to distinguish them: a no-input tool is a no-input tool either way. If a future case needs the distinction, parsing `location.search` manually is straightforward — it's just a string after the `?`.

## Always replace

Only `replaceState` is used. Every change to the tool stack — adding a row, editing an input, removing a row, adjusting filters — replaces the URL in place. No history entries are pushed; the browser's back button does what it would do on any single-page site (navigate away from Grawlix), not navigate within the stack.

The visible tool rows are the user's history. Removing a row is the explicit undo; a back button would be redundant or actively confusing ("did I lose my whole stack?"). Stack edits debounce ~250ms so the URL bar doesn't flicker per keystroke.

## Load behavior

On page load:

1. Parse `location.search` into an ordered list of `(toolKey, value)` pairs.
2. Restore base app state from localStorage and IndexedDB as today (wordlists, rules, selected wordlist, settings).
3. Apply the URL on top: build the rows, populate inputs, append an empty Search row if the parsed stack doesn't end in one (UI invariant), run the pipeline.

A bare site URL with no query string lands the user with just the permanent empty Search row — the same as today's default landing.

If the URL references a tool key that no longer exists, drop that entry and surface a brief toast: *"That link references a tool that's no longer available."* The rest of the stack still renders. See **Stale links** below.

Because we only use `replaceState`, there's nothing to listen for at runtime — pasting a different Grawlix URL into the address bar triggers a normal page reload and runs the load path again. No `popstate` handler needed.

## Stale links & tool aliases

Once a URL schema is public, removing things in it is a breaking change. The rule:

- **Don't remove tools.** If a tool is superseded, keep it as a thin alias that redirects to the new tool, or keep it indefinitely.
- **Don't rename tool keys.** If a tool's display name changes, the URL key stays.
- **If a rename or removal is unavoidable**, register the old key in an alias table that maps to the new key (or to a sensible fallback) and `replaceState` the URL to the canonical form on load.

## Implementation sketch

A single `Router` IIFE in the `// ─── Components ───` section, owning:

- **Parse:** `parseURL() → stack` reading `location.search`. Walks parameters in order, looks each up in the tool registry, builds tool rows.
- **Serialize:** `buildQuery(stack) → string` producing the canonical query form. Drops a trailing empty Search row. Joins with `&`, uses bare-key form for no-input tools.
- **Replace:** `navigate(stack)` wrapping `history.replaceState(null, '', '?' + query)` — or `'/'` for an empty stack, to drop the trailing `?` entirely. Debounced ~250ms for input-tweak callers; instant for structural changes (row added/removed).

Existing state-mutation entry points (adding a row, editing a row's input, removing a row) call into the Router after updating their own state.

The Router lives alongside `state` — it is *not* a replacement. State remains the source of truth for app behavior; the URL is a serialized projection of the tool stack.

## Phasing

1. **Router skeleton + Search row.** Stand up the Router IIFE, parse/serialize/navigate. Wire the pre-populated Search row's pattern and whole-word toggle. Validate round-trip and debounce.
2. **Stack growth.** Adding/removing rows from the gallery touches the Router. Each tool implements its serialize/deserialize as it lands.

Phase 1 is small and self-contained — a good first commit, independent of any further tool gallery work.

## Filters in the URL

Result-view filters (`score=`, future `length=`, `tier=`) live in the URL as ordinary named params alongside tool keys. They aren't pipeline rows — they apply to the bottom row's output regardless of position — so there's no special-case ordering rule. They serialize, parse, and round-trip the same way any other URL param does.

## Open questions

- **Refresh during typing.** If the URL is `replaceState`d on a debounce and the user refreshes mid-debounce, they get the pre-debounce URL. Acceptable — at most they lose the last ~250ms of typing.
- **Multi-input encoding.** Tools with multiple inputs (regex with min-length, anagram with bank letters) need a value-internal delimiter or named subkeys. Deferred to the first such tool — owned by `tools.md`.
