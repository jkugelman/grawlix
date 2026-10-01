# Phonetics (planned)

Planned sound-based tools and the engine work they need: an eSpeak NG fallback for words the CMU Pronouncing Dictionary lacks, and tools built on it (spoonerisms, a slant-rhyme tier, homophone groups, phonetic substitution, and more).
The catalog of tool cards lives in [`../tools.md`](../tools.md); this doc owns the *how*.

What has shipped is recorded elsewhere: Rhymes, Phone search, and the CMU core they share are in [`design.md`](../design.md) § *Pronunciations*, § *Rhymes*, and § *Phone search and letter–sound alignment*; the segmenter that reads unspaced entries for them is in [`segmenter.md`](../segmenter.md).

> **Status: planned.**
> The CMU-side syllabifier and schwa set ship ([`design.md`](../design.md) § *Rhymes*); nothing that needs eSpeak exists.
> The rest is a plan to vet, ideally with an independent review pass, before any code.
> The eSpeak capabilities, performance numbers, and spoonerism algorithm were validated empirically against eSpeak NG 1.50 (Ubuntu's `espeak-ng`); newer upstream releases improve letter-to-sound accuracy and speed. eSpeak was evaluated and is undecided; its costs are in the runtime and licensing sections below.

---

## The engine question: CMU vs eSpeak NG

CMU is a **lookup table** — ~134k curated word→ARPABET entries. eSpeak NG is a **generative grapheme-to-phoneme (G2P) engine**: a dictionary plus letter-to-sound rules that phonemize *any* text, multi-word phrases included, and emit phrase-level stress and IPA. (eSpeak is a text-to-speech engine; only its phonemizer front-end matters here.
It compiles to WebAssembly, so it can run in the pipeline worker and be fetched/cached the way the CMU dict already is.)

The difference is categorical, and it removes three CMU limits:

**Phrase-level stress.** eSpeak distinguishes compound from phrasal stress — `greenhouse` /ɡɹˈiːnhaʊs/ (one stress) vs `green house` /ɡɹˈiːn hˈaʊs/ (two); likewise blackbird/black bird, hotdog/hot dog.
CMU carries only per-isolated-word stress and structurally can't supply this.
It isn't perfect on hard lexical cases (`lima bean` doesn't de-stress "bean"), but the compound-vs-phrasal distinction is there.
Whole-entry rhyme turned out not to need it (it keys every syllable, so stress placement never matters; see [`design.md`](../design.md) § *Rhymes*), but a suffix rhyme across a phrase, and any meter tool, still would.

**Out-of-vocabulary coverage.** eSpeak phonemizes words CMU never heard of via its letter-to-sound rules: doomscroll /dˈuːmskɹoʊl/, rizz /ɹˈɪz/, Wordle /wˈɜːdəl/, Cumberbatch /kˈʌmbɚbˌætʃ/, Saoirse /sˈɜːʃə/ ("SUR-sha", correct).
This is the **biggest practical win** — a crossword wordlist is wall-to-wall entries CMU lacks, and each silently rhymes/matches with nothing.
Segmenting unspaced entries ([`segmenter.md`](../segmenter.md)) already recovers the *phrasal* half of that gap, since a run-together phrase is made of words CMU does know; what's left for eSpeak is the genuinely unknown single word, which no amount of spacing reaches.

**Syllable boundaries** become derivable.
Neither CMU nor eSpeak marks them, but eSpeak's clean phoneme stream plus stress marks let a syllabifier compute them (see [Spoonerisms](#spoonerisms)).
IPA output also exposes phonetic *features* (voicing, place, manner) more naturally than ARPABET — the raw material for a slant-rhyme consonant-similarity model.

**Hybrid, not replacement.**
CMU is more accurate where it has the word and gives multiple pronunciations per word.
So the design is CMU first (curated accuracy, multi-pron), with eSpeak as the generative fallback for OOV coverage and as the phrase-stress oracle — not eSpeak wholesale, which would regress common-word accuracy.

**Rough edges (rule-based, ships some noise):** one pronunciation per word, so no homograph variants — CMU is better there; occasional LTS misses (`cereal` ≠ `serial`; `they're` split from their/there).
For a creativity tool a surprising near-miss is half the fun, but the noise is real and argues for the Strict/Loose surfacing discussed below.

---

## Runtime architecture & performance

Measured on eSpeak NG 1.50, native, single core, over a 102k-word dictionary:

- **Per-word compute ≈ 0.28 ms.**
  The query side — phonemizing the word the user typed, per keystroke — is instant in WASM.
  A non-issue.
- **Batch throughput ≈ 3,600 words/sec.**
  100k entries ≈ 28 s native; 500k ≈ 2.3 min.
  WASM runs ~1.5–2× slower, so figure ≈ 45–60 s for 100k in-browser.

**The wordlist side is cache-once in a background worker.**
Wordlists are user-supplied runtime artifacts — there is nothing to precompute ahead of time.
Each list is phonemized on first use and its phonemes cached in IndexedDB next to the data, the way the CMU dict already is.
A dedicated worker keeps the minutes-long batch off both the main and pipeline threads; the query side stays live and free.
The cost is paid once per list, not per search — which is why the throughput is fine despite being "slow" in absolute terms.

---

## Licensing — dual-license, with eSpeak as an optional module

eSpeak NG is GPLv3 (strong copyleft); Grawlix is MIT.

**Decision (if we adopt eSpeak):** Grawlix goes dual-license — the core stays MIT, and any build that includes the optional eSpeak module is GPLv3.
The deployed grawlix.wtf, which would include eSpeak, is therefore a GPLv3 combined work, and that is accepted.
The license-avoidance routes are explicitly *not* taken: there is nothing to precompute at build time (wordlists are runtime artifacts), and running eSpeak in a worker is not a legitimate way to dodge copyleft — a worker boundary doesn't make a shipped-together, intimately-coupled dependency a "separate program" (we run it in a worker for performance, not as a license argument).

**How the dual-license works.**
You own the copyright to the Grawlix code, so you license it per-module: core files MIT, the eSpeak-bridge module GPLv3.
Include the module and the combined work is GPLv3; strip it and the remaining files are pure MIT, reusable in proprietary work.
One repo, SPDX headers, per-folder `LICENSE` — no second project.
This is allowed because MIT is GPL-compatible: MIT files keep their MIT notices *inside* a GPL combined work; GPL constrains the distributed combination, it does not relicense your files.

**The seam makes the split real, not cosmetic.**
Folder structure alone is cosmetic.
What makes "strip the module → MIT" actually true is **dependency direction**: the MIT core defines a phonemizer seam; the GPL eSpeak module implements it and registers into the seam at boot.
The core must build and run *without* the module — the phonetic tools are simply unavailable.
This is exactly Grawlix's existing `configureX({...})` injection pattern (the boot-time seams that already invert cross-layer calls).
If the core ever `import`ed the eSpeak module directly, the split would be fiction and the whole thing would be GPL.

**What the GPL build obligates, practically.**
The deployed site with eSpeak is GPLv3 — but because Grawlix is already fully open source, the cost is small and behavioral-change-free (no ToS, no banner; GPL not AGPL, so the trigger is simply shipping the WASM to the browser):

- **A Licenses/About notice in the app** naming eSpeak NG (GPLv3), linking the GPLv3 text and the corresponding source (the repo).
  The header GitHub link helps but isn't enough alone — the recipient must be told GPL code is present and where the source is.
- **Keep the public source matched to the deployed build.**
  Corresponding source is [`site/src`](../../site/src) + the build scripts (not the minified `dist`); tag the deployed commit, and keep the repo public as long as the site serves the WASM.
- **Carry eSpeak's own notices**: its copyright/license plus a note on how the WASM was built (build recipe + upstream version) — the corresponding source for the WASM itself.
- **A top-level repo statement**: deployed-with-eSpeak = GPLv3; core-without-the-module = MIT.

*(Not legal advice — confirm the specifics with someone qualified before shipping.)*

---

## A shared phonetics core

The planned tools converge on the same machinery, so they should share one phonetics engine module rather than each re-deriving it:

- **A phonemizer** — CMU lookup with an eSpeak generative fallback, behind the injection seam described under Licensing.
- **A syllabifier** — splits a phoneme stream into onset / nucleus / coda syllables via the Maximal Onset Principle.
  The ARPABET one ships for whole-entry rhyme (`syllabify`, [`design.md`](../design.md) § *Rhymes*); spoonerisms and syllable-count or meter tools need it extended to IPA.
- **Schwa-equivalence** — collapse unstressed reduced vowels to one class so weak syllables match by ear rather than by exact symbol.
  The ARPABET set ships for whole-entry rhyme ([`design.md`](../design.md) § *Rhymes*, which also records why the set must stay restricted); slant rhyme and spoonerisms want the IPA equivalent {ə ɪ ᵻ ɐ}.
- **A Strict/Loose knob** — schwa-equivalence and slant matching are looseness dials, surfaced the way the shipped Rhymes Match slider already is.
  Looseness finds more (and ships more noise); it should be a control, not a hidden default.

**Correctness prerequisite — validate the phoneme inventory.**
The classification of every symbol (vowel / consonant / length / stress / diacritic) and the legal-onset table must be *derived and validated against eSpeak's actual emitted symbol set*, not hand-typed.
A missing symbol fails **silently** — it is misclassified, a word loses a nucleus, and the affected tool quietly produces nothing rather than erroring (this bit the spoonerism prototype: a missing `ɜ` turned "bird" into an un-spoonerizable blob, and an audit also caught the very common reduced vowel `ᵻ`).
Ship a unit test asserting every symbol eSpeak emits is classified as exactly one category.

---

## Tool designs

### Rhyme extensions

**Slant / near tier.**
The Rhymes Match slider has three stops (Whole, Strict, Loose).
The natural fourth is a **near/slant tier**: Loose already accepts a rhyme when the stressed vowel + the rest of the tail match exactly; slant would also accept a tail whose **coda consonants are merely similar** — voiced/unvoiced pairs or same place of articulation (worm/swarm, bend/sand).
That needs a consonant-similarity model, which IPA phonetic features make tractable but CMU's bare ARPABET does not.

This generalizes to **rhyme-quality tiers**: perfect → near/slant → assonance (vowels only) / consonance (consonants only).
The core design question is whether to *surface* slant matches as a weaker, ranked/labeled tier rather than mixing them in flat — a forced rhyme should be **flagged, not hidden**.
(Assonance, vowels-only matching like CAT ~ CAB, is a *looser* stop than slant, not the same thing.)

### Spoonerisms

Spoonerize arbitrary input — one word or many — by swapping the **onsets** (leading consonants) of *any two syllables*, start-of-word or mid-word.
Word boundaries are not preserved: one word can become several, or several collapse into one.

**Algorithm — four stages:**

1. **Phonemize** each word (CMU with eSpeak fallback).
2. **Syllabify** via the Maximal Onset Principle: every vowel is a nucleus; the consonants between two vowels split so the longest *legal* English onset cluster attaches to the *following* syllable.
   Boundaries come from the phoneme stream plus a legal-onset table — eSpeak need not mark syllables.
3. **Swap the onsets** of two syllables in the stream.
4. **Recover words** by segmenting the swapped phoneme stream against the phonemized wordlist (dynamic programming), which lets boundaries land wherever the new sounds allow.
   Matching on *sound* means homophones resolve for free.

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

1. **Phoneme-inventory completeness** — the silent-failure prerequisite from the shared core.
   The engine is wordlist-independent and correct, but a missing vowel symbol turns a word into an un-swappable onset blob with no error.
2. **The readout is bounded by the wordlist.**
   Stage 4 can only return words the wordlist contains; a constructor's wordlist — rich in slang, proper nouns, and phrases — is exactly the lexicon that makes these resolve (a plain spelling dictionary lacks "grift", capitalizes "Greek", and so on).
   Two segmentation modes follow: **strict** (the whole stream must cover into known words — best for "show me only valid spoonerisms") and **best-effort** (resolved words plus the unresolved tail shown as IPA — useful when mining, since it flags "there's a spoonerism here if a word sounded like X").
3. **Schwa-equivalence** — from the shared core.
   A swap can inherit one reduced vowel where the target word has another (service's /vɪs/ vs nervous's /vəs/); collapsing unstressed {ə ɪ ᵻ ɐ} for matching recovers the pair, the same mechanism whole-entry rhyme uses and slant rhyme wants, on the same Strict/Loose dial.

**Two modes.** (a) Spoonerize a *query* and look the results up; (b) **mine** the wordlist for entry-pairs whose onset-swap yields two *other* valid entries.
Both are the same syllabify-and-swap engine over the phonemized, cached wordlist.

### Other phonetic tools

- **Homophone groups** — bucket entries by stress-stripped phoneme string: their/there, to/too/two, knight/night, flour/flower, and the cross-word-boundary "ice cream" = "i scream".
  Finding the homophones of one word already ships, as Phone search in Whole entry mode; what's missing is the all-mode clustering of the whole wordlist, which needs no eSpeak.
- **Phonetic substitution / Sound shift** — the two phonetic tools already in [`../tools.md`](../tools.md): swap one phoneme for another across the wordlist, or move a phoneme between word positions.
  Both need reliable phonemization of arbitrary entries, including OOV ones.
- **Syllable-count & meter filters** — count nuclei to filter by syllable count, or match a stress pattern (iambic/dactylic) over arbitrary phrases.
- **Phonetic anagrams** — anagrams of phonemes, not letters.

Caveat across these: heteronyms (same spelling, different sound) actually want CMU's *multiple* pronunciations; eSpeak's single best guess is weaker there, so the hybrid phonemizer should prefer CMU's variants when present.

---

## Pre-code checklist

- **Independent vetting pass** before any implementation — this doc is feasibility-uncertain (rule-based stress, hand-tuned phonotactics) and should be reviewed first.
- **Phoneme-inventory unit test** — the silent-failure guard described in the shared core.
- **Segmentation mode** — strict vs best-effort for spoonerism mining (likely both, toggled).
- **Strict/Loose default** for schwa-equivalence across rhyme and spoonerism tools.
- **Per-word vs whole-phrase phonemization** — whole-phrase gives phrase stress (needed for a phrase-level suffix rhyme or meter) but merges the stream; per-word is cleaner for onset extraction but loses phrase stress.
  Decide per tool.
