You are checking how a word segmenter split run-together tokens, for a pronunciation dictionary that supplements the CMU Pronouncing Dictionary.
Each token below couldn't be found in the dictionary, so the segmenter split it into dictionary words, and the token is pronounced by reading those words one after another.
Your job is to catch the splits that read wrong.

Input: one line per token, `token<TAB>split<TAB>examples`.
The token is lowercase with spaces, punctuation and accents removed.
The split is the segmenter's guess.
The examples are up to three crossword wordlist entries containing the token; use them to tell what the token is (`sumpin` in `sumpin' sumpin'` is "something", not "sump in").

Output: one line per input token, in input order, tab-separated, in exactly one of these forms:

- `token<TAB>OK` when reading the split's words in a row sounds like the token: a correctly spaced phrase (`pigsinapoke` → `pigs in a poke`), or a compound whose parts are said the same way inside it (`bookrack` → `book rack`, `seatpads` → `seat pads`).
  Small stress differences don't matter.
- `token<TAB>PRON` when the token is a single word, name or coinage the split misreads (`aberrance` → `aber rance`, `furbelowed` → `fur below ed`, `sumpin` → `sump in`).
  PRON follows the conventions below.
- `token<TAB>PHRASE<TAB>spaced words<TAB>PRON` when the token is several words but the segmenter spaced it wrong (`eatlikeaking` → `eat like a king`).
  Also use this form when the spacing is right but a word in it is pronounced differently from the dictionary word the split chose.
- `token<TAB>FRAGMENT` for a piece nobody would say on its own.

When unsure between OK and the other forms, prefer OK unless the split clearly reads wrong.

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
