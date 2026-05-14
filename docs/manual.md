# Grawlix manual

Grawlix is a browser-based wordlist manager for crossword constructors. It rescores wordlists from different sources to a common scale, then merges them into a single unified view.

This is the user-facing manual. Eventually it'll be turned into an in-app manual; for now it's a Markdown file.

## The app shell

**Header.** Title, top-level nav (**Workshop** / **Library**), settings. (A `?` placeholder sits where help will live; it's currently inert.) Sticks at top while you scroll.

**Two views.** *Workshop* (default) is the construction-aid surface — tool gallery, stack, entries table — always showing your merged wordlist. *Library* manages your wordlists (the list, rescoring rules, scoring rules, downloads, per-source inspection). Click either nav item in the header to switch.

**Centered card.** Below the header, the active view sits in a centered card with side margins. The page itself scrolls — there's only one scrollbar.

Workshop's card, top to bottom:
- **Tool gallery.** Cards laid out as a responsive grid.
- **Sticky region** that anchors just below the header as you scroll into the entries table:
  - Stats bar with histogram (click the histogram to filter by score range).
  - Tool stack — only when you've added tools.
  - Search bar.
- **Entries table.** The merged `All` view, always visible — idle and search views are the same view, just filtered.

## Search syntax

- `?` — any letter
- `#` — consonant
- `@` — vowel
- `*` — any substring
- `[abc]` — character class
- Whole-word toggle anchors the pattern.

## Tools

Tools transform your merged wordlist. They live in the **tool gallery** at the top of the Workshop card. Click a card body to replace the stack with that tool; click the `+` badge on the right edge of a card to append it to the existing stack.

A populated stack feeds left-to-right: the first tool reads from `All`, each subsequent tool reads the previous tool's output, and the entries table below shows the bottom row's results. The search bar at the bottom filters whatever the last tool produced — type LINDSEY into Anagram, then type a substring in the search bar to live-narrow the anagram list.

**Anagram** takes a word and returns every entry in your wordlist with the same letters. **Semordnilap** scans the wordlist for pairs of words that are reverses of each other (STRESSED ↔ DESSERTS, LIVED ↔ DEVIL). **Behead** and **Curtail** find pairs where one word is the other minus its first or last letter (SLING → LING, PARTY → PART) — the dropped letter renders with a strike-through so you can see which character moved. The rest of the gallery is wired up but doesn't transform anything yet — their cards exist so the full catalog stays visible while the tools land.

**Pair output.** Tools like Semordnilap, Behead, and Curtail produce two entries per row instead of one. Each row reads `count · len entry score · relation · len entry score` — two atoms flanking a relation glyph (a dot for symmetric pairs, an arrow for transforms). Click either side to edit that side's score. Search matches either side and highlights matches inside each atom. The score-range filter applies to the lower of the two scores — a pair drops out when its worse-scoring atom falls outside the range. The stats bar reports `Pairs` count and aggregates min/max/mean over every word on either side of every visible pair.

**Sort.** Axes depend on the current output kind. Words mode: Entry / Length / Score. Pair mode: Min score / Max score / Length / Alphabetical. When the primary axis ties — say, three pairs all with min-score 50 — tiebreakers surface the most interesting entry first: longer over shorter, higher-scoring over lower, with alphabetical as the final stable fallback. Flipping asc/desc reverses only the primary axis; tiebreakers keep their direction. That keeps short low-scoring entries from floating to the top of a tied bucket on `score asc`.

Defaults are per-kind. Words lands on Entry asc. Pair tools land on Min score desc (the worst-scoring side caps pair quality; best-worst-case pairs first matches "what's worth fishing out"). Picking an explicit axis survives kind flips as long as the axis is still valid; picking `score` on words and then adding a pair tool snaps to `min-score` because `score` isn't a pair-mode axis.

**Sharing the stack.** The URL captures your tool stack and inputs — pasting a Grawlix link reproduces what you were looking at. See *Sharing & links*.

## Entries table

The entries table below the search bar shows every entry in the merged `All` view, one row per entry, in your current sort order. Each row reads as `1. CARE 4 50` — count, entry, length, score badge. Click on the entry or score to edit it (see *Editing entries*).

**Sort.** "Sort by [Entry ▾] [↑]" at the right edge of the search bar. Axes: Entry (alphabetical by word), Length, Score. Click the arrow to toggle direction. Default is Entry ascending.

**Score histogram.** The stats bar shows a histogram of the merged wordlist's scores. Click on a bar (or drag across several) to filter the table to a score range. The filter is remembered across visits.

## Editing entries

Click any entry or score in a row to open an editor popover. The popover shows which wordlist sourced the score (with any rescoring or override explanation) and lets you edit the score and comment. Edits always land in My Edits, regardless of which wordlist sourced the row.

Press Enter to save and close, or Tab to chain edits between score and comment. Escape reverts. Clicking outside, scrolling, or changing the search closes the popover.

When the score you see differs from what the wordlist itself contains (because it's been rescored, or another wordlist overrides it), a small red asterisk (`*`) marks the badge. The popover spells out exactly what's going on.

For entries sourced from My Edits, the popover also has a Delete button (with undo via toast).

The `+ Add entry` footer at the bottom of the table lets you create new entries that don't yet exist in any wordlist — they land in My Edits.

## My Edits

A special wordlist created automatically on first boot. It's where your manual score and comment edits land; otherwise it behaves like any other wordlist — it has a rescore rules editor and gets the Rescored/Original toggle once rules apply. It's always enabled and can't be deleted, but can be reordered (position determines merge priority on ties).

My Edits ships with inert default rescore rules mirroring your tier scale on **All** — one row per tier, outputs blank, scores pass through unchanged. The rows lay your scale out inside the editor and ensure an edit at a recognized tier doesn't trip a warning. Customize the tier scale and the inert defaults follow in lockstep.

From My Edits' panel in the Library you can Import a personal wordlist (replacing the current contents), Download what you've got, or Clear it.

## Score tiers

Defaults: **great** (≥60), **good** (≥50), **fair** (≥40), **meh** (≥30), **bad** (<30). Score badges color by tier. Hover any score in the Workshop entries table to see its tier label. Customize the tier labels via **All**'s scoring rules in the Library (see *Library*).

## Library

Top-level view (one of two; the other is Workshop). Reached via the **Library** button in the brand-bar nav.

**Layout.** Responsive — wordlist list on top of the focused-wordlist panel on phones; left-rail-and-panel side-by-side at ≥ 760px. The list groups into two sections: **Merged** (the `All` card at the top) and **Sources** (every wordlist below, with My Edits first by default). New wordlists are added via the **+ Add wordlist…** entry at the bottom.

Each wordlist card carries a drag handle (reorder = merge priority), an enable checkbox, and the wordlist's name. The `All` card has neither drag handle nor toggle — it's always present and isn't reorderable.

**Right pane.** Each card's panel has the same shape: an action row, a stats bar with histogram, a rules editor, a search bar (on populated wordlists), and an entries view below it. The histogram is display-only in the Library — no click-to-filter.

**Action buttons differ per wordlist:**
- **Sources** — Update/Fetch primary action, the Rescored/Original toggle (when rules exist), Download, and a ⋮ menu with Configure / Delete.
- **My Edits** — Import (primary when empty, plain otherwise), the Rescored/Original toggle (when rules exist), Download (primary when populated, hidden when empty), Clear in the ⋮ menu.
- **All** — Download. No toggle (merged has no "original" version), no ⋮ menu.

**Rescored/Original toggle.** A segmented control on a wordlist's action row. It governs *every* rescore-affected surface on the panel together: stats bar, histogram, the entries view's annotations, and what Download produces. **Rescored** is the default — what the wordlist actually contributes to All. **Original** strips rescoring and shows the file as imported. Hidden when no rescore rules apply.

**Rescoring rules.** Sources and My Edits each carry a rescore rules editor. Rules map an input score range — and an optional entry-length filter — to an output score, or `ignore` to drop the entry. First matching rule wins.

When the wordlist's data contains scores not covered by any rule, an **Unhandled scores** banner appears at the top of the editor listing those scores (contiguous runs collapsed — e.g. `25, 45-49, 75`). An orange severity bubble also appears on the wordlist's card in the rail and on the **Library** tab in the brand bar. Add rules covering those scores and the bubble clears.

Custom wordlists with up to 10 distinct scores get auto-seeded with one inert rule per score on first import, so you see the wordlist's scale laid out next to All's. Larger wordlists get the Unhandled-scores banner instead.

**Scoring rules** (on `All`) are your tier labels for the merged score scale ("60 = great, 50 = good, …"). The Workshop entries table reads these for the hover tooltip on each score atom. The same Unhandled-scores banner + warning bubble pattern applies if the merged view contains scores you haven't labeled.

**Severity bubbles** on each card signal something to look at:
- **Green** — an update is available to fetch.
- **Orange** — there are scores in the wordlist's data not covered by its rescore rules. On **All**, orange means merged scores not covered by any tier label.

The highest-severity bubble across all wordlists propagates up to the **Library** tab in the brand bar.

**Reset to defaults.** A button appears in the rules editor (rescore on sources/My Edits, scoring on All) when you've customized the rules away from their shipped defaults. Clicking it restores the defaults, with a confirmation first. Visible only inside the editor and only when there's something to undo.

**Entries view.** Each populated wordlist's panel includes a virtual-scrolled, monospace, text-file-flavored entries list below its rules editor. In Rescored mode, an inline arrow shows what each rule changed — e.g. `BAGEL  45 → 50  tasty`; rows dropped by an `ignore` rule are struck through with their input score. Untouched rows show their input score plain. Switching to Original mode strips the arrows and strikethrough — you see the wordlist as the file contains it. The Library entries view is read-only; editing routes through the Workshop entries table's popover.

**Search bar** (above the entries view). Full pattern syntax, whole-word toggle, and sort controls (Entry / Length / Score). No score-range filter — the Library is for inspecting a wordlist, not querying it.

**Renaming.** Focus a wordlist card and press **F2** to rename inline.

**Downloads.** Each wordlist (and All) has its own Download button. On sources, the Rescored/Original toggle decides whether you get the file as imported or as rescored.

**Onboarding banner.** First-run users see a short 3-page sequence at the top of the wordlist list: a welcome confirming the pre-loaded popular wordlists, then optional prompts to import a personal wordlist into My Edits and to import an XWI subscriber file. Each prompt has a *Skip*; the ✕ ends the whole flow. (You won't see it until you visit Library.)

## Help

The header `?` button is a placeholder — it's inert today. A help surface is planned.

## Sharing & links

Your tool stack — every tool you've added and its inputs, in pipeline order — plus the search pattern, whole-word toggle, and sort all ride along in the URL. Refreshing the page keeps your state, and pasting the URL into a chat or saving it as a bookmark reproduces what you were looking at.

The link carries your tools and search settings, not your wordlists or your score filter. Wordlists you've loaded stay local. The score filter is omitted on purpose: a `60` on your scale isn't a `60` on theirs, so the number wouldn't translate. Your filter is remembered across your visits instead.

## Wordlist file format

One entry per line:

```
ENTRY;SCORE
ENTRY;SCORE;COMMENT
```
