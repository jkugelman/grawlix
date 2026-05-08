# Grawlix manual

Grawlix is a browser-based wordlist manager for crossword constructors. It rescores wordlists from different sources to a common scale, then merges them into a single unified view.

This is the user-facing manual. Eventually it'll be turned into an in-app manual; for now it's a Markdown file.

## The app shell

**Header.** Title, settings, help.

**Left rail.** Two labelled sections:
- **Wordlist** — the wordlist picker (dropdown), the wordlist settings button, and the sync indicator.
- **Tools** — the tool gallery.

**Main pane.** Stats bar plus the wordlist table. The table is always visible — idle and search views are the same view, just filtered.

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

## Inline editing

Click any score or comment cell — in any wordlist view — to edit it inline. Edits always land in My Edits, regardless of which wordlist is open.

When the value you see differs from what the wordlist itself contains (because it's been rescored, or another wordlist overrides it), a small red asterisk (`*`) marks the cell. Hover for an explanation: the original score for rescored entries, or the overriding wordlist's name for overrides.

## My Edits

A special wordlist created automatically on first boot. Its scores pass through unchanged (no rescoring). It's always enabled and can't be deleted, but can be reordered like any other wordlist (position determines merge priority on ties).

From the My Edits view you can:
- Add new words.
- Delete entries (with undo).
- Edit any score or comment.

My Edits also carries your **scoring rules** — your tier labels for the unified score scale (e.g. "60 = great, 50 = good, …"). Every wordlist view shows them as a read-only legend above the table; the canonical edit surface is My Edits in the Wordlists dialog.

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

## Sync & backup

Opened from the sync indicator below the wordlist dropdown. Today this is a stub — the dialog opens with placeholder text. The indicator is hidden until there's a backup to report.

Two paths to "give me a file":
- Backing up **All** or **My Edits** → Sync & backup dialog.
- Exporting an **individual wordlist** → that wordlist's Download button in the Wordlists dialog.

## Help

Reachable from the header `?` button or the `?` keyboard shortcut. First-run users see it auto-opened.

## Sharing & links

Your search pattern, whole-word toggle, and score filter are reflected in the URL. Refreshing the page keeps your state. Pasting the URL into a chat or saving it as a bookmark reproduces what you were looking at.

The link carries your search and filters, not your wordlists — the recipient sees their own default selection (`All`) over their own loaded wordlists.

## Wordlist file format

One entry per line:

```
WORD;SCORE
WORD;SCORE;COMMENT
```
