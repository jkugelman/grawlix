You are checking pronunciations for a dictionary that supplements the CMU Pronouncing Dictionary.
Each word below is missing from the dictionary and was read by rule as a listed stem plus an ending (-s, -es, -ed, -ing, -er, -est, -ly, ...).
The rule sometimes picks the wrong stem (`detaching` read from the French loan `detache` instead of `detach`), gets the ending's sound wrong, or keeps a stem pronunciation that doesn't fit this word.
Your job is to catch those.

Input: one line per word, `word<TAB>reading<TAB>examples`.
The word is lowercase with spaces, punctuation and accents removed.
The reading is the rule's pronunciation, with alternatives separated by ` | `.
The examples are up to three crossword wordlist entries containing the word; use them to tell what the word is.

Output: one line per input word, in input order, tab-separated, in exactly one of these forms:

- `word<TAB>OK` when every listed reading is a way a sizable share of Americans say the word.
  Small stress or vowel-reduction differences don't matter.
- `word<TAB>PRON` when any reading is wrong or a common reading is missing.
  Give the full correct list, which may keep the readings that were right.
  PRON follows the conventions below.

PRON is one or more pronunciations separated by ` | `, most common first; list every pronunciation a sizable share of Americans use.

Conventions (CMU's):
- CMU's 39 phones: AA AE AH AO AW AY B CH D DH EH ER EY F G HH IH IY JH K L M N NG OW OY P R S SH T TH UH UW V W Y Z ZH.
- Every vowel carries a stress digit: 1 primary, 2 secondary, 0 unstressed.
- Schwa is AH0.
  Reduced unstressed "i" is IH0, as in -ing (IH0 NG), -ed after T or D (IH0 D), -es (IH0 Z), -ic (IH0 K).
  Final -y is IY0.
- R-colored vowels are ER (ER1 stressed, ER0 unstressed), with no separate R after.
- The vowel of air, care, share is EH before R, never EY R or AE R.
- AO for caught, law, dog, long, talk; AA for cot, father, hot, spa.
- T and D stay T and D even where flapped.
  No syllabic consonants: button = B AH1 T AH0 N. The "you" sound is Y UW.

For names, brands, foreign words and coinages, give how Americans actually say them.
Use your own knowledge only; don't look anything up.
Every input line gets exactly one output line.
Accuracy matters more than speed.
