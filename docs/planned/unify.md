# Unified main screen — folding the Library into the Workshop

**Status:** Planned, not yet built. A large redesign that collapses Grawlix's two top-level views (Workshop, Library) into a single main screen. The data model is largely untouched — merge, rescore, pipeline, caches, disk sync all stay — so this is a recomposition of the view layer plus one new capability (scoping tools to a single wordlist), not a logic rewrite. Implementation is a separate effort (see [Implementation](#implementation)); this doc settles the *what* and *why*. When it ships, fold it into [`../design.md`](../design.md) and [`../manual.md`](../manual.md) via the `distill-design-doc` skill.

## Why

Grawlix split into two views — **Workshop** (tools, stack, entries table) and **Library** (wordlist management: rail, rescore rules, scoring tiers) — as it grew. The reasoning was real at the time: tools could focus one view, wordlist management the other, and crucially the Workshop wouldn't carry a busy wordlist picker — a left rail that's useless most of the time when you're just using the tool gallery.

Two things undermined that split:

- **Users keep asking for features that blur the line.** Filter the Workshop by wordlist; sort, filter, and *edit* entries in the Library. The boundary between "use the wordlist" and "manage the wordlist" turned out to be artificial — people want to do both in one place.
- **The responsive picker proved the rail can condense.** The Library's wordlist picker already collapses from a full card rail into a dropdown on narrow viewports. That removes the original objection: the picker no longer needs to be a permanent, space-hungry rail. A dropdown holds the whole thing.

So the split's main justification is gone, and the friction it causes is real. Grawlix returns to one screen.

The shape of the new screen is governed by one principle: **the default state must stay as calm as today's Workshop.** Someone who shows up to look a word up (the "sidekick" mode in [`../design.md`](../design.md#workspace-and-sidekick)) should see essentially what they see today — a search box and results. Curation chrome (rescore editor, per-source actions, the manage panel) appears only when summoned. Otherwise we'd have merely rotated the always-on rail 90° into an always-on bar.

## The keystone: the selected wordlist is the corpus

The unifying idea is a single notion of *what you're looking at*:

**`state.selected` — either `All` (the merged view) or one source — is the corpus for both the entries table and the tool pipeline.**

- Select **All** → today's merged Workshop, exactly as now. This is the default and the 95% case.
- Select **XWI** → the table shows XWI's rescored entries, in the same rich editable style, and tools run against XWI.

A scoped source feeds the same `executePipeline` the merged view uses — the corpus is just that source's own rescored entries (no My Edits overlay; see [The editing model](#the-editing-model-edits-route-to-my-edits)). The pipeline *logic* is reused, but building a scoped corpus is **net-new code**, not a free consequence of an existing parameter. `buildMergedWordlist` today takes no arguments and memoizes one global cache, and the single-source path is a flat `getRescoredEntries(...)` array with no `byNorm` / `byKey` / `sourceCounts` / `_initialChains`. A scoped corpus must synthesize all of those, invalidate the module-global `_preSearchCache` on every scope switch, and make the histogram layout (today computed over the union of *all* sources) scope-aware. The source column, meaningless when one source fills every row, hides under scope.

This grants the three things users keep asking for as natural consequences rather than bolted-on features:

- *Filter the Workshop by wordlist* → select that wordlist.
- *Sort/filter the Library* → it's the same sortable, filterable table now.
- *Edit in the Library* → atoms are editable everywhere; `AtomPopover` already routes edits to My Edits regardless of which source a row came from.

It also dissolves a redundancy: the Library's read-only monospace entries view goes away. There is one canonical way to view wordlist data — the rich editable table — instead of a first-class view and a second-class mirror.

### Scope, not filter

"The selection is the corpus" deliberately means **scope** (the corpus *becomes* that source, by itself), not **filter** (subset the merged view). With sources in priority order **My Edits > Broda > XWI**, and `ocean` at Broda 90 / XWI 70, `tide` at XWI 40 with your My Edits edit of 55, and `zebra` only in Broda at 60:

| View | `ocean` | `tide` | `zebra` |
|---|---|---|---|
| **All** | 90 (Broda wins) | 55 (My Edits) | 60 (Broda) |
| **Scope = XWI** | 70 (XWI's own — Broda not mixed in) | 40 (XWI's own — your My Edits 55 isn't overlaid) | *absent* (not in XWI) |

Scope shows a source as *itself*, with **no other publisher's opinion — and no My Edits overlay — mixed in**: `ocean` reads XWI's 70 (not Broda's 90), `tide` reads XWI's own 40. Your My Edits edit of `tide` (55) isn't shown here; it surfaces in **All** (where My Edits wins) or when you scope to **My Edits** (see [The editing model](#the-editing-model-edits-route-to-my-edits)). The word set is the source's: `zebra`, which XWI lacks, is absent.

Filter — re-merging over a subset of *publishers* — is deferred, because it's almost entirely covered already: it's the same as disabling the rest and viewing All, which the enable/disable controls do. The only thing filter adds is a *transient* subset that doesn't change the persisted enabled flags — a minor convenience, addable later as a facet if anyone asks. The selector is single-purpose: **click a name = scope** (single-select corpus); enable/disable — which lists feed the All merge — lives in the manage panel, not the picker, so the dropdown stays a clean, title-like list of icons and labels.

## The screen

One view, no view selector. The chrome, top to bottom:

- **Brand row** — wordmark on the left, the personal "Made with…" text returning to the center (where the Workshop/Library nav used to sit), settings and help on the right. Pure brand chrome again; the darkened-purple subtitle band is removed and its personal text moves up into this row.
- **Wordlist bar** — takes the place the subtitle band vacated. Holds the wordlist selector and the actions for the current scope. This isn't net-neutral on height (a functional bar is taller than a line of text), but it's a swap of passive chrome for active chrome, not a new bar stacked on top of everything.
- **Results region** — the existing tool stack → stats bar → entry headers → entries table, unchanged. Everything here now reflects the selected scope rather than always-All.

The brand bar's principle from [`../design.md`](../design.md#the-shell) — "per-wordlist state and pickers stay out of brand chrome" — is preserved: the picker lives in its own bar below, not in the brand row.

### The wordlist selector and the manage panel

The **selector** is a pure picker: the list of wordlists (All at the top, then sources), click a name to scope to it. It is the universal control on every viewport — desktop and mobile both. The collapsed-nav mobile special case disappears with the view selector. (Caveat: the shipped responsive collapse is mobile-only — ≤759px — so only the mobile behavior is proven; the **desktop** dropdown is net-new UI, not a free reuse.)

When the scoped list is **disabled**, the selector renders it in disabled styling. You still land on it (the table shows it, it's still editable, tools still run) — disabling means "exclude from the All merge," not "can't look at it" — and the disabled state reads straight off the control, no separate note.

A **manage panel** (a settings/adjustments button next to the selector) owns the *cross-list* operations: reorder, enable/disable, add wordlist. It is deliberately separate from per-source configuration (which stays per-source — see below), because reorder and enable are cross-list concerns while rescore, rename, and the like are properties of one list.

The manage panel is **Apply-gated**, and this is also the performance strategy (see [Performance](#performance)):

- Reorder and toggle operate on a **staged copy** of order + enabled flags — no merge is touched while staging. But the staging layer itself is **new infrastructure**: a shadow order/enabled model the panel mutates and renders from, separate from `state.sources`, committed by replaying onto the real mutation helpers on Apply. (Today `reorderSources` / `setWordlistEnabled` mutate canonical state immediately; `batchUpdate` can coalesce the commit into one rebuild but doesn't provide the shadow layer.) The table behind the panel keeps showing the pre-change state.
- **Apply** commits the batch with a single merge rebuild, behind the modal, where a brief "Applying…" is exactly what a user expects after clicking Apply. **Cancel** discards. This converts what is today a freeze on *every* drag and *every* toggle into one expected pause on a deliberate confirm.
- **Add wordlist** launches the existing import/fetch flow immediately as a sub-dialog (you can't "stage" a fetch). On completion you return to the still-open panel with the new list present and keep arranging until Apply; the new list's position and enabled flag join the staged batch.
- **Dismissal:** no backdrop-dismiss. Cancel discards (no guard — that's its job); the X closes, guarded ("discard changes?") only when changes are pending. This follows a general rule worth adopting app-wide: *outside-click-to-dismiss is fine when dismissal is non-destructive, and off when it would discard unsaved edits.* A Cancel button is the proxy for "holds unsaved edits." The exception is bare Confirm/Alert dialogs, where cancel *is* the safe default, so backdrop-dismiss stays fine there. This is a deliberate divergence from the current `createDialog`, which delegates backdrop clicks to dismiss for everything.

### Per-source actions

When a source is scoped, the wordlist bar carries that source's actions:

- **The sync pill** stays exactly as it is today — a sign hanging from the bar (`margin-right: auto`, actions to its right), the single always-present element for disk-sync status and control. It is not folded into a menu.
- **The split Download button** — Download (rescored output) / Download original — as today.
- **Import** — into the scoped source.
- **A slim per-source kebab** — the rare per-list actions that don't earn their own affordance: rename, change icon, bake rescoring ("Apply rescoring permanently"), delete. Rename moves here entirely; the F2-on-a-card shortcut is dropped, since cards now live inside the picker and manage panel where a card-focused keyboard shortcut no longer fits.

This is three menu-ish surfaces in total — the cross-list manage panel, the per-source kebab, and the existing export-results kebab in the stats bar (copy / download-as-wordlist / CSV / JSON). They have clean, non-overlapping domains (arrange all lists / configure this list / export what I see) and live in different bars, so they don't blur together.

## Rescore and scoring

### One inline editor, polymorphic by scope

Rescore-rule authoring lives in an **inline-expandable area** on the wordlist bar, default-collapsed, summoned when you want it. It is **usable while scrolling** — pinned in place so the entries table scrolls beneath it — because the whole point is to tune a rule and watch its effect.

And the effect shows up in **the main table itself**: when the rescore editor is open, the scoped source's rows display their raw→rescored `→` annotations (the same authoring feedback the Library shows today), so the table *is* the live preview. That collapses the old Library rescore section, which had to carry its own preview list, down to just the rule rows plus Add / Reset / Neutralize. Default-collapsed, it costs nothing until summoned.

The `old → new` annotation here is the **rule** arrow `350 → 80`, shown on rule-changed rows while the rescore editor is open — the table's live preview of how a rule remaps scores.

The same affordance is **polymorphic by scope**, mirroring today's Library exactly ("one rules slot, content differs by panel"):

- On a **source**, it edits that source's **rescore rules**.
- On **All**, it edits the **tier labels** (`state.scoring`) — the unified scale's names.

So there is no separate home for the tier editor; it is the All-flavored version of the rescore editor.

### No legend; the tooltip already is one

The scoring tiers do not get a persistent on-screen legend. They don't need one: every score atom already carries a hover tooltip naming its tier ([`../design.md`](../design.md#library) — Scoring rules). That serves the once-in-a-while "what does 50 mean again?" lookup at zero permanent cost, which is why an always-visible legend block was rejected before. This redesign reinforces that decision rather than reversing it — the *display* of tiers is the tooltip; only the *editor* needs a home, and it has one (above).

### Neutralize, don't delete

The de-rescoring affordance — for the user who wants a list's raw scores and notes but not Grawlix's remapping — **neutralizes** the rules rather than clearing them: it blanks every rule's `output` and drops the `scoring:false` rows (the pure-rescore special cases, like length-specific "short fill" overrides, that have no place in the scale's documentation). What survives is the input ranges and notes as a documenting legend, with no remapping. The numbers and notes are valuable; only the rescoring is being ditched. (This reuses the exact transform the "levels" rules-option already runs: `rules.filter(r => r.scoring !== false).map(r => ({...r, output: ''}))`.) It coexists with "Reset to defaults": neutralizing makes the list dirty, so Reset remains available to undo. On All it's a no-op — tier labels are already blank-output with no `scoring:false` rows — so All gets no neutralize affordance.

## The editing model: edits route to My Edits

Edits always save to My Edits — that rule is unchanged. What the redesign settles is how that interacts with scope, and the choice is **simplicity over a live overlay**: a scoped view shows the scoped wordlist's *own* data, full stop. No My Edits overlay is laid on top of a scoped source.

The consequence is deliberate and accepted: edit `ocean` while scoped to XWI and the edit lands in My Edits, but the XWI-scoped table keeps showing XWI's own value — your edit *appears to vanish from this view*. It surfaces where My Edits actually participates: in **All** (My Edits is top priority and wins there) and when you scope to **My Edits** itself. Each scope simply shows one wordlist; All shows the merge. (An overlay that injected My Edits into every scope was considered — it would keep the edit visible — but its bookkeeping, a per-scope edit-patch path plus an override indicator, outweighed the benefit. Whether the bare-collapse of two distinct same-norm words is right is a separate, parked merge-model question.)

So there is **no override indicator** in the table: no `base → edited*` arrow, no asterisk. A scoped score cell shows that wordlist's effective score, nothing more.

**The popover as a provenance panel.** With a scoped view showing only one wordlist, the `AtomPopover` carries the cross-wordlist picture: it is an editor *and* a full-provenance panel. For the clicked entry it shows every contributing wordlist — in priority order, with that wordlist's actual entry text, effective score, and comment — **including disabled and non-winning** contributors. This (a) **serves the trust use case** — a constructor who doesn't auto-believe the top-priority list sees at a glance whether another list (even one they aren't merging) scored or spelled the entry differently; (b) **is the cross-wordlist view when scoped** — the scoped table shows one list, so the popover is where you compare; and (c) **fixes the "lying Source column"** — the table attributes one source per row, but display, score, and comment can each come from a *different* contributor (comment fall-through is designed to do this — see [`../design.md`](../design.md#rich-wordlists)).

**Which contributors show, by entry.** Treat the bare (no-casing) form as the ancestor of each spaced/cased spelling of the same norm. Click a **bare** entry → the popover lists the **whole norm** (every spelling, in every wordlist). Click a **specific spelling** (e.g. `the IRS`) → it lists that spelling plus the bare forms it descends from, but *not* sibling spellings (those have their own rows). The lookup is cheap — `wordlist._rescoredByNorm` already exists per source, so gathering contributors for one norm is O(sources) — but the **panel itself is a new sub-component**: today the popover shows a single winner-source row, so the multi-contributor, variant-aware layout is net-new, and because it must include disabled/non-winning contributors it cannot reuse `computeMergedBucket`'s enabled-only walk.

**Layout.** A compact table whose columns match the entries table — **Entry · Score · Comment · Source** (Source last) — one row per contributor in priority order, disabled ones dimmed. There is no winner-highlighting or summary line; the list reads top-down. The Entry cell shows each wordlist's *actual text* (a lowercase contributor reads `theirs`, a spaced one reads `the IRS`), so the casing distinction is visible with no norm/display jargon. Scores are **effective (rescored)** only — no per-wordlist `raw → rescored`, since raw scores are per-wordlist-scale and non-comparable (raw→rescored belongs in the rescore editor).

**Editing is raw, not rescored.** The popover's score input edits the **raw** stored value (what My Edits keeps), not the displayed effective score. In the common case My Edits ships a pass-through legend, so raw == rescored and the distinction is invisible; when My Edits carries non-pass-through rescore rules the two diverge, and the popover surfaces the `raw → rescored` mapping so the edit isn't silently lossy. (Rescoring is many-to-one and non-invertible, so editing the rescored value couldn't be stored faithfully; putting rescore rules on My Edits means accepting that you enter raw while the table shows rescored.)

## Onboarding

The multi-page onboarding wizard goes away. Real user feedback drove this: the wizard's page-at-a-time form was unsatisfactory — a user who wanted to import his edits didn't realize the wizard's third page would get him there, and the first page asked about something he had no opinion on. A wizard is the wrong shape, and a banner that nags everyone (including the tool-gallery-only majority) is the wrong default.

Its real jobs are relocated as **self-targeting** affordances — visible only to people already in the relevant context, never as a global nag:

- **Welcome/orientation** → the planned help system's Getting Started page ([help.md](help.md)); not a banner.
- **Import a personal wordlist into My Edits** → a dismissable banner in the My Edits view, shown when My Edits is scoped.
- **XWI-subscriber import** → a dismissable banner on XWI, shown when XWI is scoped and still present-but-unpopulated. This is the discovery with the most value (a subscriber may not know Grawlix can ingest their better list) and it's naturally self-targeting — it appears only in the exact situation it matters.
- **"No thanks, remove them"** — today's one-click blank-out that wiped default wordlists, tier labels, *and* rescore rules — keeps exactly one of its three jobs: **Neutralize rescoring** (above), source-scoped, in the rescore editor. Clearing default wordlists is dropped (delete individually via the manage panel; few bother), and so is bulk-clearing tier labels (they're optional decorative labels now that the tooltip is the legend). The all-in-one "nuke everything" button disappears with them — an accepted behavior change.

## Persistence and URL

- **Score-range filter: per-scope, one map, no migration.** Today there are two systems — the Workshop's single global `scoreRange` and the Library's per-source `libScoreRanges` map. They collapse into one map keyed by scope (`__merged__` plus each source's `dbKey`). This is a net simplification (one system replacing two), avoids cross-scale surprises (each scope's range is bounded by its own data), and matches the per-source flexibility Library users already have. It needs no `SCHEMA_VERSION` bump: the new key is a standalone read-time-default setting like `darkMode`/`autoUpdate`, the old keys orphan harmlessly, and users' saved ranges simply reset. The score filter stays out of the URL, as today (scores aren't comparable across users; it's a standing preference, not a query).
- **Selection is sticky.** The selected scope persists in localStorage (another standalone read-time-default key, no migration) so a refresh doesn't reset to All. On restore: a vanished list falls back to All; a now-disabled list still loads (rendered disabled in the selector). This shifts the landing rule from "always All" to **All on first run, last scope thereafter**.
- **Scope is local, never shared.** A shared link carries only the pipeline; the recipient sees the same tools applied to *their* current scope (usually All). The sender's scope doesn't travel — the recipient may not have that source, and graceful-degrade-to-All is fine for the narrow case of sharing a scoped view. Encoding scope by publisher id was considered and rejected as not worth re-opening the stable-links surface.
- **View routes are deleted.** `#/workshop` and `#/library` collapse to the bare URL plus the pipeline query. Per the still-pre-launch-clean URL policy ([`../design.md`](../design.md#stable-links-dont-rename-dont-remove)), they're simply removed — no alias table.

## Performance

The merge stays **eager and simple.** Today three "global" mutations each rebuild the whole merged view synchronously and freeze the tab for ~300ms–1s: reorder, enable/disable, and committing a rescore-rule edit. The `lazy-merge` branch tried to make these incremental and concluded (in its own write-up) that the fix wasn't worth it — it regressed boot and left three winner-resolvers that must stay bit-for-bit in sync forever.

Two structural choices in this redesign make the eager merge fine without that machinery:

- **The Apply-gated manage panel** turns reorder and enable/disable from many surprise freezes into one expected, signposted pause on a deliberate Apply. The rebuild is rare and the user is braced for it.
- **Scoping defers the rebuild.** Editing a source's rescore rules while scoped to that source re-grades only that source's rows — cheap, one list, exactly the Library's current preview cost. The expensive All rebuild can wait until the user switches back to All. **This deferral is new plumbing, not present on `main`** — mark-the-merge-dirty-while-scoped, rebuild-on-switch-to-All. (The parked `lazy-merge` branch prototyped exactly this via `workshopRefreshOrMarkDirty` / `consumeWorkshopDirty`, but those helpers live only on that branch, entangled with its skeleton rearchitecture — so this redesign reimplements the small deferral without importing the rest.) It's real work, but far less than the full lazy-merge machinery.

So the costly recompute happens once, on an action the user initiated and expects to take a moment — not on every keystroke or drag. The honest bottom line: "keep the eager merge" does *not* mean "no new perf work" — it means the new work is a small, well-scoped deferral plus the Apply gate, rather than the lazy-merge rearchitecture.

## What this reverses in `../design.md`

These current decisions are deliberately overturned; distillation should update them:

- **"Workshop is always-merged. No per-wordlist scope… no one wants 'anagrams in STWL only'."** The keystone is exactly per-wordlist scope; the rejected example is the case being built.
- **Two top-level peer views (Workshop, Library).** Collapsed to one screen. "Library is a peer view, not a setup dialog" is reconsidered: the *data* unifies onto the main screen, while cross-list *management* becomes a summoned panel — justified because the dropdown handles the frequent select and the expensive operations want an Apply gate anyway.
- **The read-only monospace Library entries view and the rescored/original identity contrast.** Dissolved into the single editable table.
- **"Default landing on All, including first run."** Becomes All on first run, last scope thereafter.
- **Rename via F2 on the wordlist card.** Dropped — rename is a kebab item now; with cards inside the picker/manage panel, a card-focused shortcut no longer has a natural home.

These are *reinforced*, not reversed: no persistent legend (the tooltip serves it); the score filter staying out of the URL; the pre-launch-clean URL policy.

## Open questions

- **Backdrop-dismiss is an app-wide change, not a panel detail.** Teaching stateful dialogs to opt out of `createDialog`'s backdrop-dismiss (see *The wordlist selector and the manage panel*) is a cross-cutting framework change with its own test surface; decide and land it as its own change.
- **Mobile wordlist-bar overflow.** When a source is scoped the bar packs selector + manage + sync pill + split Download + Import + kebab (plus the inline rescore expander when open). On narrow viewports it needs a stated collapse strategy — what folds into the kebab — much like the stats bar already collapses Min/Max under width pressure. Undesigned.
- **Test blast radius.** ~45 spec files assume the two-view shell, the Library rail, and the `#/workshop` / `#/library` routes; folding the views and deleting the routes re-points essentially every UI test. Behavior-level tests (search works, edit works, anagram works) are the intended canary, but many specs assert *view chrome*, so the churn is large — plan for it rather than expecting the canary to cover it.

## Implementation

A deliberately separate, large effort — the blast radius spans the view layer and a great many tests. The intended shape: a staged branch where each step keeps the app working and testable (universal dropdown → scope the pipeline to a selectable corpus → merge the content surfaces → collapse the chrome → remove onboarding → URL cleanup), with behavior-level tests (search works, edit works, anagram works) re-pointed at the unified screen as the canary that stays green throughout. This doc should be vetted by an independent reviewer before any code is written.
