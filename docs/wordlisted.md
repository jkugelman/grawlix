# Wordlisted Reference

[Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson is a browser-based wordlist search tool for wordplay and crossword construction. Source: https://github.com/adamaaronson/wordlisted

All matching is case-insensitive. Words are processed in uppercase internally. The "vowel" set varies by mode: Consonantcy/Vowelcy/Monovocs treat Y as a vowel; Supervocalics uses only A E I O U.

---

## Result types

Modes fall into two display categories:

- **Single** — returns individual words satisfying a condition
- **Pairs** — returns word → word pairs, where the transformed word must also exist in the wordlist

---

## Wildcards

### Simple search
Pattern matching where `?` matches any one letter and `*` matches any number of letters. Converted to a regex anchored at start and end. Example: `A?E*E` → AWESOME.

### Regex
Full regular expression match. Example: `^S.*[AEIOU]{4}` → SEQUOIA.

---

## Anagrams and letter banks

### Anagram
Words formed by rearranging all the letters of the input. Candidate must not equal the input. Example: LINDSEY → SNIDELY.

### Made from letters
Words that can be spelled using only the letters in the input (a subset — the candidate may use fewer letters). Scrabble-style frequency check. Example: PARENTING → PREGNANT.

### Hidden anagram
Words containing an anagram of the input as a contiguous substring — the input letters must appear scrambled inside the candidate, not as a literal substring. Example: HOLLY → TALLYHO.

### Almost anagram
Words the same length as the input where N letters differ from a perfect anagram (letter-frequency difference ÷ 2 = N). Example: ANAGRAM with 1 change → GRANDMA.

### Letter bank
Words sharing the same set of unique letters as the input, ignoring repetition. The candidate can be much longer and may repeat letters freely. Example: TIME MACHINE → MATHEMATICIAN.

### Required letters
Words that contain all of the specified letters (with sufficient frequency). The candidate may have additional letters. Example: RSTUVW → LIVERWURST.

### Limited alphabet
Words that use only letters from the given set, any number of times. Example: ABCDEFG → CABBAGE.

---

## Letter patterns

### Kangaroo word
Words for which the input is a subsequence — the input's letters appear in order within the candidate, possibly with gaps. Candidate must be longer than input. Example: RAUCOUS → RAMBUNCTIOUS.

### Joey word
Inverse of Kangaroo: words that are a subsequence of the input. The candidate's letters must appear in order within the input. Example: MASCULINE → MALE.

### Sandwich word
Words that start with some non-empty prefix of the input and end with the corresponding suffix, with additional letters inserted in between. The candidate must be longer than the input. Example: CRUST → CRUMBLIEST (starts with CR, ends with UST).

### Dead center
Words that contain the input as a substring positioned exactly in the middle (equal padding on each side). Example: ABE → ALPHABETIZE.

### Letter changes
Words the same length as the input with exactly N letters different (Hamming distance = N). Example: PERPETRATE with 1 → PERPETUATE.

### Consonantcy
Words with the same consonant sequence as the input. Vowels (A E I O U Y) are stripped from both; remaining consonant strings must match. Example: AMONG US → MONGOOSE.

### Vowelcy
Words with the same vowel sequence as the input. Consonants are stripped from both; remaining vowel strings must match. Example: SEQUOIA → EUPHORIA.

### Cryptogram
Words with the same letter-repetition pattern as the input (same length, same positions where letters recur). Each letter is replaced by the index of its first appearance; those index sequences must match. Example: ALFALFA (0,1,2,0,1,2,0) → ENTENTE (0,1,2,0,1,2,0).

---

## Pairs

All pairs modes produce word → word results where the transformed word must exist in the wordlist.

### Replace one
Replace one occurrence of a string with another string. Each occurrence yields a separate candidate. Example: replacing S with GR → SOUNDS → GROUNDS.

### Replace all
Replace every occurrence of a string with another string. Example: replacing S with SS → POSES → POSSESS.

### Replace anything
Replace any equal-length substring at any position with the given letters. Example: THE → ANTIBIOTIC → ANTITHETIC.

### Add or remove one
Remove one occurrence of a string. (The "add" direction appears as the reverse of the pair.) Example: removing T → MEDITATE → MEDIATE.

### Add or remove all
Remove every occurrence of a string. Example: removing ER → DERRIERES → DRIES.

### Add prefix
Prepend letters to the word. Example: prefix ADAM → ANT → ADAMANT.

### Add suffix
Append letters to the word. Example: suffix NUT → DOUGH → DOUGHNUT.

### Anagram with
Word pairs where the input word's letters can be combined with one wordlist word and rearranged to form another wordlist word. Example: FOUR → TEN → FORTUNE (TEN + FOUR anagrams to FORTUNE).

### Beheadments
Remove the first letter. Example: EQUALITY → QUALITY.

### Curtailments
Remove the last letter, excluding words that merely lose a plural S. Example: MAGNETON → MAGNETO.

### Side splitting
Remove both the first and last letters. Example: SLOBBIEST → LOBBIES.

### Letter swap
Simultaneously swap all occurrences of two strings with each other. Example: swapping A and O → ARGON → ORGAN.

### Regex replacement
Apply a regex replacement (first match, not global). Example: pattern `^..(.*)$` with replacement `$1` → HEADDRESS → ADDRESS.

---

## Huh, neat

### Palindromes
Words that read the same forwards and backwards. Example: RACECAR.

### Semordnilaps
Word pairs where one word reversed equals the other. Each pair shown once. Example: DESSERTS → STRESSED.

### Isograms
Words with no repeated letters (every letter appears exactly once). Example: UNCOPYRIGHTABLE.

### Supervocalics
Words containing each of A, E, I, O, U exactly once (no doubled vowels; Y not counted). Example: EDUCATION.

### Monovocs
Words containing exactly one type of vowel (A, E, I, O, U, or Y), repeated as many times as needed. Example: RELENTLESSNESS (only E).

### Repeaters
Words whose first half and second half are identical (must have even length). Example: HOTSHOTS.

### Neckouts
Words whose two halves are anagrams of each other but not identical (must have even length). Example: INTESTINES.

### Alphabetical
Words whose letters are already in alphabetical order. Example: FORTY.

---

## Miscellaneous

### Spelling Bee solver
Finds words valid for the NYT Spelling Bee: must contain the center letter, use only letters from the center + outer set, and be at least 4 letters long.

### Everything
Returns every word in the wordlist. Useful for sorting or exporting the full list.
