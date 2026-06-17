# Grawlix manual

Grawlix is a browser-based wordlist manager for crossword constructors. It rescores wordlists from different sources to a common scale, then merges them into a single unified view.

Everything stays in your browser. There's no account, no login, and no server-side storage — your wordlists, edits, and settings live entirely in your browser's local storage on this device.

This is the user-facing manual. Eventually it'll be turned into an in-app manual; for now it's a Markdown file.

## The app shell

**Header.** Wordmark, the personal "Made with…" byline, settings, and a `?` menu (a short welcome popup and an Acknowledgements page). Sticks at the top while you scroll.

**One screen.** Everything lives on a single screen. The page itself scrolls — there's only one scrollbar.

The screen, top to bottom:
- **Tool gallery.** Cards laid out as a responsive grid.
- **Wordlist bar.** Holds the wordlist selector and the actions for whatever wordlist you're looking at (see *The wordlist bar* below).
- **Sticky region** that anchors just below the header as you scroll into the entries table:
  - Tool stack (only when you've added tools — the search bar sits at the bottom either way).
  - Stats bar with histogram (click or drag across the histogram to filter by score range).
  - Entry headers labelling the columns below.
- **Entries table.** The entries for your current scope, always visible — idle and search views are the same view, just filtered.

## The wordlist selector and scope

A **selector** at the left of the wordlist bar names what you're looking at. It lists **All Wordlists** at the top, then every wordlist below — pick one to *scope* the whole screen to it. Scope is the corpus: the entries table, the tools, and every readout reflect the selected wordlist.

- **All Wordlists** (the default and most common case) is the merged view — every enabled wordlist deduped into one unified list, the same merge you download and feed to your construction software.
- Pick **XWI** (or any other wordlist) and the table shows that wordlist's own rescored entries in the same rich, editable style, and tools run against it alone.

The selector is a pure picker — icons and labels, no checkboxes. A disabled wordlist (one excluded from the All Wordlists merge) shows grayed out but is still selectable: you can land on it, view it, edit it, and run tools on it. Each row also shows how much that wordlist contributes — an **X of Y entries used** count (how many of its entries survive dedup and priority in the merge). A green dot on a row flags an available update for that wordlist; an aggregate dot rides on the collapsed selector title when any wordlist has one.

Scope is **sticky** — Grawlix reopens to the wordlist you were last looking at (All Wordlists on first run). It stays on your device and never travels in a shared link.

**Managing wordlists.** A **Manage wordlists** footer at the bottom of the selector dropdown opens the manage panel — where you reorder wordlists (order is merge priority), enable or disable them, and add new ones. Reordering and toggling stage up as you go and apply all at once when you click **Apply** (or discard on **Cancel**); the merge rebuilds once, on Apply, rather than on every change. **Add wordlist** runs the usual import/fetch flow and returns you to the panel with the new list in place.

## Settings

The gear in the header opens **Settings**:

- **Dark mode** — Auto (follow your OS), Light, or Dark.
- **Auto-update wordlists** — Update wordlists without asking. On by default.
- **Output format** — How entries are written to downloads and to synced files, so they match what your construction software can read: checkboxes to keep or strip **spaces**, **punctuation**, **accents**, and **comments**. Defaults to fully rich (everything kept). The two-way My Edits file is always written as-is regardless — it's the file your construction software edits in place. This is the one place the format is set — downloads and synced files both follow it.
- **Trash score** — The score given to an entry's leftover when you rename it but a copy still lives in another wordlist Grawlix can't delete (see *Editing entries*). Defaults to 0.
- **Reset all data** — Wipes all wordlists and settings and reloads the app.

## Disk sync

Grawlix keeps your data in your browser. **Disk sync** additionally connects an individual list to an individual file on your hard drive — a file you already have, in the place your construction software already reads — and keeps the two in sync. There's no Grawlix folder to set up and no settings to re-point.

You sync each list from its wordlist bar, list by list. Two kinds of sync, depending on the list:

- **My Edits is two-way.** The file is the one your construction software (Ingrid, Crossfire, Crossword Compiler) reads *and* writes. Edit in Grawlix and the file updates; edit the file and Grawlix picks the change up within a couple of seconds. Grawlix's copy in the browser stays the source of truth, so it keeps working even when the file isn't reachable.
- **Every other list is one-way out.** **All Wordlists** and each source write their rescored output to their file whenever the list or its rescore rules change. These are generated outputs — if you hand-edit one of these files, your changes are overwritten the next time Grawlix rewrites it. Point your construction software at **All Wordlists** for the unified wordlist.

**The sync sign.** When you've scoped to a wordlist, its sync sign sits at the right of the wordlist bar, by the Download button. Until the list is connected to a file it's a **Sync to disk** button; once connected it becomes a status pill — a dot plus **Synced to _filename_**, briefly **Saving…** while writing, or a red **Sync conflict** / **Can't find _filename_** when something needs your attention. Clicking it opens a dialog that explains what sync is and lets you set it up or turn it off — no surprise file pickers.

**Setting up sync.** Click the sign and choose:

- For **My Edits**, two doors: **Use a file I already have** (point at the file your software opens — Grawlix loads it and keeps both in sync, the common case) or **Create a new file**.
- For **All Wordlists** or a **source**, a single **Choose file…** — pick or name the file Grawlix writes the rescored output to.

**While synced.** The sign names the synced file. Clicking it again shows **Stop syncing**; stopping leaves the file on disk untouched — it just disconnects. To point a list at a different file, stop syncing and set it up again. **Download** is always there too, in every state.

**When edits collide (My Edits only).** If the same entry was changed both in Grawlix and in the file since they last agreed, Grawlix asks which to keep — **Keep this device** or **Keep the file** — and applies your choice. Changes that touched different entries merge silently; this prompt appears only on a true conflict, so it's rare. Deleting an entry on either side stays deleted — it isn't resurrected by the merge.

**Reconnecting.** Browsers don't always remember file permission across sessions. On boot, files whose permission is remembered resume silently — straight to the app. For any file the browser has forgotten, the loading splash shows an **Open _filename_** button (one click per file to re-grant) and a muted **Skip for now**. Skip is always safe: the full app runs from your browser data, and the un-granted files just stay paused until the next launch reconnects them. If a file goes missing mid-session (moved or deleted), its sign turns attention-colored and reads **⤫ _filename_ · File missing** — stop syncing and set it up again to recover.

**Cross-device.** Put a synced file in Dropbox, iCloud Drive, OneDrive, or Google Drive, and on your other device sync the same list to that same file. Your cloud client moves the bytes; Grawlix has no cloud code of its own. (For My Edits this merges both devices' edits; for a one-way list the latest writer wins.)

**Browser support.** Disk sync uses the File System Access API — Chrome, Edge, and other Chromium-based desktop browsers. In Firefox, Safari, and on phones and tablets, the sign stays on **Saved in browser** and its dialog explains that sync needs a Chromium browser; **Download** is the way to get a file out there. Chrome's "Always allow" on a file grant means most users reconnect once and then never again.

## Keyboard shortcuts

- **Alt-T** — open the tool picker (also **Cmd-K** / **Ctrl-K**).
- **Alt-S** — focus the search input (the permanent search bar).
- **Alt-W** — toggle the whole-word checkbox. If a Search or Regex tool row has focus, toggles that row's; otherwise toggles the permanent search bar's.
- **Alt-C** — focus the score-range input.
- **Alt-M** — cycle dark mode (Auto / Light / Dark).

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

Tools transform the wordlist you're scoped to. They live in the **tool gallery** at the top of the screen. Click a tool's card to add it to the stack; each click appends another tool to the end of the pipeline. Remove a tool with the `✕` on its stack row, or drag a row by its handle (`≡`) to reorder the pipeline. The Search bar stays pinned as the last step — the one exception is that you can drag another Search tool below it, since the last step only needs to be *a* search; that Search then becomes the final bar.

A populated stack feeds top-to-bottom: the first tool reads from your current scope (`All Wordlists`, or the selected wordlist), each subsequent tool reads the previous tool's output. Search is the permanent last step — type LINDSEY into Anagram, then type a substring in the search bar to live-narrow the anagram list.

The full tool catalog — every shipped and planned tool, with its icon, name, description, and example — lives in [`tools.md`](tools.md). The gallery card text matches that catalog. A few cross-tool behaviours worth knowing in the manual: tools that produce a new word (Behead, Curtail, Semordnilap, Space out) show each transformation as a stacked row (covered below in *Chain rows*); the Search and Regex tools have a `▾` caret beside their pattern box that reveals a **Replace** field, turning the filter into a transform (results are kept only when the rewritten word is itself a real entry); some tools support an **all-mode** (covered below in *All-mode and group rows*) that buckets every value into clusters instead of filtering to one. Gallery cards for these carry a `✱` button in their top-right corner — click the card to add the tool flat, click `✱` to add it straight into all-mode. Only one tool in a stack can be in all-mode at a time.

**Chain rows.** A tool that produces a new word — Behead, Curtail, Semordnilap, Space out — shows each result as a stacked row: the original word on top, then each step below it, prefixed with an arrow (`SWING` over `→ WING`). A longer chain stacks further. Semordnilap rows use `↔` because the relationship runs both ways. Click any line to edit that word's score.

**Space out** needs an external dictionary: Grawlix downloads an English word-frequency table (~5 MB) the first time the tool runs and caches it, so the segmenter can tell `A BARREL OF LAUGHS` from `A BARR ELO FLA UGHS`. The card carries a **Splits** slider (One / Few / Many) controlling how aggressively to surface near-tie alternate parses — One keeps only the most confident reading, Many surfaces speculative alternates. Single-word entries that don't benefit from any split pass through unchanged. The split form shows in the entries table with a blank Source and Comment — it's a *rendering* of the original entry, not a new entry — so its score is the original entry's score and it isn't editable.

**Rhymes** narrows the entries table to words that rhyme with what you type — matched on pronunciation, not spelling, so `BLUE` and `THROUGH` rhyme while `THROUGH` and `ROUGH` don't, and a multi-word entry rhymes on its last word (`SPACE OUT` rhymes with `ABOUT`). Sharing the last word isn't a rhyme but a repeat, so a word never rhymes with itself or with a longer phrase ending in it — `AGATHA` and `AUNT AGATHA` aren't a rhyme. A **Match** slider (like Space out's Splits) sets how strict the rhyme is. **Loose**, the default, anchors the rhyme on a word's last stressed syllable even when that's a *secondary* stress, so `CUMBERBATCH` rhymes with `MATCH` and `DYNAMITE` with `KITE`. **Strict** anchors only on the *primary* stress, the classical perfect rhyme: `CUMBERBATCH` (stressed CUM-ber-batch) then rhymes with neither `MATCH` nor `MISMATCH`, though plain `CAT`/`BAT` still do. Like Space out it needs an external dictionary — the CMU Pronouncing Dictionary (~3.5 MB), downloaded and cached the first time you use the tool. In all-mode it clusters your wordlist into rhyme families instead of filtering, dropping any family that's all one word; a word with more than one pronunciation lands in every family it rhymes into.

**Rebus** builds a wordlist for *rebus* puzzles, where several letters share one grid square. Give it a letter string to find and a single symbol to stand in for it — every `TOOL` becomes `Ⓣ`, so `BARSTOOL` turns into `BARSⓉ` — and Grawlix produces those squeezed forms to download and load into your construction software as a supplement: you place a few `Ⓣ`s in the grid and the software fills them. The string box takes the same wildcards (and cheat sheet) as search; the symbol box pops up a grid of circled letters, circled digits, and ASCII symbols to click, or type your own. Add more replacements with the `+` — they all apply at once, so an entry matching several gets every substitution in one output. Unlike Search's Replace, the results needn't be real words: a rebus form lives only in the puzzle, so Rebus shows whatever the substitution produces, keeping each entry's original score.

**All-mode and group rows.** Tools whose card shows a small `✱` corner mark — Letter bank, Anagrams, Consonantcy, Vowelcy, Caesar shift, Cryptogram, Initialisms, Rhymes — support an **all-mode**: click the `✱` button on the right side of the tool's input in the stack to flip from "filter by this value" to "show all values." The input takes a disabled-style background, its placeholder reads `all` in accent color, and the `✱` lights up accent; click `✱` again to go back. Any value you'd typed is restored when you exit all-mode. All-mode produces **group rows** instead of chain rows: a numbered row showing a **Count** and the cluster's surviving members. Each member renders as its own *chain* — the same stacked atoms (original word, then `→ next` for each transformation) that flat chain rows show — and the chains sit side-by-side across the row. Chain Search after a Letter bank in all-mode and only the members whose word matches survive (still as one-atom chains); chain Behead and each surviving member's chain gains a `→ beheaded` atom. When the row holds more chains than fit, the overflow collapses into a **+N more** chip; click it for a popup with every chain. Click any atom — in the row or the popup — to edit that word's score. Only one tool in a stack can be in all-mode at a time; the `✱` button is greyed on the others. **Caesar shift** is the one tool whose all-mode isn't always a grouping: leave its **Shift** blank and it groups entries into Caesar-shift classes like the others, but set a Shift and it rotates every entry by that amount instead — a transform, shown as chain rows.

**Sort.** Axes depend on whether the stack has a transforming tool. With none — a flat list, or just searches — rows sort by Entry / Length / Score. Once a transforming tool is in play, rows sort by Entry / Length / Min score / Max score — Min and Max read across every atom of the row. Adding or removing a transforming tool keeps your sort choice rather than resetting it: Entry and Length stay put, Score becomes Min score, and Min or Max score becomes Score. When the primary axis ties, tiebreakers surface the most interesting entry first: longer over shorter, higher-scoring over lower, with alphabetical as the final stable fallback. Flipping asc/desc reverses only the primary axis; tiebreakers keep their direction, so short low-scoring entries don't float to the top of a tied bucket on `score asc`. With a tool in all-mode, rows sort by Entry / Count / Min score / Max score (Min/Max read across every atom of every chain in the cluster).

**Click a column header to sort by it.** Entry, Len, and Score headers — or Count and the cluster columns in all-mode — are clickable; the column you're sorted by shows a ↑/↓ arrow, and clicking it again flips direction. Clicking a different column sorts by it ascending. The Sort-by dropdown stays the complete control — it's how you reach axes a header doesn't map to, like Max score (the Score header always starts at Min score once a transform is in play), or Min/Max score in all-mode, where group rows have no score column to click.

**Sharing the stack.** The URL captures your tool stack and inputs — pasting a Grawlix link reproduces what you were looking at. See *Sharing & links*.

## Entries table

The entries table below the stats bar shows every entry in your current scope — the merged `All Wordlists` view, or the selected wordlist's own entries — one row per entry, in your current sort order. Each row reads as `1. CARE 4 50` — count, entry, length, score badge. Click on the entry or score to edit it (see *Editing entries*). When you've scoped to a single wordlist, the Source column drops out — every row comes from the one wordlist.

A quiet footer can appear at the end of the table. When the current view has no entries it reads **No matches.** When you're scoped to a single wordlist (anything other than All Wordlists), it reads **Expecting more? Switch to All Wordlists** — a one-click link back to the merged view, a reminder that a narrow scope caps what search and tools can turn up. Both lines can show together.

## Stats bar

A single sticky band above the entries table, carrying every readout about the visible result set and the two controls that shape it. Left to right:

- **Counts.** `Entries N`; with a tool in all-mode, `Groups N` rides alongside. The Entries count reflects what made it to the end of the pipeline — chain rows for flat pipelines, surviving member chains across every visible group for all-mode pipelines.
- **Stats numbers and histogram.** `Min · Max` of the score-range-filtered output, followed by the histogram. On narrow screens `Min · Max` drops out, but counts, histogram, range, and sort always hold.
- **Score range.** A `lo-hi` / `lo+` / `n` text input, or drag-select across the histogram. The histogram itself shows the full pipeline output regardless of range; bars outside the bracket fade in place so you can see what you're trimming as you drag the range narrower. The filter is remembered across visits, per scope — each wordlist (and All Wordlists) keeps its own range.
- **Sort.** "Sort by [Entry ▾] [↑]". Click the arrow to toggle direction, or click a column header in the table below to sort by that column (see *Tools → Sort*).

The score range applies after the pipeline runs, dropping any chain whose journey touched an out-of-range atom. All-mode pipelines drop chains per group; a group stays visible as long as at least one chain survives.

## Exporting the entries table

The **export** menu (an up-tray icon) at the right end of the stats bar offers four ways to get the current view out:

- **Copy to clipboard** — plain text with a markdown link header. Chains render inline with their glyphs (`scar → car`); all-mode pipelines render the chain members per line, comma-separated. Designed for pasting into Discord, notes, or any chat/markdown surface.
- **Export as wordlist** — `.txt` file in `ENTRY;SCORE` per line. Chain rows use the tail entry only with the chain's minimum score (the weak link caps the chain's quality); duplicates collapse to the better of the per-chain mins. Output is alphabetical regardless of your table sort. Comments are not included. Entries containing `;` are dropped with a toast notice.
- **Export as CSV** — `.csv` file for spreadsheet use. Columns mirror what's on screen (entry, length, score, comment, source on flat pipelines; group_key, count, and the catalog group columns on all-mode pipelines). Chain rows interleave columns per atom and prefix with min/max score. Sort matches your current table sort.
- **Export as JSON** — `.json` file for scripters. Mirrors the pipeline's group → chains → entries shape uniformly. Includes the URL that reproduces the view, the parsed tool stack, your current score range, and your current sort. Drops computed fields (length, count, min/max score) since a script can derive them.

All four reflect the current view — search, score range, sort, every active tool. Files are named after the pipeline (`grawlix-behead-1-search-earning.json`); wildcards are stripped from filenames since they're invalid on Windows.

## Editing entries

Click an entry in a row to open an editor popover, titled **Edit entry**. Change the score, comment, or the entry text — edits always land in My Edits, regardless of which wordlist sourced the row. Changing the entry text *renames* the entry (the title switches to **Rename entry** the moment the text differs): the entry you clicked is replaced, never duplicated. To add a brand-new entry instead, use the **＋** button (see *Adding new entries*) — it's titled **Add entry** and only ever adds. The Save button mirrors the mode: **Save**, **Rename**, or **Add**.

**Quick-pick a tier from the score.** In **All Wordlists** and **My Edits**, clicking an entry's *score* (rather than its text) skips the popover and drops a short menu of your score tiers (see *Score tiers*) — each shown as its colored badge, highest to lowest, with the entry's current tier marked (a score that sits between tiers starts on the next tier down). Click one, or arrow up/down and press Enter, and that tier's score lands in My Edits immediately, no Save step. It's the fast path for rescoring entry after entry: click, pick, done. The menu opens with the current tier sitting right over the badge you clicked, so re-picking it does nothing. To set a score that isn't one of your tiers — or to change the comment or rename — click the entry text for the full popover. When you've scoped to a single wordlist, clicking the score opens the popover instead, since an edit there wouldn't change that wordlist's own displayed score.

Because edits live in My Edits, renaming an entry that comes from another wordlist can't remove that wordlist's own copy. So a rename to a different word adds your version and quietly **downscores** the original to the trash score (a number you set in Settings, default 0) so it drops out of your good results. The preview shows this before you save, and a single undo reverts both.

Press Enter to save and close, or Tab to chain edits between score and comment. Escape reverts. Clicking outside, scrolling, or changing the search closes the popover.

**The popover is a cross-wordlist provenance panel.** Below the editor it lists every wordlist that contributes the clicked entry — in priority order, each with that wordlist's actual entry text, effective score, and comment — **including disabled and non-winning** wordlists. So you can see at a glance whether another list scored or spelled the same word differently, even one you aren't merging. Clicking a plain entry shows the whole letter-form across every wordlist; clicking a specific spelling (like `the IRS`) shows that spelling plus the plain forms from *other* wordlists that share its letters — but not a sibling spelling, and not a plain form the same wordlist lists alongside it (that's its own row). This panel is where you compare wordlists when scoped to a single one, since the table itself then shows only that one.

**The panel previews your edit.** As you type, your pending change shows up right here as a My Edits row — appearing (in bold) if My Edits doesn't carry the entry yet, or updating in place if it does — so you can see exactly what saving will do before you commit. A rename also strikes through the entry it replaces, and a leftover it downscores appears as an extra row (bold, at the trash score) right below it. Keeping a same-letters entry separate is called out in a note line. If My Edits' rescore rules remap your raw score, that row's score cell shows the `raw → rescored` mapping, so a lossy edit is never silent.

**Deleting an edit.** When My Edits contributes the clicked entry, its row in the panel carries a trash button. Clicking it *stages* the deletion — the row strikes through and the trash gains a slash — without committing; click the trash again to undo, or Save to commit it (with undo via toast afterward). Cancelling or closing discards a staged deletion.

**Where your edits show up.** An edit lands in My Edits and surfaces wherever My Edits participates: in **All Wordlists** (My Edits is top priority and wins there) and when you scope to **My Edits** itself. A scoped wordlist always shows its *own* values, so an edit you make while scoped to, say, XWI won't change the XWI-scoped view — it's in My Edits now, visible in All Wordlists and in My Edits' own view. The provenance panel still shows your My Edits value alongside the others.

**Adding new entries.** A floating **＋** button in the bottom-right corner opens the entry editor in the center of the screen. If you've just searched for a plain word that no wordlist has, it starts with that word filled in (a wildcard search, or one that already matches something, opens blank). Type a score and an optional comment, press Enter, and the entry lands in My Edits. The ＋ only ever creates: if you type an entry that already exists anywhere in your enabled wordlists, Save stays disabled and the editor says it already exists — edit the existing one instead.

## My Edits

A special wordlist created automatically on first boot. It's where your manual score and comment edits land; otherwise it behaves like any other wordlist. It's always enabled and can't be deleted, but can be reordered (position determines merge priority on ties).

Like any Source, My Edits carries a rescore-rules editor. The scores you type are stored **raw** and run through those rules on the way into the merged view. It starts with a **tier legend** — Grawlix's default tiers (great/good/fair/…) listed as blank-output rows that document the scale right next to where you type scores, remapping nothing, so the score you type is the score you see. Fill in an output only if you want a typed score remapped; whether your scores line up with the tiers is your call, not something Grawlix enforces. Delete the legend if you don't want it (Reset to defaults brings it back). Importing a personal list scored on a different scale clears the legend automatically and lays out that file's scores instead, so it never mislabels them.

Scope to My Edits and its wordlist bar lets you Import a personal wordlist, Download what you've got, or Clear it. Its **Download** follows your Output format like any source; **Download original** (in the split button's menu, alongside **Download rescored**, once it has rules) and its synced file stay as-is — spaces, accents, punctuation, and case preserved — since the synced file is the one your construction software edits in place. Its entries also reach letters-only software through **All Wordlists**, which honors your Output format. You can also sync My Edits to a file ([Disk sync](#disk-sync)).

## Score tiers

Defaults: **great** (≥60), **good** (≥50), **fair** (≥40), **meh** (≥30), **bad** (<30). Score badges color by tier. Hover any score badge — in the entries table, the entry popover, or the tier picker — to see its tier label. Customize the tier labels via **All Wordlists**' scoring rules (see *Rescoring and scoring rules*).

## The wordlist bar

When you've scoped to a wordlist, its actions sit on the right of the wordlist bar. The bar is calm by default — the selector on the left, a small adjustments cluster on the right — and the rest of the screen looks the same whatever you're scoped to.

**Actions differ by scope:**
- **A source** — a split **Download** button, a **Rescoring** button (opens the rescore-rules editor), and a slim **⋮** kebab with **Fetch/Import** and **Configure**. Configure is the existing dialog (rename, change icon, publisher binding, auto-update URL, import, rules) and holds a quiet red **Delete** link in its footer.
- **My Edits** — **Import** a personal wordlist, a **Rescoring** button, and a **⋮** kebab with **Clear**.
- **All Wordlists** — just **Download** (the merged product) and a **Scoring** button (the tier-label editor), no kebab.

On a narrow window the bar folds its buttons into the **⋮** menu to keep the wordlist name readable — **Download** moves in first, then **Rescoring** — so a phone shows a tidy menu instead of a crowded row. All Wordlists, with only two short controls, never needs to fold.

The **sync sign** sits at the right of the bar in every scope (see [Disk sync](#disk-sync)).

## Rescoring and scoring rules

The **adjustments (sliders) icon** beside the selector opens an inline editor that expands in place, pinned while the table scrolls beneath it. What it edits depends on your scope:

- On a **source** (or My Edits), it edits that wordlist's **rescore rules**.
- On **All Wordlists**, it edits the **scoring tiers** — the labels for the unified scale.

**The table is the live preview.** While the editor is open on a source, the rows below show a `350 → 80` arrow on any entry a rule remaps, updating as you type so you tune a rule and watch its effect immediately.

**Your edits are batched — Apply to save.** Changes in the editor are staged: the table previews them live, but nothing is saved until you click **Apply** (the editor closes then), and **Cancel** throws them away. This keeps editing snappy on big wordlists — the rescore runs once when you Apply, not on every keystroke. Closing the editor with unsaved changes asks before discarding them.

**Rescoring rules** map an input score range — and an optional entry-length filter — to an output score. Rules are checked **top to bottom and the first match wins**, so order matters when ranges overlap — a broad rule placed above a narrow one shadows it. You control the order: **drag any rule by its handle (`≡`) to reorder it** (tier labels reorder the same way), and rules never re-sort themselves. Each source and My Edits carries them; My Edits' typed scores are stored raw and run through its rules just like any source. Custom wordlists with up to 10 distinct scores get auto-seeded with one inert rule per score on first import, so you see the wordlist's scale laid out next to All Wordlists' — fill in output mappings, or leave them blank to pass the scores through.

Rescoring is entirely optional. If a wordlist's scores don't line up with Grawlix's scale and you don't care, leave the rules empty — the raw scores pass through and nothing warns you about it. You can ignore the score column entirely and still search, filter, and run every tool.

**Scoring rules** (the All Wordlists editor) are your tier labels for the merged scale ("60 = great, 50 = good, …"). They feed the hover tooltip on each score badge. Labeling is optional too — unlabeled scores still appear, just without a tier name in the tooltip.

Below the rules, the editor's footer holds the **Cancel** / **Apply** buttons, with a few rarer actions as quiet links on the left:

- **Reset to defaults** appears once your rules differ from their shipped defaults — rescore on a publisher source or My Edits, scoring on All Wordlists. It confirms, then restores the defaults into the editor (Apply still saves). Visible only when there's something to undo.
- **Disable rescoring** (sources only) keeps a wordlist's raw scores and notes but drops Grawlix's remapping: the input ranges and notes survive as a documenting legend, only the score remapping goes away. It makes the list dirty, so Reset stays available to undo it. (On All Wordlists it has no place — tier labels already remap nothing.)
- **Make permanent** (My Edits and imported wordlists) rewrites every entry's stored score to its rescored value, then resets the rules. Use it once you've translated a personal list onto Grawlix's scale and want to stop maintaining the translation — afterward the scores *are* Grawlix-scale, so new scores you type are taken at face value. The originals are lost, so grab **Download original** first if you want a backup. Disabled when there's no rescoring to apply, and on auto-fetched or publisher wordlists.

**Update dot.** A green dot appears on a wordlist's row in the selector, and on the collapsed selector title (aggregated), when an update is available to fetch — only when auto-update is off (see [Settings](#settings)).

## Downloads

Every wordlist (and All Wordlists) downloads from its wordlist bar, saving immediately — no dialog. The file uses your global **Output format** (set in [Settings](#settings)). For a **source with rescore rules** the button is a split: **Download** saves the rescored output (the rule result, `<name> rescored.txt`), and its menu names both doors — **Download rescored** (the same as the main button) and **Download original**, which saves your imported file back verbatim with its original formatting (`<name>.txt`). **All Wordlists** saves its merged output as `All Wordlists rescored.txt`. **My Edits** follows the same rule as any source — **Download** saves its rescored output at your format (`My Edits rescored.txt`), and once it has rules the split's **Download original** saves the editable file verbatim (`My Edits.txt`). When the format strips characters, entries that collapse to the same text are merged: the highest score wins and their distinct comments combine with ` / `.

## Discovery banners

Two small dismissable banners appear only in the wordlist they're about, never as a global nag:

- **My Edits import** — shown when you scope to My Edits, nudging you to import a personal wordlist if you keep one.
- **XWI import** — shown when you scope to XWI while it's still unpopulated (Grawlix ships only XWI's default scores, not the paywalled list itself), nudging a subscriber to import their real copy.

Each carries an **Import** button and a ✕ to dismiss; once dismissed, a banner stays gone.

## Help

The header `?` button opens a menu with two entries. **Welcome** is a short popup — what Grawlix is, the pre-loaded wordlists, and a few featured tools. **Acknowledgements** credits the constructors whose wordlists Grawlix is built to combine, and Wordlisted, whose search catalog inspired the tools. A fuller help surface is planned.

## Sharing & links

Your tool stack — every tool you've added and its inputs, in pipeline order — plus the search pattern, whole-word toggle, and sort all ride along in the URL. Refreshing the page keeps your state, and pasting the URL into a chat or saving it as a bookmark reproduces what you were looking at.

The link carries your tools and search settings, not your wordlists, your scope, or your score filter. Wordlists you've loaded stay local; so does the wordlist you're scoped to — a recipient sees the same tools applied to their own scope (usually All Wordlists). The score filter is omitted on purpose: a `60` on your scale isn't a `60` on theirs, so the number wouldn't translate. Your filter and your scope are remembered across your own visits instead.

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
