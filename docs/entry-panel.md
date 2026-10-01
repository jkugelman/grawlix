# Entry panel

The entry panel (`EntryPanel`, in [`ui/entries-table.js`](../site/src/ui/entries-table.js)) opens on one entry from the entries table.
It edits the entry's text, score, and comment, shows every wordlist that carries the entry, proposes the entry's canonical spelling, lists related entries, and steps through a run of entries without closing.
Edits always land in My Edits, so they surface wherever My Edits participates — All Wordlists (where My Edits sits on top by default, so the edit wins) and the My Edits scope — but never in another list's scoped view, which always shows that list's own values.
The worker messages it rides (`fetchEditSeed`, `fetchProvenance`, `fetchFamily`, `fetchSpaceOut`, `fetchWordCase`, `fetchWinners` for the walk, `planEdit`, `editEntry`, `deleteEntry`) are specified in [`worker-protocol.md`](worker-protocol.md), and its URL form in [`design.md`](design.md) § *Entry panel encoding*.

## Opening and closing

**Open an atom → EntryPanel.**
A click on the **entry text** (desktop), a **tap** (touch), or a **double-click** anywhere but the score opens the panel for that atom; a single desktop click elsewhere on the row selects it instead ([`design.md`](design.md) § *Click targets*).
A *score* click in the merged or My Edits view opens the tier quick-pick ([`design.md`](design.md) § *The score cell is a tier quick-pick*) rather than the panel; in a foreign single-list scope a score click opens the read-only panel instead.
Its content — Entry/Score/Comment inputs, the cross-wordlist provenance panel, the live edit preview, and the staged-delete trash — is covered in the sections below.
Enter commits and closes; Escape reverts and closes; Tab moves between fields without committing (nothing lands until Enter or Save).
The panel is **modal**: a backdrop scrim (`#entry-panel-backdrop`, `z-index` just under the panel) dims the page and intercepts every click outside the panel, so the rest of the app is inert until it closes.
**Any** outside click closes it, saving first if there is anything to save (§ *Editing*) — a click on another entry closes rather than re-targets (there is no re-targeting; the page behind can't be reached while the panel is open) — as do the browser Back gesture/button and a panel re-mount, but **scroll and resize do not**.
Opening the panel first dismisses the other floating surfaces (`ScorePicker`, `SortMenu`, the `+N more` popover), which share its `z-index` and would otherwise float above the scrim.
The panel is `position: fixed` and positioned purely in CSS — a fixed-width column docked to the right edge on wide viewports, a full-screen overlay below ~1000px — so it never chases a cell or floats free of one; a scroll or a viewport crossing reflows it in place rather than closing it.
Closing on scroll instead would let iOS dismiss an edit the instant it opened: focusing the panel's input scrolls it above the soft keyboard, and that scroll would read as a scroll-to-dismiss.
Both shells float *over* the page rather than reserving space — the wide column overlays the table's right edge and the narrow overlay covers it, so the table keeps its full width either way, and both slide in from the right on open.
To dismiss it the panel parks a history entry on open, so the browser Back gesture (the left-edge swipe a phone user reaches for) closes the panel instead of navigating the app away; a UI close pops that entry so a later Back navigates normally.

Entry, comment, arbitrary-score edits and the rescore mapping live in the panel — not as in-cell `<input>` swaps and not in a hover-only tooltip.
The Comment and Source columns *display* that data on the at-rest list when the viewport is wide enough (see [`pipeline.md`](pipeline.md) § *Chain-row display*); editing routes through the panel, which the entry cell opens (the comment cell selects the row).
On narrow viewports the columns drop and the panel is the only path to them.

**The panel survives background re-renders.**
A new pipeline result while the panel is open — a disk-sync reconcile, an auto-update, the re-run after a save elsewhere — would otherwise blow away the row it tracks.
`rebindEntry` re-binds the open panel to its entry's row in the fresh result (reapplying `.active` via `rebindRow`), and preserves the user's in-progress field values when they're mid-edit rather than resetting them.
A save itself closes the panel; since field edits don't commit until Enter/Save, tabbing score → comment keeps it open naturally.

## The cross-wordlist view

**The entry panel is the cross-wordlist view.**
With a scoped table showing one wordlist, the entry panel (`EntryPanel`) carries the cross-wordlist picture.
The contributor table sits under an **Appears in** heading.
In an editable scope (All Wordlists, My Edits) it is an editor whose fields seed the merge winner and whose edits route to My Edits; in a **foreign single-list scope it is a read-only inspector** — the Entry/Score/Comment fields show that list's *own* entry verbatim (no merged-winner inheritance), read-only, with a Close button in place of Save and every *other* row in the provenance table below dimmed (grayscale, reusing the disabled-row treatment, like an out-of-scope Source icon) so the list's own row reads as the focus.
It is read-only because an edit there would land in My Edits, which the scoped view doesn't show, and vanish from under the user.
Either way it lists every contributing wordlist, in priority order, with that wordlist's actual entry text, effective score, and comment, **including disabled and non-winning** contributors; a bare entry (no fixed spelling) unifies into every spelling, so it shows under each.
This (a) serves the trust case (a constructor who doesn't auto-believe the top-priority list sees whether another list, even one they aren't merging, scored the entry differently); (b) *is* the comparison surface when scoped; and (c) fixes the "lying Source column" — the table attributes one source per row, but display, score, and comment can each come from a different contributor (comment fall-through is designed to do this — [`wordlists.md`](wordlists.md) § *Rich wordlists*).
A **concrete** click's other spellings (`Boney M.` vs `Boney M`) are not collapsed into this table — they ride the panel's Related entries (§ *Related entries*), each its own click-through with its own provenance — while a **bare** click, being a wildcard, lists them all here (see below).

*Which contributors show.*
A **concrete** click scopes the panel to that spelling, mirroring the merged view's own display eligibility (`concreteDisplay`/`isDistinguishing`, [`wordlists.md`](wordlists.md) § *Rich wordlists*): a wordlist contributes when it spells the entry the way you clicked, or holds a bare entry (no fixed spelling) that unifies with any spelling.
So clicking `the IRS` lists the lists that spell it `the IRS` plus the bare ones; `Theirs` and a plain `theirs` are *different* rows you reach through Related entries, each opening its own table.
A **bare** click carries no fixed spelling — it's a wildcard that unifies with every spelling — so it drops the scoping and lists all of the norm's contributors, whatever they spell it.
So clicking a bare `hardscience` whose merged form is spelled `hard science` (from another list) shows that spelled contributor, revealing where the spelling came from.
Collapsing a bare click to its norm spelling would silently drop exactly those concrete siblings.
The walk is O(sources) over each wordlist's `_rescoredByNorm` index and includes disabled/non-winning contributors, so it can't reuse the enabled-only merge resolver — the panel is its own component.
Layout matches the entries table — Entry · Score · Comment · Source, priority order top-down, disabled rows dimmed, no winner markup; the Entry cell shows each wordlist's *actual text* so the casing distinction is visible without exposing norm/display jargon.
Scores are effective (rescored) only — per-wordlist raw scores are on incomparable scales.

## Editing

*Editing is raw, not rescored.*
Edits always route to My Edits (unchanged), and the panel's score input edits the **raw** stored value (what My Edits keeps), not the displayed effective score.
In the common pass-through case raw == rescored and the distinction is invisible; when My Edits carries non-pass-through rescore rules the two diverge and the My Edits preview row's score cell shows the `raw → rescored` mapping so the edit isn't silently lossy.
Rescoring is many-to-one and non-invertible, so editing the rescored value couldn't be stored faithfully.
The editor seeds from the All Wordlists merge winner for the clicked `(norm, display)`; a bare click whose norm has spelled variants edits the first-alphabetical variant (an arbitrary-but-deterministic pick that overrides just that one, sidestepping bare-overrides-everything), and the save diffs against that seed so an unchanged scoped save writes no spurious edit.

*Create vs. rename — two gestures, one job each.*
Clicking a row opens the panel in **edit** mode and always *replaces* the clicked entry (a rename when the text changes); the **＋** button opens it in **create** mode and only ever adds.
There is no ambiguous "did I mean to add or replace?" middle ground — the gesture *is* the intent — and the header and Save button announce it as a matched pair (`headerText`/`saveLabel`): a pristine edit panel is titled *View entry*, becoming *Edit entry* / Save once a field changes and *Rename entry* / Rename the moment the text diverges; a staged delete reads *Delete entry* / Delete; ＋ is *Add entry* / Add; a foreign scope's panel is *View entry (read-only)*.
The one distinction absorbs a stack of merge edge cases the user would otherwise have to reason about (same-norm siblings, bare-vs-spelled collapse, foreign overrides), and the live preview shows the resulting writes before commit so the machinery never surprises.
Add-vs-replace keys on the gesture rather than on the entry's content (whether the typed text is plain or spelled): content can't tell whether you mean to refine an entry or add a sibling, but the gesture you chose can.
The ＋ is a floating button (`#add-fab`) in the bottom-right corner, also bound to **Alt+A**.
It opens prefilled with the current search text when that is a literal (non-wildcard) query matching nothing in the scope (`newEntrySeedQuery`); otherwise it opens blank.
Typing into ＋ an entry My Edits already shows is refused rather than silently absorbed — Save stays disabled under an *already exists* note — but that note's **Edit it instead** link opens the existing entry, flipping the panel into edit mode on it, so the block redirects instead of dead-ending.
A **second, advisory note** carries the same link when the typed norm is already carried by *some other* wordlist: there the add is perfectly legitimate (laying a My Edits row over a foreign one **is** how you rescore one), so nothing is blocked and Save stays live — but typing a name to *find* an entry is a real gesture, and the ＋ panel is where it lands.
It **names the merged spelling** when that differs from what was typed (`King Tut already exists` for a typed `kingtut`), which is the case worth reading: it's the reason to jump rather than add a rival spelling of a norm you already have.
The **same note serves both cases** — same wording, same styling — because it says the same helpful thing either way: *this is already here, go edit it*.
It's styled as a pair with the rename hint that shares its slot (muted sentence, accented link), so a panel showing either one reads the same.
The Save button carries the one difference, so giving the save-gate a second visual voice would only make the routine case (adding an entry another list already has) read as a fault it isn't.
The note **outranks the rename hint** in the slot below Entry — *this already exists, edit it* beats *rename it to X*, and two stacked `↳` lines read as a pile of advice rather than a suggestion.
Without it the only click-through was a collision with My Edits itself, so the shortcut worked exactly for the entries you'd already edited and silently failed for the rest. ＋ never quietly becomes an in-place update: that would collapse the add-vs-replace distinction the gesture exists to draw.

*Renaming what you don't own — the downscore.*
Because edits only live in My Edits, a rename is a true rewrite only for a My-Edits entry; an entry sourced from another wordlist can't be deleted.
A same-norm rename still reads as one (the foreign bare collapses into the new rich display — [`wordlists.md`](wordlists.md) § *Rich wordlists*), but a norm-changing rename leaves the old norm behind, so the save silently adds a **downscore**: a bare (null-display) My Edits override at the **trash score** (a `mergedSettings` setting, default 0) that wildcards every spelling of the old norm across lower lists and, at top priority, wins them to trash.
The trigger is exact — edit mode, norm changed, and a non-My-Edits *enabled* source still carries the old norm (a My Edits sibling is deliberate and isn't trashed; a fully-removed norm has nothing to trash).
It's silent and automatic because the gesture already disambiguates: editing `color`→`colour` *means* "colour instead of color," and wanting both is the ＋ gesture, not an edit — so there's nothing to confirm.

*The keep copies.*
Landing an entry — by create, or by renaming one onto a new norm — whose norm a *foreign* list spells differently collapses the two spellings into one merged row unless My Edits is made *distinguishing* for the norm, so the write copies the other spelling in.
It runs **both directions**. **keep-bare**: a *rich* entry (`the IRS`) landing beside a foreign *bare* (`theirs`, `display: null`) would absorb that bare into the new spelling and hide it (the cross-source-collapse bug class), so it copies the foreign bare in, snapshotting its effective score. **keep-rich** is the mirror: a *bare* entry (`pdfs`) beside a foreign *spelling* (`PDFs`) — the bare is a wildcard that wins every variant and shows under the foreign spelling, hiding the lowercase the user actually typed — so it copies each *displayed* spelling in (resolved through the shared per-norm `computeMergedBucket`, since a spelling's winner can itself be a bare wildcard, so the snapshot carries the score *shown*, not the rich speller's).
Create and a norm-changing rename share this through one helper (`keepCopies`) so the gestures stay symmetric: renaming `xyz` onto `pdfs` keeps your `pdfs` row beside the foreign `PDFs` exactly as creating it would.
A *same-norm* edit (enriching `ocean`→`Ocean`) doesn't move the entry to a new norm, so it needs no copy.
Both directions err toward visible-over-hidden: the false positive (`helenoftroy` + a created `Helen of Troy`, the same word) is a deletable duplicate row; the case they protect would otherwise hide a valid word.

The duplicate **block is merge-aware** — it refuses only a spelling My Edits already *shows*: an explicit `the IRS` it contributes, or a bare rendering as its own lowercase norm.
A bare *hidden* under a foreign spelling (My Edits' `theirs` showing as `the IRS`) is **not** a visible duplicate of a typed `theirs`, so rather than block it **splits**: the typed entry rescores the hidden bare in place, and keep-rich copies the shown spelling out — leaving your `theirs;30` beside a preserved `the IRS;20`.
A match on a *foreign* list alone never blocks: its own score and merge priority are the point of the add, so only a spelling My Edits visibly owns is refused.

keep-rich is load-bearing, not cosmetic.
A wordlist *file* is untrusted — its entries are written however the source happened to, so bare-vs-rich is a casing-heuristic *guess* ([`wordlists.md`](wordlists.md) § *Rich wordlists*) and a bare entry is a cross-spelling wildcard.
Hand-typed UI input is **authoritative** — its own spelling, taken at face value.
But a typed *lowercase* entry equals its norm, carrying nothing beyond it, so it's stored as the bare wildcard it is ([`wordlists.md`](wordlists.md) § *Rich wordlists*, *Hand-typed input is rich*): a lone typed `pdfs` shows under a foreign `PDFs`. keep-rich is what keeps the user's entry a distinct row anyway — the copied sibling makes My Edits *distinguishing*, so `pdfs` and `PDFs` both render.
My Edits is genuinely mixed (typed entries beside imported bares), so this can't be a blanket "trust My Edits" rule — it's per-entry, decided by whether the typed display equals its norm.

*One planner, run in the worker.*
The create-vs-rename decision is a single pure function (`engine/edit-plan.js`, `planEntryWrite`) returning a **write-set** — deletes plus upserts, with a `primary` to re-bind the panel to.
To decide the **merge-aware duplicate block** (refuse only a spelling My Edits *visibly* shows — not a bare hidden under a foreign one), the keep-rich snapshot (the displayed winner per spelling), and the downscore/keep-bare side-writes, it needs every enabled source's rescored map (`getRescoredByNorm`) resolved through the shared `computeMergedBucket` — a flat per-source scan can't resolve the displayed winner.
That per-source data lives only in the **worker**, so the planner runs there: main asks via `planEdit` and gets the write-set back on `editPlan`.
The plan never branches on the typed score/comment (they flow only as inline values into the upserts), so main caches the **structural** plan — re-fetching it on an entry-text / mode / seed change, never on a score/comment keystroke — and re-injects the live score/comment locally, keeping the preview, the Save-gate, and both "already exists" notes synchronous against an at-most-one-keystroke-stale cache (the same async-reply-with-token discipline the provenance table uses).
A save awaits a fresh plan with the real values.
The worker applies the resolved write-set verbatim and never re-plans, so one merge view alone decides an edit.
The `editEntry` command carries that write-set, and `applyEditsWriteSet` is the single shared mutation main and worker both run — one mutation path, no second copy to keep in lockstep — which also returns the inverse set that powers undo, so a rename-plus-downscore-plus-keep-copy or a create-plus-keep-copy reverts as one batch.
See [`worker-protocol.md`](worker-protocol.md) § `planEdit` / `editEntry`.

*The panel previews the pending write.*
While the user edits, the panel overlays the pending My Edits state onto the contributor list: a row synthesized at My Edits' top-priority slot when the norm isn't carried yet (an *added* row), or the existing My Edits row updated in place (a *changed* row) — both shown bold.
A rename also strikes through the row it replaces, and the plan's side-writes — a downscore, a keep copy — appear as extra bold *added* rows, so the whole write-set is visible before Save.
The effective score is computed client-side via the same `rescoreEntry` the table preview uses, so the overlay needs no worker round-trip; only an entry-text change (a new norm → different contributors) re-queries the worker, while score/comment edits just re-render the local overlay.
The `raw → rescored` mapping rides the preview row's score cell, so the panel needs no standalone rescore note.
**Delete is staged, not immediate.**
Each saved My Edits contributor row carries a trash that *toggles* a pending deletion — the row strikes through, the trash gains a slash, the inputs disable — and **Save** commits it (then the usual undo toast), while **Cancel** or **Escape** discards it.
Routing every change — add, edit, delete — through one preview-then-Save model is why the footer carries no "Saves to My Edits" caption: the My Edits row appearing in the panel *is* the "saves here" signal, and the toggle gives a free undo before committing.
The footer tracks that dirty signal directly — a pristine edit panel shows a lone **Close** (its `.entry-panel-foot` left un-`dirty`), and **Cancel · Save** replace it the instant an edit, staged delete, or staged adopt gives it something to save (`panelHasChanges`; a create panel always offers Add, and a changed-but-blocked edit keeps a disabled Save with its reason rather than reverting to a bare Close).
**Enter** follows the footer — it saves a dirty panel and closes a pristine one (`submitOrClose`) — so the lone Close answers Enter like any default button.
`pendingWritesChange` mirrors `saveEdit`'s no-op test so an untouched panel previews nothing.
*Leaving saves; canceling discards.*
The split is **navigation vs. repudiation**, not deliberate vs. accidental.
**Cancel** and **Escape** repudiate the edit and throw it away outright — Escape being the keyboard Cancel, the documented counterpart to Enter, and the reflex key for "I typed in the wrong field."
The **scrim**, the **✕**, and the **browser Back** all mean "leave this surface," so they *commit*: `dismiss` routes a dirty panel (a staged delete/adopt, or `pendingWritesChange` — create counts only once the fields form a savable entry) straight through `submit`.
That matches what navigating already does — a walk step or a related-entry click auto-commits too — so leaving an entry never depends on *how* you left it, and a save is the recoverable default (Cancel is still there, and a rename/create/adopt leaves an undo toast) where a discard is not.
The **✕ is on the saving side because it is not always an ✕**: below 1000px `app.css` swaps its glyph for a **back arrow**, making it the phone's close button, where the panel is full-screen and leaves no scrim to tap.
An ✕ that discarded would leave save-on-close desktop-only and would put the back *arrow* and the back *gesture* in direct contradiction.
The refuse-and-nudge survives as the fallback for the one case saving can't handle — a **save that can't go through**, an invalid field or a blocked rename, where neither committing nor dropping is available: `submit` returns false, keeps the panel open with the offending field focused, and `nudgeFooter` shakes the footer's Cancel/Save (a `.nudge` class on `.entry-panel-foot`) so the swallowed click reads as "fix this or Cancel" rather than a dead one.
**Back is the exception that can't refuse**: its pop has already landed, so there is no panel left to hold open and an unsavable edit is dropped instead.
*One write path.*
Save/Enter, a walk step, and every committing dismissal all run the same `commitPending`, which writes and reports whether anything is still pending but deliberately **never closes** — each caller ends differently, and Back is why: folding the close in would fire a *second* `history.back()` on a pop that already happened.
`submit` is that call plus `close()`; a walk step is that call plus a navigation; Back is that call alone, ignoring the "can't write" answer the other two must respect.
Back closes cleanly even though the navigation has already fired: the panel parked its own history entry on open, so Back just pops to the page beneath and `onPopState` clears the panel in place.

*Adopt — claiming the winner into My Edits.*
A save that merely re-states the merge winner is suppressed as a no-op (above), but the gesture is sometimes deliberate: the user wants My Edits to *own* the displayed entry — to upgrade a plain-imported bare (`aaabond`) to a richer same-norm spelling another list supplies (`AAA bond`), or to pull an entry only a foreign list carries into My Edits unchanged.
Neither is reachable by editing, because the fields already show the winner.
A quiet **Add to My Edits** text-link — bottom-left of the footer, the slot the rescore editor reserves for rare actions — appears whenever an unchanged save would be a no-op yet My Edits doesn't already hold that exact `(norm, display)`; it reads **Update My Edits** when a bare My Edits entry of the norm will be upgraded in place.
Clicking it *stages* the write: the link gives way to the previewed My Edits row (an *added* row, or the existing one struck-and-replaced for an upgrade), which carries a trash that toggles the stage back off — mirroring the delete-staging trash — and Save enables, keeping the preview-then-Save model rather than committing on click.
Editing any field reverts it to an ordinary save.
It commits through a dedicated `adopt` mode that skips the no-op guard but otherwise plans through the edit branch, so undo, the downscore, and the write-set machinery are unchanged.
The wrinkle is the baseline: the write is planned against My Edits' *bare* entry, not the merge winner, so the planner renames the bare into the rich spelling (delete bare, add rich) instead of leaving a same-norm sibling — with no bare it's a plain add.

## The Score field

**The panel's Score field is a tier combobox.**
The entry panel's Score input shows the same tier list as the table's quick-pick — both drive one shared list core (`ScoreOptionList`: option rendering, highlight navigation, and score/Alt-digit lookups, over `buildScoreOptionItemsHTML`) — but dropped straight below the field (`ScoreCombo`), not anchored over a cell, and **non-constraining**: it's the *enhanced* counterpart to the table's deliberately-constrained pick.
A chevron beside the field drops the list (↓/↑ open it too); a plain focus deliberately does not, so tabbing through the panel, landing here from a score-cell click, or Alt+digit all leave it shut — the list is an explicit reveal, not a focus-triggered pop.
A pick fills the box and fires the field's own input event so the live preview and Save state refresh exactly as a keystroke would, but it never commits (Save, or Enter with the list closed, still does) and never coerces the value.
Free typing always wins: the highlight tracks the typed score as a hint, yet Enter snaps to a tier only once the user has arrowed onto one (`navigated`), so a typed `55` sitting in the `≥50` tier isn't silently rewritten to `50` — an un-arrowed Enter just closes the list, keeping the typed value.
**While the list is open Enter stays in the picker and never reaches the panel's save**: it accepts (the arrowed tier, or the typed value) and closes the list; only a closed-list Enter submits.
It's the precise path — any score, with the tier labels as scaffolding — to the quick-pick's fast one.
The list cedes the keys it doesn't own: **Alt+↑/↓** still walk the panel to the neighbouring entry while it's open, since the combo claims only the plain vertical arrows.
Escape always dismisses the open list first (`EntryPanel.onKeydown`), regardless of unsaved changes — so on a dirty panel the first Escape closes the list and the next closes the panel; since Escape is an explicit cancel it discards without a prompt (§ *Editing*), and the list-closing first Escape loses nothing.
The list is suppressed while the scoped seed is in flight (the same gate that disables the inputs) and absent entirely when no tiers are defined.

Beside the Score field sits a live **Length** count, `toNorm(entry).length` — the same letters-and-digits measure as the table's Length column — updating as the entry is typed; it is the only length readout in tiers whose table has no Length column.

## The canonical-form rename hint

On an entry that isn't yet its real-world spelling, a "Rename to …" link under the Entry field proposes the canonical form — spacing, then casing, accents, and stylization.
It posts **one answer**, not a staged pair: the unigram segmenter (`fetchSpaceOut` → `rankedSplits`, § worker-protocol) supplies the spacing (`hasagraspon → has a grasp on`), each part re-cased from the user's own list — the merge's display for a part's norm carries the deliberate casing lowercase segmentation drops (`dnasplicer → DNA splicer` when a source spells `DNA`), unless the list also carries that norm spelled plainly (a `(norm, norm)` byKey row), which keeps it lowercase so a word spelled lowercase somewhere is never force-capitalized — and the reference pass then upgrades that spacing to the spelling Wiktionary and Wikipedia actually use (`helenoftroy → Helen of Troy`, `cafeaulait → café au lait`) *before anything renders*.
Publishing the spacing up front would be publishing an answer the reference pass is about to rewrite, and a hint that changes its mind reads as a glitch to a user who cannot see why; so the spacing surfaces on its own only as a **stand-in**, after the references have had `RENAME_STANDIN_MS` (1s) to answer and haven't — the slow-network escape hatch that keeps a stalled lookup from showing nothing at all.
A resolution that comes back *incomplete* still renders, but only when its value is the **local** fallback (the `local` flag, § `ui/canonical.js`), which asserts spacing and wordlist casing and makes no reference-derived claim — so an outage degrades to the spacing rather than to a blank.
An incomplete *reference* form is suppressed instead: an un-ready word-case corpus reports every first word as uncarried, which the leading-letter ladder reads as evidence to keep a force-capped capital, so showing it would offer `Ground frost` as the rename for `groundfrost` — the exact miss the ladder exists to prevent.
The two paths split on whether the entry is **bare** (`display === norm`, a plain letter-run): a bare entry gets the instant segmenter spacing plus the reference upgrade, ungated, because any canonical form only *enriches* the norm.
An **already-rich** entry (caps, accents, punctuation, or spaces already) skips the segmenter — it works from the norm and would strip the very casing the entry carries — and takes the reference form only when it is **strictly richer** (`isRicher`, `engine/canonical.js`): it may add capitals, accents, or punctuation (and spaces, which are structural — addable or swappable for punctuation), but must remove none.
That gate is what lets the hint enrich a rich entry (`helen of troy → Helen of Troy`, `well being → well-being`, `OHara → O'Hara`, Nediger's accent gaps) while never proposing one that lowercases a deliberate capital or drops an accent — the `Zoe → zoé` miss that a blanket "re-caser" would make.
The richness check aligns the two strings letter-by-letter (their shared norm guarantees the same letters); it bails to *no suggestion* on `FOLD_MAP` ligatures (`ß`, `æ`) that norm to two letters and would desync the alignment.
Clicking it fills the Entry field, which enters the rename flow above (header/Save flip to *Rename*, the live preview shows the delete-old/add-new); the link writes nothing itself.
It shows in any editable panel, **＋ create included**: what it renames is the text in the box, and the box is all it touches in either mode — an edit's rename is no more committed by the link than a create's is, so the wording holds for both while create keeps its own *Add entry* / Add labels.
Read-only is the one exclusion, its Entry field being unfillable.
The spacing corpus is the same lazy multi-MB unigram asset as the Space out tool, segmented against the full merged vocabulary regardless of scope; the reference pass runs on the main thread as CORS fetches.
It's the one-entry-at-a-time companion to the bulk Space out tool, and shares its spacing outright ([`engine/space-out.js`](../site/src/engine/space-out.js)): splits and per-part casing come from the same functions on both surfaces, so one entry spaces out identically wherever it is shown.
Both the spacing and the reference form are cached per entry (an hour-long LRU shared with the lookup card), which makes *"we couldn't answer"* and *"there's nothing to suggest"* dangerous to conflate: the segmenter goes unavailable for ordinary reasons — a `syncConfig` rebuild gap, the unigram asset evicted by a tool-stack change, an offline lazy load — and caching that silence as the entry's settled form freezes the outage in long after it clears, erasing a hint that had already rendered.
So `fetchSpaceOut` replies with an explicit `ready` flag (§ worker-protocol) and every consumer holds its current state on an un-ready answer rather than clearing or memoizing it; only a `ready` reply is allowed to say an entry has no better spelling.

Every reference suggestion is gated by one invariant — **`toNorm(candidate) === entry.norm`**.
A Wiktionary/Wikipedia form is accepted only if it normalizes back to the entry's own norm (`toNorm` folds case/accents/punct/spaces), so the hint re-spells the same letters but can never substitute a different word, and can never collapse an inflection onto its lemma — `has designs on` rejects the lemma `have designs on` (a different norm) and keeps the plain spacing.
The worst case is a missing suggestion, never a wrong one.
Wiktionary is queried by `list=search` (its index folds diacritics, recovering accents — `emigre → émigré` — that prefix-only opensearch drops) and its titles are true-case; Wikipedia by opensearch plus the REST summary's bold lead, which carries true casing even against a force-capped title (`iPhone`/`macOS` under titles `IPhone`/`MacOS`).
Wiktionary wins ties; Wikipedia is taken only when it alone caught a stylized internal cap.

**The leading capital.**
Wikipedia force-caps every article title (`$wgCapitalLinks`), so a Wikipedia-derived form's *first letter* is the one character carrying no information — every other capital in it is real.
The bold lead is the primary defense, but it clears the entry only when it is **not sentence-initial**: a bold that opens the extract (`<b>Ground frost</b> is …`) was capitalized by the sentence, not by the term, and the position must be measured against the tag-stripped prefix or an intervening wrapper (`<p><i><b>Café au lait</b></i>`) reads as mid-sentence and re-trusts the very capital at issue.
Everything else about a sentence-initial bold still stands — accents, internal caps, punctuation — it forfeits only that letter.
What remains falls to a ladder (`firstLetterUncertain` / `settleFirstLetter`, `engine/canonical.js`) that fires **only** on a multiword form whose first word holds exactly one capital, at position 0, and whose later words hold none.
Each exclusion protects a form that would be *corrupted* rather than merely mis-cased: a single word has no corroborating evidence at all (`Zeus` is as plausible as `zeus`), a later capital confirms the leading one is deliberate (`Helen of Troy`), and an off-position capital means lowercasing position 0 alone mangles it (`DNA sequencer → dNA sequencer`).
For the forms that do reach it, the user's own wordlists arbitrate: the resolver asks the worker how the merged corpus spells the **first word's norm** (`fetchWordCase` → `displayOf`, § `worker-protocol.md`) and lowercases the leading letter when that spelling is lowercase — `fashionaccessory` stops resolving to `Fashion accessory` because `fashion` is an ordinary lowercase entry.
Only that letter is touched; adopting the wordlist's spelling wholesale would flatten a resolved `Café au lait` through a bare `cafe` row.
A first word **no enabled source carries at all** keeps its capital: against corpora of hundreds of thousands of entries, a word in none of them is likelier a proper noun, foreign term, or rare technical word (`Chandrasekhar limit`) than a common one, so its very absence is weak evidence *for* the capital.
The ladder is reached less often than it looks — Wiktionary carries the eponyms (`Parkinson's disease`, `Bunsen burner`, `Occam's razor`, `Doppler effect`) with correct casing and wins ties outright, so in practice it rules only where Wikipedia has a phrase Wiktionary lacks, which is exactly the compound-common-noun population that was being force-capitalized.

When Wiktionary's diacritic-folding search returns several same-norm spellings that tie on richness — cross-language homographs like Polish `Gdańsk` (acute) and Czech `Gdaňsk` (caron) — the pick would otherwise hinge on search order, so a spelling Wikipedia's article **corroborates** breaks that tie (`Gdańsk`, in both sources, over the caron that merely sorted first).
Corroboration is the last tiebreak only, never pulling the choice down to a flatter form Wikipedia happened to return.
A **whole-word suppressor** falls out of the same query: a bare entry whose norm itself resolves to a *spaceless* real word takes that word and is offered no split (`theirs` stays `theirs`, never `the irs`).
The spaceless test is load-bearing — Wikipedia's search fuzz-matches a concatenation across its missing space (`generalassemblies → "General assemblies"`) where Wiktionary's stricter search returns nothing, so a *spaced* bare match isn't a whole word at all but a phrase only one source saw.
The resolver treats it as such: it re-runs the spaced fallback, where Wiktionary also weighs in and its correct lowercase (`general assemblies`) wins over Wikipedia's force-capped title.
Without that reroute the two sources' asymmetric tolerance for the missing space would let Wikipedia's capital stand unchallenged.
A **plural round-trip** is the one deliberate exception to exact-norm matching: a plural whose *singular* is a known reference form borrows the singular's casing/accents and re-adds the trailing `s` (`dnasequencers → DNA sequencers`, `naivetes → naïvetés`), re-checked against the original norm so a wrong stem still can't slip through.
It runs two tiers — a short-circuit reuses the singular when the plural's own lookup already surfaced it (the title/summary fetches are cached, so it costs no extra network), then a full singular lookup for entities whose plural isn't a redirect (`DNA sequencer` never appears in a prefix search for `dna sequencers`).
Only regular `s` plurals are handled; verb re-conjugation (`doinggodswork → doing God's work`, `robspetertopaypaul → robs Peter to pay Paul`) is deliberately out — the lemma rarely carries casing the inflection lacks, and picking the conjugated word out of a phrase is the harder, lower-value half.
The resolver splits across layers — `engine/canonical.js` is the pure, unit-tested reference resolution (given a spaced form + norm); `ui/canonical.js` orchestrates it with the worker spacing behind a per-entry cache — so the DOM-free reference logic stays below the ui band.
The same resolver backs the panel's reference **look-ups**: when a run-together or miscased entry's inline Wikipedia/Wiktionary/thesaurus all come back empty, the panel refetches them against the resolved form and shows those under a *Showing results for …* note, and the **Wikipedia and Wiktionary** link-outs (and their inline fetches) follow the canonical form — both need an exact page title, so a raw `groundfrost` 404s where `ground frost` resolves — while Google/OneLook are searches and XWord Info and Crosserville are letter-based, all unaffected.
Definitions come from Wiktionary's structured REST endpoint, the same source the casing draws on — one dictionary, no third-party scrape that can disagree with the link.
The **Wikipedia summary is a single shared fetch**: every lookup request goes through one URL-keyed response cache (`fetchJSON`, `engine/lookup.js` — an LRU with a one-hour expiry, `core/lru.js`), so the resolver (which reads the summary's bold lead for casing) and the inline card (which renders it) draw from the same response and can't diverge or double-fetch.
The same cache is why scrolling back and forth between entries doesn't re-hit the endpoints: the higher-level result caches (`ui/lookup.js`, `ui/canonical.js`) are LRUs on the same clock, and anything they've dropped is usually still one cache hit away.
A 404 is cached like any real answer; transient failures are evicted so they retry.
This is what makes a redirect coherent — `ageofthepyramids` resolves (via opensearch) to the title `Age of the Pyramids` for the hint, whose summary is the *target* article `Old Kingdom of Egypt` (bold lead not norm-matching, so the title stands); the card then renders that same Old-Kingdom summary rather than blanking, since it's the very fetch the resolver already made.

**The hint is hand-tuned, and its arbitrariness is deliberate.**
It can only ever show one spelling, so where a norm carries several (`Cat`/`CAT`, `dna`/`DNA`) it has to pick — and the ladders above were adjusted against real output until they read well rather than derived from a principle.
That makes this the one place in the codebase where "which spelling represents this norm" is a tuned answer rather than an incidental one.
Two consequences for anyone changing it.
`bestRowForNorm`'s last tiebreak is **code-unit order, not `localeCompare`** — code units rank capitals above lowercase, which is what keeps `dnasplicer → DNA splicer`; `localeCompare` is the idiomatic choice and is what `entries` itself is sorted by, so switching it looks like tidying and silently inverts the casing.
And `casePart`'s `byKey` lowercase guard fires *before* that pick, because an explicit all-lowercase row is the wordlist vouching for lowercase and must beat the capital-preferring rule (the `xi`/`Xi` collision).
Score and spelling-length lead the pick; the capital preference only breaks what those leave tied.

Resolution is **deterministic in the sources, not in which fetch happened to land**.
A reference fetch that *fails* (429/5xx/network — distinct from a 404, which is a genuine "no such page") propagates rather than reading as empty, so a resolution built on a missing fetch is marked incomplete: the panel shows the local fallback (the wordlist-cased spacing, never a force-capped partial) and the result isn't cached, so the next access re-queries and converges.
A single 429 is also retried once (honoring `Retry-After`).
Without this a transient Wiktionary miss would fall to Wikipedia's force-capped title and *stick* in the per-entry cache for up to an hour (`groundfrost` cached as `Ground frost` instead of `ground frost`).

## Loading and clearing

*A deep link opens before the wordlists load.*
Opening `?entry=…` (URL form in [`design.md`](design.md) § *Entry panel encoding*) shows the panel at once with the entry text, its look-ups, and its Search links, none of which need a corpus.
The worker-fed parts wait: the seed query loops on an un-ready reply (`refineScopedSeed`), keeping all three fields disabled with the Score and Comment boxes shimmering (`.seed-pending`), and **Appears in** shows skeleton bars until provenance answers.
Both placeholders arm only once an un-ready reply is known, so a warm corpus never flashes them.
The fields stay locked because a save writes *from* the seed: enabling them over a blank seed would let one save overwrite the entry's real score.
A deep link matches case-insensitively — `resolveEditSeedWinner`'s `bareFallback`, deep links only, lets `?entry=BAGEL` resolve to a corpus's `bagel`, and the Entry field then shows the corpus spelling.
An entry the filter or tools leave out of the view still opens; otherwise `revealRouteEntry` scrolls the table to center the entry's row behind the panel and, in the flat tier, selects it, so closing the panel leaves the user on that row.

*The panel opens in tiers, and settles before it fetches.*
A panel open paints its fields synchronously and then waits on five independent streams — the scoped seed, provenance, Related entries, the rename hint, and three inline lookups — and painting each the instant it lands would make the panel arrive in five separate lurches.
Two rules tame that.
First, **nothing network-backed starts until the target holds still**: a click or deep link is settled by definition and fires at once (`OPEN_SETTLE_MS` 0), while a walk step (`WALK_SETTLE_MS` 200) and a keystroke (`TYPING_SETTLE_MS` 600) are scrub gestures.
The walk gate is not politeness — `walkTo` goes through the same `doOpen` as a click, and a canonical resolution costs 2–10 reference requests while the lookup card costs 3 more, so holding Alt+↓ through twenty entries without a gate fires those per entry (the reason `requestJSON` carries a 429 retry at all).
Nothing is *cancelled* — there is no `AbortController` in the app; every stream instead carries a monotonic token and drops its own stale replies, with the URL-keyed and per-entry LRUs making a re-visit free.
The settle gate is what keeps superseded work from being *started*.
Second, arrivals are **grouped into two reveal tiers** matching where they come from: the worker-fed pair (provenance, Related entries) answers together and is withheld until both reply or `LOCAL_TIER_MS` (300) passes, and the network-fed lookup section is withheld *whole* — its free Search links included — until every source settles or its own hold expires, since revealing the links first only relocates the shift onto the cards.
DOM order follows the tiers (provenance → Related → lookups) so the slow network block only ever grows the bottom instead of shoving the fast blocks around.
Each block sits in an `.entry-panel-async` wrapper that eases open from a `0fr`/`1fr` grid row, which is the height-`auto` transition browsers won't interpolate directly.
The **rename hint is the deliberate exception**: it stays in flow between Entry and Score, where it reads, and is allowed to shift the fields when it lands — floating it or reserving a permanent blank line were both considered and rejected as worse than the shift they remove.

*And it clears them on a grace window as the entry changes.*
The reveal tiers govern how results arrive; the mirror rule governs how they leave.
Each of those blocks answers for the entry text it was queried with and renders nothing that names it, so the moment the box holds different text they describe something else — a Wikipedia summary for the row you opened, sitting under the word you just typed over, is indistinguishable from a correct one, which makes lingering results *wrong* rather than merely late.
They are dropped `STALE_GRACE_MS` (200ms, `ui/lookup.js`) after the text diverges: long enough that a worker reply (Related entries, Appears in) or an already-cached lookup lands inside it and swaps in place, so ordinary typing never blanks, and short enough that nothing slower — a lookup behind its 1s debounce above all — is ever attributed to the wrong entry.
The window is deliberately **not restarted per keystroke**: a per-keystroke timer would let a continuous typist push the blank out forever, which is the lingering it exists to end.
The lookup card keeps its free Search links through the drop (they repoint instantly and cost no request), so that section shrinks rather than collapsing — and because the blocks sit below the fields in the panel's scrolling body, with the footer pinned outside it, a drop moves nothing the user is typing into.
The drop is keyed on the **queried text**, not on whether the newest query has replied, which is what keeps it clear of the `ready` rule above: an un-ready reply for the *same* text still holds its last-good render, since "we couldn't answer" is not "there's nothing to show".

## Related entries

**Related entries — the panel's family context.**
Below the edit fields the panel lists the open entry's **relatives**: its word-family plus any other spelling of the same norm across every wordlist (`Boney M.` ↔ `Boney M`), each inline with its score, the current entry in bold, any relative a click away.
It is deliberately **view-independent** — scanned from the whole enabled merge (`ownedMerged`), not the scoped or filtered result — so a relative in a wordlist you've scoped away still shows; it is an exploration aid, kept distinct from the walk because the two answer different questions (the walk: *what Prev/Next steps through*, a projection of the table; Related entries: *what's related to this entry*, independent of the view).
Clicking a relative **commits the current entry first**, then opens it fresh (a history push, so Back returns), so you can click around a family without losing edits.
It runs the **same leave gate as the scrim and the ✕**: a write it can't make refuses the click and shakes the footer rather than swallowing it, while an incomplete create — nothing savable typed yet — has nothing to commit, so the click goes through and drops it.
Gating the click on the commit alone is what left an unscored Add panel unable to click through to the better-spelled entry it was showing.

**Names link to their parts, and parts to the whole names.**
Opening `Rigoberta` lists `Rigoberta Menchú`; opening the full name lists both halves; `Gabriel García Márquez` reaches `García Márquez` and `Medicine Hat, Alberta` reaches `Medicine Hat` (`nameAnchorRun`, `engine/morphology.js`).
The shorter entry must occur as a contiguous run of whole words inside the longer, every word of it capitalized, and the run capitalized in the longer entry too — so `Job` reaches `Book of Job` but not `dream job`, and `Venus Williams` and `Serena Williams`, which merely share a word, stay apart.
Single letters, `i`/`v`/`x` Roman numerals, and grammar-capitalized words (`I'm`, `Mr`, `TV`, …) never anchor, since each would otherwise link hundreds of entries.
Contiguity is load-bearing: under plain word containment the band `The The` matches every title that says "the" twice.

**What it lists.**
The relatives are the entry's word-family siblings ([`pipeline.md`](pipeline.md) § *Sort axes per tier* — `cat`/`cats`, `eat`/`ate`/`eaten`) **and** the differently-spelled entries that share its norm (`Boney M.` / `Boney M`) — kept navigable here even when a concrete click scopes them out of the provenance table (a bare click lists them there too, but Related is still where you click through to one) (§ *The cross-wordlist view*).
It also lists the entries an **inflection** of the query reaches that no single family key spans — a run-together spelling and its spaced form (`electricbills` ↔ `electric bill`), and a conjugation a space would otherwise hide (`hadagraspon` ↔ `hasagraspon`, found by segmenting the glued token, then inflecting a split word).
They're inline and dot-separated like the thesaurus lookups, each with its tier-colored score badge so a scoring discrepancy reads off the colors.
A **name anchor is capped** at its few best-scoring fuller names (`NAME_RELATIVE_CAP`, 3, budgeted per anchor rather than per section) so one first name can't crowd out the inflections — but the rest are **held, not dropped**, behind a **+N more** at the end of the list that reveals them in place.
The count is the section's only word that anything was trimmed, and it has to be: `Willis` listed `Bruce Willis` and `Connie Willis` while silently withholding `Lester Willis Young`, reading exactly like a complete family.
The trim is also **one-directional by nature** — a short name sits inside many longer ones and is capped, while the longer name contains only its own two or three parts and never is — so the two ends of a link routinely disagreed about each other with nothing on screen to explain it.
Revealing merges the held names into their sorted places rather than appending them, since the list is alphabetical throughout; the reveal is one-way and resets when the entry changes; and the bold anchor is exempt from the cap, so a rename that reaches its own row through a name run can't hide it.
An anchor with **no score yet** — a brand-new entry you haven't scored, or a deep link before its seed lands — wears **no badge at all** rather than a zero: an empty score is not a 0, and a red `0` badge on an entry you're still typing reads as a verdict Grawlix never made.
The worker answers a `fetchFamily` query against the **merged wordlist, ignoring the active scope** — so a single-list scope still surfaces every relative across your lists; the list **includes the entry the panel is on, bold-highlighted**, so it holds stable as you click between siblings — the set is identical, only the highlight moves.
The anchor is matched by **rendered text**, not by the worker's `current` flag alone: a create panel is bound to nothing (its seed is empty), so the flag never lands and a typed entry that already exists would render twice — the real, clickable row plus an inert badge-less twin of it.
Clicking a sibling navigates the panel to it (reseeding and re-querying *its* relatives); the bold current entry is inert (it's where you are).
The list **re-fetches on every entry-text keystroke** (the same trigger as the provenance query), keying off the typed text — so the relatives track the entry as you edit it, and spacing out a run-together entry keeps its kin in view rather than dropping them when the family key stops spanning the space — and it holds its last-good render across an in-flight query rather than blanking (the same flash-avoidance the provenance table uses), but only until the grace window above expires — past that the previous text's relatives are dropped rather than left standing under the new one.
It also re-fetches on the panel's resetting refresh (`rebindEntry`), so a background re-run rebuilds it.
The bound entry (passed alongside the query) is flagged the bold `current` anchor and is **never dropped mid-rename**.
In an **editable** scope the panel then overwrites that row with the live edit, so a rename shows the **typed** spelling (`7layerdips` → `7-layer dips`) anchoring the list rather than the old one: it reads exactly as it will once saved.
In a **read-only** scope the worker's row stands, which is what a *bare* click needs — it resolves by norm to the merged winner's spelling, which the panel cannot name (the read-only panel is showing the scoped list's own bare text).
Either way the anchor is inert — never a clickable sibling of itself — so it can't be mistaken for a separate entry that would unify on save.

## Walking a set

**Walking a set from the panel.**
The open panel is not a dead end on one entry — it carries a **Prev/Next walk** (up/down caret buttons, Alt+↑/↓ as the keys) that reseeds it to an adjacent entry without closing, so editing a run is a walk rather than a reopen-per-row.
It runs in two modes by how it opened.
A **lone open walks the whole table in result order**, and the table's **selection and cursor follow** the current entry as you step (so Esc→Enter reopens where you left off).
A **multi-select (≥2) bounds the walk** to exactly those members — a captured, sort-proof set carried with an `N / M` position that grays out at its ends — **opening at the set's first member in result order**, not on the row that happened to be under the cursor (a downward Shift+↓ or drag leaves the cursor on the *last* member, which would open the walk at `N / N` with nowhere to step); and here stepping moves **only the cursor**, leaving the whole selection highlighted in the table behind the panel (the `'move'` cursor mode, not `'replace'`): you asked for those rows, so the walk doesn't quietly un-pick them as it visits each.
The bounded set is the sort-proof answer for a family Grawlix can't cluster (unspaced) or an arbitrary hand-pick, where a plain table walk would scatter under a Score sort.
The walk shows **no member list** — it is pure navigation; the panel's separate § *Related entries* is what shows context.
**Moving auto-commits** the current entry's edit — the iTunes *Get Info* model, where Prev/Next commit like OK while Cancel/Esc discard — and a move runs the same validation gate as Save, so an invalid score blocks the step and focuses the bad field instead of silently dropping it.
**Focus persists in the same field across a step** (comment→comment, entry→entry), so editing one column straight down a run is a type-Next-type rhythm with no reach for the mouse.
The walk **stops at the ends** (no wrap) and stays **one history entry** — each step `replaceState`s the URL, so Back closes the panel rather than rewinding it member-by-member.
A bounded walk resolves its members through a `fetchWinners` worker command (an off-window selection isn't in main's row window) in result order, dropping any the current filter hides — and the panel **waits on that reply before it opens** (`EntryPanel.openSelectionWalk`), because the reply is also what names the first member: main can't order a hand-picked set itself (a Ctrl-clicked selection is in click order, and its rows may be off-window).
Opening on the cursor row and re-seeding to the first member on arrival was the alternative, and it loses: that re-render lands on the user's first keystroke and discards it, where the wait is one worker round-trip on an otherwise idle worker.
An empty reply (no pick survives, or the fetch times out) degrades to the table walk on the cursor row.
The table walk drives the cursor directly, anchored on the panel's active identity rather than `_cursorIndex` (not every open sets the cursor — a touch tap or a Related-entry click doesn't).
That identity anchor is also what carries the lone-open walk into the **transform tier**, whose chain rows hold several atoms: the panel can open on any atom — a tool's *output* (a prefixed form, an anagram) as readily as its seed input — so a step locates the active identity across *all* of a row's atoms, not just the first, and stays in the opened column as it moves (`_locateIdentity` returns `{row, atom}`).
Nothing *else* in this tier sets `_cursorIndex` — no click or table keystroke does (it isn't selectable, [`design.md`](design.md) § *Keyboard navigation & multi-select*) — so the walk can't fall back on the cursor and must anchor on the identity; it advances the cursor itself only to scroll and highlight the row it lands on.
And with no selection to follow, that `.active` highlight is the walked row's only cue, so the panel repaints it after each step.
Keying the locate on the first atom alone (the flat assumption) is what left the transform walk dead-ended: an output-atom open could never find its own row.
