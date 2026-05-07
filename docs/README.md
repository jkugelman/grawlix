# Grawlix docs

- **Top level** — the index plus reference catalogues that don't fit elsewhere.
- **[`designs/`](designs/)** — present-tense documentation of what's implemented. When a plan ships, the `distill-design-doc` skill rewrites it as a feature record and moves it here.
- **[`plans/`](plans/)** — forward-looking design docs for work that hasn't shipped. Speculative, future-tense.

## Top level

- [wordlisted.md](wordlisted.md) — reference catalogue of Wordlisted's search modes. External-system documentation rather than a Grawlix feature record; lives here as the source material for the tool gallery roadmap.

## Designs

- [designs/app.md](designs/app.md) — top-level UI shape: header, left rail with source picker and tool-gallery slot, main pane, Manage sources dialog (full), Sync & backup dialog (stub).

## Plans

- [plans/tools.md](plans/tools.md) — the tool stack mechanism, the gallery panel, Wordlisted-parity and Grawlix-original tools, OneLook/Datamuse/Umiaq integration notes.
- [plans/url-routing.md](plans/url-routing.md) — query-string serialization of the tool stack and result-view filters; alias/rename policy for stable links.
- [plans/sync.md](plans/sync.md) — three-tier persistence for the merged `All` view + My Edits (backup nag, disk file link, cloud sync). Sync & backup dialog.
- [plans/mobile.md](plans/mobile.md) — mobile/responsive design. Mostly open questions; covers what's settled and defers the rest to its own design session.
- [plans/lookup.md](plans/lookup.md) — click-a-word lookup features (definitions, Wikipedia, NYT history, semantic search). Near-term value for users on grid software without built-in lookup.
- [plans/help.md](plans/help.md) — separate the welcome tour from a returning-user reference manual; tour rework when the tool gallery lands.
- [plans/migration.md](plans/migration.md) — when to graduate from destructive schema-version resets to layered migrations.
- [plans/ci-testing.md](plans/ci-testing.md) — small Playwright smoke suite, deferred until first real user.
