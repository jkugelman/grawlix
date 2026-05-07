# Tools (gallery & mining)

## What this is

Grawlix's mining side: anagrams, regex, beheadments, curtailments, and a long tail of letter/sound/meaning tricks for both **filling** (looking up words and noting score corrections while you work a grid) and **theme generation** (mining the wordlist for ideas). Tools live in the gallery panel on the left of the main app shell.

Inspiration: [Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson. See `../wordlisted.md` for a full breakdown of its search modes and how they work. Grawlix will cover similar ground and add its own tools.

---

## Goal

The tool gallery is where Grawlix's [project goal](../../README.md#goals) — democratize wordlist manipulation — does most of its work. Constructors who program can write Python to anagram, behead, phonetic-substitute, semantic-filter, etc. against their wordlists. The gallery's job is to put those moves in non-programmers' hands. Useful filter when evaluating a candidate tool: *would a programmer reach for this often enough to write a script?* If yes, it probably belongs.

---

## Tool stack & gallery UI

The main pane is a **tool stack** above a virtual-scrolled results table. Each tool the user has added gets one row in the stack:

```
┌─────────────────────────────────────────────────┐
│ Anagram      LINDSEY                       [✕]  │
│   then  Search      pattern: DOG                │
└─────────────────────────────────────────────────┘
[ results table here ]
```

**Single tool vs. chaining.** Most sessions use one tool at a time — fire up Anagram, type input, scan results. Chaining transforms (Anagram → Beheadments, Search → Anagram pre-filter) is rare; programmer-constructors who want pipelines tend to write Python instead. The stack design optimizes for the single-tool 98% case while keeping chaining as a discoverable but unobtrusive 2% gesture. Two affordances on each gallery card make this work — see "Tool gallery" below.

**Live result filtering**, by contrast, is normal use. Getting a thousand anagrams and live-filtering them down to ones containing a substring is everyday, not a power gesture. The permanent bottom Search row exists for exactly this — it's the result filter for whatever tool is active above it.

Each row carries the tool's name, its input fields (if any), and an X to remove. Row order is pipeline order — each row's output feeds the next. The first row reads from whichever wordlist is selected in the left rail dropdown (`All` by default); subsequent rows transform the previous row's results. The results table shows the output of the bottom row. A small `then` prefix on rows 2+ makes the sequencing explicit; row 1 has no prefix.

**The bottom row is always a Search row** — permanent, no X, can't be removed or reordered. This makes the everyday "type and look" use case immediate (just type) and gives Search a stable keyboard target (**Alt-S** focuses it). Search is also in the gallery as an addable tool, so a user can prepend a Search row above a transform: `Search → Anagram → [permanent Search]` pre-filters the input, transforms, and filters the output. Two Search rows aren't redundant when there's a transform between them.

The permanent bottom Search is the only difference from "any other tool." Adding tools above it works exactly like adding any other row.

**Tools without inputs** (Palindromes, Anagram families, etc.) still get a row carrying the tool name and an X — no input fields. Composes cleanly: `Search → Palindromes` lists palindromes within the search results.

**Reordering.** Order matters in a pipeline. To change order, the user removes rows (X) and re-adds them. Drag handles are deliberately not provided — chaining is a 2%-case gesture and reordering is rarer still; the design surface isn't worth the touch/keyboard-accessibility complexity.

**Empty stack** is just the permanent Search row alone (no `then` prefix, empty input). Picking a tool from the gallery (see below) sets it as the active tool above the Search row.

The **tool gallery** is a persistent left-rail panel — not a dropdown, not a dialog. Each tool gets a small card:

```
┌──────────────────────────────────┐
│ Anagram                          │
│ Same letters, rearranged         │
│ LINDSEY → SNIDELY                │
└──────────────────────────────────┘
```

**Category picker.** A fixed category menu sits at the top of the rail (Anagrams & letter banks, Letter patterns, Pairs, Oddities, etc.). Clicking a category swaps the cards displayed below; the menu itself never moves. This gives spatial stability (categories live in the same place every time), keeps cards visible while working, and devotes the full rail width to tools. Matches the user's settle-into-a-tool-set pattern — a constructor with a theme idea picks the relevant category once and stays there for the session.

*Alternatives evaluated:*
- *Inline accordion* (rejected) — categories collapsed; clicking a header expands cards in place, pushing other categories down. Items shifting position under the cursor as sections open/close fights spatial recall and muscle memory; the user dislikes accordions for exactly this reason.
- *Card list* (viable fallback if Category picker's category-click step feels unnecessarily mediated) — plain vertical scroll of all tool cards with a pinned filter input at the top. Most conservative option; scrolling required past viewport but not painful.
- *Icon strip* (viable fallback if Category picker's rail width feels costly in use) — VS Code activity-bar style: a thin (~50px) strip of category icons at rest; clicking one slides out a side panel with that category's cards. Wins on main-pane width (most pixels back to the table). Loses on interaction count (two-step to reach a tool) and on panel-open state — either auto-closes (lose context) or stays open and eats the saved width.

The user can scan descriptions and examples without clicking anything first — the opposite of Wordlisted's dropdown.

**Every tool has a unique icon.** Aids scanning, learnability, and gives the gallery visual personality. Icons appear on cards in the rail and at the front of stack rows.

**Card click behavior.** Each card has two click targets:

- *Click the card surface* → "use this tool." Replaces the user stack with just this tool. Stack becomes `[ThisTool, permSearch]`. The 98%-case gesture. **Destructive when a multi-tool stack exists** — clears it down to just this tool. No confirm dialog; at most an undo toast. The 2%-case user knows to use `+`, and accidental loss is recoverable by rebuilding (live re-execution makes that fast).
- *Click the "+" badge on the card's right edge* → "add this tool to my pipeline." Appends to the bottom of the user stack, just above the permanent Search. Stack becomes `[...existing, ThisTool, permSearch]`. The 2%-case chaining gesture. The `+` is **hover-revealed** — vertically centered on the right edge of the card, no visual presence at rest. Discoverability cost is accepted: chaining is a 2% feature, and the people who want it are the ones likely to mouse-explore. Position matches the dominant convention for hover-revealed secondary actions on row/tile UI (Spotify track rows, Apple Music, VS Code file-explorer hover actions, Linear issue rows). Tooltip: "Add to stack."

Pipeline order is click order, top-to-bottom. First card clicked is first in the pipeline. To pre-filter an existing tool's input, the user starts over (clear, then click Search, then `+` the new tool). No prepend gesture.

**Active-card highlighting.** Cards whose tools appear in the user stack are visually marked active in the gallery. Communicates "these are the tools currently in your pipeline."

**X on the last user-tool row** collapses the stack to `[permSearch]` (the empty-stack state). Same state as never having clicked a tool. The hypothetical alternative — "always one tool active, X disabled on the last row" — was rejected as a footgun.

A filter/search input at the top of the panel lets users find tools by name or keyword across categories. **Alt+T** focuses it.

**Scores come along.** Results show scores from `All` (the merged wordlist). This is Grawlix's superpower over Wordlisted — a user can see at a glance that their anagram is a 70 vs. a 30, and can click a result to add it to My Edits.

---

## Downloading results

A download affordance near the results table saves the current output to disk — whatever the bottom row of the stack produces. For the empty stack (just the permanent Search row), that's "the filtered list" — the merged `All` view restricted to the current pattern. For a longer stack (`Anagram LINDSEY → Search DOG`) it's the full pipeline output. The button is always present; what it produces just follows the stack.

The everyday case is filling — narrow `All` with a pattern, then save the matches as a working set.

Default filename describes the stack: `grawlix-search-DOG.txt`, `grawlix-anagram-LINDSEY-search-DOG.txt`. Same tool keys as the URL query string (see `url-routing.md`), so the file is self-describing and re-running the same stack later won't overwrite the prior snapshot.

Format follows the tool's natural output shape — for plain word lists, the standard `WORD;SCORE[;COMMENT]` used elsewhere. Pair / group outputs need their own format design; deferred until those tools land. See *Output formats* below.

This is a third "give me a file" path alongside the two existing ones (All/My Edits via Sync & backup, individual wordlist via the Wordlists dialog). It's distinct because the file isn't a backup or a wordlist export — it's a snapshot of the current view, usually filtered or transformed. Implementation lands with Phase 3 (`Download from tool results`).

---

## Phases

The app-shell work is a prerequisite — the gallery panel slot and the main-pane swap-in behavior come from there.

### Phase 1 — Stack mechanism + core tools

Stand up the row-stack mechanism with Search as the first tool (it's the default-populated row, so it's the natural first implementation). Then add the highest-value transforms — likely Regex, Anagram, Beheadments, Curtailments, Palindromes, Semordnilaps. This phase proves the end-to-end flow: empty stack → pre-populated Search row → add transform from gallery → chain another row → edit a result.

### Phase 2 — Fill out the tool set

Work through the remaining Wordlisted-parity tools and any Grawlix-original tools. Prioritize by usefulness to constructors. The `../wordlisted.md` reference is the implementation guide for each tool's logic.

### Phase 3 — Polish and integration

Download from tool results, pinned/favorite tools, any Grawlix-original tools that didn't land in Phase 2, general UX refinement.

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
