# Shell shape

Restructure Grawlix's at-rest shell — the chrome around the word list — from full-bleed desktop-app shape into a centered, page-scrollable, content-shaped layout. Header full-bleed at top; everything below sits in a max-width card with side margins; the chrome above the word list is a sticky stack only ~2 rows tall; the word list itself fills the remaining viewport with a single page scrollbar driving everything.

## Status

Not implemented. A CSS-only mockup lives in `site/index.html` under `<html class="shape-a">`; remove the class to revert, or delete the `Shape A mockup` block at the end of the `<style>` section. The mockup demonstrates layout and feel — the real implementation requires markup changes, JS changes to the virtual scroller, and real popover wiring (see *Real implementation* below).

## Motivation

The current desktop layout is full-bleed: fixed header, fixed left rail with the wordlist picker + tool gallery, main pane filling the rest of the viewport. The word list inside the main pane was once a wide spreadsheet-style table; today it's a narrow single-column atom list (one row per entry, ~24px tall, intentionally narrow — see [`design.md` § Word list](../design.md#word-list)). The shell didn't follow the word list's slimming. The result on the default view is an expanse of empty horizontal space to the right of the list — a UI that reads as "developer tool" rather than "thing I open to research a theme."

Two pressures push toward a different shape:

- **The empty default-view problem.** Tool gallery output (when it lands) will eventually use that horizontal space, but at idle and during search it sits empty. Bounded width plus centered column makes the empty space *intentional* — the side margins read as "this is a content page" rather than "the app didn't fill the window."
- **Mobile convergence.** [`plans/mobile.md`](mobile.md) commits to mobile support, with a Wordlisted-shape vertical flow (no rail, hero input, results scroll below). Shape A converges desktop and mobile onto the same vertical model — one DOM, one design, two widths. The mobile design session that's still pending becomes a much shorter walk.

## The shape

```
┌─ Header (full-bleed, sticky) ────────────────────────────────┐
│                                                               │
└───────────────────────────────────────────────────────────────┘
        ┌─────────────────────────────────────────────┐
        │ All ▾   Tools ▾           Entries  ▁▂▃▅▆▇   │ sticky
        │                                             │
        │ [tool stack rows, when populated]           │ sticky
        │                                             │
        │ 🔍  Search   …                              │ sticky
        │                                             │
        │ 1. CARE   4   50                            │
        │ 2. CARED  5   60                            │
        │ ...                                         │
        └─────────────────────────────────────────────┘
```

Header stays full-bleed and sticky. Everything below sits in a centered max-width card (~1000px) with side margins; the page background shows through to differentiate page from card. The card contains, top to bottom: stats bar (with picker + tools triggers as headings on the left, Entries and histogram on the right), tool stack (when populated), search bar, word list. Stats + stack + search are sticky; the word list fills the remaining viewport.

## Settled

**Page scrolls; chrome above the sticky block scrolls away with the page.** Not a fixed-height app shell. Once the user scrolls into the word list region, the sticky block (stats + stack + search) anchors at the top and the word list takes over.

**Centered max-width card with side margins.** ~1000px target; the page background (`--bg`) shows through the side margins to make the bounded width feel intentional. The card uses `--surface` and has a 12px border-radius on all four corners.

**Wordlist picker and tools popover trigger live in the stats bar, as headings — not chips.** They render as bold typographic headings (`All ▾`, `Tools ▾`). Treating them as headings rather than as chips reinforces the scoping relationship — the stats describe whichever wordlist is named, and tools sits as a sibling heading-affordance. An earlier mockup used pill chips; that read as "two more controls competing for attention" rather than "the heading for this row." The heading form won.

**Stats bar slimmed to Entries + histogram only.** Min, Max, Mean, Median, Mode are dropped from view. The histogram conveys distribution at a glance; the numerical triplet was fluff that looked nice when there was empty space to fill. Entries stays because exact count is genuinely useful and a histogram doesn't communicate it. Entries and histogram both anchor to the right side of the bar.

**Search bar's "Search" label aligns with tool-stack rows above.** No affordance sits to the left of the Search icon-and-label in the search bar — the alignment between the search bar's "Search" label and the tool-stack rows' tool-name labels is structural and worth preserving. The tools popover trigger lives in the stats bar above for this reason; an earlier mockup placed it on the search bar's left edge and it broke the alignment.

**Tool gallery becomes a popover (or dialog), opened by the "Tools ▾" heading.** No always-visible gallery. The original justification for the gallery was discoverability over Wordlisted's flat dropdown; that's preserved by making the popover visual and categorized — not flat. Discoverability moves from "always visible in the rail" to "one click away, then visual cards by category." The "Tools ▾" heading itself is the discovery surface for users who don't yet know tools exist.

**Scoring legend is hidden from the at-rest view.** Becomes a popover surfaced on demand — exact trigger TBD (see *Open questions*). The legend doesn't earn permanent vertical real estate; it's reference content users want occasionally, not constantly.

**Sticky chrome is two rows tall** (stats row + search row), plus the tool stack between them when populated. Header sits above all three as the page header proper. Total chrome ~186px when stack is empty, ~266px when populated.

**One scrollbar.** The page scrollbar drives everything: the chrome scrolls away, the sticky block anchors, the word list scrolls. The mockup fakes this by hiding the word list's inner scrollbar (the word list still has its own internal scroll, just routed via cursor position); the real implementation makes the virtual scroller window-scroll-aware so there's genuinely one scroll container.

**Header chrome stays minimal.** Brand only — no wordlist picker, no global nav, no controls migrated up. Decision was raised explicitly during the design conversation and rejected.

## Tradeoffs accepted

- **Discoverability for tools moves one click away.** The gallery isn't always visible. Mitigated by: the "Tools ▾" heading itself signals tools exist; the popover can be visual and categorized; new users find it via the heading or the help modal.
- **Five numerical stats removed from view.** Min, Max, Mean, Median, Mode all hidden. The histogram conveys distribution; users who want exact numbers reach them via a hover tooltip, a dedicated stats popover, or the Wordlists dialog (decision deferred).
- **Mockup has two scroll containers; real fix is JS.** Page-scroll above, word-list-internal below. The cursor's position routes the wheel to one or the other. Hidden inner scrollbar fakes the single-scrollbar feel for the mockup. Real fix is the window-scroll-aware virtual scroller.
- **Sticky-stacking with variable tool stack height needs a markup change.** The mockup hardcodes the stack at 80px; multi-row stacks will overlap with the search bar. Real fix wraps stack + search in a single sticky container so the inner stack height stops mattering.

## Open questions

- **Wordlist settings (⚙) placement.** Today's gear icon next to the picker opens the Wordlists dialog. In the heading-style picker, where does it go? Two candidates: (a) a "Manage wordlists…" item at the bottom of the picker dropdown, (b) a small icon button next to the "All ▾" heading on the stats bar.
- **Sync indicator placement.** Today below the wordlist picker in the rail, hidden until backup state is reportable per [`plans/sync.md`](sync.md). Once visible, where does it land? Header? Inside the picker popover? A separate slot on the stats bar?
- **Onboarding banner.** Currently in the Wordlists dialog rail; the dialog itself isn't affected and the banner stays there. Mention only because the rail's disappearance from the main view is the trigger to confirm.
- **Tools popover shape.** [`plans/tools.md`](tools.md) plans a category picker for the gallery (categories on the side, cards in a grid). The popover is the natural home for that picker. Layout details — popover vs full dialog, anchored vs centered, dimensions — TBD when the popover lands.
- **Score legend popover trigger.** Where does the user click to surface it? Hovering a score badge gets a quick read. A dedicated "Scores ▾" heading on the stats bar (third sibling next to "All ▾" and "Tools ▾") is one option; an info affordance on the histogram is another.
- **Mobile.** Shape A converges with mobile, but the responsive transitions (where the headings go when the stats bar can't hold them; where the histogram goes when narrow; how Tools opens at phone width) are deferred to the mobile design session.
- **Help modal coverage.** Currently describes the pre-restructure UI; already out of date per [`plans/help.md`](help.md). The shape A shift makes the gap larger. The help redesign waits for [`plans/tools.md`](tools.md) to settle, but the help slides will need to cover the popover-driven tool discovery story.

## Real implementation

Ship in phases. The mockup is an early-validation layer; real implementation replaces it.

1. **Markup restructure.** Wrap stack + search in a single sticky container so the variable-tool-stack-height issue dissolves into "one sticky element of natural height." Move the wordlist picker DOM out of the (now-defunct) tool-gallery aside into the stats bar. Add a tools popover trigger element to the stats bar.
2. **Window-scroll-aware virtual scroller.** Today the scroller listens to `#vs-host`'s own scroll. Switch it to listening to `window` scroll and computing its viewport from its on-screen offset. ~12 lines of code; eliminates the two-scroll-container hack and the hidden-scrollbar workaround.
3. **Real popovers.** Tools popover (with category picker per [`plans/tools.md`](tools.md)). Picker popover (or reuse the existing dropdown). Settings-gear placement (one of the open-question candidates above).
4. **Score legend popover.** Decide trigger surface; build the popover.
5. **Touch-up.** Light/dark mode shadow tuning so the centered card feels lifted in light mode. Onboarding banner integration. Help modal coverage waits for the bigger help rework.

Mobile responsive collapse happens in the mobile design session (see [`plans/mobile.md`](mobile.md)), not as part of this work — but the desktop shape is chosen with mobile convergence in mind.

## Non-goals

- **No rail comeback in disguise.** The rail's content (wordlist picker, tools gallery) is dispersed across the stats bar and a popover. There's no "collapsible side panel" interim and no plan to add one.
- **No always-visible scoring legend.** The legend is reference content; permanent real estate isn't worth it.
- **No header chrome additions.** Header stays brand-only.
- **No two-scrollbar interim.** The window-scroll-aware virtual scroller is part of the real implementation, not a follow-up — shipping shape A with two scroll containers (the mockup's state) isn't a stopping point.
