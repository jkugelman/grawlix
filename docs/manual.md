# Grawlix manual

Grawlix is a browser-based wordlist manager for crossword constructors. It rescores wordlists from different sources to a common scale, then merges them into a single unified view.

Everything stays in your browser. There's no account, no login, and no server-side storage — your wordlists, edits, and settings live entirely in your browser's local storage on this device.

This is the user-facing manual. Eventually it'll be turned into an in-app manual; for now it's a Markdown file.

## The app shell

**Header.** Wordmark, the personal "Made with…" byline, settings, and a `?` button that opens Help (an FAQ with acknowledgements). Sticks at the top while you scroll.

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

The selector is a pure picker — icons and labels, no checkboxes. A disabled wordlist (one excluded from the All Wordlists merge) shows grayed out but is still selectable: you can land on it, view it, and run tools on it. Each row also shows how much that wordlist contributes — an **X of Y entries used** count (how many of its entries survive dedup and priority in the merge). A green dot on a row flags an available update for that wordlist; an aggregate dot rides on the collapsed selector title when any wordlist has one.

Scope is **sticky** — Grawlix reopens to the wordlist you were last looking at (All Wordlists on first run). It stays on your device and never travels in a shared link.

**Managing wordlists.** A **Manage wordlists** footer at the bottom of the selector dropdown opens the manage panel — where you reorder wordlists (order is merge priority), enable or disable them, and add new ones. Reordering and toggling stage up as you go and commit all at once when you click **Save** (or discard on **Cancel**); the merge rebuilds once, on Save, rather than on every change. **Add wordlist** runs the usual import/fetch flow and returns you to the panel with the new list in place.

**When a fetch is slow.** The built-in wordlists download in the background — usually they're ready in a second or two and just appear, with nothing in your way. If one is taking a while (more than about five seconds), a small panel slides in at the bottom of the screen showing how much has downloaded so far and a progress bar. The bar moves with the download — it sweeps across as data arrives and freezes when it stalls, so a stuck fetch is obvious instead of being hidden behind a bar that animates regardless. The panel is just a status display, with no buttons; a download that finishes drops off on its own. If one **fails**, you get a toast with a **Retry** instead. Several downloads at once stack as rows in the one panel. A fetch you start yourself — **Fetch** from a wordlist's **⋮** menu — shows right away instead of waiting.

## Settings

The gear in the header opens **Settings**:

- **Dark mode** — Auto (follow your OS), Light, or Dark.
- **Auto-update wordlists** — Update wordlists without asking. On by default. When an update lands while you're viewing results, it won't reshuffle them out from under you: score changes apply right away, and for a plain list or search so do added and removed entries. In a grouped or multi-word view (an all-mode tool, a multi-pattern Umiaq, or a transform like Anagrams), added and removed entries instead wait behind a small **Refresh** button on the stats bar — click it, or just start a new search, to apply them.
- **Output format** — How entries are written to downloads and to synced files, so they match what your construction software can read: checkboxes to keep or strip **spaces**, **punctuation**, **accents**, and **comments**. Defaults to fully rich (everything kept). The two-way My Edits file is always written as-is regardless — it's the file your construction software edits in place. This is the one place the format is set — downloads and synced files both follow it.
- **Trash score** — The score given to an entry's leftover when you rename it but a copy still lives in another wordlist Grawlix can't delete (see *Editing entries*). Defaults to 0.
- **Reset all data** — Wipes all wordlists and settings and reloads the app.

## Disk sync

Grawlix keeps your data in your browser. **Disk sync** additionally connects an individual list to an individual file on your hard drive — a file you already have, in the place your construction software already reads — and keeps the two in sync. There's no Grawlix folder to set up and no settings to re-point.

You sync each list from its wordlist bar, list by list. Two kinds of sync, depending on the list:

- **My Edits is two-way.** The file is the one your construction software (Ingrid, Crossfire, Crossword Compiler) reads *and* writes. Edit in Grawlix and the file updates; edit the file and Grawlix picks the change up within a couple of seconds. Grawlix's copy in the browser stays the source of truth, so it keeps working even when the file isn't reachable.
- **Every other list is one-way out.** **All Wordlists** and each source write their rescored output to their file whenever the list or its rescore rules change. These are generated outputs — if you hand-edit one of these files, your changes are overwritten the next time Grawlix rewrites it. Point your construction software at **All Wordlists** for the unified wordlist.

**The sync button.** When you've scoped to a wordlist, a sync control sits at the right of the wordlist bar, by the Download button. Until the list is connected to a file it's a **Sync to disk** button; once connected it becomes a status pill — a dot plus **Synced to _filename_**, briefly **Saving…** while writing, or a red **Sync conflict** / **Can't find _filename_** when something needs your attention. Clicking it opens a dialog that explains what sync is and lets you set it up or turn it off — no surprise file pickers.

**Setting up sync.** Click **Sync to disk** and you get the same two doors wherever you are:

- **Use an existing file** (a one-way list calls it **Overwrite an existing file**) — point at the file your software already reads. For My Edits, Grawlix loads it in and keeps both in sync; for a one-way list it overwrites that file with the rescored output.
- **Create a new file** — name a fresh file for Grawlix to write to.

**While synced.** The pill names the synced file. Clicking it again offers **Turn off**; turning sync off leaves the file on disk untouched — it just disconnects. To point a list at a different file, turn sync off and set it up again. **Download** is always there too, in every state.

**When edits collide (My Edits only).** If the same entry was changed both in Grawlix and in the file since they last agreed, Grawlix asks which to keep — **Keep this device** or **Keep the file** — and applies your choice. Changes that touched different entries merge silently; this prompt appears only on a true conflict, so it's rare. Deleting an entry on either side stays deleted — it isn't resurrected by the merge.

**Reconnecting.** Browsers don't always remember file permission across sessions. On boot, files whose permission is remembered resume silently — straight to the app. For any file the browser has forgotten, the loading splash shows an **Open _filename_** button (one click per file to re-grant) and a muted **Skip for now**. Skip is always safe: the full app runs from your browser data, and the un-granted files just stay paused until the next launch reconnects them. If a file goes missing mid-session (moved or deleted), its pill turns attention-colored and reads **Can't find _filename_** — turn sync off and set it up again to recover.

**Cross-device.** Put a synced file in Dropbox, iCloud Drive, OneDrive, or Google Drive, and on your other device sync the same list to that same file. Your cloud client moves the bytes; Grawlix has no cloud code of its own. (For My Edits this merges both devices' edits; for a one-way list the latest writer wins.)

**Browser support.** Disk sync uses the File System Access API — Chrome, Edge, and other Chromium-based desktop browsers. On Firefox and Safari the **Sync to disk** button still appears, but clicking it just explains that sync needs a Chromium browser; on phones and tablets the button doesn't appear at all. Either way, **Download** is the way to get a file out there. Chrome's "Always allow" on a file grant means most users reconnect once and then never again.

## Keyboard shortcuts

- **Ctrl-F / Cmd-F** — find in the entries table (see *Finding in the table*).
- **Alt-T** — open the tool picker (also **Cmd-K** / **Ctrl-K**).
- **Alt-S** — focus the search input (the permanent search bar).
- **Alt-W** — toggle the whole-word checkbox. If a Search or Regex tool row has focus, toggles that row's; otherwise toggles the permanent search bar's.
- **Alt-C** — focus the score-range input.
- **Alt-A** — add an entry (the floating **+** button); opens a blank entry panel that lands the entry in My Edits.
- **Alt-↑ / Alt-↓** — with the entry panel open, step to the previous / next entry without closing (or the **Prev / Next** buttons). Moving saves the current edit. See *Editing entries*.
- **Alt-M** — cycle dark mode (Auto / Light / Dark).
- **Alt-0 … Alt-9** — retier a score, in **All Wordlists** or **My Edits**: select one or more entry rows (or open a single entry's tier picker) and press Alt with a digit. **Alt-0** is the lowest tier, counting up — the digit shows beside each tier in the picker — and the new score lands in My Edits. A toast confirms the change (naming the count for a batch) and offers an Undo. See *Selecting rows* for how to select.

## Search syntax

- `?` — any character
- `#` — consonant
- `@` — vowel
- `*` — any substring
- `[abc]` — character class
- `[a-m]` — character range (`[0-9]` works too)
- Whole-word toggle anchors the pattern.

Every pattern is matched two ways, and an entry counts as a hit if *either* matches: against the entry **as written** — so a space, hyphen, or accent you type has to be there (`co-op` matches `co-op` but not `coop`; `the IRS` matches `the IRS`; `résumé` matches only `résumé`) — and against its **letters alone**, lowercased with accents, spaces, and punctuation stripped (so `theirs` matches `the IRS`, and a bare `resume` matches both `resume` and `résumé`). The letters-only pass means you rarely need to type separators; the as-written pass means typing them narrows the match to exactly that form. A `?` fills exactly one character of any kind — a letter, or a symbol or space in the as-written form — never nothing.

Focus any search box and this cheat sheet pops up above it. The Regex tool's pattern and replacement boxes show regex-specific cheat sheets instead, each linking out to [regexone.com](https://regexone.com/) for the syntax a popover can't cover; regex patterns are tested against the same two forms, so `\s` or `\b` can key on the spacing in a phrase (`Helen of Troy`) that the letters-only form drops.

## Tools

Tools transform the wordlist you're scoped to. They live in the **tool gallery** at the top of the screen. Click a tool's card to add it to the stack; each click appends another tool to the end of the pipeline. Remove a tool with the `✕` on its stack row, or drag a row by its handle (`≡`) to reorder the pipeline. The Search bar stays pinned as the last step — the one exception is that you can drag another Search tool below it, since the last step only needs to be *a* search; that Search then becomes the final bar.

A populated stack feeds top-to-bottom: the first tool reads from your current scope (`All Wordlists`, or the selected wordlist), each subsequent tool reads the previous tool's output. Search is the permanent last step — type LINDSEY into Anagram, then type a substring in the search bar to live-narrow the anagram list.

The full tool catalog — every shipped and planned tool, with its icon, name, description, and example — lives in [`tools.md`](tools.md). The gallery card text matches that catalog. A few cross-tool behaviours worth knowing in the manual: tools that produce a new word (Behead, Curtail, Add prefix, Remove prefix, Add suffix, Remove suffix, Semordnilap, Space out) show each transformation as a stacked row (covered below in *Chain rows*); the Search and Regex tools have a `▾` caret beside their pattern box that reveals a **Replace** field, turning the filter into a transform (results are kept only when the rewritten word is itself a real entry, unless you tick **Allow unlisted** to keep coined entries too — each inheriting its source entry's score); some tools support an **all-mode** (covered below in *All-mode and group rows*) that buckets every value into clusters instead of filtering to one. Gallery cards for these carry a `✱` button in their top-right corner — click the card to add the tool flat, click `✱` to add it straight into all-mode. Only one tool in a stack can be in all-mode at a time.

**Chain rows.** A tool that produces a new word — Behead, Curtail, Add prefix, Remove prefix, Add suffix, Remove suffix, Semordnilap, Space out — shows each result as a stacked row: the original word on top, then each step below it, prefixed with an arrow (`SWING` over `→ WING`). A longer chain stacks further. Semordnilap rows use `↔` because the relationship runs both ways. Click any line to edit that word's score.

**Space out** needs an external dictionary: Grawlix downloads an English word-frequency table (~5 MB) the first time the tool runs and caches it, so the segmenter can tell `A BARREL OF LAUGHS` from `A BARR ELO FLA UGHS`. The card carries a **Splits** slider (One / Few / Many) controlling how aggressively to surface near-tie alternate parses — One keeps only the most confident reading, Many surfaces speculative alternates. Single-word entries that don't benefit from any split pass through unchanged. The split form shows in the entries table with a blank Source and Comment — it's a *rendering* of the original entry, not a new entry — so its score is the original entry's score and it isn't editable.

**Rhymes** narrows the entries table to words that rhyme with what you type — matched on pronunciation, not spelling, so `BLUE` and `THROUGH` rhyme while `THROUGH` and `ROUGH` don't, and a multi-word entry rhymes on its last word (`SPACE OUT` rhymes with `ABOUT`). Sharing the last word isn't a rhyme but a repeat, so a word never rhymes with itself or with a longer phrase ending in it — `AGATHA` and `AUNT AGATHA` aren't a rhyme. A **Match** slider (like Space out's Splits) sets how strict the rhyme is. **Loose**, the default, anchors the rhyme on a word's last stressed syllable even when that's a *secondary* stress, so `CUMBERBATCH` rhymes with `MATCH` and `DYNAMITE` with `KITE`. **Strict** anchors only on the *primary* stress, the classical perfect rhyme: `CUMBERBATCH` (stressed CUM-ber-batch) then rhymes with neither `MATCH` nor `MISMATCH`, though plain `CAT`/`BAT` still do. Like Space out it needs an external dictionary — the CMU Pronouncing Dictionary (~3.5 MB), downloaded and cached the first time you use the tool. In all-mode it clusters your wordlist into rhyme families instead of filtering, dropping any family that's all one word; a word with more than one pronunciation lands in every family it rhymes into.

**Rebus** builds a wordlist for *rebus* puzzles, where several letters share one grid square. Give it a letter string to find and a single symbol to stand in for it — every `TOOL` becomes `Ⓣ`, so `BARSTOOL` turns into `BARSⓉ` — and Grawlix produces those squeezed forms to download and load into your construction software as a supplement: you place a few `Ⓣ`s in the grid and the software fills them. The string box takes the same wildcards (and cheat sheet) as search; the symbol box pops up a grid of circled letters, circled digits, and ASCII symbols to click, or type your own. Add more replacements with the `+` — they all apply at once, so an entry matching several gets every substitution in one output. The results needn't be real words: a rebus form lives only in the puzzle, so Rebus shows whatever the substitution produces, keeping each entry's original score — the same off-list, score-preserving output Search and Regex Replace give once you tick **Allow unlisted**.

**Umiaq** is a variable-and-pattern search, the one tool whose shape depends on what you type. Lowercase letters, `?`, `*`, `[…]`, `#`, and `@` work as in the search bar, but **capital letters are variables**: each stands for a run of letters that has to come out the same everywhere it appears. `ABBA` finds words whose halves mirror (NOON, DEED); `AA` finds doubled words (MAMA, TUTU). Add constraints like `~A` (the reverse of a variable), `|A|=n` (pin a length), `A=#@#` (make a variable fit a sub-pattern, or `A!=#@#` to avoid one), and `A!=B` (force two variables apart). A leading `/` makes the pattern an **anagram** — `/triangle` finds every rearrangement of those letters, and `/act*` every word containing A, C, T. A **term equals** like `A;B;AB=boardroom` goes a step further, finding *separate* words that combine into a target — here pairs that concatenate to BOARDROOM (BOARD + ROOM). Because capitals carry meaning, this tool alone is **case-sensitive** — `cat` is the literal word, `CAT` is three variables. A single pattern filters the corpus word by word, indistinguishable from a search; separate several with `;` and Umiaq becomes a **multi-pattern search** that finds *tuples* of words satisfying the shared variables together — `AB;BA` turns up pairs like APE / PEA where the same two chunks swap places, rendered as side-by-side lanes with each variable in its own color across the lanes. The complete dialect — every element, the *term* concept, and the length and match operators — is documented in [`docs/umiaq.md`](umiaq.md). The matcher reimplements [Umiaq](https://github.com/crosswordnexus/umiaq) and the notation comes from [Qat](https://www.quinapalus.com/qat.html), both credited in the in-app Help.

**All-mode and group rows.** Tools whose card shows a small `✱` corner mark — Letter bank, Anagrams, Consonantcy, Vowelcy, Caesar shift, Cryptogram, Initialisms, Rhymes, Dead center — support an **all-mode**: click the `✱` button on the right side of the tool's input in the stack to flip from "filter by this value" to "show all values." The input takes a disabled-style background, its placeholder reads `all` in accent color, and the `✱` lights up accent; click `✱` again to go back. Any value you'd typed is restored when you exit all-mode. All-mode produces **group rows** instead of chain rows: a numbered row showing a **Count** and the cluster's surviving members. Each member renders as its own *chain* — the same stacked atoms (original word, then `→ next` for each transformation) that flat chain rows show — and the chains sit side-by-side across the row. Chain Search after a Letter bank in all-mode and the whole cluster is kept as long as any member matches — the matching members highlight while the rest stay alongside them (still one-atom chains), since a cluster's value is the complete set that shares its bank. If the score range then hides every matching member, the whole cluster drops rather than lingering with no highlight — but the hidden match still shows as a faded bar in the score histogram, so widening the range brings the cluster back. Chain Behead and each surviving member's chain gains a `→ beheaded` atom. When the row holds more chains than fit, the overflow collapses into a **+N more** chip; click it for a popup with every chain. Click any atom — in the row or the popup — to edit that word's score. Only one tool in a stack can be in all-mode at a time; the `✱` button is greyed on the others. **Caesar shift** is the one tool whose all-mode isn't always a grouping: leave its **Shift** blank and it groups entries into Caesar-shift classes like the others, but set a Shift and it rotates every entry by that amount instead — a transform, shown as chain rows.

**Sort.** Axes depend on whether the stack has a transforming tool. With none — a flat list, or just searches — rows sort by Entry / Length / Score. Once a transforming tool is in play, rows sort by Entry / Length / Min length / Max length / Min score / Max score — Min and Max read across every atom of the row (Length stays the first entry's length). Adding or removing a transforming tool keeps your sort choice rather than resetting it: Entry and Length stay put, Score becomes Min score, and on removal Min/Max score folds back to Score (and Min/Max length back to Length). When the primary axis ties, tiebreakers surface the most interesting entry first: longer over shorter, higher-scoring over lower, with alphabetical as the final stable fallback. Flipping asc/desc reverses only the primary axis; tiebreakers keep their direction, so short low-scoring entries don't float to the top of a tied bucket on `score asc`. With a tool in all-mode, rows sort by Entry / Count / Min score / Max score / Min length / Max length (Min/Max read across every atom of every chain in the cluster).

**Click a column header to sort by it.** Entry, Len, Score, and Comment headers — or Count and the cluster columns in all-mode — are clickable, and the column you're sorted by shows a ↑/↓ arrow. A column that sorts only one way sorts the moment you click it, and clicking again flips direction. A column that can sort more than one way opens a small **menu** of its axes instead — pick one to sort by it, or pick the active one again to flip direction. That's how you reach **Max score** and **Min / Max length** (the Score and Len columns, once a transform is in play) and, in all-mode, **Min / Max score** and **Min / Max length** (group rows have no score or length column, so those live on the Entries column's menu). Comment sorts lexically. The Sources column (merged `All Wordlists` view only) shows each entry's contributing wordlists as icons, not a single name, so it isn't sortable.

**Sort by more than one column at once.** Hold **Shift, Ctrl, or Alt** (Cmd on a Mac) while you click a header to add it as a *secondary* sort instead of replacing the current one — so you can sort by Count and then break ties by Letters, or list long entries first and read down them by score. Each column you've added shows a small **rank number** (①②…) next to its arrow once two or more are active, telling you the priority order; a single sort shows just the arrow. Modifier-click a column that's already in the sort to flip that one column's direction; a plain (no-modifier) click on any header clears the stack back to a single sort. This is a power-user shortcut — it's desktop-only (there's no touch equivalent) and there's no on-screen button for it; the rank badges are the only hint it's in play.

**Sharing the stack.** The URL captures your tool stack and inputs — pasting a Grawlix link reproduces what you were looking at. See *Sharing & links*.

## Entries table

The entries table below the stats bar shows every entry in your current scope — the merged `All Wordlists` view, or the selected wordlist's own entries — one row per entry, in your current sort order. Each row reads as `1. CARE 4 50` — count, entry, length, score badge. Click on the entry or score to edit it (see *Editing entries*).

The **Sources** column is a presence matrix: every enabled wordlist gets a fixed slot (in priority order), and each row shows that list's icon where it contains the entry and an empty gap where it doesn't — so the icons line up into columns you can read both ways. Across a row you see an entry's coverage (which lists carry it); down a slot you see which entries a given list contributes. An entry with a single icon is unique to that list; two or more means it's shared. A list shows in full color when it's the source of a value you're seeing — the displayed spelling, the winning score, or the comment — while a list that merely also contains the entry is muted to gray. Each shown value has a single source (the highest-priority list that has it), so a duplicate holding the same spelling and score as the winner is muted, not lit. Usually only the winner is colored, but a row lights up two lists when the spelling and the score come from different lists: a high-priority bare entry can win the score while a lower-priority list supplies the richer spelling (say `the IRS`). The column shows in every scope, including a single wordlist — there it's your cross-wordlist view, and since the scoped list is the only one whose values you see, it's the only one in color (a row where it's the lone color is unique to it). It hides on narrow viewports. For the full per-entry detail — every list's exact spelling, score, and comment, including disabled and non-winning lists — click the entry to open the provenance panel (see *Editing entries*).

A quiet footer can appear at the end of the table. When the current view has no entries it reads **No matches.** When you're scoped to a single wordlist (anything other than All Wordlists), it reads **Expecting more? Switch to All Wordlists** — a one-click link back to the merged view, a reminder that a narrow scope caps what search and tools can turn up. Both lines can show together.

### Selecting rows

You can select rows and drive the table entirely from the keyboard — built for retiering or deleting a run of entries quickly. **Clicking an entry opens it** for editing (and selects its row); **clicking anywhere else on the row selects it** without opening — or **click and drag** across rows to select a run. You can also **double-click** any row to open it. The **score badge** is the exception: it opens the tier quick-pick. On a phone, where there's no double-click or drag, a single **tap opens** the entry and multi-select is a desktop-only feature. Once the table has focus, the arrow keys — or **Alt-↑ / Alt-↓**, the same reflex as the panel's walk keys — and **PgUp / PgDn / Home / End** move a cursor through the list, **Enter** opens the entry panel (closing it drops you right back on the row, so you can arrow to the next and open that one), and **Esc** clears the selection.

To select several at once:

- **Shift + arrows**, **Shift + click**, or **click and drag** across the rows extends a contiguous run — a family under the family sort, or a stretch of search hits.
- **Ctrl / Cmd + click** (or move with **Ctrl / Cmd + arrows** and toggle with **Space**) picks scattered rows one at a time — the way to gather entries that aren't next to each other, like the members of a run-together family that only line up once you've spaced them.
- **Ctrl / Cmd + A** selects everything in the current view. Search down to what you want, select all, retier in one stroke.

With rows selected, **Alt + digit** retiers the whole selection at once (see *Score tiers*), and in the **My Edits** scope **Delete** removes the selection — each as a single action with one Undo. Or press **Enter** to open the panel and **walk just the selected rows** with Prev/Next (see *Editing entries*), editing each in turn — the way to give a hand-picked family individual comments or scores. The selection sticks as you keep typing in the search box, so you can pick a batch, narrow the view, and act on what's left. It also follows a **rename**: rename a selected entry and it stays selected and highlighted, even when its new name sorts it to a different spot — so renaming through a batch one at a time keeps the rest marked.

### Family grouping

When the table is sorted by **Entry** (the default), related entries are grouped together rather than sorted in strict alphabetical order. Inflections of the same word sit side by side — `cat` with `cats`, `eat` with `eats`, `eating`, `ate`, and `eaten` — and the same holds for phrases, so `have a go at`, `had a go at`, and `having a go at` cluster instead of scattering across the list. It reads like a smarter alphabetical: forms that would already land near each other now line up exactly, so when you rescore one you can see and fix its siblings right there.

A thin bracket down the left edge marks each group of two or more related entries; an entry with no relatives in the list is left unmarked, so only the clusters stand out. The grouping covers plurals, verb conjugations, and leading articles (`the best` groups with `best`); it does not chase word-derivations like `red` / `redness` / `redden`. Sorting by any other column returns to that column's plain order with no grouping.

When you open an entry, the panel also lists its relatives at the bottom: its family (the group described above) together with any other spellings of the same entry across your lists — the same word with and without punctuation or spacing, say. Each shows inline with its score, the entry you're on in bold. Click any relative to jump straight to it — your current edits are saved first, so you can click around a family without losing changes. It's built for working through related entries together: open one and its siblings are right there, scores side by side, a click away. The list follows along as you retype the entry, so giving a run-together entry its spaces brings its relatives into view before you even save. It spans all your wordlists, not just whichever one you've scoped the table to.

### Finding in the table

Press **Ctrl-F** (**Cmd-F** on a Mac) to find text anywhere in the table. Because only the on-screen rows are actually drawn, your browser's own find would miss everything scrolled out of view — so Grawlix does its own, searching the whole result. Type in the bar that appears and it jumps to the first match and highlights every match on screen, with a counter showing where you are (`3/47`). Press **Enter** for the next match and **Shift-Enter** for the previous — both wrap around — or use the up/down carets; **Esc** closes it. It searches entry text and comments (entry text only in the grouped views), ignores case, and if a match sits inside a collapsed group it opens that group to show it. Finding never changes your sort or filter — it just moves you around what's already there.

In **All Wordlists** and **My Edits**, the match you're on is also **selected**, so you can edit it straight from the keyboard. Press **Esc** then **Enter** to open the found entry for editing, or **Alt** + a digit to retier its score on the spot — and that retier works with the find bar still open, so you can rescore your way down every match in a rhythm: type, **Alt**-digit, **Enter**, repeat. (See *Selecting rows* and *Editing entries*.)

## Stats bar

A single sticky band above the entries table, carrying the counts, the score-range control and the histogram it pairs with, and the Share and Export menus. Left to right:

- **Counts.** `Entries N`; with a tool in all-mode, `Groups N` rides alongside. The Entries count reflects what made it to the end of the pipeline — chain rows for flat pipelines, surviving member chains across every visible group for all-mode pipelines.
- **Histogram and score range.** The histogram sits between the counts and a `lo-hi` / `lo+` / `n` text box labeled **Scores** — it's stats about the entries on one side and the filter's visual twin on the other, so it belongs in the middle. The box and the histogram are one filter, one exact and one visual. Focus the box for a syntax cheat sheet, the same way the search boxes show theirs, or drag-select across the histogram. The histogram shows the full pipeline output regardless of range; bars outside the bracket fade in place so you can see what you're trimming as you drag the range narrower. On a narrow window the histogram drops out first, but the counts and the box always hold. The filter is global and remembered across visits — it applies to whichever wordlist you're scoped to, so switching scope keeps it in place rather than clearing it. New here, you start at `1+`, so the trash tier (anything at or below the trash score) stays hidden until you ask for it. That default sits one point above your **trash score** (set in Settings), so raising the trash score lifts the filter's floor to match. The box's button reflects where you are: sitting at the default it's an **×** that clears the filter to show everything (and that choice sticks); anywhere else — including an empty box — it's a **↺** that snaps back to the default.
- **Share and Export.** Two labeled menus — **Share ▾** to copy the current view to the clipboard, **Export ▾** to download it as a file (see *Exporting the entries table*). Sorting isn't in this bar: click a column header in the table below (see *Tools → Sort*).

The score range applies after the pipeline runs, dropping any chain whose journey touched an out-of-range atom. All-mode pipelines drop chains per group; a group stays visible as long as at least one chain survives.

## Exporting the entries table

Two labeled menus at the right end of the stats bar get the current view out. **Share ▾** copies it to the clipboard; **Export ▾** writes it to a file in one of three formats:

- **Copy to clipboard** (under Share) — plain text with a markdown link header. Chains render inline with their glyphs (`scar → car`); all-mode pipelines render the chain members per line, comma-separated. Designed for pasting into Discord, notes, or any chat/markdown surface.
- **Results as wordlist** (under Export) — `.txt` file in `ENTRY;SCORE` per line. Chain rows use the tail entry only with the chain's minimum score (the weak link caps the chain's quality); duplicates collapse to the better of the per-chain mins. Output is alphabetical regardless of your table sort. Comments are not included. Entries containing `;` are dropped with a toast notice.
- **Results as CSV** (under Export) — `.csv` file for spreadsheet use. Columns mirror what's on screen (entry, length, score, comment, source on flat pipelines; group_key, count, and the catalog group columns on all-mode pipelines). Chain rows interleave columns per atom and prefix with min/max score. Sort matches your current table sort.
- **Results as JSON** (under Export) — `.json` file for scripters. Mirrors the pipeline's group → chains → entries shape uniformly. Includes the URL that reproduces the view, the parsed tool stack, your current score range, and your current sort. Drops computed fields (length, count, min/max score) since a script can derive them.

All four reflect the current view — search, score range, sort, every active tool. Files are named after the pipeline (`grawlix-behead-1-search-earning.json`); wildcards are stripped from filenames since they're invalid on Windows.

## Editing entries

Open an entry — **click** its text (or **tap** it on a phone; a **double-click** anywhere on the row works too) — to bring up the entry panel, titled **Edit entry**. Change the score, comment, or the entry text — edits always land in My Edits, regardless of which wordlist sourced the row. Changing the entry text *renames* the entry (the title switches to **Rename entry** the moment the text differs): the entry you clicked is replaced, never duplicated. To add a brand-new entry instead, use the **＋** button (see *Adding new entries*) — it's titled **Add entry** and only ever adds. Until you've changed anything the footer holds a single **Close** button; the moment you edit, it becomes **Cancel** plus an action button that mirrors the mode — **Save**, **Rename**, or **Add**.

**Walk from one entry to the next without closing.** The panel has **Prev / Next** caret buttons — keys **Alt-↑ / Alt-↓** — that move it to the neighbouring entry in place. Moving **saves** the current edit automatically, so you can fix a score or a comment, press Next, and keep going down a run; **Cancel**, **Esc**, and the **✕** discard instead. Whatever field you're in stays put as you move, so you can retype the same field — a comment, say — straight down a word family in a steady rhythm. Open the panel with **several rows selected** (see *Selecting rows*) and the walk is limited to just those rows, with your position shown (e.g. `2 / 4`) — and the whole selection stays highlighted in the table as you step through it, so it holds together under any sort. Open a **single** entry and Prev/Next step through the table in order, the selection following along. Either way, the entry's relatives are always right there in the panel's *Related entries* list (see *Family grouping*), a click away.

This full editor opens in the **All Wordlists** and **My Edits** views. Scoped to any other single wordlist, the panel opens **read-only** — titled *View entry*, showing that list's own entry, score, and comment with a **Close** button and no editing. A foreign wordlist isn't yours to change in place; edits belong in My Edits, which you make from All Wordlists or My Edits. The provenance table below (see further down) still shows the whole cross-wordlist picture either way.

The **Score** field is a combo box: click the chevron beside it (or press **↓**) and a dropdown of your score tiers drops in below, each shown as its colored badge with its name. Pick one to drop that tier's score in, or just keep typing — you can set *any* score, the tiers are only there for reference. Picking never locks you in, and nothing saves until you hit **Save** or press **Enter** with the dropdown closed. While it's open, **Enter** just accepts — the tier you arrowed onto, or the value you typed — and closes the list; **Esc** closes it too.

**Quick-pick a tier from the score.** In **All Wordlists** and **My Edits**, clicking an entry's *score* (rather than its text) skips the panel and drops a short menu of your score tiers (see *Score tiers*) — each shown as its colored badge, highest to lowest, with the entry's current tier marked (a score that sits between tiers starts on the next tier down). Click one, or arrow up/down and press Enter, and that tier's score lands in My Edits immediately, no Save step. It's the fast path for rescoring entry after entry: click, pick, done. The menu opens with the current tier sitting right over the badge you clicked, so re-picking it does nothing. Faster still, skip the menu entirely: each tier carries an **Alt** + digit shortcut (**Alt-0** the lowest, counting up), and it works whether the menu is open *or* you've selected one or more rows — select and press, no click. See *Selecting rows* for how to select, and to retier several entries at once. To set a score that isn't one of your tiers — or to change the comment or rename — click the entry text for the full panel, whose Score field shows the same tiers as a dropdown you can pick from or type past. When you've scoped to a single wordlist, clicking the score opens the **read-only** panel instead — that list isn't editable in place (to change its scores, work in All Wordlists or My Edits).

Because edits live in My Edits, renaming an entry that comes from another wordlist can't remove that wordlist's own copy. So a rename to a different word adds your version and quietly **downscores** the original to the trash score (a number you set in Settings, default 0) so it drops out of your good results. The preview shows this before you save, and a single undo reverts both.

Press **Enter** to save and close — or, when you've changed nothing, simply to close (what the **Close** button does); Tab chains edits between score and comment. The panel is modal: it dims the rest of the page, which stays inert until you're done — any click outside it, Escape, the **Cancel** / **Close** button, the close ✕, or the browser Back gesture/button closes it, while scrolling leaves it open. The deliberate closes — Cancel/Close, the ✕, Escape, and Back — throw away any unsaved edits straight away; an accidental click *outside* the panel, though, won't dismiss it while you have unsaved changes — the Cancel and Save buttons shake to point you to them instead (with nothing unsaved, an outside click closes the panel as usual). On a phone the panel fills the screen, and your phone's Back gesture (or button) closes it.

The open entry shows in the address bar (`?entry=BAGEL`), so it's bookmarkable and shareable — send someone a link straight to an entry, and Back/Forward step in and out of it. The link also carries whatever tools you had running; trim it to just `?entry=BAGEL` to share the entry alone.

**The panel is a cross-wordlist provenance view.** Below the editor it lists every wordlist that contributes the clicked entry — in priority order, each with that wordlist's actual entry text, effective score, and comment — **including disabled and non-winning** wordlists. So you can see at a glance whether another list scored the same word differently, even one you aren't merging. Clicking a *specific* spelling scopes the table to it: click `Boney M.` and you see the lists that spell it that way, plus any that hold it with no fixed spelling, while the lists that write `Boney M` are one tap away in the entry's Related entries list at the foot of the panel. Clicking a plainly-spelled entry — one with no fixed spelling of its own — instead lists *every* spelling here, since it stands for all of them; that's how you see which list supplied the spaced spelling (`hard science`) your merged copy of a run-together entry (`hardscience`) actually took. The Sources column gives the quick version — which lists carry each entry — while this panel is the deep one: the exact spelling, score, and comment each list holds, disabled and non-winning included.

**The panel previews your edit.** As you type, your pending change shows up right here as a My Edits row — appearing (in bold) if My Edits doesn't carry the entry yet, or updating in place if it does — so you can see exactly what saving will do before you commit. A rename also strikes through the entry it replaces, and a leftover it downscores appears as an extra row (bold, at the trash score) right below it. Keeping a same-letters entry separate is called out in a note line. If My Edits' rescore rules remap your raw score, that row's score cell shows the `raw → rescored` mapping, so a lossy edit is never silent.

**Deleting an edit.** When My Edits contributes the clicked entry, its row in the panel carries a trash button. Clicking it *stages* the deletion — the row strikes through and the trash gains a slash — without committing; click the trash again to undo, or Save to commit it (with undo via toast afterward). Cancelling or closing discards a staged deletion the same as any other unsaved change.

**Adding an entry to My Edits as-is.** Sometimes you want My Edits to *own* an entry it doesn't already — to upgrade a plainly-spelled entry you imported (`aaabond`) to the nicer spelling another wordlist has (`AAA bond`), or just to pull an entry only another list carries into My Edits without changing anything. Since the panel already shows the winning spelling and score, there's nothing to edit, so a quiet **Add to My Edits** link sits at the bottom-left whenever this is possible — it reads **Update My Edits** when it will upgrade a plain entry you already have, replacing it rather than leaving two. Click it to stage the addition: the link gives way to your My Edits row, previewed just like any edit and carrying a trash to back out, then Save. Editing any field instead turns it back into an ordinary save.

**Where your edits show up.** An edit lands in My Edits and surfaces wherever My Edits participates: in **All Wordlists** (where My Edits sits on top by default, so your edit wins there) and when you scope to **My Edits** itself. A scoped wordlist always shows its *own* values, so editing an entry that XWI carries won't change the XWI-scoped view — the edit lives in My Edits, visible in All Wordlists and in My Edits' own view. (This is why a foreign scope opens the panel read-only: an in-place edit there would immediately vanish, so the panel doesn't offer one.) The provenance panel still shows your My Edits value alongside the others.

**Adding new entries.** A floating **＋** button in the bottom-right corner opens the entry editor in the center of the screen. If you've just searched for a plain word that no wordlist has, it starts with that word filled in (a wildcard search, or one that already matches something, opens blank). Type a score and an optional comment, press Enter, and the entry lands in My Edits. The ＋ only ever creates: if you type an entry that's already in My Edits, Save stays disabled and the editor says it already exists, with an **Edit it instead** link that opens the existing entry for editing. (An entry that exists only on another wordlist is fine to add — it gets its own copy in My Edits.)

## My Edits

A special wordlist created automatically on first boot. It's where your manual score and comment edits land; otherwise it behaves like any other wordlist. It can't be deleted, but — like any wordlist — it can be reordered or disabled. It starts on top and enabled, so your edits win in **All Wordlists**. Move it below another list (position sets merge priority on ties) or disable it and your edits still go into My Edits, but they stop winning there — or drop out of the merge entirely — until you move it back up or re-enable it.

Like any Source, My Edits carries a rescore-rules editor. The scores you type are stored **raw** and run through those rules on the way into the merged view. It starts with a **tier legend** — Grawlix's default tiers (great/good/fair/…) listed as blank-output rows that document the scale right next to where you type scores, remapping nothing, so the score you type is the score you see. Fill in an output only if you want a typed score remapped; whether your scores line up with the tiers is your call, not something Grawlix enforces. Delete the legend if you don't want it (Reset to defaults brings it back). Importing a personal list scored on a different scale clears the legend automatically and lays out that file's scores instead, so it never mislabels them.

Scope to My Edits and its wordlist bar lets you Import a personal wordlist, Download what you've got, or Clear it. Its **Download** follows your Output format like any source; **Download original** (in the split button's menu, alongside **Download rescored**, once it has rules) and its synced file stay as-is — spaces, accents, punctuation, and case preserved — since the synced file is the one your construction software edits in place. Its entries also reach letters-only software through **All Wordlists**, which honors your Output format. You can also sync My Edits to a file ([Disk sync](#disk-sync)).

## Score tiers

Defaults: **great** (≥60), **good** (≥50), **fair** (≥40), **meh** (≥30), **bad** (<30). Score badges color by tier. Hover any score badge — in the entries table, the entry panel, or the tier picker — to see its tier label. Customize the tier labels via **All Wordlists**' scoring rules (see *Rescoring and scoring rules*).

## The wordlist bar

When you've scoped to a wordlist, its actions sit on the right of the wordlist bar. The bar is calm by default — the selector on the left, a small adjustments cluster on the right — and the rest of the screen looks the same whatever you're scoped to.

**Actions differ by scope:**
- **A source** — a split **Download** button, a **Rescoring** button (opens the rescore-rules editor), and a slim **⋮** kebab with **Fetch/Import** and **Configure**. Configure is the existing dialog (rename, change icon, publisher binding, auto-update URL, import, rules) and holds a quiet red **Delete** link in its footer.
- **My Edits** — **Import** a personal wordlist, a **Rescoring** button, and a **⋮** kebab with **Clear**.
- **All Wordlists** — just **Download** (the merged product) and a **Scoring** button (the tier-label editor), no kebab.

On a narrow window the bar folds its buttons into the **⋮** menu to keep the wordlist name readable — **Download** moves in first, then **Rescoring** — so a phone shows a tidy menu instead of a crowded row. All Wordlists, with only two short controls, never needs to fold.

The **sync button** (a status pill once connected) sits at the right of the bar in every scope (see [Disk sync](#disk-sync)).

## Rescoring and scoring rules

The **adjustments (sliders) icon** beside the selector opens an inline editor that expands in place, pinned while the table scrolls beneath it. What it edits depends on your scope:

- On a **source** (or My Edits), it edits that wordlist's **rescore rules**.
- On **All Wordlists**, it edits the **scoring tiers** — the labels for the unified scale.

**The table is the live preview.** While the editor is open on a source, the rows below show a `350 → 80` arrow on any entry a rule remaps, updating as you type so you tune a rule and watch its effect immediately.

**Your edits are batched — Save to keep them.** Changes in the editor are staged: the table previews them live, but nothing is saved until you click **Save** (the editor closes then), and **Cancel** throws them away. This keeps editing snappy on big wordlists — the rescore runs once when you Save, not on every keystroke. Closing the editor with unsaved changes asks before discarding them.

**Rescoring rules** map an input score range — and an optional entry-length filter — to an output score; focus any of those fields for a syntax cheat sheet. Rules are checked **top to bottom and the first match wins**, so order matters when ranges overlap — a broad rule placed above a narrow one shadows it. You control the order: **drag any rule by its handle (`≡`) to reorder it** (tier labels reorder the same way), and rules never re-sort themselves. Each source and My Edits carries them; My Edits' typed scores are stored raw and run through its rules just like any source. Custom wordlists with up to 10 distinct scores get auto-seeded with one inert rule per score on first import, so you see the wordlist's scale laid out next to All Wordlists' — fill in output mappings, or leave them blank to pass the scores through.

Rescoring is entirely optional. If a wordlist's scores don't line up with Grawlix's scale and you don't care, leave the rules empty — the raw scores pass through and nothing warns you about it. You can ignore the score column entirely and still search, filter, and run every tool.

**Scoring rules** (the All Wordlists editor) are your tier labels for the merged scale ("60 = great, 50 = good, …"). They feed the hover tooltip on each score badge. Labeling is optional too — unlabeled scores still appear, just without a tier name in the tooltip.

Below the rules, the editor's footer holds the **Cancel** / **Save** buttons, with a few rarer actions as quiet links on the left:

- **Reset to defaults** appears once your rules differ from their shipped defaults — rescore on a publisher source or My Edits, scoring on All Wordlists. It confirms, then restores the defaults into the editor — you still Save to commit. Visible only when there's something to undo.
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

The header `?` button opens **Help** — an FAQ covering what Grawlix is, rescoring and merging, disk sync, and the tools, with a few small diagrams along the way. An **Acknowledgements** question credits the constructors whose wordlists Grawlix is built to combine, and Wordlisted, whose search catalog inspired the tools. Help is deep-linkable: opening it puts `#/help` in the URL, so `grawlix.wtf/#/help` opens straight to it.

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

**All-mode.** Click the `✱` on the right side of the Initialisms input to cluster every multi-word entry under its word-initial letters — so `the IRS`, `the irate Senator`, and `Tom Is Right` all land in `tis`. Only clusters whose initialism is itself an entry in the wordlist survive (e.g. `tis` shows up only if `TIS` is a row) — the point is bidirectional pairs, not every prefix coincidence. Each cluster row shows the initialism entry as a clickable badged atom (same shape as the chain atoms next to it), so you can adjust its score or comment without leaving the clustered view. The score range applies to the initialism too: drag the range narrower and clusters whose initialism entry falls outside the band drop alongside chains whose atoms do. Sort the clustered view by Initialism (alphabetical), Initialism length, Initialism score, or any of the standard cluster axes (Count, Min/Max score, Min/Max length). Single-word entries are skipped (a one-letter "initialism" cluster of every entry starting with a given letter is just a prefix search). Word boundaries are spaces only in this mode — the hyphen-optional branching the filter uses would split each entry across multiple clusters.
