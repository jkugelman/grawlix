# Tools (gallery & mining)

Grawlix's mining side: anagrams, regex, beheadments, curtailments, and a long tail of letter/sound/meaning tricks for both **filling** (looking up words and noting score corrections while you work a grid) and **theme generation** (mining the wordlist for ideas).

Inspiration: [Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson. See [`../wordlisted.md`](../wordlisted.md) for a full breakdown of its search modes. Grawlix will cover similar ground and add its own tools.

The gallery is where Grawlix's [project goal](../../README.md#goals) — democratize wordlist manipulation — does most of its work. Constructors who program can write Python to anagram, behead, phonetic-substitute, semantic-filter against their wordlists. The gallery's job is to put those moves in non-programmers' hands. Filter when evaluating a candidate tool: *would a programmer reach for this often enough to write a script?* If yes, it probably belongs.

## Status

Chrome is shipped: the left-rail gallery (every card carrying its tool's icon), the main-pane tool stack, hover previews, animations. The current `TOOLS` catalog drives both the gallery and the stack rows, so adding a card today is one record. Icons are emoji; switching to custom SVG would mean changing only the `icon` field per entry. The word-list display where tool output renders also shipped — atoms, sort, click-to-edit popover. See [`design.md` § Tool gallery & stack](../design.md#tool-gallery--stack) and [`design.md` § Word list](../design.md#word-list) for those parts' shape and rationale. Everything below is forward-looking — the plugin/API model, tool execution, the rest of the catalog, chaining policies, pair/group output formats, and downstream features.

---

## Pipeline behavior (unshipped)

The first row reads from the wordlist selected in the left-rail dropdown (`All` by default). Each subsequent row transforms the previous row's output. The results list shows the bottom row's output. Click order in the gallery determines pipeline order, top-to-bottom. To pre-filter an existing tool's input, the user starts over (clear, then click Search, then `+` the new tool); no prepend gesture.

**Live result filtering** is the everyday case — fire up Anagram, type LINDSEY, scroll the thousand results, type a substring in the bottom search row to live-filter down. The search bar functions as the result filter for whatever's above it.

**Reordering.** Order matters in a pipeline. To change order, the user removes rows (X) and re-adds them. Drag handles are deliberately not provided — chaining is a 2%-case gesture and reordering is rarer still; the design surface isn't worth the touch/keyboard-accessibility complexity.

**Tools without inputs** (Palindromes, Anagram families, etc.) still get a row carrying the tool name and an X — no input fields. Composes cleanly: `Search → Palindromes` lists palindromes within the search results.

**Scores come along.** Results show scores from `All` (the merged wordlist). This is Grawlix's superpower over Wordlisted — a user can see at a glance that their anagram is a 70 vs. a 30, and can click a result to add it to My Edits.

**Score range filters the displayed output, not the pipeline.** The histogram-driven score control sits below the list and applies after the bottom row produces results. It's not a stack row, doesn't get its own row per Search, and isn't expressible per-tool — one filter, applied once, on what's about to render. For pair and group output, it filters on min(score) — the row qualifies if its worst-scoring atom falls in range. (Pre-pipeline score filtering — "anagrams of LINDSEY drawn only from score-50+ words" — would be a separate `score_filter(min, max)` tool. Not in the catalog yet; surface if the workflow appears.)

---

## Gallery — unshipped pieces

**Category picker.** A fixed category menu at the top of the rail (Anagrams & letter banks, Letter patterns, Pairs, Oddities, etc.). Clicking a category swaps the cards displayed below; the menu itself never moves. Spatial stability — categories live in the same place every time, cards stay visible while working, and the rail's full width goes to tools. Matches the user's settle-into-a-tool-set pattern: a constructor with a theme idea picks the relevant category once and stays there.

*Alternatives evaluated:*

- *Inline accordion* (rejected) — categories collapsed; clicking a header expands cards in place, pushing others down. Items shifting under the cursor as sections open/close fights spatial recall and muscle memory.
- *Card list* (viable fallback) — plain vertical scroll of all tool cards with a pinned filter input at the top. Most conservative option; scrolling past viewport required but not painful.
- *Icon strip* (viable fallback) — VS Code activity-bar style: a thin (~50px) strip of category icons at rest; clicking one slides out a side panel with that category's cards. Wins on main-pane width. Loses on interaction count (two-step to reach a tool) and on panel-open state.

**Gallery search input.** A filter/search input at the top of the panel lets users find tools by name or keyword across categories. **Alt+T** focuses it. The DOM is in place but disabled.

---

## Downloading results

A download affordance near the results list saves the current output to disk — whatever the bottom row of the stack produces. For the empty stack (just the search bar), that's "the filtered list" — the merged `All` view restricted to the current pattern. For a longer stack (`Anagram LINDSEY → Search DOG`) it's the full pipeline output. The button is always present; what it produces just follows the stack.

The everyday case is filling — narrow `All` with a pattern, then save the matches as a working set.

Default filename describes the stack: `grawlix-search-DOG.txt`, `grawlix-anagram-LINDSEY-search-DOG.txt`. Same tool keys as the URL query string (see [`../design.md` § URL state](../design.md#url-state)), so the file is self-describing and re-running the same stack later won't overwrite the prior snapshot.

Format follows the tool's natural output shape — for plain word lists, the standard `WORD;SCORE[;COMMENT]` used elsewhere. Pair and group outputs need their own format design (`FROM\tTO\tMIN_SCORE` is the obvious shape for pairs); deferred until those tools land.

This is a third "give me a file" path alongside the two existing ones (All/My Edits via Sync & backup, individual wordlist via the Wordlists dialog). It's distinct because the file isn't a backup or a wordlist export — it's a snapshot of the current view, usually filtered or transformed.

---

## Plugin model

Tools are a data-driven plugin system. Every tool — builtin or user-authored — is one record with the same shape. The gallery, stack, URL serializer, and result renderer dispatch on declared fields; no tool needs special-case code paths. Adding a tool is adding one record. Custom JS tools (see *Open questions*) are the same record persisted to localStorage and merged into the catalog at boot.

Why data-driven: the catalog is open-ended (already 30+ planned, with phonetics and thesaurus families pending), and the construction-aid genre is exploratory — users will surface tools we haven't predicted. Special-casing in the gallery is a tax on growth.

A DSL or IDL for the schema is overkill at this scale. A plain JS object literal expresses everything; runtime validation at the dispatch boundary covers what static types would.

## Tool API

A tool is an object. Static fields describe it to the gallery; the `run` function does the work.

```js
{
  // Identity
  slug: 'beheadments',
  name: 'Beheadments',
  icon: '✂',
  category: 'pairs',
  desc: 'Pairs where one word is formed by removing the first letter of the other.',
  example: 'SLING → LING',

  // Params — one stack-row input per entry; built-in renderer dispatches on type
  params: [],

  // Output declaration
  output: {
    kind: 'pairs',                  // 'words' | 'pairs' | 'groups'
    relation: 'transform',          // 'transform' | 'symmetric' | 'contains' | null
    labels: ['from', 'to'],         // names the parts; used in sort axis labels, tooltips, JSON
    chainProjection: 'to',          // when chained downstream, which part(s) to pass
    annotations: [],                // declared per-item annotations beyond highlights
  },

  // Indexed input views requested (built lazily by the runtime; see Performance)
  requires: [],                     // e.g. ['set', 'byLetterBank']

  // Computation
  async run(input, params, ctx) {
    return input.list.flatMap(w => /* … */)
      .map(([a, b]) => ({ a, b, highlights: { b: [{ kind: 'kept', range: [0, b.length] }] } }));
  }
}
```

### Output kinds

Three kinds cover the catalog:

- **`words`** — `[{ word, highlights?, ...annotations }]`. Single-word results: search, anagram, palindromes, etc. Phrase-parsing results are space-separated multi-word strings inside a single `word`; the spaces are an internal detail of that string.
- **`pairs`** — `[{ a, b, highlights?, ...annotations }]`. Two-word results: beheadments, replace_all, kangaroo and joey, etc. `output.labels` names what `a` and `b` mean.
- **`groups`** — `[{ items: string[], highlights?, ...annotations }]`. N-word results: anagram_families. Display deferred (see *Display*).

### Relations

`output.relation` tells the renderer how to display a pair (or group):

- `'transform'` — `FROM → TO` with arrow. Beheadments, replace, add_prefix, letter_swap.
- `'symmetric'` — `A · B` or `A ↔ B` with no inherent direction. Semordnilaps, anagram_with.
- `'contains'` — `OUTER ⊃ INNER` or similar containment glyph. Nested_words.
- `null` — no relation glyph; just adjacent words.

The renderer maps relation to glyph; tools don't pick characters themselves, so display stays consistent across all tools sharing a relation.

### Chain projection

When tool K feeds tool K+1, K's output projects to a `string[]` for K+1 to consume. Declared in metadata, not in code:

- `words`: implicitly the word strings.
- `pairs`: `'a'`, `'b'`, or `'both'` (default `'both'` = union of both columns, deduped).
- `groups`: `'all'` (flatten and dedupe) or `'first'` (the first item of each group).

Chains transmit `string[]`; the projection is metadata; the *display* layer sees the full annotated structure. Two contracts, no type system. Most tools have a "the interesting result" side — beheadments and curtailments project `'to'`; nested_words projects `'outer'`. The catalog declares what's right per tool. (This closes the structured-vs-unstructured chaining tension that earlier drafts of this doc wrestled with.)

### Annotations

Two annotation flavors ride with each item:

- **Highlights** — character-range markings rendered visually inside a word. Each tool emits `{ kind, range }` records keyed by part name (`{ a: [...], b: [...] }` for pairs, `[...]` for words). The renderer dispatches on `kind` against a small global registry — `'kept'`, `'removed'`, `'inserted'`, `'shifted'`, `'matched'`, `'group:0'`, `'group:1'`, etc. — each with its own CSS rule. Tools don't pick colors; new tools either reuse existing kinds or extend the registry by adding a (kind, CSS rule) pair.
- **Numeric / string annotations** — declared in `output.annotations: [{ key, label, display }]`. The renderer reads the declaration, knows whether to render the value as a small inline badge near the atom, a hover tooltip, or popover detail. Use cases: phrase_parsing's parse-quality score, almost_anagram's edit distance, letter_changes' actual `n`.

Both annotation flavors are display-only — chain projection drops them. A downstream tool sees only the projected `string[]`.

### Escape hatches

Params cover input. The default renderer dispatches on each entry's `type` — `string` → text input, `bool` → checkbox/toggle, `int` → number, `enum` → dropdown, `char` → single-letter input. Multi-field tools just declare multiple params; nothing custom needed. Search's whole-word toggle is a `bool` param, not an escape hatch; the existing in-input toggle styling is a CSS choice the default renderer can apply.

Output is covered by kind / relation / highlights / annotations. Phrase parsing returns plain strings that happen to contain spaces; the default `words` renderer displays them normally. Fancier word-break treatment (dot separators, per-word color) would fit the highlight system as `'word:n'` kinds — still no custom render needed.

No current-catalog tool needs an escape hatch. Two optional fields are declared as a safety valve for hypothetical futures — an interactive per-row widget, a non-textual visualization, an input that genuinely doesn't fit the param-type system (hex-grid letter picker, visual region selector):

- `renderItem(item, ctx)` — custom result-cell HTML for one item.
- `renderParams(params, onChange)` — custom stack-row params UI.

Both default to the standard renderers. Add a real motivating case to this doc before adding either to a tool — if every concrete tool fits the schema, the schema is doing its job.

---

## Catalog

Each entry: `slug(params)` — output kind, plus relation/projection for non-`words` and any notable highlights or annotations. Specifics are negotiable; this captures intent.

### Pattern matching
- `search(pattern, wholeWord)` — words. Highlights: `matched` per non-wildcard region, colored by region index.
- `regex(pattern)` — words. Highlights: `group:n` per capture group.

### Anagrams & letter banks
- `anagram(word)` — words.
- `made_from(letters)` — words.
- `hidden_anagram(word)` — words. Highlights: `matched` over the hidden-anagram span.
- `almost_anagram(word, n)` — words. Annotation: `editDistance`.
- `letter_bank(word)` — words.
- `required(letters)` — words. Highlights: `matched` on each required letter.
- `limited(letters)` — words.

### Letter patterns
- `kangaroo(word)` — words. Highlights: `matched` over the joey span.
- `joey(word)` — words.
- `sandwich(word)` — words.
- `dead_center(word)` — words. Highlights: `matched` over the center.
- `letter_changes(word, n)` — words. Highlights: `shifted` on changed letters. Annotation: `actualN`.
- `consonantcy(word)` — words.
- `vowelcy(word)` — words.
- `cryptogram(word)` — words.

### Pair transforms
- `replace_one(find, with)` — pair / transform · projects `to`. Highlights: `removed` on `from`, `inserted` on `to`.
- `replace_all(find, with)` — pair / transform · projects `to`. Highlights as above for every occurrence.
- `replace_anything(with)` — pair / transform · projects `to`.
- `add_remove_one(s)` — pair / symmetric · projects `both`. Highlight on the added/removed substring.
- `add_remove_all(s)` — pair / symmetric · projects `both`.
- `add_prefix(s)` — pair / transform · projects `to`. Highlight: `inserted` on the prefix.
- `add_suffix(s)` — pair / transform · projects `to`. Highlight: `inserted` on the suffix.
- `anagram_with(word)` — pair / symmetric · projects `both`.
- `beheadments()` — pair / transform · projects `to`. Highlight: `removed` on `from[0]`.
- `curtailments()` — pair / transform · projects `to`. Highlight: `removed` on `from[-1]`.
- `side_splitting()` — TBD; either pair / contains (full word + split form) or words with a custom `renderItem`. Decide when the tool lands.
- `letter_swap(a, b)` — pair / transform · projects `to`. Highlight: `shifted` on swapped positions.
- `regex_replacement(pattern, with)` — pair / transform · projects `to`. Highlights for the matched and replaced regions.

### Curiosities
- `palindromes()` — words.
- `semordnilaps()` — pair / symmetric · projects `both`.
- `isograms()` — words.
- `supervocalics()` — words. Highlights: `matched` on each vowel.
- `monovocs()` — words. Highlights: `matched` on the lone vowel.
- `repeaters()` — words. Highlights: `matched` on the repeating run.
- `neckouts()` — words.
- `alphabetical()` — words.

### Misc
- `spelling_bee(center, outer)` — words. Highlights: `matched` on the center letter.
- `everything()` — words. Identity tool.

### Grawlix-original
- `phrase_parsing()` — words (results contain spaces). Annotation: `parseScore` — drives noise reduction so good parses sort high. Open: scoring formula, frequency weighting; treat as a separate design conversation.
- `nested_words()` — pair / contains · projects `outer`. Highlights: `matched` over the inner span. Stricter and more crossword-specific than Wordlisted's Kangaroo / Sandwich / Joey: outer shell and inserted word both must be real words.
- `letter_incrementing(n)` — pair / transform · projects `to`. Highlights: `shifted` on incremented letters. A common crossword theme mechanism.
- `anagram_families()` — group · projects `all`. Mining for theme material — every cluster of 2+ mutual anagrams in the wordlist.
- *Phrase-level alterations* — likely a flag on existing pair transforms (`onPhrases: true`) to operate on multi-word phrase parses rather than the run-together string. Not its own tool. Wordlisted operates only on the run-together string.

## Capability families

Two families that unlock entire categories of tools, gated on bundling external data.

### Phonetics

The CMU Pronouncing Dictionary maps words to phoneme sequences, opening up an entire class of sound-based operations that letter-based tools can't touch. Largely unexplored territory. Early examples from existing scripts: rhyme finding at the phrase level, phonetic substitutions (swap one phoneme for another across the wordlist), sound-shift pairs (move a phoneme from the front of a word to the end to get a new word/phrase). Many more possibilities. Requires bundling or fetching the CMU dict as a data dependency.

### Thesaurus / semantics

Roget's Thesaurus (available as structured XML) enables meaning-based searches: find synonyms, antonyms, words in the same semantic category. This unlocks tools Wordlisted can't do at all — Kangaroo words that actually verify the joey is a *synonym* of the kangaroo (rather than just a subsequence), theme-entry finders based on semantic relationships, category membership filters. An undertapped gold mine. Requires bundling Roget data.

---

## Display (pair / group output kinds)

The shipped Words display is documented in [`../design.md` § Word list](../design.md#word-list). Pair and group output kinds — beheadments, anagram families, etc. — extend the same list-of-atoms model below; no tools that produce them are wired up yet, so the rendering is sketched here.

The rule that carries over: every word in any output is shown as a [word atom](../design.md#word-list) (`1. CARE 4 50`); the AtomPopover is the universal editor regardless of output kind; comments and source live in the popover, not the at-rest row.

### Pairs view

A list of `atom relation atom` rows. The relation glyph (`→`, `·`, `⊃`, etc., from `output.relation`) renders between two word atoms in its own pseudo-column, so arrows line up vertically across all rows. Default sort is Min score for transform and symmetric pairs — the worse word caps pair quality.

```
Sort by Min score ↓                                   321 pairs

 5  SLING         50  →   4  LING            30
 5  TRAIN         60  →   4  RAIN            40
 6  SCREAM        50  →   5  CREAM           60
12  BIBLIOGRAPHY  40  →  11  BIBLIOGRAPHIES  50
…
```

Two score badges per row in different tier colors (e.g. green 50 next to red 30) is informative, not chaotic — pair-with-tier-mismatch reads at a glance. The score-color vocabulary is already learned across the rest of the app.

Wordlisted's stacked-pairs display (two scores rendered as `40/50`) keeps column count down at the cost of legibility — you have to mentally compute mins. The atom approach is *visually* compact AND *cognitively* clear because the score belongs to the word; they're one thing to read.

### Groups view

A list of bullet-separated atoms with a count prefix. Default sort is Max — the anagram-families case is "find a great word that has anagrams I haven't noticed," which max surfaces and min hides.

```
Sort by Max ↓                                              89 families

(3)   4 CARE 50  ·  4 RACE 40  ·  4 ACRE 30
(2)   8 STRESSED 60  ·  8 DESSERTS 40
(5)   5 ALERT 60  ·  5 ALTER 50  ·  5 LATER 60  ·  5 RATEL 20  ·  5 TALER 10
…
```

Count is a per-row property; leading `(N)` keeps it visible without dedicated chrome. Min and Max are sort axes, not displayed as numbers — derivable from the row, and showing them next to the atoms would be redundant. When a group is too wide to fit on one line, atoms wrap to the next line indented under the first atom (not under the count) so it reads as continuation.

Groups are the partial exception to strict pseudo-column alignment. Atom counts vary per row, so atoms don't fully cross-row align — they flow across the line separated by bullets. The leading `(N)` count slot does align across rows, giving the eye an anchor; within a row, atoms pack tightly with consistent internal `length word score` shape.

### Sort axes per output kind

- **Pairs:** Min score, Max score, Score (from), Score (to), Min length, Max length, Alphabetical.
- **Groups:** Min, Max, Count, Alphabetical.

### Permanent Search row on non-flat output

When the active tool produces pairs or groups, the bottom Search row's filter input matches loosely against the rendered text — same string the user sees, all atoms in a row visible as one filter target. Default-loose is right for v1; promote to side-specific syntax (`right:un*`) only if usage shows the loose form isn't enough.

---

## Performance

Two facets: making tool runs fast, and keeping the UI snappy regardless of how slow a tool is.

### Tool-side: input shapes

The wordlist input arrives as `string[]` by default (`input.list`) plus indexed views built lazily by the runtime:

- `input.set` — `Set<string>` for O(1) membership checks (kangaroo, joey, sandwich, nested_words).
- `input.byLetterBank` — `Map<string, string[]>` keyed by sorted letters; instant anagram lookup (anagram, anagram_with, anagram_families).
- `input.byLength` — `Map<number, string[]>` for length-bucketed iteration.

A tool declares what it wants in `requires: ['set', 'byLetterBank']`; the runtime ensures those views are built before `run` is called and reuses them across calls as long as the input set doesn't change. Cache invalidation reuses the existing `cacheVersion$` machinery.

New views land as new tools demand them. Don't predict.

Builtin views are shared across calls. Custom JS tools can ask for them too but can't author their own — keeps the cache key simple (input identity + view name).

### UI-side: snappiness

- **`run` is async by default.** Synchronous tools just `return`; async tools `await`. The runtime always treats the call as a promise.
- **Stack/param changes debounce ~250ms** before re-running the pipeline (matches the existing URL debounce).
- **In-flight runs cancel when superseded.** The `ctx` argument carries a cancellation signal (`ctx.signal`, `AbortSignal`-style); long-running tools should periodically check it. Network-bound tools pass it directly to `fetch`.
- **Spinners appear on tool rows whose run takes longer than ~100ms.** Below the threshold, no UI flicker; above, the row badges with a progress indicator and the result list grays out.

### Workers and result caching: deferred

Web workers are the right answer eventually for custom JS tools — bad code shouldn't freeze the UI — but they cost in setup (no build step makes worker bundling awkward) and in data transfer (200K-word inputs serialize to several MB per run). Builtin tools run in tens of ms on the main thread; even O(n²) tools complete in well under a second on realistic wordlists. Defer until custom tools are real and profiling shows blocking is a problem.

Tool-result memoization is plausible — input identity is tracked by `cacheVersion$`, and tool params are known — but premature without profiling. The data-shape views above are the load-bearing optimization; per-call result caches are a layer above that.

---

## Related tools & future integrations

### OneLook / Datamuse (onelook.com, datamuse.com/api)
OneLook indexes an enormous dataset of words and phrases — Wikipedia, all major dictionaries, phrase dictionaries, idiom databases, proper nouns, and more. **Scale:** 16,965,772 entries across 805 dictionaries. Far broader than any single wordlist.

**The integration path is their `/api/words?` endpoint** (parameters: `sp=` for spelling pattern, `ml=` for means-like). This appears to be the Datamuse API or very closely related — Datamuse is explicitly designed for programmatic access, no key required.

Capabilities worth noting:
- **Reverse dictionary / semantic search** — find words by meaning or concept. `:widespread epidemic` → "pandemic"; `:winter sport` → skiing, skating, etc. Enormous for crossword construction; nothing like it exists in letter-pattern tools.
- **Meaning-filtered pattern search** — combine a letter pattern with a meaning constraint: `p*:ireland` finds terms starting with P related to Ireland. `bl*:snow` finds blue-ish snow words.
- **Phrase search** — `**winter**` finds multi-word phrases containing "winter" as a whole word. Different from pattern matching.
- **Crossword puzzle mode** — patterns automatically allow optional spaces, so run-together strings match phrases: `h?ttot?ot` → "hot to trot". Direct relevance to Grawlix's phrase-parsing problem.
- **Letter inclusion/exclusion** — `+abcd` restricts results to only those letters; `-abcd` excludes them. Complement to the existing `?`/`*`/`#`/`@` wildcards.
- Standard wildcard syntax (`?`, `*`, `#`, `@`) overlaps heavily with what Grawlix already has.

XWordInfo's arrangement with OneLook may involve something beyond the public API — unknown.

### Umiaq (crosswordnexus.github.io/umiaq)
A crossword pattern-matching tool whose key differentiator over regex is a **variable system**: capital letters represent consistent characters across positions. `ABBA` matches any word where position 1 = position 4 and position 2 = position 3 (NOON, DEED, TOOT). A semicolon separates multi-word patterns: `AB;BA` finds word *pairs* where the letter variables are consistent across both words simultaneously — something regex can't express at all. Results in under a second. Has both a browser UI and a Python CLI. Not a candidate for direct integration or syntax copying, but the variable/multi-pattern concept is worth borrowing from for Grawlix's own search language.

---

## Help documentation

The help redesign (see `help.md`) will happen after the tool gallery is built — tool docs are not needed before then. During development, treat this document as the living record.

**As each tool group ships:** add a note here summarizing what it does and anything a user would need to know that isn't obvious from the tool card itself. These notes become the raw material for the reference guide section and the welcome tour slide.

**When the tool gallery is complete:** the welcome tour gains one or more slides after the current Slide 4 (Searching), and the reference guide gains a tool-gallery section. `help.md` already anticipates this expansion.

---

## Open questions

- **Custom JS tools.** Two paths:
  - *(a) Ephemeral.* A "Custom" gallery card opens a code editor in its stack-row params; the run is the user's code. No persistence beyond URL state — closing the tab loses it.
  - *(b) Registered.* User-named custom tools show up as gallery cards alongside builtins, persisted to localStorage, optionally exportable as a JSON file. Heavier — needs naming, conflict handling, deletion, possibly versioning. Sandboxing concerns (no rogue `fetch` to `localhost`, clear "user-loaded" badging in the gallery) belong here too.

  Start with (a); it proves the API against real user code without committing to the registry surface. Move to (b) only if users surface "I keep retyping this." Real demand is unknown today.
- **OneLook integration.** What does the API actually look like on the wire, and what arrangement does XWordInfo have with them?
- **Phonetics & thesaurus data bundling.** CMU dict and Roget XML — static assets, CDN, or runtime fetch?
- **Multi-input URL encoding.** Tools with multiple inputs (regex with min-length, anagram with bank letters) need a value-internal delimiter or named subkeys. Deferred to the first such tool — encoding choice will land alongside it. (Mirrored in [`../design.md` § URL state](../design.md#url-state).)
- **Whole-word per Search row.** `whole-word` is a bare top-level key today, fine for the single permanent Search row. If the stack ever holds two Search rows, the eventual fix is the multi-input encoding above (likely `search=CAT:w`). Revisit when chaining a Search above a transform becomes possible.
