# Tools (gallery & mining)

Grawlix's mining side: anagrams, regex, beheadments, curtailments, and a long tail of letter/sound/meaning tricks for both **filling** (looking up words and noting score corrections while you work a grid) and **theme generation** (mining the wordlist for ideas).

Inspiration: [Wordlisted](https://aaronson.org/wordlisted/) by Adam Aaronson. See [`../wordlisted.md`](../wordlisted.md) for a full breakdown of its search modes. Grawlix will cover similar ground and add its own tools.

The gallery is where Grawlix's [project goal](../../README.md#goals) — democratize wordlist manipulation — does most of its work. Constructors who program can write Python to anagram, behead, phonetic-substitute, semantic-filter against their wordlists. The gallery's job is to put those moves in non-programmers' hands. Filter when evaluating a candidate tool: *would a programmer reach for this often enough to write a script?* If yes, it probably belongs.

## Status

The chrome, the pipeline runtime, and four tools (Anagram, Semordnilap, Behead, Curtail) are shipped — see [`../design.md` § Tool gallery & stack](../design.md#tool-gallery--stack) for the executor, runtime normalization, pair-row display, per-kind sort, and the highlights pipeline. The `removed` highlight kind (struck-through, used by Behead and Curtail) is wired up; other highlight kinds (kept/inserted/shifted/group:N) land as tools start emitting them. The rest of this doc covers what's still planned: the catalog of tools that have records but no `run` yet, the indexed-view runtime that several anagram-family tools need, groups output kind, gallery polish (category picker, search), result download, async/cancellation UX for network-bound tools, and the OneLook / Datamuse / Umiaq integrations.

## Sequencing — runtime support before the family

When the next tool needs runtime support that doesn't exist yet, land the runtime first, then the tool. Specifically: tools that want a shared indexed view (see *Indexed input views* below) should wait until the view runtime is in place, because building the index inline inside each `run` re-pays the cost on every keystroke.

Concretely:

- **Letter-bank family** (`subanagram`, `made_from`, `anagram_with`, `anagram_families`) — wait for `byLetterBank` shared view. Anagram already pays the cost per-keystroke for one tool; a second letter-bank tool without the shared view doubles it. Land the view alongside the first new family member.
- **Membership family** (`kangaroo`, `joey`, `sandwich`, `nested_words`) — wait for `input.set` shared view. Behead/curtail build a Map per call which is fine for a 200K wordlist, but a chained `behead → sandwich` repeats the build twice per keystroke. Same gate.
- **Network-bound tools** (OneLook, Datamuse) — wait for cooperative-yielding `ctx`, async `run` plumbing, and the spinner UX. A synchronous network call inside today's executor would freeze the UI on every keystroke.
- **Phonetics / thesaurus families** — wait for the bundled data dependency. Until CMU dict and Roget XML are available at runtime, the tools can't run.

For tools that fit the current runtime as-is (`palindromes`, `isograms`, `supervocalics`, etc. — purely letter-pattern checks over `entryNorm`), no gate; just add the `run` and ship.

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

The basic catalog record shape (`name`, `icon`, `category`, `desc`, `example`, `params`, `output`, optional `run`) plus the pipeline executor are shipped. Several extensions are planned for tool families that don't fit the simple shape yet.

### Indexed input views (the `requires` mechanism)

The wordlist arrives as a wlEntry array by default. Several tools want indexed views built lazily by the runtime:

- `input.set` — `Set<entryNorm>` for O(1) membership checks (kangaroo, joey, sandwich, nested_words, behead).
- `input.byLetterBank` — `Map<sortedLetters, wlEntry[]>` keyed by sorted-letters; instant anagram lookup (anagram, anagram_with, anagram_families, made_from).
- `input.byLength` — `Map<number, wlEntry[]>` for length-bucketed iteration.

A tool declares what it wants in `requires: ['set', 'byLetterBank']`; the runtime ensures those views are built before `run` is called and reuses them across calls as long as the input set doesn't change. Cache invalidation reuses the existing `cacheVersion$` machinery.

This is the keystroke-perf path for anagram and friends — today's anagram does the work per-keystroke (`sortLetters(entryNorm)` across every entry), which is fine for a single tool but compounds badly. The shared view becomes worth the runtime once a second letter-bank tool lands.

New views land as new tools demand them. Don't predict.

Builtin views are shared across calls. Custom JS tools can ask for them too but can't author their own — keeps the cache key simple (input identity + view name).

### Async, cancellation, spinners

**Cooperative multitasking is the documented path** for keeping the main thread responsive during tool runs. Tools become async, hot loops yield periodically, and in-flight runs cancel when superseded. This shape lets live-as-you-type updates stay snappy regardless of total tool work — the browser gets a frame to render between chunks, so keystrokes never feel sluggish even when a tool takes hundreds of ms total. Workers were considered and rejected (see *Workers: rejected* below).

- **`run` becomes async-by-default.** Synchronous tools still `return`; async tools `await`. The runtime always treats the call as a promise. Today's executor calls `run` synchronously — the call site needs to be promised before any of this can land.
- **Tools yield by time, not iteration count.** Track elapsed since last yield and yield when it crosses ~5–8ms (about half a frame). Iteration-count chunking blows out the overhead budget on fast inner loops: 1K iterations of ~1μs work yields every ~1ms, so a 500K-entry filter would pay hundreds of ms in pure yield overhead alone. Ad-hoc loops gate the time check behind a cheap bitmask (`(i & 1023) === 0`) so `performance.now()` doesn't run every iteration; the helpers below handle this internally. The yield itself is `await ctx.yield()` — a shim that prefers `scheduler.yield()` where available and falls back to `await new Promise(r => setTimeout(r, 0))`. The browser drains pending input events and paints between chunks; keystroke latency stays low independent of total run time.
- **In-flight runs cancel when superseded.** The `ctx` argument (not yet plumbed) carries an `aborted` flag, AbortSignal-style. Tools observe it at every yield point — a superseded run sees `aborted` on its next chunk boundary, returns immediately, and its result is discarded. Network-bound tools pass `ctx.signal` directly to `fetch`.
- **Spinners on slow rows.** Tool rows whose run exceeds ~100ms badge with a progress indicator; the result list grays out. Below the threshold, no UI flicker.

**Ergonomic helpers on `ctx`.** Tool authors don't write the yield bookkeeping manually. The runtime exposes chunked-iteration helpers that own time-tracking, yielding, and abort propagation:

- `ctx.filter(input, predicate)` — chunked filter.
- `ctx.forEach(input, fn)` — chunked iteration where the body pushes onto an accumulator the tool owns. Covers pair-emit shapes that aren't a pure filter.
- `ctx.yield()` — manual yield for ad-hoc loops that don't fit `filter` or `forEach`.
- `ctx.aborted` / `ctx.signal` — raw abort check and AbortSignal for `fetch`.

Helpers throw an `AbortError` (DOMException, web-standard name) at a yield boundary when `ctx.aborted` flips; the executor catches and discards. Throwing instead of returning a sentinel lets tool bodies chain multiple helper calls without per-call bail-out plumbing — an aborted run unwinds naturally.

Under this API the catalog reads compactly:

```js
// Anagram — one line
return ctx.filter(input, e => sortLetters(e.entryNorm) === target);

// Behead — one helper call inside the iteration body
const byNorm = new Map(input.map(e => [e.entryNorm, e]));
const out = [];
await ctx.forEach(input, e => {
  if (e.entryNorm.length < 2) return;
  const match = byNorm.get(e.entryNorm.slice(1));
  if (match) out.push({ a: e, b: match, highlights: { a: [{ kind: 'removed', start: 0, end: 1 }] } });
});
return out;
```

The inline `new Map(input.map(...))` build is unyielded — fine at its one-time ~30ms cost today, eventually subsumed by the indexed-views runtime (see *Indexed input views* above) that builds shared structures once at the executor boundary and hands them in via `input.set` / `input.byLetterBank` / etc.

The cooperative model relies on tool-author discipline — a hot loop that never yields freezes the UI. Built-in tools are under our control, so this is a code-review concern, the same as missing cancellation checks. Custom JS tools (see *Open questions* below) are held to the same convention; if a user-authored tool ignores it, the consequence is locking up the author's own browser, which is their problem to manage. No CPU sandbox is needed.

### Annotations

Numeric / string annotations declared in `output.annotations: [{ key, label, display }]`. The renderer reads the declaration, knows whether to render the value as a small inline badge near the atom, a hover tooltip, or popover detail. Use cases: phrase_parsing's parse-quality score, almost_anagram's edit distance, letter_changes' actual `n`.

Annotations are display-only — chain projection drops them. A downstream tool sees only the projected wlEntry list.

(The highlights system — character-range markings inside an atom — shipped with Behead and Curtail; see [`../design.md` § Highlights pipeline](../design.md#highlights-pipeline). New highlight kinds extend the same `{ kind, start, end }` shape.)

### Escape hatches

Params are covered by the default renderer dispatch (`type: 'string'` → text input, `'bool'` → checkbox, `'int'` → number, `'enum'` → dropdown, `'char'` → single-letter input). Multi-field tools just declare multiple params; nothing custom needed. Search's whole-word toggle is a `bool` param, not an escape hatch.

Output is covered by kind / relation / highlights / annotations. Phrase parsing returns plain strings that happen to contain spaces; the default `words` renderer displays them normally. Fancier word-break treatment (dot separators, per-word color) would fit the highlight system as `'word:n'` kinds — still no custom render needed.

No current-catalog tool needs an escape hatch. Two optional fields stay in the spec as a safety valve for hypothetical futures — an interactive per-row widget, a non-textual visualization, an input that genuinely doesn't fit the param-type system (hex-grid letter picker, visual region selector):

- `renderItem(item, ctx)` — custom result-cell HTML for one item.
- `renderParams(params, onChange)` — custom stack-row params UI.

Both default to the standard renderers. Add a real motivating case before adding either to a tool — if every concrete tool fits the schema, the schema is doing its job.

---

## Catalog

Each entry: `slug(params)` — output kind, plus relation/projection for non-`words` and any notable highlights or annotations. Specifics are negotiable; this captures intent. Shipped tools (Anagram, Semordnilap) are marked ✓.

### Pattern matching
- `search(pattern, wholeWord)` — words. Highlights: `matched` per non-wildcard region, colored by region index.
- `regex(pattern)` — words. Highlights: `group:n` per capture group.

### Anagrams & letter banks
- `anagram(word)` ✓ — words.
- `made_from(letters)` — words.
- `hidden_anagram(word)` — words. Highlights: `matched` over the hidden-anagram span.
- `almost_anagram(word, n)` — words. Annotation: `editDistance`.
- `letter_bank(word)` — words.
- `required(letters)` — words. Highlights: `matched` on each required letter.
- `limited(letters)` — words.

### Letter patterns
- `kangaroo(word)` — words. Highlights: `matched` over the joey span.
- `joey(word)` — words.
- `sandwich(word)` — words.
- `dead_center(word)` — words. Highlights: `matched` over the center.
- `letter_changes(word, n)` — words. Highlights: `shifted` on changed letters. Annotation: `actualN`.
- `consonantcy(word)` — words.
- `vowelcy(word)` — words.
- `cryptogram(word)` — words.

### Pair transforms
- `replace_one(find, with)` — pair / transform · projects `to`. Highlights: `removed` on `from`, `inserted` on `to`.
- `replace_all(find, with)` — pair / transform · projects `to`. Highlights as above for every occurrence.
- `replace_anything(with)` — pair / transform · projects `to`.
- `add_remove_one(s)` — pair / symmetric · projects `both`. Highlight on the added/removed substring.
- `add_remove_all(s)` — pair / symmetric · projects `both`.
- `add_prefix(s)` — pair / transform · projects `to`. Highlight: `inserted` on the prefix.
- `add_suffix(s)` — pair / transform · projects `to`. Highlight: `inserted` on the suffix.
- `anagram_with(word)` — pair / symmetric · projects `both`.
- `behead()` ✓ — pair / transform · projects `to`. Highlight: `removed` on `from[0]`.
- `curtail()` ✓ — pair / transform · projects `to`. Highlight: `removed` on `from[-1]`.
- `side_splitting()` — TBD; either pair / contains (full word + split form) or words with a custom `renderItem`. Decide when the tool lands.
- `letter_swap(a, b)` — pair / transform · projects `to`. Highlight: `shifted` on swapped positions.
- `regex_replacement(pattern, with)` — pair / transform · projects `to`. Highlights for the matched and replaced regions.

### Curiosities
- `palindromes()` — words.
- `semordnilap()` ✓ — pair / symmetric · projects `both`.
- `isograms()` — words.
- `supervocalics()` — words. Highlights: `matched` on each vowel.
- `monovocs()` — words. Highlights: `matched` on the lone vowel.
- `repeaters()` — words. Highlights: `matched` on the repeating run.
- `neckouts()` — words.
- `alphabetical()` — words.

### Misc
- `spelling_bee(center, outer)` — words. Highlights: `matched` on the center letter.
- `everything()` — words. Identity tool.

### Grawlix-original
- `phrase_parsing()` — words (results contain spaces). Annotation: `parseScore` — drives noise reduction so good parses sort high. Open: scoring formula, frequency weighting; treat as a separate design conversation.
- `nested_words()` — pair / contains · projects `outer`. Highlights: `matched` over the inner span. Stricter and more crossword-specific than Wordlisted's Kangaroo / Sandwich / Joey: outer shell and inserted word both must be real words.
- `letter_incrementing(n)` — pair / transform · projects `to`. Highlights: `shifted` on incremented letters. A common crossword theme mechanism.
- `anagram_families()` — group · projects `all`. Mining for theme material — every cluster of 2+ mutual anagrams in the wordlist.
- *Phrase-level alterations* — likely a flag on existing pair transforms (`onPhrases: true`) to operate on multi-word phrase parses rather than the run-together string. Not its own tool. Wordlisted operates only on the run-together string.

## Capability families

Two families that unlock entire categories of tools, gated on bundling external data.

### Phonetics

The CMU Pronouncing Dictionary maps words to phoneme sequences, opening up an entire class of sound-based operations that letter-based tools can't touch. Largely unexplored territory. Early examples from existing scripts: rhyme finding at the phrase level, phonetic substitutions (swap one phoneme for another across the wordlist), sound-shift pairs (move a phoneme from the front of a word to the end to get a new word/phrase). Many more possibilities. Requires bundling or fetching the CMU dict as a data dependency.

### Thesaurus / semantics

Roget's Thesaurus (available as structured XML) enables meaning-based searches: find synonyms, antonyms, words in the same semantic category. This unlocks tools Wordlisted can't do at all — Kangaroo words that actually verify the joey is a *synonym* of the kangaroo (rather than just a subsequence), theme-entry finders based on semantic relationships, category membership filters. An undertapped gold mine. Requires bundling Roget data.

---

## Groups view

Pair display is shipped (see [`../design.md` § Pair-row display](../design.md#pair-row-display)). Groups output — N-word clusters from `anagram_families` and similar — extends the same atom model but flows across the line:

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

Web workers were considered for moving tool execution off the main thread and rejected. Cooperative yielding (see *Async, cancellation, spinners* above) covers what workers would have bought, without their cost.

- **Cooperative yielding already secures UI responsiveness.** Tools yield inside hot loops; the browser drains input and paints between chunks; keystroke latency stays low independent of total run time. The thing workers would offer over today's main-thread compute — main thread stays free during work — is the thing yielding already delivers.
- **No untrusted code to sandbox.** Custom JS tools (see *Open questions* below) are user-authored and run in the user's own browser. The blast radius of a misbehaving custom tool is one tab on its author's own machine. Users writing tools are guided to the same yield-and-cancel discipline as built-ins; if they ignore it, they only lock up themselves. There's no second party to protect, so no CPU sandbox is warranted.
- **Cost is significant.** No build step makes worker bundling awkward, and the naïve "copy 500K entries every keystroke" shape serializes ~25 MB through structured clone (~150–300ms each direction at typical throughput) — likely slower than the main-thread compute it would replace. The viable shape — worker holds the wordlist, main thread sends only queries — pulls a state-sync protocol into the entire mutation surface (My Edits patches mirrored worker-side, source/rescore-rule changes re-shipped). Meaningful complexity for a marginal gain over what yielding already provides.

Revisit only if a built-in tool surfaces whose work fundamentally can't fit the cooperative budget — bulk preprocessing where chunked yields can't hide enough latency to keep results from feeling delayed. None of the current or near-term catalog qualifies.

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
- **Tool-level column customization for pair (and group) output.** Pair rows render `count len entry score · len entry score` uniformly today, but some tools have redundant columns — semordnilap always has equal-length sides, so showing length twice is noise. The minimal fix is a per-tool flag like `equalLength: true` (or more generally, a list of suppressed columns). The maximal version is letting each tool declare its full column schema (names, projections, alignment) and the renderer becomes a pure consumer — closer to a real spreadsheet abstraction. Punt until a second tool hits the same wall and the right shape is obvious; one example isn't enough to design against.
