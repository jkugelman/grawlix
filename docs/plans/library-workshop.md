# Library/Workshop split

The Library/Workshop nav has shipped, including URL routing — see [`design.md § The shell`](../design.md#the-shell) and [`design.md § URL state`](../design.md#url-state). What's described here is the next pass: the structural redesign that finishes pulling source-curation out of Workshop and gives the Library its own identity. None of it has shipped yet.

## Core split

Two views answering two different questions about the same data:

- **Workshop** — *what entries are available to me right now?* The merged, rescored, override-applied view. The destination of all curation. Used for construction-aid work: tools, search, exploration.
- **Library** — *what does this source contain, and how does it get transformed?* Per-source raw values with the rescore rules visually adjacent. Used for curation: importing, rescoring, downloading, occasional inspection.

The visual languages diverge to reinforce the split — see *Identity contrast* below.

## Workshop: drop the wordlist picker

The slim top row's wordlist picker comes out. Workshop is always-merged.

The user-facing argument: there's no Workshop activity that's meaningfully scoped to a single source. "Anagrams only in STWL" is not a thing a constructor wants. Workshop is the *output* of the user's curation; selecting a single source mid-construction is a category error. The picker has been a vestigial control for a long time and only stuck around because per-source viewing had nowhere else to live. Once the Library can host per-source viewing, the picker goes.

Two affordances that the picker currently provides need to land elsewhere:

- **Browsing My Edits as a list.** Migrates to the Library's per-wordlist view (see *Library entries view* below).
- **Browsing an individual source's contents.** Same migration. Less critical but free once My Edits is there.

`state.selected` becomes a Library-only concept (which wordlist's panel is focused inside the Library view). Workshop has nothing to select.

## Workshop: row separators

To make Workshop's table identity legible against the Library's text-file identity, the entries table grows row separators. Reverses the earlier "no row separators, alignment carries it" call — that call was right when there was nothing for the table to differentiate itself *against*, but the Library view now exists and benefits from the contrast.

## Workshop: result-export affordance (deferred)

The Workshop entries table eventually wants a copy-to-clipboard and save-as-file affordance for exporting *query results* (anagrams, regex hits) to clipboard / `.txt` / `.csv`. Distinct from any wordlist download — query results are not wordlists. Parked for now; will revisit after the Library redesign lands. Placement (sort cluster, table-region header, separate button) deferred.

## Library: bring back All

`All` returns as a first-class card at the top of the Library's wordlist list — the same position it has in Workshop's (now-removed) wordlist dropdown today. It was pulled out when the Library was scoped to "sources only"; with that constraint relaxed, All is just the synthesized wordlist and it belongs in the list of wordlists.

All's right panel mirrors the per-source panel:

- **Stats bar + histogram** showing the merged distribution.
- **Scoring rules editor** (the user's tier labels for the unified score scale). See *Scoring rules home* below.
- **Entries view** — the merged entries, rendered the same way per-source entries are rendered (see *Library entries view*).
- **Download** — produces the merged wordlist file.

This also gives "download the merged wordlist" a clean home. Previously the only download path for All was the Sync & backup dialog, which conflated *one-time download* with *backup workflow*. The download moves to Library; Sync & backup keeps only the recurring-persistence concerns.

### Scoring rules home

Scoring rules (the tier labels for the unified score scale) conceptually belong on All — they describe the merged scale, not any single source. Today they live on My Edits' panel because the data is anchored on `myEdits.scoring` (it's the wordlist that "owns" the user's score interpretation). That's an implementation convenience that bled into UI.

The plan: keep the data on `myEdits.scoring`; surface the editor on All's panel. My Edits' panel loses its scoring rules editor (and has no rescore editor either, since scores pass through unchanged) — its rules section collapses.

The Workshop entries table's score-atom tier tooltips keep reading from the same data — no functional change to the read side.

## Library layout: list on top, panel below

The two-pane (rail-left + detail-right) layout becomes a one-column stack:

- **Wordlist list** at the top — same card shape as today's rail (icon, name, drag handle, enable toggle), just laid out as a vertical list above the detail panel rather than beside it. Drag-to-reorder is preserved exactly as it works today.
- **Detail panel** below the list, showing the focused wordlist.

This is roughly "today's left rail rotated 90 degrees." Keeps every shipped Library affordance working (cards, reorder, enable toggles, F2 rename, `+ Add wordlist…` at the bottom of the list). Drops the two-pane layout that doesn't translate to mobile.

The "Library's slim-top-row equivalent" open question dissolves — the wordlist list itself is what sits at the top, no separate slim row needed.

Mobile shape decided when mobile lands ([`mobile.md`](mobile.md)); current expectation is that the small wordlist count (~6 wordlists in typical use) makes the "list-above-detail" stack viable on phones without restructuring.

## Library entries view

A virtual-scrolled entries display in each wordlist's detail panel, positioned **below the rescore rules editor**. The primary use case is rule tuning — tweak a rescore rule, see its effect in the entries view immediately below.

### Rendering: lightly columnar monotype

The visual language is "text-file editor," distinct from Workshop's bordered/badged atom rendering:

- Monospace font.
- Whitespace-aligned columns (entry, score, comment). No grid borders or score-badge chrome.
- No count column, no row numbers.
- No hover popover, no click-to-edit. Library is read-only — edits route through Workshop's AtomPopover, same as today. (The Library is a source viewer; My Edits' editing surface stays where users already know to find it.)
- No source-attribution column. That's a Workshop concern.

### Inline rescore annotations (only-when-changed)

When a rescore rule transforms an entry's score, the annotation appears inline:

```
BAGEL      45 → 50   tasty
HOTDOG     20 → ✕
SANDWICH   35
```

- Rows where the rescore is a no-op show one number, no arrow.
- Rows where the rescore changes the score show `input → output`.
- Rows dropped by an `ignore` rule show `input → ✕` (visible, not silently removed). The dropped state is the rule's job to confirm; hiding it would defeat the rule-tuning view.

"Only when changed" keeps calm rows quiet and makes transformations pop. "Always show input → output" was considered and judged noisier.

### Input/Output toggle

Each non-exempt wordlist's panel has a segmented control in the action row: `[Rescored] [Original]`. It governs *every* rescore-affected surface on the panel as one coherent mode:

- **Stats bar + histogram** — switches between rescored distribution and original distribution.
- **Entries view** — Rescored mode shows the `→` annotations; Original mode strips them and shows the wordlist exactly as the file contains it.
- **Download** — produces the wordlist file matching the current mode (see *Single Download button* below).

Default mode: **Rescored**. That's the operative view — what the source actually contributes to All.

The toggle is coupled (not three independent controls) because the rule-tuning workflow benefits from a single "what am I looking at?" answer. Decoupled mode (stats flip but entries don't) was considered and rejected as inconsistent.

**Exemptions:**

- **My Edits** — no rescore rules; input ≡ output. Toggle is hidden.
- **All** — the merged view is already a synthesis of rescored sources; there's no coherent "Original" version. Toggle is hidden.

### Single Download button

The split `Download ▾ (rescored / original)` button collapses into a single `Download` button governed by the toggle. WYSIWYG: what you see is what you'd save. Earns the toggle's visible chrome by making it consequential — flipping the toggle is the gesture by which a user picks which version to export.

For My Edits and All (which have no toggle), Download is just Download.

## Library: search bar (no tools, no score filter)

A search bar sits in the Library, between the histogram and the entries view, with the full Workshop pattern syntax (`?`, `#`, `@`, `*`, `[…]`) and the whole-word toggle. Sort controls (Entry / Length / Score) live on the right of the bar, same shape as Workshop's.

What's *not* in the Library's search bar:

- **No tool stack, no tool gallery.** Tools are construction aids. The Library is for curation.
- **No score-range filter** (neither numeric input nor histogram click-to-filter). Library inspects; it does not query. Rule tuning is served by the inline rescore annotations + sort, not by range filtering. The histogram in the Library is **display-only** — no cursor:pointer, no hover-highlight on bars.

Workshop's score filter is unaffected — it remains a Workshop-side, localStorage-persisted standing preference. The two views' filter scopes don't interact.

## Identity contrast

The Library and Workshop both render entries, but the visual languages should diverge so the user always knows which view they're in:

| | Workshop | Library |
|---|---|---|
| Font | mixed (mono entries, sans-serif chrome) | monospace throughout |
| Row chrome | row separators, score badges, count column | whitespace-aligned columns, no separators, no badges |
| Click behavior | atom click → AtomPopover edit | read-only |
| Tools | full gallery + stack | none |
| Filter | search, score-range, sort | search, sort (no score-range) |
| Source attribution | per-row source column on All | n/a |
| Rescore annotation | red `*` + popover detail | inline `→` |

The split is intentional asymmetry — same data, different jobs, different shapes.

## Onboarding banner

Stays a banner (not a popup), repositioned to sit **above the wordlist list** inside the Library view. Dismissable. Contained to the Library — visiting Workshop never surfaces onboarding, even if it hasn't been completed.

The "above everything in Library" placement matches today's "above the rail" placement, just oriented for the new layout. Popup form was considered; rejected as heavier than warranted now that users only see the banner if they've chosen to enter the Library.

## Remaining open questions

- **Future top-level destinations.** Down-the-road features that fit neither Library nor Workshop are anticipated but deliberately not designed here. `MainView`'s `VIEWS` registry is the single place to extend.
- **Library on mobile.** Deferred to the mobile pass ([`mobile.md`](mobile.md)) — the small wordlist count makes the desktop stack viable on phone today, but a dropdown or other compaction may be wanted later.
- **Workshop result-export placement.** Deferred until the Library redesign ships, then decided.
