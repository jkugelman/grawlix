# Umiaq

Umiaq is Grawlix's variable-and-pattern search — the one tool whose behavior changes shape with what you type, from an ordinary wildcard search up to a multi-word solver that combines separate words into a target.
This is the complete reference for the dialect.
It is the single source of truth for the Umiaq language; [How the tool runs](#how-the-tool-runs) covers how it is wired into the pipeline (the tuple tier, the search strategies, streaming), and [`manual.md`](manual.md) gives the short user-facing version.

The matcher is a JavaScript reimplementation written against [Umiaq](https://github.com/crosswordnexus/umiaq) (Alex Boisvert, Crossword Nexus, MIT) as the reference spec; the notation descends from [Qat](https://www.quinapalus.com/qat.html) (Mark Owen, Quinapalus), whose syntax and semantics aren't copyrightable.
Both are credited in the in-app Help.
Grawlix deliberately speaks its **own dialect** rather than copying theirs — see [How the dialect differs](#how-the-dialect-differs).

This file mixes what's implemented with what's planned, on purpose — it keeps everything about Umiaq in one place.
Planned items are marked **(planned)** inline and collected under [Roadmap](#roadmap); the comparison against the reference tools is under [Not yet supported](#not-yet-supported).

## The shape of a query

A query is a list of **clauses** separated by `;`, in any order.
Each clause is one of two kinds:

- A **binding** is a [pattern](#elements) matched against the wordlist.
  Its match becomes one word of the result, and it fixes ("binds") the variables it contains.
  `ABBA` is a binding.
- A **constraint** puts a condition on the variables without matching anything of its own — a length, an inequality, a sub-pattern.
  `|A|=3` is a constraint.

Every binding contributes one word to the output.
**One binding** filters the wordlist word by word, like an ordinary search — `ABBA` finds words whose halves mirror (NOON, DEED), landing in the normal entries table.
**Several bindings** make a **tuple search**: Umiaq finds *sets* of words that satisfy the shared variables together — `AB;BA` turns up pairs like APE / PEA where the same two chunks swap places, rendered as side-by-side lanes ([Systems and tuples](#systems-and-tuples)).
Umiaq reads its mode off the query itself — the number of bindings — so there is no toggle.

**Umiaq is the one case-sensitive tool.**
A capital letter is a variable; a lowercase letter is a literal.
So `cat` is the literal word CAT, while `CAT` is three variables.
A query made of letters, digits, and the syntax below matches each entry's **normalized form** (accents, spaces, and punctuation stripped, lowercased), so a variable binds the same normalized chunk across a word's spellings.
A query that carries a **space, a backslash escape, or a letter outside ASCII** matches the entry's **spelling** instead — see [Spelling](#spelling-spaces-punctuation-and-capitals).

## Elements

The building blocks of a pattern:

| Element | Matches |
|---|---|
| `a`–`z`, `0`–`9` | that literal character |
| `?` | any one letter or digit |
| `*` | any run of characters, including none |
| `#` | any consonant |
| `@` | any vowel |
| `[abc]` | any one of a, b, c |
| `[^abc]` | any one character *except* a, b, c |
| `[l-p]` | a range — any one of l, m, n, o, p |
| `A`–`Z` | a **variable** (see below) |
| `~A` | the reverse of variable A |
| a space | a spelled space; switches the query to [spelling matching](#spelling-spaces-punctuation-and-capitals) |
| `\.`, `\-`, `\'` … | that literal mark; a backslash makes any punctuation mark or space literal |
| `\A`–`\Z` | that literal capital, matched case-sensitively |

**Y is a vowel.**
`@` matches it and `#` does not — matching upstream Umiaq, OneLook, and Ingrid.
These are Grawlix's shared search-bar classes, so `#`, `@`, and `[…]` behave identically here and in the search bar.

## Spelling: spaces, punctuation, and capitals

A query has two possible **arms**, and takes exactly one.
A query of letters, digits, and syntax matches the **normalized form**, the way Search's first arm does.
A query containing a space, a backslash escape, or a letter outside ASCII takes the **spelling arm**: every binding matches the entry as spelled, case-insensitively.
`* *` keeps only entries written with a space; `A B;B A` finds two-word phrases whose words swap (PEANUT BUTTER / BUTTER PEANUT); `A B;AB` pairs a phrase with its run-together spelling (THE IRS / THEIRS); `u\.s\.` matches a spelled abbreviation.

The arm is chosen once per query because neither arm can add a match the other finds.
The normalized form holds no separators, so a query with a space can never match it; and a query without one gains nothing from spelling, because `?`, `#`, `@`, and `[…]` take a letter or digit only, never a separator.
So nothing runs twice.

On the spelling arm:

- `?` and `[…]` match one letter or digit from any script, never a separator; `#` and `@` are the shared consonant and vowel sets, so an accented letter is neither.
  `*` and variables match any run, separators included, so `A B` on ROCK AND ROLL binds A to ROCK or ROCK AND.
  A variable binds the same spelled chunk everywhere it appears, so THE IRS and THE-IRS are different chunks.
  In a term target (`AB=c?t`) `?` and a class stand for `a`–`z` and digits, since the target is generated, not matched.
- A lowercase literal matches either case.
  An **escaped capital** (`\N\A\S\A`) matches only that capital as written, and is allowed only in a binding.
  Grawlix keeps an entry's case only where it departs from its wordlist's convention, so on an all-caps list an escaped capital finds nothing.
- Letters and digits from any script are bare literals: `café` matches CAFÉ and not CAFE, exactly as in Search.
- An anagram bag holds letters and digits, so a spaced spelling never rearranges into it.
- **Lengths count letters and digits**, the Length column's measure.
  `|A|`, `|AB|=n`, `|A|=|B|`, the `7:` prefix, and a sub-pattern's length all ignore spaces and punctuation, so `6:A B` finds THE IRS.
- A tuple query reduces its pool to one entry per **folded spelling** (see [One spelling per norm in a tuple](#one-spelling-per-norm-in-a-tuple)).

**Escapes.**
A backslash makes the next character a literal: `u\.s\.`, `rock\-n\-roll`, `a\;b`, `A\ B`.
Every character that is not a letter, digit, or space and not part of the syntax is **reserved**, and errors with a hint to escape it, so the syntax can grow without changing the meaning of an old query.
`\` before a lowercase letter or digit is an error too, which keeps a pasted regex escape (`\s`, `\d`) from silently meaning a letter.
A trailing `\` is an error.

**Whitespace is never ignored.**
Spaces at the ends of the query and around `;` are trimmed.
A space inside a constraint (`|A| >= 3`), inside a length prefix (`7 :`), touching an operator (`A = #@#`), or inside `|…|` is an error.

## Anagram — `/letters`

A pattern that begins with `/` is an **anagram**: it matches any rearrangement of the letters that follow.
`/triangle` finds every word whose letters are exactly a permutation of `triangle`.
The `/` reinterprets the whole body as an unordered bag of letters — unlike the rest of Umiaq's syntax, which is positional.

`?` and `*` inside the bag loosen the exact anagram into a "must contain these letters" search, and a [character class](#elements) pins one slot to a set of letters:

- `/act` — exactly an anagram of A, C, T (CAT, ACT).
- `/act?` — those three letters plus one more of anything (four-letter words that contain A, C, T).
- `/act*` — those three letters plus any number more (TACTIC, ACROBAT).
- `/[abcd]efg` — E, F, G plus one letter drawn from a, b, c, d.
- `/#at` — A, T plus one consonant (BAT, CAT, HAT); `@`, `[^…]`, and ranges (`[l-p]`) fill a slot the same way.
- `8:/tral*` — a [length prefix](#length-prefix) caps the whole word: eight-letter words containing T, R, A, L.

The bag holds letters, digits, `?`, `*`, and the shared character classes (`#`, `@`, `[…]`) — each class filling exactly one slot; only variables can't appear inside it.
An anagram works as a binding (contributing a word to the result) and as a [sub-pattern](#sub-pattern--apattern-and-apattern) body (`A=/lilac` requires A to be an anagram of LILAC; `A=/[abcd]efg` an anagram with a constrained slot).
As a [term-equals](#term-equals--abword-and-abword) target (`AB=/random` finds two words whose letters together rearrange to RANDOM) the bag stays plain — `?`, `*`, and character classes aren't supported there.

## Variables

A capital letter `A`–`Z` is a **variable**: it stands for a run of characters that must come out **the same everywhere it appears** — within one word and across the whole query.
This cross-word consistency is what a plain regex can't express, and it's the heart of Umiaq.

- `AA` → doubled words (MAMA, TUTU): A is the same chunk both times.
- `ABBA` → A and B each repeat, mirrored.
- `AB;BA` → A and B are shared *between* the two words, so the pair swaps the same two chunks.

A variable binds **at least one character** by default; it can bind the empty string only if you opt in (see [Zero-length](#zero-length)).
`~A` is variable A reversed — `A~A` finds even-length palindromes (A binds the first half, `~A` requires its reverse as the second).

## Terms

A **term** is a sequence of variables, reversed variables (`~A`), and literals — `A`, `AB`, `AxB`, `~A`, `boardroom`.
A term is the left-hand side of the length and match operators below; the operator acts on the string the term spells out once its variables are bound, a reversed variable contributing the reverse of its binding.
Thinking of that left side as one thing — a term — is what makes the operators uniform: both the length operator `|…|` (`|AxB|`) and the match operators `=` / `!=` (`AB=boardroom`) take a full term.
Reversal reaches only the match operators, though: a length can't tell a chunk from its reverse, so `|~A|` is rejected rather than silently reading as `|A|`.

## Constraints

A **constraint** conditions the variables without contributing a word to the result — the counterpart to a binding, whose match *is* one of the result words.
A constraint can name any variable that appears in a binding, and it applies across the whole query.

### Length — `|term| op n` and `|term| op |term|`

`|A|=5` pins A to five characters.
The comparisons `<`, `<=`, `>`, `>=` bound it (`|A|>=3`, `|A|<5`), and two of them intersect into a range (`|A|>=2;|A|<=5`).
A term of more than one element sums: `|AB|=9` means A and B's lengths total nine, and `|AxB|=9` counts the literal too (`|A|` + 1 + `|B|`).
The term may hold only variables and literals — a wildcard like `|A*|` has no fixed length and is rejected.
Multi-element terms are checked at the tuple join, so they hold even when the variables live in different bindings.

`=` also takes a **range**, in the same syntax used for score ranges, the Length filter, and the [length prefix](#length-prefix): `|A|=8-9` (eight or nine), `|A|=10+` (ten or more), `|A|=0-6` (up to six).
`|AB|=8-9` ranges the sum the same way, and `|A|=0+` is a compact way to declare a [zero floor](#zero-length).
A range is shorthand for the two comparisons it stands for, so it intersects with them like any other bound (`|A|=2-8;|A|<=5` is 2 to 5).
Only `=` takes one — `|A|>=3-5` is meaningless and rejected, and so is `|A|!=3-5`.
The open end of a range is always spelled out (`0-9`, `10+`), never as a bare `-9`, so a range can never be misread as a negative number.

The right side can be **another term** instead of a number: `|A|=|B|` requires A and B to bind equal-length chunks, `|AB|<|CD|` compares two sums, and all six operators (`=`, `!=`, `<`, `<=`, `>`, `>=`) work on either shape.
`!=` also takes a number — `|A|!=3` excludes a length.
Unlike the numeric `=`/`<`/`…` forms, which narrow a variable's search window, a relational comparison and `|A|!=n` are pure filters — neither side is fixed, so they only prune at the tuple join, holding across bindings the same way a multi-element `|AB|=9` does.

#### Every variable — `|*|` and `|A-C|`

The left side may name a **span of variables** instead of a term.
`|*|>=0` applies the constraint to every variable; `|A-C|>=0` applies it to A, B, and C. `|*|` is exactly sugar for `|A-Z|`.

A span is a macro: `|*|>=0` means the same as writing `|A|>=0;|B|>=0;…` yourself, and intersects with the other clauses exactly as those would.
Clause order stays irrelevant, and a narrower clause elsewhere simply intersects — `|*|=3-5;|B|>=2` leaves B at 3 to 5, the looser `>=2` changing nothing.

A span creates no exceptions.
`|*|=3;|B|=5` asks for a variable that is both three and five characters, and is rejected as `|*|=3 conflicts with |B|=5` — errors quote the clauses as you typed them, spans included.
Write the per-variable clauses out when one variable should differ.

A span covers its whole letter range, so a variable added to a query that already carries `|*|` picks the constraint up.
Spans work only on a length constraint, and only on the left: `|A|=|*|` is rejected.

### Zero-length

A variable binds at least one character unless some clause explicitly gives it a **minimum of zero**: `|A|>=0` (empty or longer), `|A|=0` (forced empty), `|A|=0+` or `|A|=0-6` (a range starting at zero), or a sub-pattern that starts at zero — `A=*`, `A=0-6:*`.
An upper bound on its own (`|A|<=5`) declares no minimum, so the floor stays.
`|*|>=0` frees every variable at once.

That floor is what keeps a variable meaning *a chunk*.
Let one vanish and its binding collapses into a weaker one: with A empty, `AB;BA` reads as `B;B` and answers every word W in the wordlist with the degenerate tuple (W, W), burying the APE / PEA pairs the query was for.

It also quietly costs you the edge cases, which is the trap to know about.
`AtenB;AB` — words that survive deleting a TEN — silently misses TENOR and MITTEN, where the TEN sits flush against an edge and A or B would have to be empty.
The result set looks perfectly plausible; nothing in it says a floor hid the rest.
`AtenB;AB;|*|>=0` is the version that reaches them, and `AaB;AeB;AiB;AoB;AuB;|*|>=0` is the same shape — sets of words differing only in a vowel, which can appear in leading and trailing positions too.
Reaching for `|*|>=0` whenever a query looks suspiciously thin is the habit worth having.

### Sub-pattern — `A=pattern` and `A!=pattern`

`A=#@#` requires whatever A binds to itself match a sub-pattern — here a consonant-vowel-consonant.
The body is any non-variable pattern and may carry a [length prefix](#length-prefix): `A=2-4:*` (2–4 of anything), `A=??s` (ends in s), `A=*z*` (contains z), `A=??[rz]` (three letters ending r or z).
It may also be an [anagram](#anagram--letters): `A=/lilac` requires A to be a rearrangement of LILAC.

`A!=#@#` is the negation: A must *not* fit the sub-pattern.
Positive and negative compose — `A=*s;A!=???` reads "ends in s but isn't a bare three-letter string."
A sub-pattern body can't contain variables (`A=B?` is an error).

Reversing the left side turns the test around: `~A=#@#` requires *reverse(A)* to be a consonant-vowel-consonant (equivalently, A read backwards fits the pattern), and `~A=??s` — reverse(A) ends in s — matches a three-letter A that *begins* with s.
It stays a filter, never an expansion, so a wide `~A=????` is just a length check, not the term-equals "too broad".

### Term equals — `AB=word` and `AB!=word`

When the left side of `=` is a **term of more than one element**, the clause is a **term-equals**: the string the term spells out, once its variables are bound, must equal the right-hand target.
`A;B;AB=boardroom` finds pairs of real words that concatenate to BOARDROOM — BOARD + ROOM, BOA + RDROOM, and so on.
A term-equals binds its variables and prunes the search but contributes no result word of its own, so every variable it names must also appear in a binding.
The term's own variables may be reversed: `A;B;A~B=board` requires A followed by the reverse of B to spell BOARD (BO + reverse of DRA).

The target is a literal (`boardroom`), a fixed-width pattern (`b?ard?oom`, `bo[oa]t`), or an [anagram](#anagram--letters): `AB=/random` finds two words whose letters together rearrange to RANDOM.
When each variable is its own word (`A;B;AB=/…`, `A;B;C;ABC=/…`), the target can be any length — Grawlix splits it the way a multi-word anagram finder does, matching the corpus against the target's letters rather than enumerating rearrangements.
More unusual shapes (a variable that is only part of a word, or a binding the term-equals doesn't name) fall back to enumerating rearrangements, so those need a short target.
An unbounded `*` on the right is [not yet supported](#not-yet-supported).
`AB!=boardroom` is the negation — a **term-not-equals**, dropping any tuple whose term spells the target.
A single-variable left side against a fixed target stays a sub-pattern (`A=#@#`); a right side that is *itself a term* — one that names a variable — makes the clause a [term comparison](#term-comparison--abcd-and-ab) instead (`AB=CD`, `AB=C`), which filters rather than drives.

### Term comparison — `AB=CD` and `A!=B`

When the right side of `=` or `!=` is **itself a term** — variables, reversed variables (`~A`), and literals, naming at least one variable — the clause compares the two strings the terms spell once their variables are bound.
`AB=CD` holds when A followed by B spells the same as C followed by D; `AB!=CD` when they differ.
The single-variable cases are the same rule at one element: `A=B` forces two variables equal, `A!=B` forces them apart, and comparing a variable against its own reverse — `A=~A`, `A!=~A` — selects or rejects palindromes (`A=~B` pairs a word with its reversal).
Every variable named must appear in a binding, and the comparison fixes nothing — both sides are open — so it prunes at the tuple join and holds across bindings, exactly the way a relational `|A|=|B|` does.
Only `=` and `!=` compare terms (the length form `|term|` keeps all six operators); inequality stays pairwise (`A!=B;A!=C`, not `A!=B!=C` or an ordered `A<B<C`).

This is the overloading of `=`/`!=` on their right side: a term — a variable, or a longer run of variables and literals — means *compare two terms*, while a fixed target means *match one*.
So `A=B` compares whereas `A=#@#` is a [sub-pattern](#sub-pattern--apattern-and-apattern), and `AB=CD` compares whereas `AB=boardroom` is a [term-equals](#term-equals--abword-and-abword).
Mixing a variable with a wildcard (`A=B?`) is neither a term nor a fixed target, and is rejected.

### Length prefix

A pattern may carry a leading length range, in the same syntax used for score and length ranges elsewhere in Grawlix: `7:x*a` (exactly 7), `7-9:x*a` (7 to 9), `0-6:x*a` (up to 6), `10+:x*a` (10 or more).
On a binding it caps the whole matched word; inside a sub-pattern (`A=2-4:*`) it caps the variable's length.

## Systems and tuples

Two or more bindings make a **system** that Umiaq solves at once, finding tuples of words that satisfy the shared variables together.
`AB;BA` finds pairs like APE / PEA; each tuple renders as a row of side-by-side lanes, one word per binding.

Tuples are **positional**: APE / PEA and PEA / APE are different rows.
Each variable gets its own color, the same color in every lane, so you can see at a glance how the shared chunks line up between the words.
A single-binding query has arity 1 and renders as an ordinary flat search; a query with N bindings produces N-lane tuples.

## How the dialect differs

Grawlix speaks its own dialect.
Reusing Grawlix's search syntax and range conventions rather than Qat/Umiaq's own notation is a deliberate consistency-over-fidelity call — the reference notation is known to few constructors, and matching the rest of the app is worth more than fidelity to it.
The consequences, especially for anyone pasting a pattern from Qat or CopyQat:

- **Any-character is `?`, not `.`.**
  Every punctuation mark outside the syntax is reserved, so a pasted `.` errors, with a hint to write `\.` for a literal dot.
- **A space is a literal.**
  Qat and upstream Umiaq ignore spaces inside a pattern; their dictionaries carry none.
  Grawlix's wordlists do, so `A B` is two words and `AB` is one string ([Spelling](#spelling-spaces-punctuation-and-capitals)).
  Spaces around `;` still trim away.
- **Backslash escapes.**
  Neither reference tool has an escape.
  Grawlix spells a literal punctuation mark, space, or capital as `\x`, and treats a backslash before a lowercase letter or digit as an error, so a pasted regex escape fails loudly.
- **Negation is `[^abc]`, not `[!abc]`.**
  A class body takes letters, digits, `#`, `@`, a leading `^`, and a range dash, so a pasted `[!abc]` is an invalid class.
- **Digits are literals**, not Qat's "repeated any-letter" placeholders (`l0v0` is the literal string, not "same letter twice").
  Variables cover that use.
- **Lengths use the score-range syntax** (`10+`, `0-6`), not Qat's `10-` / `-6`.
  This applies both to the [length prefix](#length-prefix) (`10+:x*a`) and to a length constraint's right side (`|AB|=8-9`) — Nexus-Umiaq spells the latter the same way, so that one lines up, while `|AB|=8-` does not.
  Zero-length is `|A|>=0` or `|A|=0+`, not Qat's `|A|=0-`, and Grawlix also honors a zero-floor sub-pattern (`A=*`), which the reference tools don't.
  CopyQat goes the other way and has no zero-length escape at all.
- **A constraint can cover every variable at once** — `|*|>=0`, `|A-C|=3-5`.
  The reference tools have no equivalent; each variable must be named.
- **Sub-patterns take no parentheses** (`A=#@#`, not `A=(#@#)`).
  Upstream, parentheses distinguish a variable that must be a real *word* from one that is any *letter-sequence*; Grawlix has no word-form variable, so the parens would carry nothing.
- **Grawlix searches your merged wordlist**, not a bundled dictionary — a difference in kind, not a missing feature.

## Not yet supported

Things the reference tools do that Grawlix's dialect can't yet express.
Several are on the [Roadmap](#roadmap); a few are likely out of scope.

| Feature | Reference syntax | Where | Notes |
|---|---|---|---|
| **Subset anagram / letter bank** | `/(triangle)`, `//triangle` | Qat, CopyQat | The plain [anagram](#anagram--letters) `/word` ships; the subset `/(…)` and letter-bank `//…` variants don't yet. |
| **`*` in a term-equals RHS** | `AB=a*z` | — | The [term-equals](#term-equals--abword-and-abword) takes a literal or fixed-width target; an unbounded RHS needs generative solving, not the finite-pool path, and is reported as an error. |
| **`EXCLUDE` letters** | `A=(EXCLUDE:ds)` — A contains no d or s | CopyQat | A distinct keyword mechanism; its `:` also collides with the length-prefix colon. |
| **Multi-variable / ordered difference** | `!=ABCDEF` (all differ), `!=A<B<C` (ordered) | Qat | `A!=B` is pairwise only; no ordering. |
| **Dictionary-word tokens** | `>` any word, `<` any reversed word | Qat | No "this chunk must itself be a real word" token. |
| **Boolean pattern algebra** | `p & q`, `p \| q`, `!p`, `(…)` grouping | Qat | Grawlix's `!=` is variable/sub-pattern negation, not full pattern algebra. |
| **Neighbor / misprint** | `` `bonge ``, `` ?`str.g.ly `` | Qat, CopyQat | One-substitution search. |
| **Subsequence / consonantcy** | `->:word`, `<-:word`, `#>:akron` | CopyQat | Hidden-word and shared-skeleton searches. |
| **Qategories (semantic)** | `{def:color}`, `{hyper:agate}` | Qat | Needs external WordNet/thesaurus/Wikipedia data; likely out of scope. |

## Roadmap

With [anagram](#anagram--letters) shipped — `/word` as a binding and `A=/word` as a sub-pattern — the notation covers ordinary wildcards, variables, terms, the [term-equals](#term-equals--abword-and-abword) `AB=boardroom`, [term-vs-term comparison](#term-comparison--abcd-and-ab) (`AB=CD`, `A!=B`), and rearrangement.
What's left:

1. **Anagram flavors** — subset `/(…)` (an anagram of *some* of the letters) and letter bank `//…` (each letter reusable).
   The plain anagram shipped; these two variants build on it.
2. **`EXCLUDE`** — small, but wants a spelling that avoids the length-prefix colon.
3. **Longer tail:** neighbor/misprint, subsequence, consonantcy, n-ary/ordered difference (`!=ABCDEF`, `!=A<B<C`), `*` in a term-equals RHS, dictionary-word tokens, boolean algebra.
   Qategories need external data and are likely out of scope.


## How the tool runs

**One polymorphic tool, escalating on the semicolon.**
A query with no `;` is a per-word filter; a query with one or more `;` is a multi-word **tuple search**.
The tool reads its own kind off the query's *structure* — `;` presence and pattern count — not a flag or toggle param, so one box escalates from filter to tuple search on its own rather than splitting the language across two gallery cards the user has to choose between.
A single-binding query lands in the ordinary flat tier, indistinguishable from a search (for free); only the tuples need a new tier.

**Two arms, one per query.**
The tool declares `matchOn: 'both'` and the parser picks the arm: a query carrying a space, an escape, or a non-ASCII character runs against the entry's *spelling*, otherwise against norm (§ *Spelling* has the semantics and the argument for why neither arm can add a match the other finds).
The spelling arm matches a length-preserving case fold of `displayOf(entry)` (`foldedDisplayOf`, `engine/norm.js`), so match positions are display coordinates and the tool's highlights ship tagged `coord: 'display'`, which the packed record join stores as one bit per range.
An escaped capital is verified against the original spelling after the fold-insensitive match (`caseOK`), by re-running the assignment as a regex with case built in, because a `*` can settle on several placements and only one may put the capital where it is written.
The tuple solver runs unchanged over a **shim pool** whose `norm` field is the folded spelling, carrying the entry's letter count for the length prefix and a back-pointer to the real entry, which the emitting lanes unwrap.
Two shapes skip the index paths there and take the exhaustive bucket join: a partner binding holding `?` or a class, because the probe path enumerates candidates over the norm alphabet and can't spell the accented letter the matcher accepts; and a query with an escaped capital, because the index maps resolve one entry per folded key and would hide the correctly cased variant before the case check runs.
Tuple group keys are the lanes' spellings joined by `\0`, so two spellings of one norm stay distinct tuples, and the group and record comparators tiebreak on those keys in **code-unit order**: ICU collation ignores `\0`, so `localeCompare` would tie `a\0bc` with `ab\0c` and the streamed order would stop being total.

**Arity: the tuple tier.**
A tuple — `AB;BA` → (APE, PEA) — is a result shape the pipeline doesn't otherwise produce, and the model that absorbs it is *arity*: every row is N lanes wide (the tuple's members, side by side) by M atoms deep (the chain, [`pipeline.md`](pipeline.md) § *The chain-row model*).
The result's **`laneKind`** names how a row's lanes relate — `single` (one lane, the ordinary row), `set` (a group cluster's trimmable equivalence-class lanes), or `record` (a tuple's fixed positional lanes) — and rendering keys off it, **not tool kind**: a `single` result is the flat/chain tier (one entry per row, full columns — which is why a single-binding Umiaq query renders as a plain search for free), and a `record` is the **tuple tier** — bare fixed-N lanes, no key/anchor/columns and, unlike a `set` group row, never a `+N more` chip, because every lane of a *solution* must show (a record is positional, so APE/PEA and PEA/APE are distinct rows; and where the score range may trim a member out of a `set`, a `record` drops whole — a missing lane would render it below its arity).
This generalizes the group-row model rather than adding a fourth thing beside it, and the generalization reaches every system that assumed the chain-vs-group split: the sort-tier classifier gains a tuple tier; stats and the histogram count **each lane's** score; export grows a per-tuple shape (`entry_1..entry_N` plus per-lane length/score/comment/source in CSV, a `tuples` array in JSON); and EntryPanel routing is unchanged, since a tuple's lanes are whole corpus entries — only the tuple as a whole is synthetic — so an atom click edits the underlying entry the usual way.

**Umiaq picks one of three strategies off the query's shape.**
It is buffered-in, streamed-out ([`pipeline.md`](pipeline.md) § *Streaming results*): once the candidate pool is fixed, every consistent tuple is final.
The bindings are ordered driver-first — the one that binds the **most variables** leads, the rest following by shared-variable overlap.
When the driver binds *every* query variable and the remaining bindings are finitely enumerable (their free-position expansion stays under `PROBE_CANDIDATE_CAP`), the search takes the **probe path**: stream the driver's matching words, compute each partner binding's required spelling from the driver's assignment, and probe the corpus's norm index for it — **exhaustive over the corpus, uncapped.**
When the driver *lacks* a variable but the query chains through word-edge affixes, the **affix path** (below) grounds the missing variables by index range scans — also exhaustive.
Everything else — disjoint variable sets (`AB;CD`), an *infix* free variable (`AXB`), a `*` or anagram in a non-driver binding — falls back to the **bucket path**: a multi-way hash join that buckets every binding's matches by the shared assignments and walks them, bounded at `maxMatchesPerPattern` and reporting `truncated` when it trims.
`findTuples` keeps `truncated` distinct from `capped` (the probe and affix paths are exhaustive, so they can hit the result ceiling — `capped` — while never truncating), but the executor **folds them into `capped`** for the UI: both mean the shown count is a floor, so a trimmed run renders the tuple count with a trailing **`+`** (hover: "Results incomplete"), the same "there are more than shown" marker either cause uses, and is never presented as the complete answer.
The bucket path is the honest floor for genuinely-unbounded shapes: the reference port (and Qat/Umiaq's own bucket-only architecture) silently drops results once the cap bites — it only *looks* complete because its wordlist is score-sorted, so the cap happens to keep the best words — whereas the probe and affix paths are strict supersets for the queries they cover, same results with no truncation, so only the shapes no index can bound reach the bucket path (now honestly flagged).
(Per-word matching memoizes its enumerated assignments only when a binding has `≥ 2` stars, the one case where distinct match paths reconverge; memoizing every word otherwise is pure overhead.)
The join's participants are **solvers**, not just bindings: a positive **term-equals** (`AB=boardroom`, § Umiaq in [`manual.md`](manual.md)) joins the very same machinery as an extra *non-emitting* solver — its pattern is the term, its pool the right-hand target expanded into concrete strings — so it binds and prunes like any driver but contributes no lane, which is what keeps `A;B;AB=boardroom` off the full `A`×`B` cross-product.

**The affix path indexes chained-affix queries.**
The bucket path's weakness is the *chained* query where no single binding binds every variable but each variable sits at a word edge — `AandB;X;AX;XB` (a phrase `A and B` and a word `X` such that `AX` and `XB` are also words: cock and bull · pit · cockpit · pitbull) — where the bucket join matches a free-affix binding (`AX`, two free variables) against the whole corpus in every split, explodes, and truncates the answer away.
The affix path plans an order in which each non-driver binding either is fully ground by earlier bindings (an O(1) norm probe) or grounds its **one** free variable by an index **range scan**: a binary-search span of the norm-sorted corpus for a bound *prefix* (`AX`, `X` trailing), or of a **per-run reversed-norm index** for a bound *suffix* (`XB`, `X` leading).
When a variable has both a prefix and a suffix introducer, the scan takes the **more selective side** (fewer words in its range) and verifies the other by lookup, bounding the enumeration tail regardless of which side of the driver pair is broad.
Because only the driver enumerates, the path is **exhaustive** — `truncated` stays false unless the *driver* itself overflows `maxMatchesPerPattern` — and the driver is enumerated **best-first by score**, so the sought tuple lands inside the retained-result cap instead of behind a wall of junk single-letter-variable tuples.
The well-constrained chain runs fully exhaustive: `AandB;X;AX;XB` finds ~113k tuples over the 750k-entry corpus with no truncation, cock-and-bull among the first few hundred emitted.
The reversed-norm index is **rebuilt per run, never cached on the corpus**: a My Edits splice mutates the corpus object in place, so a cached suffix index would go stale undetected (the path's sharpest correctness risk), sidestepped by paying its `O(n log n)` build only when a plan actually has a suffix scan.
`AB;CB` — the under-constrained shared-suffix query that is the bucket path's canonical explosion — doesn't explode here: the free-affix `CB` binding is resolved by a suffix scan rather than matched against the whole corpus, so results emit best-first; but an inherently under-constrained query like it still overflows the driver cap on a full corpus (`truncated`, honestly flagged), because its driver `AB` splits every word.
The affix path removes the *explosion*, not the fact that some queries are unbounded.
The affix path is contained in `umiaq.js` and transparent to the executor and the finished/prefix caches, which store executor state rather than the strategy.
**Pushing the score range into the join** (emitting only in-range tuples) was designed and deliberately *not* built: best-first driver emission already surfaces the high-value tuple inside the cap, and a score-push would de-key the finished-result cache ([`pipeline.md`](pipeline.md) § *Streaming results* — the cache key excludes the score range on purpose) and turn a range-widen into a re-run, cost the post-pipeline filter avoids.

**A memory ceiling, not a UX cap.**
The retained-tuple limit exists so the worker can keep every streamed tuple for the scroller to window the whole run — it is not a deliberate results cutoff.
It is **device-split**: `UMIAQ_CAP_MOBILE` (~100k) and `UMIAQ_CAP_DESKTOP` (~500k).
The cap is sized off the **eager** worst case — a measured ~0.9 KB per 4-lane tuple, so ~500k would be ~425 MB, exactly the jump that tips iOS's jetsam budget into a reload, hence the split.
The **common** tuple retains far less than that: its result is **index-packed** ([`pipeline.md`](pipeline.md) § *Streaming results* / [`worker-protocol.md`](worker-protocol.md)), a lane kept as a corpus index rather than a materialized atom object graph, so ~500k packs to tens of MB and the ceiling only ever binds a *non-packable* tuple (a downstream highlighting filter or an upstream transform, which keeps the eager per-tuple cost).
`main` picks the value from `isMobile()` and injects it into the worker via `configureUmiaq` (a `configTools` message sent on every worker spawn, FIFO-before the first run); the engine tool **defaults to the conservative mobile cap** so a worker that never hears the message — or the window before it arrives — under-retains rather than over-retaining, because the worker can't detect mobile itself (no `window.matchMedia`).
Within the ceiling, results stream until the corpus is exhausted or a newer run supersedes this one; a long run is something to watch accumulate, not to cut short.

**Composition.**
Umiaq's input is the *upstream working set*, defaulting to the full corpus when it runs first, so an upstream filter both scopes the query and shrinks (and speeds) the search, exactly like Search's input side.
A filter *downstream* of a tuple keeps the tuple if **any** lane matches — the group rule, chosen deliberately over a positional "all lanes must match".
It runs per-batch inside Umiaq's emit path, so the tuples stream already filtered ([`pipeline.md`](pipeline.md) § *Streaming results*).

## One spelling per norm in a tuple

A norm can carry several spellings (`eta`/`ETA`), and Umiaq matches on norm, so every spelling of one norm does identical work and then has to collapse.
Left to the strategies, each would collapse differently — the probe path would keep the first entry in pool order, the affix path would dedupe whole tuples by norm, and the bucket path would never collapse at all — so which spelling survives would depend on which strategy the planner happened to choose, an optimization decision the user never sees.

A query that emits a **tuple** reduces its pool to one entry per norm up front, picked by `preferRow` (`engine/corpus.js`) — the same rule that decides which spelling represents a norm everywhere else: highest score, then the shorter spelling, then code-unit order.
All three strategies see the canonical pool, so the strategies' norm-keyed dedupes are no-ops rather than tiebreakers, and the answer doesn't depend on the plan.

A **single** pattern is left alone and still shows every spelling, matching the entries table and every other tool.
The asymmetry is deliberate: a tuple is a combination, so preserving spellings there multiplies results (two spellings across two lanes is four tuples saying the same thing), while a single pattern lists entries and the spellings *are* the distinction.

On the [spelling arm](#spelling-spaces-punctuation-and-capitals) the pool reduces to one entry per **folded spelling** instead, so THE IRS and THEIRS are distinct lanes while THE IRS and THE irs collapse to the preferred one.
A query with an escaped capital keeps case variants apart, since case is what it distinguishes, and runs on the exhaustive bucket path so every variant is a candidate.
