# A query language for search

An idea, not a plan: let users search with the `field: value` query language being designed for rescore rules, instead of (or alongside) stacking filter tools.
Nothing here is decided, and it shouldn't shake up the main UI until it has had a lot more thought.

## The language

The rescore rule redesign replaces each rule's fixed score-range and length fields with a query:

```
score: 50-59 and length: 5+
is: proper and ends with: roman numeral
contains: initialism or ends with: " up"
```

- A clause is `field: value`; commas mean any of the values (`ends with: at, to, of`).
- Clauses side by side must all match; `and`, `or`, `not` and parentheses work as usual.
- Fields: `score`, `length`, `words`, `is` / `is not`, `contains`, `starts with`, `ends with`, `pattern` (search-box wildcards), `regex`.
- `is`, `contains`, `starts with` and `ends with` take a *category* (`proper`, `initialism`, `abbreviation`, `roman numeral`, `digits`, `punctuation`, `symbols`, `spaces`, and `plain` for `is` only) or text, read off the entry's capitalization and punctuation.
- The editor suggests fields and values from the first keystroke, so a user needn't know the syntax.

It is more expressive than any tool except Umiaq, but lives only in the rescore editor.

## What it could replace

The catalog sorted by what a tool does to a row:

| Shape | Tools |
|---|---|
| Yes/no test, no input | Isograms, Palindromes, Supervocalics, Monovocalics, Alphabetical, Reverse alphabetical, Repeaters, Neckouts |
| Yes/no test against an input | Search, Regex, Phone search, Anagrams, Hidden anagram, Letter bank, Restricted alphabet, Scrabble, Kangaroos, Joeys, Consonantcy, Vowelcy, Cryptogram, Caesar, Dead center, Bookends, Initialisms, Rhymes |
| Transform (new rows) | Semordnilap, Head off, Back off, Remove string, Space out, Rebus, Optional letters, and the replace modes of Search, Regex, Phone search |
| Group (✱ all-mode) | the all-mode of nine of the input tests |
| Tuple | Umiaq with `;`, Weave |

The 26 yes/no tests are predicates on one entry, which a query expresses natively: `is: isogram`, `anagram of: elvis`, `rhymes with: time`.
Transforms, groups and tuples are not predicates; they produce chains, clusters and positional lanes ([`pipeline.md`](../pipeline.md)).

**What a query adds:**
- `or` and parentheses.
  A stack ANDs its filters and inverts one row at a time, so "rhymes with TIME or LIME" can't be said today.
- New searches.
  `is: proper`, `words: 3`, `ends with: " up"`, `contains: roman numeral` have no tool equivalent.
- One shareable line instead of several rows.

**Where it rubs:**
- **Highlights.**
  Each highlighting filter gets its own atom line, so marks from different tools never share a word.
  Several highlighting clauses in one query would land on one atom.
- **Tool options.**
  Match modes, Allow unlisted, Rhymes' Loose/Strict/Whole, Space out's Splits, Supervocalics' Y and Remove string's All/One would each need a spelling.
- **Overlaps.**
  `starts with` / `ends with` / quoted `" up"` duplicate Search's match modes, and `pattern:` competes with Umiaq's single-binding syntax.
- **Discoverability.**
  The gallery shows every tool with an icon and example; a text box shows nothing until typed into.
- **Complexity.**
  Grawlix already reads as complex next to Wordlisted, and some users have bounced off it.
  A query box could be gentler (one box) or harsher (syntax).

## Options

- **A. The Search bar speaks the language.**
  Bare text stays a wildcard pattern, so `c?t` still works.
  Filter tools become fields, and clicking a filter card inserts its clause instead of adding a row, teaching the syntax by example.
  The stack keeps transforms, groups and tuples.
- **B. The language is the pipeline,** with stages such as `rhymes with: time | head off: s | group by: anagram`.
  Most unified, but it replaces the tool UI and heads toward a programming language.
- **C. One engine, separate surfaces.**
  A shared predicate library behind rescore rules and tools, with no UI change.
- **D. A new tool** beside Search, Regex and Umiaq.
  Lowest risk and one gallery card, as Umiaq arrived, but a fourth search dialect.
  It could prove the idea out before A.

**Leaning A, on one condition: it must remove UI, not add it.**
If the query box arrives and the filter rows, the match-mode control and the invert button all stay, it is a third way to filter and complexity goes up.
It pays only if those collapse into the language: match modes into `starts with` / `ends with`, invert into `not`, perhaps the length filter into `length:`.

## Open questions

- Is the query box the front door for users who found Grawlix too complex, or a power-user layer?
- Should rescore rules get every field?
  `rhymes with:` in a rule would load the CMU dictionary while the merge builds, so rules probably get the cheap subset.
- Do highlights from several clauses share one atom line or keep one each?
- Is `pattern:` Search syntax or single-binding Umiaq?
- Tool slugs appear in shared links ([`design.md`](../design.md) § *Stable links*); which survive as aliases?
