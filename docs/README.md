# Design docs

Forward-looking design docs for Grawlix. Each plan describes where its area is going; current code is still the product as it exists today.

- [app.md](app.md) — top-level UI shape: header, source picker, main pane, Manage sources and Sync & backup dialogs. Restructure phasing.
- [tools.md](tools.md) — tool gallery (anagram, regex, beheadments…) and the broader mining roadmap. Wordlisted parity, Grawlix originals, future integrations.
- [sync.md](sync.md) — three-tier persistence for Master List + My Edits (backup nag, disk file link, cloud sync). Sync & backup dialog.
- [url-routing.md](url-routing.md) — hash-based deep linking. What's URL-addressable and what isn't.
- [help.md](help.md) — split the help modal into a welcome tour and a separate reference manual.
- [migration.md](migration.md) — when to graduate from destructive schema-version resets to layered migrations.
- [ci-testing.md](ci-testing.md) — small Playwright smoke suite, deferred until first real user.
- [wordlisted.md](wordlisted.md) — reference catalogue of Wordlisted's search modes; implementation guide for the tool gallery.
