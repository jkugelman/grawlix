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
- **Auto-update wordlists** — Update wordlists without asking. On by default.
- **Output format** — How entries are written to downloads and to synced files, so they match what your construction software can read: checkboxes to keep or strip **spaces**, **punctuation**, **accents**, and **comments**. Defaults to fully rich (everything kept). The two-way My Edits file is always written as-is regardless — it's the file your construction software edits in place. This is the one place the format is set — downloads and synced files both follow it.
- **Reset all data** — Wipes all wordlists and settings and reloads the app.

## Disk sync

Grawlix keeps your data in your browser. **Disk sync** additionally connects an individual list to an individual file on your hard drive — a file you already have, in the place your construction software already reads — and keeps the two in sync. There's no Grawlix folder to set up and no settings to re-point.

You sync each list from the **Library**, list by list. Two kinds of sync, depending on the list:

- **My Edits is two-way.** The file is the one your construction software (Ingrid, Crossfire, Crossword Compiler) reads *and* writes. Edit in Grawlix and the file updates; edit the file and Grawlix picks the change up within a couple of seconds. Grawlix's copy in the browser stays the source of truth, so it keeps working even when the file isn't reachable.
- **Every other list is one-way out.** **All** and each source write their rescored output to their file whenever the list or its rescore rules change. These are generated outputs — if you hand-edit one of these files, your changes are overwritten the next time Grawlix rewrites it. Point your construction software at **All** for the unified wordlist.

**The sync pill.** Every list's panel shows a small status pill on the left of its action row — a logo for the browser your data lives in, then its sync state: **Saved in browser** when it's browser-only, **→ _filename_ · Synced to disk** for a one-way output (All and sources), or **⇄ _filename_ · Synced to disk** for the two-way My Edits. Clicking the pill opens a dialog that explains what sync is and lets you set it up or turn it off — no surprise file pickers.

**Setting up sync.** Click the pill and choose:

- For **My Edits**, two doors: **Use a file I already have** (point at the file your software opens — Grawlix loads it and keeps both in sync, the common case) or **Create a new file**.
- For **All** or a **source**, a single **Choose file…** — pick or name the file Grawlix writes the rescored output to.

**While synced.** The pill names the synced file. Clicking it again shows **Stop syncing**; stopping leaves the file on disk untouched — it just disconnects. To point a list at a different file, stop syncing and set it up again. **Download** is always there too, in every state.

**When edits collide (My Edits only).** If the same entry was changed both in Grawlix and in the file since they last agreed, Grawlix asks which to keep — **Keep this device** or **Keep the file** — and applies your choice. Changes that touched different entries merge silently; this prompt appears only on a true conflict, so it's rare. Deleting an entry on either side stays deleted — it isn't resurrected by the merge.

**Reconnecting.** Browsers don't always remember file permission across sessions. On boot, files whose permission is remembered resume silently — straight to the app. For any file the browser has forgotten, the loading splash shows an **Open _filename_** button (one click per file to re-grant) and a muted **Skip for now**. Skip is always safe: the full app runs from your browser data, and the un-granted files just stay paused until the next launch reconnects them. If a file goes missing mid-session (moved or deleted), its pill turns attention-colored and reads **⤫ _filename_ · File missing** — stop syncing and set it up again to recover.

**Cross-device.** Put a synced file in Dropbox, iCloud Drive, OneDrive, or Google Drive, and on your other device sync the same list to that same file. Your cloud client moves the bytes; Grawlix has no cloud code of its own. (For My Edits this merges both devices' edits; for a one-way list the latest writer wins.)

**Browser support.** Disk sync uses the File System Access API — Chrome, Edge, and other Chromium-based desktop browsers. In Firefox, Safari, and on phones and tablets, the pill stays on **Saved in browser** and its dialog explains that sync needs a Chromium browser; **Download** is the way to get a file out there. Chrome's "Always allow" on a file grant means most users reconnect once and then never again.

## Keyboard shortcuts

- **Alt-T** — open the tool picker (also **Cmd-K** / **Ctrl-K**).
- **Alt-S** — focus the search input (Workshop's permanent search bar, or the focused wordlist's search bar in Library).
- **Alt-W** — toggle the whole-word checkbox. If a Search or Regex tool row has focus, toggles that row's; otherwise toggles the active view's permanent search bar.
- **Alt-C** — focus the score-range input.
- **Alt-M** — cycle dark mode (Auto / Light / Dark).
- **F2** — rename a focused wordlist card (Library).

## Search syntax

- `?` — any character
- `#` — consonant
- `@` — vowel
- `*` — any substring
- `[abc]` — character class
- Whole-word toggle anchors the pattern.

Every pattern is matched two ways, and an entry counts as a hit if *either* matches: against the entry **as written** — so a space, hyphen, or accent you type has to be there (`co-op` matches `co-op` but not `coop`; `the IRS` matches `the IRS`; `résumé` matches only `résumé`) — and against its **letters alone**, lowercased with accents, spaces, and punctuation stripped (so `theirs` matches `the IRS`, and a bare `resume` matches both `resume` and `résumé`). The letters-only pass means you rarely need to type separators; the as-written pass means typing them narrows the match to exactly that form. A `?` fills exactly one character of any kind — a letter, or a symbol or space in the as-written form — never nothing.

Focus any search box and this cheat sheet pops up above it. The Regex tool's pattern and replacement boxes show regex-specific cheat sheets instead, each linking out to [regexone.com](https://regexone.com/) for the syntax a popover can't cover; regex patterns are tested against the same two forms, so `\s` or `\b` can key on the spacing in a phrase (`Helen of Troy`) that the letters-only form drops.

## Tools

Tools transform your merged wordlist. They live in the **tool gallery** at the top of the Workshop card. Click a tool's card to add it to the stack; each click appends another tool to the end of the pipeline. Remove a tool with the `✕` on its stack row, or drag a row by its handle (`≡`) to reorder the pipeline. The Search bar stays pinned as the last step.

A populated stack feeds top-to-bottom: the first tool reads from `All`, each subsequent tool reads the previous tool's output. Search is the permanent last step — type LINDSEY into Anagram, then type a substring in the search bar to live-narrow the anagram list.

The full tool catalog — every shipped and planned tool, with its icon, name, description, and example — lives in [`tools.md`](tools.md). The gallery card text matches that catalog. A few cross-tool behaviours worth knowing in the manual: tools that produce a new word (Behead, Curtail, Semordnilap, Space out) show each transformation as a stacked row (covered below in *Chain rows*); the Search and Regex tools have a `▾` caret beside their pattern box that reveals a **Replace** field, turning the filter into a transform (results are kept only when the rewritten word is itself a real entry); some tools support an **all-mode** (covered below in *All-mode and group rows*) that buckets every value into clusters instead of filtering to one. Gallery cards for these carry a `✱` button in their top-right corner — click the card to add the tool flat, click `✱` to add it straight into all-mode. Only one tool in a stack can be in all-mode at a time.

**Chain rows.** A tool that produces a new word — Behead, Curtail, Semordnilap, Space out — shows each result as a stacked row: the original word on top, then each step below it, prefixed with an arrow (`SLING` over `→ LING`). A longer chain stacks further. Semordnilap rows use `↔` because the relationship runs both ways. Click any line to edit that word's score.

**Space out** is the one tool that needs an external dictionary: Grawlix downloads an English word-frequency table (~5 MB) on first load and caches it, so the segmenter can tell `A BARREL OF LAUGHS` from `A BARR ELO FLA UGHS`. The card carries a **Splits** slider (One / Few / Many) controlling how aggressively to surface near-tie alternate parses — One keeps only the most confident reading, Many surfaces speculative alternates. Single-word entries that don't benefit from any split pass through unchanged. The split form shows in the entries table with a blank Source and Comment — it's a *rendering* of the original entry, not a new entry — so its score is the original entry's score and it isn't editable.

**All-mode and group rows.** Tools whose card shows a small `✱` corner mark — Letter bank, Anagrams, Consonantcy, Vowelcy, Initialisms — support an **all-mode**: click the `✱` button on the right side of the tool's input in the stack to flip from "filter by this value" to "show all values." The input takes a disabled-style background, its placeholder reads `all` in accent color, and the `✱` lights up accent; click `✱` again to go back. Any value you'd typed is restored when you exit all-mode. All-mode produces **group rows** instead of chain rows: a numbered row showing a **Count** and the cluster's surviving members. Each member renders as its own *chain* — the same stacked atoms (original word, then `→ next` for each transformation) that flat chain rows show — and the chains sit side-by-side across the row. Chain Search after a Letter bank in all-mode and only the members whose word matches survive (still as one-atom chains); chain Behead and each surviving member's chain gains a `→ beheaded` atom. When the row holds more chains than fit, the overflow collapses into a **+N more** chip; click it for a popup with every chain. Click any atom — in the row or the popup — to edit that word's score. Only one tool in a stack can be in all-mode at a time; the `✱` button is greyed on the others.

**Sort.** Axes depend on whether the stack has a transforming tool. With none — a flat list, or just searches — rows sort by Entry / Length / Score. Once a transforming tool is in play, rows sort by Entry / Length / Min score / Max score — Min and Max read across every atom of the row. Adding or removing a transforming tool keeps your sort choice rather than resetting it: Entry and Length stay put, Score becomes Min score, and Min or Max score becomes Score. When the primary axis ties, tiebreakers surface the most interesting entry first: longer over shorter, higher-scoring over lower, with alphabetical as the final stable fallback. Flipping asc/desc reverses only the primary axis; tiebreakers keep their direction, so short low-scoring entries don't float to the top of a tied bucket on `score asc`. With a tool in all-mode, rows sort by Entry / Count / Min score / Max score (Min/Max read across every atom of every chain in the cluster).

**Click a column header to sort by it.** Entry, Len, and Score headers — or Count and the cluster columns in all-mode — are clickable; the column you're sorted by shows a ↑/↓ arrow, and clicking it again flips direction. Clicking a different column sorts by it ascending. The Sort-by dropdown stays the complete control — it's how you reach axes a header doesn't map to, like Max score (the Score header always starts at Min score once a transform is in play), or Min/Max score in all-mode, where group rows have no score column to click.

**Sharing the stack.** The URL captures your tool stack and inputs — pasting a Grawlix link reproduces what you were looking at. See *Sharing & links*.

## Entries table

The entries table below the stats bar shows every entry in the merged `All` view, one row per entry, in your current sort order. Each row reads as `1. CARE 4 50` — count, entry, length, score badge. Click on the entry or score to edit it (see *Editing entries*).

## Stats bar

A single sticky band above the entries table, carrying every readout about the visible result set and the two controls that shape it. Left to right:

- **Counts.** `Entries N`; with a tool in all-mode, `Groups N` rides alongside. The Entries count reflects what made it to the end of the pipeline — chain rows for flat pipelines, surviving member chains across every visible group for all-mode pipelines.
- **Stats numbers and histogram.** `Min · Max` of the score-range-filtered output, followed by the histogram. On narrow screens `Min · Max` drops out, but counts, histogram, range, and sort always hold.
- **Score range.** A `lo-hi` / `lo+` / `n` text input, or drag-select across the histogram. The histogram itself shows the full pipeline output regardless of range; bars outside the bracket fade in place so you can see what you're trimming as you drag the range narrower. The filter is remembered across visits.
- **Sort.** "Sort by [Entry ▾] [↑]". Click the arrow to toggle direction, or click a column header in the table below to sort by that column (see *Tools → Sort*).

The score range applies after the pipeline runs, dropping any chain whose journey touched an out-of-range atom. All-mode pipelines drop chains per group; a group stays visible as long as at least one chain survives.

## Exporting the entries table

The kebab `⋮` at the right end of the stats bar offers four ways to get the current view out:

- **Copy to clipboard** — plain text with a markdown link header. Chains render inline with their glyphs (`scar → car`); all-mode pipelines render the chain members per line, comma-separated. Designed for pasting into Discord, notes, or any chat/markdown surface.
- **Download as wordlist** — `.txt` file in `ENTRY;SCORE` per line. Chain rows use the tail entry only with the chain's minimum score (the weak link caps the chain's quality); duplicates collapse to the better of the per-chain mins. Output is alphabetical regardless of your table sort. Comments are not included. Entries containing `;` are dropped with a toast notice.
- **Download as CSV** — `.csv` file for spreadsheet use. Columns mirror what's on screen (entry, length, score, comment, source on flat pipelines; group_key, count, and the catalog group columns on all-mode pipelines). Chain rows interleave columns per atom and prefix with min/max score. Sort matches your current table sort.
- **Download as JSON** — `.json` file for scripters. Mirrors the pipeline's group → chains → entries shape uniformly. Includes the URL that reproduces the view, the parsed tool stack, your current score range, and your current sort. Drops computed fields (length, count, min/max score) since a script can derive them.

All four reflect the current view — search, score range, sort, every active tool. Files are named after the pipeline (`grawlix-behead-1-search-earning.json`); wildcards are stripped from filenames since they're invalid on Windows.

## Editing entries

Click any entry or score in a row to open an editor popover. The popover shows which wordlist sourced the score (with any rescoring or override explanation) and lets you edit the score and comment. Edits always land in My Edits, regardless of which wordlist sourced the row.

Press Enter to save and close, or Tab to chain edits between score and comment. Escape reverts. Clicking outside, scrolling, or changing the search closes the popover.

When the score you see differs from what the wordlist itself contains (because it's been rescored, or another wordlist overrides it), a small red asterisk (`*`) marks the badge. The popover spells out exactly what's going on.

For entries sourced from My Edits, the popover also has a Delete button (with undo via toast).

**Adding new entries.** A floating **＋** button in the bottom-right corner of the Workshop opens the entry editor in the center of the screen. If you've just searched for a plain word that no wordlist has, it starts with that word filled in (a wildcard search, or one that already matches something, opens blank). Type a score and an optional comment, press Enter, and the entry lands in My Edits. Searching for a missing word also surfaces an **Add it** button under the empty-results quip — the same editor, pre-populated. Either way the new entry lands in My Edits.

## My Edits

A special wordlist created automatically on first boot. It's where your manual score and comment edits land; otherwise it behaves like any other wordlist. It's always enabled and can't be deleted, but can be reordered (position determines merge priority on ties).

Like any Source, My Edits carries a rescore-rules editor. The scores you type are stored **raw** and run through those rules on the way into the merged view. It starts with a **tier legend** — Grawlix's default tiers (great/good/fair/…) listed as blank-output rows that document the scale right next to where you type scores, remapping nothing, so the score you type is the score you see. Fill in an output only if you want a typed score remapped; whether your scores line up with the tiers is your call, not something Grawlix enforces. Delete the legend if you don't want it (Reset to defaults brings it back). Importing a personal list scored on a different scale clears the legend automatically and lays out that file's scores instead, so it never mislabels them.

From My Edits' panel in the Library you can Import a personal wordlist, Download what you've got, or Clear it. Its **Download** follows your Output format like any source; **Download original** (the split button's second door, once it has rules) and its synced file stay as-is — spaces, accents, punctuation, and case preserved — since the synced file is the one your construction software edits in place. Its entries also reach letters-only software through **All**, which honors your Output format. You can also sync My Edits to a file ([Disk sync](#disk-sync)).

## Score tiers

Defaults: **great** (≥60), **good** (≥50), **fair** (≥40), **meh** (≥30), **bad** (<30). Score badges color by tier. Hover any score in the Workshop entries table to see its tier label. Customize the tier labels via **All**'s scoring rules in the Library (see *Library*).

## Library

Top-level view (one of two; the other is Workshop). Reached by picking **Library** in the header nav.

**Layout.** Responsive — wordlist list on top of the focused-wordlist panel on phones; left-rail-and-panel side-by-side at ≥ 760px. The list groups into two sections: **Merged** (the `All` card at the top) and **Sources** (every wordlist below, with My Edits first by default). New wordlists are added via the **+ Add wordlist…** entry at the bottom.

Each wordlist card carries a drag handle (reorder = merge priority), an enable checkbox, and the wordlist's name. The `All` card has neither drag handle nor toggle — it's always present and isn't reorderable.

**Right pane.** Each card's panel has the same shape: an action row, a rules editor, then a sticky region above the entries view holding the search bar (on populated wordlists) and the stats bar with histogram. The stats bar carries the same controls as on Workshop — counts, stats numbers, histogram, score range, sort — minus the Groups count (Library has no tool pipeline). The histogram is click-and-drag to filter, same as on Workshop.

**Action buttons differ per wordlist:**
- **Sources** — Update/Fetch primary action, Download, and a ⋮ menu with Configure / Delete.
- **My Edits** — Import (primary when empty, plain otherwise), Download (primary when populated, hidden when empty; splits to add **Download original** once it has rescore rules), and Clear in the ⋮ menu.
- **All** — Download, no ⋮ menu.

Every panel also carries the **sync pill** on the left of the action row (see § Disk sync).

**Rescored view.** A wordlist's panel — its stats, histogram, and entries list — always shows the *rescored* result, the version it contributes to All. As you tune a rescore rule the rows below update live (`input → output` annotations on rows the rule changed; a struck-through row for an ignored entry). To get the *original* imported file instead, use **Download original** on the source's Download button (below).

**Rescoring rules.** Each Source — and My Edits — carries a rescore rules editor. Rules map an input score range — and an optional entry-length filter — to an output score, or `ignore` to drop the entry. First matching rule wins. My Edits' typed scores are stored raw and run through its rules just like any source; it ships with the tier legend (blank-output rows), so they pass through unchanged until you fill in an output.

Rescoring is entirely optional. If a wordlist's scores don't line up with Grawlix's scale and you don't care, leave the rules empty — the raw scores pass through and nothing warns you about it. You can ignore the score column entirely and still search, filter, and run every tool.

Custom wordlists with up to 10 distinct scores get auto-seeded with one inert rule per score on first import, so you see the wordlist's scale laid out next to All's. You can fill in output mappings, or leave them blank to pass the scores through.

**Scoring rules** are your tier labels for the merged score scale ("60 = great, 50 = good, …"). The editor lives on **All**'s panel, since the tiers describe the merged scale. The Workshop entries table reads these for the hover tooltip on each score atom. Labeling is optional too — unlabeled scores still appear, just without a tier name in the tooltip.

**Update bubble.** A green dot appears on a wordlist's card, and on the **Library** nav item, when an update is available to fetch (only when auto-update is off — see [Settings](#settings)).

**Reset to defaults.** A button appears in the rules editor (rescore on a publisher Source or My Edits, scoring on All) when you've customized the rules away from their shipped defaults. Clicking it restores the defaults, with a confirmation first. Visible only inside the editor and only when there's something to undo.

**Entries view.** Each populated wordlist's panel includes a virtual-scrolled, monospace, text-file-flavored entries list below its rules editor, always showing the rescored result. An inline arrow shows what each rule changed — e.g. `BAGEL  45 → 50  tasty`; rows dropped by an `ignore` rule are struck through with their input score, and untouched rows show their input score plain. The Library entries view is read-only; editing routes through the Workshop entries table's popover.

**Search bar** (above the stats bar). Full pattern syntax and whole-word toggle. No Replace caret — the Library bar filters a wordlist for inspection, it doesn't transform or query it. Score range and sort live in the stats bar below, the same as on Workshop.

**Renaming.** Focus a wordlist card and press **F2** to rename inline.

**Downloads.** Each wordlist (and All) has its own Download button, and every download saves immediately — no dialog. The file uses your global **Output format** (set in [Settings](#settings)). For a **source with rescore rules** the button is a split: **Download** saves the rescored output (the rule result, `<name> rescored.txt`) and the menu's **Download original** saves your imported file back verbatim with its original formatting (`<name>.txt`). **All** saves its merged output as `All rescored.txt`. **My Edits** follows the same rule as any source — **Download** saves its rescored output at your format (`My Edits rescored.txt`), and once it has rules the split's **Download original** saves the editable file verbatim (`My Edits.txt`). When the format strips characters, entries that collapse to the same text are merged: the highest score wins and their distinct comments combine with ` / `.

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

**Casing and special characters.** Grawlix shows each entry as written — spaces, accents, punctuation, and mixed case all preserved (`the IRS`, `co-op`, `Mötley Crüe`, `Helen of Troy`). Case is the exception: wordlists come in all-uppercase or all-lowercase with no standard between them and no meaning to the choice, so a wordlist's plain entries always render in lowercase however the file was written. A deliberate all-caps entry in an otherwise-lowercase list — an `FBI` among lowercase words — is kept as written. So you can freely mix: add `Helen of Troy` to a wordlist that previously held only `helenoftroy`, and it keeps its spaces and capitals. The few features that read the written form — the Initialisms tool's word boundaries, the search syntax's literal-space/hyphen rules above — light up automatically when the data carries the detail.

Within Grawlix, mate / maté / Mate / and MATE are distinct entries when a wordlist spells them that way, but collapse to one row when the data only contains the bare letter form. Each variant keeps its own score and comment.

## Initialisms

Available in the tool gallery. Type an initialism; results are entries whose word-initial letters spell it. Spaces split words unconditionally; hyphens act as optional boundaries so `co-op` reads as both one word (`C` matches) and two (`CO` matches); apostrophes and other inline punctuation stay inside the word (`DT` does not match `don't`). Single-letter patterns match every entry whose first word starts with that letter — surface-level but not wrong; narrow with another tool if it's noisy.

**All-mode.** Click the `✱` on the right side of the Initialisms input to cluster every multi-word entry under its word-initial letters — so `the IRS`, `the irate Senator`, and `Tom Is Right` all land in `tis`. Only clusters whose initialism is itself an entry in the wordlist survive (e.g. `tis` shows up only if `TIS` is a row) — the point is bidirectional pairs, not every prefix coincidence. Each cluster row shows the initialism entry as a clickable badged atom (same shape as the chain atoms next to it), so you can adjust its score or comment without leaving the clustered view. The score range applies to the initialism too: drag the range narrower and clusters whose initialism entry falls outside the band drop alongside chains whose atoms do. Sort the clustered view by Initialism (alphabetical), Initialism length, Initialism score, or any of the standard cluster axes (Count, Min/Max score). Single-word entries are skipped (a one-letter "initialism" cluster of every entry starting with a given letter is just a prefix search). Word boundaries are spaces only in this mode — the hyphen-optional branching the filter uses would split each entry across multiple clusters.
