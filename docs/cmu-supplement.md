# The CMU supplement

[`site/data/cmu-supplement.dict`](../site/data/cmu-supplement.dict) is Grawlix's own pronunciation dictionary, layered over the CMU Pronouncing Dictionary for Rhymes, Phone search and Stress shift.
How it loads and how lookups use it is in [`design.md`](design.md) § *Pronunciations*; this doc covers what's in it and how to add to it.

## What's in it

About 122k words in CMU's format (`word PH ON1 ES`, a second pronunciation as `word(2)`), keyed the way Grawlix keys CMU: lowercase letters only.
A word listed here replaces CMU's whole entry for it.

- **Words the wordlists use that nothing else reads**: not CMU, not the inflection, letter-by-letter or segmenter fallbacks.
  Every word in an entry scored 10 or more was covered when it was built.
- **Words inside run-together phrases** that nothing reads (`carya` and `cordiformis` from `caryacordiformis`).
- **Fixes for segmenter splits that read wrong**, from `sumpin` ("sump in") to `aberrance` ("aber rance").
- **Inflected forms** the inflection fallback would read, each reviewed, so a new stem can't silently change them.
- **Letter-by-letter readings** for keys the wordlists write as initialisms Phone search would spell (`EGOT`, `GIF`), next to any word reading.
  Interjections (`brr`, `psst`) get none: their word reading may not pass the spelling check that keeps only spellable readings, and a letter reading beside it would then drop it.
- **Fixes to CMU's own entries**: FLAUBERT, SADIE, SCARECROW's AE R, the -owski and -ov names, and the rest.

It holds single words only.
A run-together phrase gets no entry even where the segmenter splits it badly; Grawlix reads it however its fallbacks do.

The pronunciations were written by Claude Opus from its own knowledge, given up to three wordlist entries containing each word so it could tell which word was meant.
It agreed with a web-sourced answer key 97% of the time and often beat CMU on foreign names.
Over the Phone search measure below it took JK's hits from 19,394 to 21,573 (+2,254 / −75) and XWI's from 64,455 to 77,725 (+13,632 / −362); most lost hits are wrong readings it corrected, such as PROKOFIEV no longer rhyming with "rah".

It follows CMU's conventions except one: the vowel of *air*, *care* and *share* is always EH R, never EY R (CMU splits 3,905 to 80 on it).
The full conventions are in the prompts.

## Excluded tokens

[`scripts/cmu-supplement/excluded.tsv`](../scripts/cmu-supplement/excluded.tsv) lists the tokens a pass judged to need no entry, so later passes don't pay to judge them again:

- `PHRASE`, with the spaced words: a run-together phrase.
- `FRAGMENT`: a piece nobody says on its own (`ology`).
- `SPLIT`: a token the segmenter splits into words that read it correctly.

## Adding to it

The scripts in [`scripts/cmu-supplement/`](../scripts/cmu-supplement/) read the wordlists from `~/wordlist` (`WORDLISTS` overrides it) and cache CMU in the OS temp dir.
Each pass is the same loop:

1. **List** the tokens the pass covers, with a script below.
2. **Batch** them, 400 lines a batch: `split -l 400 -d -a 3 list.tsv DIR/batch-`.
3. **Answer** each batch with one Opus agent: "Read the instructions at scripts/cmu-supplement/prompts/PROMPT.md and follow them exactly.
   Input: DIR/batch-NNN.
   Write your output with the Write tool to DIR/out-NNN.tsv.
   Read no other files (in particular no dictionaries).
   When done, reply only with the number of lines written."
   Run them in waves of about 10; more at once slows every agent down.
   If the content filter blocks a batch, rerun it in 100-line parts with a note asking for vulgar words to be transcribed neutrally.
4. **Merge** with `node scripts/cmu-supplement/merge.mjs DIR...`, which checks every answer file against its batch (line count, order, valid phones) before writing anything.
5. **Check** what the change did (below), then commit the dictionary and `excluded.tsv` together.

| Pass | List with | Prompt | Answers |
|---|---|---|---|
| Words nothing reads | `candidates.mjs [MIN_SCORE]` | `words.md` | PRON, PHRASE, FRAGMENT |
| Splits that may read wrong | `splits.mjs [MIN_SCORE]` | `splits.md` | OK (→ SPLIT), PRON, PHRASE, FRAGMENT |
| Tokens only inflection reads | `inflected.mjs` | `inflections.md` | OK (enters the listed reading), PRON |
| New keys that may be phrases | `phrase-audit.mjs [REF]` | `word-or-phrase.md` | WORD, PHRASE |
| Readings a change moved | `drift.mjs [REF]` | `drift.md` | NEW, PRON |

A PRON answer is one or more pronunciations separated by ` | `, and replaces whatever entry the token had.
`merge.mjs` also gives every key the wordlists write as an initialism its letter-by-letter reading, if it lacks one.

After adding words, run the last three passes in order: new stems let the inflection fallback read more tokens, new keys may be phrases, and a new stem can change how a token with no entry reads (CARPE turns CARPED from CARP + ED into CARPE + D).
`REF` is the git ref to compare against, `HEAD` by default.

Fix a single bad entry by editing the dictionary by hand.

## Checking a change

`node scripts/cmu-supplement/measure.mjs [REF] [SHOWN]` runs the real Phone search tool over the fixed queries in [`queries.json`](../scripts/cmu-supplement/queries.json) against JK and XWI (entries scored 50 and up), once with `REF`'s supplement and once with the working one, and lists each query's gained and lost hits.
`REF` `none` measures against CMU alone.
Read the lost hits: each is either a wrong reading corrected or a regression.

`node scripts/cmu-supplement/dropped.mjs` lists every supplement word whose entry lacks a reading Phone search gave it without the supplement, from CMU or the inflection fallback.
Most are wrong readings rightly dropped, but a pass can also discard a real one whole when only a detail was wrong: MEDICIS's fallback "meh-DEE-seez" had the wrong consonant, and its entry first kept only "MED-ih-cheez", losing the "meh-DEE-cheez" stress.
Its output is batch input for a pass that adds readings back.
