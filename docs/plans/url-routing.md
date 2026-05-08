# URL routing & deep links

**Status.** The Router foundation ships today: the main page's search pattern, whole-word toggle, and score filter round-trip via the query string. See [`../design.md`](../design.md#url-state) for the present-tense description. The remainder of this doc covers the work that hasn't shipped — how the tool stack will encode once tools exist.

## Scope (still pending)

**In scope:**
- Tool stack: ordered list of tools and their inputs (see [`tools.md`](tools.md))
- Result-view filters beyond `score=`: future siblings like `length=`, `tier=` slot in alongside it.

**Out of scope** is the same set already documented in [`../design.md`](../design.md#url-state) — dialogs, selected wordlist, scroll position, edit-in-progress state, transient popovers.

## URL schema (tool stack)

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

**Tools without inputs** (Palindromes, Anagram families, etc.) appear as a bare key with no `=` at all: `?palindromes`. URLSearchParams treats it as an empty-value entry, which is what we want.

**Empty Search is a no-op pipeline step**, so it doesn't appear in the URL. The UI invariant "always render a Search row at the bottom" is a presentation rule applied after parsing: if the parsed stack doesn't end in a Search, the UI appends an empty one for display. The URL stays minimal for the 95% case (`?anagram=LINDSEY` doesn't carry a redundant trailing `&search=`).

Each tool gets:

- A stable URL key (slug) — lowercase, hyphenated (`anagram`, `beheadment`, `phrase-parsing`).
- A declared shape — has-input or no-input.
- A serialization function: tool inputs → URL value.
- A deserialization function: URL value → tool inputs.

All values pass through `encodeURIComponent`. Grawlix search syntax includes `?`, `#`, `@`, `*`, `[`, `]`, `&` — several of which are reserved in URLs and need encoding.

Multi-input tools (regex with min-length, anagram with bank letters, etc.) use a value-internal delimiter (likely `:` or `|`) — bikeshed deferred to `tools.md` when the first such tool lands.

## Stale links & tool aliases

Once a URL schema is public, removing things in it is a breaking change. The rule:

- **Don't remove tools.** If a tool is superseded, keep it as a thin alias that redirects to the new tool, or keep it indefinitely.
- **Don't rename tool keys.** If a tool's display name changes, the URL key stays.
- **If a rename or removal is unavoidable**, register the old key in an alias table that maps to the new key (or to a sensible fallback) and `replaceState` the URL to the canonical form on load.

If a parsed URL references a tool key that no longer exists, drop that entry and surface a brief toast: *"That link references a tool that's no longer available."* The rest of the stack still renders.

## Filters in the URL

Result-view filters (`score=` today; future `length=`, `tier=`) live in the URL as ordinary named params alongside tool keys. They aren't pipeline rows — they apply to the bottom row's output regardless of position — so there's no special-case ordering rule. They serialize, parse, and round-trip the same way any other URL param does.

## Phasing

1. **Router skeleton + Search row.** ✅ Shipped — the Router foundation plus the permanent Search row's pattern and whole-word toggle, and the `score=` filter.
2. **Stack growth.** Adding/removing rows from the gallery touches the Router. Each tool implements its serialize/deserialize as it lands.

## Open questions

- **Refresh during typing.** If the URL is `replaceState`d on a debounce and the user refreshes mid-debounce, they get the pre-debounce URL. Acceptable — at most they lose the last ~250ms of typing.
- **Multi-input encoding.** Tools with multiple inputs (regex with min-length, anagram with bank letters) need a value-internal delimiter or named subkeys. Deferred to the first such tool — owned by `tools.md`.
- **Whole-word encoding.** Today shipped as a bare top-level key `whole-word`; works for the single permanent Search row but won't compose if a stack ever holds two Search rows. The eventual fix is the multi-input encoding above (likely `search=CAT:w` or similar). Revisit when chaining a Search above a transform becomes possible.
