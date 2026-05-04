# Grawlix

**[grawlix.wtf](https://grawlix.wtf)** — a browser-based wordlist manager for crossword constructors.

## The problem

Popular crossword wordlists each use their own scoring scale. John Kugelman scores on 0–60, XWord Info on 5–60, Spread the Word(list) on 0–50, Peter Broda on 0–100. Combining them into a single list is a mess — the numbers mean different things across sources.

## What Grawlix does

Grawlix lets you pull in wordlists from multiple sources, normalize their scores with **rescore rules**, and merge everything into a single unified list you can load into your construction software (Ingrid, Crossfire, etc.).

It also doubles as a search tool while you're constructing: filter by substring, pattern, score, and more to quickly find the best word for a tricky slot.

## Features

**Known publishers** for four popular wordlists — one-click setup with sensible default rescore rules:
- [John Kugelman](https://github.com/jkugelman/crossword)
- [XWord Info](https://www.xwordinfo.com/WordList)
- [Spread the Word(list)](https://www.spreadthewordlist.com)
- [Peter Broda](https://peterbroda.me/crosswords/wordlist/)

**Rescore rules** map a source list's score range to your preferred output scale, so your merged list has consistent scoring regardless of where each entry came from.

**Priority merging** — lists merge in the order you arrange them. Drag to reorder. The highest-priority list's score wins when the same word appears in multiple lists.

**My Edits** — your personal override layer. Click any score or comment to change it. Add words that don't appear in any source list. Your changes are never overwritten when a list updates.

**Search** — wildcard patterns (`?`, `*`, `#` for consonant, `@` for vowel, `[abc]` for character class), minimum score filter, whole-word toggle, and highlighted matches.

**Download** — export your merged list in standard `WORD;SCORE` format, ready to import into any construction software that accepts a text wordlist.

## Getting started

Just visit **[grawlix.wtf](https://grawlix.wtf)**. No account, no install. All data stays in your browser (localStorage + IndexedDB).

To add a wordlist from a known publisher: click **Add list** and pick from the built-in options. To use your own file: click **Add list → Import file**.

## Contributing

All code lives in a single file: [`docs/index.html`](docs/index.html). No build step, no npm, no frameworks — plain HTML/CSS/JS that runs directly in the browser. Open it locally in any browser and you're developing.

See [CLAUDE.md](CLAUDE.md) for architecture notes and coding conventions.
