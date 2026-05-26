# Grawlix manual

Grawlix is a browser-based wordlist manager for crossword constructors. It rescores wordlists from different sources to a common scale, then merges them into a single unified view.

Everything stays in your browser. There's no account, no login, and no server-side storage — your wordlists, edits, and settings live entirely in your browser's local storage on this device.

This is the user-facing manual. Eventually it'll be turned into an in-app manual; for now it's a Markdown file.

## The app shell

**Header.** Title, top-level nav (**Workshop** / **Library**), settings. (A `?` placeholder sits where help will live; it's currently inert.) Sticks at top while you scroll.

**Two views.** *Workshop* (default) is the construction-aid surface — tool gallery, stack, entries table — always showing your merged wordlist. *Library* manages your wordlists (the list, rescoring rules, scoring rules, downloads, per-source inspection). Pick **Workshop** or **Library** in the header to switch.

**Centered card.** Below the header, the active view sits in a centered card with side margins. The page itself scrolls — there's only one scrollbar.

Workshop's card, top to bottom:
- **Tool gallery.** Cards laid out as a responsive grid.
- **Sticky region** that anchors just below the header as you scroll into the entries table:
  - Tool stack (only when you've added tools — the search bar sits at the bottom either way).
  - Stats bar with histogram (click or drag across the histogram to filter by score range).
  - Entry headers labelling the columns below.
- **Entries table.** The merged `All` view, always visible — idle and search views are the same view, just filtered.

## Settings

The gear in the header opens **Settings**:

- **Dark mode** — Auto (follow your OS), Light, or Dark.
- **Display case** — Show entries in `lower` or `UPPER` case throughout the app.
- **Auto-update wordlists** — Update wordlists without asking. On by default.
- **Reset all data** — Wipes all wordlists and settings and reloads the app.

## Search syntax

- `?` — any letter
- `#` — consonant
- `@` — vowel
- `*` — any substring
- `[abc]` — character class
- Whole-word toggle anchors the pattern.

Focus any search box and this cheat sheet pops up above it. The Regex tool's pattern and replacement boxes show regex-specific cheat sheets instead, each linking out to [regexone.com](https://regexone.com/) for the syntax a popover can't cover.

## Tools

Tools transform your merged wordlist. They live in the **tool gallery** at the top of the Workshop card. Click a tool's card to add it to the stack; each click appends another tool to the end of the pipeline. Remove a tool with the `✕` on its stack row, or drag a row by its handle (`≡`) to reorder the pipeline. The Search bar stays pinned as the last step.

A populated stack feeds top-to-bottom: the first tool reads from `All`, each subsequent tool reads the previous tool's output. Search is the permanent last step — type LINDSEY into Anagram, then type a substring in the search bar to live-narrow the anagram list.

The full tool catalog — every shipped and planned tool, with its icon, name, description, and example — lives in [`tools.md`](tools.md). The gallery card text matches that catalog. A few cross-tool behaviours worth knowing in the manual: tools that produce a new word (Behead, Curtail, Semordnilap, Space out) show each transformation as a stacked row (covered below in *Chain rows*); the Search and Regex tools have a `▾` caret beside their pattern box that reveals a **Replace** field, turning the filter into a transform (results are kept only when the rewritten word is itself a real entry); group tools like Letter clusters produce a different row shape (covered below in *Group rows*) and at most one group tool fits in a stack at a time.

**Chain rows.** A tool that produces a new word — Behead, Curtail, Semordnilap, Space out — shows each result as a stacked row: the original word on top, then each step below it, prefixed with an arrow (`SLING` over `→ LING`). A longer chain stacks further. Semordnilap rows use `↔` because the relationship runs both ways. Click any line to edit that word's score.

**Space out** is the one tool that needs an external dictionary: Grawlix downloads an English word-frequency table (~5 MB) on first load and caches it, so the segmenter can tell `A BARREL OF LAUGHS` from `A BARR ELO FLA UGHS`. The card carries a **Splits** slider (One / Few / Many) controlling how aggressively to surface near-tie alternate parses — One keeps only the most confident reading, Many surfaces speculative alternates. Single-word entries that don't benefit from any split pass through unchanged. The split form shows in the entries table with a blank Source and Comment — it's a *rendering* of the original entry, not a new entry — so its score is the original entry's score and it isn't editable.

**Group rows.** Letter clusters produces group rows instead of chain rows: a numbered row showing a **Count** and the cluster's surviving members. Each member renders as its own *chain* — the same stacked atoms (original word, then `→ next` for each transformation) that flat chain rows show — and the chains sit side-by-side across the row. Chain Search after Letter clusters and only the members whose word matches survive (still as one-atom chains); chain Behead and each surviving member's chain gains a `→ beheaded` atom. When the row holds more chains than fit, the overflow collapses into a **+N more** chip; click it for a popup with every chain. Click any atom — in the row or the popup — to edit that word's score. Only one grouping tool fits in a stack at a time.

**Sort.** Axes depend on whether the stack has a transforming tool. With none — a flat list, or just searches — rows sort by Entry / Length / Score. Once a transforming tool is in play, rows sort by Entry / Length / Min score / Max score — Min and Max read across every atom of the row. Adding or removing a transforming tool keeps your sort choice rather than resetting it: Entry and Length stay put, Score becomes Min score, and Min or Max score becomes Score. When the primary axis ties, tiebreakers surface the most interesting entry first: longer over shorter, higher-scoring over lower, with alphabetical as the final stable fallback. Flipping asc/desc reverses only the primary axis; tiebreakers keep their direction, so short low-scoring entries don't float to the top of a tied bucket on `score asc`. With Letter clusters in the stack, rows sort by Entry / Count / Min score / Max score (Min/Max read across every atom of every chain in the cluster).

**Sharing the stack.** The URL captures your tool stack and inputs — pasting a Grawlix link reproduces what you were looking at. See *Sharing & links*.

## Entries table

The entries table below the stats bar shows every entry in the merged `All` view, one row per entry, in your current sort order. Each row reads as `1. CARE 4 50` — count, entry, length, score badge. Click on the entry or score to edit it (see *Editing entries*).

## Stats bar

A single sticky band above the entries table, carrying every readout about the visible result set and the two controls that shape it. Left to right:

- **Counts.** `Entries N`; with a grouping tool in the stack, `Groups N` rides alongside. The Entries count reflects what made it to the end of the pipeline — chain rows for flat pipelines, surviving member chains across every visible group for grouped pipelines.
- **Stats numbers and histogram.** `Min · Max` of the score-range-filtered output, followed by the histogram. On narrow screens `Min · Max` drops out, but counts, histogram, range, and sort always hold.
- **Score range.** A `lo-hi` / `lo+` / `n` text input, or drag-select across the histogram. The histogram itself shows the full pipeline output regardless of range; bars outside the bracket fade in place so you can see what you're trimming as you drag the range narrower. The filter is remembered across visits.
- **Sort.** "Sort by [Entry ▾] [↑]". Click the arrow to toggle direction. Default is Entry ascending; every other axis defaults to descending.

The score range applies after the pipeline runs, dropping any chain whose journey touched an out-of-range atom. Grouped pipelines drop chains per group; a group stays visible as long as at least one chain survives.

## Exporting the entries table

The kebab `⋮` at the right end of the stats bar offers four ways to get the current view out:

- **Copy to clipboard** — plain text with a markdown link header. Chains render inline with their glyphs (`scar → car`); grouped pipelines render the chain members per line, comma-separated. Designed for pasting into Discord, notes, or any chat/markdown surface.
- **Download as wordlist** — `.txt` file in `ENTRY;SCORE` per line. Chain rows use the tail entry only with the chain's minimum score (the weak link caps the chain's quality); duplicates collapse to the better of the per-chain mins. Output is alphabetical regardless of your table sort. Comments are not included. Entries containing `;` are dropped with a toast notice.
- **Download as CSV** — `.csv` file for spreadsheet use. Columns mirror what's on screen (entry, length, score, comment, source on flat pipelines; group_key, count, and the grouped tool's columns on grouped pipelines). Chain rows interleave columns per atom and prefix with min/max score. Sort matches your current table sort.
- **Download as JSON** — `.json` file for scripters. Mirrors the pipeline's group → chains → entries shape uniformly. Includes the URL that reproduces the view, the parsed tool stack, your current score range, and your current sort. Drops computed fields (length, count, min/max score) since a script can derive them.

All four reflect the current view — search, score range, sort, every active tool. Files are named after the pipeline (`grawlix-behead-1-search-earning.json`); wildcards are stripped from filenames since they're invalid on Windows.

## Editing entries

Click any entry or score in a row to open an editor popover. The popover shows which wordlist sourced the score (with any rescoring or override explanation) and lets you edit the score and comment. Edits always land in My Edits, regardless of which wordlist sourced the row.

Press Enter to save and close, or Tab to chain edits between score and comment. Escape reverts. Clicking outside, scrolling, or changing the search closes the popover.

When the score you see differs from what the wordlist itself contains (because it's been rescored, or another wordlist overrides it), a small red asterisk (`*`) marks the badge. The popover spells out exactly what's going on.

For entries sourced from My Edits, the popover also has a Delete button (with undo via toast).

**Adding new entries.** Search for the word you want. If no wordlist has it, the empty-state message offers an **Add it** button — click it to open the same editor popover used everywhere else, pre-populated with the word. Type a score (and an optional comment), press Enter, and the new entry lands in My Edits.

## My Edits

A special wordlist created automatically on first boot. It's where your manual score and comment edits land; otherwise it behaves like any other wordlist — it has a rescore rules editor and gets the Rescored/Original toggle once rules apply. It's always enabled and can't be deleted, but can be reordered (position determines merge priority on ties).

My Edits ships with inert default rescore rules mirroring your tier scale on **All** — one row per tier, outputs blank, scores pass through unchanged. The rows lay your scale out inside the editor and ensure an edit at a recognized tier doesn't trip a warning. Customize the tier scale and the inert defaults follow in lockstep.

From My Edits' panel in the Library you can Import a personal wordlist (replacing the current contents), Download what you've got, or Clear it.

## Score tiers

Defaults: **great** (≥60), **good** (≥50), **fair** (≥40), **meh** (≥30), **bad** (<30). Score badges color by tier. Hover any score in the Workshop entries table to see its tier label. Customize the tier labels via **All**'s scoring rules in the Library (see *Library*).

## Library

Top-level view (one of two; the other is Workshop). Reached by picking **Library** in the header nav.

**Layout.** Responsive — wordlist list on top of the focused-wordlist panel on phones; left-rail-and-panel side-by-side at ≥ 760px. The list groups into two sections: **Merged** (the `All` card at the top) and **Sources** (every wordlist below, with My Edits first by default). New wordlists are added via the **+ Add wordlist…** entry at the bottom.

Each wordlist card carries a drag handle (reorder = merge priority), an enable checkbox, and the wordlist's name. The `All` card has neither drag handle nor toggle — it's always present and isn't reorderable.

**Right pane.** Each card's panel has the same shape: an action row, a rules editor, then a sticky region above the entries view holding the search bar (on populated wordlists) and the stats bar with histogram. The stats bar carries the same controls as on Workshop — counts, stats numbers, histogram, score range, sort — minus the Groups count (Library has no tool pipeline). The histogram is click-and-drag to filter, same as on Workshop.

**Action buttons differ per wordlist:**
- **Sources** — Update/Fetch primary action, the Rescored/Original toggle (when rules exist), Download, and a ⋮ menu with Configure / Delete.
- **My Edits** — Import (primary when empty, plain otherwise), the Rescored/Original toggle (when rules exist), Download (primary when populated, hidden when empty), Clear in the ⋮ menu.
- **All** — Download. No toggle (merged has no "original" version), no ⋮ menu.

**Rescored/Original toggle.** A segmented control on a wordlist's action row. It governs *every* rescore-affected surface on the panel together: stats bar, histogram, the entries view's annotations, and what Download produces. **Rescored** is the default — what the wordlist actually contributes to All. **Original** strips rescoring and shows the file as imported. Hidden when no rescore rules apply.

**Rescoring rules.** Sources and My Edits each carry a rescore rules editor. Rules map an input score range — and an optional entry-length filter — to an output score, or `ignore` to drop the entry. First matching rule wins.

When the wordlist's data contains scores not covered by any rule, an **Unhandled scores** banner appears at the top of the editor listing those scores (contiguous runs collapsed — e.g. `25, 45-49, 75`). An orange severity bubble also appears on the wordlist's card in the rail and on the **Library** nav item. Add rules covering those scores and the bubble clears.

Custom wordlists with up to 10 distinct scores get auto-seeded with one inert rule per score on first import, so you see the wordlist's scale laid out next to All's. Larger wordlists get the Unhandled-scores banner instead.

**Scoring rules** (on `All`) are your tier labels for the merged score scale ("60 = great, 50 = good, …"). The Workshop entries table reads these for the hover tooltip on each score atom. The same Unhandled-scores banner + warning bubble pattern applies if the merged view contains scores you haven't labeled.

**Severity bubbles** on each card signal something to look at:
- **Green** — an update is available to fetch (only when auto-update is off — see [Settings](#settings)).
- **Orange** — there are scores in the wordlist's data not covered by its rescore rules. On **All**, orange means merged scores not covered by any tier label.

The highest-severity bubble across all wordlists propagates up to the **Library** nav item.

**Reset to defaults.** A button appears in the rules editor (rescore on sources/My Edits, scoring on All) when you've customized the rules away from their shipped defaults. Clicking it restores the defaults, with a confirmation first. Visible only inside the editor and only when there's something to undo.

**Entries view.** Each populated wordlist's panel includes a virtual-scrolled, monospace, text-file-flavored entries list below its rules editor. In Rescored mode, an inline arrow shows what each rule changed — e.g. `BAGEL  45 → 50  tasty`; rows dropped by an `ignore` rule are struck through with their input score. Untouched rows show their input score plain. Switching to Original mode strips the arrows and strikethrough — you see the wordlist as the file contains it. The Library entries view is read-only; editing routes through the Workshop entries table's popover.

**Search bar** (above the stats bar). Full pattern syntax and whole-word toggle. No Replace caret — the Library bar filters a wordlist for inspection, it doesn't transform or query it. Score range and sort live in the stats bar below, the same as on Workshop.

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
