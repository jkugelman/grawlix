You are transcribing pronunciations for a dictionary that supplements the CMU Pronouncing Dictionary.
The goal is how Americans commonly say each word, written so it merges cleanly with CMU.

Input: one line per token, `token<TAB>examples`.
The token is lowercase, with spaces, punctuation and accents removed.
The examples are up to three entries from crossword wordlists that contain the token; use them to tell which word, name or sense is meant (`kara` in `Kara Walker`, `fixe` in `prix fixe`).
Use your own knowledge only; don't look anything up.

Output: one line per input token, in input order, tab-separated, in exactly one of these forms:

- `token<TAB>PRON` for a word or name.
  This includes a token that is one word of a longer expression (`fixe` from `prix fixe`, `magnon` from `Cro-Magnon`, `shilly` from `shilly-shally`): give how that word is said within the expression.
- `token<TAB>PHRASE<TAB>spaced words<TAB>PRON` for several words run together.
- `token<TAB>FRAGMENT` only for a piece nobody would say on its own: a suffix like `ology`, or a chopped piece of a longer word that the examples show is never a word by itself.

PRON is one or more pronunciations separated by ` | `, most common first.
List every pronunciation that a sizable share of Americans use, including regional ones and spelling pronunciations of foreign names (`either	IY1 DH ER0 | AY1 DH ER0`, `caramel	K EH1 R AH0 M EH2 L | K AA1 R M AH0 L`, `pecan	P IH0 K AA1 N | P IY1 K AE2 N`).
Don't list casual-speech reductions.
For an abbreviation, give how it's read aloud: the full word if people say the full word (`bldg` as "building"), the letters if people spell it, or both.

Conventions (CMU's):
- CMU's 39 phones: AA AE AH AO AW AY B CH D DH EH ER EY F G HH IH IY JH K L M N NG OW OY P R S SH T TH UH UW V W Y Z ZH.
- Every vowel carries a stress digit: 1 primary, 2 secondary, 0 unstressed.
  Compounds and long words usually have a secondary stress.
- Schwa is AH0.
  Reduced unstressed "i" is IH0, as in the endings -ing (IH0 NG), -ed after T or D (IH0 D), -es (IH0 Z), and -ic (IH0 K).
  Final -y is IY0.
- R-colored vowels are ER (ER1 stressed, ER0 unstressed), with no separate R after.
- The vowel of air, care, share, Mary is EH before R (SH EH1 R), never EY R or AE R.
- AO for the vowel of caught, law, dog, long, talk; AA for cot, father, hot, spa.
- Write T and D as T and D even where they're flapped in speech (butter = B AH1 T ER0).
- No syllabic consonants: button = B AH1 T AH0 N, bottle = B AA1 T AH0 L.
- The "you" sound is Y UW.

For names, brands, foreign words and coinages, give how Americans actually say them, not a letter-by-letter guess (`gnocchi	N Y OW1 K IY0 | N OW1 K IY0`, `chipotle	CH IH0 P OW1 T L EY0`, `kerfuffle	K ER0 F AH1 F AH0 L`).

Every input line gets exactly one output line.
Accuracy matters more than speed.
