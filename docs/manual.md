# Grawlix manual

Grawlix is a browser-based wordlist manager for crossword constructors. It rescores wordlists from different sources to a common scale, then merges them into a single unified view.

This is the user-facing manual. Eventually it'll be turned into an in-app manual; for now it's a Markdown file.

## The app shell

**Header.** Title, settings, help. Sticks at top while you scroll.

**Centered card.** Below the header, the rest of the app sits in a centered card with side margins. The page itself scrolls — there's only one scrollbar.

The card, top to bottom:
- **Slim top row.** Wordlist picker, with the ⚙ button to its right that opens the Wordlists dialog.
- **Tool gallery.** Cards laid out as a responsive grid.
- **Sticky region** that anchors just below the header as you scroll into the word list:
  - Stats bar with histogram (click the histogram to filter by score range).
  - Tool stack — only when you've added tools.
  - Search bar.
- **Word list.** Always visible — idle and search views are the same view, just filtered.

## Choosing a wordlist

The wordlist dropdown sits at the top of the left rail.

- The first entry is **All** — the merged result of every enabled wordlist with rescore rules applied.
- Below it: every individual wordlist in the order shown in the Wordlists dialog. My Edits sits at the top (created automatically on first boot).
- Keyboard: **Alt+L** opens the dropdown and focuses the current selection.

The icon button to the right of the dropdown opens the **Wordlists** dialog (see below).

On launch — including first run — you land on **All**. The four publisher wordlists fetch automatically in the background, so you can start searching immediately without thinking about wordlist management.

## Search syntax

- `?` — any letter
- `#` — consonant
- `@` — vowel
- `*` — any substring
- `[abc]` — character class
- Whole-word toggle anchors the pattern.

## Word list

The list below the search bar shows every word in the current wordlist (or merged `All` view), one row per entry, in your current sort order. Each row reads as `1. CARE 4 50` — count, word, length, score badge. Click on a word or score to edit it (see *Editing words*).

**Sort.** "Sort by [Word ▾] [↑]" at the right edge of the search bar. Axes: Word (alphabetical), Length, Score. Click the arrow to toggle direction. Default is Word ascending.

## Editing words

Click any word or score in the list to open an editor popover. The popover shows which wordlist sourced the score (with any rescoring or override explanation) and lets you edit the score and comment. Edits always land in My Edits, regardless of which wordlist is open.

Press Enter to save and close, or Tab to chain edits between score and comment. Escape reverts. Clicking outside, scrolling, or changing the search closes the popover.

When the score you see differs from what the wordlist itself contains (because it's been rescored, or another wordlist overrides it), a small red asterisk (`*`) marks the badge. The popover spells out exactly what's going on.

For words sourced from My Edits, the popover also has a Delete button (with undo via toast).

## My Edits

A special wordlist created automatically on first boot. Its scores pass through unchanged (no rescoring). It's always enabled and can't be deleted, but can be reordered like any other wordlist (position determines merge priority on ties).

From the My Edits view you can:
- Add new words.
- Delete entries (with undo).
- Edit any score or comment.

My Edits also carries your **scoring rules** — your tier labels for the unified score scale (e.g. "60 = great, 50 = good, …"). Hover any score in the word list to see its tier label; the canonical edit surface is My Edits in the Wordlists dialog.

## Score tiers

Defaults: **great** (≥60), **good** (≥50), **fair** (≥40), **meh** (≥30), **bad** (<30). Score badges color by tier. Customize tier labels via My Edits' scoring rules.

## Score histogram

The stats bar shows a histogram of the wordlist's scores. Click on it to filter the table to a score range.

## Wordlists

Two-pane dialog opened from the wordlist settings button (the icon to the right of the wordlist dropdown).

**Left rail** lists every wordlist with a drag handle (reorder = merge priority), an enable checkbox, and the wordlist's name. New wordlists are added via the **+ Add wordlist…** entry at the bottom.

**Right pane** is the action row, the stats bar with histogram, and the rule editor.

Action buttons differ per wordlist:
- **Regular wordlists** — Update/Fetch primary action, Download split (rescored or original), and a ⋮ menu with Configure wordlist / Delete wordlist.
- **My Edits** — Import (primary when empty, plain when populated), Download (primary when populated, hidden when empty), and a ⋮ menu with Clear (when populated).

**Renaming.** Focus a wordlist card and press **F2** to rename inline.

**Rescoring rules** map a wordlist's input score range (and optional word-length filter) to an output score — or `ignore` to drop the entry. First matching rule wins; a catch-all is auto-appended. My Edits has no rescore rules; its scores pass through.

**Onboarding banner.** First-run users see a short 3-page sequence in the Wordlists dialog's rail: a welcome confirming the pre-loaded popular wordlists, then optional prompts to import a personal wordlist into My Edits and to import an XWI subscriber file. Each prompt has a *Skip*; the ✕ ends the whole flow.

## Help

Reachable from the header `?` button or the `?` keyboard shortcut. First-run users see it auto-opened.

## Sharing & links

Your tool stack — every tool you've added and its inputs, in pipeline order — plus the search pattern, whole-word toggle, and score filter all ride along in the URL. Refreshing the page keeps your state, and pasting the URL into a chat or saving it as a bookmark reproduces what you were looking at.

The link carries your tools and filters, not your wordlists — the recipient sees their own default selection (`All`) over their own loaded wordlists.

## Wordlist file format

One entry per line:

```
WORD;SCORE
WORD;SCORE;COMMENT
```
