# Shell shape

Restructure Grawlix's at-rest shell — the chrome around the word list — from full-bleed desktop-app shape into a centered, page-scrollable, content-shaped layout. Header full-bleed at top; everything below sits in a max-width card with side margins; the word list fills the remaining viewport with a single page scrollbar driving everything.

Two flavors of "what sits above the word list" are documented:

- **Option 1 — non-compact (primary).** Wordlist picker, tool gallery, and full stats bar all live above the sticky region, scrolling away with the page. Sticky region is just stack + search. The plan to implement.
- **Option 2 — compact (alternative).** Wordlist picker and tools popover trigger live as typographic headings on a slimmed stats bar; tool gallery hides behind the "Tools ▾" heading; the entire chrome above the word list compresses to a sticky two-row stack. Documented because we worked out the details; revisit if the non-compact version doesn't pull its weight.

## Motivation

The current desktop layout is full-bleed: fixed header, fixed left rail with the wordlist picker + tool gallery, main pane filling the rest of the viewport. The word list inside the main pane was once a wide spreadsheet-style table; today it's a narrow single-column atom list (one row per entry, ~24px tall, intentionally narrow — see [`design.md` § Word list](../design.md#word-list)). The shell didn't follow the word list's slimming. The result on the default view is an expanse of empty horizontal space to the right of the list — a UI that reads as "developer tool" rather than "thing I open to research a theme."

Two pressures push toward a different shape:

- **The empty default-view problem.** Tool gallery output (when it lands) will eventually use that horizontal space, but at idle and during search it sits empty. Bounded width plus centered column makes the empty space *intentional* — the side margins read as "this is a content page" rather than "the app didn't fill the window."
- **Mobile convergence.** [`plans/mobile.md`](mobile.md) commits to mobile support, with a Wordlisted-shape vertical flow (no rail, hero input, results scroll below). Both options below converge desktop and mobile onto the same vertical model — one DOM, one design, two widths.

## Common shape (both options)

These structural decisions apply equally to either option:

- **Page scrolls; the chrome above the sticky region scrolls away with the page.** Not a fixed-height app shell. Once the user scrolls into the word list region, the sticky region anchors and the word list takes over.
- **Centered max-width card with side margins** (~1000px target). Page background (`--bg`) shows through the side margins so the bounded width feels intentional. Card uses `--surface` and has a 12px border-radius on all four corners.
- **Full-bleed header, brand-only, sticky at top.** No wordlist picker, no global nav, no controls migrated up — raised explicitly during the design conversation and rejected.
- **Tool stack + search bar are sticky.** The working surface stays reachable while scrolling the word list.
- **One scrollbar.** The page scrollbar drives everything; the virtual scroller becomes window-scroll-aware (currently listens to `#vs-host`'s own scroll). Eliminates the two-scroll-container hack and the hidden-scrollbar workaround.
- **No persistent rail.** The rail's content disperses to other slots; specifics differ between the two options.

## Option 1 — non-compact (primary)

Wordlist picker, tool gallery, and full stats bar all live above the sticky region, scrolling away with the page as the user scrolls into the word list.

```
┌─ Header (full-bleed, sticky) ────────────────────────────────┐
│                                                               │
└───────────────────────────────────────────────────────────────┘
        ┌─────────────────────────────────────────────┐
        │  All ▾   ⚙                                  │
        │                                             │
        │  Tools                                      │
        │  [card] [card] [card] [card]                │
        │  [card] [card] [card] [card]                │
        │                                             │
        │  Entries  Min  Max     Mean  Median  Mode   │
        │  ▁▂▃▅▆▇▆▅▃▂▁                                │
        │                                             │
        │  [tool stack rows, when populated]          │ sticky
        │  🔍  Search   …                             │ sticky
        │                                             │
        │  1. CARE   4   50                           │
        │  2. CARED  5   60                           │
        │  ...                                        │
        └─────────────────────────────────────────────┘
```

**Wordlist picker** as a slim row at the top of the card: `All ▾` as a typographic heading on the left, settings gear (`⚙`) next to it. The picker scrolls away with the page; switching wordlists mid-scroll isn't a real workflow. Sync indicator joins this row when sync ships and the indicator becomes visible.

**Tool gallery** as a top section in the card. Cards laid out as a responsive grid (~180px wide each). Category picker (planned in [`plans/tools.md`](tools.md)) sits above as a chip strip — categories on top, cards for the active category in the grid below. Gallery search input stays where it is in the catalog. Gallery scrolls away with the page.

**Stats bar stays as-is** — Entries, Min, Max anchored left; Mean, Median, Mode, Histogram anchored right via `.stats-right { margin-left: auto }`. No slimming. Stats bar scrolls away too.

**Tool stack and search bar are sticky.** Stack appears only when populated (per [`design.md` § Tool gallery & stack](../design.md#tool-gallery--stack)). Search bar is the only mandatory sticky row.

**Scoring legend** stays as a visible read/write strip above the search bar (its current position), or moves to a popover — decide during implementation.

**Discoverability** is preserved — gallery is always visible on entry; new users see categorized tool cards by scrolling to the top.

## Option 2 — compact (alternative)

Push everything into a sticky two-row chrome stack: stats + search, plus the tool stack between them when populated. Wordlist picker and tools popover trigger live as typographic headings on the stats bar; tool gallery hides behind the "Tools ▾" trigger; stats bar slims to Entries + histogram only.

```
┌─ Header (full-bleed, sticky) ────────────────────────────────┐
│                                                               │
└───────────────────────────────────────────────────────────────┘
        ┌─────────────────────────────────────────────┐
        │  All ▾   Tools ▾          Entries  ▁▂▃▅▆▇   │ sticky
        │                                             │
        │  [tool stack rows, when populated]          │ sticky
        │                                             │
        │  🔍  Search   …                             │ sticky
        │                                             │
        │  1. CARE   4   50                           │
        │  2. CARED  5   60                           │
        │  ...                                        │
        └─────────────────────────────────────────────┘
```

**Wordlist picker and tools popover trigger live on the stats bar, as headings — not chips.** Bold typographic headings (`All ▾`, `Tools ▾`) on the left. Treating them as headings rather than as chips reinforces the scoping relationship: the stats describe whichever wordlist is named, and tools sits as a sibling heading-affordance. An earlier sketch used pill chips; that read as "two more controls competing for attention" rather than "the heading for this row."

**Stats bar slimmed to Entries + histogram only.** Min, Max, Mean, Median, Mode dropped. The histogram conveys distribution at a glance; the numerical triplet was fluff that looked nice when there was empty space to fill. Entries stays because exact count is genuinely useful and a histogram doesn't communicate it. Both anchor right.

**Tool gallery becomes a popover** opened by the "Tools ▾" heading. Discoverability moves from "always visible" to "one click away, then visual cards by category." The heading itself signals tools exist.

**Scoring legend hides to a popover.** Trigger surface TBD — could be a "Scores ▾" third heading on the stats bar, could be a hover affordance on the histogram.

**Sticky chrome is two rows tall** (stats row + search row), plus the tool stack between them when populated. Header sits above all three.

**Search bar's "Search" label aligns with tool-stack rows above.** No affordance sits to the left of the Search icon-and-label — the alignment between the search bar's "Search" and the tool-stack rows' tool-name labels is structural and worth preserving. The tools heading lives in the stats bar above for this reason; an earlier sketch placed it on the search bar's left edge and broke the alignment.

**Tradeoffs accepted in this option:**

- *Discoverability for tools moves one click away.* The gallery isn't always visible. Mitigated by the "Tools ▾" heading itself signaling tools exist; the popover is visual and categorized; new users find it via the heading or the help modal.
- *Five numerical stats removed from view.* Users who want exact numbers reach them via a hover tooltip, a dedicated stats popover, or the Wordlists dialog (decision deferred).

## Open questions

**Apply to both options:**

- **Wordlist settings (⚙) placement.** Today's gear icon next to the picker opens the Wordlists dialog. In Option 1 it sits next to the picker on the slim top row — natural fit. In Option 2 the heading-style picker doesn't naturally carry a gear; either (a) a "Manage wordlists…" item at the bottom of the picker dropdown, or (b) a small icon button next to the heading.
- **Sync indicator placement.** Today below the wordlist picker in the rail, hidden until backup state is reportable per [`plans/sync.md`](sync.md). Once visible, where does it land? In Option 1 it joins the slim top row. In Option 2: header? Picker popover? A separate slot on the stats bar?
- **Onboarding banner.** Currently in the Wordlists dialog rail; the dialog itself isn't affected and the banner stays there. Mention only because the rail's disappearance from the main view is the trigger to confirm.
- **Mobile responsive transitions.** Both options converge with mobile, but the specifics (where things go when narrow; how Tools opens at phone width; whether Option 1's grid collapses to a single column or a horizontal-scroll strip) are deferred to the mobile design session.
- **Help modal coverage.** Currently describes the pre-restructure UI; already out of date per [`plans/help.md`](help.md). Either shape makes the gap larger. The help redesign waits for [`plans/tools.md`](tools.md) to settle.

**Specific to Option 1:**

- **Scoring legend treatment.** Stays visible above search bar (current position), or moves to a popover? Visible is the conservative choice; popover frees a row. Decide during implementation.

**Specific to Option 2:**

- **Score legend popover trigger.** Where does the user click to surface it? Hovering a score badge gets a quick read. A dedicated "Scores ▾" heading on the stats bar (third sibling next to "All ▾" and "Tools ▾") is one option; an info affordance on the histogram is another.
- **Tools popover layout.** [`plans/tools.md`](tools.md) plans a category picker (categories on the side, cards in a grid). The popover is the natural home. Anchored vs centered, dimensions, gallery search input placement — all TBD when the popover lands.

## Real implementation (Option 1)

Ship in phases.

1. **Markup restructure.** Wrap stack + search in a single sticky container so the variable-tool-stack-height issue dissolves into "one sticky element of natural height." Move the wordlist picker DOM out of the (now-defunct) tool-gallery aside into a slim row at the top of the card. The tool gallery's existing `aside#tool-gallery` becomes a top section of the card (its `display: flex` rail layout flips to block; cards lay out as a grid; `.gallery-body` becomes the grid container). Stats bar stays where it is.
2. **Window-scroll-aware virtual scroller.** Today the scroller listens to `#vs-host`'s own scroll. Switch it to listening to `window` scroll and computing its viewport from its on-screen offset. ~12 lines of code; eliminates the two-scroll-container hack.
3. **Light/dark mode shadow tuning.** The centered card may need a subtle shadow in light mode to feel lifted; dark mode usually needs none. Decide during implementation.
4. **Onboarding banner.** Confirm it stays in the Wordlists dialog (no main-view banner needed).
5. **Help modal coverage.** Update slides for the new shell shape, or wait for the bigger help rework — see [`plans/help.md`](help.md).

If Option 1 doesn't pull its weight after dogfooding (e.g. the gallery + stats above the sticky region feels like wasted real estate, or scrolling past them every session feels like friction), revisit Option 2.

## Non-goals

- **No rail comeback in disguise.** The rail's content is dispersed elsewhere in either option. There's no "collapsible side panel" interim and no plan to add one.
- **No header chrome additions.** Header stays brand-only.
- **No two-scrollbar interim.** The window-scroll-aware virtual scroller is part of the real implementation, not a follow-up — shipping with two scroll containers (the mockup's state) isn't a stopping point.
