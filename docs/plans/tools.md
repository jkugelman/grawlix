# Tools (gallery & mining)

Grawlix's mining side: anagrams, regex, beheadments, curtailments, and a long tail of letter/sound/meaning tricks for both **filling** (looking up words and noting score corrections while you work a grid) and **theme generation** (mining the wordlist for ideas).

Inspiration: [Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson. See [`../wordlisted.md`](../wordlisted.md) for a full breakdown of its search modes. Grawlix will cover similar ground and add its own tools.

The gallery is where Grawlix's [project goal](../../README.md#goals) — democratize wordlist manipulation — does most of its work. Constructors who program can write Python to anagram, behead, phonetic-substitute, semantic-filter against their wordlists. The gallery's job is to put those moves in non-programmers' hands. Filter when evaluating a candidate tool: *would a programmer reach for this often enough to write a script?* If yes, it probably belongs.

## Status

The chrome, the pipeline runtime, the cooperative-yielding `ctx` API (with `forEach` / `filter` / `yield` helpers, supersession, and slow-row spinners), and four tools (Anagram, Semordnilap, Behead, Curtail) are shipped — see [`../design.md` § Tool gallery & stack](../design.md#tool-gallery--stack) for the executor, runtime normalization, pair-row display, per-kind sort, the highlights pipeline, and the cooperative runtime. The `removed` highlight kind (struck-through, used by Behead and Curtail) is wired up; other highlight kinds (kept/inserted/shifted/group:N) land as tools start emitting them.

The **output reframe** below is settled but not yet implemented. It pivots the tool API and rendering model — chain rows, per-row pure-function `run`, atom counts statically derived from the catalog — and lands across commits 0.5, 1, and 2. Commit 0 (drop `anagram_with`) is done. After the reframe ships, the rest of this doc covers what's still planned beyond it: the catalog of tools that have records but no `run` yet, the indexed-view runtime that several anagram-family tools need, groups output, gallery polish (category picker, search), result download, and the OneLook / Datamuse / Umiaq integrations.

---

## Output reframe — chain rows, per-row tool API

Today's executor and renderer split tool output into `'words'` (1-atom rows) and `'pairs'` (2-atom rows with a relation glyph). The reframe collapses those into a single **chain-row** shape: every row is a vertical stack of atoms — one per significant transition through the pipeline — sharing column widths and reading top-to-bottom as one entry's journey. The tool API becomes per-row pure functions; the system owns chain bookkeeping, looping, yielding, and aborting. The motivating example is `behead → behead → behead`, where today's renderer only shows the bottom-most beheaded entry; under the reframe the row stacks `RELEARNING / → ELEARNING / → LEARNING / → EARNING` and reads as one self-explaining journey.

Group output (clusters from `anagram_families`) is reserved in the model but deferred until that tool ships.

### Kind taxonomy

Two kinds in scope for the reframe; one reserved:

- **Filter.** Keeps or drops entries without producing new ones. Optionally writes highlights onto the entry. Examples: search, regex, palindromes, isograms, kangaroo, made_from, hidden_anagram, almost_anagram, anagram.
- **Transform.** Produces 0+ new entries from each input entry. Each output becomes one new chain row, so N outputs from one input means the input row branches into N rows. Examples: behead, curtail, semordnilap, add_prefix, replace_one, regex_replacement, letter_swap, letter_incrementing, phrase_parsing.
- **Group** *(deferred)*. Partitions input into clusters of ≥2 entries. Only example: `anagram_families`. Sketch the shape when that tool ships; do not design ahead.

### Tool API

Tools are per-row pure-ish functions. The system handles the outer loop, cooperative yielding, abort checks, atom construction, and chain bookkeeping. Tools never touch `ctx`, scores, atoms, or chain rows — they see one entry, return per-row decisions:

```js
// Filter — predicate over one entry, with optional highlights.
// Return values:
//   null / false / undefined → drop the row
//   true                     → keep, no highlights
//   Range[]                  → keep, annotate with these highlights
{
  kind: 'filter',
  inputHighlights:  boolean,   // produces highlights on the entry it received
  outputHighlights: boolean,   //   ... or on the entry it forwards (filters declare one, not both)
  run(entry, params, wordlist) → null | true | Range[]
}

// Transform — emits 0+ new entries per input entry. Each output is one new chain row.
{
  kind: 'transform',
  inputHighlights:  boolean,   // produces highlights on the prior tail atom
  outputHighlights: boolean,   // produces highlights on the new atom it adds
  run(entry, params, wordlist) → TransformOutput[]
}

// Output entry — a string to look up, or [string, score] for a tool-synthesized
// entry not in the wordlist. Loose-typed union, idiomatic JS.
type Output = string | [string, number]
type TransformOutput = {
  entry: Output,
  inputHighlights?: Range[],   // per-row range data; static flag is the kind-level decl
  outputHighlights?: Range[],
}
```

`entry` is the lowercased entry text (post-commit-0.5 field model — see *Field-model simplification* below). `params` is the normalized params object. `wordlist` is the merged-scope wordlist, with lazy indexed-view properties (`byEntry`, `byLetterBank`, etc. — see *Indexed views* in the next section).

A filter's `inputHighlights` and `outputHighlights` are positional labels for the same entry (filters don't change the entry); the choice matters under the unification model below, but the visible result of declaring one vs the other is identical. Pick the one that reads more naturally for the filter; never declare both.

A transform's two flags are independent — input-side annotations go on the prior atom, output-side on the new atom. Per-row data is supplied via the matching `inputHighlights` / `outputHighlights` fields on each `TransformOutput`. The kind-level booleans are what the unification model reads to derive atom counts.

Concrete examples:

```js
behead: {
  kind: 'transform',
  inputHighlights: true,       // annotates the dropped letter on the input atom
  outputHighlights: false,
  run(entry, params, wordlist) {
    if (entry.length < 2) return [];
    const beheaded = entry.slice(1);
    if (!wordlist.byEntry.has(beheaded)) return [];
    return [{
      entry: beheaded,
      inputHighlights: [{ kind: 'removed', start: 0, end: 1 }],
    }];
  },
}

semordnilap: {
  kind: 'transform',
  inputHighlights: false,
  outputHighlights: false,
  run(entry, params, wordlist) {
    const reversed = reverseString(entry);
    if (reversed === entry) return [];                // skip palindromes
    if (!wordlist.byEntry.has(reversed)) return [];
    return [{ entry: reversed }];                     // both directions emitted; commit 2 unifies
  },
}

phrase_parsing: {
  kind: 'transform',
  inputHighlights: false,
  outputHighlights: false,
  run(entry, params, wordlist) {
    return findParses(entry, wordlist).map(({ joined, minScore }) => ({
      entry: [joined, minScore],                      // synthesized — joined phrase not in wordlist
    }));
  },
}
```

phrase_parsing illustrates the synthetic-output escape hatch: when a tool produces an entry not in the wordlist, it returns `[string, number]` with a tool-supplied score. The system constructs a synthetic wlEntry from that pair. Most tools don't need this — they look up wordlist-resident entries via `wordlist.byEntry` and emit only those.

### Atom shape

```js
type Atom = {
  wlEntry: wlEntry,            // entry text, score, source wordlist, etc.
  highlights?: Range[],        // optional, in display coordinates
}

type ChainRow = { atoms: Atom[] }   // length is statically derived from the stack
```

A regular atom's `wlEntry` is a reference into the wordlist (same identity as the entry in the source's `rawEntries`). A synthetic atom's `wlEntry` is constructed by the system from the tool's `[string, score]` output:

```js
{ entry: '<lowercased>', score: <tool-supplied>, wordlist: null }
```

The `null` wordlist is the synthetic marker — `AtomPopover` suppresses open when `wlEntry.wordlist === null`, since editing a synthetic's score wouldn't write back anywhere. No `synthetic: true` flag; no comment field.

### Unification model — atom count is static

The chain shape is derivable from the catalog records alone — no per-row runtime inspection. Each tool declares `inputHighlights` and `outputHighlights` as static booleans; the chain is built by walking adjacent-tool junctions.

For K tools in the stack: K+1 junctions, one before T1, one between each Tᵢ and Tᵢ₊₁, one after T_K. Each junction has an "upstream output" side (the prior tool's `outputHighlights`, or bare for junction 0) and a "downstream input" side (the next tool's `inputHighlights`, or bare for the last junction). The atom contribution at a junction:

- **Both sides highlighted** → 2 atoms (same entry, two highlight sets).
- **At most one highlighted** → 1 atom (with whichever highlights exist, or bare).

Transforms create a new entry-slot in the chain (the output entry differs from the input); filters don't (their output equals their input). Atom counts compose per-slot.

| Stack | Atom count | Notes |
|---|---|---|
| `[]` | 1 | originator only |
| `[palindromes]` | 1 | non-highlight filter, no contribution |
| `[search]` | 1 | filter's highlights claim the originator |
| `[behead]` | 2 | originator atom (with behead's input-highlights) + behead's output (bare) |
| `[behead, behead]` | 3 | each behead annotates its input, creates a new bare output |
| `[add_prefix]` | 2 | originator bare; output annotated |
| `[add_prefix, behead]` | 4 | the middle slot has BOTH sides highlighted (add_prefix.out + behead.in) → 2 atoms |
| `[kangaroo, search, behead]` | 4 | three filter/transform annotations on the originator slot (2 atoms) + behead's output (1) + … |

Per-row highlight data flows via `inputHighlights` / `outputHighlights` on each `TransformOutput` and via the filter's `Range[]` return; the static flags only drive how the executor places atoms.

### Bidirectional emission and symmetric unification (commit 2)

Transforms emit one row per directed `(input, output)` pair. Semordnilap iterates the wordlist and emits a row whenever the reverse is also an entry — naturally producing both `STRESSED → DESSERTS` and `DESSERTS → STRESSED` without special handling. The tool author writes the dumb bidirectional emit.

The post-executor **symmetric unification pass** collapses row-pairs that are reverses of each other (same entries in reverse order, equal atom counts, equal scores) into a single row whose relation glyph becomes `↔`. The bidirectional arrow falls out of the unification — it's the natural glyph for "two unidirectional rows pointing at each other." With no downstream transform, semordnilap-alone shows one row per pair, with `↔`. With a downstream transform (`semordnilap → behead`), the two directions diverge — `STRESSED → DESSERTS → ESSERTS` is no longer the mirror of `DESSERTS → STRESSED → TRESSED`, so they stay as separate rows with `→` glyphs.

The author doesn't decide whether to dedupe; the renderer does, based on whether the rows actually mirror each other after the full pipeline runs.

### Always-stacked layout

Atoms render top-to-bottom on every viewport. No side-by-side layout at any width. Today's mobile-only 2-line pair affordance becomes the only layout, generalized to N atoms.

```
| count | entry      | len | score |
|-------|------------|-----|-------|
| 1.    | SLING      | 5   | 60    |
|       | → LING     | 4   | 50    |
| 2.    | BRING      | 5   | 70    |
|       | → RING     | 4   | 80    |
```

The relation glyph (`→`, `↔`, `⊃`) prefixes each non-originator line. Column widths share across all atoms — one `--entry-w`, one `--score-w`, etc. Doubled atoms (from unification) appear as adjacent lines with the same entry text but different highlight overlays — reads as "this entry through one filter's lens, then through another's."

Row stride = atom count × ROW_HEIGHT. The virtual scroller reads atom count via JS for stride math. The `tools-multi-word` body class is retired entirely; the mobile media query for pair rows is retired; no per-atom-count CSS variants.

Headers stay constant — Entry / Length / Score columns describe what each *line* contains, not what each row contains.

### Sort axes per atom count

- **1-atom rows:** Entry / Length / Score. Default Entry asc.
- **≥2-atom rows:** Entry / Length / Min score / Max score. Default Min score desc.

**Projections.** *Entry* (alphabetical) and *Length* read off the **last atom** in the row — for `[behead]` results, "Entry" sorts by LING/RING/LOSE, not SLING/BRING/CLOSE. *Min/Max score* project across every atom in the row; for 1-atom rows, *Score* reads the single atom's score directly.

**URL keys** reflect the UI exactly — `sort=score` at atom count 1; `sort=min-score` / `sort=max-score` at higher counts. No aliasing across atom counts; parser falls back to the per-tier default if the key is invalid for the current count.

**Snap rule.** When a stack edit changes atom count, snap the sort axis to the new tier's default if the prior axis was the *old* tier's default; otherwise keep the user's pick if still valid.

The whole sort story is provisional — expect to iterate after the UI is live.

### Stats bar and pipeline indicator

Stats bar count label is always "N entries" regardless of atom count. The unit is the chain row; how many visual lines it occupies is a display detail. "N pairs" / "N chains" labels are gone.

Slow-pipeline indicator is one global signal (table dim and/or single spinner icon) whenever a pipeline run is in flight. Threshold (100ms) applies to the **whole run total**, not per-step. Today's per-tool spinner badge on the slow stack row is dropped — long pipelines of fast tools that individually clear 100ms but sum to more now trigger the indicator.

### Field-model simplification (commit 0.5 prep)

Lands before the chain-row pivot so the reframe is built on a uniformly-lowercased field model.

- `wlEntry.entry` becomes lowercased (today's `entryNorm`). No other transformations.
- `entryNorm` and `entryLower` removed (aliases for the new `entry`).
- Today's original-case `entry` field removed entirely. No "preserve case" field on wlEntry.
- Lookup map renamed `byNorm` → `byEntry`.
- **"Download original"** rewires to serve the raw IDB blob directly. `persistData(wordlist, text)` already stores the imported file byte-for-byte; no reconstruction from wlEntries needed. (My Edits has no "Download original" affordance — already true today.)
- Other downloads (rescored, merged) reconstruct from wlEntries and `.toUpperCase()` at the write boundary to match conventional wordlist format.
- Display uses existing `displayEntry()` (respects user's case setting); feed it `wlEntry.entry`.

Today's two-field defensiveness handled multi-word entries (whitespace stripping in `entryNorm`), but real wordlists store letter-only entries — the defensiveness never earned its keep. Post-parsing synthetic entries with spaces (from phrase_parsing) keep their spaces; searching for the unspaced form no longer matches them, which is the intended semantic ("after splitting, the spaces are meaningful").

### Commit order

- **Commit 0:** drop `anagram_with` from docs. ✓ done.
- **Commit 0.5:** field-model simplification (above). Pure mechanical refactor, no user-visible behavior change.
- **Commit 1:** chain-row data model, new tool API, executor rewrite, renderer rewrite, sort axes, CSS. The core pivot.
- **Commit 2:** symmetric unification pass — semordnilap → bidirectional emission; runtime collapses mirror chain rows into one with `↔`.
- **Commit 3:** distill this section into `../design.md` as present-tense documentation; trim what's shipped from this plan.

Group output and `anagram_families` are out of scope for this sequence — design conversation happens when that tool surfaces.

---

## Sequencing — runtime support before the family

When the next tool needs runtime support that doesn't exist yet, land the runtime first, then the tool. Specifically: tools that want a shared indexed view should wait until that view exists on the wordlist object, because building the index inline inside each `run` re-pays the cost on every keystroke.

Concretely:

- **Letter-bank family** (`subanagram`, `made_from`, `anagram_families`) — wait for `wordlist.byLetterBank`. Anagram already pays the cost per-keystroke for one tool; a second letter-bank tool without the shared view doubles it. Land the view alongside the first new family member.
- **Membership family** (`kangaroo`, `joey`, `sandwich`, `nested_words`) — `wordlist.byEntry` already exists after commit 0.5 (the lookup map renamed from `byNorm`). No gate.
- **Network-bound tools** (OneLook, Datamuse) — need the `signal` argument plumbed into `run(entry, params, wordlist, signal)` for cancellation. The plumbing is small; land when the integration surface is designed.
- **Phonetics / thesaurus families** — wait for the bundled data dependency. Until CMU dict and Roget XML are available at runtime, the tools can't run.

For tools that fit the runtime as-is (`palindromes`, `isograms`, `supervocalics`, etc. — purely letter-pattern checks over `entry`), no gate; just add the `run` and ship.

---

## Pipeline behavior — remaining pieces

The everyday composition story (live search filtering on the last tool's output, scores coming along from `All`, score-range filtering on the rendered output) is shipped. Two pieces still wait:

**Reordering.** Order matters in a pipeline. The intended gesture is "remove (X) and re-add" — drag handles aren't planned, because chaining is a 2%-case gesture and reordering is rarer still; the design surface isn't worth the touch/keyboard-accessibility complexity. Today the stack supports add/replace/remove but not in-place reorder. Unblocks once a chained workflow surfaces that wants it.

**Pre-pipeline score filtering.** "Anagrams of LINDSEY drawn only from score-50+ words" would be a separate `score_filter(min, max)` tool that takes the merged wordlist and trims it to a range before downstream tools see it. Not in the catalog yet; surface if the workflow appears.

---

## Gallery — unshipped pieces

**Category picker.** A fixed category menu at the top of the gallery (Anagrams & letter banks, Letter patterns, Pairs, Oddities, etc.). Clicking a category swaps the cards displayed below; the menu itself never moves. Spatial stability — categories live in the same place every time, cards stay visible while working, and the gallery's full width goes to tools. Matches the user's settle-into-a-tool-set pattern: a constructor with a theme idea picks the relevant category once and stays there.

*Alternatives evaluated:*

- *Inline accordion* (rejected) — categories collapsed; clicking a header expands cards in place, pushing others down. Items shifting under the cursor as sections open/close fights spatial recall and muscle memory.
- *Card list* (viable fallback) — plain vertical scroll of all tool cards with a pinned filter input at the top. Most conservative option; scrolling past viewport required but not painful.
- *Icon strip* (viable fallback) — VS Code activity-bar style: a thin (~50px) strip of category icons at rest; clicking one slides out a side panel with that category's cards. Wins on main-pane width. Loses on interaction count (two-step to reach a tool) and on panel-open state.

**Gallery search input.** A filter/search input at the top of the panel lets users find tools by name or keyword across categories. **Alt+T** focuses it. The DOM is in place but disabled.

---

## Downloading results

A download affordance near the results list saves the current output to disk — whatever the bottom row of the stack produces. For the empty stack (just the search bar), that's "the filtered list" — the merged `All` view restricted to the current pattern. For a longer stack (`Anagram LINDSEY → Search DOG`) it's the full pipeline output. The button is always present; what it produces just follows the stack.

The everyday case is filling — narrow `All` with a pattern, then save the matches as a working set.

Default filename describes the stack: `grawlix-search-DOG.txt`, `grawlix-anagram-LINDSEY-search-DOG.txt`. Same tool keys as the URL query string (see [`../design.md` § URL state](../design.md#url-state)), so the file is self-describing and re-running the same stack later won't overwrite the prior snapshot.

Format follows the tool's natural output shape — for plain entry lists, the standard `ENTRY;SCORE[;COMMENT]` used elsewhere. Pair and group outputs need their own format design (`FROM\tTO\tMIN_SCORE` is the obvious shape for pairs); deferred until those tools land in the user's workflow.

This is a third "give me a file" path alongside the two existing ones (All/My Edits via Sync & backup, individual wordlist via the Library view). It's distinct because the file isn't a backup or a wordlist export — it's a snapshot of the current view, usually filtered or transformed.

---

## Tool API extensions

The reframe (above) defines the basic catalog record shape — `name`, `icon`, `category`, `desc`, `example`, `params`, `kind`, `inputHighlights`, `outputHighlights`, optional `run`. A few subsystems sit around it.

### Indexed views on `wordlist`

The `wordlist` argument to `run` exposes lazy indexed-view properties that tools query for O(1) lookups:

- `wordlist.byEntry` — `Map<entry, wlEntry>` keyed by the lowercased entry. Membership checks (kangaroo, joey, sandwich, nested_words) and beheading/curtailing lookups use this.
- `wordlist.byLetterBank` — `Map<sortedLetters, wlEntry[]>` keyed by sorted-letters. Instant anagram lookup (anagram, made_from, anagram_families).
- `wordlist.byLength` — `Map<number, wlEntry[]>` for length-bucketed iteration.

Each view is a property on the wordlist object, built lazily on first access and cached on the instance. Invalidation reuses the existing `cacheVersion$` machinery — when a wordlist's `rawEntries` change, the views go with everything else.

The previously-planned declarative `requires: ['set', 'byLetterBank']` mechanism is parked. The lazy-property-on-Wordlist form is simpler and sufficient — tools just read what they need; no scheduler involvement. Revisit if shared-across-steps caching becomes worth the runtime cost (e.g., a chained pipeline that hits `byLetterBank` from three different tools).

This is the keystroke-perf path for anagram and friends — today's anagram does the work per-keystroke (`sortLetters` across every entry), which compounds badly once a second letter-bank tool lands. The shared view becomes worth its complexity at that point.

New views land as new tools demand them. Don't predict.

### Async, cancellation, spinners

The executor owns the per-row loop, cooperative yielding (6ms wall-clock budget, 1024-iteration bitmask gate on `performance.now()`, `scheduler.yield()` with `setTimeout(0)` fallback), and AbortSignal-based supersession (a new run aborts the in-flight one). Tools' `run` is sync per call; the executor's outer loop yields between rows and abort-throws at yield points.

The old `ctx` API — `forEach`, `filter`, `yield`, `signal` — is gone. Tool bodies are pure-ish predicates / mappers without scheduling concerns.

**Async / network tools** (OneLook, Datamuse — future) will reintroduce a `signal` argument explicitly: `run(entry, params, wordlist, signal)`. The `signal` flows into `fetch` for cancellation. No `ctx` bag; just the one extra argument when it earns its keep.

Slow-pipeline indicator is one global signal (table dim and/or single spinner icon) triggered when total run time crosses 100ms. Per-tool spinner badge on the slow stack row is dropped.

**Workers were considered and rejected** for the same reasons as today (see `../design.md`): cooperative yielding covers the cost without worker bundling and structured-clone overhead. The per-row-dispatch model preserves that decision.

### Annotations

Numeric / string annotations declared at the catalog level (something like `output.annotations: [{ key, label, display }]`) for tools that want to attach extra data to each output: phrase_parsing's parse-quality score, almost_anagram's edit distance, letter_changes' actual `n`. The renderer reads the declaration and renders the value as an inline badge, hover tooltip, or popover detail.

Annotations are display-only — downstream tools see only the chain-row's entries, not annotations. They're a separate channel from the synthesized-score escape hatch (which is for tool-supplied wlEntry scores, not arbitrary metadata).

Highlights — character-range markings inside an atom — are part of the core API (see *Tool API* above). New highlight kinds extend the same `{ kind, start, end }` shape that Behead and Curtail use today.

### Escape hatches

Params are covered by the default renderer dispatch (`type: 'string'` → text input, `'bool'` → checkbox, `'int'` → number, `'enum'` → dropdown, `'char'` → single-letter input). Multi-field tools just declare multiple params; nothing custom needed.

Output is covered by `kind` / highlights / synthesized-score / annotations. No current-catalog tool needs a deeper escape hatch. Two optional fields stay in the spec as a safety valve for hypothetical futures (interactive per-row widget, non-textual visualization, input that genuinely doesn't fit the param-type system):

- `renderItem(atom)` — custom result-line HTML for one atom.
- `renderParams(params, onChange)` — custom stack-row params UI.

Both default to the standard renderers. Add a real motivating case before adding either to a tool.

---

## Catalog

Each entry: `slug(params)` — `kind`, then highlight kinds (`in:` for input-side, `out:` for output-side) and any annotations. Specifics are negotiable; this captures intent. Shipped tools (Anagram, Semordnilap, Behead, Curtail) are marked ✓.

### Pattern matching
- `search(pattern, wholeWord)` — filter · in: `matched` per non-wildcard region, colored by region index.
- `regex(pattern)` — filter · in: `group:n` per capture group.

### Anagrams & letter banks
- `anagram(word)` ✓ — filter.
- `made_from(letters)` — filter.
- `hidden_anagram(word)` — filter · in: `matched` over the hidden-anagram span.
- `almost_anagram(word, n)` — filter · annotation: `editDistance`.
- `letter_bank(word)` — filter.
- `required(letters)` — filter · in: `matched` on each required letter.
- `limited(letters)` — filter.

### Letter patterns
- `kangaroo(word)` — filter · in: `matched` over the joey span.
- `joey(word)` — filter.
- `sandwich(word)` — filter.
- `dead_center(word)` — filter · in: `matched` over the center.
- `letter_changes(word, n)` — filter · in: `shifted` on changed letters · annotation: `actualN`.
- `consonantcy(word)` — filter.
- `vowelcy(word)` — filter.
- `cryptogram(word)` — filter.

### Transforms
- `replace_one(find, with)` — transform · in: `removed` on `find` · out: `inserted` on `with`.
- `replace_all(find, with)` — transform · same highlights, every occurrence.
- `replace_anything(with)` — transform · out: `inserted` on `with`.
- `add_remove_one(s)` — transform · bidirectional emit (unification gives `↔`); highlight on the added/removed substring.
- `add_remove_all(s)` — transform · same logic across all matches.
- `add_prefix(s)` — transform · out: `inserted` on the prefix.
- `add_suffix(s)` — transform · out: `inserted` on the suffix.
- `behead()` ✓ — transform · in: `removed` on the first letter.
- `curtail()` ✓ — transform · in: `removed` on the last letter.
- `side_splitting()` — TBD; transform synthesizing the split form, or filter with a custom renderer. Decide when the tool lands.
- `letter_swap(a, b)` — transform · in & out: `shifted` on swapped positions.
- `regex_replacement(pattern, with)` — transform · in: `removed` on the match · out: `inserted` on the replacement.

### Curiosities
- `palindromes()` — filter.
- `semordnilap()` ✓ — transform · bidirectional emit; unification gives `↔`.
- `isograms()` — filter.
- `supervocalics()` — filter · in: `matched` on each vowel.
- `monovocs()` — filter · in: `matched` on the lone vowel.
- `repeaters()` — filter · in: `matched` on the repeating run.
- `neckouts()` — filter.
- `alphabetical()` — filter.

### Misc
- `spelling_bee(center, outer)` — filter · in: `matched` on the center letter.
- `everything()` — filter · identity (no-op).

### Grawlix-original
- `phrase_parsing()` — transform · synthesizes the joined phrase using `[string, number]` output (score = min over constituents). Open: scoring formula, frequency weighting — separate design conversation.
- `nested_words()` — transform · in: `matched` over the inner span; output entry is the inner word. Stricter and more crossword-specific than Wordlisted's Kangaroo / Sandwich / Joey: outer shell and inserted word both must be real wordlist entries.
- `letter_incrementing(n)` — transform · in & out: `shifted` on incremented letters. A common crossword theme mechanism.
- `anagram_families()` — group · clusters of 2+ mutual anagrams. Deferred until the group-output design conversation.
- *Phrase-level alterations* — likely a flag on existing transforms (`onPhrases: true`) to operate on phrase parses rather than the run-together string. Not its own tool. Wordlisted operates only on the run-together string.

## Capability families

Two families that unlock entire categories of tools, gated on bundling external data.

### Phonetics

The CMU Pronouncing Dictionary maps words to phoneme sequences, opening up an entire class of sound-based operations that letter-based tools can't touch. Largely unexplored territory. Early examples from existing scripts: rhyme finding at the phrase level, phonetic substitutions (swap one phoneme for another across the wordlist), sound-shift pairs (move a phoneme from the front of a word to the end to get a new word/phrase). Many more possibilities. Requires bundling or fetching the CMU dict as a data dependency.

### Thesaurus / semantics

Roget's Thesaurus (available as structured XML) enables meaning-based searches: find synonyms, antonyms, words in the same semantic category. This unlocks tools Wordlisted can't do at all — Kangaroo words that actually verify the joey is a *synonym* of the kangaroo (rather than just a subsequence), theme-entry finders based on semantic relationships, category membership filters. An undertapped gold mine. Requires bundling Roget data.

---

## Groups view

Deferred until `anagram_families` (or another group tool) surfaces — design conversation lands then. The shape below is a sketch of where this is likely to end up so the chain-row model doesn't paint into a corner.

Groups output — N-word clusters from `anagram_families` and similar — extends the atom model but flows across the line rather than stacking vertically:

```
Sort by Max ↓                                              89 families

(3)   4 CARE 50  ·  4 RACE 40  ·  4 ACRE 30
(2)   8 STRESSED 60  ·  8 DESSERTS 40
(5)   5 ALERT 60  ·  5 ALTER 50  ·  5 LATER 60  ·  5 RATEL 20  ·  5 TALER 10
…
```

A list of bullet-separated atoms with a count prefix. Default sort is Max — the anagram-families case is "find a great word that has anagrams I haven't noticed," which max surfaces and min hides. Count is a per-row property; leading `(N)` keeps it visible without dedicated chrome. Min and Max are sort axes, not displayed as numbers — derivable from the row, and showing them next to the atoms would be redundant. When a group is too wide to fit on one line, atoms wrap to the next line indented under the first atom (not under the count) so it reads as continuation.

Groups are the partial exception to strict pseudo-column alignment. Atom counts vary per row, so atoms don't fully cross-row align — they flow across the line separated by bullets. The leading `(N)` count slot does align across rows, giving the eye an anchor; within a row, atoms pack tightly with consistent internal `length word score` shape.

**Sort axes for groups:** Min, Max, Count, Alphabetical.

**Search on group rows** matches loosely against the rendered text — same string the user sees, all atoms in a row visible as one filter target. Default-loose is right for v1; promote to side-specific syntax (`right:un*`) only if usage shows the loose form isn't enough.

---

## Workers: rejected

Web workers were evaluated for moving tool execution off the main thread and rejected — cooperative yielding covers the same ground without the cost. See [`../design.md` § Cooperative runtime](../design.md#cooperative-runtime--supersession-yield-spinners) for the rationale. Revisit only if a built-in tool surfaces whose work fundamentally can't fit the cooperative budget; none of the current or near-term catalog qualifies.

## Result caching: deferred

Tool-result memoization is plausible — input identity is tracked by `cacheVersion$`, and tool params are known — but premature without profiling. The data-shape views above are the load-bearing optimization; per-call result caches are a layer above that.

---

## Related tools & future integrations

### OneLook / Datamuse (onelook.com, datamuse.com/api)
OneLook indexes an enormous dataset of words and phrases — Wikipedia, all major dictionaries, phrase dictionaries, idiom databases, proper nouns, and more. **Scale:** 16,965,772 entries across 805 dictionaries. Far broader than any single wordlist.

**The integration path is their `/api/words?` endpoint** (parameters: `sp=` for spelling pattern, `ml=` for means-like). This appears to be the Datamuse API or very closely related — Datamuse is explicitly designed for programmatic access, no key required.

Capabilities worth noting:
- **Reverse dictionary / semantic search** — find words by meaning or concept. `:widespread epidemic` → "pandemic"; `:winter sport` → skiing, skating, etc. Enormous for crossword construction; nothing like it exists in letter-pattern tools.
- **Meaning-filtered pattern search** — combine a letter pattern with a meaning constraint: `p*:ireland` finds terms starting with P related to Ireland. `bl*:snow` finds blue-ish snow words.
- **Phrase search** — `**winter**` finds multi-word phrases containing "winter" as a whole word. Different from pattern matching.
- **Crossword puzzle mode** — patterns automatically allow optional spaces, so run-together strings match phrases: `h?ttot?ot` → "hot to trot". Direct relevance to Grawlix's phrase-parsing problem.
- **Letter inclusion/exclusion** — `+abcd` restricts results to only those letters; `-abcd` excludes them. Complement to the existing `?`/`*`/`#`/`@` wildcards.
- Standard wildcard syntax (`?`, `*`, `#`, `@`) overlaps heavily with what Grawlix already has.

XWordInfo's arrangement with OneLook may involve something beyond the public API — unknown.

### Umiaq (crosswordnexus.github.io/umiaq)
A crossword pattern-matching tool whose key differentiator over regex is a **variable system**: capital letters represent consistent characters across positions. `ABBA` matches any word where position 1 = position 4 and position 2 = position 3 (NOON, DEED, TOOT). A semicolon separates multi-word patterns: `AB;BA` finds word *pairs* where the letter variables are consistent across both words simultaneously — something regex can't express at all. Results in under a second. Has both a browser UI and a Python CLI. Not a candidate for direct integration or syntax copying, but the variable/multi-pattern concept is worth borrowing from for Grawlix's own search language.

---

## Help documentation

The help redesign (see `help.md`) will happen after the tool gallery is built — tool docs are not needed before then. During development, treat this document as the living record.

**As each tool group ships:** add a note here summarizing what it does and anything a user would need to know that isn't obvious from the tool card itself. These notes become the raw material for the reference guide section and the welcome tour slide.

**When the tool gallery is complete:** the welcome tour gains one or more slides after the current Slide 4 (Searching), and the reference guide gains a tool-gallery section. `help.md` already anticipates this expansion.

---

## Open questions

- **Custom JS tools.** Two paths:
  - *(a) Ephemeral.* A "Custom" gallery card opens a code editor in its stack-row params; the run is the user's code. No persistence beyond URL state — closing the tab loses it.
  - *(b) Registered.* User-named custom tools show up as gallery cards alongside builtins, persisted to localStorage, optionally exportable as a JSON file. Heavier — needs naming, conflict handling, deletion, possibly versioning. Sandboxing concerns (no rogue `fetch` to `localhost`, clear "user-loaded" badging in the gallery) belong here too.

  Start with (a); it proves the API against real user code without committing to the registry surface. Move to (b) only if users surface "I keep retyping this." Real demand is unknown today.
- **OneLook integration.** What does the API actually look like on the wire, and what arrangement does XWordInfo have with them?
- **Phonetics & thesaurus data bundling.** CMU dict and Roget XML — static assets, CDN, or runtime fetch?
- **Multi-input URL encoding.** Tools with multiple inputs (regex with min-length, anagram with bank letters) need a value-internal delimiter or named subkeys. Deferred to the first such tool — encoding choice will land alongside it. (Mirrored in [`../design.md` § URL state](../design.md#url-state).)
- **Whole-word per Search row.** `whole-word` is a bare top-level key today, fine for the single permanent Search row. If the stack ever holds two Search rows, the eventual fix is the multi-input encoding above (likely `search=CAT:w`). Revisit when chaining a Search above a transform becomes possible.
- **Synthetic-atom downstream behavior.** What does `[phrase_parsing, behead]` mean? The synthetic "hot to trot" goes into behead, which tries to look up "ot to trot" in `wordlist.byEntry`, finds nothing, drops the row. Probably degenerates harmlessly but the chained semantic is fuzzy. Revisit if a real workflow surfaces.
- **Async signature when network tools land.** Just a `signal` parameter alongside `(entry, params, wordlist)`, or something richer? Land when OneLook/Datamuse arrives.
- **Group output shape.** When `anagram_families` or another group tool surfaces, the `run` signature and per-row rendering need their own design pass. Sketched in *Groups view* below; not designed.
