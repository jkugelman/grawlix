# Shell shape — compact alternative (parked)

The shipped shell is the centered, page-scrollable card with stats + tool stack + search bar as the sticky region — see [`design.md` § The shell](../design.md#the-shell). This file documents the *compact* alternative shape that was worked out alongside it but not built. Revisit if the shipped shape doesn't pull its weight (e.g. the gallery + stats above the sticky region feels like wasted real estate, or scrolling past them every session feels like friction).

## The compact shape

Push everything into a sticky two-row chrome stack: stats + search, plus the tool stack between them when populated. Wordlist picker and tools popover trigger live as typographic headings on the stats bar; tool gallery hides behind the "Tools ▾" heading; stats bar slims to Entries + histogram only.

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

- **Wordlist settings (⚙) placement.** The heading-style picker doesn't naturally carry a gear; either (a) a "Manage wordlists…" item at the bottom of the picker dropdown, or (b) a small icon button next to the heading.
- **Sync indicator placement.** Once visible (per [`sync.md`](sync.md)), where does it land? Header? Picker popover? A separate slot on the stats bar?
- **Score legend popover trigger.** Where does the user click to surface it? Hovering a score badge gets a quick read. A dedicated "Scores ▾" heading on the stats bar (third sibling next to "All ▾" and "Tools ▾") is one option; an info affordance on the histogram is another.
- **Tools popover layout.** [`tools.md`](tools.md) plans a category picker (categories on the side, cards in a grid). The popover is the natural home. Anchored vs centered, dimensions, gallery search input placement — all TBD when the popover lands.
- **Mobile responsive transitions.** Specifics (where things go when narrow; how Tools opens at phone width) deferred to the mobile design session.
