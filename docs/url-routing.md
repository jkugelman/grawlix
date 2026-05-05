# URL routing & deep links

## What this is

Use the History API to keep the URL in sync with app state. Any view that's worth bookmarking or sharing — All Merged with a search applied, a Workshop tool with its inputs, the help modal, the reference manual — becomes a URL. Browser back/forward navigates between those views naturally.

The URL is the serialized answer to "where are you and what are you looking at."

## Scope

**In scope (URL-addressable):**
- All Merged view, including search query and whole-word toggle
- Workshop mode, selected tool, and tool inputs
- Help modal (welcome tour)
- Reference manual
- Settings dialog

**Out of scope (no URL representation):**
- Individual list views — neither publisher lists nor user-imported lists. Lists are local state; sharing a link to "STWL with this filter" implies the recipient has STWL loaded, and the moment we encode a list selection in the URL we're either silently degrading on the recipient's end or pretending we're not. Cleaner to make All Merged the only library surface that participates.
- My Edits — same reasoning. Local-only state.
- Confirmation dialogs and transient popovers (cell popovers, list-card menus, etc.). These are overlays, not views.
- Scroll position within a result table.
- Edit-in-progress state (open inline editors).

## URL schema

Hash-based routing. GitHub Pages has no server-side routing, so deep paths would 404 on direct load. Hash routing is the standard escape hatch and keeps the structure path-like.

The hash contains a path-like prefix followed by query parameters:

```
/#/                           → All Merged, no search
/#/?q=CAT&w=1                 → All Merged, search "CAT", whole word
/#/workshop                   → Workshop, no tool selected
/#/workshop?tool=anagram&w=LINDSEY
                              → Workshop, anagram tool, input LINDSEY
/#/tour                       → Welcome tour open over current view
/#/help                       → Reference manual open over current view
/#/help?section=search-syntax → Reference manual, scrolled to a section
/#/settings                   → Settings dialog open over current view
```

Dialog routes (`/help`, `/manual`, `/settings`) are layered: closing the dialog reverts to whatever the URL was before it opened, not to the root. Implementation-wise, opening a dialog `pushState`s a new entry; closing it calls `history.back()` if the current entry is the dialog, otherwise just removes the dialog parameter via `replaceState`.

## Push vs. replace

- **`pushState`** when the user makes a navigational choice: switching between Library and Workshop, picking a different Workshop tool, opening a dialog, refining a Workshop result chain (each step is its own history entry — back peels off one refinement at a time, matching the stack-based model in workshop.md).
- **`replaceState`** when the user is tweaking inputs within the current view: typing in the search box, editing tool inputs, toggling whole-word. Debounced ~250ms so the URL bar doesn't flicker per keystroke.

The litmus test: if a reasonable user would expect the back button to return them to the previous state, push. If they'd expect back to skip past the tweak entirely, replace.

## Load behavior

On page load:

1. Parse the URL hash into a route + params.
2. Restore base app state from localStorage and IndexedDB as today (lists, rules, selected list, settings).
3. Apply the URL on top: select the right mode/view/tool, populate search inputs, open dialogs.
4. Persist any state the URL just changed (e.g. selected mode) so a subsequent reload without a URL hash lands the user in the same place.

**URL wins over localStorage** on conflict. If localStorage says the user was last in the Library and the URL says `/#/workshop`, the URL wins and the user lands in the Workshop. The new mode is then persisted.

If the URL references something that no longer exists (a removed Workshop tool, an unknown route), fall back to the closest sensible default and toast a brief message: *"That link references something that's no longer available."* See **Stale links** below.

## Stale links & tool aliases

Once a URL schema is public, removing things in it is a breaking change. The rule:

- **Don't remove Workshop tools.** If a tool is superseded, keep it as a thin alias that redirects to the new tool, or keep it indefinitely.
- **Don't rename Workshop tool IDs.** If a tool's display name changes, the URL ID stays.
- **If a rename or removal is unavoidable**, register the old ID in an alias table that maps to the new ID (or to a sensible fallback) and `replaceState` the URL to the canonical form on load.

Tool IDs in URLs should be stable, lowercase, hyphenated slugs (`anagram`, `beheadment`, `phrase-parsing`) — not display names.

## Search query encoding

Grawlix search syntax includes `?`, `#`, `@`, `*`, `[`, `]`. Several of these are reserved in URLs — `#` in particular conflicts with the hash delimiter. Use `encodeURIComponent` for all parameter values; on parse, decode once. Standard, no special handling needed. Worth a passing test: a search containing `#` round-trips through the URL correctly.

## Workshop participation (deferred details)

The Workshop URL shape (`/#/workshop?tool=<id>&<tool-specific-params>`) is sketched here, but the per-tool param schemas are owned by the Workshop plan and finalized as each tool lands. Each tool gets:

- A stable URL ID (slug).
- A serialization function: tool inputs → query params.
- A deserialization function: query params → tool inputs.

Result chaining (workshop.md "Brainstorming" section) interacts with routing: each refinement step pushes a history entry so back peels off one step. Exact URL representation of a chain (probably a sequence of `?step1=...&step2=...` or a single encoded blob) is a Workshop-design question, not a routing-infrastructure question.

## Implementation sketch

A single `Router` IIFE in the `// ─── Components ───` section, owning:

- **Parse:** `parseHash() → { route, params }` reading `location.hash`.
- **Serialize:** `buildHash({ route, params }) → string` producing the canonical hash form.
- **Push/replace:** `navigate(route, params, { replace })` wrapping `history.pushState` / `replaceState`.
- **Listen:** a `popstate` handler that re-applies the URL to app state without itself calling push/replace.
- **Subscribe:** a small pub/sub so views can react to route changes (e.g. Workshop receiving "tool changed to anagram").

Existing state-mutation entry points (search input handler, tool switch, mode toggle, dialog open/close) call into the Router instead of (or in addition to) updating their own local state. The `popstate` handler routes through the same code paths so initial-load and back/forward share one codepath.

The Router lives alongside `state` — it is *not* a replacement for `state`. State remains the source of truth for app behavior; the URL is a serialized projection of the navigable subset of state.

## Phasing

1. **Router skeleton + All Merged.** Stand up the Router IIFE, parse/serialize/navigate, `popstate` handler. Wire just the search query and whole-word toggle. Validate the round-trip and the debounce behavior.
2. **Dialogs.** Help, manual, settings. Layered routes, back-button-closes behavior.
3. **Mode switching.** Once the Library/Workshop switcher exists, route on it.
4. **Workshop tools.** Per-tool serialization as each tool lands.
5. **Workshop result chains.** Once chaining UI exists, push per refinement step.

Phase 1 is small and self-contained — a good first commit, independent of any Workshop work.

## Open questions

- **URL changes from popstate vs. user-initiated:** the Router needs to distinguish "URL changed because the user clicked back" from "URL changed because the user typed in the search box" to avoid feedback loops. A simple flag during programmatic navigation should suffice; verify on implementation.
- **Refresh during typing:** if the URL is `replaceState`d on a debounce and the user refreshes mid-debounce, they get the pre-debounce URL. Acceptable — at most they lose the last ~250ms of typing. Worth confirming nobody expects otherwise.
- **Dialog-over-Workshop URLs:** opening Help while in `/#/workshop?tool=anagram&w=LINDSEY` should produce something like `/#/workshop?tool=anagram&w=LINDSEY&dialog=help` (dialog as a layered query param) rather than replacing the route. Concrete encoding TBD when we wire dialogs.
