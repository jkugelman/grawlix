# Flaky-test ledger

Playwright tests that fail intermittently — almost always **webkit**, only under load (a full `npm test` or single-worker `CI=1` run), rarely reproducible on a plain re-run. This file is the durable record; add to it with the `/test-failure` skill when a transient failure shows up — capture the evidence *before* it's overwritten (see Gotchas).

Lines here are unwrapped (per `docs/style.md`).

**No tests are currently flaking** — full suite green as of 2026-06-04 (webkit / chromium / firefox 259 each, 0 flaky). Past flakes and their fixes (a webkit boot-vs-test race in `gotoApp`, plus reload/read-timing fixes) are in this file's git log.

## Failure tally

One row per currently-flaking test, by count. "Seen" = distinct runs it has failed in. Identify by spec + title — **line numbers drift**, counts don't. `wk`/`ch`/`ff` = webkit/chromium/firefox.

| Seen | Spec — test | Browsers | Last seen | Cause / status |
|------|-------------|----------|-----------|----------------|

## Run log

One row per `npm test` (or `--project=webkit`) run that produced failures.

| Date | Command | Result | Tree state | Failures |
|------|---------|--------|------------|----------|

## Gotchas

- **`test-results/` is wiped at the start of *every* `playwright test` run** — capture `test-results/<dir>/error-context.md` (error + page snapshot, usually more precise than `test-failed-1.png`) *before* running anything else. `/test-failure` automates this.
- Local config runs `retries: 0` (a flake is a hard failure locally); CI uses `retries: 2` (the same flake is reported "flaky" but stays green).
- A changing failure set between runs is flakiness, not a regression.
- Reproduce a load race with `CI=1 npx playwright test --project=webkit` (single-worker + retries=2, the shard's exact config); a single-file run usually won't fail.

## Maintaining this file

Run `/test-failure` after a transient failure: it captures `test-results/` into the tally + run log above, and optionally debugs. `/test-failure debug` documents *and* investigates; bare `/test-failure` only documents (when you don't want to interrupt other work).
