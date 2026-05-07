# Grawlix docs

This directory holds two kinds of documentation:

- **Reference material at the top level** — descriptions of features as they exist, plus standalone reference catalogues. Stable and present-tense.
- **Forward-looking plans in [`plans/`](plans/)** — design docs for work that hasn't shipped yet. Speculative and future-tense. Once a plan ships, it gets rewritten as a feature record and moved up to the top level.

## Reference

- [wordlisted.md](wordlisted.md) — reference catalogue of Wordlisted's search modes; implementation guide for the tool gallery.

## Plans

- [plans/app.md](plans/app.md) — top-level UI shape: header, source picker, main pane, Manage sources and Sync & backup dialogs. Restructure phasing.
- [plans/tools.md](plans/tools.md) — row-stack tool composition, the gallery (anagram, regex, beheadments…), and the broader mining roadmap. Wordlisted parity, Grawlix originals, future integrations.
- [plans/mobile.md](plans/mobile.md) — mobile/responsive design. Mostly open questions; covers what's settled and defers the rest to its own design session.
- [plans/lookup.md](plans/lookup.md) — click-a-word lookup features (definitions, Wikipedia, NYT history, semantic search). Mostly open questions; near-term value for users on grid software without built-in lookup.
- [plans/sync.md](plans/sync.md) — three-tier persistence for the merged `All` view + My Edits (backup nag, disk file link, cloud sync). Sync & backup dialog.
- [plans/url-routing.md](plans/url-routing.md) — query-string linking for the tool stack.
- [plans/help.md](plans/help.md) — split the help modal into a welcome tour and a separate reference manual.
- [plans/migration.md](plans/migration.md) — when to graduate from destructive schema-version resets to layered migrations.
- [plans/ci-testing.md](plans/ci-testing.md) — small Playwright smoke suite, deferred until first real user.
