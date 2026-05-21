# Tools

One place to see every tool — shipped and planned — with the card content that surfaces in the gallery (icon, name, short description, example) and current implementation status. Edit categories and rearrange freely; this file is the working list. Eventually folds back into [`design.md`](design.md#tool-gallery--stack), so it sits at the top level of `docs/` rather than under `planned/` despite being a mix.

Source material: shipped catalog lives in `TOOLS` in [`site/index.html`](../site/index.html); planned items come from [`planned/tools.md`](planned/tools.md) (catalog + capability families) and [`wordlisted.md`](wordlisted.md) (Wordlisted's search modes, the reference inspiration).

**Status** — `✓` = shipped (gallery card renders and `run` produces results). Blank = planned (no card, or a card with no `run` yet). `TBD` in any field = not yet specified; fill in when the design firms up.

## Anagrams & letter banks

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
| ✓ | 🔤 | Anagram | Same letters, rearranged | LINDSEY → SNIDELY |
| ✓ | 🔡 | Made from letters | Words spelled from a subset of the input letters | PARENTAL → PLANE, RENT, … |
| ✓ | 🧩 | Letter clusters | Group: words built from the same distinct letters | POSTOP · STOOPS · OPTS |
|   | 🫥 | Hidden anagram | An anagram of the input hidden inside a longer word | TBD |
|   | 🤏 | Almost anagram | Anagrams within *n* letter edits | TBD |
|   | 🏦 | Letter bank | TBD | TBD |
|   | ❗ | Required letters | Contains every given letter (in any order) | TBD |
|   | 🧱 | Limited letters | Uses only the given letters | TBD |

## Letter patterns

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
| ✓ | 🔍 | Search | Search (and replace) with wildcards | un*ed · c?t |
| ✓ | 🪄 | Regex | Search (and replace) with regular expressions | un.+ed · c.{2,4}t |
| ✓ | 🔄 | Palindrome | Reads the same forwards and back | RACECAR · KAYAK |
|   | 🦘 | Kangaroo | Outer word containing the input as a hidden joey (subsequence) | TBD |
|   | 👶 | Joey | TBD | TBD |
|   | 🥪 | Sandwich | TBD | TBD |
|   | 🎯 | Dead center | Input sits at the exact center of a longer word | TBD |
|   | 🔀 | Letter changes | Differs from input by exactly *n* single-letter substitutions | TBD |
|   | 🦴 | Consonantcy | Same consonants in order; vowels may differ | TBD |
|   | 🅰️ | Vowelcy | Same vowels in order; consonants may differ | TBD |
|   | 🔐 | Cryptogram | Same letter-pattern shape (positions consistent across letters) | ABBA · NOON · DEED |

## Pairs

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
| ✓ | 🪓 | Behead | Drop the first letter(s) to get a new word | SLING → LING |
| ✓ | ✂️ | Curtail | Drop the last letter(s) to get a new word | PARTY → PART |
| ✓ | ↔️ | Semordnilap | Reverse to get a different word | STRESSED → DESSERTS |

## Transforms

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
|   | 🃏 | Replace anything | Insert *with* in place of any deleted substring | TBD |
|   | ⚖️ | Add/remove one | Add or remove one occurrence of a substring (bidirectional) | TBD |
|   | 🧮 | Add/remove all | Same logic, every occurrence | TBD |
|   | 📥 | Add prefix | Prepend a string | TBD |
|   | 📤 | Add suffix | Append a string | TBD |
|   | 🪚 | Side splitting | TBD (transform or filter — decide when it lands) | TBD |
|   | 🔁 | Letter swap | Swap two letters throughout | TBD |

## Curiosities

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
|   | 🦓 | Isograms | No repeated letter | DIALOGUE |
|   | 🌈 | Supervocalics | Each of A E I O U exactly once | SEQUOIA |
|   | 1️⃣ | Monovocs | Only one distinct vowel | TBD |
|   | 🔂 | Repeaters | TBD | TBD |
|   | 🦒 | Neckouts | TBD | TBD |
|   | 🔠 | Alphabetical | Letters in alphabetical order | ABBEY · BILLOWY |

## Misc

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
|   | 🐝 | Spelling bee | Uses only the given letter set, must include the center letter | TBD |
|   | 👯 | Double occupancy | Two-part entries where both halves compound with one reference term | GREEN LIGHT + HOUSE → GREENHOUSE, LIGHTHOUSE |
|   | ♾️ | Everything | Identity — no filtering | — |

## Grawlix-original

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
|   | 💬 | Phrase parsing | Synthesizes the joined-phrase form of multi-word entries | TBD |
|   | 🪆 | Nested words | Outer shell with an inner word nested inside; both must be real entries | TBD |
|   | 📈 | Letter incrementing | Each letter shifted by *n* (Caesar-style) to form a new entry | TBD |
|   | 👨‍👩‍👧 | Anagram families | Group: clusters of 2+ mutual anagrams | TBD |

## Phonetics

Gated on bundling the CMU Pronouncing Dictionary as a runtime data dependency. See [`planned/tools.md`](planned/tools.md#phonetics) for the family rationale. Largely unexplored territory; tool list is provisional.

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
|   | 🎵 | Rhymes | Same end-of-word phoneme sequence | TBD |
|   | 🔊 | Phonetic substitution | Swap one phoneme for another across the wordlist | TBD |
|   | 🎶 | Sound shift | Move a phoneme between word positions (e.g. front → end) | TBD |

## Thesaurus / semantics

Gated on bundling Roget's Thesaurus (XML). See [`planned/tools.md`](planned/tools.md#thesaurus--semantics). Unlocks meaning-based searches that letter-based tools can't express; tool list is provisional.

| Status | Icon | Name | Description | Example |
|---|---|---|---|---|
|   | 🤝 | Synonyms | Words with similar meaning to a target | TBD |
|   | ⚔️ | Antonyms | Words opposite in meaning | TBD |
|   | 📚 | Category | Words in the same Roget semantic category | TBD |
|   | 🧠 | Synonym kangaroo | Kangaroo whose joey is a synonym of the kangaroo | TBD |
