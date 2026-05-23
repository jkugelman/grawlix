# Tools

One place to see every tool — shipped and planned — with the card content that surfaces in the gallery (icon, name, short description, example) and current implementation status. Edit categories and rearrange freely; this file is the working list. Eventually folds back into [`design.md`](design.md#tool-gallery--stack), so it sits at the top level of `docs/` rather than under `planned/` despite being a mix.

Source material: shipped catalog lives in `TOOLS` in [`site/index.html`](../site/index.html); planned items come from [`planned/tools.md`](planned/tools.md) (catalog + capability families) and [`wordlisted.md`](wordlisted.md) (Wordlisted's search modes, the reference inspiration).

**Status** — `✓` = shipped (gallery card renders and `run` produces results). Blank = planned (no card, or a card with no `run` yet). `TBD` in any field = not yet specified; fill in when the design firms up. **Phonetics** is gated on bundling the CMU Pronouncing Dictionary; **Thesaurus** is gated on bundling Roget's Thesaurus (XML) — see [`planned/tools.md`](planned/tools.md#capability-families) for the family rationale. Tool lists in those two categories are provisional.

| Status | Category | Tool | Description | Example |
|---|---|---|---|---|
| ✓ | Anagram | 🔤 Anagram | Same letters, rearranged | ELVIS → LIVES |
|   | Anagram | 🔤 Anagram family | Groups of mutual anagrams | TBD |
|   | Anagram | 🫥 Hidden anagram | An anagram of the input hidden inside a longer word | TBD |
|   | Anagram | 🤏 Almost anagram | Anagrams within *n* letter edits | TBD |
|   | Bank | 🏦 Letter bank | TBD | TBD |
| ✓ | Bank | 🧩 Letter bank families | Groups built from the same distinct letters | POSTOP · STOOPS · OPTS |
| ✓ | Bank | 🔡 Made from letters | Spelled from a subset of the input letters | PARENTAL → PLANE, RENT, … |
|   | Bank | ❗ Required letters | Contains every given letter (in any order) | TBD |
|   | Bank | 🧱 Limited letters | Uses only the given letters | TBD |
|   | Bank | 🅱️ Scrabble | Made from a set of letters | TBD |
|   | Bank | 🐝 Spelling bee | Made from a set of letters with repeats, must include the center letter | TBD |
|   | Cipher | 📈 Caesar shift | Shift each letter by *n* | TBD |
|   | Cipher | 🔐 Cryptogram | Same letter-pattern shape | ABBA · NOON · DEED |
|   | Halves | 🔂 Repeater | Left and right halves are the same | TARTAR · HOTSHOTS |
|   | Halves | 🦒 Neckout | Left and right halves are anagrams | TEAMMATE · INTESTINES |
| ✓ | Letters | 1️⃣ Isogram | No repeated letters | CYBERPUNK · JUXTAPOSE |
| ✓ | Letters | 🌈 Supervocalic | Each of A E I O U exactly once | AIRQUOTE |
| ✓ | Letters | 👩‍🎤 Monovocalic | Only one distinct vowel | TOOCOOLFORSCHOOL |
| ✓ | Letters | 🔠 Alphabetical | Letters in alphabetical order | ABBEY · BILLOWY |
| ✓ | Letters | 🔠 Reverse alphabetical | Letters in reverse alphabetical order | SPOOFED · YUPPIE |
|   | Letters | 🦴 Consonantcy | Same consonants in order; vowels may differ | TBD |
|   | Letters | 🅰️ Vowelcy | Same vowels in order; consonants may differ | TBD |
|   | Pairs | 🦘 Kangaroo | Outer word containing the input as a hidden joey (subsequence) | TBD |
|   | Pairs | 🦘 Joey | TBD | TBD |
|   | Pairs | 🪺 Nested | One word inside another | MARI(JUAN)A |
| ✓ | Palindrome | 🪞 Palindrome | Read the same when mirrored | RACECAR · CIVIC |
| ✓ | Palindrome | ⬅️ Semordnilap | Reverse to get a different word | STRESSED ↔ DESSERTS |
|   | Phonetic | 🎵 Rhymes | Same end-of-word phoneme sequence | TBD |
|   | Phonetic | 🔊 Phonetic substitution | Swap one phoneme for another across the wordlist | TBD |
|   | Phonetic | 🎶 Sound shift | Move a phoneme between word positions (e.g. front → end) | TBD |
|   | Phrase | 💬 Split | Add spaces to multi-word entries | TBD |
|   | Phrase | 👯 Double occupancy | Two-part entries where both halves compound with one reference term | GREEN LIGHT + HOUSE → GREENHOUSE, LIGHTHOUSE |
| ✓ | Search | 🔍 Search | Search (and replace) with wildcards | un*ed · c?t |
| ✓ | Search | 🪄 Regex | Search (and replace) with regular expressions | un.+ed · c.{2,4}t |
| ✓ | Side | 🪓 Behead | Remove the first N letters | SLING → LING |
|   | Side | 📥 Add prefix | Add a string prefix | TBD |
|   | Side | 📥 Remove prefix | Remove a string prefix | TBD |
| ✓ | Side | ✂️ Curtail | Remove the last N letters | PARTY → PART |
|   | Side | 📤 Add suffix | Add a string suffix | TBD |
|   | Side | 📤 Remove suffix | Remove a string suffix | TBD |
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
