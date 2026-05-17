# Tools (gallery & mining)

Grawlix's mining side: anagrams, regex, beheadments, curtailments, and a long tail of letter/sound/meaning tricks for both **filling** (looking up words and noting score corrections while you work a grid) and **theme generation** (mining the wordlist for ideas).

Inspiration: [Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson. See [`../wordlisted.md`](../wordlisted.md) for a full breakdown of its search modes. Grawlix will cover similar ground and add its own tools.

The gallery is where Grawlix's [project goal](../../README.md#goals) — democratize wordlist manipulation — does most of its work. Constructors who program can write Python to anagram, behead, phonetic-substitute, semantic-filter against their wordlists. The gallery's job is to put those moves in non-programmers' hands. Filter when evaluating a candidate tool: *would a programmer reach for this often enough to write a script?* If yes, it probably belongs.

This doc tracks what's still planned for the gallery: the rest of the tool catalog (records without a `run` yet), groups output, gallery polish (category picker, search), and result download. The pipeline that runs it all — the chain-row model, the per-row tool API, the executor — is built; see [`../design.md` § Tool gallery & stack](../design.md#tool-gallery--stack).

---

## Sequencing — runtime support before the family

When the next tool needs runtime support that doesn't exist yet, land the runtime first, then the tool.

- **Letter-bank family** (`subanagram`, `made_from`, `anagram_families`, `letter_clusters`) — no runtime gate. Each builds whatever letter-keyed index it needs in its own `prepare` (see *Indexed lookups* below). If a per-keystroke rebuild proves too slow on large wordlists, promote the index onto the merged-wordlist cache — but that's a one-liner, not a prerequisite runtime.
- **Membership family** (`kangaroo`, `joey`, `sandwich`, `nested_words`) — `wordlist.byEntry` already exists on the merged-wordlist cache. No runtime gate.
- **Phonetics / thesaurus families** — wait for the bundled data dependency. Until CMU dict and Roget XML are available at runtime, the tools can't run.

For tools that fit the runtime as-is (`palindromes`, `isograms`, `supervocalics`, etc. — purely letter-pattern checks over `entry`), no gate; just add the `run` and ship.

---

## Pipeline behavior — remaining pieces

**Reordering.** Order matters in a pipeline. The intended gesture is "remove (X) and re-add" — drag handles aren't planned; reordering is rare enough that remove-and-re-add covers it, and the design surface isn't worth the touch/keyboard-accessibility complexity. Today the stack supports add/remove but not in-place reorder. Unblocks once a chained workflow surfaces that wants it.

**Score range — a pre-pipeline trim (shipped).** The score-range control trims the merged wordlist *before* the pipeline runs: out-of-range words are removed before any tool sees them, so they can't cluster, pair, or be looked up as targets. An earlier design kept it as a *view* filter on the final pipeline output; that was abandoned because it has no good answer for group rows — a `letter_clusters` cluster with one score-0 member would be hidden wholesale by a `1+` range (a group's score aggregate spans every member). Trimming upstream sidesteps that: the junk word never enters the cluster. The control stays per-user, localStorage-backed, not URL-shared — scores aren't portable across setups (see [`../design.md` § Out of scope for the URL](../design.md#out-of-scope-for-the-url)). The histogram still shows the full merged distribution, so it stays the drag-to-select surface.

---

## Gallery — unshipped pieces

**Category picker.** A fixed category menu at the top of the gallery (Anagrams & letter banks, Letter patterns, Pairs, Oddities, etc.). Clicking a category swaps the cards displayed below; the menu itself never moves. Spatial stability — categories live in the same place every time, cards stay visible while working, and the gallery's full width goes to tools. Matches the user's settle-into-a-tool-set pattern: a constructor with a theme idea picks the relevant category once and stays there.

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

Format follows the tool's natural output shape — for plain entry lists, the standard `ENTRY;SCORE[;COMMENT]` used elsewhere. Multi-atom chain and group outputs need their own format design (`FROM\tTO\tMIN_SCORE` is the obvious shape for a two-atom chain); deferred until those tools land in the user's workflow.

This is a third "give me a file" path alongside the two existing ones (All/My Edits via Sync & backup, individual wordlist via the Library view). It's distinct because the file isn't a backup or a wordlist export — it's a snapshot of the current view, usually filtered or transformed.

---

## Tool API extensions

The catalog record shape (`name`, `icon`, `category`, `desc`, `example`, `params`, `kind`, `inputHighlights`, `outputHighlights`, optional `glyph` / `prepare` / `run`) is documented in [`../design.md` § Tool gallery & stack](../design.md#tool-gallery--stack). A few subsystems sit around it.

### Indexed lookups

`run`'s third argument `wordlist`, and `ctx.wordlist` inside `prepare`, is the merged-wordlist cache — a plain object `{ entries, sourceCounts, byEntry }`. `byEntry` is a `Map<entry, wlEntry>` keyed by the lowercased entry; membership checks (kangaroo, joey, sandwich, nested_words) and beheading/curtailing lookups use it.

`byEntry` is not a view *system*. It's the dedup map `buildMergedWordlist` already builds to merge sources, exposed as a field on the cache for free. It's built once when the merged cache is built and discarded wholesale when the cache is invalidated. There is no lazy-per-view machinery and no per-view invalidation — `cacheVersion$` is a generic "caches changed, repaint" signal, not a view tracker.

Other letter-keyed indexes — `byLetterBank` (`Map<sortedLetters, wlEntry[]>` for anagram / made_from / anagram_families), `byLetterClusters` (for `letter_clusters`), `byLength` — don't exist. When a tool needs one, there are two places to build it, in increasing cost:

- **In the tool's own `prepare`.** `prepare(params, ctx)` runs once per stage and receives `ctx.wordlist`, so the tool indexes it there and reads the index in `run`. No runtime changes. A run fires on every keystroke, so the index rebuilds per keystroke — but the rebuild is cooperative, chunked through `ctx` (see [`../design.md` § Pipeline execution](../design.md#pipeline-execution)), so it degrades to slower-but-responsive, never a frozen tab.
- **As another field on the merged cache.** If that per-keystroke rebuild bites, build the index inside `buildMergedWordlist` next to `byEntry`. Then it's built once per wordlist change and invalidated wholesale with the rest of the cache. One more line — still not a "system."

The declarative `requires: [...]` mechanism and the lazy-property-on-Wordlist form are both parked; neither is needed. Default to `prepare`; promote an index onto the merged cache only when profiling says so. Cross-tool sharing within one pipeline (a stack that hits `byLetterBank` from three tools) is served by the same merged-cache field — revisit then, not before.

New indexes land as new tools demand them. Don't predict.

### Annotations

Numeric / string annotations declared at the catalog level (something like `output.annotations: [{ key, label, display }]`) for tools that want to attach extra data to each output: phrase_parsing's parse-quality score, almost_anagram's edit distance, letter_changes' actual `n`. The renderer reads the declaration and renders the value as an inline badge, hover tooltip, or popover detail.

Annotations are display-only — downstream tools see only the chain-row's entries, not annotations. They're a separate channel from the synthesized-score escape hatch (which is for tool-supplied wlEntry scores, not arbitrary metadata).

Highlights — character-range markings inside an atom — are part of the core API (see [`../design.md` § Highlights pipeline](../design.md#highlights-pipeline)). New highlight kinds extend the same `{ kind, start, end }` shape that Behead and Curtail use today.

### Escape hatches

Params are covered by the default renderer dispatch (`type: 'string'` → text input, `'bool'` → checkbox, `'int'` → number, `'enum'` → dropdown, `'char'` → single-letter input). Multi-field tools just declare multiple params; nothing custom needed.

Output is covered by `kind` / highlights / synthesized-score / annotations. No current-catalog tool needs a deeper escape hatch. Two optional fields stay in the spec as a safety valve for hypothetical futures (interactive per-row widget, non-textual visualization, input that genuinely doesn't fit the param-type system):

- `renderItem(atom)` — custom result-line HTML for one atom.
- `renderParams(params, onChange)` — custom stack-row params UI.

Both default to the standard renderers. Add a real motivating case before adding either to a tool.

---

## Catalog

Each entry: `slug(params)` — `kind`, then highlight kinds (`in:` for input-side, `out:` for output-side) and any annotations. Specifics are negotiable; this captures intent. Tools already built (Anagram, Search, Semordnilap, Behead, Curtail) are omitted.

### Pattern matching
- `regex(pattern)` — filter · in: `group:n` per capture group.

### Anagrams & letter banks
- `made_from(letters)` — filter.
- `hidden_anagram(word)` — filter · in: `matched` over the hidden-anagram span.
- `almost_anagram(word, n)` — filter · annotation: `editDistance`.
- `letter_bank(word)` — filter.
- `required(letters)` — filter · in: `matched` on each required letter.
- `limited(letters)` — filter.

### Letter patterns
- `kangaroo(word)` — filter · in: `matched` over the joey span.
- `joey(word)` — filter.
- `sandwich(word)` — filter.
- `dead_center(word)` — filter · in: `matched` over the center.
- `letter_changes(word, n)` — filter · in: `shifted` on changed letters · annotation: `actualN`.
- `consonantcy(word)` — filter.
- `vowelcy(word)` — filter.
- `cryptogram(word)` — filter.

### Transforms
- `replace_one(find, with)` — transform · in: `removed` on `find` · out: `inserted` on `with`.
- `replace_all(find, with)` — transform · same highlights, every occurrence.
- `replace_anything(with)` — transform · out: `inserted` on `with`.
- `add_remove_one(s)` — transform · bidirectional emit (unification gives `↔`); highlight on the added/removed substring.
- `add_remove_all(s)` — transform · same logic across all matches.
- `add_prefix(s)` — transform · out: `inserted` on the prefix.
- `add_suffix(s)` — transform · out: `inserted` on the suffix.
- `side_splitting()` — TBD; transform synthesizing the split form, or filter with a custom renderer. Decide when the tool lands.
- `letter_swap(a, b)` — transform · in & out: `shifted` on swapped positions.
- `regex_replacement(pattern, with)` — transform · in: `removed` on the match · out: `inserted` on the replacement.

### Curiosities
- `palindromes()` — filter.
- `isograms()` — filter.
- `supervocalics()` — filter · in: `matched` on each vowel.
- `monovocs()` — filter · in: `matched` on the lone vowel.
- `repeaters()` — filter · in: `matched` on the repeating run.
- `neckouts()` — filter.
- `alphabetical()` — filter.

### Misc
- `spelling_bee(center, outer)` — filter · in: `matched` on the center letter.
- `everything()` — filter · identity (no-op).

### Grawlix-original
- `phrase_parsing()` — transform · synthesizes the joined phrase using `[string, number]` output (score = min over constituents). Open: scoring formula, frequency weighting — separate design conversation.
- `nested_words()` — transform · in: `matched` over the inner span; output entry is the inner word. Stricter and more crossword-specific than Wordlisted's Kangaroo / Sandwich / Joey: outer shell and inserted word both must be real wordlist entries.
- `letter_incrementing(n)` — transform · in & out: `shifted` on incremented letters. A common crossword theme mechanism.
- `anagram_families()` — group · clusters of 2+ mutual anagrams. Deferred until the group-output design conversation.
- `letter_clusters(letterCount)` — group · clusters of 2+ entries sharing the same set of `letterCount` distinct letters (OPT/POT/TOP under {O,P,T}; ACT/CAT/TACT under {A,C,T}). Broader than `anagram_families` — groups by the distinct-letter set, so repeats and differing lengths still co-cluster. Deferred until the group-output design conversation.
- *Phrase-level alterations* — likely a flag on existing transforms (`onPhrases: true`) to operate on phrase parses rather than the run-together string. Not its own tool. Wordlisted operates only on the run-together string.

## Capability families

Two families that unlock entire categories of tools, gated on bundling external data.

### Phonetics

The CMU Pronouncing Dictionary maps words to phoneme sequences, opening up an entire class of sound-based operations that letter-based tools can't touch. Largely unexplored territory. Early examples from existing scripts: rhyme finding at the phrase level, phonetic substitutions (swap one phoneme for another across the wordlist), sound-shift pairs (move a phoneme from the front of a word to the end to get a new word/phrase). Many more possibilities. Requires bundling or fetching the CMU dict as a data dependency.

### Thesaurus / semantics

Roget's Thesaurus (available as structured XML) enables meaning-based searches: find synonyms, antonyms, words in the same semantic category. This unlocks tools Wordlisted can't do at all — Kangaroo words that actually verify the joey is a *synonym* of the kangaroo (rather than just a subsequence), theme-entry finders based on semantic relationships, category membership filters. An undertapped gold mine. Requires bundling Roget data.

---

## Groups view

Deferred until `anagram_families` (or another group tool) surfaces — design conversation lands then. The shape below is a sketch of where this is likely to end up so the chain-row model doesn't paint into a corner.

Groups output — N-word clusters from `anagram_families` and similar — extends the atom model but flows across the line rather than stacking vertically:

```
Sort by Max score ↓                                        89 families

(3)   CARE 50  ·  RACE 40  ·  ACRE 30
(2)   STRESSED 60  ·  DESSERTS 40
(5)   ALERT 60  ·  ALTER 50  ·  LATER 60  ·  RATEL 20  ·  TALER 10
…
```

A list of bullet-separated atoms with a count prefix. Default sort is Max score — the anagram-families case is "find a great word that has anagrams I haven't noticed," which max surfaces and min hides. Count is a per-row property; leading `(N)` keeps it visible without dedicated chrome. Min score and Max score are sort axes, not displayed as numbers — derivable from the row, and showing them next to the atoms would be redundant. When a group is too wide to fit the viewport, the row overflows horizontally with scroll inside its own container — it never wraps onto a second line. The virtual scroller paginates vertically off a fixed per-row height (atom count × row height); content-driven wrapping would make a group row's height vary with its member count and break that stride math. Only the row's horizontal layer scrolls; vertical pagination is unaffected.

**A different column set, not a column-alignment exception.** Group rows don't bend the chain-row's `entry / len / score / comment / source` grid — a group tool produces a *different* set of columns: **count** and **entries**. `entries` is the bullet-separated concatenation of each member's entry and its score badge; there's no separate length column and entries carry no length prefix. The `count` column (`(N)`) aligns across rows, giving the eye an anchor; `entries` flows across the line and its width varies per row with the member count.

**No Comment / Source columns on group rows.** Chain rows (one- and multi-atom) carry per-atom Comment and Source columns, reactively shown when the viewport has room (see [`../design.md` § Chain-row display](../design.md#chain-row-display)). Group rows can't: those columns belong to the chain-row's column set, and group rows use the separate `count / entries` columns, flowing horizontally across the line rather than stacking into it. Per-atom comment/source on a group row would have to ride inside each bullet-separated atom — a denser, different layout problem that lands with the group-output design pass, not for free off the chain-row grid.

**Sort axes for groups:** Alphabetical, Count, Min score, Max score.

**Chaining tools after a group tool — flatten / run / unflatten.** A group tool comes first in the stack; any tool chained after it runs over each group as a mini-wordlist. For each group: flatten its members into a temporary wordlist, run the rest of the stack over that wordlist, then unflatten — re-form the group from whatever survives or is produced. Groups whose surviving member count falls under the threshold (default 2) drop out. The chained tool never knows it's inside a group — it sees a wordlist, returns rows, the system re-groups.

This is also how search works on group rows — there is no separate group-row search. A Search row after `anagram_families` flattens each family, runs the pattern, and keeps the families that still have 2+ matching members. Same mechanism for any chained tool:

- `anagram_families → search(*A*)` — each family filtered to its A-containing members; families with fewer than 2 survivors drop.
- `anagram_families → behead` — each family member becomes a 2-atom behead chain; the group row holds N such sibling chains.
- `anagram_families → palindromes` — rare but valid; sparse output, the model still handles it.

Each sibling within a group row carries the sub-pipeline's static atom count. Groups stay group-shaped — the partition survives the sub-pipeline, where a plain flatten would lose it.

---

## Result caching: deferred

Tool-result memoization is plausible — input identity is tracked by `cacheVersion$`, and tool params are known — but premature without profiling. The `prepare` step — and a merged-cache index behind it, if one lands — is the load-bearing optimization; per-call result caches are a layer above that.

---

## Umiaq (crosswordnexus.github.io/umiaq)
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
- **Phonetics & thesaurus data bundling.** CMU dict and Roget XML — static assets, CDN, or runtime fetch?
- **Multi-input URL encoding.** Tools with multiple inputs (regex with min-length, anagram with bank letters) need a value-internal delimiter or named subkeys. Deferred to the first such tool — encoding choice will land alongside it. (Mirrored in [`../design.md` § URL state](../design.md#url-state).)
- **Whole-word per Search row.** Search rows can be chained from the gallery, but `whole-word` is a bare top-level URL key tied to the permanent search bar — a gallery-added Search is substring-only. Per-row whole-word needs the multi-input encoding above (likely `search=CAT:w`). Revisit when a chained Search workflow actually wants it.
- **Synthetic-atom downstream behavior.** What does `[phrase_parsing, behead]` mean? The synthetic "hot to trot" goes into behead, which tries to look up "ot to trot" in `wordlist.byEntry`, finds nothing, drops the row. Probably degenerates harmlessly but the chained semantic is fuzzy. Revisit if a real workflow surfaces.
- **Group output shape.** When `anagram_families` or another group tool surfaces, the `run` signature and per-row rendering need their own design pass. Sketched in *Groups view* above; not designed.
