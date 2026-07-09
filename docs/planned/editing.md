# Planned: entries-table editing — keyboard nav, multi-select, and bulk edits

Forward-looking plan for making the entries table fully keyboard-operable and adding multi-select batch editing. The **entry panel** is already keyboard-good (Enter/Escape/Tab, Alt+# rescore, the `ScoreCombo`/`ScorePicker` listboxes do ↑/↓/Enter/Escape). The **table** has no keyboard surface at all today — rows aren't focusable, there is no selection concept, and the only row-level state is a mouse `_hoveredAtomEl` ([`entries-table.js:757`](../../site/src/ui/entries-table.js)) plus the one row whose panel is open (`EntryPanel.activeNorm`). This closes that gap.

Phase 1 (short term) ships full keyboard nav + multi-select + batch rescore/delete in the **flat tier**. The multi-atom tiers (transform, group) and a multi-entry panel editor are parked with a designed-in path, not a rewrite. The farther-horizon **stretch goal** — bulk editing of related entries, which motivates the whole effort — has no design yet; its concrete cases are captured in §9. Anchors below were valid at writing; code moves — re-verify before building (uncertain points flagged inline, checklist at the end).

The whole feature lives almost entirely inside `EntriesScroller` ([`entries-table.js:664`](../../site/src/ui/entries-table.js)) plus a small keydown hook and one focus-return seam into the panel. **No worker/protocol change, no storage change, no URL change** — selection is transient UI state, already excluded from the URL alongside scroll position ([`design.md`](../design.md) § *Out of scope for the URL*). Low-risk, self-contained surface.

## §1. The model: selection is an *atom* coordinate, tracked as data

Two load-bearing decisions.

**Selection is data, not DOM focus.** The table is a virtual scroller — a row's `<div>` is destroyed the moment it scrolls out of view ([`entries-table.js:1485`](../../site/src/ui/entries-table.js)). A roving `tabindex`/`.focus()` on the selected row would evaporate on scroll, taking its keydown listeners with it. So selection is an index into the sorted+filtered result, re-applied on every `_render` exactly parallel to how `.active` is toggled today ([`entries-table.js:1475`](../../site/src/ui/entries-table.js)). Focus lives permanently on one stable container; the standard virtualized-listbox pattern (`role="listbox"` + `aria-activedescendant`) points the AT at the selected row without moving real focus. This is the same pattern already implemented three times in this file at small scale — `ScorePicker` ([`entries-table.js:3055`](../../site/src/ui/entries-table.js)), `ScoreCombo` ([`entries-table.js:3212`](../../site/src/ui/entries-table.js)), `SortMenu` — the table is just the *virtualized* version.

**The selectable unit is the atom, and a flat row is the degenerate one-atom row.** In the flat tier a row *is* one atom, so "select a row" and "select an atom" coincide. In the transform tier a chain row is several stacked atoms (`RELEARNING → ELEARNING → LEARNING → EARNING`) that are four *different real entries*, each independently editable; in the group tier a row is an anchor atom + N member chains. The moment a row holds more than one atom, the row is the wrong granularity for an edit action — you never want Alt+6 to slam all four of `RELEARNING/ELEARNING/LEARNING/EARNING` to one tier. So **selection is keyed on the atom** from day one. `_resolveAtomTarget` ([`entries-table.js:766`](../../site/src/ui/entries-table.js)) already resolves a clicked atom to its `wlEntry` in every tier (including the group anchor); keyboard nav is the same resolution driven off an index instead of a click. In the flat build this distinction is invisible (row == atom) and costs nothing, but it means extending to multi-atom tiers is *additive* (§8) rather than a re-architecture of the selection state.

Selection identity — what a selected atom *is* across re-renders — is its `(norm, display)` pair, not a bare row index (§6). The multi-select set is a `Set` of those identities.

## §2. Focus & ARIA architecture

- The rows container (`this.sizer`, `.entries-table-rows`) gets `tabindex="0"`, `role="listbox"`, `aria-multiselectable="true"`, an `aria-label` (e.g. "Entries"), and a visible focus ring. It owns the nav keydown handler. It is Tab-reachable; Shift+Tab leaves it. When it isn't focused, arrows do ordinary page scroll.
- Each rendered row gets `role="option"`, a stable `id` (derived from its `(norm, display)` or index), `aria-selected`, and — the non-obvious virtualization detail — **`aria-setsize` = the true result count and `aria-posinset` = the row's 1-based position**. Without these a screen reader announces "5 of 40" (the number of *mounted* rows) instead of "5 of 12,458"; they are how you tell the AT the real size of a windowed list.
- The container's `aria-activedescendant` points at the id of the cursor row (the moving end of the selection). Because we always scroll the cursor into view when it moves by keyboard, the referenced row is mounted; a wheel-scroll that unmounts it leaves a dangling reference, which ATs tolerate (an accepted edge case).
- **Score badges get an accessible name.** The tier label lives only in a `title` tooltip today ([`design.md`](../design.md) § *Score badges*), invisible to a screen reader — give the badge `aria-label` like "score 60, great".
- **A polite live region** announces the result count / "No matches" when a search or filter changes it, so AT users hear the list updated.

## §3. Interaction spec (phase 1, flat tier)

**Movement** (cursor = the atom you're on):
- **↑ / ↓** — move one editable atom. In flat that's one row; the model already walks atoms, skipping non-editable ones (the `[]`-slot highlight repeats `isRepeat` and synthetic `wlEntry.wordlist === null` atoms `atom-noedit` — [`entries-table.js:455`](../../site/src/ui/entries-table.js), [`:460`](../../site/src/ui/entries-table.js)), so the flat path is a special case of the general walk.
- **PgUp / PgDn** — one viewport of rows. **Home / End** — first / last.
- **Scroll-into-view** brings the cursor below the sticky region (header → wordlist bar → tool stack → stats bar → entry headers), never under it. The cleanest implementation is CSS `scroll-margin-top` on rows set to the composed sticky height (the vars exist: `--sticky-stack-h` [`theme.css:15`](../../site/css/theme.css), and the per-layer `--header-h`/`--wordlist-bar-h`/`--tool-stack-h`/`--stats-bar-h` [`app.css:188`](../../site/css/app.css)), combined with `scrollIntoView({ block: 'nearest' })`. *Uncertain:* whether `--sticky-stack-h` alone is the right total or the per-layer sum is needed — verify against the live sticky offset.

**Selection**:
- **Click a non-edit area** of a row (count, length, gutter — the cells that are read-only today, [`design.md`](../design.md) § *Click targets*) selects it. Clicking the entry/score/comment cells still opens the panel / `ScorePicker` (unchanged edit affordance). Keep the default arrow cursor on the select area so the pointer-cursor edit cells stay visually distinct.
- **Shift+↑/↓** extends a contiguous range from the anchor; **Shift+click** selects the span. This is the common batch case (a family under the family sort, or a run of search hits).
- **Non-contiguous multi-select is in scope** (not deferred): the unspaced families are the motivating case — Grawlix can't detect a family until the entries are spaced, so their rows aren't adjacent and a manual multi-pick is the only way to batch them. **Ctrl/Cmd+click** toggles one row in/out. For pure keyboard this needs the cursor to move *without* changing the selection and a **Space** to toggle at the cursor — the ARIA "active descendant diverges from the selection set" pattern. So the cursor and the selection set are distinct: arrows-without-shift move the cursor and reset selection to it; **Ctrl/Cmd+↑/↓** move the cursor leaving the selection intact; Space toggles the cursor's membership.
- **Ctrl/Cmd+A** selects every row in the current filtered view (`preventDefault` the browser select-all when the listbox is focused). Search → select-all → Alt+6 rescores everything matching in one gesture.
- **Escape** clears the selection (and, if a batch is armed, disarms it) before doing anything else.

**Edit**:
- **Enter** opens the entry panel for the cursor atom's entry (flat: `row._wlEntry`). On panel **close, focus returns to the listbox with the same atom selected** — this closes the keyboard loop (arrow → Enter → edit → Enter-to-save → back on the row → arrow to next) and is what actually makes serial editing fast. The panel already captures/refocuses its opener for mouse opens ([`entries-table.js:2109`](../../site/src/ui/entries-table.js)); extend that to restore listbox-focus-plus-selection.
- **Alt+1..9** rescores the **selection** (single or batch) — §4, §5.
- **Delete** (My Edits scope only) stages a delete of the selection with undo — the keyboard sibling of the panel's existing delete ([`actions.js:881`](../../site/src/app/actions.js)), single or batch.

## §4. Selection replaces hover

Remove hover-as-target entirely (`_hoveredAtomEl` and its `mouseover`/`mouseleave` wiring [`entries-table.js:757`](../../site/src/ui/entries-table.js); `hoverRescoreByDigit` [`entries-table.js:804`](../../site/src/ui/entries-table.js) becomes selection-driven). Selection is the sole target for row-level shortcuts. Reasons: keeping both leaves two "which row does Alt+# hit?" inputs that can disagree (mouse over row 12, keyboard on row 5); hover-as-target is a Grawlix novelty with no muscle memory riding on it; and one target concept is simply cleaner. The workflow hover was invented for — rescore several in succession — is *better* served by multi-select: hover was one mouse-move + one keypress per row, multi-select is mark-the-run-once + one keypress for the whole batch.

`handleScoreDigitShortcut` ([`entries-table.js:3045`](../../site/src/ui/entries-table.js)) keeps its three-way routing (open `ScorePicker` → open `EntryPanel` → table), but the table branch targets the selection instead of the hover.

## §5. Batch actions ride one write-set and one undo

Batch rescore reuses the existing edit machinery whole. A single rescore today: `commitRescore` ([`entries-table.js:3035`](../../site/src/ui/entries-table.js)) → `saveEntry('rescore', …)` ([`actions.js:528`](../../site/src/app/actions.js)) plans one entry's write-set via the worker (`planForSave` → `fetchWorkerEditPlan`; the worker owns the rescore indexes so it plans), applies it optimistically capturing the inverse (`applyEditsWriteSet`, [`actions.js:540`](../../site/src/app/actions.js)), ships one `editEntry` ([`pipeline-worker.js:876`](../../site/src/ui/pipeline-worker.js)) which the worker applies in **O(affected norms)** and acks ([`worker-protocol.md`](../worker-protocol.md) § `editEntry`), and shows one undo toast ([`actions.js:548`](../../site/src/app/actions.js)).

Batch = **plan the N selected atoms, merge their write-sets into one, apply once, ship one `editEntry`, show one undo toast** ("Rescored 12 entries to 60 — Undo"):
- `applyEditsWriteSet` already dedups affected norms across `deletes` + `upserts` and handles an arbitrary-size set ([`worker-protocol.md`](../worker-protocol.md) § `editEntry` step 2), and the worker's `editEntry` applies a whole gesture's writes at once. So a merged write-set of N upserts needs **no worker change** — one round-trip, one ack, one splice.
- The merged write-set's `primary` (which drives post-edit rebind/focus) has no single value for a batch — set it null and let the refresh re-run rather than rebind to one entry. *Uncertain:* confirm `primary: null` is a valid no-focus signal through `refreshAfterEdit`/`applyConfigAck`; if not, pick a defined sentinel.
- Planning is a per-entry worker round-trip today. For a batch, fire the N `planEdit` requests in parallel (`Promise.all`) and merge client-side. If round-trip count ever matters at large N, a `planEditBatch` worker message is a clean *optional* optimization — not needed for the first cut.
- Batch **delete** is the same shape over `deleteEntry` ([`pipeline-worker.js:892`](../../site/src/ui/pipeline-worker.js)) / the panel's staged-delete-with-undo path.

The panel stays the **single-entry** deep editor. Batch actions are table-level shortcuts on the selection set, bypassing the panel entirely — a clean split: panel = deep single edit, selection + shortcuts = shallow batch ops. (A multi-entry *panel* editor is parked, §8.)

## §6. Selection stability across re-renders

A live result can re-render underneath the selection — filter narrows, sort flips, a streamed run repaints, a disk-sync reconcile lands, an edit elsewhere re-runs the pipeline. Selection must survive it the way the open panel already does: `rebindEntry` re-binds the panel to its entry's row in a fresh result by `(norm, display)` ([`entries-table.js:834`](../../site/src/ui/entries-table.js)). Reuse that idea — the selection set is identities, so on each re-ingest, map each still-present identity to its new index; drop identities that vanished (filtered out, deleted); leave the cursor on the nearest surviving neighbor if its own row is gone. A fully-cleared result clears the selection. This keeps a batch selection coherent while the user keeps typing in the search box.

## §7. Phase 1 scope & build order

Ship, all flat-tier: selectable rows (click-non-edit-area + ↑/↓/PgUp/PgDn/Home/End), multi-select (Shift-range, Ctrl/Cmd-toggle non-contiguous, Space-at-cursor, Ctrl/Cmd+A), Enter-to-open with focus-return-on-close, Alt+# retargeted to the selection with batch support, Delete (My Edits) single+batch, hover removal, and the core ARIA (`listbox`/`option`/`activedescendant`/`setsize`/`posinset`, badge labels, live region). Selection state is keyed on the atom throughout so §8 is additive.

Suggested order: (1) single-select data model + `.selected` render + core ARIA + click-to-select; (2) keyboard movement + scroll-into-view; (3) Enter-to-open + focus-return loop; (4) hover removal + Alt+# on single selection; (5) multi-select (range, then non-contiguous); (6) batch rescore/delete write-set merge + undo; (7) selection stability on re-render.

## §8. Parked / longer term

- **Multi-atom tiers (transform, group).** The selection model already generalizes (atom is the unit); what's deferred is the *rendering/ARIA/scroll* for atoms-within-rows. Open questions to resolve when built: (a) ARIA row-vs-atom — a chain row reads as one search result but holds several editable atoms, so is the row a `role="group"` of `option`s, or the row an `option` with atom-targeting underneath? (b) sub-row scroll-into-view (bring an *atom* into view within a tall group row); (c) group tier's `+N more` — navigating into a hidden member must auto-expand the reveal (`GroupMorePopover`). Low urgency: the editing workflow lives in the flat tier; the exploration tiers are for *finding* words and edit there is occasional.
- **Multi-entry panel editor.** Extend the panel to edit a selection's shared fields at once (e.g. one comment template, one score) — the deep-edit counterpart to the shallow batch shortcuts. Needs a comment-templating model (below) to be worth more than batch rescore already gives.
- **Family as a selection unit.** The worker already ships `familyStarts` and the scroller brackets each family run under the Entry sort ([`design.md`](../design.md) § *Family-grouping bracket*; `_applyFamilyBracket` [`entries-table.js:1522`](../../site/src/ui/entries-table.js)). "Select this whole family" (click the bracket, or a key on a member) is nearly free and wires family-grouping straight to the bulk goal — but only helps *already-spaced* families, so it complements, not replaces, non-contiguous multi-select.
- **Panel prev/next.** While the panel is open (it's modal, so table nav is suppressed), a next/previous control — a button and/or Ctrl+↑/↓ — reseeds the panel to the adjacent selected/cursor atom without closing. Reuses the same cursor index. Bridges into the bulk phase.
- **Type-ahead jump** — type a prefix to jump to the next matching entry. Classic listbox aid, handy for the family workflow, but overlaps the search bar — probably last, if at all.

The **bulk-editing stretch goal** these all build toward — the pain that motivates the whole doc — has its own section (§9).

## §9. Stretch goal: bulk editing of related entries (no design yet)

This is the motivating pain, and the reason for everything above. When curating, you routinely edit a handful of *related* entries — almost always a word family — with changes that are *parallel but not identical*. There's no design for it yet; this section captures the concrete cases (dug out of real curation history) so a future design round starts from real material instead of re-deriving it.

Two recurring shapes:
1. **Apply the same structural transform to each entry's text** — spacing, punctuation. The transform is conceptually shared but the result differs per member, so it isn't one find/replace.
2. **Attach a similar-but-agreeing comment to each** — pluralized, conjugated, or possessive to match the entry. The comment isn't a mechanical copy.

Multi-select + batch rescore (§5) is the first primitive and handles the *easy* half: a shared score across the set writes identically to every member. The hard, unsolved half is shape 2 — a comment template that **bends to agree with each entry** (singular/plural, verb tense) is a genuine linguistic problem, deliberately left open here.

A twist that makes it awkward, and ties back to phase 1: an **unspaced** family isn't detected as a family until it's spaced (the family sort clusters spelled words, not concatenations), so the very entries you most want to batch are sorted *apart* and unbracketed — which is exactly why **non-contiguous multi-select** (§3) is in phase 1 rather than deferred.

### Space out entries

The entries arrive concatenated; each wants the same spacing, but where the spaces land differs per member:

```
hasagraspon -> has a grasp on
hadagraspon -> had a grasp on
haveagraspon -> have a grasp on
havingagraspon -> having a grasp on

breakoutintosong -> break out into song
breaksoutintosong -> breaks out into song
brokeoutintosong -> broke out into song
breakingoutintosong -> breaking out into song
brokenoutintosong -> broken out into song

notarizedstatement -> notarized statement
notarizedstatements -> notarized statements
```

### Add punctuation

Same shape — a shared punctuation change (hyphen, apostrophe), member-specific text:

```
brownbagger -> brown-bagger
brownbaggers -> brown-baggers

tryonesbest -> try one's best
triesonesbest -> tries one's best
triedonesbest -> tried one's best
tryingonesbest -> trying one's best
```

### Conjugation-matched comments

Attach a comment to each entry that agrees with its number and tense — pluralized nouns, conjugated verbs. The score is shared across the set (batch rescore covers that), but the *comment* has to bend to each entry:

```
cromlech;40;Megalithic construction made of large stone blocks
cromlechs;40;Megalithic constructions made of large stone blocks

dracaena;30;Plant with woody stems and funnel-shaped flowers
dracaenas;30;Plants with woody stems and funnel-shaped flowers

get plowed;50;Get drunk / Vulgar
gets plowed;50;Gets drunk / Vulgar
getting plowed;50;Getting drunk / Vulgar
got plowed;50;Got drunk / Vulgar

hard asset;50;Physical item with intrinsic value
hard assets;50;Physical items with intrinsic value

pet passport;60;Official document that records information about a specific animal as part of travel procedures
pet passports;60;Official documents that record information about specific animals as part of travel procedures
```

The agreement isn't a single-word swap: "construction → constructions" and "records information about a specific animal → record information about specific animals" both change more than one word, and "Get drunk → Gets drunk → Getting drunk → Got drunk" tracks the verb form across four entries.

### Name-variant comments

Full-name / first-name / last-name variants of one referent, each wanting a comment phrased for that form (the referent is shared; the phrasing shifts with which variant it labels):

```
Margrethe;40;Margrethe II, queen of Denmark from 1972 to 2024
Margrethe II;40;Queen of Denmark from 1972 to 2024
Queen Margrethe;50;Queen of Denmark from 1972 to 2024
```

### Shape of a solution (open)

No design is committed. The building blocks are parked in §8 — the **multi-entry panel editor** (edit a selection's shared fields at once), **panel prev/next** (walk a family without closing), and **family-as-selection-unit** — and the two UI ideas floated in discussion (multi-select to edit several at once; next/previous buttons in the panel) map onto those. The genuinely unsolved piece is the conjugation-aware comment template: it could be as modest as a fill-in-the-blank template the user tweaks per row, or as ambitious as auto-conjugation from a linguistic model — that call belongs to its own design round. Until then, the §3 keyboard loop (arrow → Enter → edit → save → focus-returns → next) already makes these serial edits materially faster; that's the near-term win, and bulk is the horizon.

## §10. What to verify during implementation

- The composed sticky-region height for scroll-into-view — does `--sticky-stack-h` cover it, or is the per-layer sum ([`app.css:191`](../../site/css/app.css)) needed? Test with the panel/tool-stack at varying heights.
- Merged batch write-set with `primary: null` flows cleanly through `refreshAfterEdit` / `applyConfigAck` ([`actions.js:520`](../../site/src/app/actions.js)) — one repaint, one ack, correct counts.
- Batch undo restores every entry (combined inverse write-set), including rescores that *created* a My Edits entry (undo must delete it, not write a stale score) — the single-entry path already handles this; confirm it composes.
- The listbox keydown handler doesn't swallow keys the page/panel needs — it must no-op when an input/dialog/panel is focused (the panel is modal; table nav stays suppressed while it's open), mirroring the existing Alt-gate discipline in the global handler ([`actions.js:947`](../../site/src/app/actions.js)).
- Selection survives a streaming run without strobing — re-ingest re-maps identities (§6) rather than clearing, and doesn't fight the viewport-driven streaming (`_reportViewport`).
- `aria-setsize`/`aria-posinset` reflect the true filtered count, not the mounted-row count; the live region announces count changes without spamming on every keystroke.
- Non-contiguous keyboard select (cursor-moves-without-selecting + Space-toggle) actually diverges cursor from selection set, and `aria-activedescendant` tracks the cursor while `aria-selected` tracks the set.

### Validated vs. uncertain

**Validated against current code:** the virtual-scroller row lifecycle and `.active` toggle; `_resolveAtomTarget` resolving any tier's atom to a `wlEntry`; the `isRepeat`/`atom-noedit` non-editable signals; the single-rescore path through `commitRescore`/`saveEntry`/`applyEditsWriteSet`/`sendEditEntry`/`showUndoToast`; the worker's `editEntry` applying an arbitrary-size write-set in O(affected norms); the sticky-offset CSS vars; the family bracket data; the panel's opener-refocus and `rebindEntry`.

**Uncertain / assumptions to confirm:** the exact sticky total for `scroll-margin-top`; `primary: null` as a no-focus batch signal; whether per-entry parallel planning is fast enough at large N or wants a `planEditBatch`; the row-vs-atom ARIA choice for multi-atom tiers (deferred, unresolved on purpose).
