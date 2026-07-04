# Umiaq: feature gaps vs. Qat / CopyQat / upstream Umiaq

Grawlix's Umiaq ([`site/src/engine/umiaq.js`](../../site/src/engine/umiaq.js)) is a JS reimplementation of Alex Boisvert's Umiaq pattern language (Crossword Nexus, MIT). This catalogs what it does *not* yet do relative to three references: [Qat](https://www.quinapalus.com/qat.html) (Mark Owen / Quinapalus, the original equation-solver word matcher), **CopyQat** (a self-contained Qat-flavored clone), and **upstream Umiaq** itself. It doubles as a roadmap — the highest-value additions are anagram (`/`) and variable sub-patterns.

## What Umiaq supports today (baseline)

Literals · variables `A–Z` · `?` (any one char) · `*` (zero-or-more) · `#`/`@` classes · `[...]` classes with ranges (`[l-p]`) and `^` negation · `~A` (reverse a variable's binding) · per-variable length `|A|=n` / `<= >= < >` · pairwise `A!=B` · opt-in zero-length via `|A|>=0` / `|A|=0` · multi-clause systems separated by `;`.

One deliberate departure from upstream, documented in the [engine header](../../site/src/engine/umiaq.js#L5-L11): variable binding is over `norm` (accent/space-stripped lowercase). The `#`/`@`/`[…]` classes reuse Grawlix's shared search-bar definitions, which — like upstream Umiaq, OneLook, and Ingrid — treat Y as a vowel (`@` includes it, `#` excludes it).

## Missing whole features (not expressible at all)

| Feature | Syntax | Present in | Status in Grawlix |
|---|---|---|---|
| **Anagram / jumble** | `/triangle`, `/triangle.`, `*/rpoyesdif`, `8:/tral*` | Qat, CopyQat, Umiaq | **Explicitly stubbed** — [`umiaq.js:61`](../../site/src/engine/umiaq.js#L61) throws `"anagram (/) is not supported yet"` |
| **Subset anagram** | `/(triangle)` — any subset of the letters | Qat (`*/letters`), CopyQat | Missing (no anagram at all) |
| **Letter bank** | `//triangle` — use each letter any number of times | CopyQat | Missing |
| **Dictionary-word tokens** | `>` = any word ≥2 letters, `<` = any reversed word (`ace>`, `9:.<.`, `kn* & <`) | Qat | Missing |
| **Boolean pattern algebra** | `p & q`, `p \| q`, `!p`, `(…)` grouping, `~pattern` (reverse an arbitrary pattern, not just a var) | Qat | Missing — Grawlix's `!=` is only the variable-inequality constraint, not pattern negation; no `&`/`\|`/grouping |
| **Neighbor / misprint** | `` `bonge `` (one substitution away), `` ?`str.g.ly `` (a crossing letter may be wrong) | Qat, CopyQat (neighbor) | Missing |
| **Subsequence / hidden words** | `->:humdinger`, `<-:humdinger` | CopyQat | Missing |
| **Consonantcy** | `#>:akron`, `<#:akron` (shared consonant skeleton) | CopyQat | Missing |
| **Qategories (semantic)** | `{def:color}`, `{thes:red}`, `{hyper:agate}`, `{hypo:ungulate}`, `{cat:gershwin}` | Qat | Missing — needs external WordNet/thesaurus/Wikipedia data; likely out of scope |

## Partial support (weaker than upstream)

| Feature | Upstream | Grawlix today |
|---|---|---|
| **Whole-pattern length prefix** | `7:*cry`, `-6:x*a`, `7-9:x*a`, `10-:x*a` (Qat, CopyQat) | Only per-variable `\|A\|=n`. No colon length-prefix on a clause, so "7-letter word ending in cry" isn't directly expressible |
| **Variable sub-pattern definitions** | `A=(#@#)`, `A=(..s)`, `A=(...[rz])`, `A=(3:*)`, `A=(2-4:*)`, `A=(EXCLUDE:ds)`, `A=(/lilac)` (Qat, CopyQat) | Variables are unshaped captures with length bounds only — can't constrain a variable to a class pattern, exclude letters, or anagram-define it. Biggest expressiveness gap after `/` |
| **Equation RHS** | `LHS=RHS`, e.g. `ABCDEF=......`, `B=(6:*)` (Qat) | No `pattern=pattern` form; every clause is a standalone word pattern |
| **Multi-variable length** | `\|AB\|=9`, `\|ABC\|>=5` (Qat, CopyQat) | [`LEN_CONSTRAINT_RE`](../../site/src/engine/umiaq.js#L21) accepts a single variable only |
| **n-ary / ordered difference** | `!=ABCDEF` (all different), `!=A<B<C` (ordered — "letters in alphabetical order") (Qat) | [`NEQ_CONSTRAINT_RE`](../../site/src/engine/umiaq.js#L22) is pairwise `A!=B` only; no `<`/`>` ordering |

## Syntax divergences (work, but silently wrong on copy-paste)

Not missing capability — a different sigil, so a pattern pasted from Qat/Umiaq/CopyQat does the wrong thing instead of erroring:

- **Any-char is `?`, not `.`** — Grawlix reserves `.` (the result-breakdown separator), so a pasted `.` throws `unexpected character`.
- **Negated class is `[^stz]`, not `[!stz]`** — a pasted `[!stz]` matches a literal `!` plus s/t/z instead of negating.
- **Digits `0–9` are literals**, not Qat's "repeated any-letter" placeholders (`l0v0` ≠ same letter twice). Variables cover the use case.

## Not a gap

Qat/CopyQat let you pick a bundled dictionary; Grawlix runs against the user's own merged corpus instead — a difference in kind, not a missing feature.

## Roadmap priority

1. **Anagram `/`** and its flavors (subset `/(…)`, bank `//…`) — the single most-requested crossword primitive, and already stubbed with a clear insertion point.
2. **Variable sub-pattern definitions** (`A=(…)` incl. `EXCLUDE`) — the biggest jump in expressiveness; unlocks a large class of Qat equations.
3. **Whole-pattern length prefix** and **multi-variable length** (`|AB|=n`) — cheap parser extensions that close common Qat idioms.
4. Longer tail: neighbor/misprint, subsequence, consonantcy, n-ary/ordered difference, boolean algebra. Qategories need external data and are likely out of scope.
