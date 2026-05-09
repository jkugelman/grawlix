# Tools (gallery & mining)

Grawlix's mining side: anagrams, regex, beheadments, curtailments, and a long tail of letter/sound/meaning tricks for both **filling** (looking up words and noting score corrections while you work a grid) and **theme generation** (mining the wordlist for ideas).

Inspiration: [Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson. See [`../wordlisted.md`](../wordlisted.md) for a full breakdown of its search modes. Grawlix will cover similar ground and add its own tools.

The gallery is where Grawlix's [project goal](../../README.md#goals) — democratize wordlist manipulation — does most of its work. Constructors who program can write Python to anagram, behead, phonetic-substitute, semantic-filter against their wordlists. The gallery's job is to put those moves in non-programmers' hands. Filter when evaluating a candidate tool: *would a programmer reach for this often enough to write a script?* If yes, it probably belongs.

## Status

Chrome is shipped: the left-rail gallery (every card carrying its tool's icon), the main-pane tool stack, hover previews, animations. The data shape is also in place — a single `TOOLS` catalog (`name`, `icon`, `category`, `desc`, `example`, `params`, `output`) drives both the gallery and the stack rows, so adding a new tool is one record. Icons today are emoji; switching to custom SVG would mean changing only the `icon` field per entry. See [`design.md` § Tool gallery & stack](../design.md#tool-gallery--stack) for the shape and rationale. Everything below this section is forward-looking — tool execution, the rest of the tool list, chaining policies, output formats, and downstream features.

---

## Pipeline behavior (unshipped)

The first row reads from the wordlist selected in the left-rail dropdown (`All` by default). Each subsequent row transforms the previous row's output. The results table shows the bottom row's output. Click order in the gallery determines pipeline order, top-to-bottom. To pre-filter an existing tool's input, the user starts over (clear, then click Search, then `+` the new tool); no prepend gesture.

**Live result filtering** is the everyday case — fire up Anagram, type LINDSEY, scroll the thousand results, type a substring in the bottom search row to live-filter down. The search bar functions as the result filter for whatever's above it.

**Reordering.** Order matters in a pipeline. To change order, the user removes rows (X) and re-adds them. Drag handles are deliberately not provided — chaining is a 2%-case gesture and reordering is rarer still; the design surface isn't worth the touch/keyboard-accessibility complexity.

**Tools without inputs** (Palindromes, Anagram families, etc.) still get a row carrying the tool name and an X — no input fields. Composes cleanly: `Search → Palindromes` lists palindromes within the search results.

**Scores come along.** Results show scores from `All` (the merged wordlist). This is Grawlix's superpower over Wordlisted — a user can see at a glance that their anagram is a 70 vs. a 30, and can click a result to add it to My Edits.

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

A download affordance near the results table saves the current output to disk — whatever the bottom row of the stack produces. For the empty stack (just the search bar), that's "the filtered list" — the merged `All` view restricted to the current pattern. For a longer stack (`Anagram LINDSEY → Search DOG`) it's the full pipeline output. The button is always present; what it produces just follows the stack.

The everyday case is filling — narrow `All` with a pattern, then save the matches as a working set.

Default filename describes the stack: `grawlix-search-DOG.txt`, `grawlix-anagram-LINDSEY-search-DOG.txt`. Same tool keys as the URL query string (see [`../design.md` § URL state](../design.md#url-state)), so the file is self-describing and re-running the same stack later won't overwrite the prior snapshot.

Format follows the tool's natural output shape — for plain word lists, the standard `WORD;SCORE[;COMMENT]` used elsewhere. Pair / group outputs need their own format design; deferred until those tools land. See *Output formats* below.

This is a third "give me a file" path alongside the two existing ones (All/My Edits via Sync & backup, individual wordlist via the Wordlists dialog). It's distinct because the file isn't a backup or a wordlist export — it's a snapshot of the current view, usually filtered or transformed.

---

## Grawlix-original tools

Wordlisted parity is a floor, not a ceiling. The candidates below are drawn from recurring construction workflows and all go beyond what Wordlisted offers. The list will grow as construction needs surface — don't treat it as comprehensive.

- **Phrase parsing** — parse a run-together entry into all possible word splittings (MOUNTAINGOAT → "MOUNTAIN GOAT"). Every constructor cares about this. The naive approach produces a lot of junk (bad word breaks), so it needs design work before it's a good tool — scoring, frequency filtering, or some other noise reduction. Treat as a separate design conversation.
- **Nested words** — find words where a valid inner word is inserted inside a valid outer word: MARI(JUAN)A. Both the outer shell and the inserted word must be real words. Stricter and more crossword-specific than Wordlisted's Kangaroo/Sandwich/Joey modes.
- **Letter incrementing** — find word pairs where N letters each shift by one step in the alphabet (A→B, E→F, etc.). A very common crossword theme mechanism.
- **Anagram families** — show all mutual anagram groups in your wordlist (every cluster of 2+ words that are anagrams of each other), rather than finding anagrams of a given input word. Mining for theme material.
- **Phrase-level alterations** — apply beheadments, curtailments, reversals, etc. to multi-word phrase parses of entries, not just the raw letter string. Wordlisted operates only on the run-together string.

### Phonetics (capability family)

The CMU Pronouncing Dictionary maps words to phoneme sequences, opening up an entire class of sound-based operations that letter-based tools can't touch. This is largely unexplored territory. Early examples from existing scripts: rhyme finding at the phrase level, phonetic substitutions (swap one phoneme for another across the wordlist), sound-shift pairs (move a phoneme from the front of a word to the end to get a new word/phrase). Many more possibilities. Requires bundling or fetching the CMU dict as a data dependency.

### Thesaurus / semantics (capability family)

Roget's Thesaurus (available as structured XML) enables meaning-based searches: find synonyms, antonyms, words in the same semantic category. This unlocks tools Wordlisted can't do at all — Kangaroo words that actually verify the joey is a *synonym* of the kangaroo (rather than just a subsequence), theme-entry finders based on semantic relationships, category membership filters. An undertapped gold mine. Requires bundling Roget data.

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

## Tool shapes (catalog)

Notation: `tool(params) :: input → output`, in Rust types as a strawman.

Output shape is one of `Vec<String>` (single — phrase parsing's space-separated multi-word strings count here), `Vec<(String, String)>` (pair), or `Vec<Vec<String>>` (group).

**Input is always `Vec<String>`.** Walking the catalog turns up nothing that wants a richer input type. Tools differ in how they consume it (iterate-and-filter per row, full-set membership check, whole-vec aggregation), but the type contract is uniform.

### Pattern matching
- `search(pattern: String)                          :: Vec<String> → Vec<String>`
- `regex(pattern: String)                           :: Vec<String> → Vec<String>`

### Anagrams & letter banks
- `anagram(word: String)                            :: Vec<String> → Vec<String>`
- `made_from(letters: String)                       :: Vec<String> → Vec<String>`
- `hidden_anagram(word: String)                     :: Vec<String> → Vec<String>`
- `almost_anagram(word: String, n: u32)             :: Vec<String> → Vec<String>`
- `letter_bank(word: String)                        :: Vec<String> → Vec<String>`
- `required(letters: String)                        :: Vec<String> → Vec<String>`
- `limited(letters: String)                         :: Vec<String> → Vec<String>`

### Letter patterns
- `kangaroo(word: String)                           :: Vec<String> → Vec<String>`
- `joey(word: String)                               :: Vec<String> → Vec<String>`
- `sandwich(word: String)                           :: Vec<String> → Vec<String>`
- `dead_center(word: String)                        :: Vec<String> → Vec<String>`
- `letter_changes(word: String, n: u32)             :: Vec<String> → Vec<String>`
- `consonantcy(word: String)                        :: Vec<String> → Vec<String>`
- `vowelcy(word: String)                            :: Vec<String> → Vec<String>`
- `cryptogram(word: String)                         :: Vec<String> → Vec<String>`

### Pair transforms
- `replace_one(find: String, with: String)          :: Vec<String> → Vec<(String, String)>`
- `replace_all(find: String, with: String)          :: Vec<String> → Vec<(String, String)>`
- `replace_anything(with: String)                   :: Vec<String> → Vec<(String, String)>`
- `add_remove_one(s: String)                        :: Vec<String> → Vec<(String, String)>`
- `add_remove_all(s: String)                        :: Vec<String> → Vec<(String, String)>`
- `add_prefix(s: String)                            :: Vec<String> → Vec<(String, String)>`
- `add_suffix(s: String)                            :: Vec<String> → Vec<(String, String)>`
- `anagram_with(word: String)                       :: Vec<String> → Vec<(String, String)>`
- `beheadments()                                    :: Vec<String> → Vec<(String, String)>`
- `curtailments()                                   :: Vec<String> → Vec<(String, String)>`
- `side_splitting()                                 :: Vec<String> → Vec<(String, String)>`
- `letter_swap(a: String, b: String)                :: Vec<String> → Vec<(String, String)>`
- `regex_replacement(pattern: String, with: String) :: Vec<String> → Vec<(String, String)>`

### Curiosities (no params)
- `palindromes()                                    :: Vec<String> → Vec<String>`
- `semordnilaps()                                   :: Vec<String> → Vec<(String, String)>`
- `isograms()                                       :: Vec<String> → Vec<String>`
- `supervocalics()                                  :: Vec<String> → Vec<String>`
- `monovocs()                                       :: Vec<String> → Vec<String>`
- `repeaters()                                      :: Vec<String> → Vec<String>`
- `neckouts()                                       :: Vec<String> → Vec<String>`
- `alphabetical()                                   :: Vec<String> → Vec<String>`

### Misc
- `spelling_bee(center: char, outer: String)        :: Vec<String> → Vec<String>`
- `everything()                                     :: Vec<String> → Vec<String>`

### Grawlix-original
- `phrase_parsing()                                 :: Vec<String> → Vec<String>` — strings are space-separated multi-word phrases
- `nested_words()                                   :: Vec<String> → Vec<(String, String)>` — `(formed, inner)`; output shape TBD
- `letter_incrementing(n: u32)                      :: Vec<String> → Vec<(String, String)>`
- `anagram_families()                               :: Vec<String> → Vec<Vec<String>>`
- *Phrase-level alterations* — probably a flag on the existing pair transforms (operate on phrase parses rather than the run-together string), not its own tool.

### What this means

- **No input type system needed.** Every tool reads `Vec<String>`. Chaining row K → row K+1 only ever has to fix an *output* mismatch, which reduces to "how do we flatten row K's output to `Vec<String>` for row K+1?" One policy per output shape (pair → flatten to union? right column? left column? both columns interleaved?), not a generalized type system.
- **Filter tools (search, regex) are the polymorphic exception.** They want to filter pairs and groups *as displayed* rather than after flattening — that's the "loose match against rendered text" in Output formats below. Implementation-wise, that means the filter tools take an extra dispatch on output shape rather than a uniform `Vec<String>` input.
- **The 2% chaining case is a small policy table, not a type system.** Three output shapes × one possible input shape = at most three flatten policies to define.

---

## Output formats

Tools are not required to share a uniform output format. Different tools will produce different result layouts — plain word lists, word pairs (with an arrow or similar), groups of related words per input entry, highlighted letter patterns within words, results with or without scores, etc. The UI should accommodate each tool's natural output shape rather than forcing everything into a single table paradigm. This is a deliberate departure from Wordlisted, which is limited to operations that fit its one output model.

Every individual word in any result — regardless of format — must be accessible for inline editing (the same click-to-edit flow as everywhere else in Grawlix). In a pairs result, that means both words are separately editable. Scores from `All` must come along regardless of output shape — every word displayed gets its score badge.

**Permanent Search row on non-flat output.** When the active tool produces pairs or groups, what does typing in the bottom Search row filter against? Two options to weigh when the first such tool lands:
- *Loose match* — show the row if any word in it matches. Simplest, matches Wordlisted's behavior, no extra UI.
- *Column-specific* — separate inputs per column, or syntax like `right:un*`. More powerful (e.g., "show beheadments where the result starts with un-") but heavier.

Default-loose is probably right for v1; promote to column-specific only if usage shows the loose form isn't enough.

---

## Open questions

- **OneLook integration:** What does their API look like, and what arrangement does XWordInfo have with them?
- **Phonetics & thesaurus data:** How are the CMU dict and Roget XML bundled or fetched? Static assets, CDN, or runtime fetch?
- **Structured vs. unstructured output for chaining.** Distinct from the *display* question above — this is about how outputs are typed when one tool feeds the next. The visible row stack raises the bar: when a user *sees* `Anagram of LINDSEY → then Beheadment` written out, they expect Beheadment to operate on each anagram word, not on text lines. The unstructured version is harder to defend than it was when chaining was an invisible "refine" mode. Two directions in tension:
  - *Unstructured (Unix-style):* Word pairs are just text lines like `SLING -> LING`. Filter tools (wildcard, regex) are universal — they grep against whatever text is present, so a wildcard search on pair results matches against both words simultaneously. Simple, no type system needed.
  - *Structured:* Tools declare typed outputs (word-list, word-pairs, word-groups). Transform tools (anagram, beheadment) operate on individual words, not on `SLING -> LING` as a string. More powerful but requires a type system and some notion of "extract words from this output before passing to next tool."

Filter tools are probably universal either way. The question is really about transform tools chained onto pair/group outputs.
