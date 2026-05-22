# Tools

One place to see every tool — shipped and planned — with the card content that surfaces in the gallery (icon, name, short description, example) and current implementation status. Edit categories and rearrange freely; this file is the working list. Eventually folds back into [`design.md`](design.md#tool-gallery--stack), so it sits at the top level of `docs/` rather than under `planned/` despite being a mix.

Source material: shipped catalog lives in `TOOLS` in [`site/index.html`](../site/index.html); planned items come from [`planned/tools.md`](planned/tools.md) (catalog + capability families) and [`wordlisted.md`](wordlisted.md) (Wordlisted's search modes, the reference inspiration).

**Status** — `✓` = shipped (gallery card renders and `run` produces results). Blank = planned (no card, or a card with no `run` yet). `TBD` in any field = not yet specified; fill in when the design firms up. **Phonetics** is gated on bundling the CMU Pronouncing Dictionary; **Thesaurus** is gated on bundling Roget's Thesaurus (XML) — see [`planned/tools.md`](planned/tools.md#capability-families) for the family rationale. Tool lists in those two categories are provisional.

| Status | Category | Tool | Description | Example |
|---|---|---|---|---|
| ✓ | Anagram | 🔤 Anagram | Same letters, rearranged | LINDSEY → SNIDELY |
|   | Anagram | 🔤 Anagram families | Groups of mutual anagrams | TBD |
|   | Anagram | 🫥 Hidden anagram | An anagram of the input hidden inside a longer word | TBD |
|   | Anagram | 🤏 Almost anagram | Anagrams within *n* letter edits | TBD |
|   | Anagram | 🦒 Neckouts | Left and right halves are anagrams | TEAMMATE · INTESTINES |
|   | Bank | 🏦 Letter bank | TBD | TBD |
| ✓ | Bank | 🧩 Letter bank families | Groups of Words built from the same distinct letters | POSTOP · STOOPS · OPTS |
|   | Bank | 🅱️ Scrabble | TBD | TBD |
| ✓ | Bank | 🔡 Made from letters | Words spelled from a subset of the input letters | PARENTAL → PLANE, RENT, … |
|   | Bank | ❗ Required letters | Contains every given letter (in any order) | TBD |
|   | Bank | 🧱 Limited letters | Uses only the given letters | TBD |
|   | Bank | 🐝 Spelling bee | Uses only the given letter set, must include the center letter | TBD |
|   | Cipher | 📈 Caesar shift | Shift each letter by *n* | TBD |
|   | Cipher | 🔐 Cryptogram | Same letter-pattern shape | ABBA · NOON · DEED |
|   | Letters | 🦓 Isograms | No repeated letter | DIALOGUE |
|   | Letters | 🌈 Supervocalics | Each of A E I O U exactly once | SEQUOIA |
|   | Letters | 1️⃣ Monovocs | Only one distinct vowel | TBD |
|   | Letters | 🔂 Repeaters | TBD | TBD |
|   | Letters | 🔠 Alphabetical | Letters in alphabetical order | ABBEY · BILLOWY |
|   | Letters | 🦴 Consonantcy | Same consonants in order; vowels may differ | TBD |
|   | Letters | 🅰️ Vowelcy | Same vowels in order; consonants may differ | TBD |
|   | Pairs | 🦘 Kangaroo | Outer word containing the input as a hidden joey (subsequence) | TBD |
|   | Pairs | 🦘 Joey | TBD | TBD |
|   | Pairs | 🪺 Nested | One word inside another | MARI(JUAN)A |
| ✓ | Palindrome | 🪞 Palindromes | Read the same forwards and back | RACECAR · KAYAK |
| ✓ | Palindrome | ⬅️ Semordnilap | Reverse to get a different word | STRESSED → DESSERTS |
|   | Phonetic | 🎵 Rhymes | Same end-of-word phoneme sequence | TBD |
|   | Phonetic | 🔊 Phonetic substitution | Swap one phoneme for another across the wordlist | TBD |
|   | Phonetic | 🎶 Sound shift | Move a phoneme between word positions (e.g. front → end) | TBD |
|   | Phrase | 💬 Split | Add spaces to multi-word entries | TBD |
|   | Phrase | 👯 Double occupancy | Two-part entries where both halves compound with one reference term | GREEN LIGHT + HOUSE → GREENHOUSE, LIGHTHOUSE |
| ✓ | Search | 🔍 Search | Search (and replace) with wildcards | un*ed · c?t |
| ✓ | Search | 🪄 Regex | Search (and replace) with regular expressions | un.+ed · c.{2,4}t |
| ✓ | Sides | 🪓 Behead | Remove the first N letters | SLING → LING |
|   | Sides | 📥 Add prefix | Add a string prefix | TBD |
|   | Sides | 📥 Remove prefix | Remove a string prefix | TBD |
| ✓ | Sides | ✂️ Curtail | Remove the last N letters | PARTY → PART |
|   | Sides | 📤 Add suffix | Add a string suffix | TBD |
|   | Sides | 📤 Remove suffix | Remove a string suffix | TBD |
|   | Sides | 🪚 Side splitting | Remove both sides | IFATALL → FATAL |
|   | Sides | 🎯 Dead center | Input sits at the exact center of a longer word | TBD |
|   | Sides | 🥪 Sandwich | TBD | TBD |
|   | Thesaurus | 🤝 Synonyms | Words with similar meaning to a target | TBD |
|   | Thesaurus | ⚔️ Antonyms | Words opposite in meaning | TBD |
|   | Thesaurus | 📚 Category | Words in the same Roget semantic category | TBD |
|   | Thesaurus | 🧠 Synonym kangaroo | Kangaroo whose joey is a synonym of the kangaroo | TBD |
|   | Transform | 🃏 Replace anything | Insert *with* in place of any deleted substring | TBD |
|   | Transform | 🔀 Letter changes | Differs from input by exactly *n* single-letter substitutions | TBD |
|   | Transform | 🔁 Letter swap | Swap two letters throughout | TBD |
