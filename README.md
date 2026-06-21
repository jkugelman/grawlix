# Grawlix

[![CI](https://github.com/jkugelman/grawlix/actions/workflows/ci.yml/badge.svg)](https://github.com/jkugelman/grawlix/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/website?url=https%3A%2F%2Fgrawlix.wtf&label=grawlix.wtf&up_message=online&down_message=offline)](https://grawlix.wtf)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[grawlix.wtf](https://grawlix.wtf)** — a browser-based wordlist manager for crossword constructors.

Popular wordlists each score on their own private scale, so combining them is a mess — a 50 means something different in every list. Grawlix rescores every list onto one common scale and merges them into a single deduped list you download (or sync to disk) and feed to your construction software.

It doubles as a word-finding playground: search the merged list and stack tools on it — anagrams, rhymes, beheadments, rebus forms, a couple dozen more — to mine for theme material or shake loose the one entry that fits a stubborn corner.

No account, no install, nothing to sign into. Your wordlists, edits, and settings live entirely in your browser, on your device — just visit the site and start. See [`docs/manual.md`](docs/manual.md) for the full user guide, or the in-app **?** for Help.

## Contributing

Grawlix is plain HTML/CSS/JS — ES modules under [`site/src/`](site/src/), no runtime dependencies and no framework. There's no build step in the dev loop: serve `site/` statically and refresh. Deploys bundle to `dist/` with `npm run build` (run by CI).

Start with [CLAUDE.md](CLAUDE.md) and [`docs/design.md`](docs/design.md) for the architecture (a strict `core < engine < data < model < ui < app` module layering) and coding conventions.

## Tests

Two tiers: a [`node:test`](tests/unit/) unit suite over the pure engine/data modules, and a [Playwright](tests/browser/) browser suite for user-visible behavior. `npm test` runs both against the bundled output; CI runs them on every push to `main`. See [`docs/testing.md`](docs/testing.md).

## Copyright

Copyright © John Kugelman
