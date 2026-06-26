# Tools

One place to see every tool — shipped and planned — with the card content that surfaces in the gallery (icon, name, short description, example) and current implementation status. Edit categories and rearrange freely; this file is the working list. Eventually folds back into [`design.md`](design.md#tool-gallery--stack), so it sits at the top level of `docs/` rather than under `planned/` despite being a mix.

Source material: shipped catalog lives in `TOOLS` in [`site/src/engine/tools.js`](../site/src/engine/tools.js) (assembled from the per-tool files in [`site/src/engine/tools/`](../site/src/engine/tools/)); planned items come from [`planned/tools.md`](planned/tools.md) (catalog + capability families) and [`wordlisted.md`](wordlisted.md) (Wordlisted's search modes, the reference inspiration).

**Status** — `✓` = shipped (gallery card renders and `run` produces results). Blank = planned (no card, or a card with no `run` yet). `TBD` in any field = not yet specified; fill in when the design firms up. **Phonetics** loads the CMU Pronouncing Dictionary at runtime — the worker fetches and caches it on first use (no bundling); Rhymes ships, the rest are planned. **Thesaurus** is gated on bundling a semantic dataset — WordNet (preferred) ahead of Roget's Thesaurus (XML): WordNet is permissively licensed, ships structured synonym/antonym/hypernym relations, and the same dataset can back a prospective morphology layer — see [`planned/tools.md`](planned/tools.md#capability-families) for the family rationale. Tool lists in those two categories are provisional.

| Status | Category | Tool | Description | Example |
|---|---|---|---|---|
| ✓ | Anagram | 🔀 Anagrams | Same letters, rearranged | elvis → lives |
|   | Anagram | 🫥 Hidden anagram | Anagrams of the input hidden inside longer words | TBD |
|   | Anagram | 🤏 Almost anagram | Anagrams within *n* letter edits | TBD |
| ✓ | Bank | 🏦 Letter bank | Uses every letter at least once | spot → stoops, tops, postop |
| ✓ | Bank | 🔡 Restricted alphabet | Uses only the given letters | spot → stoop, top, pop |
| ✓ | Bank | 🧱 Scrabble | Can be spelled with the given tiles | parental → plane, rent |
|   | Bank | 🐝 Spelling bee | Made from a restricted alphabet, must include the center letter | TBD |
| ✓ | Cipher | 🥗 Caesar shift | Shift each letter by *n* | steeds → tuffet |
| ✓ | Cipher | 🔐 Cryptogram | Same letter-pattern shape | level · rotor |
| ✓ | Halves | 🔂 Repeaters | Left and right halves are the same | tartar · hotshots |
| ✓ | Halves | 🦒 Neckouts | Left and right halves are anagrams | stuck one's neck out |
| ✓ | Letters | 1️⃣ Isograms | No repeated letters | cyberpunk · juxtapose |
| ✓ | Letters | 🌈 Supervocalics | Each of A E I O U exactly once | air quote |
| ✓ | Letters | 👩‍🎤 Monovocalics | Only one distinct vowel | too cool for school |
| ✓ | Letters | 📈 Alphabetical | Letters in alphabetical order | abbey · billowy |
| ✓ | Letters | 📉 Reverse alphabetical | Letters in reverse alphabetical order | spoofed · yuppie |
| ✓ | Letters | 🦴 Consonantcy | Same consonants in order; vowels may differ | I said no → so done |
| ✓ | Letters | 🅰️ Vowelcy | Same vowels in order; consonants may differ | outhouse → out of use |
| ✓ | Pairs | 🦘 Kangaroos | Words containing the input spread out | kanga → milk and sugar |
| ✓ | Pairs | 🍼 Joeys | Words contained in the input spread out | major key → joey |
|   | Pairs | 🪺 Nested | One word inside another | mari(juan)a |
| ✓ | Palindrome | 🪞 Palindromes | Read the same when mirrored | racecar · civic |
| ✓ | Palindrome | ⬅️ Semordnilap | Reverse to get a different word | stressed ↔ desserts |
| ✓ | Phonetic | 🎵 Rhymes | Rhyming words and phrases | rhyme → climb, key lime |
|   | Phonetic | 🔊 Phonetic substitution | Swap one phoneme for another across the wordlist | TBD |
|   | Phonetic | 🎶 Sound shift | Move a phoneme between word positions (e.g. front → end) | TBD |
| ✓ | Phrase | 🌌 Space out | Guess at where spaces go in multi-word entries | spaceout → space out |
| ✓ | Phrase | 🔠 Initialisms | Starting letters spell a word | hot → Helen of Troy |
|   | Phrase | 👯 Double occupancy | Two-part entries where both halves compound with one reference term | green light + house → greenhouse, lighthouse |
| ✓ | Rebus | 🚌 Rebus | Squeeze a letter string into one rebus cell | I'm busy → I'm Ⓑy |
|   | Required | ❗ Required letters | Contains every given letter (in any order) | TBD |
| ✓ | Search | 🔍 Search | Search (and replace) with wildcards | un*ed · c?t |
| ✓ | Search | 🪄 Regex | Search (and replace) with regular expressions | un.+ed · c.{2,4}t |
| ✓ | Side | 🪓 Behead | Remove the first N letters | swing → wing |
|   | Side | 📥 Add prefix | Add a string prefix | tata → cantata |
|   | Side | 📥 Remove prefix | Remove a string prefix | cantata → tata |
| ✓ | Side | ✂️ Curtail | Remove the last N letters | party → part |
|   | Side | 📤 Add suffix | Add a string suffix | pets → pet scan |
|   | Side | 📤 Remove suffix | Remove a string suffix | pet scan → pets |
|   | Side | 🪚 Side splitting | Remove both sides | if at all → fatal |
|   | Side | 🎯 Dead center | Input sits at the exact center of a longer word | TBD |
|   | Side | 🥪 Sandwich | TBD | TBD |
|   | Thesaurus | 🤝 Synonyms | Words with similar meaning to a target | TBD |
|   | Thesaurus | ⚔️ Antonyms | Words opposite in meaning | TBD |
|   | Thesaurus | 📚 Category | Words in the same semantic category | TBD |
|   | Thesaurus | 🧠 Synonym kangaroo | Kangaroo whose joey is a synonym | TBD |
|   | Transform | 🃏 Replace anything | Insert *with* in place of any deleted substring | TBD |
|   | Transform | 🔀 Letter changes | Differs from input by exactly *n* single-letter substitutions | TBD |
|   | Transform | 🔁 Letter swap | Swap two letters throughout | TBD |
