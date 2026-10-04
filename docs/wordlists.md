# Wordlists

Wordlists are the data Grawlix works on: each one a parsed file of entries with its own rescore rules, merged into All Wordlists or viewed alone.
This doc covers how they are stored, displayed, managed, synced to disk, fetched, and rescored: what the user sees, and why it is built that way.
Two surfaces share the one screen:

- **The wordlist bar** — selector (left) + the **Rescoring** / **Scoring** editor trigger and per-scope actions (right).
  The selector scopes the screen; the manage panel (reached from inside the selector dropdown) owns cross-list operations.
- **Disk sync** — which file each list keeps in sync, re-granted from a non-blocking boot splash when a handle's permission lapses.
  Configured from the scoped list's sync button on the wordlist bar; there's no global storage surface (see § *Disk sync*).

## Scope: the selected wordlist is the corpus

The unifying idea is one notion of *what you're looking at*.
`state.selected` — `MERGED_ID` or a source — is the corpus for both the entries table and the tool pipeline.
Select `All Wordlists` and it's the merged view, exactly as before; select a source and the table shows that source's own rescored entries in the same rich editable style, with tools running against it.
The Sources column stays in every scope; scoped, only the scoped list can light up (see [`design.md`](design.md) § *The Sources column is a presence matrix.*).

Three things users kept asking for fall out of this one idea rather than needing bolted-on features: *filter the tools by wordlist* (scope to it), *sort and filter a single wordlist* (it's the same sortable, filterable table), and *edit the wordlist* (edits route to My Edits, made from the All Wordlists or My Edits view).
There is one canonical way to view wordlist data — the same rich table in every scope — rather than a separate inspection view; a foreign single-list scope simply shows that list read-only, since its data isn't yours to edit in place.

**Scope is a parameter to the corpus build.**
`buildCorpus(sourceList)` (`engine/corpus.js`) builds either the merged corpus (every enabled source) or a single-source scoped corpus from one code path, so a scoped corpus gets the same `norms` / `byKey` / `sourceCounts` shape the merged one does — the selection just picks the source list.
The worker owns this corpus: a scope switch re-syncs the config and rebuilds the worker's owned corpus for the new scope, tracking which scope it built for (`ownedScope`) plus a freshness flag, so a windowed fetch whose scope changed since the run is dropped rather than served against the wrong corpus.
The histogram layout stays scope-keyed (a scoped view's own scale vs the fixed all-sources scale) so a scoped view's bins reflect its own data without leaking the all-sources distribution.

**Scope, not filter.**
"The selection is the corpus" deliberately means **scope** (the corpus *becomes* that source, by itself), not **filter** (subset the merged view).
With sources in priority order My Edits > Broda > XWI and `ocean` at Broda 90 / XWI 70: scoped to XWI, `ocean` reads XWI's own 70 — no other publisher's opinion mixed in — and a word XWI lacks is simply absent.
Filter (re-merging over a subset of *publishers*) is deferred because disabling the rest and viewing All Wordlists already covers it; the only thing filter adds is a transient subset that doesn't touch the persisted enabled flags, addable later as a facet if anyone asks.
Keeping the selector single-purpose — click a name = scope, nothing else — is what lets it read as a clean, title-like list of icons and labels.

**Scoped views are source-only — no My Edits overlay.**
A scoped view shows the scoped wordlist's *own* score, comment, and display, full stop.
The scoped corpus is that one source alone — `buildCorpus([source])`, not `[My Edits, source]`.
The consequence is deliberate: an edit to `ocean` lands in My Edits, so an XWI-scoped view keeps showing XWI's own value — the edit doesn't appear here.
It surfaces where My Edits actually participates: in **All Wordlists** (where My Edits sits on top by default, so it wins) and when scoped to **My Edits** itself.
A foreign scope is read-only anyway ([`entry-panel.md`](entry-panel.md) § *The cross-wordlist view*), so edits are only ever made from those two views.

An overlay that injected My Edits into every scope — keeping the edit visible everywhere — would need a per-scope edit-patch path plus an override indicator on each affected row (`base → edited*`); it was tried and cost more than it gave.
The simpler model is "each scope shows one wordlist, All Wordlists shows the merge."
So there is **no override indicator** in the table — no arrow, no asterisk.
A scoped score cell shows that wordlist's effective score and nothing more.
(Two distinct same-norm words within one source don't bare-collapse — § *Rich wordlists*, merge semantics.)

**Scope persistence and the global score range — no schema bump.**
`state.selected` persists in localStorage as a standalone `selectedScope` key (the `dbKey`, or `MERGED_ID`), so Grawlix reopens to the last-viewed wordlist; first run lands on All Wordlists, a vanished list falls back to it, and a now-disabled list still loads (rendered disabled in the selector).
The score-range filter is a **single global range** held in the standalone `scoreRange` key: one filter that applies to whichever scope is selected, so switching wordlists leaves it in place rather than blanking the input.
The key is **three-state**: absent means the default `defaultScoreRange()` — one above the trash score, so `1+` out of the box (the trash tier is hidden for anyone arriving on a shared link); an explicit `''` means the user deliberately cleared the filter and is stored — not deleted — so it survives reload; any other value is their range.
The default tracks the trash score rather than a fixed threshold: it hides exactly the tier the trash score defines as junk, so there's no arbitrary cutoff to justify and nothing that stops making sense when the user relabels their tiers.
The box's trailing control is a **↺ reset** at any off-default value (empty included, so there's always a path back) that restores the default **and drops the key** — returning the user to untouched/follows-default, distinct from the **×** at the default value that persists `''`.
Changing the trash score in Settings moves the default, so `setTrashScore` re-syncs the control through `refreshScoreRangeButtons` (the score box persists across stats-bar refreshes rather than being rebuilt).
Both keys are standalone read-time-default keys — the same pattern as `darkMode` / `autoUpdate` — so neither needs a `SCHEMA_VERSION` bump: an unparseable entry just resets that one preference.
**A change to the default reaches existing users with no migration precisely because blank is stored as key-absence** — moving the absent-key default upgrades every user who never set a range (new or long-standing) in one code change, while the always-store-on-edit rule keeps a deliberate clear distinct from never-touched.
The filter being global rests on a bet that, with the default wordlists each rescored onto the one common scale, a given threshold means the same thing in every scope; a scoped list still on its own raw scale is the accepted cost, since the dominant annoyance was the filter vanishing the moment you changed scope.
Neither scope nor the score range rides in the URL ([`design.md`](design.md) § *URL state*).

## The wordlist bar

The bar sits between the brand header and the tool gallery.
Its left is the selector (which doubles as the screen title); its right is the active chrome — the rescore trigger and the per-source actions.
It reads as a swap of passive chrome for active chrome rather than a new bar stacked on everything: the default state stays calm (selector + a small adjustments cluster), and curation controls appear only when summoned.

**The selector is a pure picker.**
It lists All Wordlists (top) then the sources as icon+label rows — no checkboxes.
Rendered via the shared `buildIconHTML` / `getWordlistIcon` (never stored HTML), it is the one control on every viewport.
A click sets scope.
A disabled wordlist renders grayed out (a disabled-select-option look, a modifier class — *not* `aria-disabled`/`disabled`, which would block the click) but stays selectable: disabling means "exclude from the All Wordlists merge," not "can't look at it," and the disabled state reads straight off the control with no separate note.
The closed trigger is a borderless title (the selector doubles as the screen's title); the open menu lists the same rows plus two signals — each row's **"X of Y entries used"** contribution count (`wordlistCardMeta` — how many of a list's entries survive dedup/priority in the merge, not its raw count), and an update dot per row, with an aggregate update dot on the collapsed trigger so a folded selector still flags it.

**The manage panel lives inside the dropdown.**
Every change to the set of wordlists or to one wordlist's setup — reorder, enable/disable, add, configure, delete — is reached from a **Manage wordlists** footer below the scope rows, because the picker and the manager operate on the same object (the set of wordlists): the picker is the read view (scope to one), the manage panel its edit view.
Each row carries a drag handle, its enable toggle, and a `⋮` menu with **⚙ Configure** (the Configure dialog — rename, icon, publisher, URL, import, rules) and **🗑 Delete** (red, confirm-gated) — the switch-plus-overflow-menu row of Firefox's add-on manager, which keeps the destructive action one step away from the frequently clicked toggle.
My Edits has no menu — it has no Configure and can't be deleted — and a spacer keeps its toggle aligned.
The menu floats in the top layer like every dropdown ([`components.md`](components.md) § `openMenu`), so the scrolling list can't clip it.
Configure and delete live only here: users looking to delete or configure a list went to Manage first, and a single path keeps the answer to "where is it?" unambiguous.
This keeps the bar calm and reserves its right edge for working on the scoped list's data.
The discoverability trade — a dropdown footer advertises less than a visible button — is accepted because list management is infrequent and the selector is exactly where one goes when thinking about wordlists.
A visible adjustments button next to the selector was the original plan; it was demoted into the dropdown, and the bar slot it would have taken went to the rescore trigger instead.

**The panel is Save-gated, and that is the performance strategy.**
Reorder and toggle operate on a **staged shadow** of order + enabled flags — a model the panel mutates and renders from, separate from `state.sources` — so no merge is touched while staging and the table behind the panel keeps showing the pre-change state.
**Save** commits the whole batch in one `batchUpdate` (replay the staged order + enabled onto the real state, persist, one rebuild) behind the modal, where a brief pause is exactly what a user expects after clicking Save; **Cancel** discards.
**Save** is disabled whenever the staged shadow matches canonical, so there's no no-op commit — and because an add commits immediately, adding a list alone leaves the shadow clean and Save dimmed.
This converts what was a freeze on *every* drag and *every* toggle into one expected pause on a deliberate confirm.
**Add wordlist** launches the real import/fetch flow immediately as a sub-dialog (you can't stage a fetch); on completion the new list is absorbed into the shadow and the user keeps arranging — so Cancel discards staged reorders/toggles but does *not* undo an add.
Configure and Delete work the same way: each commits immediately through its own dialog, the row re-renders (or drops out of the shadow), and staged reorders/toggles of the other rows survive.
The panel opts out of backdrop-dismiss and its X is guarded ("discard changes?") only when changes are pending — following the app-wide rule that outside-click-to-dismiss is fine when dismissal is non-destructive and off when it would discard unsaved edits (`createDialog`'s `dismissOnBackdrop` flag, default true).

**My Edits isn't pinned — reorder and disable apply to it like any list.**
The panel treats My Edits as an ordinary row: drag it anywhere, toggle it off; only delete is blocked.
It's *created* on top and enabled — so edits win in All Wordlists by default — but neither is enforced.
Demote it below another list, or disable it, and edits still route into My Edits; they just stop winning the affected norms (or drop from the merge while disabled).
This is coherent, not broken: the worker's in-place edit-patch re-merges each affected norm from *all* enabled sources (`computeMergedBucket` over `ownedBuilt`, not the edited source alone — [`pipeline.md`](pipeline.md) § *The worker owns the corpus*), so the cached corpus stays byte-identical to a full rebuild at any position or enabled state; no path assumes My Edits wins.
The cost is a footgun — an edit can silently fail to surface — accepted for now on the Ingrid model: you reordered or disabled it deliberately, so you own the result.
Pinning it on top and always-enabled (the search bar's permanence pattern — [`design.md`](design.md) § *Search is a tool*) is a deliberate future option, not yet taken.

**Per-source actions.**
When a source is scoped the bar's right cluster is **Download + a `Rescoring` text button + a slim `⋮` kebab** (**Fetch** for a URL-backed list, **Import**).
**My Edits** gets the same Download and `Rescoring` button, with **Import** and **Clear** (confirm-gated) in its kebab.
On **All Wordlists** it's just Download (the merged product) + a `Scoring` text button (the tier editor), no kebab.
The **sync button** (§ *Disk sync*) sits in that right cluster, by Download, in every scope.
Responsive behavior is **measure-and-fold**: the `⋮` kebab is an overflow bucket, and a ResizeObserver folds **Download** into the kebab (its split becomes explicit Download-rescored/original items) as soon as the scope name would otherwise ellipsize, then **Rescoring** — so buttons collapse *before* the name truncates, and the name only ellipsizes once everything's folded.
It re-renders one copy per fold level (not duplicated-inline-and-hidden), and keys the measurement on `#app` (overflow-clipped, viewport-bounded) so an overflowing bar can't hide the squeeze.
The one exception: a name longer than the trigger's max-width is already ellipsized, so it doesn't force-fold the row.
"Last updated" still hides ≤759px (and on My Edits, a two-way user-edited list where a single freshness stamp misleads); the **sync pill never folds** (status, and desktop-only).
All Wordlists — two short controls, no kebab — never folds.
The bar's **Download** (the whole list as an asset) and the stats-bar Share control's downloads (the current filtered/sorted *view*) overlap only in appearance; the fix is sharper labels by scope, not removal — each stays where it's contextually right.

**Why one copy, not toggled twins.**
Folding re-renders a *single* copy of each control per level rather than rendering both an inline button and a hidden menu twin and toggling visibility (the tempting pure-CSS/container-query approach).
Twins would put a second `#download-btn`/`#sync-sign` in the DOM and a present-but-hidden All-Wordlists kebab — and the test suite reads DOM *presence* (`toHaveCount`, `allTextContents`), not visibility, so hidden twins silently corrupt it; duplicate `#sync-sign` would also break `refreshSyncSign`'s in-place patch.
Two contracts keep the single-copy approach honest: the trigger truncates (rather than the bar overflowing) only because `min-width: 0` propagates the whole flex chain down — `.wls` is itself a flex container so the `<button>` inside can shrink; and the **sync pill stays inline in every level**, since `refreshSyncSign` patches a unique `#sync-sign` in place and a folded twin would break that.
The rescore toggle is wired by delegation on `.wls-actions` so it survives being re-rendered at a different fold level.

## Rescore and scoring: one inline editor, polymorphic by scope

Rescore-rule authoring is an **inline-expandable area** on the wordlist bar, default-collapsed; expanding it pushes the gallery and table down.
Its trigger is a text button with a chevron in the bar's right cluster — **Rescoring** on a source, **Scoring** on All Wordlists — titled "Rescoring rules" / "Scoring tiers", with an accent fill when open.
The editor is polymorphic by scope, one slot whose content differs by panel:

- On a **source** (and My Edits), it edits that source's **rescore rules**.
- On **All Wordlists**, it edits the **tier labels** (`state.scoring`) — the unified scale's names.
  There is no separate home for the tier editor; it is the All Wordlists version of the rescore editor.

A rescore rule maps an input score range, plus an optional entry-length filter, to an output score; focusing any of the three fields pops up a syntax cheat sheet (`data-help="rule/…"`).

**Edits batch into a draft; Save commits.**
Opening the editor snapshots the scope's rules into a draft the editor mutates in place; the footer's **Save** runs the single heavy commit (worker rebuild, persist, mirror write) and **Cancel** discards it; both collapse the editor.
Authoring a rule therefore doesn't pay a full re-rescore of the source per keystroke, as committing on every field blur would.
Closing the editor any other way confirms first when the draft is dirty, and switching scope mid-edit does the same; a clean close just collapses.
The All Wordlists tier editor batches identically — tier edits are cheap, so this buys no performance there, but it keeps one commit model (and one Cancel/Save footer) across both scopes rather than splitting the polymorphic editor.

**The table is the live preview.**
While the editor is open and scoped to a source, rule-changed rows render the **rule arrow** `350 → 80`, computed per-paint from the *uncommitted draft* rather than the committed corpus: each visible row carries its pre-rescore raw (`rawScore ?? score`) and the score cell re-derives `raw → rescored` through `rescoreEntry(draft)` at render time, so the arrows track the draft as you type with no worker round-trip, and newly-scrolled rows pick the draft up through the same windowed render path (the worker corpus stays on the committed rules until Save).
It's render-only: sort, the score-range filter, and the stats/histogram keep reading committed values until Save — reshuffling the sort on every keystroke would be worse than the staleness.
Gated on scoped-to-a-source AND editor-open (plain badge otherwise, never on All Wordlists or group rows); the score column widens to fit the arrow while preview is active.
So the editor needs no separate preview list of its own — the main table *is* its feedback.

**The footer.**
`+ Add rule` is a trailing row in the rules list; the footer below carries the rare lifecycle actions as quiet **text-links** on the left — **Reset to defaults** (only when the draft diverges from defaults, confirm-gated), **Disable rescoring** (no confirm — it only stages into the draft), **Make permanent** (confirm-gated) — and the prominent **Cancel** / **Save** commit pair on the right, wrapping to a second row on mobile.
The rare actions are demoted by *weight*, not hidden in a menu: the screen already carries two dropdown triggers (the bar's per-source `⋮` kebab and the stats-bar Share control), and a third would bury them.
Each is conditional, so the cluster is usually one or two links — only a dirty My Edits ever shows all three.
**Save** is disabled whenever the draft equals the committed rules, so there's no no-op commit.
The footer reacts to the draft live — rebuilt on each keystroke, not only on blur — so Save's enabled state, whether **Make permanent** lights up, and which rare links appear all stay current as you type.
(The footer holds no inputs, so rebuilding it never disturbs the rule field in focus.)

**Order is the user's, not the app's.**
Rules — and tier labels — evaluate **first-match-wins in their stored order**, which the user owns: each row carries a `≡` drag handle (the shared `makeReorderable`, the same primitive the manage panel and tool stack use) and rows are never auto-sorted.
An auto-sort that floated narrower rules above their supersets was rejected: it made rows jump while editing, and it can't reliably infer the *intended* priority when rules overlap.
Manual, visible ordering is both calmer and more correct — a broad rule placed above a narrow one simply shadows it, exactly as the list reads top-to-bottom.
Because order carries meaning, `rescoreRulesEqual` is **order-sensitive**: a reorder is a real change that flips `dirty`, persists, and survives default propagation, and a publisher shipping its `defaultRules` in a fixed order thereby defines that publisher's priority.
(`scoringRulesEqual` is order-sensitive too; tiers just gain the drag handle.)

**No persistent legend.**
The scoring tiers get no always-visible legend block; every score badge already carries a hover tooltip naming its tier, which serves the once-in-a-while "what does 50 mean again?" lookup at zero permanent vertical cost.
The *display* of tiers is the tooltip; only the *editor* needs a home, and it has one.
The editor lives on All Wordlists and the data anchors on top-level `state.scoring` because the tier labels describe the merged scale — what every wordlist gets translated *into* — not any one wordlist.
See § *Rescore rules* for the rule/legend mechanics.

**Disable rescoring — neutralize, don't delete.**
For the user who wants a list's raw scores and notes but not Grawlix's remapping, **Disable rescoring** (a source-scoped action in the rescore editor) *neutralizes* the rules rather than clearing them: it blanks every rule's `output` and drops the `scoring:false` rows (pure-rescore special cases with no place in the scale's documentation).
What survives is the input ranges and notes as a documenting legend, remapping nothing.
It coexists with Reset — neutralizing makes the list dirty, so Reset stays available to undo it.
On All Wordlists it's absent (tier labels are already blank-output).
The internal name is still `neutralize*`; the user-facing label is "Disable rescoring."
**Make permanent** (bake) sits beside it as another footer text-link — both are rescoring-lifecycle actions — rather than in the kebab; because baking reads committed rules it applies the draft first, and its mechanics are in § *Rescore rules*.

## Discovery banners

Two self-targeting banners surface a couple of discoveries, each visible only to someone already in the relevant context — never a global nag.
A **My Edits-import** banner shows when scoped to My Edits; an **XWI-subscriber import** banner shows when scoped to XWI while it is still present-but-unpopulated (the highest-value, naturally self-targeting discovery — Grawlix ships only XWI's default scores, not the paywalled list, so a subscriber importing their real copy is a real upgrade).
Both are desktop-only — gated on `isMobile()`, the same detection that hides the disk-sync controls — since mobile users rarely import and the full-width text crowds a phone.
The banner mounts directly under the wordlist bar, above the tool gallery, so the alert rides next to the scope it's about — a full-bleed strip attached to the bar rather than a detached card, so it reads as part of the bar's region.
Each carries an **Import** button, which drives the same import action as the bar, and a ✕ that dismisses it for good (`banner_myedits_dismissed` / `banner_xwi_dismissed`).

A self-targeting banner is the right shape because a wizard that pages everyone through setup, or a banner that nags the tool-gallery-only majority, is the wrong default — the value is showing a feature exactly where it matters.
The same reasoning rules out a one-click "remove all defaults" affordance: clearing default wordlists is per-list deletion via the manage panel (few bother), and tier labels are decorative since the score-badge tooltip is the legend, so the only piece worth keeping is Disable rescoring (above), which is source-scoped.

## Wordlist file format

One entry per line, semicolon-separated, comment optional:

```
ENTRY;SCORE
ENTRY;SCORE;COMMENT
```

Imports and fetches parse it; every generated file — downloads, mirrors, My Edits' stored text — writes it through `serializeEntries` (§ *Output format*).

## Rich wordlists

**Two-field entry identity.**
Every wlEntry carries `{ norm, display, score, comment }`:

- `norm` — the canonical letter form.
  Lowercase `[a-z0-9]+`, accents stripped, spaces and punctuation removed.
  The merge key, the input letter-pattern tools (Anagrams, Head off, Back off, Regex, …) operate on by default, the basis for `Length`/`Min`/`Max` sort.
- `display` — the rich form as written.
  Set when the source carries information not recoverable from `norm` (any space, accent, punctuation, or per-entry case beyond uniform all-upper / all-lower).
  `null` for entries from plain wordlists, where the renderer falls back to lowercase `norm`.

Plain wordlists in the wild collapse entries to a letter-only form (`[A-Z]+` or `[a-z]+`) with no spaces, punctuation, or accents.
Rich wordlists preserve those distinctions, so `mate` and `maté` become distinct entries, `theirs` and `the IRS` carry independent scores and comments, and the Initialisms tool can read `Helen of Troy` as initials `HOT`.

The naming holds across the codebase: `norm` and `display` over `canonical / raw` or `letters / written` — short in code, semantically clear, no misleading "raw" for plain sources whose raw form *is* the canonical.
Tool output APIs still use the `entry` slot — that's the *string* a transform emits (typically letter-form), and the executor decides whether it lands as a `norms` lookup or as a synthetic `{ norm: toNorm(text), display: text === norm ? null : text }`.

The plumbing that surrounds it:

**The parser detects a per-file casing convention, then sets `display` per entry.**
Wordlists have no case standard — some are written entirely in uppercase, some entirely in lowercase, and the choice carries no meaning.
A bare letter-run renders from its lowercase `norm` so entries look consistent whichever convention a source used; the only trick is telling the conventions apart.
In an all-uppercase file a bare `THEIRS` is uppercase only *because the file is*, and should render lowercase like everyone else's; an `FBI` typed into a lowercase file is uppercase *on purpose*, and should be kept.
`detectCase` reads each entry's case from its letters (ignoring spaces/punctuation) and returns `'upper'` only when a file carries far more uppercase than ordinary text would:

```
upper  iff  uppercase_count > UPPER_ABSOLUTE_MAX (10000)
            OR (uppercase_count > UPPER_RATIO_THRESHOLD (1000)
                AND uppercase / cased > UPPER_RATIO_MAX (0.80))
```

otherwise `'lower'` (`cased` = every letter-bearing entry).
Case is just an unstandardized convention — some publishers (STWL) ship both an uppercase and a lowercase build alongside a cased surface forms one — so the thresholds are pinned to real measured distributions rather than any assumption about which case is normal:

| wordlist | entries | uppercase | verdict |
|---|---|---|---|
| Broda | 527K | 527K (100%) | upper |
| XWI | 281K | 0 | lower |
| Nediger | 345K | 1,277 (~1% of cased) | lower |
| STWL (surface forms build) | 304K | 2,159 (~1%) | lower |
| JK | — | ~0 | lower |

`buildWlEntry` then sets `display = null` for a bare letter-run already in the convention case — it renders as lowercase `norm`.
Anything carrying extra information — spaces, accents, punctuation, or an off-convention case like an `FBI` in a lowercase file — keeps its `display` verbatim.

**Why both a count and a ratio.**
Either alone misreads an extreme.
A tiny `{FBI, CIA}` list is 100% uppercase yet must stay `lower` so the acronyms survive — the count floor stops the ratio from firing.
Nediger is the mirror case: its 1,277 acronyms clear the count floor, but at ~1% of the file the ratio keeps it `lower`.
And because a fully uppercase list like Broda clears the absolute count outright, no mixed-case enrichment ever flips it back — a user can keep adding lowercase entries to an uppercase wordlist without the existing ones changing.

Per-file, not per-entry, by necessity: one entry can't reveal whether its uppercase is the file's stripping convention or a deliberate acronym — only the file-wide population can.
Recovery from misclassification is re-import; no UI toggle today.

**Hand-typed input is rich, preserved as far as the file can carry it.**
An entry-panel edit or "add entry" is taken at face value: its exact casing and spacing become the `display`, and the create will copy, downscore, or split sibling rows ([`entry-panel.md`](entry-panel.md) § *The keep copies*) so a later wordlist can't silently rewrite what the user typed.
Storing the literal is also variant targeting — an edit to the score on `the IRS` must carry `display: "the IRS"` so it lands on that spelling, not on every variant of the norm.

The one shape the saved `.txt` can't carry is a letter-run in My Edits' own convention case (normally lowercase): once serialized it's indistinguishable from a bare import, so a reload reads it back bare.
Rather than hold an in-memory literal that re-bares on the next reload and surprises the user, the typed-entry build (`engine/edit-plan.js`, `typedDisplay`) stores it **bare at the source** — running the typed string through My Edits' own `buildWlEntry`, the same parse a reload applies.
So `FBI`, `the IRS`, accents, and spaces stay rich; a lone lowercase `theirs` stores `display: null`.
Deciding it at the source rather than re-baring in the merge resolver is what keeps main and the worker agreeing without a reload — the worker re-parses My Edits on every config sync, and main builds the identical bare, leaving the resolver no literal to reconcile after the fact.
A foreign spelling of the norm then hides the typed bare beneath it, so the create copies that spelling in (**keep-rich**, [`entry-panel.md`](entry-panel.md) § *The keep copies*) to keep the typed entry's own row.

**Merge semantics: keyed by `(norm, display)`.**
Within a single norm, multiple distinct displays from rich sources produce **multiple rows** in the merged view: `theirs` and `the IRS` are substitutable letter-wise in a 6-letter slot but the rich sources have deliberately split them, so the UI honors the split.
The same `(norm, display)` identity keys the My Edits ↔ disk 3-way merge (`edits-merge.js`), so two same-norm siblings both survive a sync rather than one clobbering the other.

`display` is treated as opaque.
Two displays compare as strings; there's no content-based normalization, no "richer display wins" rule.
`"THEIRS"`, `"theirs"`, `"Theirs"`, and `"the IRS"` from different sources are four distinct rows sharing one norm.

Null-display contributors are **ambient across sources**: a contributor with `display: null` participates in every merged row that shares its norm.
So a plain source's entry for norm `theirs` contributes its score to both the `theirs` and `the IRS` rows if those rich variants exist elsewhere — a plain list can't say which spelling it meant, so its bare form is a fallback contributor to every spelling when no higher-priority source provides a matching display.
The plain entry doesn't surface as its own row — it has no display string to anchor.
When every contributor to a norm has `display: null`, the merged row renders `norm` (lowercase); no display is invented.

The ambience is **cross-source only**.
A single source holding *both* a bare entry and a spelled sibling of the same norm — `theirs` and `the IRS` in one list — is distinguishing them on purpose, so the bucketer **concretizes** that bare entry to its norm: it earns its own `theirs` row and stops leaking onto the sibling.
The spelled form is the proof the bare one is the literal word, not an ambiguous letter-run that might *be* the sibling.
Without the carve-out the bare entry's wildcard absorbs the sibling's spelling and the two genuinely-distinct words collapse to one row — `bucketContributors` and the worker's per-norm `computeMergedBucket` apply the rule in lockstep so a full rebuild and an in-place edit splice agree.

**Comment falls through blanks.**
Score, display, and source attribution come from the highest-priority eligible contributor, but `comment` walks the eligibility chain for the first non-blank value.
A high-priority entry without a comment doesn't shadow a lower-priority entry's curated note — a common case once a plain personal wordlist sits above a rich annotated one to override scoring.
The split means a row can show one wordlist as its source while displaying another's comment; the UI doesn't flag the split (no per-field source attribution).

**Decide against the rendered row, not the stored entry.**
A stored entry never tells you what it *shows*: a bare's `display` is `null`, so it renders as its norm — or borrows a foreign spelling in the merge (above).
So any decision that turns on what's on screen — *does My Edits already show this spelling? what does this row spell? what does an edit target?* — resolves through the merge (`computeMergedBucket` / the merged rows), never inferred from a raw entry's stored `display`.
The planner's duplicate block, keep-copies, and edit-seed all read the merged row for exactly this reason; a per-source scan would see a bare's `null` and disagree with the table.
The converse holds too: a question genuinely about a *source's raw holdings* — does any enabled foreign list carry this norm, for the downscore — correctly reads the per-source maps.
The rule governs rendered-display questions, not a blanket "always go through the merge."

The worker's merged corpus exposes `norms` (a membership `Set`, the existence test tools use) and `byKey` (mergeKey → row, for full disambiguation when needed).
A My Edits edit splices just the affected norms' rows into that corpus in place rather than rebuilding it — the `editEntry`/`deleteEntry` command does this worker-side; see [`design.md`](design.md) § *Caches*, *Hot path: editing My Edits*.

**Non-Edits sources are stored columnar in the worker** (`cols`, [`engine/sources.js`](../site/src/engine/sources.js)): parallel typed arrays and packed string buffers sorted by norm, read through `sourceAccessor` ([`worker-protocol.md`](worker-protocol.md) § *Building the corpus*).
Two of its invariants fail silently when broken:

- The norm sort is **stable on file index**.
  Within-norm variant order decides the merge winner and commenter, so a reorder mis-picks them with no error.
- `norm` stays **strictly `[a-z0-9]`**.
  The column packs it one byte per char, and byte comparison equals the code-unit order the merge sorts by only for that alphabet; widening `toNorm` silently mis-orders the merge.

**Dual-arm search.**
Search compiles its friendly wildcard query to one regex (`buildSearchPattern`) and runs it against **both** representations of each entry — `norm` (letters and digits only: lowercased, accents and separators stripped) and `display` (verbatim, or `norm` when null) — matching if *either* does.
The norm arm, its separators already gone, lets a gap-free query span them: `theirs` finds "the IRS", and a bare `resume` finds both "resume" and "résumé".
The display arm requires whatever you type literally: `co-op` finds "co-op" but not "coop", a typed space needs a space, `résumé` matches only "résumé".
Wildcards map the obvious way — `?`→`[\p{L}\p{N}]`, `*`→`.*`, `#`/`@`/`[…]` to character classes.
`?` is a letter or digit, deliberately *not* a separator: it matches an accented display char (which folds to a letter) but skips the hyphen/apostrophe the display arm carries, so a `?` counts one grid square rather than one display character — `??????????????` finds fourteen-square entries, and `WELL-DOCUMENTED` (fourteen squares, a hyphen, fifteen characters) is not among them.
`\p{…}` relies on the `u` flag the compiled regexes carry.
The other one-character classes (`#`/`@`/`[…]`) stay ASCII-only, so on the display arm they match an accented char only through the norm arm's fold — an intentional asymmetry, since folding accents into a user-written class is a separate concern.

Highlights: a display-arm hit is already in display coordinates; a norm-arm hit is emitted in norm coordinates and mapped to the display by `projectRangesToDisplay`, routed by a `coord: 'norm' | 'display'` tag on each range.
Maximal runs of literal tokens are wrapped in capture groups, so the fixed text lights up while whatever `?`/`*` swallowed does not.
The **Regex** tool matches the same two arms — so `\s`, `-`, or an accent can match the punctuation `display` carries but `norm` strips — and is case-insensitive (`i` flag).
Both tools declare `matchOn: 'both'`, which tells the executor to hand the whole `wlEntry` to `run`.

**Replace shares one engine across both tools** (`runReplace`), so equivalent Search and Regex queries transform identically — a guarantee, not a coincidence; only the pattern syntax differs (and `$N` group echoes, which Search's syntax can't express).
Matching is norm-first with a display fallback, mirroring the filter's either-arm rule so a pattern that filters also replaces: a norm match splices the replacement into the *display* through the norm→display map, keeping the case and punctuation the match didn't touch (`bonnie` → `xxx` turns "'03 Bonnie and Clyde" into "'03 xxx and Clyde"); a display-only pattern (`\s`, `-`, an accent) rewrites the display directly.
An output whose norm is in the merge resolves to that real entry (own score, own display); otherwise **Allow unlisted** keeps it as a *coined* synthetic form — carrying the source's score for the download but showing no score badge ([`pipeline.md`](pipeline.md) § *The chain-row model*) — including norm-preserving rewrites like `\s` → `-`, which are only ever synthetic, since an in-list resolution could just re-emit the input.
Group echoes (`$1`, `$&`) carry their display slices, so rearranged text keeps its formatting.

**Length, sort, stats — letter count always.**
`wlEntry.norm.length` drives the Length column, the Length sort axis, histogram bin counts, and score-range / length-filter rule matching.
`the IRS` has length 6, not 7.
The crossword grid slot is letter-counted; display length never affects what fills where.

**The wlEntry shape** (`entry` → `{norm, display}`) is a stored-data format change, so it's gated by `SCHEMA_VERSION` — see [`migration.md`](migration.md).

## Disk sync

Disk sync lets the user point an individual list at an individual file they already have — the file their construction software reads — and keep the two in sync.
There is no Grawlix-owned folder, no global storage mode, no `grawlix.json`.

**IDB is always canonical; sync is a per-list layer.**
IndexedDB holds every wordlist's text and localStorage holds metadata/settings — that never changes, whether or not anything is synced.
Sync is not a backend you swap in; it's an optional *layer on top* of IDB, attached per list.
A synced list owns a **sync target**, split across two IDB records keyed by the *thread that owns each piece*: a main-written `sync_main_<key>` holding the `FileSystemFileHandle` (IDB persists handles via structured clone), and — for My Edits only — a worker-written `sync_worker_<key>` holding the **baseline snapshot** (`<key>` is the list's `dbKey` or `__merged__`).
They're two records, not one, because the pieces belong to different threads: the handle must stay main-side (re-granting file permission needs a document gesture a worker can't make), while the baseline belongs with the corpus it's merged against, which the worker owns ([`pipeline.md`](pipeline.md) § *Cooperative runtime*).
One record per owner means each thread writes only its own key and the two never collide — the worker is the baseline's sole writer, main only deletes it on detach.
The split arrived as the first IDB-record migration: a `SCHEMA_VERSION` bump whose runner grew a second, worker-record phase alongside the localStorage-settings phase (see [`migration.md`](migration.md)).
The single `Storage` object is the IDB venue and nothing else — there is no `Storage === DiskBackend` dispatch, no `NullBackend`, no folder identity.

**Two buckets that share almost nothing.**
Whether a list reads its file back is the whole distinction, so the two buckets are kept separate in code rather than unified behind one abstraction:

- **Output mirror** (one-way Grawlix → file): All Wordlists and every source.
  The file is the list's rescored output, written at the current output format.
  External edits to a mirror file are clobbered on the next recompute — **by design**, named as a generated output; there is no watch-and-restore.
  A mirror is a debounced write-on-change subscription (`MirrorSync`): no watcher, no baseline, no merge, no own-write race.
  Writes coalesce on `MIRROR_WRITE_DELAY` because `All Wordlists` at hundreds of thousands of entries is expensive to serialize.
- **Bidirectional** (file ↔ IDB): My Edits only.
  Sources have no bidirectional path — there's no on-disk original to watch — so My Edits is the one list the user's software (Ingrid, Crossfire, Crossword Compiler) both reads *and* writes.
  IDB stays canonical (chosen over file-canonical so Grawlix keeps working when the file is unavailable); the file is a watched mirror reconciled by a 3-way merge.

**My Edits reconciliation: 3-way merge against a baseline.**
A two-way union merge resurrects deletions — with no common ancestor it can't tell "added here" from "deleted there."
The fix is the **baseline**: the last text IDB and the file agreed on, the common ancestor.
On any observed file change — connect, boot resume, or a poll tick — the *same* `reconcile` runs: file-vs-baseline and IDB-vs-baseline, keyed by norm.
One-sided changes apply silently; delete-vs-untouched deletes; only the same entry changed on both sides since the baseline is a true conflict and routes to the resolver dialog.
The merge runs **on the worker** — it owns both the My Edits corpus and the baseline, so `reconcile` ships the file text over a `mergeDisk` message and the worker merges, applies the result, and advances the baseline; main only reads the file, surfaces conflicts, and writes the merged text back through the handle.
The worker advances the baseline in **both** directions — the inbound merge and the outbound push, which is the *same* reconcile against the file (corpus-wins when it's unchanged since the baseline, a merge when it diverged externally — never a blind write that clobbers a concurrent external edit).
This is what keeps a locally-edited-then-flushed entry, later changed in the file, auto-merging instead of falsely conflicting (a stale ancestor would see both sides diverge and prompt).
The conflict dialog (`ui/dialogs/confirm.js`) offers **Keep this device** or **Keep the file**.
Because the conflict choice is a main-thread dialog, a conflict takes a two-phase round-trip: the worker reports it without applying, then re-merges with the user's choice once it's made.
**Baseline bookkeeping is the heart of correctness** — `threeWayMergeEdits` defaults conflicting norms to the device (IDB) side, the dialog's "keep the file" choice swaps them, and the baseline advances after every own-write, every applied external change, and every resolved conflict.
The dialog is rare: it fires only on a genuine conflict, so polling every 2s does not mean prompting every 2s.
First-attach to an existing file is the same reconcile with an empty baseline (a 2-way union); same-norm-different-value pairs surface as conflicts.

**The watcher's own-write race.**
`EditsSync` polls My Edits' handle every `DISK_SYNC_POLL_INTERVAL` (FSA has no change events), paused when the tab is hidden, resumed on visibility.
The danger is its own writes: an in-progress write produces intermediate file content a tick could read and reconcile against.
Two guards: `_held` skips ticks for the whole duration of a write (the watcher doesn't even read the file), and `_ownWritePending` consumes the one post-write mtime bump so the next tick doesn't mistake the write for an external edit.
Without these the watcher would reconcile against a half-written or just-written-by-us file and silently corrupt My Edits.

**Atomic writes via FSA.**
`Disk.write` is a plain `createWritable → write → close`.
FSA buffers to a hidden swap location and swaps atomically on `close()`, so construction software (or the watcher) never reads a torn file; the customary write-to-temp + rename is unnecessary.
`withFsRetry` retries `InvalidStateError` with backoff — that error means a cloud-sync client touched the file underneath the handle mid-operation, not an app bug.

**Boot resume is non-blocking.**
The app loads from IDB immediately and renders before sync is touched.
After first paint, `partitionSyncPermissions` calls `queryPermission` (the only silent check — it needs no gesture) on each stored handle: `granted` targets reactivate silently (a mirror schedules a write to bring the file current; My Edits reconciles), zero UI.
Targets in `'prompt'` state go to the **reconnect splash** — the loading splash, repurposed (`ReconnectSplash`, reusing the `_hasAnimatedIn` entrance), showing one **`Open <filename>`** button per file (FSA ties one permission request to one gesture, so it's one click per file; a stale handle escalates to a re-pick) plus a muted **Skip for now** link set far apart.
Skip is *safe* — the full app already runs from IDB, sync just stays paused — but not *ideal* (the file drifts), so it's deliberately demoted, not a peer button.
The harm guarded against is a user not realizing sync stopped; the splash and the per-list pill make it noticeable, never silent.
A mid-session lapse is per-list, surfaced on the pill as **Can't find _filename_** (the user turns sync off and re-sets-up, or the boot splash re-grants on next launch) — there is no inline mid-session reconnect.

**Detection: feature + media query.**
Sync needs `showOpenFilePicker` *and* `showSaveFilePicker`; `Disk.isSupported()` gates the dialog's *setup* affordances on both.
The control is **desktop-only** — `syncSignHTML` returns nothing on mobile (`isMobile()`), so phones and tablets show no sync control at all.
On the desktop it always renders (even on Firefox/Safari, where it's a **Sync to disk** button whose dialog explains sync is unavailable) — Download remains the universal escape hatch everywhere.

**One sync control + an explain-first dialog.**
All sync — status *and* control — lives in a single always-present element (`#sync-sign`) that hangs off the wordlist bar on the right.
Unconnected, it's a primary **Sync to disk** button.
Once connected it becomes a status **pill**: a small ring (green, `--ok-fg`, when healthy) plus the bare **_filename_**.
Each channel says one thing — the ring's colour is the state, the ring's motion is activity, the text is identity — so the healthy label carries no verb at all and the "Synced to …" phrasing moves to the `title`.
Only the two error states spend words: **Sync conflict**, or **Can't find _filename_** when the file is gone, both escalating the ring and the text to an attention tint (`var(--warn-fg)`).
A write is signalled by the ring alone, whose stroke drains and refills (`sync-ring-drain`) for the duration of the save.
Transient status deliberately never reaches the label: `.wls-actions` is `margin-left: auto`, so the pill's right edge is pinned while its left edge floats, and an earlier **Saving…** label shrank the control by ~100px and snapped it back twice per save.
Dropping the verb also buys width back in a row that folds controls into a kebab under pressure (§ *The wordlist bar*).
The browser logo (a Chrome/Firefox/Safari/Edge mark via `BROWSER` UA-sniff, falling back to a generic globe for un-pinnable Chromium forks like Brave/Arc) and the `→`/`⇄` direction arrows live in the *dialog's* diagram, not the bar control — the bar stays a terse button-or-pill.

Clicking the control **always opens `SyncDialog`, never a file picker directly** — the previous design ambushed the user with a native picker before explaining anything.
The dialog leads with a `<browser-logo> ⇄/→ 📄 ⇄/→ your software` diagram (the arrow reflects the list's direction) and branches by state.
**Unsynced always offers the same two doors, whatever the list:** a *use/overwrite an existing file* door and a *create a new file* door.
The labels shift by direction — My Edits *uses* the file (*Use an existing file*, reading it in via `showOpenFilePicker`), a mirror *overwrites* it (*Overwrite an existing file*, since it just writes) — but the two-door shape is universal, mirror and bidirectional alike.
**Synced** is a manage view with **Turn off** alone (no mid-session Reconnect — repoint by turning off and starting again); turning off detaches the handle and leaves the file on disk untouched.
**Unsupported browser** is an explainer (data is saved in `<browser>`, sync needs a Chromium browser, Download gets files out).
The dialog's buttons close and then dispatch the sync actions, so the FSA picker still fires inside the click's transient activation.
The dialog also links the Help dialog's Ingrid walkthrough (`#/help/ingrid`, in `ui/dialogs/help.js`), the other half of the setup: sync All Wordlists and My Edits to two files, add both in Ingrid's **Word Lists** preferences with My Edits on top, tick **Use as Personal List** on My Edits so mid-fill scoring writes back, and choose **Remove diacritics** and **Skip punctuation** so rich entries fit a grid.

**The ring is held to whole animation periods.**
A mirror write can finish in single-digit milliseconds — far too fast to register — so releasing the ring rounds *up* to the next multiple of `SYNC_BUSY_PERIOD_MS` (one full drain→refill).
That buys two things at once: a sub-second save still shows one complete, legible cycle, and the stroke always lands back on a closed ring instead of snapping to full from wherever the drain happened to be.
Busy rides a CSS class rather than the rendered label, which is what lets `refreshSyncSign`'s equality gate leave the node in place when only the status changed — replacing it would restart the animation mid-stroke on every flip.
Two boundaries are deliberate: `MirrorSync._flush` raises `writing` **above** the serialize rather than around `Disk.write` alone, because serializing All Wordlists is the expensive half of a save and flagging only the write reported a fraction of the elapsed time; and the `MIRROR_WRITE_DELAY` debounce preceding a flush is **not** covered, since the ring reports the file being written, not the wait beforehand.

The control is the *only* sync chrome — there is no card badge and no disk-drive glyph anywhere.
Status flips (writing → synced, → unavailable) patch it in place (`refreshSyncSign`) so a debounced save can't yank the entries scroller out from under an editing user.
**Download stays put** in every state, since Sync and Download emit the same bytes only in the mirror bucket and Download must remain the universal, FSA-free path.

**Non-features.**
No Grawlix-owned folder, no `grawlix.json`, no `original/` subfolder, no generated `README.md`.
No reconciliation engine for mirrors (one-way by definition) and no watch-and-restore for clobbered mirror files.
No per-provider cloud integration — cross-device is the user pointing two devices' lists at the same cloud-synced file (a per-list attach; first-attach merges content back), Grawlix ships zero cloud code.
For My Edits that merges both devices' edits; for a mirror the latest writer wins.
No folder→per-file migration: an old folder-mode user boots into IDB-mode with stale/default state (their real data is in their folder files) and re-attaches their files manually — deliberately not built, since folder mode reached almost no one (see [`migration.md`](migration.md)).

## One path to "give me a file"

Any wordlist's `Download` button on the wordlist bar produces that wordlist's file, saved immediately at the global output format — no dialog, no per-download options.
For a source with rescore rules the button splits: **Download** (and the menu's explicit **Download rescored**) gives the rule output (`<name> rescored.txt`) and **Download original** gives the imported file verbatim (`<name>.txt`) — both doors named, since a bare "Download" doesn't say which output the main button produces.
For All Wordlists it produces the merged wordlist file (`All Wordlists rescored.txt`).
My Edits follows the same rule as any source — **Download** writes its rescored output at the output format (`My Edits rescored.txt`), and once it has rules the split's **Download original** writes the editable file verbatim (`My Edits.txt`).
Filenames are fixed — there is no filename or extension prompt.
There's no separate "backup" gesture — per-list disk sync keeps a live file current, and the per-wordlist Downloads are the manual, FSA-free backup path everywhere else.
(A settings export/import — config as a version-controllable file — is the planned replacement for the dropped `grawlix.json` settings mirror; see [`planned/settings-backup.md`](planned/settings-backup.md).)

**"Download original"** still serves the raw IndexedDB blob (`idbGet('data_' + dbKey)`) byte-for-byte, even though `display` preserves much of each entry's written form.
The blob is what's most loyal to the imported file's whitespace and comment formatting, and reparsing-then-serializing would add round-trip noise.
For My Edits that blob is its stored editable file, accumulated edits included.

## Output format

Construction software disagrees on what entries it can read — Ingrid takes essentially any codepoint, Crossword Compiler takes rich entries (spaces, diacritics, punctuation), Crosserville forbids special characters, and a `.PUZ` pipeline is effectively ASCII-only.
A single global **output format** (`mergedSettings.outputFormat`) decides how Grawlix *writes* entries, governing the downloads, the synced mirror files, and the results exports (wordlist and CSV) at once.
The Share popover's **Download as JSON** ignores it: JSON is a format for scripts, so it carries entries as Grawlix holds them.
It's expressed as independent keep-or-strip axes rather than named modes — booleans for `spaces`, `digits`, `diacritics`, `punctuation`, `symbols`, and `comments` — so it mirrors the orthogonal knobs real software exposes without Grawlix hardcoding any one program's quirks.
The default is fully rich (everything kept), so existing files are untouched until the user opts to strip something.
(Named presets like "Crosserville-ready" were rejected — they'd need verified per-program facts; the raw axes stand on their own.
A letter-case axis was considered and cut — case carries no crossword meaning and no one's asked; entries write in their existing case, plain entries already lowercase via `norm`.)

**One rule decides between stripping a character and leaving the entry out.**
A character is removed when the entry is still the same entry without it; when it isn't, the whole entry is left out.
`spaces`, `diacritics`, and `punctuation` strip (`café`→`cafe`, `don't`→`dont`): nobody pronounces what they remove, and the grid answer is unchanged.
`digits` and `symbols` leave the entry out: `R2D2` without its digits, `A+` without its plus, and `100%` without its percent sign are different entries.
Leaving out is the safe direction to err.
A wrongly left-out entry is visibly missing, and a spelled-out twin (`A plus`) brings it back; a wrongly stripped one ships `A`, `C`, `RB`, or `100` at a real score into a fill, and nothing inside Grawlix shows it.

**Every kind of character belongs to exactly one axis**, so the five character axes cover everything an entry can hold besides A–Z:

- `diacritics` folds `FOLD_MAP` then **NFD** and drops combining marks — `café`→`cafe`, `Việt`→`Viet`, `Ørsted`→`Orsted`.
- `punctuation` strips the silent marks: `\p{P}` minus `& % # @ ‰`.
  That is `' - . , ? ! : ; / ( ) " * _` and the rest of the category, non-ASCII marks included (`¡ ¿ – — ’ “`) — `AC/DC`→`ACDC`, `M*A*S*H`→`MASH`.
  The five exceptions are punctuation to Unicode, but each stands for a word, so they belong to `symbols`.
- `symbols` owns everything else: category `\p{S}` (`+ = < > | ~ $ € ^ ° × −`, emoji, arrows, circled letters, `™`), the five spoken marks `& % # @ ‰`, and any letter or digit `diacritics` can't reduce to A–Z. Unchecked, it **leaves the entry out** for any of them: `AT&T`, `54°40' or Fight`, `Tokyo 東京`, `ħ`, and the letters and digits in disguise (`HAⓡT`, `x²`, `ﬁnest`), which get no plain-letter rewrite.
  It **deletes** modifier letters (the ʻokina in `Hawaiʻi`) and invisible format characters, and writes a non-breaking space as a space.
  It never touches an accented letter or a punctuation mark: a user who unchecks Symbols so `A+` stops reaching Ingrid as `A` still gets `café` and `don't`.

**Plain ASCII takes three axes** — `diacritics`, `punctuation`, and `symbols` all unchecked.
With `punctuation` kept, non-ASCII marks like `¡` and `–` stay in the file; nothing keeps `'` while removing `¡`.
Wordlists rarely carry typographic punctuation, which is what makes one-owner-per-character affordable.

**`formatEntryText` returns `null` for an entry the format leaves out**, so the exclusion comes from the same call that formats and no caller can write an excluded entry by skipping a separate check.
The digits test reads the entry's norm rather than its display, because the norm is already NFKD-folded: `x²` and `①` count as digit-bearing, as they will to a consumer that folds them.
The results exports apply exclusion per row: the wordlist export tests the chain's tail (the only entry it writes), CSV and tuple CSV drop a row when any entry in it is left out, and a grouped CSV's `count` stays the group's full size, like the other group columns it sits beside.
The exclusion count rides the same toasts as the semicolon and empty-after-stripping notices, worded by whichever of the two axes is unchecked.

**An entry that strips to nothing is dropped, not written.**
An all-punctuation entry empties under `punctuation`, and `ENTRY;SCORE` cannot represent an entry with no text.
The drop applies everywhere `serializeEntries` runs, mirrors included; the *count* surfaces only where there is a toast to carry it, alongside the semicolon-skip notice.
No user data is at risk: every as-is caller writes `display ?? norm` untransformed, and the parser rejects a blank entry, so only a stripping format can empty one.

**One serializer, parameterized.**
`serializeEntries(entries, fmt = AS_IS_FORMAT)` is the single path to wordlist text; `formatEntryText` builds each entry string from the rich `display ?? norm` form, applying each unchecked axis.
Every generated file goes through it — source and merged downloads, the disk mirrors, the worker's scope serialize, My Edits' stored text, and **Download as wordlist**.
It **sorts internally** (norm ascending, then score descending, then written text ascending, then comment-carrying first) rather than trusting callers to sort: ordering is a precondition of the format, not a caller's taste.
Consumers keep the first entry for a given norm, so the leader is the line whose score survives — an unsorted serialize would silently hand the user's filling software the *worse* of two duplicate lines, a failure invisible inside Grawlix.
The text tie-break sorts on the *formatted* string rather than the display, which is what makes the last two axes complementary instead of redundant: under a rich format two same-norm variants differ in text and read in alphabetical order (`any;50` before `any%;50`), while under a stripping format they collapse onto one text and tie, leaving comment presence to decide — so the informative line is the one that survives the consumer exactly when the consumer can't tell the variants apart.

**Fill outputs vs. editable/source files.**
The format applies only to *fill outputs* — the rescored per-source mirror files, the All Wordlists mirror, and the rescored downloads (My Edits' plain **Download** among them), the files the user points construction software at.
*Editable files* are always written as-is with comments (the `AS_IS_FORMAT` default): the synced My Edits file (the file the user writes into and Ingrid round-trips) and any source's **Download original**, My Edits included.
The synced My Edits file stays as-is because normalizing it would destroy the rich entries the user deliberately typed and fight external editing; its entries still reach letters-only software through the All Wordlists mirror, which is a fill output.
The format lives in `mergedSettings` in localStorage, so it stays device-local; changing a checkbox in Settings persists it via `setOutputFormat` and rewrites every synced mirror file via a debounced `regenerateFillOutputs` (the synced My Edits file is excluded — it's bidirectional and stays as-is).
`regenerateFillOutputs` is single-flighted (a change landing mid-rewrite re-runs once at the end) so overlapping regenerations can't race the same files.

**Duplicates survive stripping; only identical lines collapse.**
`formatEntryText` is many-to-one once any stripping is active — `café`/`cafe` collide when diacritics drop, `co op`/`coop` when spaces drop.
Colliding entries are written out as **separate lines**, and only a *byte-identical* repeat is dropped.
The key fact licensing this: a strip-collision is always within one norm class (`formatEntryText` applies a subset of the transforms `toNorm` applies, all idempotent, so identical formatted text implies identical norm).
Consumers already dedupe by norm, so the duplicate is inert to them — they keep the leader, and the sort has already put the best-scored, comment-carrying variant there.
The file gains a redundant line; nobody gets a wrong score.
Grawlix ships same-norm duplicates un-collapsed in the fully-rich path anyway (`eta`/`ETA`, `theirs`/`the IRS`), so collapsing them only under stripping would be the inconsistency, not the dupes.

Merging colliding entries — highest score wins, distinct comments joined by ` / ` — would fabricate a comment that exists in no wordlist and destroy the comment↔score pairing to do it, and it would make stripping the one path where the writer second-guesses the corpus.
The comment-presence sort tie-break recovers most of what such a join would protect: when two variants tie on score *and* collapse onto the same text — the collision case a join would exist for — the annotated line leads and is the one the consumer keeps.

**Editing: Settings is the sole owner.**
The format is edited in exactly one place — the Settings dialog (shared `buildOutputFormatControlsHTML` / `readOutputFormatControls` / `wireOutputFormatControls` helpers).
Each checkbox click persists the setting immediately (`setOutputFormat`), the same live-apply model as the dialog's other settings, so downloads pick it up at once and a user watching a synced mirror file sees it react.
The expensive part — `regenerateFillOutputs` re-serializing every synced mirror — is split out and debounced ~1s (`OUTPUT_FORMAT_REGEN_DELAY`), flushed on close, so a burst of checkbox clicks coalesces into one rewrite instead of one per click.
Downloads and synced mirrors both read this one global format directly (`getOutputFormat()`); there is no per-download override.
A transient per-download format was considered — hand a Crosserville file to a friend while your own file feeds Ingrid — and cut: it meant a modal on every Download for a rare need, where changing the setting and re-downloading does the same job without putting a dialog between the user and "give me this file now."

## Fetching & updates

A wordlist with a `url` is auto-fetch capable.
On boot, any URL-backed wordlist that isn't yet populated fetches in the background ([`design.md`](design.md) § *The shell* — default landing).
Thereafter `checkForUpdates()` runs once on boot and hourly (`UPDATE_CHECK_INTERVAL`): a `HEAD` request per URL-backed, populated wordlist compares `Content-Length` against the stored `fetchedSize`.
A size change is the update signal — cheap, no body transfer.

A host on `REVALIDATING_HOSTS` (STWL's `www.spreadthewordlist.com`) is checked by `GET` instead, comparing the decoded body's byte length.
Such a host serves compressed, chunked responses with no `Content-Length`, and its `ETag` is unreadable cross-origin without `Access-Control-Expose-Headers`, so no header can carry the signal.
What makes the `GET` cheap is the browser's HTTP cache: the host sends `cache-control: no-cache` and answers `If-None-Match` with a 304, so an unchanged file costs an empty response and a read from the local cache — verified in Chromium, Firefox, and WebKit.
The page sees a 200 with the full body either way, so the code can't tell a cheap host from an expensive one; that's why the list is explicit, and a host joins it only after its 304s are confirmed — elsewhere the `GET` would re-download the whole file every hour.
For these hosts `fetchedSize` stores the same decoded length, since `Content-Length` is the *encoded* size and the two never compare.

**Eviction-resilient boot.**
"Isn't yet populated" is decided by the actual `data_<dbKey>` IndexedDB record, not the `populated`/`lastUpdated` fields in the surviving localStorage metadata: the two stores evict independently — a browser reclaiming best-effort storage can drop the IDB wordlist text while the metadata lingers — so a list whose text was evicted reads as unpopulated and the boot gate silently re-fetches it, self-healing what would otherwise be a permanent "No data" desync (every wordlist empty, no reload recovering, since the surviving timestamp keeps vouching for data that's gone).
To make eviction unlikely in the first place, boot also requests durable storage once via `requestPersistentStorage()` (`navigator.storage.persist()`, guarded and idempotent, re-requested each boot so a grant the browser's engagement heuristics only warrant later can still land) — the sole protection for My Edits, which has no URL to re-fetch from.

What happens on a detected change depends on the **Auto-update wordlists** setting ("Update wordlists without asking"; `grawlix_autoUpdate`, default on — a standalone localStorage key like `darkMode`, read-time default via `!== 'off'`, so no `SCHEMA_VERSION` bump):

- **On** — `checkForUpdates` immediately re-fetches the changed wordlist (`fetchWordlist(…, { silent: true, viaToast: true })`) and applies it.
- **Off** — the wordlist gets a transient `_updateAvailable` flag, surfaced as the green update dot on its selector row (§ *Rescore rules*, **Update badge**).
  The user fetches manually via **Fetch** in the list's `⋮` kebab.

The **worker** diffs old vs. new entries into added / deleted / rescored — it holds the source's previous entries, which main doesn't — and ships the result on the `fetchApplied` ack: exact counts plus an inline first window of each section, while retaining the **full** diff so the dialog can virtual-scroll all of it (`fetchDiffRows`, keyed by a `diffId` main frees when the toast/dialog ends; see [`worker-protocol.md`](worker-protocol.md)).
Shipping the whole diff inline would re-materialize a full-replace re-import's ~600k rows on main, so only the visible window ever lands there.
`applyWordlistText` parses the new text only transiently, to write IDB and seed rules, and keeps nothing.
The `viaToast` flag picks how that diff is reported: normally it opens the full `openUpdateSummaryDialog`; under auto-update it instead shows a one-line toast with the counts (`XWI auto-updated: 1,204 added, 58 rescored`, zero-count categories omitted), since an unattended background refresh shouldn't pop a modal in the user's face.
The toast carries a **Details** action link (`showActionToast`) that opens the full `openUpdateSummaryDialog` on demand — the modal stays opt-in.
Toggling the setting on from the Settings dialog runs `checkForUpdates()` immediately rather than waiting up to an hour for the next tick.

**Refresh-on-consent: a background update never yanks a settled result.**
The rule is *the user driving the pipeline always recomputes; the world changing underneath never recomputes without consent* — where the recompute consent gates is the expensive **join**, not a cheap re-scan.
A background auto-update applies at the **data layer** immediately (IDB is canonical, the worker splices the corpus — but if a run is *streaming*, that splice **defers** until the run loop goes idle, because reindexing the corpus under a live run would shift the position-encoded rows it is still producing, silently tearing the result; the deferred apply lands between runs, so the next run sees fresh data and the streaming one finishes uncorrupted), but the **displayed result stays put** rather than re-running out from under a reader.
**Score** changes to surviving entries always apply **live** — the worker's in-place splice mutates the shared entry objects, so a reproject repaints the new scores (and re-buckets the histogram) without re-joining.
**Membership** changes (adds/deletes) fork by tier.
A **flat** result — a base list or a per-entry filter — re-derives *in place with no prompt*: a flat row matches independently, so an add/delete is a cheap re-scan, and the worker re-runs the flat join over the spliced corpus and ships it as a reprojected snapshot (`repatch`).
A **combination tier** — a tuple, a group, or a transform — instead **holds** the change behind a consolidated **Refresh** chip on the stats bar (result-centric, never per-wordlist), because there one added entry can partner an *existing* one into a new combination a per-entry re-scan would miss, so honoring it means re-joining — exactly the recompute consent gates.
Clicking the chip — or any action that re-joins anyway (a new query, a scope switch, a structural edit) — adopts the fresh corpus and clears it.
The mechanism follows the position encoding: a flat result is position-encoded (`entries` indices), so a splice that shifts positions would tear it — the worker snapshots its backing array copy-on-write before the splice and binds the result to it just long enough for the `repatch` to re-derive a fresh join against the live corpus; a combination-tier result freezes (frozen membership, live scores) while the chip shows — an eager transform (or a non-packable group) survives the splice on its own entry-object references, but an **index-packed** tuple or group is position-encoded like flat (its lanes/members are corpus indices), so it takes the *same* copy-on-write snapshot and resolves its frozen `view` against it rather than the reindexed live corpus.
`applyWordlistText` forks on `viaToast`: a background structural update repatches a flat result or pins + chips a combination one (`repatch` / `stale` on the `fetchApplied` ack); a background rescore-only update just reprojects; a **user-initiated** fetch/import re-runs as before (the user is driving).
A `>256`-change background update takes the wholesale-rebuild path, which mints fresh entry objects the snapshot can't share — harmless for the flat repatch (it re-derives against the live corpus anyway), but a pinned combination result's scores freeze until refresh, acceptable since the chip is showing.
See [`worker-protocol.md`](worker-protocol.md) § `applyFetched` / `repatch`.

## Fetch status

A fetch that takes a while or stalls surfaces in a **download-manager panel** (`#fetch-status`, `ui/fetch-status.js`) — one panel with one row per in-flight fetch, centered at the bottom of the screen.
It exists for the failure the panel was built around: a wordlist that never populates while the user stares at an empty screen with no idea whether it's downloading or stuck.
The panel is **read-only** — a row shows a wordlist's name, a byte counter, and a progress bar, nothing more; there are no stop/retry/close controls.
A fetch either completes (its row vanishes) or fails, and a **failure leaves the panel for a toast** (below).
Several simultaneous fetches collect as rows inside the single panel rather than as stacked separate cards.

The panel and the toast stack share one bottom-center column (`#notify-stack`, `ui/notify-stack.js`) so they never overlap: CSS `order` pins the panel at the very bottom and lets toasts ride above it.
Both `ui/toasts.js` and the panel append into this shared parent rather than each owning a fixed-position element of its own (which would collide).

**The reveal is threshold-gated for background loads, immediate for user-initiated ones.**
A still-loading *background* fetch — boot population and auto-update, the `silent` callers — appears only after it has run past `_fetchRevealDelay` (5s), so the common case (publishers that fetch in a couple of seconds on boot) stays completely silent; the panel is for fetches that *aren't* behaving normally.
A fetch the user kicked off by hand (`immediate`, which defaults to `!silent` — **Fetch** in a URL-backed list's `⋮` kebab, or a toast's **Retry**) shows at once — they asked for it and expect feedback, so there's nothing to suppress.
The gate is timer-driven, **not** progress-driven: a fully stalled fetch produces zero body chunks, so only a wall-clock `setTimeout` surfaces it — wiring the reveal to progress bumps would silently fail to show the exact stall the feature exists to expose.
The gate governs only the *loading* rows; a **failure goes straight to a toast** regardless of how fast it failed, so the suppression never hides an error.

**The bar's motion is the byte stream.**
`fetchWordlist` reads the body as a stream (`resp.body.getReader()`) and shows accumulated bytes ("Downloaded 1.4 MB") as they arrive (repainted throttled to `FETCH_PROGRESS_THROTTLE`, 150ms).
The bar is neither a percentage nor a constant animation — both would lie.
A percentage needs a trustworthy total, but GitHub Pages serves wordlists gzipped, so `Content-Length` is the *compressed* wire size while the reader yields *decompressed* bytes, with no header to correct it (`Content-Encoding` is unexposed cross-origin and stripped after decode).
And a fixed-rate barber-pole spins identically whether bytes are flowing or the socket is dead, masking the exact stall the panel is for.
So the bar is instead a **single segment swept by the bytes actually arriving**: a `requestAnimationFrame` loop sweeps it across at a speed that **saturates** toward a full-speed cap (`FULL_SWEEP_HZ`) once the rate clears a small knee (`RATE_KNEE`, via `1 − e^(−rate/knee)`).
So anything downloading at a reasonable clip reads as moving at roughly full speed, only a near-stall crawls, and a true stall freezes it mid-bar.
The speed is deliberately **not** linear in the rate — that made a slow-but-fine connection (throttled 3G) crawl like molasses, when the whole point is to flag stalled-vs-moving, not report exact throughput.
It wraps off-screen at both ends (a 40%-wide segment running `left` from −40% to 100%), so the loop leaves no seam.
The rate is exponentially smoothed (`RATE_TAU`, its time constant) so bursty chunk delivery doesn't make the segment stutter, with the EMA weight derived from each frame's `dt` so the smoothing is frame-rate-independent.
The motion only ever reflects real throughput.

**No controls; failures go to a toast.**
The panel has no buttons — it's a status display, not something to operate.
A wordlist download is short and either finishes or fails, so there's no manual stop (and therefore **no timeout** either — nothing aborts a slow fetch, by design).
On failure the handle is dropped and the error surfaces as a closeable **toast** with a **Retry** action (`showActionToast`) — `Couldn't load XWI · Retry`.
A toast is the right home for an error: it's dismissable and doesn't silently vanish the way a transient progress row would, and Retry re-runs the fetch as a foreground request (so it reveals in the panel immediately).
The one edge this accepts: a fetch that hangs forever — connected but never sending or erroring — leaves a loading row that clears only on reload.
That's rare, and a frozen row is arguably the honest signal that it's still stuck.

**Architecture.**
The registry and `fetchStatus$` signal live in `data/fetch-status.js`; `fetchWordlist` (app) registers a handle and mutates its `bytesLoaded` in place, the panel (ui) renders off the signal.
The signal hop keeps data/ off ui/ (the same inversion as `syncStatus$`); the handle is plain data, with no callbacks reaching back up into app/, because a read-only panel has nothing to drive.
The panel is a keyed reconciler rather than an innerHTML rebuild: signal repaints only add/remove rows and update the byte text, while a separate `requestAnimationFrame` loop reads each handle's live `bytesLoaded` every frame to advance its bar segment — so the motion tracks the byte stream at frame resolution, finer than the throttled 150ms text repaint, and stops the moment bytes stop.

## Rescore rules

The unified scale is an *optional* mapping, not an enforced contract: the tier labels on **All Wordlists** (`state.scoring`) define what each score range means, and every wordlist's rescore rules describe how its raw scores map onto that scale.
**Grawlix does not nag when they don't line up.**
A constructor importing a personal wordlist scored on its own scale may not care about alignment at all — the score column is ignorable, and search/filter/tools all work regardless — so unmapped raw scores and unlabeled merged scores pass through silently.
There is no misalignment signal: no coverage banner, no "unhandled scores" warning, no severity bubble for score gaps.
People don't need to be cajoled into adopting the unified scale; the app is fully usable without it, and surfacing every gap as a warning the user is expected to resolve reads as a chore.
The only thing that surfaces in the selector is an available **update** — see § *Fetching & updates*.

**Repeated entries collapse at parse.**
Two lines sharing a `(norm, display)` dedupe to the first at parse time (`parseWordlist` and the columnar `gatherColumns`), ignoring the later copy's score/comment — the same first-wins resolution the merge already applies to a same-norm bucket.
Enforcing it at the parse boundary is what makes the entries table, the counts, and the provenance panel agree; before, only the provenance table diverged, listing the redundant row twice (the reported "same word shows up twice").
Distinct spellings (`eta`/`ETA`, a bare `theirs` beside a spelled `the IRS`) differ in the key and survive — the deliberate rich-list split, not a duplicate.
The dedupe is in-memory over the untouched stored file, so **Download original** stays verbatim while the rescored **Download** and the disk mirror reflect it.

**Update badge.**
A single 7px green dot (`#7add9e`), `.badge[data-severity="info"]` rendered by `buildBadgeHTML(severity, { title? })`, flagging a wordlist with an available update.
It renders inline at the right edge of its host — next to the name on a selector row — sized to read as a colored bullet, not a corner overlay.
The collapsed selector trigger carries an **aggregate** dot when any source has an update, so a folded selector still flags it; the per-row dots show the specific lists in the open menu.
`info` is the only severity in play today, but `maxSeverity(...)` / `SEVERITY_PRIORITY` still resolve a winner when badges aggregate, leaving room for a second cause without reworking the plumbing.

**Tier labels live on `state.scoring`, not on any wordlist.**
The default tiers (`DEFAULT_SCORING`) are JK's default rules, derived rather than duplicated: 60 Good, 50 Average, 40 Okay in moderation, 30 Not good, 20 Junk, 10 Offensive, 0 Gibberish.
Every score badge (`buildScoreBadgeHTML` — the entries table and the update-summary dialog) carries its tier label as a hover tooltip and in its `aria-label`; a score no tier covers gets no tier name.
The unified scale belongs to the merged output (All Wordlists) — what every wordlist gets translated *into* — not to any single wordlist.
A top-level `state.scoring` lets a user customize the unified scale without it living on a "wordlist" data field; the editor that edits it sits on All Wordlists' panel alone.

**My Edits is an ordinary ruled source.**
It carries rescore rules like any other wordlist.
A score typed into the entry panel is stored **raw** in `rawEntries`; the merge runs it through My Edits' rescore rules (`getRescoredEntries`, the same path every source takes), so a typed `52` surfaces remapped only when a rule covers it.
It ships seeded with the **default tier legend** (`editsLegend()` — `state.scoring`'s live tiers as blank-output passthrough rows), so a fresh My Edits documents the tier scale right where the user types scores while remapping nothing; the typed value stays the merged value until the user fills in an output.
These are real defaults — `getWordlistDefaultRules` returns them for My Edits — so the legend resets, dirty-tracks, and propagates to non-dirty lists exactly like a publisher's defaults.
Because the legend mirrors the *live* `state.scoring` rather than a frozen copy, retitling or re-ranging a tier on All Wordlists re-flows into a non-dirty My Edits legend through that same propagation.
Whether the raw scores line up with All Wordlists' tiers is the user's choice; Grawlix doesn't coerce them.
The synced on-disk file holds raw scores, so external editing and rescoring coexist: the file is always raw, and rescoring applies on the way into the merge.

**Import reconciles the legend.**
The legend documents the default tiers, which would mislabel a personal list scored on some other scale.
So on import into a non-dirty My Edits, if the file's scores don't *all* land on documented tiers, `reconcileEditsRulesAfterImport` drops the legend and auto-seeds the file's actual scale instead; an import already on the tiers keeps it, and a user who has edited the rules (dirty) is left alone.
"Lines up" is a deterministic membership check — every distinct score matches a legend input — not a confidence guess, so it sidesteps the same objection that killed auto-suggested mappings.
Propagation to *existing* users is deliberately **unguarded**: every non-dirty My Edits gets the legend on the next boot, even one already holding a foreign-scaled list.
That injection is inert (blank outputs re-grade nothing) and deletable, so the cost is a one-time possibly-wrong legend for the rare pre-existing foreign-scale list — accepted to keep `propagateDefaults` free of entry inspection.

**Auto-seeded inert rules on custom-wordlist import.**
When a custom wordlist (no `publisherId`) is fetched or imported with empty rescore rules and ≤10 distinct scores, Grawlix seeds one inert row per distinct score.
Visible-but-inert: the editor shows the wordlist's score scale as concrete rows the user can fill in to translate into the unified scale.
Identity mappings (`60 → 60`) aren't seeded because that would assert the wordlist uses the unified scale — wrong claim for an unknown source.
Above the threshold the seeding is skipped and the editor opens empty; the user can add rules if they want, or leave the raw scores to pass through untouched.
A wizard-style "rescore on import" was considered and rejected as speed-bump UX; an auto-suggested mapping based on score distribution was rejected because low-confidence guesses would mostly be wrong.

**Baking rescoring into the scores.**
"Make permanent" (a rescore-editor footer action beside Disable rescoring, `bakeRescoring`) rewrites each `rawEntry.score` to its rescored value, then resets the rule layer the same way an import does — `editsLegend()` + reconcile for My Edits, clear + auto-seed for a custom list.
Because it reads committed rules, it commits the open draft first (so it bakes exactly what the preview shows); unlike Save it leaves the editor open, reseeding the draft from the reset rules so the user can keep working.
It's the in-place form of Download-rescored → re-import → reset rules, and it exists for the user who translated a personal list onto the unified scale via rules: afterward raw-score edits in the table would otherwise be re-transformed by those rules, so baking ends the dual-scale split.
Gated to `!publisherId && !url`: a fetch URL would re-pull original-scale data and undo the bake, and a publisher's `defaultRules` are a live transform, so resetting a baked publisher list to them would re-rescore already-baked scores — the action disables (not hides) outside that gate, and when no rule changes any score.
That last gate scores the *live draft*, not just the committed rules, so the action lights up on unsaved rescoring without a Save round-trip — the commit-first sequence then bakes exactly what is on screen.
Rescoring is total (there is no `ignore` output), so baking only ever shuffles scores; it never drops entries.

**Default-rule propagation via a `dirty` flag.**
Each wordlist with defaults — every publisher-bound source, plus My Edits against its tier legend — carries a persisted `dirty` boolean against those defaults; `state.scoringDirty` tracks the tier scale.
`dirty` is recomputed from a direct equality check (`rescoreRulesEqual` / `scoringRulesEqual`) after every rule edit, so an edit landing back on defaults flips it false automatically.
At boot, `propagateDefaults()` walks every rule set: if persisted rules differ from current in-code defaults and `dirty` is false, rules are silently overwritten with the new defaults.
Dev-shipped updates land for pristine users without intervention.
The same path is what makes order-sensitive equality safe for existing users: a pristine list whose rules happen to be stored in a different order than the current defaults reads as "differs," so `propagateDefaults` renormalizes it to the authored order off the *persisted* (false) `dirty` flag — `dirty` is never recomputed at load, so the order change can't spuriously mark anyone dirty.

Propagation is silent — no toast.
Rule updates only ever *add* coverage; they never re-grade existing entries, so there's no user-visible change to explain.
A seed-fingerprint snapshot was considered as an alternative to the dirty flag and is functionally equivalent — the flag won on simpler mental model.
A code-side history of past `defaultRules` per publisher was considered and rejected as heavier.

**Reset button scoped to the editor.**
"Reset to defaults" is a footer text-link, shown whenever the *draft* diverges from the wordlist's defaults — it tracks the draft, so it appears the moment an edit diverges and vanishes when one lands back on them, rather than waiting on the committed `dirty` flag.
It confirms before wiping customizations, then stages the defaults into the draft like any other edit (Save commits).
Visible only inside the editor and only when there's something to undo — a reset button shown anywhere rules differ from defaults would feel nudgy.
Per-rule revert was considered and rejected: any rule-matching algorithm is fragile, and the editor itself is the granular tool (a user wanting to revert one rule can manually retype its value).

## Open questions

### Disk sync: deferred gaps

Known limitations to address as the need surfaces:

- **External rename/move of a synced file.**
  The stored handle goes stale; reads return `null` and the sync pill flips to **Can't find _filename_** (attention-tinted).
  The off-ramp is Turn off and set up again, or the boot splash's re-grant on next launch — no inline mid-session reconnect, and no automatic follow-the-file.
- **External deletion of a synced file.**
  Same shape: the list reads `unavailable`.
  A mirror re-creates the file on its next write; My Edits stays paused until the user reconnects or stops syncing.
- **Settings export/import.**
  The dropped `grawlix.json` settings mirror has no live replacement yet; a manual export/import is the planned successor ([`planned/settings-backup.md`](planned/settings-backup.md)), config-only vs. full-backup scope still open.
- **Folder→per-file migration.**
  Deliberately not built — old folder-mode users re-attach manually (see [`migration.md`](migration.md)).
