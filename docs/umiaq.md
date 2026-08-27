# Umiaq

Umiaq is Grawlix's variable-and-pattern search — the one tool whose behavior changes shape with what you type, from an ordinary wildcard search up to a multi-word solver that combines separate words into a target. This is the complete reference for the dialect. It is the single source of truth for the Umiaq language; [`design.md`](design.md) covers how the tool is *wired* (the tuple tier, the search strategies, streaming), and [`manual.md`](manual.md) gives the short user-facing version.

The matcher is a JavaScript reimplementation written against [Umiaq](https://github.com/crosswordnexus/umiaq) (Alex Boisvert, Crossword Nexus, MIT) as the reference spec; the notation descends from [Qat](https://www.quinapalus.com/qat.html) (Mark Owen, Quinapalus), whose syntax and semantics aren't copyrightable. Both are credited in the in-app Help. Grawlix deliberately speaks its **own dialect** rather than copying theirs — see [How the dialect differs](#how-the-dialect-differs).

This file mixes what's implemented with what's planned, on purpose — it keeps everything about Umiaq in one place. Planned items are marked **(planned)** inline and collected under [Roadmap](#roadmap); the comparison against the reference tools is under [Not yet supported](#not-yet-supported).

## The shape of a query

A query is a list of **clauses** separated by `;`, in any order. Each clause is one of two kinds:

- A **binding** is a [pattern](#elements) matched against the wordlist. Its match becomes one word of the result, and it fixes ("binds") the variables it contains. `ABBA` is a binding.
- A **constraint** puts a condition on the variables without matching anything of its own — a length, an inequality, a sub-pattern. `|A|=3` is a constraint.

Every binding contributes one word to the output. **One binding** filters the wordlist word by word, like an ordinary search — `ABBA` finds words whose halves mirror (NOON, DEED), landing in the normal entries table. **Several bindings** make a **tuple search**: Umiaq finds *sets* of words that satisfy the shared variables together — `AB;BA` turns up pairs like APE / PEA where the same two chunks swap places, rendered as side-by-side lanes ([Systems and tuples](#systems-and-tuples)). Umiaq reads its mode off the query itself — the number of bindings — so there is no toggle.

**Umiaq is the one case-sensitive tool.** A capital letter is a variable; a lowercase letter is a literal. So `cat` is the literal word CAT, while `CAT` is three variables. Matching happens over each entry's normalized form (accents and spaces stripped, lowercased), so a variable binds the same normalized chunk across a word's spellings.

## Elements

The building blocks of a pattern:

| Element | Matches |
|---|---|
| `a`–`z`, `0`–`9` | that literal character |
| `?` | any one character |
| `*` | any run of characters, including none |
| `#` | any consonant |
| `@` | any vowel |
| `[abc]` | any one of a, b, c |
| `[^abc]` | any one character *except* a, b, c |
| `[l-p]` | a range — any one of l, m, n, o, p |
| `A`–`Z` | a **variable** (see below) |
| `~A` | the reverse of variable A |

**Y is a vowel.** `@` matches it and `#` does not — matching upstream Umiaq, OneLook, and Ingrid. These are Grawlix's shared search-bar classes, so `#`, `@`, and `[…]` behave identically here and in the search bar.

## Anagram — `/letters`

A pattern that begins with `/` is an **anagram**: it matches any rearrangement of the letters that follow. `/triangle` finds every word whose letters are exactly a permutation of `triangle`. The `/` reinterprets the whole body as an unordered bag of letters — unlike the rest of Umiaq's syntax, which is positional.

`?` and `*` inside the bag loosen the exact anagram into a "must contain these letters" search, and a [character class](#elements) pins one slot to a set of letters:

- `/act` — exactly an anagram of A, C, T (CAT, ACT).
- `/act?` — those three letters plus one more of anything (four-letter words that contain A, C, T).
- `/act*` — those three letters plus any number more (TACTIC, ACROBAT).
- `/[abcd]efg` — E, F, G plus one letter drawn from a, b, c, d.
- `/#at` — A, T plus one consonant (BAT, CAT, HAT); `@`, `[^…]`, and ranges (`[l-p]`) fill a slot the same way.
- `8:/tral*` — a [length prefix](#length-prefix) caps the whole word: eight-letter words containing T, R, A, L.

The bag holds letters, digits, `?`, `*`, and the shared character classes (`#`, `@`, `[…]`) — each class filling exactly one slot; only variables can't appear inside it. An anagram works as a binding (contributing a word to the result) and as a [sub-pattern](#sub-pattern--apattern-and-apattern) body (`A=/lilac` requires A to be an anagram of LILAC; `A=/[abcd]efg` an anagram with a constrained slot). As a [term-equals](#term-equals--abword-and-abword) target (`AB=/random` finds two words whose letters together rearrange to RANDOM) the bag stays plain — `?`, `*`, and character classes aren't supported there.

## Variables

A capital letter `A`–`Z` is a **variable**: it stands for a run of characters that must come out **the same everywhere it appears** — within one word and across the whole query. This cross-word consistency is what a plain regex can't express, and it's the heart of Umiaq.

- `AA` → doubled words (MAMA, TUTU): A is the same chunk both times.
- `ABBA` → A and B each repeat, mirrored.
- `AB;BA` → A and B are shared *between* the two words, so the pair swaps the same two chunks.

A variable binds **at least one character** by default; it can bind the empty string only if you opt in (see [Zero-length](#zero-length)). `~A` is variable A reversed — `A~A` finds even-length palindromes (A binds the first half, `~A` requires its reverse as the second).

## Terms

A **term** is a sequence of variables, reversed variables (`~A`), and literals — `A`, `AB`, `AxB`, `~A`, `boardroom`. A term is the left-hand side of the length and match operators below; the operator acts on the string the term spells out once its variables are bound, a reversed variable contributing the reverse of its binding. Thinking of that left side as one thing — a term — is what makes the operators uniform: both the length operator `|…|` (`|AxB|`) and the match operators `=` / `!=` (`AB=boardroom`) take a full term. Reversal reaches only the match operators, though: a length can't tell a chunk from its reverse, so `|~A|` is rejected rather than silently reading as `|A|`.

## Constraints

A **constraint** conditions the variables without contributing a word to the result — the counterpart to a binding, whose match *is* one of the result words. A constraint can name any variable that appears in a binding, and it applies across the whole query.

### Length — `|term| op n` and `|term| op |term|`

`|A|=5` pins A to five characters. The comparisons `<`, `<=`, `>`, `>=` bound it (`|A|>=3`, `|A|<5`), and two of them intersect into a range (`|A|>=2;|A|<=5`). A term of more than one element sums: `|AB|=9` means A and B's lengths total nine, and `|AxB|=9` counts the literal too (`|A|` + 1 + `|B|`). The term may hold only variables and literals — a wildcard like `|A*|` has no fixed length and is rejected. Multi-element terms are checked at the tuple join, so they hold even when the variables live in different bindings.

`=` also takes a **range**, in the same syntax used for score ranges, the Length filter, and the [length prefix](#length-prefix): `|A|=8-9` (eight or nine), `|A|=10+` (ten or more), `|A|=0-6` (up to six). `|AB|=8-9` ranges the sum the same way, and `|A|=0+` is a compact way to declare a [zero floor](#zero-length). A range is shorthand for the two comparisons it stands for, so it intersects with them like any other bound (`|A|=2-8;|A|<=5` is 2 to 5). Only `=` takes one — `|A|>=3-5` is meaningless and rejected, and so is `|A|!=3-5`. The open end of a range is always spelled out (`0-9`, `10+`), never as a bare `-9`, so a range can never be misread as a negative number.

The right side can be **another term** instead of a number: `|A|=|B|` requires A and B to bind equal-length chunks, `|AB|<|CD|` compares two sums, and all six operators (`=`, `!=`, `<`, `<=`, `>`, `>=`) work on either shape. `!=` also takes a number — `|A|!=3` excludes a length. Unlike the numeric `=`/`<`/`…` forms, which narrow a variable's search window, a relational comparison and `|A|!=n` are pure filters — neither side is fixed, so they only prune at the tuple join, holding across bindings the same way a multi-element `|AB|=9` does.

#### Every variable — `|*|` and `|A-C|`

The left side may name a **span of variables** instead of a term. `|*|>=0` applies the constraint to every variable; `|A-C|>=0` applies it to A, B, and C. `|*|` is exactly sugar for `|A-Z|`.

A span is a macro: `|*|>=0` means the same as writing `|A|>=0;|B|>=0;…` yourself, and intersects with the other clauses exactly as those would. Clause order stays irrelevant, and a narrower clause elsewhere simply intersects — `|*|=3-5;|B|>=2` leaves B at 3 to 5, the looser `>=2` changing nothing.

A span creates no exceptions. `|*|=3;|B|=5` asks for a variable that is both three and five characters, and is rejected as `|*|=3 conflicts with |B|=5` — errors quote the clauses as you typed them, spans included. Write the per-variable clauses out when one variable should differ.

A span covers its whole letter range, so a variable added to a query that already carries `|*|` picks the constraint up. Spans work only on a length constraint, and only on the left: `|A|=|*|` is rejected.

### Zero-length

A variable binds at least one character unless some clause explicitly gives it a **minimum of zero**: `|A|>=0` (empty or longer), `|A|=0` (forced empty), `|A|=0+` or `|A|=0-6` (a range starting at zero), or a sub-pattern that starts at zero — `A=*`, `A=0-6:*`. An upper bound on its own (`|A|<=5`) declares no minimum, so the floor stays. `|*|>=0` frees every variable at once.

That floor is what keeps a variable meaning *a chunk*. Let one vanish and its binding collapses into a weaker one: with A empty, `AB;BA` reads as `B;B` and answers every word W in the wordlist with the degenerate tuple (W, W), burying the APE / PEA pairs the query was for.

It also quietly costs you the edge cases, which is the trap to know about. `AtenB;AB` — words that survive deleting a TEN — silently misses TENOR and MITTEN, where the TEN sits flush against an edge and A or B would have to be empty. The result set looks perfectly plausible; nothing in it says a floor hid the rest. `AtenB;AB;|*|>=0` is the version that reaches them, and `AaB;AeB;AiB;AoB;AuB;|*|>=0` is the same shape — sets of words differing only in a vowel, which can now appear in leading and trailing positions too. Reaching for `|*|>=0` whenever a query looks suspiciously thin is the habit worth having.

### Sub-pattern — `A=pattern` and `A!=pattern`

`A=#@#` requires whatever A binds to itself match a sub-pattern — here a consonant-vowel-consonant. The body is any non-variable pattern and may carry a [length prefix](#length-prefix): `A=2-4:*` (2–4 of anything), `A=??s` (ends in s), `A=*z*` (contains z), `A=??[rz]` (three letters ending r or z). It may also be an [anagram](#anagram--letters): `A=/lilac` requires A to be a rearrangement of LILAC.

`A!=#@#` is the negation: A must *not* fit the sub-pattern. Positive and negative compose — `A=*s;A!=???` reads "ends in s but isn't a bare three-letter string." A sub-pattern body can't contain variables (`A=B?` is an error).

Reversing the left side turns the test around: `~A=#@#` requires *reverse(A)* to be a consonant-vowel-consonant (equivalently, A read backwards fits the pattern), and `~A=??s` — reverse(A) ends in s — matches a three-letter A that *begins* with s. It stays a filter, never an expansion, so a wide `~A=????` is just a length check, not the term-equals "too broad".

### Term equals — `AB=word` and `AB!=word`

When the left side of `=` is a **term of more than one element**, the clause is a **term-equals**: the string the term spells out, once its variables are bound, must equal the right-hand target. `A;B;AB=boardroom` finds pairs of real words that concatenate to BOARDROOM — BOARD + ROOM, BOA + RDROOM, and so on. A term-equals binds its variables and prunes the search but contributes no result word of its own, so every variable it names must also appear in a binding. The term's own variables may be reversed: `A;B;A~B=board` requires A followed by the reverse of B to spell BOARD (BO + reverse of DRA).

The target is a literal (`boardroom`), a fixed-width pattern (`b?ard?oom`, `bo[oa]t`), or an [anagram](#anagram--letters): `AB=/random` finds two words whose letters together rearrange to RANDOM. When each variable is its own word (`A;B;AB=/…`, `A;B;C;ABC=/…`), the target can be any length — Grawlix splits it the way a multi-word anagram finder does, matching the corpus against the target's letters rather than enumerating rearrangements. More unusual shapes (a variable that is only part of a word, or a binding the term-equals doesn't name) fall back to enumerating rearrangements, so those need a short target. An unbounded `*` on the right is [not yet supported](#not-yet-supported). `AB!=boardroom` is the negation — a **term-not-equals**, dropping any tuple whose term spells the target. A single-variable left side against a fixed target stays a sub-pattern (`A=#@#`); a right side that is *itself a term* — one that names a variable — makes the clause a [term comparison](#term-comparison--abcd-and-ab) instead (`AB=CD`, `AB=C`), which filters rather than drives.

### Term comparison — `AB=CD` and `A!=B`

When the right side of `=` or `!=` is **itself a term** — variables, reversed variables (`~A`), and literals, naming at least one variable — the clause compares the two strings the terms spell once their variables are bound. `AB=CD` holds when A followed by B spells the same as C followed by D; `AB!=CD` when they differ. The single-variable cases are the same rule at one element: `A=B` forces two variables equal, `A!=B` forces them apart, and comparing a variable against its own reverse — `A=~A`, `A!=~A` — selects or rejects palindromes (`A=~B` pairs a word with its reversal). Every variable named must appear in a binding, and the comparison fixes nothing — both sides are open — so it prunes at the tuple join and holds across bindings, exactly the way a relational `|A|=|B|` does. Only `=` and `!=` compare terms (the length form `|term|` keeps all six operators); inequality stays pairwise (`A!=B;A!=C`, not `A!=B!=C` or an ordered `A<B<C`).

This is the overloading of `=`/`!=` on their right side: a term — a variable, or a longer run of variables and literals — means *compare two terms*, while a fixed target means *match one*. So `A=B` compares whereas `A=#@#` is a [sub-pattern](#sub-pattern--apattern-and-apattern), and `AB=CD` compares whereas `AB=boardroom` is a [term-equals](#term-equals--abword-and-abword). Mixing a variable with a wildcard (`A=B?`) is neither a term nor a fixed target, and is rejected.

### Length prefix

A pattern may carry a leading length range, in the same syntax used for score and length ranges elsewhere in Grawlix: `7:x*a` (exactly 7), `7-9:x*a` (7 to 9), `0-6:x*a` (up to 6), `10+:x*a` (10 or more). On a binding it caps the whole matched word; inside a sub-pattern (`A=2-4:*`) it caps the variable's length.

## Systems and tuples

Two or more bindings make a **system** that Umiaq solves at once, finding tuples of words that satisfy the shared variables together. `AB;BA` finds pairs like APE / PEA; each tuple renders as a row of side-by-side lanes, one word per binding.

Tuples are **positional**: APE / PEA and PEA / APE are different rows. Each variable gets its own color, the same color in every lane, so you can see at a glance how the shared chunks line up between the words. A single-binding query has arity 1 and renders as an ordinary flat search; a query with N bindings produces N-lane tuples.

## How the dialect differs

Grawlix speaks its own dialect. Reusing Grawlix's search syntax and range conventions rather than Qat/Umiaq's own notation is a deliberate consistency-over-fidelity call — the reference notation is known to few constructors, and matching the rest of the app is worth more than fidelity to it. The consequences, especially for anyone pasting a pattern from Qat or CopyQat:

- **Any-character is `?`, not `.`.** Grawlix reserves `.` — it separates the variable breakdown in results — so a pasted `.` errors rather than acting as a wildcard.
- **Negation is `[^abc]`, not `[!abc]`.** A pasted `[!abc]` matches a literal `!` plus a, b, c.
- **Digits are literals**, not Qat's "repeated any-letter" placeholders (`l0v0` is the literal string, not "same letter twice"). Variables cover that use.
- **Lengths use the score-range syntax** (`10+`, `0-6`), not Qat's `10-` / `-6`. This applies both to the [length prefix](#length-prefix) (`10+:x*a`) and to a length constraint's right side (`|AB|=8-9`) — Nexus-Umiaq spells the latter the same way, so that one lines up, while `|AB|=8-` does not. Zero-length is `|A|>=0` or `|A|=0+`, not Qat's `|A|=0-`, and Grawlix also honors a zero-floor sub-pattern (`A=*`), which the reference tools don't. CopyQat goes the other way and has no zero-length escape at all.
- **A constraint can cover every variable at once** — `|*|>=0`, `|A-C|=3-5`. The reference tools have no equivalent; each variable must be named.
- **Sub-patterns take no parentheses** (`A=#@#`, not `A=(#@#)`). Upstream, parentheses distinguish a variable that must be a real *word* from one that is any *letter-sequence*; Grawlix has no word-form variable, so the parens would carry nothing.
- **Grawlix searches your merged wordlist**, not a bundled dictionary — a difference in kind, not a missing feature.

## Not yet supported

Things the reference tools do that Grawlix's dialect can't yet express. Several are on the [Roadmap](#roadmap); a few are likely out of scope.

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

With [anagram](#anagram--letters) now shipped — `/word` as a binding and `A=/word` as a sub-pattern — the notation covers ordinary wildcards, variables, terms, the [term-equals](#term-equals--abword-and-abword) `AB=boardroom`, [term-vs-term comparison](#term-comparison--abcd-and-ab) (`AB=CD`, `A!=B`), and rearrangement. What's left:

1. **Anagram flavors** — subset `/(…)` (an anagram of *some* of the letters) and letter bank `//…` (each letter reusable). The plain anagram shipped; these two variants build on it.
2. **`EXCLUDE`** — small, but wants a spelling that avoids the length-prefix colon.
3. **Longer tail:** neighbor/misprint, subsequence, consonantcy, n-ary/ordered difference (`!=ABCDEF`, `!=A<B<C`), `*` in a term-equals RHS, dictionary-word tokens, boolean algebra. Qategories need external data and are likely out of scope.


## One spelling per norm in a tuple

A norm can carry several spellings (`eta`/`ETA`), and Umiaq matches on norm, so every spelling of one norm does identical work and then has to collapse. Each strategy used to collapse differently — the probe path kept the first entry in pool order, the affix path deduped whole tuples by norm, and the bucket path never collapsed at all — so which spelling survived depended on which strategy the planner happened to choose, an optimization decision the user never sees.

A query that emits a **tuple** now reduces its pool to one entry per norm up front, picked by `preferRow` (`engine/corpus.js`) — the same rule that decides which spelling represents a norm everywhere else: highest score, then the shorter spelling, then code-unit order. All three strategies see the canonical pool, so the existing norm-keyed dedupes become no-ops rather than tiebreakers, and the answer no longer depends on the plan.

A **single** pattern is left alone and still shows every spelling, matching the entries table and every other tool. The asymmetry is deliberate: a tuple is a combination, so preserving spellings there multiplies results (two spellings across two lanes is four tuples saying the same thing), while a single pattern lists entries and the spellings *are* the distinction.
