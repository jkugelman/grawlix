# CI testing

## Recommendation

Automated testing here is a "why not" at best, not a clear win. A small Playwright smoke suite on push to `main` is cheap to set up and gives a passive regression signal, but the upside is modest: the app is small, solo-developed, and the eyeball-and-push flow already catches most things. Visual QA stays manual either way. Defer until closer to launch.

## What's worth automating

**Smoke tests, maybe.** End-to-end tests catch the bugs that matter for a single-file vanilla-JS app: subtle cross-feature breakage like "editing a score while a filter is active corrupts the override map." A handful of tests on the catastrophic paths gets ~80% of the value for ~20% of the cost. Run on push, not PR — for a solo pre-launch project, CI is a passive monitor, not a gate.

**Cross-browser is one config line.** Playwright supports Chromium, WebKit, and Firefox out of the box. Flipping all three on triples runtime (~30s → ~90s) and gives a free signal if a Chrome-only API ever sneaks in. Cheap enough to just do.

## What stays manual

**Visual / layout bugs.** Screenshot diffing (compare each test's rendered PNG against a saved baseline) catches "the icon moved 5px" bugs but is brittle: antialiasing noise, constant baseline updates on every UI tweak, cross-browser font rendering differences. Not worth the maintenance burden for a solo project. Pre-release: open the site on Safari, Firefox, and a phone. That's the substitute.

**Real mobile Safari.** Playwright's WebKit is a Linux build that approximates Safari but isn't it. iOS-specific bugs only surface on actual devices.

## Out of scope

Unit tests (no meaningful seams — logic is wired to DOM and persistence), coverage metrics, PR gating, branch protection.

## Maintenance posture

A smoke suite is allowed to shrink. Delete tests that have become more trouble than they're worth. When a test breaks from an intentional feature change, update it in the same commit. Don't paper over flakiness with `waitForTimeout` — fix it with `expect.poll` or explicit waits.

## When to do this

Trigger: **first real user** or **public announcement**, whichever comes first. Until then, a regression costs "John notices on next eyeball pass." After, it costs "a user hits a broken site."

## When you pick this up later

Regenerate the specifics fresh — the test list and `data-testid` attributes will depend on the app then, not now. Ask for: (1) smoke tests ordered by "catches the worst breakage first", (2) the minimum `data-testid` attributes to add, and (3) a setup checklist (Playwright config, GitHub Actions workflow, `.gitignore`).
