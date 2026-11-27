# Sound shift lab

The Sound shift lab page, `/lab/sound-shift/` ([`design.md`](../design.md) § *Lab pages*), carries one tool, Sound shift ([`sound-shift.js`](../../site/lab/sound-shift/sound-shift.js)).
It sweeps the wordlist for pairs whose pronunciations differ by one sound moving to a new spot: `FRIAR TUCK` and `FIRE TRUCK` are the same seven sounds in the same order, except the R jumps from second to fifth.
Each pair shows as a chain row with `↔`.
A **Sound** box narrows to moves of one sound, written as a CMU phoneme (`R`, `T`, `AY`); focusing it pops a cheat sheet of all 39 phonemes with example words, and a string that isn't a phoneme is an error rather than an empty result.

**Word boundaries and stress are dropped before comparing.**
Entries are read by the shared phone reader ([`engine/phone-reading.js`](../../site/src/engine/phone-reading.js)), each word through `soundsOf` or, for an initialism neither dictionary has, its letter names as in Phone search (`soundsOrSpelled`), and a reading runs one pronunciation per word together into one phone string, up to four readings per entry.
Without the boundaries a two-word entry pairs with a one-word one (`RIGHT ANGLES` / `TRIANGLES`, `ABDOMEN` / `BAD OMEN`), and without stress a sound that lands on a differently stressed syllable still counts as moved.
Restore either and the tool silently stops finding its motivating cases.
An entry with a digit has no reading, since CMU's key would strip it and return a confident wrong one.

**Plain readings pair with plain, folded with folded.**
Each word is read plain and folded, as for Phone search ([`phonetics.md`](../phonetics.md) § *Pronunciations*: the cot–caught merger, IY and UW before R, the ER after AY and AW, the flapped T), and a pair counts when either kind is one move apart.
The folds see only inside a word, so each kind finds pairs the other misses: SEATER's T flaps to D and EASTER's doesn't, so only the plain readings pair them, while only the folded ones pair PARTING with PRODDING.
Only citation pronunciations are read ([`phonetics.md`](../phonetics.md) § *Phone search and letter–sound alignment*), so IT doesn't pair with TO said "tih".

**One pass per pair, behind a multiset bucket.**
A move permutes phones, so entries are bucketed on their sorted phone multiset and only bucket-mates are compared.
Two readings are one move apart exactly when the window where they differ is a rotation by one, so `movedPhoneme` settles it in one pass.
Both directions emit and `unify` folds them ([`pipeline.md`](../pipeline.md) § *Symmetric unification*).
The pair list is built without the Sound param and kept in the prepare-artifact cache, so changing Sound filters the cached list instead of re-sweeping, which takes nearly twice as long as building the spacing table.
Its two passes, pronouncing and comparing, weigh 62 and 1 on the progress ring ([`pipeline.md`](../pipeline.md) § *Pipeline execution*).
The list carries no `patch`: its pairs depend on which entries exist, so an edit that swaps rows purges it and the next run re-sweeps.

**A word neither dictionary has is read by walking the ranked splits.**
Its letters are split through `rankedSplits` ([`segmenter.md`](../segmenter.md)), and the first split whose every part can be read supplies the reading, so `FIRETRUCK` pairs by way of `FIRE TRUCK`; a lone letter other than A or I is never a part.
It does not use the spacing table's single `best`/`guess` reading, as Rhymes and Phone search do: the question is "is there any way to say this", and a top split that can't be pronounced shouldn't hide a lower one that can.
On a 752k-entry merge, whole words read 65% of entries and the splits lift that to 97%.
Offline, before the segmenter's corpus has loaded, a solid compound has no reading and drops out.
Splits and the filter's word checks read the full merge (`ctx.vocab`), so a single-wordlist scope reads its entries as well as All Wordlists does.

**Same-words variants are filtered out.**
Most raw pairs are the same words re-inflected, reordered, or re-spaced (`BILLIARD PARLORS` / `BILLIARDSPARLOR`, `TURNOVERS` / `TURNS OVER`): CMU's variants let a plural or tense hop a word boundary and pose as a relocated sound.
`makeMorphFilter` segments both entries into content words and drops a pair that is the same words up to inflection and order, or a compound against its own phrasal form.
It stays conservative — inflectional endings only, and compounds split only into real words, never a bare suffix fragment — so `DRY POTS` / `DRY SPOT`, `STAND FOR` / `STANFORD`, and `LESSOR` / `OR LESS` survive.
On a 3,483-pair real-wordlist dump it drops 132, none wrongly beyond the `NEWS` / `NEW` homophone edge.
