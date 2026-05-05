# Phase 2: Workshop

## What this is

A second top-level mode for Grawlix. The **Library** is for setup — adding lists, configuring rescore rules, importing wordlists, curating Sources. The **Workshop** is the daily driver for everything else: querying the merged wordlist, filling grids, mining for themes.

The two modes are named as rooms you inhabit for different purposes. The mode switcher reads **Library | Workshop**.

Inspiration for the mining tools: [Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson. See `wordlisted.md` for a full breakdown of its search modes and how they work. Grawlix will cover similar ground and add its own tools.

---

## The split

**Library — setup.** Manage your Sources: add and remove lists, configure rescore rules, edit individual list contents, manage My Edits, import/export. Visited occasionally — mostly during onboarding and when adjusting your toolkit.

**Workshop — daily driver.** The merged wordlist lives here. The default view is the wordlist itself — stats bar, search box, virtual-scrolled word table — the same shape as today's Master List view, relocated. A tool gallery on the side offers stronger queries: anagrams, regex, beheadments, etc. Used for both **filling** (looking up words and noting score corrections while you work a grid) and **theme generation** (mining the wordlist for ideas).

**Default landing.** On boot — including first run — the user lands directly in the Workshop. The four publisher lists fetch automatically in the background, so the Workshop has data to query right away and a new user can start doing wordlist tricks immediately without thinking about list management. The Library is discovered when the user wants to customize: import a custom wordlist into My Edits, set up XWI for subscribers, reorder priorities, etc.

**Why the split.** Setup and active work compete for screen real estate when bundled together. Each gets its own focused UI. The split also resolves an asymmetry in the previous plan: the Master List used to live in the Library sidebar alongside Sources, even though it isn't a source. With the merged wordlist now living entirely in the Workshop, the Library sidebar is uniform — just Sources.

**The merged wordlist has no separate name in the UI.** You switch to the Workshop, you're looking at it. The "Master List" label disappears from user-facing copy; internally the code still computes a merged result.

**Editing during filling happens in the Workshop.** When you spot a mis-scored word while working a grid, you click to edit it directly from the Workshop's wordlist view. Inline editing is the same as everywhere else — the result lands in My Edits regardless of where the edit happened.

**Individual Source views in the Library still support search and inline editing.** Useful when you specifically want to curate one list's contents. Not the common path.

---

## URL state

The app uses the History API to keep URLs in sync with navigation state, so any view can be bookmarked, shared, or reached via browser back/forward.

The Workshop participates fully. The active mode (`workshop`), the selected tool, and the tool's current inputs are all reflected in the URL. A user can share a link to a specific anagram search or wildcard result and the recipient lands in exactly that state. Browser back/forward navigate through tool history — including through the chain stack when refining results, so the back button peels off one refinement step at a time.

## Tool gallery UI

The Workshop's main pane shows the merged wordlist by default: stats, search bar (with the existing wildcard syntax), and the virtual-scrolled table. This is the most common operation; it's always available without selecting anything from the gallery.

A **tool gallery** runs as a left panel — not a dropdown. Each tool gets a small card:

```
┌──────────────────────────────────┐
│ Anagram                          │
│ Same letters, rearranged         │
│ LINDSEY → SNIDELY                │
└──────────────────────────────────┘
```

Cards are grouped by category (Anagrams & letter banks, Letter patterns, Pairs, Oddities, etc.). The user can scan descriptions and examples without clicking anything first — the opposite of Wordlisted's dropdown.

A filter/search input at the top of the panel lets power users find tools by name or keyword.

Selecting a tool reveals its input fields in a strip between the gallery and the results area. Results replace the default wordlist view in the main pane. Clearing the tool returns to the default view. The gallery panel is collapsible once you've settled on a tool.

**Scores come along.** Results show scores from the merged wordlist. This is Grawlix's superpower over Wordlisted — a user can see at a glance that their anagram is a 70 vs. a 30, and can click a result to add it to My Edits.

---

## Phases

### Phase 1 — Foundation

Stand up the mode skeleton: the switcher, the Workshop layout (gallery panel + main pane), and the underlying data layer (materializing the merged word list into a flat array and building fast-lookup indexes).

The Workshop's default view is essentially today's Master List detail view, relocated. The main UI lift in Phase 1 is the mode shell and gallery panel rather than the wordlist view itself.

**Architecture prep goes here, as the first commit.** Extracting `getMergedWords()` (materializing the full merged output) and a `MiningIndex` (word-existence set, sorted-letter map, etc.) is small, additive, and doesn't touch any existing behavior. Doing it first keeps subsequent feature commits clean.

### Phase 2 — Tool gallery + core tools

Build the tool gallery UI as a real, browsable panel. Implement the highest-value tools first — the ones constructors reach for most often. Likely: Regex, Anagram, Beheadments, Curtailments, Palindromes, Semordnilaps. (Plain wildcard search already lives in the default wordlist view, so it doesn't need a gallery card.) This phase proves the end-to-end flow: pick tool → enter input → see scored results → edit a result.

### Phase 3 — Fill out the tool set

Work through the remaining Wordlisted-parity tools and any Grawlix-original tools. Prioritize by usefulness to constructors. The `wordlisted.md` reference is the implementation guide for each tool's logic.

### Phase 4 — Polish and integration

Download from tool results, pinned/favorite tools, any Grawlix-original tools that didn't land in Phase 3, general UX refinement. (Min-score filtering already comes along with the wordlist view that moves into the Workshop in Phase 1.)

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

The help redesign (see `help-redesign.md`) will happen after the Workshop is built — Workshop docs are not needed before then. During development, treat this document as the living record.

**As each tool group ships:** add a note below summarizing what it does and anything a user would need to know that isn't obvious from the tool card itself. These notes become the raw material for the reference guide section and the welcome tour slide.

**When the Workshop is complete:** the welcome tour gains one or more slides after the current Slide 4 (Searching), and the reference guide gains a Workshop section. `help-redesign.md` already anticipates this expansion.

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
