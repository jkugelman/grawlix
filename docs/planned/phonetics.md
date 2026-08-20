# Phonetics (planned)

Grawlix's **phonetics** capability family: sound-based tools that letter-based ones can't touch — rhymes, homophones, spoonerisms, phonetic substitution, and more. They all run on a phonemization engine that maps text to phonemes. **Rhymes ships today** on the CMU Pronouncing Dictionary ([`engine/tools/rhymes.js`](../../site/src/engine/tools/rhymes.js) + [`engine/phonetics.js`](../../site/src/engine/phonetics.js)); everything else here is planned.

This document is the design behind that family: the engine choice (CMU vs eSpeak NG) and what eSpeak unlocks, the runtime and licensing consequences of adopting it, a shared phonetics core the tools sit on, and per-tool designs — spoonerisms worked out in full, plus the rhyme extensions, homophones, and the rest. The catalog of individual tool cards (icon, name, description) lives in [`../tools.md`](../tools.md); the capability family is listed in [`tools.md`](tools.md). This doc owns the *how*.

> **Status: mostly planned.** Two pieces ship — the [whole-entry rhyme](#whole-entry-rhyme-shipped) and the spacing pass that feeds it — and both did so on CMU alone, without eSpeak; their sections are marked and written in the present tense. Everything else is a plan to vet — ideally with an independent review pass — before any code. The eSpeak capabilities, performance numbers, and the spoonerism algorithm below were validated empirically against eSpeak NG 1.50 (Ubuntu's `espeak-ng`); newer upstream releases improve letter-to-sound accuracy and speed.

---

## Where phonetics stands today

Rhymes is the only shipped phonetic tool, and the planned tools build on its mechanics:

- The **CMU Pronouncing Dictionary** maps a word to one or more pronunciations, each a flat phone string with a stress digit on every vowel (`1` primary, `2` secondary, `0` unstressed). CMU marks **no syllable boundaries**.
- `rhymingPart(pron, mode)` takes the suffix from an anchor vowel to the end, stress digits stripped. **Loose** (default) anchors on the last vowel of *either* stress rank; **Strict** only on the primary. So under loose, cumberbatch ~ match and dynamite ~ kite; under strict only primary-on-primary rhymes survive (cat/bat).
- `rhymingPartsOf(text, mode)` looks up the **last word** of a phrase — a phrase rhymes on its last word only. An entry with no spaces that CMU doesn't know is spaced out first (`bestSpaceOutSplit`, the Space out segmenter), which is what lets an unspaced wordlist rhyme at all: measured against XWI, Spread the Wordlist and Broda, the share of entries that can rhyme goes from 13–22% to 75–80%. The dictionary wins where it has the whole string (`NOTABLE` is not `NO TABLE`), and a one-letter final part is rejected as `rankedSplits`' short-part escape hatch (`YOWLERS → YOWLER S`).
- The **typed** entry gets a second pass at the wider `SPACE_OUT_WINDOWS.many`, which the wordlist does not. At the default window the scorer prunes `time machine` outright — wordfreq carries the glued `timemachine` as a token of its own, and it outscores the split — so a pasted unspaced entry returned nothing with nothing on screen to explain it. Widening for the wordlist instead is what costs: it rescues 4% of XWI and reads them as `orbs → or bs`, `not ate`, `women swear`. One deliberate query is worth a guess; 280k rows are not.
- Filter mode: an entry matches if it shares any rhyming part with the target. Group mode buckets entries by rhyming part (a family needs ≥2 chains and ≥2 distinct last words; trivial same-word families drop). An entry carries a key per reading, so one family is bucketed once per reading its members share — `bucketize` drops the repeats and any family wholly inside a larger one, which matters most under Whole, where a key is an entire pronunciation.

- The Match slider's third stop, **Whole**, drops the anchor entirely and keys the *whole* entry syllable by syllable (`rhymingPartsOf(text, 'whole')` → `syllabify` + `wholeEntryParts`). See [Whole-entry rhyme](#whole-entry-rhyme-shipped).

One rhyme extension is parked against this baseline — a slant tier — detailed under [Tool designs](#tool-designs).

---

## The engine question: CMU vs eSpeak NG

CMU is a **lookup table** — ~134k curated word→ARPABET entries. eSpeak NG is a **generative grapheme-to-phoneme (G2P) engine**: a dictionary plus letter-to-sound rules that phonemize *any* text, multi-word phrases included, and emit phrase-level stress and IPA. (eSpeak is a text-to-speech engine; only its phonemizer front-end matters here. It compiles to WebAssembly, so it can run in the pipeline worker and be fetched/cached the way the CMU dict already is.)

The difference is categorical, and it removes three CMU limits:

**Phrase-level stress.** eSpeak distinguishes compound from phrasal stress — `greenhouse` /ɡɹˈiːnhaʊs/ (one stress) vs `green house` /ɡɹˈiːn hˈaʊs/ (two); likewise blackbird/black bird, hotdog/hot dog. CMU carries only per-isolated-word stress and structurally can't supply this. It isn't perfect on hard lexical cases (`lima bean` doesn't de-stress "bean"), but the compound-vs-phrasal distinction is there. This is what unblocks mosaic rhyme.

**Out-of-vocabulary coverage.** eSpeak phonemizes words CMU never heard of via its letter-to-sound rules: doomscroll /dˈuːmskɹoʊl/, rizz /ɹˈɪz/, Wordle /wˈɜːdəl/, Cumberbatch /kˈʌmbɚbˌætʃ/, Saoirse /sˈɜːʃə/ ("SUR-sha", correct). This is the **biggest practical win** — a crossword wordlist is wall-to-wall entries CMU lacks, and each silently rhymes/matches with nothing. Segmenting unspaced entries (above) already recovers the *phrasal* half of that gap, since a run-together phrase is made of words CMU does know; what's left for eSpeak is the genuinely unknown single word, which no amount of spacing reaches.

**Syllable boundaries** become derivable. Neither CMU nor eSpeak marks them, but eSpeak's clean phoneme stream plus stress marks let a syllabifier compute them (see [Spoonerisms](#spoonerisms)). IPA output also exposes phonetic *features* (voicing, place, manner) more naturally than ARPABET — the raw material for a slant-rhyme consonant-similarity model.

**Hybrid, not replacement.** CMU is more accurate where it has the word and gives multiple pronunciations per word. So the design is CMU first (curated accuracy, multi-pron), with eSpeak as the generative fallback for OOV coverage and as the phrase-stress oracle — not eSpeak wholesale, which would regress common-word accuracy.

**Rough edges (rule-based, ships some noise):** one pronunciation per word, so no homograph variants — CMU is better there; occasional LTS misses (`cereal` ≠ `serial`; `they're` split from their/there). For a creativity tool a surprising near-miss is half the fun, but the noise is real and argues for the Strict/Loose surfacing discussed below.

---

## Runtime architecture & performance

Measured on eSpeak NG 1.50, native, single core, over a 102k-word dictionary:

- **Per-word compute ≈ 0.28 ms.** The query side — phonemizing the word the user typed, per keystroke — is instant in WASM. A non-issue.
- **Batch throughput ≈ 3,600 words/sec.** 100k entries ≈ 28 s native; 500k ≈ 2.3 min. WASM runs ~1.5–2× slower, so figure ≈ 45–60 s for 100k in-browser.

**The wordlist side is cache-once in a background worker.** Wordlists are user-supplied runtime artifacts — there is nothing to precompute ahead of time. Each list is phonemized on first use and its phonemes cached in IndexedDB next to the data, the way the CMU dict already is. A dedicated worker keeps the minutes-long batch off both the main and pipeline threads; the query side stays live and free. The cost is paid once per list, not per search — which is why the throughput is fine despite being "slow" in absolute terms.

---

## Licensing — dual-license, with eSpeak as an optional module

eSpeak NG is GPLv3 (strong copyleft); Grawlix is MIT.

**Decision (if we adopt eSpeak):** Grawlix goes dual-license — the core stays MIT, and any build that includes the optional eSpeak module is GPLv3. The deployed grawlix.wtf, which would include eSpeak, is therefore a GPLv3 combined work, and that is accepted. The license-avoidance routes are explicitly *not* taken: there is nothing to precompute at build time (wordlists are runtime artifacts), and running eSpeak in a worker is not a legitimate way to dodge copyleft — a worker boundary doesn't make a shipped-together, intimately-coupled dependency a "separate program" (we run it in a worker for performance, not as a license argument).

**How the dual-license works.** You own the copyright to the Grawlix code, so you license it per-module: core files MIT, the eSpeak-bridge module GPLv3. Include the module and the combined work is GPLv3; strip it and the remaining files are pure MIT, reusable in proprietary work. One repo, SPDX headers, per-folder `LICENSE` — no second project. This is allowed because MIT is GPL-compatible: MIT files keep their MIT notices *inside* a GPL combined work; GPL constrains the distributed combination, it does not relicense your files.

**The seam makes the split real, not cosmetic.** Folder structure alone is cosmetic. What makes "strip the module → MIT" actually true is **dependency direction**: the MIT core defines a phonemizer seam; the GPL eSpeak module implements it and registers into the seam at boot. The core must build and run *without* the module — the phonetic tools are simply unavailable. This is exactly Grawlix's existing `configureX({...})` injection pattern (the boot-time seams that already invert cross-layer calls). If the core ever `import`ed the eSpeak module directly, the split would be fiction and the whole thing would be GPL.

**What the GPL build obligates, practically.** The deployed site with eSpeak is GPLv3 — but because Grawlix is already fully open source, the cost is small and behavioral-change-free (no ToS, no banner; GPL not AGPL, so the trigger is simply shipping the WASM to the browser):

- **A Licenses/About notice in the app** naming eSpeak NG (GPLv3), linking the GPLv3 text and the corresponding source (the repo). The header GitHub link helps but isn't enough alone — the recipient must be told GPL code is present and where the source is.
- **Keep the public source matched to the deployed build.** Corresponding source is [`site/src`](../../site/src) + the build scripts (not the minified `dist`); tag the deployed commit, and keep the repo public as long as the site serves the WASM.
- **Carry eSpeak's own notices**: its copyright/license plus a note on how the WASM was built (build recipe + upstream version) — the corresponding source for the WASM itself.
- **A top-level repo statement**: deployed-with-eSpeak = GPLv3; core-without-the-module = MIT.

*(Not legal advice — confirm the specifics with someone qualified before shipping.)*

---

## A shared phonetics core

The planned tools converge on the same machinery, so they should share one phonetics engine module rather than each re-deriving it:

- **A phonemizer** — CMU lookup with an eSpeak generative fallback, behind the injection seam described under Licensing.
- **A syllabifier** — splits a phoneme stream into onset / nucleus / coda syllables via the Maximal Onset Principle. **Ships** over ARPABET as `syllabify(pron)` in `engine/phonetics.js`, one word at a time; also the basis for syllable-count and meter tools, and what spoonerisms will extend to IPA.
- **Schwa-equivalence** — collapse unstressed reduced vowels to one class so weak syllables match by ear rather than by exact symbol. **Ships** for whole-entry rhyme as the ARPABET `REDUCIBLE` set; slant rhyme and spoonerisms want the IPA equivalent {ə ɪ ᵻ ɐ}. Restricting which vowels reduce is load-bearing, not a detail — see [Whole-entry rhyme](#whole-entry-rhyme-shipped).
- **A Strict/Loose knob** — schwa-equivalence and slant matching are looseness dials, surfaced the way the shipped Rhymes Match slider already is. Looseness finds more (and ships more noise); it should be a control, not a hidden default.

**Correctness prerequisite — validate the phoneme inventory.** The classification of every symbol (vowel / consonant / length / stress / diacritic) and the legal-onset table must be *derived and validated against eSpeak's actual emitted symbol set*, not hand-typed. A missing symbol fails **silently** — it is misclassified, a word loses a nucleus, and the affected tool quietly produces nothing rather than erroring (this bit the spoonerism prototype: a missing `ɜ` turned "bird" into an un-spoonerizable blob, and an audit also caught the very common reduced vowel `ᵻ`). Ship a unit test asserting every symbol eSpeak emits is classified as exactly one category.

---

## Tool designs

### Rhyme extensions

#### Whole-entry rhyme (shipped)

The Match slider's **Whole** stop rhymes the entry *entire*, syllable by syllable — ANNE BOLEYN / MANDOLIN, TIME MACHINE / LIMA BEAN, CODE PAGE / ROAD RAGE, POTATO / TOMATO. Two entries match when they have the same number of syllables and each syllable's nucleus + coda agree; onsets are free throughout, so word boundaries need not line up and a three-syllable phrase can meet a three-syllable word.

**This needed no phrase stress, and so no eSpeak.** An earlier draft of this section had mosaic rhyme blocked on eSpeak: stress redistributes in a phrase (LI-ma bean, TIME ma-chine), predicting it is an open linguistic problem, and CMU carries only isolated-word stress. That is true of a *suffix* rhyme, which must first locate an anchor vowel to take the suffix from — and the anchor is exactly what phrase stress determines. Whole-entry rhyme has no anchor to find: it covers every syllable, so where the stress falls never comes up. The blocker was an artifact of framing the match as a suffix. The inverse of that earlier note also holds: syllable divisions, dismissed there as never mattering, are now the whole mechanism.

Five rules carry it, each validated against CMU and the shipped wordlists:

- **Maximal Onset, per word, never across a word boundary.** Let it span one and D R is a legal onset, so ROAD RAGE reads as roa-drage and stops meeting CODE PAGE. The onset table is restricted to native English clusters; CMU also attests loanword onsets (SH W, S V, K N, T S) whose admission would pull a consonant off a coda word-internally — ASH-ley read as A-shley.
- **Maximal Onset yields to the checked vowels.** English does not let a stressed lax vowel end a syllable: BAREST has no /ˈbɛ.rəst/ reading, only /ˈbɛr.əst/. Applying Maximal Onset unconditionally hands that R to the next onset, where the key drops it — and since the key carries no onsets, *every* C-EH-C-schwa-S-T word collapses onto one, so BAREST rhymed with CHEMIST, DENTIST, WETTEST and ten more. Forcing a coda after a stressed AA AE AH AO EH IH UH fixes it, and the tense vowels keep handing their consonant forward, which is what lets SCOO-by still meet LU-cy. This was a shipped bug, caught by a user on the first query they tried; the four rules below were validated up front and this one was not.
- **Schwa-equivalence, restricted.** Unstressed AA AE AH AO EH IH OW UH collapse to one class, which is what marries ANNE BOLEYN's OW0 to MANDOLIN's AH0. ER0, IY0, UW0 and the diphthongs stay distinct: collapse those too and any two entries sharing a stress shape match, CZECHOSLOVAKIA against ENERGY POLICY.
- **Degemination as an alternate reading.** A coda repeating the next onset is held once — TIME MACHINE is said ti-ma-chine, which is what lets it meet LIMA BEAN. Both readings are kept, since dropping the undegeminated one loses CLIMB A BEAN / TIME MACHINE.
- **Every word must be readable**, unlike the last-word modes, which only ever needed the tail — so the spacing pass above matters more here, and a mid-entry split error that Strict and Loose would never notice does bite.

The **word-by-word** rhyme of the original request (SCOOBY DOO "Scoobified": CODE PAGE / ROAD RAGE) falls out of this for free wherever the paired words have equal syllable counts, which is the common case; it would differ only for a pair like BANANA SPLIT / HAVANA LIT, where the word divisions carry different syllable counts. Not built — syllable-by-syllable is the more general relation and needs no extra control.

**Slant / near tier.** The Match slider ships three stops (Whole, Strict, Loose). The natural fourth is a **near/slant tier**: Loose already accepts a rhyme when the stressed vowel + the rest of the tail match exactly; slant would also accept a tail whose **coda consonants are merely similar** — voiced/unvoiced pairs or same place of articulation (worm/swarm, bend/sand). That needs a consonant-similarity model, which IPA phonetic features make tractable but CMU's bare ARPABET does not.

This generalizes to **rhyme-quality tiers**: perfect → near/slant → assonance (vowels only) / consonance (consonants only). The core design question is whether to *surface* slant matches as a weaker, ranked/labeled tier rather than mixing them in flat — a forced rhyme should be **flagged, not hidden**. (Assonance, vowels-only matching like CAT ~ CAB, is a *looser* stop than slant, not the same thing.)

### Spoonerisms

Spoonerize arbitrary input — one word or many — by swapping the **onsets** (leading consonants) of *any two syllables*, start-of-word or mid-word. Word boundaries are not preserved: one word can become several, or several collapse into one.

**Algorithm — four stages:**

1. **Phonemize** each word (CMU with eSpeak fallback).
2. **Syllabify** via the Maximal Onset Principle: every vowel is a nucleus; the consonants between two vowels split so the longest *legal* English onset cluster attaches to the *following* syllable. Boundaries come from the phoneme stream plus a legal-onset table — eSpeak need not mark syllables.
3. **Swap the onsets** of two syllables in the stream.
4. **Recover words** by segmenting the swapped phoneme stream against the phonemized wordlist (dynamic programming), which lets boundaries land wherever the new sounds allow. Matching on *sound* means homophones resolve for free.

The algorithm produces, for example:

| input | onset swap | reads as |
|---|---|---|
| butterfly | b ↔ fl | flutter·by |
| mad bunny | m ↔ b | bad money |
| lighthouse | l ↔ h | height louse |
| jelly beans | dʒ ↔ b | belly genes |
| blue bird | bl ↔ b | boo blurred |
| greek gift | ɡɹ ↔ ɡ | geek grift |
| no service | n ↔ s | so nervous |

**Design requirements this surfaces:**

1. **Phoneme-inventory completeness** — the silent-failure prerequisite from the shared core. The engine is wordlist-independent and correct, but a missing vowel symbol turns a word into an un-swappable onset blob with no error.
2. **The readout is bounded by the wordlist.** Stage 4 can only return words the wordlist contains; a constructor's wordlist — rich in slang, proper nouns, and phrases — is exactly the lexicon that makes these resolve (a plain spelling dictionary lacks "grift", capitalizes "Greek", and so on). Two segmentation modes follow: **strict** (the whole stream must cover into known words — best for "show me only valid spoonerisms") and **best-effort** (resolved words plus the unresolved tail shown as IPA — useful when mining, since it flags "there's a spoonerism here if a word sounded like X").
3. **Schwa-equivalence** — from the shared core. A swap can inherit one reduced vowel where the target word has another (service's /vɪs/ vs nervous's /vəs/); collapsing unstressed {ə ɪ ᵻ ɐ} for matching recovers the pair, the same mechanism mosaic and slant rhyme want, on the same Strict/Loose dial.

**Two modes.** (a) Spoonerize a *query* and look the results up; (b) **mine** the wordlist for entry-pairs whose onset-swap yields two *other* valid entries. Both are the same syllabify-and-swap engine over the phonemized, cached wordlist.

### Other phonetic tools

- **Homophones / "sounds like"** — bucket entries by stress-stripped phoneme string. Groups their/there, to/too/two, knight/night, flour/flower, and the cross-word-boundary "ice cream" = "i scream". The cheapest new tool and a strong theme generator — a good first target after the engine lands.
- **Phonetic substitution / Sound shift** — the two phonetic tools already in [`../tools.md`](../tools.md): swap one phoneme for another across the wordlist, or move a phoneme between word positions. Both need reliable phonemization of arbitrary entries, including OOV ones.
- **Syllable-count & meter filters** — count nuclei to filter by syllable count, or match a stress pattern (iambic/dactylic) over arbitrary phrases.
- **Phonetic anagrams** — anagrams of phonemes, not letters.

Caveat across these: heteronyms (same spelling, different sound) actually want CMU's *multiple* pronunciations; eSpeak's single best guess is weaker there, so the hybrid phonemizer should prefer CMU's variants when present.

---

## Pre-code checklist

- **Independent vetting pass** before any implementation — this doc is feasibility-uncertain (rule-based stress, hand-tuned phonotactics) and should be reviewed first.
- **Phoneme-inventory unit test** — the silent-failure guard described in the shared core.
- **Segmentation mode** — strict vs best-effort for spoonerism mining (likely both, toggled).
- **Strict/Loose default** for schwa-equivalence across rhyme and spoonerism tools.
- **Per-word vs whole-phrase phonemization** — whole-phrase gives phrase stress (needed for mosaic rhyme) but merges the stream; per-word is cleaner for onset extraction but loses phrase stress. Decide per tool.
