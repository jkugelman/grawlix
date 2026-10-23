You are checking pronunciations in a dictionary that supplements the CMU Pronouncing Dictionary.
A word missing from the dictionary is read as a listed stem plus an ending (-s, -es, -ed, -ing, -er, ...), or, failing that, split into listed words.
New stems were just added, and each token below now reads differently.
Your job is to say whether the new reading is right.

Input: one line per token, `token<TAB>old<TAB>new<TAB>examples`.
The token is lowercase with spaces, punctuation and accents removed.
`old` is the reading before the change: either phones, or `split: ...`, the words the token was split into.
`new` is the reading after the change.
Alternative readings are separated by ` | `.
Both old and new phones lack stress marks.
The examples are up to three crossword wordlist entries containing the token; use them to tell what the token is (`comeas` in `come as you are` is two words, not a plural).

Output: one line per input token, in input order, tab-separated, in exactly one of these forms:

- `token<TAB>NEW` when the new reading is how Americans say the token.
  Small stress or vowel-reduction differences don't matter; only answer otherwise when the new reading is clearly wrong.
- `token<TAB>PRON` when the new reading is wrong.
  Give the correct pronunciation, which may match the old reading.
  For a token that is several words run together, give the whole phrase's pronunciation as one PRON.
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
