# Rich entries

Wordlists in the wild collapse entries to a uniform letter-only form — some ship `[A-Z]+`, others `[a-z]+`, the community having never settled on one — with no spaces, punctuation, or accents. The grid representation is letter-only, and historically every shipped wordlist matched that representation. A new generation of wordlists is starting to ship **rich entries**: spaces, punctuation, accents, and mixed case preserved (`Mötley Crüe`, `the IRS`, `Helen of Troy`, `co-op`). Rich wordlists are higher-fidelity (`mate` and `maté` are distinct entries; `theirs` and `the IRS` are distinct entries; `Helen of Troy` carries the initialism `HOT`) and unlock theme-generation tools that plain wordlists can't support.

Grawlix needs to support rich wordlists as first-class sources, mixed freely with plain ones, with no extra UI burden on the user. Search, tools, merge, edit, and download all "just work" across both kinds.

The design pivots a foundational assumption: [`docs/design.md` § Runtime normalization](../design.md) explicitly rejects a two-field entry split, premised on "real wordlists don't have this problem." Rich wordlists are precisely that problem. The rejection is reversed; the rest of this doc is the cascade.

---

## Cases the format distinguishes

Plain wordlists collapse all of the following pairs onto the same letter-only key, losing the distinction. Rich wordlists preserve each as its own entry, with its own score and comment:

- alkaline / Al Kaline
- aptest / AP test
- coop / co-op
- digit / "Dig it?"
- dome / "Do me!"
- goon / go on
- gun it / G-Unit
- legit / leg it
- mate / maté
- notable / not able
- resume / résumé
- rose / rosé
- seeing a show / seeing as how
- sundry / sun dry
- theirs / the IRS
- they / the Y
- Togo / to go

The shared letter sequence still merges these into one slot at fill time — they're substitutable in a 6-letter grid slot — but they're independent fills with independent quality. Rich wordlists let a constructor score `Al Kaline` (the baseball player) separately from `alkaline` (the chemistry term), or surface `the IRS` as a tax-themed entry without conflating it with `theirs`.

---

## Two-level entry identity

Every `wlEntry` carries `{ norm, display, score, comment }`:

- **`norm`** — the canonical letter form. Lowercase `[a-z0-9]+`, accents stripped, spaces and punctuation removed. The merge key. What letter-pattern tools (Anagram, Behead, Curtail, Regex, …) operate on by default.
- **`display`** — the rich form as written. Set when the source carries information not recoverable from `norm` (any space, accent, punctuation, or per-entry case beyond uniform all-upper / all-lower). `null` when not — see *Wordlist richness autodetect*. The renderer falls back to `norm` (lowercase) when `display` is null.

The old single `entry` field is gone. Code references to `wlEntry.entry` become `wlEntry.norm` (for letter-pattern operations) or `wlEntry.display` (for rendering and rich-aware tools). [`docs/style.md` § Terminology](../style.md#terminology) gets a parallel update: the colloquial *entry* still refers to "the string in a wordlist," but the *record* now carries two strings rather than one. *Wordlist entry* (`wlEntry`) is unchanged in spirit.

Naming: `norm` and `display` over `canonical / raw` or `letters / written` — short in code, semantically clear, no misleading "raw" for plain sources whose raw form *is* the canonical.

---

## Wordlist richness autodetect

Richness is a load-time decision, not a runtime flag. The parser classifies each imported file as **plain** or **rich** and populates `display` accordingly: plain files leave `display` null on every entry; rich files preserve the entry text as written.

**The classification rule.** A file is plain iff:

- ≥99% of entries match `[a-z0-9]+` *or* `[A-Z0-9]+`, consistently the same one across the whole file, AND
- ≤1% of entries contain space, accent, punctuation, or within-entry mixed case.

Otherwise rich. The thresholds are knobs; reasonable defaults ship and get tuned against real-world feedback.

**Why the heuristic guards a single direction.** Three of the four misclassification cases are tolerable. Misclassifying a deliberately-rich file as plain *loses data* — accents, spaces, punctuation, per-entry case all disappear. Misclassifying a dirty personal file as rich renders it as-given, which the user expects (they put the dirt there). Misclassifying a uniformly-lowercase plain file as rich renders lowercase, which matches the default rendering anyway — visually identical to the plain treatment.

The one bad case is **misclassifying a uniformly-uppercase plain file as rich**: every entry gets preserved with its all-caps display, and the merged view renders in shouty all-caps when it should render quietly lowercase. The heuristic guards specifically against that — uniform `[A-Z0-9]+` plus very few rich-feature entries → plain.

Title-cased plain files are not considered; they don't exist in the wild.

**Why per-file, not per-entry, at import.** A single accent typo in an otherwise-plain public wordlist shouldn't flip the whole file to rich. Personal wordlists with mixed-case dirt shouldn't be forced into uniform plain rendering. The 99%/1% rule does the right thing on both.

**Why no runtime `wordlist.rich` flag.** Post-load, every `wlEntry` has `display` set or null, and that data answers every question the merge, renderer, and tools need. A wordlist-level tag would be a second source of truth that can disagree with the per-entry state.

**Recovery from misclassification.** If we get it wrong, the user re-imports. No UI toggle today; if real-world usage shows it's needed, one lands later.

---

## UI input preserves display literally

Popover edits, "add new entry" rows in the My Edits panel — anything the user types directly into Grawlix — store the entered text verbatim as `display`. No per-string autodetect on this path.

The reason is variant targeting. When a user clicks the score on the `the IRS` row and changes it, the edit *must* preserve `display: "the IRS"` so the new My Edits entry targets that specific variant. If the autodetect ran per-string, an edit on `theirs` would null-out (it matches `[a-z]+`) and become "ambient" — leaking onto `the IRS` and `THEIRS` and any other variant sharing the norm. The literal-preserve rule sidesteps that without any special-case logic.

A side effect: My Edits ends up mixed-state. If the user imports a plain file into My Edits, those entries have `display: null`. As the user types rich entries via the UI, those entries get `display` set. The merge handles the mix correctly per the merge semantics below; nothing else cares.

---

## Display rendering

Lowercase is the new default. When `wlEntry.display` is null, the renderer shows `norm` directly (already lowercased). English dictionary words are conceptually lowercase; uppercase is reserved for proper nouns, abbreviations, and other places where capitalization is significant — places where a rich source has explicitly written the entry in uppercase.

The in-app "Display case" toggle is removed. Case rendering follows the data: rich entries render as written, plain entries render lowercase regardless of whether the source file was uppercase or lowercase.

The community has never settled on a single case convention for wordlist files, so the toggle survives in one place only — the Download dialog (see below) — where the choice has real downstream consumers.

---

## Merge semantics

The merge key is `(norm, display)`. Within a single `norm`, multiple distinct displays from one or more rich sources produce **multiple rows** in the merged view. `theirs` and `the IRS` are substitutable letter-wise in a 6-letter slot, but each is a distinct fill option with its own quality — the rich source deliberately encoded the split, so the UI honors it.

`display` is treated as **opaque**. Two displays compare as strings; there is no content-based normalization (no case-insensitive sub-grouping, no "richer display wins" rule). `"THEIRS"`, `"theirs"`, `"Theirs"`, and `"the IRS"` from different sources are four distinct rows sharing one norm.

**Null display contributors are ambient.** A `wlEntry` with `display: null` participates in every merged row that shares its norm — it votes a score across all variants. So a plain source's entry for norm `theirs` contributes its score to both `theirs` and `the IRS` rows when those rich variants exist. The plain entry doesn't surface as its own row (it has no display string to anchor); it's an across-variant contributor.

**Override-loser display repeats across rich rows.** When a plain wordlist's entry loses to a multi-variant rich winner — a plain source's entry for norm `theirs` at score 30, against a rich source's `theirs;50` and `the IRS;40` — the plain entry appears as override-loser on *every* rich row sharing the norm. The plain score genuinely doesn't distinguish; picking one row to "own" the relationship would be arbitrary.

**Display selection for null-only rows.** When every contributor to a norm has `display: null`, the merged row renders `norm` (lowercase). No `display` string is invented.

---

## Search

One algorithm, no mode switch, no visible setting. The pattern is matched against an entry's `display` if set (else against `norm`), with implicit fuzzy glue:

**Conceptually:** insert `[\W_]*` between every adjacent pair of pattern characters. Pattern characters are literal required:
- Letters case-insensitive.
- Accented characters require matching accent in the display (`résumé` matches `résumé`, `Résumé`, `RÉSUMÉ`; not `resume`).
- Bare letters (no accent in the pattern) match accented and unaccented equally (`resume` matches `resume` and `résumé`).
- Spaces in the pattern require a literal space in the display at that position.
- Other punctuation in the pattern (hyphens, apostrophes, periods, …) requires that literal punctuation at that position.

The `[\W_]*` glue lets the display carry arbitrary extra spaces and punctuation between the required characters.

| Pattern | Matches | Doesn't match |
|---|---|---|
| `theirs` | `theirs`, `the IRS`, `the-irs`, `the i r s`, `the I.R.S.` | `they're` (wrong letters) |
| `the IRS` | `the IRS`, `the i r s`, `the I.R.S.` | `theirs` (no space at required position), `the-irs` (hyphen, not space) |
| `co-op` | `co-op`, `co--op`, `co - op` | `coop`, `co op`, `co_op` (wrong or missing punctuation) |
| `résumé` | `résumé`, `Résumé`, `RÉSUMÉ` | `resume` |
| `?O?` | `for`, `co-op`, `to go`, every letter-O-letter | letter-O-non-letter sequences |

**Wildcards** (`?`, `*`, `#`, `@`, `[…]`) match letters/digits only — they index past separators in the display, treating spaces and punctuation as part of the `[\W_]*` glue rather than as candidates for the wildcard slot.

**Implementation note.** The conceptual `[\W_]*`-glue model is not a literal regex injection — that would be a bad implementation. The matcher walks the display character by character with a pattern cursor that advances on required matches and tolerates non-alphanumerics in the gaps. Same outcome, faster.

The smart-case proposal (separate strict/loose modes selected by pattern shape, with a visible mode badge) was considered and rejected. The implicit-fuzzy single-algorithm rule covers the same cases without surfacing a control — the user's typed pattern is the signal, and the only behavioral switch is "did you type a space, accent, or punctuation?" which is self-explanatory enough not to need chrome.

---

## Highlights coordinate space

Today `renderHighlightedText(entry, ranges)` assumes `entry.length === renderedString.length`. Rich entries break that — `the IRS` (display, length 7) carries letters at norm positions 0–5, with a space at display position 3.

**Letter-pattern tools emit ranges in `norm` coordinates.** Behead, Curtail, Anagram, Regex (when matching against norm) — their range outputs index into `norm`. A per-entry precomputed `norm[i] → display[j]` map handles the projection at paint time (identity on plain entries, off-by-spaces/punctuation on rich entries).

**Search emits ranges in `display` coordinates** directly. The search algorithm matches against `display` with `[\W_]*` glue; the resulting match span is inherently in display space, with no useful projection back to `norm`. The renderer accepts both coordinate spaces — each range record carries a tag identifying its space, and the renderer projects when needed.

This costs one precomputed mapping per rich `wlEntry` at parse time (a single `Uint16Array` or equivalent indexed by `norm` position) — small per-entry, near-zero on plain wordlists.

---

## Length, sort, stats

Letter count, always. `wlEntry.norm.length` drives:
- The length column on the entries table.
- The Length sort axis.
- Histogram bin counts.
- Score-range and length-filter calculations.

`"the IRS"` has length 6, not 7. The crossword grid slot is letter-counted; display length never affects what fills where.

---

## Download dialog

Each per-wordlist Download (sources and My Edits) and the All Download offers three case modes:

| Mode | Per-entry output |
|---|---|
| **As is** | `display` if set, else `norm` (lowercase). Rich preserved; plain emitted lowercase. |
| **Normalize to lowercase** | `norm` directly (`[a-z0-9]+`, spaces/accents/punctuation stripped). |
| **Normalize to uppercase** | `norm.toUpperCase()` (`[A-Z0-9]+`, spaces/accents/punctuation stripped). |

The two *Normalize* modes feed downstream construction tools that expect plain `[A-Z]` or `[a-z]` letter-only entries. *As is* covers data preservation and backup. The same three-way choice replaces the rich-vs-plain split the early brainstorm proposed; the lowercase/uppercase axis was the real distinction users need surfaced.

The previously-considered in-app "Display case" toggle moves entirely into this dialog. No global display-case setting survives — the display follows the data in-app, and the case choice surfaces only at download time where it has real consumers.

---

## Acronym match — first new tool

The rich format unlocks a class of tools that operate on word structure rather than letter sequence. Acronym match is the first to ship.

**Behavior.** Pattern is a literal acronym. Matches displays whose word-initial letters spell the pattern (case-insensitive). `WTF` matches `what the fuck`, `world tour finals`, `welcome to france`, etc.

**Word boundaries:**
- **Spaces** are word boundaries, always.
- **Hyphens** are *optional* word boundaries — `co-op` is treated as both one word (`co-op`) and two (`co` / `op`), and the matcher tries each split. So `CO` matches `co-op` via the two-word interpretation; `C` matches via the one-word interpretation; `COOP` doesn't match (no interpretation produces four words).
- **Apostrophes, periods, commas, slashes** are *not* word boundaries. `don't` is always one word, never two — so `DT` does not match `don't`. Matches realistic English conventions where these characters belong inside their word rather than between words.

**Other params.** No wildcards, no minimum pattern length. A single-letter pattern matches every display whose first word starts with that letter — noisy but not wrong, and the user can pick how they want to filter.

**Implementation.** A small helper emits the set of valid word splits for a display (1 or 2 entries depending on hyphens). The matcher checks the pattern against each split's word-initial letters.

The Initials tool (the inverse — derive an acronym from a display) is a natural sibling and ships next; it doesn't appear in this doc but lands in the tool catalog alongside Acronym match.

Other rich-format tools (Has-accent, Has-apostrophe, Has-hyphen, Has-space, Word-count, Proper-noun) are deferred to the tool catalog and not part of this design.

---

## File format

`ENTRY;SCORE[;COMMENT]` per line, UTF-8 throughout. The entry field is free-form text — spaces, accents, punctuation, mixed case all valid for rich wordlists; uniform a-z/A-Z for plain. Leading and trailing whitespace around the entry field is stripped on parse; internal whitespace is preserved.

Semicolons in entries remain forbidden — there is no escape mechanism. Today's plain wordlists already follow this constraint; rich wordlists need to too. A semicolon-in-entry edge case is detectable at parse and surfaces as a Download-time warning (consistent with the existing semicolon handling — see [`docs/design.md` § Download as wordlist](../design.md#download-as-wordlist)).

---

## Schema bump

`SCHEMA_VERSION` gets bumped when this lands. Per [`migration.md`](migration.md), no migration code — the schema-mismatch reset prompt covers the boot path. Stored wordlist metadata changes (new `display` field on every `wlEntry`); IDB-stored raw text is unaffected since reparsing produces the new shape.

---

## Space out

The Space out tool ([`docs/design.md` § Space out](../design.md#space-out-phrase-reconstruction-via-word-frequency-nlp)) recovers spacing from run-together plain entries via Norvig segmentation. With rich sources providing real spacings, the tool's job partly evaporates — synthesizing `A BARREL OF LAUGHS` is redundant when the rich source already has `a barrel of laughs`.

Two paths, decided at implementation time:

- **Keep with skip-when-covered.** Space out only synthesizes on norms with no rich-display variant from any contributing source. Avoids redundant output; preserves the tool for norms still trapped in plain form.
- **Retire.** Once rich sources cover the wordlist canon, the tool's value drops to near-zero. Removal is on the table.

Not blocking the design; revisit when the new architecture is built and the rich-source coverage of real wordlists is observable.

---

## Threshold tuning

The autodetect rule's 99% / 1% thresholds are knobs in code, not user-surfaced settings. Real-world wordlists in the wild may push the thresholds — files with 2% genuinely-rich entries that should still be considered plain, or 0.5% rich entries that should flip rich. Ship reasonable defaults; tune from feedback. A small number of misclassified files survives the recovery path of re-import.

---

## What this doc does not cover

- The rest of the tool catalog (Initials, Has-accent, etc.) — those live in the tool catalog at [`../tools.md`](../tools.md) as they land.
- UI surfaces for autodetect overrides, source labels, "this is a rich wordlist" indicators — none are planned. The data renders itself.
- File-format extensions (header metadata, version declarations, multi-line entries) — not on the table.
- Search behavior changes outside the implicit-fuzzy rule above — no smart-case, no whole-word toggle per row, no separate "respect spaces" facet.
