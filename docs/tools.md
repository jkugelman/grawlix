# Tools

One place to see every tool — shipped and planned — with the card content that surfaces in the gallery (icon, name, short description, example) and current implementation status. Edit categories and rearrange freely; this file is the working list. Eventually folds back into [`design.md`](design.md#tool-gallery--stack), so it sits at the top level of `docs/` rather than under `planned/` despite being a mix.

Source material: shipped catalog lives in `TOOLS` in [`site/src/engine/tools.js`](../site/src/engine/tools.js) (assembled from the per-tool files in [`site/src/engine/tools/`](../site/src/engine/tools/)); planned items come from [`planned/tools.md`](planned/tools.md) (catalog + capability families) and [`wordlisted.md`](wordlisted.md) (Wordlisted's search modes, the reference inspiration).

**Status** — `✓` = shipped (gallery card renders and `run` produces results). Blank = planned (no card, or a card with no `run` yet). `TBD` in any field = not yet specified; fill in when the design firms up. **Phonetics** is gated on bundling the CMU Pronouncing Dictionary; **Thesaurus** is gated on bundling Roget's Thesaurus (XML) — see [`planned/tools.md`](planned/tools.md#capability-families) for the family rationale. Tool lists in those two categories are provisional.

| Status | Category | Tool | Description | Example |
|---|---|---|---|---|
| ✓ | Anagram | 🔀 Anagrams | Same letters, rearranged | ELVIS → LIVES |
|   | Anagram | 🫥 Hidden anagram | Anagrams of the input hidden inside longer words | TBD |
|   | Anagram | 🤏 Almost anagram | Anagrams within *n* letter edits | TBD |
| ✓ | Bank | 🏦 Letter bank | Uses every letter at least once | SPOT → STOOPS, TOPS, POSTOP |
| ✓ | Bank | 🔡 Restricted alphabet | Uses only the given letters | SPOT → STOOP, TOP, POP |
| ✓ | Bank | 🧱 Scrabble | Can be spelled with the given tiles | PARENTAL → PLANE, RENT |
|   | Bank | 🐝 Spelling bee | Made from a restricted alphabet, must include the center letter | TBD |
|   | Cipher | 🥗 Caesar shift | Shift each letter by *n* | TBD |
|   | Cipher | 🔐 Cryptogram | Same letter-pattern shape | ABBA · NOON · DEED |
| ✓ | Halves | 🔂 Repeaters | Left and right halves are the same | TARTAR · HOTSHOTS |
| ✓ | Halves | 🦒 Neckouts | Left and right halves are anagrams | STUCKONESNECKOUT |
| ✓ | Letters | 1️⃣ Isograms | No repeated letters | CYBERPUNK · JUXTAPOSE |
| ✓ | Letters | 🌈 Supervocalics | Each of A E I O U exactly once | AIRQUOTE |
| ✓ | Letters | 👩‍🎤 Monovocalics | Only one distinct vowel | TOOCOOLFORSCHOOL |
| ✓ | Letters | 📈 Alphabetical | Letters in alphabetical order | ABBEY · BILLOWY |
| ✓ | Letters | 📉 Reverse alphabetical | Letters in reverse alphabetical order | SPOOFED · YUPPIE |
| ✓ | Letters | 🦴 Consonantcy | Same consonants in order; vowels may differ | ISAIDNO → SODONE |
| ✓ | Letters | 🅰️ Vowelcy | Same vowels in order; consonants may differ | OUTHOUSE → OUTOFUSE |
| ✓ | Pairs | 🦘 Kangaroos | Words containing the input spread out | KANGA → MILKANDSUGAR |
| ✓ | Pairs | 🍼 Joeys | Words contained in the input spread out | MAJORKEY → JOEY |
|   | Pairs | 🪺 Nested | One word inside another | MARI(JUAN)A |
| ✓ | Palindrome | 🪞 Palindromes | Read the same when mirrored | RACECAR · CIVIC |
| ✓ | Palindrome | ⬅️ Semordnilap | Reverse to get a different word | STRESSED ↔ DESSERTS |
|   | Phonetic | 🎵 Rhymes | Same end-of-word phoneme sequence | TBD |
|   | Phonetic | 🔊 Phonetic substitution | Swap one phoneme for another across the wordlist | TBD |
|   | Phonetic | 🎶 Sound shift | Move a phoneme between word positions (e.g. front → end) | TBD |
| ✓ | Phrase | 🌌 Space out | Guess at where spaces go in multi-word entries | SPACEOUT → SPACE OUT |
| ✓ | Phrase | 🔠 Initialisms | Starting letters spell a word | HOT → Helen of Troy |
|   | Phrase | 👯 Double occupancy | Two-part entries where both halves compound with one reference term | GREEN LIGHT + HOUSE → GREENHOUSE, LIGHTHOUSE |
| ✓ | Rebus | 🚌 Rebus | Squeeze a letter string into one rebus cell | IMBUSY → IMⒷY |
|   | Required | ❗ Required letters | Contains every given letter (in any order) | TBD |
| ✓ | Search | 🔍 Search | Search (and replace) with wildcards | un*ed · c?t |
| ✓ | Search | 🪄 Regex | Search (and replace) with regular expressions | un.+ed · c.{2,4}t |
| ✓ | Side | 🪓 Behead | Remove the first N letters | SWING → WING |
|   | Side | 📥 Add prefix | Add a string prefix | TATA → CANTATA |
|   | Side | 📥 Remove prefix | Remove a string prefix | CANTATA → TATA |
| ✓ | Side | ✂️ Curtail | Remove the last N letters | PARTY → PART |
|   | Side | 📤 Add suffix | Add a string suffix | PETS → PETSCAN |
|   | Side | 📤 Remove suffix | Remove a string suffix | PETSCAN → PETS |
|   | Side | 🪚 Side splitting | Remove both sides | IFATALL → FATAL |
|   | Side | 🎯 Dead center | Input sits at the exact center of a longer word | TBD |
|   | Side | 🥪 Sandwich | TBD | TBD |
|   | Thesaurus | 🤝 Synonyms | Words with similar meaning to a target | TBD |
|   | Thesaurus | ⚔️ Antonyms | Words opposite in meaning | TBD |
|   | Thesaurus | 📚 Category | Words in the same Roget semantic category | TBD |
|   | Thesaurus | 🧠 Synonym kangaroo | Kangaroo whose joey is a synonym of the kangaroo | TBD |
|   | Transform | 🃏 Replace anything | Insert *with* in place of any deleted substring | TBD |
|   | Transform | 🔀 Letter changes | Differs from input by exactly *n* single-letter substitutions | TBD |
|   | Transform | 🔁 Letter swap | Swap two letters throughout | TBD |
