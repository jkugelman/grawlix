# Storm surge lab

The Storm surge lab page, `/lab/storm-surge/` ([`design.md`](../design.md) § *Lab pages*), carries one tool, Storm surge ([`storm-surge.js`](../../site/lab/storm-surge/storm-surge.js)).
It searches for a theme: [Boo___] clues STORM SURGE, read as ST OR M SURGE, because BOOST and BOOM both mean SURGE.
The tool finds entries X + OR + Y + Z where Z has two synonyms P+X+Q and P+Y+Q, and the clue is P___Q.
Each result reads `boost / boom = surge`, with X and Y highlighted.
A **Blank** control puts the blank at the end of the clue, the start, the middle, or anywhere, and a **Thesaurus** control picks which thesaurus decides what counts as a synonym.

**Quality rates a clue by its weaker synonym pair.**
A three-bar Quality column, the default sort, rates each pair strong, fair, or weak.
The ratings come from counter-fitted word vectors (Mrkšić et al. 2016), which put near-synonyms close together; the generator computes them at build time, and only the ratings ship, not the vectors.

**The thesaurus is generated, not checked in.**
[`scripts/lab/storm-surge.js`](../../scripts/lab/storm-surge.js) combines Moby Thesaurus II, Open English WordNet and Roget's Thesaurus with the quality ratings into `data/thesaurus.txt`, about 31 MB.
Its format is documented at the top of the generator.
