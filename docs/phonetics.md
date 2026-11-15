# Phonetics

The sound-based tools, Rhymes, Phone search and Stress shift, and the pronunciation core they share: the CMU Pronouncing Dictionary, how a word gets read, Phone search's sound dialect and the translation of words into it, and the letter–sound alignment that highlights matches.
The segmenter that reads unspaced entries for them is in [`segmenter.md`](segmenter.md); Grawlix's own pronunciation dictionary is in [`cmu-supplement.md`](cmu-supplement.md); planned sound tools are in [`planned/phonetics.md`](planned/phonetics.md).
The tool cards are in [`tools.md`](tools.md), and the Phone search box's helper panel in [`design.md`](design.md) § *Pattern assist*.

## Pronunciations

Rhymes, Phone search, and Stress shift run on the **CMU Pronouncing Dictionary** ([`engine/phonetics.js`](../site/src/engine/phonetics.js)): ~135k pronunciations of ~122k words, each a flat ARPABET phone string carrying a stress digit on every vowel (`1` primary, `2` secondary, `0` unstressed) and no syllable boundaries.
It is a worker-owned data asset beside the segmenter's corpus (`cmudict` in [`engine/assets.js`](../site/src/engine/assets.js)): fetched from the upstream `cmusphinx/cmudict` repo on first use, parsed, and cached decoded in IndexedDB.
Upstream still takes the occasional fix, so it auto-updates (`autoUpdate`, [`worker-protocol.md`](worker-protocol.md) § *`check-assets`*).
Lookups key on a word's letters alone.

**Grawlix's own supplement layers over CMU.**
[`site/data/cmu-supplement.dict`](../site/data/cmu-supplement.dict), in CMU's format, is a second asset (`cmuSupplement`) fetched from the site itself and auto-updated the same way.
It holds the words CMU lacks that the wordlists use, transcribed by an LLM with wordlist context, and fixes to CMU's bad entries (SCARECROW's AE R, FLAUBERT read as "flow-burt"); [`cmu-supplement.md`](cmu-supplement.md) covers what's in it and how to add to it.
A word it lists replaces CMU's whole list rather than adding to it, which is what lets a fix remove a wrong reading.
Its entries are read as listed: the fallbacks below (inflection, letter by letter, the segmenter) run only for a word neither dictionary has.
An initialism carries its letter-by-letter reading as one of its entries, next to any word reading (TXT as "text" and as T-X-T); an abbreviation expansion beside it is then dropped, since only readings the letters spell survive (§ *Phone search and letter–sound alignment*).
Unchanged CMU entries stay upstream's, so the supplement holds only differences, and an update to it never refetches CMU's 3.6 MB.

**A word CMU lacks is read through the segmenter.**
It is split into words the dictionary might know, via the spacing table's `guess` ([`segmenter.md`](segmenter.md) § *The spacing table*).
A word that still can't be read has no pronunciation; there is no letter-to-sound fallback. eSpeak NG would supply one; it was evaluated and not adopted ([`planned/phonetics.md`](planned/phonetics.md)).

**The cot–caught merger is folded, except before R.** CMU records the AO/AA split, and records it arbitrarily: CAUGHT is listed both ways, GONE only AO, DON only AA, ON both; 10,164 of the 10,574 AO headwords carry no AA variant, so the exceptions are coin flips.
Honoring the split tears rhyme families in half along those flips: GONE PRO and COINTREAU bucketed away from DON HO, JOHN DOE, and TONTO, with ON AUX, ON LOW, and ON TOE stranded in each half, which reads as a duplicate-row bug.
So AO folds into AA everywhere a pronunciation is compared: in all three rhyme modes, and in Phone search as the `[AA AO]` a word's translation spells out (§ *Phone search and letter–sound alignment*).
Not before R, where no dialect merges NORTH with START and folding would rhyme CARD with CORD and BARB with ORB.
The R must be one the vowel's own syllable closes on, since a word-initial R colors nothing before it: SAW RED folds, SORE ED does not.
(CMU also lists six headwords both R-ful and R-less, CARS and FOR among them, which is why OLD CARS reaches OLD SAWS; a dictionary wart, left alone.)

**Before R, IY folds into IH and UW into UH.**
CMU splits these just as arbitrarily: HERE, HEAR, BIER and TIER are IY R while NEAR, FEAR, BEER and STEER are IH R (252 stressed IY R against 1,373 IH R), and POOR is UW R while TOUR and SURE are UH R (181 against 718).
Unfolded, HERE doesn't rhyme with NEAR, and BIER can't find BEER in Phone search.
The R is the next phone in the same word, the same test as the cot–caught exception.
The SQUARE vowel folds too, EY into EH: SHARE is EH R but PLOWSHARE, MENSWEAR and BUENOS AIRES are EY R (3,905 EH R against 80 EY R).
Only when the R closes the syllable, at the end of the word or before a consonant: before a vowel the R starts the next syllable, and PAYROLL, PLAYROOM and BEIRUT keep their EY.
That misses PRAIRIES and DAIRYMEN, whose EY R before a vowel really is SQUARE; no rule on the phones alone tells them from PAYROLL.

**After AY and AW, an unstressed ER loses its syllable.**
CMU writes FIRE's R as its own syllable or not on a whim: TIRE and SIRE are AY ER, SPIRE is AY R, WIRE and HIRE are both, and the same goes for AW (TOWER AW ER, SOUR both).
Unfolded, SPIRE doesn't rhyme with TIRE, and PYRE can't find PIRATE.
Other vowels keep their ER: PLAYER stays two syllables, not a rhyme for HAIR.

**A flapped T is heard as a D in rhymes.**
Americans say a T between a vowel (or R) and an unstressed vowel as D, so BETTER rhymes with SHREDDER, READER with PETER, and MEDDLE with METAL.
Not before a syllabic N, where the T is a glottal stop: BURTON doesn't rhyme with BURDEN.

**Weak unstressed vowels rhyme as one schwa.**
Unstressed AA AE AH AO EH IH UH all drift toward schwa, so POCKET rhymes with CROCKETT and KRYPTON with LIPTON.
The last-word modes leave an unstressed OW alone, since CMU writes a reduced O as AH and OW0 is a full "oh": BELLOW doesn't rhyme with BELLA, nor AVOCADO with PRADA.
Whole-entry rhymes reduce OW too (§ *Rhymes*), where the rest of the entry has to match as well.

## Rhymes

Rhymes ([`engine/tools/rhymes.js`](../site/src/engine/tools/rhymes.js)) keeps entries that share a **rhyming part** with the typed entry.
The Match slider picks how a rhyming part is cut: **Loose** and **Strict** take the suffix of the last word's pronunciation from an anchor vowel to the end, stress digits stripped; **Whole** keys the entire entry syllable by syllable.

**Loose anchors on either stress, Strict on the primary.**
Loose (the default) anchors on the last vowel with primary *or* secondary stress, so CUMBERBATCH rhymes with MATCH and DYNAMITE with KITE; Strict anchors only on the primary, the classical perfect rhyme.
Stress is stripped from the suffix so a secondary anchor still meets a primary one.

**A phrase rhymes on its last word, and sharing it is a repeat.**
Loose and Strict look up only the last word.
An entry whose last word is the target's last word is excluded, so a word never rhymes with itself or with a phrase ending in it (AGATHA and AUNT AGATHA).

**Unspaced entries are spaced out first.**
An unspaced entry CMU doesn't know whole is read through the segmenter's `guess`, which forces a compound split where the corpus would call the entry one word (`RICKROLL` → `RICK ROLL`; [`segmenter.md`](segmenter.md) § *The compound reading*).
Measured on XWI, Spread the Wordlist, and Broda, this takes the share of entries that can rhyme from 13–22% to 75–80%.
The dictionary wins where it has the whole string, so NOTABLE stays NOTABLE rather than NO TABLE, and a spaced entry is used as written.
The **typed** entry gets a second pass at the wider `many` window: at the default window the scorer prunes `time machine`, because wordfreq carries `timemachine` as a token, so a pasted unspaced entry would return nothing with nothing on screen to say why.
The wordlist doesn't get the wider window, because there it rescues 4% of XWI and reads them as `orbs → or bs` and `not ate`; one deliberate query is worth a guess, 280k rows are not.

**All-mode buckets by rhyming part.**
An entry carries one key per reading, so a family is bucketed once per reading its members share; `bucketize` drops the repeats and any family wholly inside a larger one, which matters most under Whole, where a key is an entire pronunciation.
A family needs two or more distinct last words, read off the spaced form, so ROADRAGE and PARKINGRAGE count as one.

**Whole rhymes every syllable.**
Two entries match when they have the same number of syllables and each syllable's nucleus and coda agree; onsets are free throughout, so word boundaries need not line up: ANNE BOLEYN / MANDOLIN, TIME MACHINE / LIMA BEAN, CODE PAGE / ROAD RAGE, POTATO / TOMATO.
It needs no phrase stress.
A suffix rhyme has to locate its anchor vowel, and in a phrase the anchor depends on phrase stress (LI-ma bean, TIME ma-chine), which CMU's isolated-word stress can't supply.
Whole covers every syllable, so where the stress falls never matters, and syllable division becomes the whole mechanism.
Six rules carry it, each validated against CMU and the shipped wordlists (the second only after it shipped):

- **Maximal Onset, per word, never across a word boundary** (`syllabify`).
  Spanning one makes D R a legal onset, so ROAD RAGE reads roa-drage and stops meeting CODE PAGE.
  The onset table is restricted to native English clusters; CMU also attests loanword onsets (SH W, S V, K N, T S), whose admission would pull a consonant off a coda word-internally: ASH-ley read as A-shley.
- **Maximal Onset yields to the checked vowels.**
  English doesn't let a stressed lax vowel end a syllable: BAREST is /ˈbɛr.əst/, never /ˈbɛ.rəst/.
  Unconditional Maximal Onset hands that R to the next onset, which the key drops, so every C-EH-C-schwa-S-T word collapsed onto one key and BAREST rhymed with CHEMIST, DENTIST, WETTEST, and ten more.
  A coda is forced after a stressed AA AE AH AO EH IH UH; the tense vowels still hand their consonant forward, which lets SCOO-by meet LU-cy.
  This one shipped as a bug and was caught by a user on their first query.
- **Schwa-equivalence, restricted.**
  Unstressed AA AE AH AO EH IH OW UH collapse to one class, which marries ANNE BOLEYN's OW0 to MANDOLIN's AH0.
  ER0, IY0, UW0, and the diphthongs stay distinct: collapse those too and any two entries sharing a stress shape match, CZECHOSLOVAKIA against ENERGY POLICY.
- **The cot–caught merger** (§ *Pronunciations*).
  On a 738k-entry merge it takes Whole from 46,520 families to 46,685 and Loose from 7,173 to 7,128: it fuses families, and more often forms new ones from AO-only words that had no partner.
- **Degemination as an alternate reading.**
  A coda repeating the next onset is held once: TIME MACHINE is said ti-ma-chine, which lets it meet LIMA BEAN.
  Both readings are kept, since dropping the undegeminated one loses CLIMB A BEAN / TIME MACHINE.
- **Every word must be readable.**
  Unlike Loose and Strict, which need only the tail, Whole reads every word, so one unreadable word leaves the entry out, and a mid-entry split error that the last-word modes never notice does bite.

A word-by-word rhyme (CODE PAGE / ROAD RAGE pairing word with word) falls out of this wherever the paired words have equal syllable counts, the common case; it would differ only for a pair like BANANA SPLIT / HAVANA LIT, whose word divisions carry different syllable counts.
It isn't a separate mode, since syllable-by-syllable is the more general relation.

## Phone search and letter–sound alignment

Phone search ([`engine/tools/phone_search.js`](../site/src/engine/tools/phone_search.js)) searches entries by sound.
Its query is written in a small **sound dialect**: ARPABET sounds in capitals plus Search's wildcards, with lowercase words as shorthand.

| Syntax | Means |
|---|---|
| `S`, `SH`, `NG`… | that consonant (CMU's 24) |
| `AA`, `OW`… | that vowel (CMU's 15) at any stress |
| `AA0`, `AA1`, `AA2` | that vowel, only at that stress |
| `AX` | a reduced vowel: AA AE AH AO EH IH or UH, unstressed |
| `@`, `#`, `?` | any vowel (`@1` restricts the stress), any consonant, any sound |
| `*` | any run of sounds |
| `[AA AO]`, `[^ R]` | one sound of the set, or not in it |
| `(NG)` | at the start or end: sounds that must be there but aren't part of the match |
| `(^ R)` | at the start or end: sounds that mustn't be there; the entry's edge counts as not there |
| `A, B` | either alternative |
| `knight` | a word, read through CMU and written out as sounds |

Capitals run together greedily, longest name first, so `SNOW` is S N OW, `SH` is SH, and `S HH` needs the space.
A run of capitals that doesn't split into sounds is an error, with a fix that reads it as a word instead; only text with a lowercase letter is a word, so a phone keyboard's capitalized `No` still reads as a word.
So `S` with Starts entry finds every entry that starts with an S sound, and with a blank replacement it turns SNOW into NO and KNOW.

**Words are translated, and the translation is what runs.**
[`engine/phone-query.js`](../site/src/engine/phone-query.js) reads each word through CMU and writes it out in the dialect, and the tool parses and searches only that text ([`engine/phone-dialect.js`](../site/src/engine/phone-dialect.js)).
The pattern assist shows it as **Searching for** lines ([`design.md`](design.md) § *Pattern assist*), which copy with a click, and pasting them back gives the same results, since it's the same text, but for the query's own words, which only a query typed as words hides (below).
Nothing is folded behind the user's back: an entry is read with CMU's raw pronunciations, stress kept, and every way a word may be heard is spelled out in its translation as a set.
Each fold is written into the set in both directions, so a sound on either side can meet the other:

- **Stress:** a word's vowels carry no stress digit, so any stress matches, and `bitter` finds ARBITER's unstressed -biter.
- **Cot–caught:** AA or AO not before R in the word becomes `[AA AO]`, since CMU records the split arbitrarily (§ *Pronunciations*).
- **Before R:** IY/IH, UW/UH and EY/EH before an R become their pair, so `share` (`SH [EH EY] R`) finds PLOWSHARE.
  EY and EH stay apart when the R opens the next syllable inside the word.
- **Schwa:** an unstressed AA AE AH AO EH IH or UH becomes the bare vowel or `AX`, so `rocket` (`R [AA AO] K [AH AX] T`) finds DAVY CROCKETT and EFFACE finds MAKE A FACE, while stressed vowels stay apart and BIT never finds BUT.
  An unstressed OW stays a full "oh": CMU writes a reduced O as AH, and reducing OW has BELLOW find BELLA.
- **A secondary "ah" or "uh"** (AA2, AE2, AH2) becomes `[AA AE AH AO AX]`: CMU writes ACHOO's first vowel AA2, so without it ACHOO can't find MASSACHUSETTS (AH0) or STATUE (AE1).
  It stops there: an unstressed vowel widened the same way has TUBA find TOO BAD, and a secondary I has INSULT find CONSULT.
- **The flap:** a T or D between a vowel (or R) and an unstressed vowel in the word becomes `[D T]`, so PUTTING finds TOFU PUDDING, but not before a syllabic N, so BURDEN doesn't find BURTON.
- **AY and AW before R:** CMU writes TIRE AY ER but SPIRE AY R, so a word with either gets both as alternatives.
- **-ing:** a query ending in an unstressed IY gets an alternative ending `IH (NG)`, so `tabby` finds STABBING and `lackey` finds BLACK INK, since many speakers say the IH of -ing and ink as IY before NG.
  Elsewhere IH is short, so MONEY doesn't find FEMINIST.
- **YOU** runs into the consonant before it across a word break: T, D, S and Z become CH, JH, SH and ZH, and CH, JH, SH and ZH absorb the Y. A query gets the joined reading as an alternative, and an entry is read both ways, so ACHOO finds CATCH YOU LATER and ISSUE finds KISS YOU.
  Only YOU and its forms (YOUR, YOU'RE…) join, since they're said unstressed; a stressed Y word keeps its Y, or JAW would find SCOTLAND YARD.

The folds look only inside a word, since across a break THE RACE would lose its IY.
They judge context by the query's own sounds, except at the query's end, where what follows is the entry's: there a fold an R would have stopped is split off behind a `(^ …)`.
So `ma` is `M AA, M AO (^ R)` and doesn't find MORE, and `pair` is `P EH R, P EY R (^ @)` and doesn't find PAYROLL.
The syntax can't see a word break inside an entry, which costs a few edge cases: `tour` finds ALL TOO REAL, `are` misses SAW RIGHT THROUGH ME, and `toughie` finds LIFT A FINGER, since `(NG)` can't say "no G after it in the same word".
A word's readings are combined across a run of words, capped at 16, and a line another line already covers is dropped.
Readings that differ in just one sound share a line, with a set there: READ is `R [EH IY] D`, EITHER `[AY IY] DH ER`.
Readings further apart keep their own lines, since sets in two places would also match crossings neither reading has; alternatives typed with commas are never merged.
A word with no pronunciation is an error the panel places on the word.

**Matching.**
Each phone and stress is one code unit, so a set is a regex character class and a match can't land partway through a phone.
Each alternative compiles to one regex, with `(…)` as a lookbehind or lookahead and `(^ …)` as a negative one.
For each reading of the entry, the tool finds every occurrence and keeps the ones the match mode allows: Whole entry needs offset 0 and the full length, Starts entry and Ends entry need just one of them, Whole word needs word breaks, and Spans words needs a break strictly between them.
Parenthesized sounds are outside the match, so `T AE B IH (NG)` can't count as ending STABBING.
A `*` matches greedily, so when the mode rejects the longest match at a start, the shorter ends the mode could accept are tried too.

**The search words themselves never match.**
An occurrence that is the query's own words is dropped: it starts on a word break, runs through words spelled as the query's, and ends in its last word or an inflection of it (morphology's `candidates`).
`FIGURE` skips `FIGURES` and `FIGURE SKATING` but keeps `CONFIGURE`.
A sound search that returns the typed word is noise, and under Whole entry this rule is what turns the search into a homophone finder.
It applies to an alternative typed as words alone; sounds name no word to hide, so `F IH G Y ER` finds FIGURE, and this is the one way a pasted translation searches differently from its words.

**Reading an entry.**
A word neither CMU nor the supplement knows is first tried as an inflection: morphology's `candidates` strips an *-s*, *-es*, *-ies*, *-ed*, *-ied* or *-ing*, and the longest stem CMU knows is read with the ending's sound after it.
The ending's sound depends on the stem's last sound: *-s* is IH Z after a hissing sound, S after a voiceless one, and Z otherwise; *-ed* is IH D after T or D, T after a voiceless sound, and D otherwise.
So FROGGED, ASTROTURFS and BAMBOOZLING read, and DIMED is read from DIME, not DIM.
Only Phone search reads inflections this way.
A word neither dictionary knows that the rescore rules would call an initialism (`wordKinds`, so all-caps NCAA, MVPs, or IV but not II) is read letter by letter, with a plural *s* as its ending: ENVY finds NV.
That comes after CMU, so NASA keeps its word reading, and before the segmenter, which would split NCAA into something else.
It relies on the parser keeping only meaningful capitals (`detectCase`, [`wordlists.md`](wordlists.md) § *Rich wordlists*), so an all-caps wordlist's entries aren't spelled out.
Only up to five letters, not counting a plural *s*: the longer all-caps words CMU lacks are mostly said as words (CAPTCHA, README, QWERTY), the shorter ones mostly spelled out.
A short acronym said as a word is listed in the supplement, or it would be misread as letters.
A word that still isn't known is read through the spacing table's `guess` ([`segmenter.md`](segmenter.md) § *The spacing table*).
If a word still can't be read, or it contains a digit, it reads as a **hole**: one code unit that no sound matches.
A run of sounds can't be heard across a hole, and a hole keeps its place in the entry, so Whole entry can't match an entry with an unreadable word (Starts entry can, when the hole comes after the sounds).
An entry's readings are the product of its words' pronunciations, capped at 16.
The match-mode control sets where the sounds sit: **Whole entry** finds homophones (`KNIGHT` finds `NIGHT`), **Starts entry** and **Ends entry** pin one end (`KNEE` finds `NEON` and `HONEY` respectively), **Whole word** needs word breaks at both ends (`TEA` finds `TEE` but not `ARTY`), and **Spans words** needs a break inside (`TEA` finds `NOT EVEN`).
The breaks are Search's (`WORD_BREAK_RE`) plus the splits inside a word read through the spacing table: the entry is read aloud in pieces split at every punctuation mark, so `U.S.A.` is three letter names, but `R&R` is one word to Whole word, as it is to Search.

**Only citation pronunciations are used.**
CMU lists weak forms (`ARE` as ER, `FOR` as F ER) and abbreviation expansions (`CO.` as "company") alongside a word's ordinary pronunciation.
If they were kept, `ARE` would find `BUTCHER` and `KNEE` would find `AND CO`.
`citationProns` drops the weak forms listed in `WEAK_FORMS`: 22 pronunciations of 20 common words (`ARE`, `FOR`, `TO`, `AND`, `HIM`…).
A weak form is only a sound or two, found all over the wordlist, so searching the bare word would flood.
The list is explicit rather than a rule like "drop every unstressed alternate": such a rule also drops readings that are real, like `A` as "uh" and `THE` as "thee", which a phrase such as `A LOT` needs, and multi-syllable alternates like `COMPARABLE` as "COMP-ruh-ble".
It also drops a pronunciation the spelling can't produce (`spellsOut`, below) when some other pronunciation of the word can.
For the same reason, a split into parts drops any one-letter part other than `a` and `i`, because CMU reads a stray `r` as its letter name and would hear ARE in `DEFOGGERS`.

**Replacing works on sounds, so its output is any entry that sounds like the result.**
With the replace field open ([`design.md`](design.md) § *The find/replace widget*), the row becomes **Phone replace**, a transform.
Within each reading of an entry it takes the complete matches the match mode allows, leftmost first and longest at each start with none overlapping, as Search's replace does, and puts the replacement's sounds in their place; a blank replacement deletes them, so ARE → blank turns ARBITER into BITTER.
The replacement is the same dialect without `*` or `?`, which can't say what to put in.
Its words translate to exactly the sounds they would in the search box, so either box's lines can be pasted into the other.
A replacement's `(…)` and `(^ …)` apply to the spliced result: `pa`'s `P AO (^ R)` keeps MA → PA from turning MARSHA into PORSCHE.
The rest of the entry is heard the way a typed word is, its sounds widened into the same sets, or ARBITER's unstressed -biter couldn't meet BITTER.
A word's last AA or AO there loses AO when the splice puts an R right after it, as the merger stops before R. The result is a pattern over a whole entry, matched against an index of every corpus entry's readings built in `prepare` and kept in the prepare-artifact cache, so the output is whatever entries are pronounced that way, spelled however they are.
The index keys each reading coarsely (T and D share a key, every vowel shares one), and a pattern looks up every key its sets combine into: `[S Z]` two, `#` twenty-three.
Past 1,024 keys (three `#`) it checks every reading of its length instead.
Since there's no way to spell a sound string, there is no **Allow unlisted**.
An output that is the input itself is dropped.
Unlike the filter, replace keeps occurrences of the typed word itself: KNIGHT → DAY turns KNIGHT SHIFT into DAY SHIFT.
The output is marked on the letters spelling the inserted sounds, in norm coordinates, because the executor emits every spelling of the output's norm and display marks would land wrong on a differently spaced one.

**Highlighting uses a letter–sound alignment.**
[`engine/phone-align.js`](../site/src/engine/phone-align.js) pairs each word's letters with its sounds using a cheapest-path search over (letters used, sounds used).
Each step uses a spelling from a hand-written table: `ph`→F, `igh`→AY, `x`→K S, `qu`→K W, a doubled consonant, a letter's name for initialisms (`TV`), or a silent letter priced by how often that letter is silent.
Any run of vowel letters can stand for any vowel sound at a middling price.
A letter and sound with no known spelling can still pair up, but at a steep price, so every word gets some alignment.
On the full CMU dictionary, 99.7% of words align without a guessed step, and almost all of the rest are foreign names.
A matched run of sounds is highlighted on the letters of the steps that produced it.
Silent letters just outside the matched sounds are included only when they run to the edge of the word (the final `e` of `phone`, the `k` of `knight`).
When any matched sound in a word has no letters of its own, the whole word is highlighted.
That happens with an abbreviation CMU reads as its full word (`DR` as "drive") or a schwa no letter spells (`SHOULD'VE`).
Marking only the letters that do have sounds (the `r` of `DR` for "rye") would pass off a guess as a letter-for-sound match.
A run that crosses words highlights each word's part separately.
Alignments are computed only for matching entries and are cached per word and pronunciation.

**Tuning the alignment.**
The prices trade off against each other, so a tweak usually fixes some words and breaks others.
[`scripts/phone-align-diff.js`](../scripts/phone-align-diff.js) aligns every CMU word with the working tree and with a git ref, and lists the words whose alignment changed; run it before committing a change.
Highlights that have been checked by hand are rows in [`tests/unit/tools/phone_search.cases.js`](../tests/unit/tools/phone_search.cases.js), run offline against the real CMU lines in `tests/unit/fixtures/cmu-cases.dict`.
After adding a row with new words, refresh that file with `node scripts/phone-cases-dict.js`.

## Stress shift

Stress shift ([`engine/tools/stress_shift.js`](../site/src/engine/tools/stress_shift.js)) groups entries said with the same sounds but stressed on a different syllable: ROCKET and ROCKETTE, DESERT and DESSERT, IN A SENSE and INNOCENCE, and one entry said two ways, like PROJECT.
It is group-only, with no typed input ([`pipeline.md`](pipeline.md) § *Group-only tools*).
Its **Show** control picks **Homophones** (a shift between different entries, the default) or **Heteronyms** (one entry said two ways); entries are compared by norm, so IN SIGHT and INSIGHT are a heteronym.
Each member is marked on its primary-stressed syllable, onset to coda, through the letter–sound alignment (§ *Phone search and letter–sound alignment*), with syllables cut by `syllabify` (§ *Rhymes*): ROCKet, roCKETTE, PROJect, proJECT.
Entries are read by the shared phone reader ([`engine/phone-reading.js`](../site/src/engine/phone-reading.js)), with stress kept (`stressedSoundsOf`).

**Same sounds means the same consonants and all but one vowel.**
Two readings match when their consonants and vowel slots line up exactly, and their vowels agree everywhere except at most one syllable, where a reduced vowel (`AH0` or `IH0`) faces a stressed one.
CMU spells the reduction out, so identical vowels would match neither of the motivating pairs: ROCKET is `R AA1 K AH0 T` against ROCKETTE's `R AA0 K EH1 T`, DESERT is `D EH1 Z ER0 T` against DESSERT's `D IH0 Z ER1 T`.
A second reduced syllable lets RAVEN meet RAVINE and MELON meet MALONE, which share consonants and nothing else.
The reduced class is narrower than Whole rhyme's schwa class: adding EH0, OW0, and the rest marries EBAY to OBEY and DINO to DUNNO.

**The reduced vowel must be spelled like the vowel it faces.**
A reduced vowel is a full one weakened, and its letters show which: ROCKET's `e` is ROCKETTE's EH, PROJECT's `o` is its AA.
CMU's `AH0` alone can't tell a weakened vowel from one that was never that vowel, so without a check DUNDEE's `u` met DANDY's AE, IMPLEMENT's `e` met EMPLOYMENT's OY, IMAGING's `a` met EMERGING's ER, and END A's `a` met ENDOW's AW.
The letters come from the alignment, and two tests apply, each catching what the other misses.
They must start with the same letter as the stressed vowel's spelling: the spelling table lets `a` stand for EH, which would pass PERSONAL/PERSONNEL and PATROL/PETROL.
And they must be a spelling of the stressed vowel in that table (`canSpell`): a shared first letter would pass RIVET's `e` for REVERT's ER.
A one-letter word never stands in for a stressed vowel, since the article A is spelled like half the vowels and paired AGATE with A GUT and OSPREY with A SPREE.
Between two entries, the stressed vowel must also be short (no AY, EY, OY, AW, IY, OW, or UW).
A long or gliding vowel keeps its quality where the other word's schwa doesn't, so HUMAN and HUMANE, ROMAN and ROMAINE, CARTON and CARTOON, and CRITIC and CRITIQUE sound like different words.
One entry's own readings may face a long vowel, since CMU listing both is evidence the schwa is that vowel weakened (PROtest and pruh-TEST, DEtail and dih-TAIL, SUpine and suPINE); two different words carry no such evidence.
A gliding vowel (AY, EY, OY, AW) is barred even there, which still splits FInance from fiNANCE and HOStile from hoSTILE.
Readings are therefore identified per entry, so CASHES, which says CACHES' short reading, doesn't inherit what CACHES' own readings are allowed.
Measured on the 865k-row merge, these rules take the tool from 1,321 groups to 194 homophone groups and 403 heteronym groups.
What they cost is pairs that plausibly sound alike, which the tool treats as different: COMEDIAN/COMEDIENNE, PARKA/PARQUET, MOTEL/MOTILE, and OBSESS/ABSCESS among homophones; DEcor/deCOR and ADvertisement/adverTISEment among heteronyms.

**The stress has to move, not just differ.**
Two readings shift when their primary-stressed syllables are disjoint.
CMU sometimes marks a compound's second stress as primary (LAWMAKERS is listed once each way), and overlapping patterns like that are no shift.
Homophones stressed alike (CELLAR, SELLER) never group.

**A word said two ways is a group by itself.**
CMU lists heteronyms under both stresses (PROJECT, DESERT, CONTENT), and each reading is its own member, so PROJect and proJECT sit side by side; the executor's `group.memberReadings` hook is what lets one entry appear twice ([`pipeline.md`](pipeline.md) § *The group-row model*).
Within one entry, a reading whose stressed syllables strictly contain another's is dropped: CMU's PREDATE as both preDATE and PREDATE.

**A phrase reads each word one way**, by the word's first citation pronunciation.
A phrase still meets a word (IN A SENSE and INNOCENCE, ATE IN and EIGHTEEN), but varying its words turns nearly every phrase into a group of itself: IS THIS IT stressed on each word in turn, ADVERSE EFFECT four ways, IN EFFECT restating EFFECT.

**A group is a clique of readings.**
`prepare` indexes every reading in the wordlist, buckets the readings by consonant skeleton, and keeps each maximal set whose members all match pairwise and contain at least one shifting pair.
Connected components would chain: DETER matches DAUGHTER, DEBTOR, and DIETER, which sound nothing like each other.
Since the spelling check makes a reading's letters part of its identity (GRAY and GREY are two nodes), a group's key is its readings' pronunciations plus vowel letters, and a member's marks re-derive from its text and the key at render time.
Aligning every reading in the wordlist would cost too much, so only a bucket where some pair could shift is re-read with its letters.
The index maps each grouped entry to its groups' keys, so bucketing an entry is a lookup, and it lives in the prepare-artifact cache.
A `keepGroup` re-checks the shift and applies Show, because a filter upstream can thin a group down to members stressed alike.
On the 865k-row merge (with unspaced entries CMU lacks left unread), the index builds in about three seconds.
CMU's own wrinkles come through: it lists ELEVEN, EMOTION, and ERODE with an EE- reading stressed on the first syllable, which looks just like REsearch and DEtail.
