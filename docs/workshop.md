# Phase 2: Workshop

## What this is

A second major mode for Grawlix focused on mining the merged wordlist for ideas and entries. Where Phase 1 (**Library**) is curatorial work — adding lists, rescoring, merging — the **Workshop** is active querying: run operations on your merged wordlist to find words matching specific linguistic patterns.

The two modes are named as rooms you inhabit for different purposes. The mode switcher reads **Library | Workshop**.

Inspiration: [Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson. See `wordlisted.md` for a full breakdown of its search modes and how they work. Grawlix will cover similar ground and add its own tools.

---

## The mode

The Workshop lives in a separate top-level mode, switched via a tab strip or toggle in the header (**Library | Workshop**). It is not integrated into the existing list management UI.

**Why separate:** The two modes serve different phases of construction. The Workshop is for theme generation — exploring the wordlist for ideas, chasing leads, trying operations. The Library serves two distinct activities: occasional setup work (adding lists, configuring rescore rules, importing) and frequent, intensive score and comment editing during filling — when you're working a grid and constantly noting mis-scored words and looking things up. Mixing the Library and Workshop UIs means each competes with the other for space and attention.

**Implicit input:** Mining always operates on the merged output list (all enabled lists, deduplicated, rescored). There is no list selector. The user doesn't think about which list they're mining — they're mining their wordlist.

**Scores come along:** Results show scores from the merged list. This is Grawlix's superpower over Wordlisted. A user can see at a glance that their anagram is a 70 vs. a 30, and can click a result to add it to My Edits — same inline editing as everywhere else.

---

## URL state

The app uses the History API to keep URLs in sync with navigation state, so any view can be bookmarked, shared, or reached via browser back/forward.

The Workshop participates fully. The active mode (`workshop`), the selected tool, and the tool's current inputs are all reflected in the URL. A user can share a link to a specific anagram search or wildcard result and the recipient lands in exactly that state. Browser back/forward navigate through tool history — including through the chain stack when refining results, so the back button peels off one refinement step at a time.

## Tool gallery UI

The tool picker is a browsable left panel — not a dropdown. Each tool gets a small card:

```
┌──────────────────────────────────┐
│ Anagram                          │
│ Same letters, rearranged         │
│ LINDSEY → SNIDELY                │
└──────────────────────────────────┘
```

Cards are grouped by category (Wildcards, Anagrams & letter banks, Letter patterns, Pairs, Oddities, etc.). The user can scan descriptions and examples without clicking anything first — the opposite of Wordlisted's dropdown.

A filter/search input at the top of the panel lets power users find tools by name or keyword.

Selecting a tool reveals its input fields in a strip between the gallery and the results area. Results appear in the familiar virtual-scrolled word table with score badges. The gallery panel is collapsible once you've settled on a tool.

---

## Phases

### Phase 1 — Foundation

Stand up the mode skeleton: the switcher, the layout (gallery panel + results area), and the underlying data layer (materializing the merged word list into a flat array and building fast-lookup indexes). No tools yet, or just one or two to prove the layout.

**Architecture prep goes here, as the first commit.** Extracting `getMergedWords()` (materializing the full merged output) and a `MiningIndex` (word-existence set, sorted-letter map, etc.) is small, additive, and doesn't touch any existing behavior. Doing it first keeps subsequent feature commits clean.

### Phase 2 — Tool gallery + core tools

Build the tool gallery UI as a real, browsable panel. Implement the highest-value tools first — the ones constructors reach for most often. Likely: Simple search (wildcards already exist in the current search box; port/extend), Regex, Anagram, Beheadments, Curtailments, Palindromes, Semordnilaps. This phase proves the end-to-end flow: pick tool → enter input → see scored results → edit a result.

### Phase 3 — Fill out the tool set

Work through the remaining Wordlisted-parity tools and any Grawlix-original tools. Prioritize by usefulness to constructors. The `wordlisted.md` reference is the implementation guide for each tool's logic.

### Phase 4 — Polish and integration

Download from mining results, min-score filter, pinned/favorite tools, any Grawlix-original tools that didn't land in Phase 3, general UX refinement.

---

## Grawlix-original tools

Wordlisted parity is a floor, not a ceiling. This list will grow as construction needs surface — don't treat it as comprehensive.

Early candidates, drawn from recurring construction workflows:

- **Phrase parsing** — parse a run-together entry into all possible word splittings (MOUNTAINGOAT → "MOUNTAIN GOAT"). Every constructor cares about this; Wordlisted has nothing like it. The naive approach produces a lot of junk (bad word breaks), so it needs design work before it's a good tool — scoring, frequency filtering, or some other noise reduction. Treat as a separate design conversation.
- **Nested words** — find words where a valid inner word is inserted inside a valid outer word: MARI(JUAN)A. Both the outer shell and the inserted word must be real words. Stricter and more crossword-specific than Wordlisted's Kangaroo/Sandwich/Joey modes.
- **Letter incrementing** — find word pairs where N letters each shift by one step in the alphabet (A→B, E→F, etc.). A very common crossword theme mechanism, nothing like it in Wordlisted.
- **Anagram families** — show all mutual anagram groups in your wordlist (every cluster of 2+ words that are anagrams of each other), rather than finding anagrams of a given input word. Mining for theme material.
- **Phrase-level alterations** — apply beheadments, curtailments, reversals, etc. to multi-word phrase parses of entries, not just the raw letter string. Wordlisted operates only on the run-together string.

### Phonetics (capability family)

The CMU Pronouncing Dictionary maps words to phoneme sequences, opening up an entire class of sound-based operations that letter-based tools can't touch. This is largely unexplored territory. Early examples from existing scripts: rhyme finding at the phrase level, phonetic substitutions (swap one phoneme for another across the wordlist), sound-shift pairs (move a phoneme from the front of a word to the end to get a new word/phrase). Many more possibilities. Requires bundling or fetching the CMU dict as a data dependency.

### Thesaurus / semantics (capability family)

Roget's Thesaurus (available as structured XML) enables meaning-based searches: find synonyms, antonyms, words in the same semantic category. This unlocks tools Wordlisted can't do at all — Kangaroo words that actually verify the joey is a *synonym* of the kangaroo (rather than just a subsequence), theme-entry finders based on semantic relationships, category membership filters. An undertapped gold mine. Requires bundling Roget data.

---

## Related tools & future integrations

### OneLook / Datamuse (onelook.com, datamuse.com/api)
OneLook indexes an enormous dataset of words and phrases from across the internet — Wikipedia, all major dictionaries, phrase dictionaries, idiom databases, proper nouns, and more. Far broader than any single wordlist.

**Scale:** 16,965,772 entries across 805 dictionaries. Wikipedia, all major dictionaries, phrase dictionaries, idiom databases, proper nouns, and more.

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

The help redesign (see `help-redesign.md`) will happen after List Mining is built — mining docs are not needed before then. During development, treat this document as the living record.

**As each tool group ships:** add a note below summarizing what it does and anything a user would need to know that isn't obvious from the tool card itself. These notes become the raw material for the reference guide section and the welcome tour slide.

**When mining is complete:** the welcome tour gains one or more slides after the current Slide 4 (Searching), and the reference guide gains a List Mining section. `help-redesign.md` already anticipates this expansion.

### Running help notes

*(Add notes here as tools are implemented.)*

---

## Output formats

Tools are not required to share a uniform output format. Different tools will produce different result layouts — plain word lists, word pairs (with an arrow or similar), groups of related words per input entry, highlighted letter patterns within words, results with or without scores, etc. The UI should accommodate each tool's natural output shape rather than forcing everything into a single table paradigm. This is a deliberate departure from Wordlisted, which is limited to operations that fit its one output model.

Every individual word in any result — regardless of format — must be accessible for inline editing (the same click-to-edit flow as everywhere else in Grawlix). In a pairs result, that means both words are separately editable.

---

## Open questions

- **Mode switcher placement:** Exact location in the header TBD once we see it in the layout.
- **OneLook integration:** What does their API look like, and what arrangement does XWordInfo have with them?
- **Phonetics & thesaurus data:** How are the CMU dict and Roget XML bundled or fetched? Static assets, CDN, or runtime fetch?

---

## Brainstorming

### Result chaining

The mental model is Unix piping: each tool takes the previous tool's output as its input. Normal tool selection resets and starts fresh. A **"Refine search"** affordance (exact UI TBD) switches into chaining mode, where the next tool operates on the current results instead of replacing them.

**Navigation:** Stack-based. You can pop the last step (think breadcrumbs or a browser's back button) or clear the whole chain. No reordering — order matters in a pipeline.

**Discoverability:** All tools stay visible and available at all times. Low-friction undo is what makes that safe — you can't really get lost if the back button is right there.

**Unsettled: structured vs. unstructured output.** Two directions in tension:
- *Unstructured (Unix-style):* Word pairs are just text lines like `SLING -> LING`. Filter tools (wildcard, regex) are universal — they grep against whatever text is present, so a wildcard search on pair results matches against both words simultaneously. Simple, no type system needed.
- *Structured:* Tools declare typed outputs (word-list, word-pairs, word-groups). Transform tools (anagram, beheadment) operate on individual words, not on `SLING -> LING` as a string. More powerful but requires a type system and some notion of "extract words from this output before passing to next tool."

Filter tools are probably universal either way. The question is really about transform tools chained onto pair/group outputs.
