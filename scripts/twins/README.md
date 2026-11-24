# Twins tuning harness

Evaluation harness for the Twins tool ([`docs/design.md`](../../docs/design.md) § *Twins*), run on the scorer the tool ships.
Reads the live wordlists checked out at `~/wordlist` (`all-wordlists.txt`), keeping entries scored 40 and up.
Scores play no other part: Grawlix's score filter sets the corpus, so the tool needn't weigh them.

Unspaced entries are read through Grawlix's segmenter (Space out's first tier, over the whole list), so spaced and bare lists get the same word breaks.
Pronunciations come through the tool's own readers, so an unspaced entry CMU lacks is split the way Phone search and Rhymes split it.
It needs wordfreq's `large_en.msgpack.gz`, the file Grawlix fetches at runtime; it reads `~/.cache/grawlix/large_en.msgpack.gz`, or wherever `WORDFREQ` points.
Fetch it with `curl -L -o ~/.cache/grawlix/large_en.msgpack.gz https://raw.githubusercontent.com/rspeer/wordfreq/master/wordfreq/data/large_en.msgpack.gz`.
Without it, unspaced entries stay one word.

## Files

- `lib.mjs` — the Node loaders (wordlist, segmenter, WordNet) for the scorer in `site/src/engine/twins.js`, with the phone scorer in `twins-sound.js` and the prefilter in `twins-filter.js`.
  `DEFAULTS` lists every knob: substitution, gap and move costs, and the post-alignment features (edit sites, edge gaps, moved word breaks, shared words).
  The boring-pair filter uses `familyKey` from `site/src/engine/morphology.js`.
- `segment.mjs` — loads the wordfreq corpus and the bigram table into `engine/segmenter.js`.
- `cli.mjs` — query from the command line or interactively; a blank line (or `--random N`) rolls random entries that have lookalikes.
- `harness.mjs` — `eval`, `sweep`, `pool` and `finds`.
  `sweep` takes a JSON file mapping names to knob overrides, `{"cheap swaps": {"blockSwap": 0.6}}`, and prints one summary line each; keep sweep files out of the repo, since their numbers mean little once the defaults move.
- `readings.mjs` — `loadAll`, the corpus with each entry's pronunciation and rhyme keys attached, the way the tool reads them; `cmu.mjs` loads the CMU dictionary and Grawlix's supplement for it.
- `filter/` — ground truth and calibration for the prefilter (§ *Speed and candidate filters*).
- `cases.tsv` — John's example pairs, each tagged with a category; [`EXAMPLES.md`](EXAMPLES.md) lists them with his notes and the groups they fall into.
  A fixed quarter, chosen by hash, is held out; `--holdout` evaluates only those.
- `labels.tsv` — judged result pairs, `good`, `ok` or `junk`, with who judged them.
  John's judgments outrank Claude's.
  A pair John rated down only for a pronunciation he doubted carries the rating he'd give it as read, when the reading is sound, so the scorer isn't charged for the dictionary; a reading that is wrong gets fixed in the CMU supplement instead.
- `swapscan.mjs` — finds phonetic word swaps across the whole list, independently of the scorer, for hunting examples.
- `spoonscan.mjs` — finds exact spoonerisms between two-word entries and scores them with the tool's scorer.

## Commands

```bash
node scripts/twins/cli.mjs "brass tacks" --set respace=-0.3
node scripts/twins/harness.mjs eval --set sharedDilute=1
node scripts/twins/harness.mjs sweep /tmp/sweep.json
node scripts/twins/harness.mjs pool 40 --out pool.tsv
node scripts/twins/harness.mjs finds 30
```

`eval` reports, per category, how often a case's partner ranks first, in the top 5 and in the top 20, with each pair queried from both ends.
It also reports how many results a random query returns under each cutoff (noise), the share of examples and of labeled junk under each cutoff, and how well looseness separates good pairs from junk (AUC).
`pool` collects top results of random queries under several configs, so labels don't only cover what one config surfaces.

## WordNet

Relatedness reads `site/data/twins-wordnet.txt`, the extract the tool ships, through `site/src/engine/twins-wordnet.js`.
`node scripts/gen-twins-wordnet.js` regenerates it from Open English WordNet.

## Sound

`DEFAULTS.sound` turns on the sound route: entries need a `.sound` reading, which `readings.mjs`'s `loadAll` attaches (cached at `~/.cache/grawlix/twins-phon-reads-v5.json`, since reading the list takes about a minute).
The rhyme route (`DEFAULTS.rhyme`) needs `.rhymes` as well, which `loadAll` also attaches, and `query` scores rhyme candidates the prefilter rejects.
The CMU dictionary is read from `~/.cache/grawlix/cmudict.dict`, or wherever `CMUDICT` points; `cmu.mjs` prints the `curl` line that fetches it when it's missing.

## Rating pages

`ratepage.mjs` turns a batch of pairs into a phone-friendly page: Good / OK / Junk buttons and an optional note per pair, saved in the viewer's browser, and a Copy ratings button that puts the ratings and notes on one paste.

## Speed and candidate filters

`query()` first runs the prefilter (`site/src/engine/twins-filter.js`), a 70 ms scan that keeps an entry when its letters or its phones are close enough in content to the query's: the letter-count difference and the share of letter pairs missing from the other side, each over the shorter length, or the same two measures on phones.
The cutoffs per looseness come from `site/src/engine/twins-thresholds.js`, which `filter/calib.mjs` fits to the fewest survivors that still keep every exact hit, then widens by 0.15.
Above 0.45 the filter is off.

| cutoff | survivors | query, filtered | query, exact |
|---|---|---|---|
| 0.2 | 8% | 0.9 s | 4.3 s |
| 0.3 | 25% | 2.3 s | 5.8 s |
| 0.45 | 70% | 5.3 s | 6.5 s |

`harness.mjs eval` takes about 1.5 minutes, 4 with the filter off, and gives identical numbers either way.
Fit on half the ground truth and checked on the other half, the widened thresholds lose 2 of 603 held-out hits at 0.2 and none at other cutoffs.
Results on sampled queries match the exact scan entry for entry.

The thresholds hold for the default knobs.
An override that makes scoring looser (a cheaper operation, a different normalization) can score pairs under the cutoff that the filter rejects, so the scorer turns the filter off for it: `STRICTER` in `site/src/engine/twins.js` lists the knobs and the direction each may move with the filter on.
A sweep of looser variants runs at the exact speed.
After changing the defaults, rerun `truth.mjs` and `calib.mjs`.

`filter/` also measures filters against exact results: `truth.mjs` records every hit under 0.45 for ~480 queries (10 minutes), `bench.mjs` reports candidate filters' false rejections and survivors, and `slack.mjs` does the same for the alignment's early-abort allowance.

## Findings

Recall comes first: filtering out a good pair costs more than letting a few inflections or variants through.
A filter earns its place only when it catches almost nothing John would want.

What the harness has shown, in the order it was learned:

- Spelling and simple edits handle respacing, one-chunk and one-letter pairs well; most partners in those groups rank in the top 5.
- Rearrangements rank poorly under alignment.
  A tiling channel (shared chunks in any order) lifted them but let in junk, and was dropped.
- The junk is mostly relatives the filter misses, shared-word pairs whose other words differ wholesale, and spelling variants.
  Judging shared-word pairs on their differing words alone, and charging extra for long unbroken runs of edits, cut junk under a 0.3 cutoff from 63% to 36%.
- Unspaced entries need Grawlix's segmenter, or every comparison with a spaced entry looks like a moved word break.
  With it, junk under 0.3 fell to 30%.
- John's first rating batch favors tight pairs: one or two edits, looseness about 0.1 to 0.25.
  His junk falls at both ends: variants and relatives below about 0.11, and pairs with three or more edit stretches above about 0.25.
  So distance is the right sort axis, with narrow filters at the close end (-ise/-ize spellings, a changed digit, -a/-an demonyms).
  Doubled letters stay a small cost, not a filter: one that dropped INAMORATA / INNAMORATA also dropped DINER / DINNER.
- The third batch's junk was mostly morpheme swaps: shared prefixes or suffixes around a short changed core (SAINTLIEST / SPINDLIEST, DISPLAYING / DISPLEASING, REPAPERING / REPANELING).
  Taking a shared affix of three or more letters out of the length the cost is divided by cut his junk under 0.25 from 58% to 48% without losing examples; BLOW DRYERS / SLOW DRIVERS is the one good pair it pushes past the cutoff.
  Plain distance alone no longer separates his good pairs from this junk, so structural terms like this are where gains remain.
- Pronunciation runs as a second route beside letters: a pair scores the better of its letter looseness and its phone looseness plus a penalty, over the same diluted length.
  At 0.10, with the fixes below, held-out examples under 0.30 rose from 64% to 76% (DINOSAUR / DINAH SHORE .53 → .09) and noise on random queries from 7 to 15 results at 0.30; at a 0.04 penalty noise is 38.
  The penalty is needed because sound alone admits 10 to 25 times as many results as letters at the same cutoff, and about 80% of the pairs only sound finds are junk, mostly entries sharing an opening or closing run of sounds and nothing else, a RE- or MR- prefix above all.
  Sound wins on sound-alike and same-frame pairs (SCHENECTADY / SYNECDOCHE .91 → .18, HARRY CAREY / HARA-KIRI .50 → .13); letters win where spelling carries the resemblance (THERE'S A WAY / THERESA MAY .10 by letters, .37 by sound), so the route never replaces them.
  Substitutions priced by phone features (voicing, place and manner; a vowel height, backness and rounding grid) clearly beat flat vowel and consonant classes, and a vowel plus R against ER is one cheap operation (SURE BET / SHERBET .31 → .14); charging for stress mismatches didn't help.
  98.6% of entries scoring 40 or more get a pronunciation, 9% of them only after the segmenter spaces them; the gaps are misspellings and puns on names (ROUTE KANAL, DUCKTALES).
- Phone substitutions priced by articulatory features alone are too cheap: SEETHING / ZEVON (S→Z, DH→V, NG→N, vowels matching) scored 0.23.
  Every consonant change now costs at least 0.3 on top of its feature distance, and the sound route pays the letter scorer's charge for runs of edits.
  That cut sound-route results on random queries from 1.3 to 0.1 each, so the sound penalty came down to 0.06; held-out partners in the top 20 rose from 74% to 79%.
- John's comments on the first scorecard pointed at specific costs, and each fix moved the examples:
  - Two letters trading places (TOVE LO / LOVE TO, LEGATO / GELATO) cost 0.6 together instead of two substitutions.
  - A long gap counts as half an edit per letter after its first toward the edit-site penalty, so one clean cut (MARIE ANTOINETTE / MARIONETTE) beats scattered changes.
    With the swap, partners in the top 20 rose from 69% to 74% and the chunk and move groups' top-5 rates from about 30% to 50%.
  - Inserted letters cost by kind: vowels 0.35, soft consonants H L N R S T 0.4, hard ones F J K Q V W X Z 0.75, the rest 0.55.
    TOWEL OFF's added Fs should cost more than EARHART's R and H.
  - Inserting a run of two to four letters found in the other entry is one cheap operation, so INDIGO / INDIEGOGO is a copied GO plus an E.
  - Two blocks of one to three letters can trade places for 0.9 (SEMAPHORE / SOPHOMORE swaps M and PH, then changes two vowels), tried only when the pair's letter counts nearly match.
    Move pairs in the top 5 rose from 40% to 58%, noise from 15 to 16.
  - John's fourth batch, from the current scorer, rated block swaps the worst source of junk (18 of 31) but also half his good pairs.
    Raising their cost drops good pairs as fast as junk.
    His notes say what separates them: a good shuffle lines up piece by piece in sound (HOVERCARS / HARDCOVERS: HOVER~COVER and CAR~HARD rhyme), while a near anagram that doesn't sound alike is unwanted (THE SOUVENIR / THE UNIVERSE).
    Whole-entry sound can't see this, since the phone aligner can't swap either.
    Block swaps on phones scored HOVERCARS / HARDCOVERS close by sound, but no other good block swap (COSMIC DUST and ZYGOMATIC need larger rearrangements plus substitutions), and were dropped once letter block swaps ranked HOVERCARS / HARDCOVERS second on their own.
    Making letter block swaps cost 1.5 so sound decides cut rated junk under 0.30 from 12 to 5 but good from 7 to 4 and OK from 8 to 4, so letter block swaps stay at 0.9.
    A block that spans a word break in either entry costs 0.2 more.
    Only 8 rated block swaps cross a break, 4 good (A HELL OF A LOT / HELD ALOFT) and 4 junk (SAT WELL / WEE LADS), so the penalty barely moves the metrics: top-1 rank 40% → 41%, rated junk under 0.25 41% → 40%.
    Forbidding crossings costs good pairs.
  - The shared-word discount never shrinks the length below four letters; YO-YO MA / YO MAMA and A/B TEST / AP TEST had scored over 1.3.
  - A pair whose word breaks move inside the shorter side is a respacing, never an inflection (SEETHING / SEE THINGS, RACE CAR / RACE CARD).
- Many "misses" are not failures: John rated most of the entries that outrank a missed partner as good or reasonable (DECADE / DE SADE, GAY MARRY / GAMMA RAY), so top-5 rank understates the tool.
- A logistic regression over each path's operation counts can't beat the hand weights: John's junk sits closer in letters than his examples do, and an example's partner is no closer than its query's other neighbors.
  What makes a pair good is that the meanings are unrelated and both sides are real words, which letter edits can't see; semantic relatedness (WordNet's derived forms and shared senses) was the next signal tried.
- WordNet relatedness (Open English WordNet 2025, through the extract `site/data/twins-wordnet.txt`) adds a cost of 1 when a word of one entry shares a lemma, a synset or a derivation link with a word of the other, skipping shared words and words of three letters or fewer.
  It charges 3 of 239 good pairs (GRASSHOPPER / GRACE HOPPER, SPOKESTOON / SPOKE TOO SOON, RAKES LEAVES / TAKES LEAVE) and 19% of John's junk; John's junk under 0.25 falls from 49% to 38%, his rated goods from 76% to 74%.
  Hypernym and sister links tie unrelated words (TIME~FITS, SLIP~SKIP) and stay out.
  WordNet misses most morpheme swaps: ENTHUSIAST and ENTHUSIASM have no link.
- Letter play with letters already present: a gap that exactly repeats the run beside it is cheap (YO HO HO, LULULEMON), but exact copies are rare, so it moves few pairs.
  Discounting any gap letter that echoes a nearby letter (BABEL / BABYBEL) helped chunks and moves as much as it hurt frames, and was dropped; counting the whole entry as nearby let in more junk.
- His second batch, a random sample spread evenly across looseness, had no good pairs below 0.12 and good pairs out to 0.30, so the cutoff belongs near 0.30.
  The close junk is mostly affix relatives (ENTHUSIAST / ENTHUSIASM, CHIVALROUSLY / UNCHIVALROUSLY), which are demoted, not dropped, so a respacing like VENTILATE / VENTI LATTE is never caught.
- Multirhymes were out of reach: the sound route charges every consonant change at least 0.3, and a multirhyme changes nearly every consonant (CHERRY TREE / MARRY ME 0.58, SPRUCE TREE / LOOSE TEA 0.69).
  Three general rules were tried in turn, measured by rows added to 25 to 40 random queries:
  - Matching vowels and stress with consonants priced by position (onsets 0.15, inner clusters 0.3, the final cluster 0.5) moved all 19 of John's multirhymes to 0.07–0.24 but added 3,639 rows to 2,201, mostly suffix rhymes (HAMITIC drew 854 -ITIC entries).
    Charging less for a shared ending many CMU words have, or for a vowel pattern few entries share, didn't separate good from noise: John's pairs' vowel patterns are shared by 145 to 360 entries, the noise's by 82 to 478.
  - Requiring every syllable to rhyme (vowel and closing consonants match, onsets free; Rhymes' Whole mode) added 14 rows to 40 queries, nearly all good (FIRST PLACE / WORST CASE, STEAK FRIES / SNAKE EYES, MOZZA STICK / GOT THE ICK); letting one syllable's closing consonants gain or lose one added 102, about half good.
  - Of 60 sampled rhyme-route results, the flat ones were rhymes between two one-stress words (CRAZING / BLAMING, HARVEY / ARTIE, GASOMETERS / BOLOMETERS); requiring two stressed syllables in either entry dropped 16 of the 60, all of that kind, and kept every multirhyme of John's but ZUCCHINI / HOUDINI, an ordinary rhyme the sound route already scores 0.36.
    The rhyme route scores a two-syllable rhyme 0.32, less 0.04 a syllable, plus 0.08 for a near one, so rhymes land mid-list.
    Against the route off: rhyme examples in the top 5 rose from 0% to 22% and in the top 20 from 11% to 33%, all examples in the top 20 from 83% to 84%, noise at 0.40 from 111 to 116 a query (14 at 0.30 either way), and frame partners at #1 fell from 28% to 22% as rhymes outrank some of them; rated good and junk under every cutoff are unchanged.
    Base values from 0.30 to 0.38, near rhymes off, and no per-syllable step all land within a point of each other on the rated metrics, which hardly involve rhymes; the values follow John's ask that rhymes rise without topping the list, to be set by his ratings of the route's results.
- PSILOCYBIN / PS I LOVE YOU stood alone until a search for its shape: a single word opening or closing with a run that a phrase spells across a word break, two letters or more either side.
  Of 50,000 such pairs, nearly all were coincidences buried in long entries (BEEBLEBROX / VEGETABLE BROTH); anchoring the run at the start or end of both and requiring it to cover 40% of the shorter entry left 600,000 anchored candidates before the other rules, mostly compounds.
  Rejecting pairs where the phrase's piece of the run is a word or prefix in the single word (EGGNOG / EGG NOODLE at the start, BRICKLAYERS / THICK LAYERS at the end) left 768 distinct runs over the whole list; ranking them by bits of surprise per letter under a letter-trigram model put PSILOCYBIN sixth, the top quarter mostly good and the middle mixed.
  A 3-bit floor keeps 288 runs, about 1,250 pairs: under one extra row per hundred queries.
  John approved the top finds but IGNOBLE / IG NOBEL (a deliberate pun) and MEATLOAF / CAT LOAF, and they joined `cases.tsv` as the `run` category.
  Against the route off: run examples in the top 20 rose from 10% to 70%, all examples from 77% to 81%; noise and rated junk under every cutoff are unchanged.
  CHIMPANZEE / TAPPAN ZEE still misses, since ZEE is a word: rejecting only when both halves of the single word are words would keep it but multiply the pairs sevenfold, with many compounds seen sideways (FAITHLESSLY / FAITH LEADER).
- John's seventh batch rated 60 shared-run pairs, 40 from the strict compound check and 20 only a looser one admits (rejecting only when both halves of the single word are words); he rated the outliers and called the rest decent, recorded as OK.
  Strict: 5 good, 3 junk; loose: none good, 4 junk (SNOWBOARDER / SNOW BOOT, RADIOTELEPHONY / RADIO TELESCOPE), so the strict check stays.
  Two of the strict junk were the phrase's words run together (BYWAYS / BY WAY OF EXAMPLE, OOMPAHS / OOM-PAH-PAH BANDS), which a two-letter first piece let past; the route now rejects a single word that is the phrase's opening or closing words glued, give or take an inflection.
  Four of his five good pairs (ALGREN / AL GREEN, OGOPOGO / I GO POGO, LAFITTE / LA FITNESS, ALAMODOME / A LA MODE) already scored under 0.21 on letters.
- John's sixth batch rated 60 rhyme-route pairs: of exact rhymes, 16 good, 10 OK and 1 junk; of near rhymes, 8 good, 10 OK and 7 junk.
  His notes: slant and near rhymes he liked (READER RABBIT / CEDAR CABINET, GYM PASS / SWIM MASK, VIDEO PHONE / LYDIA KO), and assonance worth rewarding even short of rhyme (COST-SAVING / CROSS-TRAINING, GLUCOSES / BULOVAS, HARVEY / BARCLAY, FAIREST / SWEAR IT); 7AM / THEY THEM was good for the short/long matchup.
  Most of the near-rhyme junk came through a bug: the stress rule counted an entry's most stressed reading, not the one that rhymed, so CRAZING / ETA passed on ETA's spelled-out E-T-A. Counting the rhyming readings instead dropped those, but also one-stress pairs he rated OK, every one a phrase against a word (FAIREST / SWEAR IT, ENLARGE / THE SARGE); so one stress now suffices when either entry is a phrase, which keeps all 24 good pairs and 17 of 20 OK and drops 2 of 8 junk.
  The three OK pairs lost are one-stress words (SPOKEN / KOAN, THOROUGHLY / SERVILELY, GASOMETERS / KMS), which John says weren't that good.
  Requiring one stress everywhere would add 0.7 rows a query on average but floods a one-stress query: SLIGHTINGLY drew 36, and a two-syllable word like CRAZING hundreds.
  AQUA VITAE / MACROCLIMATE, junk, matched because Rhymes' Whole mode reduces an unstressed OW to schwa, so MAK-ro-KLY-mut reads as AK-wuh-VY-tuh with a T added; RESUBMITTING / RECOMMITTING, junk, is a morpheme swap that rhymes.
- Scores were not symmetric: 23 of 1,169 rated and example pairs scored differently by which entry was the query, from three causes.
  The inflection test took the query as the stem when the two entries tied in length (SPINDLY / SPINDLE boring one way, 0.09 the other); block swaps rearranged only the query (FRENCH PRESS / FRESH PRINCE 0.21 and 0.29); and the alignment's tie-breaks and the sound route's readings depend on side (BHUJA / ABUJA 0.19 and 0.27).
  The scorer now orders each pair by norm, scores hits the other way too and keeps the better, tries block swaps within both entries, and tests inflection both ways on a tie.
  Every pair now scores the better of its two old directions, except four the inflection fix makes boring, three of them rated junk (SPINDLY / SPINDLE was OK); queries take 7% longer, and the eval moved slightly up (respacings at #1 71% → 73%, John's good-vs-junk AUC 0.630 → 0.638).
- Rhymes sat below close-spelling junk: of John's rated pairs, exact rhymes at 0.32 were two-thirds good, letter and sound pairs near 0.32 a twentieth.
  Lowering a two-syllable rhyme from 0.32 to 0.24 raised rated good under 0.25 from 76% to 86% and John's rated AUC from 0.709 to 0.744, with rated junk unchanged; chunk examples in the top 5 fell from 41% to 30% and moves from 60% to 54% as rhymes outrank them.
  0.20 and 0.18 gained a little more AUC for a little more of that cost.
  Assonance outside the rhyme route, vowels matching with consonants free, carried no signal on the rated letter and sound pairs (23% good against 20% without), most of the matches being near-duplicate spellings (KENDALL / KENDAL); the assonant pairs John liked arrive as near rhymes.
- Whole rhymes missed pairs whose unstressed openings differ (CAREER FAIR / TAHRIR SQUARE, CA- against TA-).
  Rhyming from each entry's first stress on added about three hits per random query, mostly junk (POETES MAUDITS / RECIPE, KRZYZEWSKI / F10 KEYS), and pushed moves in the top 5 from 55% to 51%.
  Requiring the same number of unstressed opening syllables on each side, tried only when the whole rhyme fails, raised rhymes at #1 from 6% to 9% and in the top 5 from 33% to 39%, with noise and rated junk unchanged.
- The sound route priced a moved phone as two gaps, so the sound shifts from John and Adam's puzzle sheet (TREE SURGEON / RESURGENT, the `shift` cases) sat around 0.30, FIRE TRUCK / FRIAR TUCK at 0.29.
  A move or a swap of neighbors at 0.4 in place of the two edits put shifts in the top 5 from 10% to 69% but brought in moves stacked on other changes (RAINBOW / BRENNER); allowing it only while the rest of the alignment costs 0.5 or less kept the shifts at 82% with noise, rated junk and John's AUC unchanged, and all examples' AUC 0.686 → 0.713.
  A cost of 0.7 kept 67%; a remainder limit of 0.3 kept 72%, and 1.0 gained nothing.
  With letters only (`prefilterPhones` off) and the filter cut at each pair's own looseness, the harness drops 3 of the 39 shift queries (QUINCE TREE / WIN STREAK both ways, IN TIGHTS / ENTICED) and HARRY CAREY / HARA-KIRI; the tool filters at 0.40, where all of them pass.
  Phones on in the tool's setting, over 12 queries: filter 28 → 74 ms, query 3.2 → 4.7 s, about 400 MB of readings, and 13 new hits, all 0.29–0.40 and mostly junk (CRUELER, DEQUEUES).
  Refitting the thresholds to the new scorer needed `truth.mjs` to tag rhyme and shared-run hits, which `query()` adds past the filter, so `calib.mjs` leaves them out; counted as hits, rhymes under 0.3 left no threshold that kept them all.
- Whole words trading places ranked far down: the alignment reads left to right, so HELLY R / R. KELLY scored 0.59 and WILL FERRELL / PHARRELL WILLIAMS 1.08.
  Rescoring each pair with one entry's words reordered (prefix swaps, suffix swaps and rotations at word breaks, on letters and phones) brought them to 0.40 and 0.59, still out of view, and left every eval metric within a point, since the examples hold almost no word swaps; queries took three times as long and the new hits were mostly partial matches (POT SMOKING / COOKING PITS).
  Prefix and suffix bonuses made no measurable difference, and cutting blocks anywhere, not just at word breaks, ran too slowly to measure.
  Exact reorders, which the content-word test had called boring, score on their own route; alignment put them past 0.6.
  At 0.36 they sat at one bar, and HOUSE CAT / CATHOUSE, scored by letters at 0.33, fell offscreen below a screen of three-bar pairs; reorders, a row or two a query, rose to 0.22, glued ones to 0.12 and meaning-keeping ones to 0.30.
- To see whether phonetic word swaps are worth a route, `swapscan.mjs` searched the whole list: entries with two content words, function words allowed around them (X OF THE Y), whose content words match crosswise by sound.
  It found about 33,000 candidates; John rated 80 from the top.
  Pairs where both words change were the strong kind, 24 good and 6 junk of 50 (FRESH MEAT / MEET IN THE FLESH, BLUE CARBON / CORBIN BLEU, CASH DESK / DISK CACHE); the tool shows 26 of the 363 pairs in the scan's report.
  Pairs keeping one word did worse, 7 good and 13 junk of 30, but most of that junk kept both words, one inflected (BALL DROP / DROPPED THE BALL), which the scan's same-word test missed.
  The remaining junk was word families (FIBER-OPTIC / OPTICAL FIBRE) and heteronyms CMU reads the wrong way (LIGHT RED / YOU READ THAT RIGHT).
  John prefers consonants swapped around the same vowels to the reverse, for the assonance (AIR LEAK / LAKE EYRE).
- The word-swap route (`DEFAULTS.wordSwap`) follows those ratings: word families and respellings count as the same word, and a pair keeping both is rejected.
  Its knobs carry a `wordSwap` prefix because `swap` already names the letter swap: an early prototype named its base `swap`, overwrote the letter swap's 0.6, and moved the move category's top 5 from 55% to 47% with the route switched off.
  John's 31 good swaps joined `cases.tsv` as the `swap` category and all 80 ratings joined `labels.tsv`.
  With that data in, turning the route on put swap partners at #1 28%, top 5 55% and top 20 83% (from 0 with it off), lifted moves in the top 5 from 55% to 57% and John's AUC from 0.644 to 0.672, and left every other category and the noise unchanged; rated junk under 0.35 and up rose by one pair.
  It first allowed a kept word only when both entries shared a frame, after the scan's kept-word junk; but that junk kept both words, one inflected, which the same-word test already rejects.
  Dropping the frame rule raised swap partners to 30% / 65% / 93% and John's AUC to 0.678 with rated junk unchanged, and added 5 hits over 300 random queries (CHICKEN LITTLE / MY LITTLE CHICKADEE, ONE-MAN BANDS / BAN KI-MOON).
  Over those queries the route returned 0.1 hits each, 22 queries having any, and took a few percent of query time.
- John's second swap batch, every route hit from those 300 queries, came out 4 good, 17 OK and 14 junk, and his notes kept naming the missing assonance: vowels unchanged once the words are swapped back.
  Over all 88 rated route pairs, those where some changed word keeps its vowels went 29 good, 24 OK and 7 junk; those where none does, 4 good, 12 OK and 12 junk; a kept word made no difference once vowels were counted.
  Charging 0.08 per changed word pair whose vowels differ, with the base lowered from 0.20 to 0.12 to keep assonant swaps high, raised swap partners in the top 5 from 65% to 78%, John's rated AUC from 0.724 to 0.733 and rated good under 0.25 from 74% to 77%; rated junk under 0.25 rose from 39% to 41% and moves in the top 5 fell from 57% to 55%.
  A base of 0.16 let less of the rated junk under the cutoff (11 of 19 under 0.40, against 16) but pushed swap partners in the top 5 down to 50%.
- Of 50 well-known spoonerisms, most invented on one side (LACK OF PIES, SHAKE A TOWER), 41 scored under 0.30 before a spoonerism route, through letter swaps, rhymes and the sound route.
  `spoonscan.mjs` found 20 exact spoonerisms between two-word entries of the list; the misses shared a word, which bars the rhyme route (BLOW YOUR NOSE / KNOW YOUR BLOWS), or traded clusters the aligner prices as two edits (GETTING LOW / LETTING GO 0.43).
  Trading any two words' onsets across the list found about 300 pairs: consonants sliding across a break (OFF KEY / COFFEE), into a single word (NO FEE / PHONY), or the same words remade (NEW YOU / YOU KNEW); three rules for an exact spoonerism leave 28.
  John called the rest decent, apart from identical spellings reshuffled (COULDA WOULDA SHOULDA), so they score 0.20 as loose spoonerisms.
  Its first version also failed GET LOW / LET GO and BRIGHT LIGHT / LITE-BRITE on WordNet relations, so it skips that check.
  John rated 50 of the 73 loose ones good, 16 OK and 7 junk; most OK and junk ratings blamed a misreading (LA BREA as "bree", the RE- of REPOLL as "ray"), and two came from vowel reduction, which reads the IN of WADE IN like ONE, so spoonerisms match on unreduced vowels.
  The supplement fixes the misreadings judged wrong (BREA, MEIN, MER, FI, REHIDE, REPOLL, MAHRE), and those pairs keep John's ratings; WARDEN's schwa is a sound reading, so its pair carries the rating John would give it as read.
  Two junk pairs stay junk as the reader's fault, not the dictionary's: Grawlix keys CMU's WE'LL by its letters, WELL, so FULL WELL reads "full weal", and the reduced I'M of I'M HERS ("um") matches HUMMERS.
  Gating on a rhyme alone missed loose ones whose syllables re-form (MY SON / SIMON); adding the letter filter at 0.20 catches those but not MACH ONE / WALKMAN, which only a phone-level candidate search would.
  The 9 exact pairs joined `cases.tsv` as the `spoon` category; at 0.06 the route raised them in the top 5 from 80% to 100%, all cases at #1 from 35% to 37%, and left every other category, the noise and the rated junk unchanged.
- Letting word breaks move made exact spoonerisms of the loose ones John rated good (TREE POSE / PETE ROSE, KILL ME / MILKY), 28 exact pairs becoming 83.
  Trading an opening with a cluster inside a word (inner) and trading a run's front or back part (partial) found about 1,200 and 950 more; John's second batch rated 40 of each.
  Inner came out 17 good, 13 OK and 7 junk, and partial 20, 10 and 9; the junk was mostly the T–D flap (ADLER / LATTER), vowels recolored by a moved R or a nasal beside AE (ARDOR / RODDER, NAPPER / PANNER), and misreadings, fixed in the supplement (ANSEL, BALLY) or judged sound and relabeled (LIPO as "lippo", PWN as "own").
  Dropping the flap and the folds before R and barring those recolorings left inner 25 good, 9 OK and 1 junk, and partial 27, 6 and 2, counting pairs the route then shows; 16 of 23 rated junk pairs no longer show.
  The pairs a rhyme can't gate, since inner trades re-form syllables (KIMMEL / MICKLE), mostly pass the letter filter at 0.40, the tool's cutoff, so the gate uses that.
  Rated spoonerisms sharing -ING or -ED came out 0 good, 3 OK and 1 junk, those sharing -ER(S) 6, 5 and 1, -S 6, 2 and 1, and those sharing no ending 65, 5 and 2; charging -ING and -ED 0.10 raised the good-vs-OK-or-junk AUC over both batches from 0.719 to 0.740, and charging -ER too gave 0.738 while sinking six good pairs.
  At 0.10 for inner and 0.12 for partial, John's rated AUC rose from 0.726 to 0.769 and every category and the noise stayed put; computing the query's trades once, not each row's, holds the route to about a tenth of query time.
- Mining the list for exact anagrams found about 37,000 pairs, 2,100 of eleven letters or more, half of those hidden, among them MARISA TOMEI / IT'S A ME MARIO at 0.44.
  John judged them nearly all good, the real question being where they rank: long ones at or near the top, mid-length ones not in top spots, rare letters a nudge, a shared word a small cost.
  The anagram route's length curve does that, and left every category, the noise and the rated junk unchanged.
  Sound reversals (496 pairs, nearly all four or five phones) and near anagrams (215,000 pairs a letter off, of eight letters or more) were mined and dropped.
