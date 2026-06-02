---
name: test-failure
description: Record (and optionally debug) a transient Playwright test failure. Use right after a flaky `npm test` / `npx playwright test` run leaves failures in `test-results/` — it captures the evidence before it's overwritten and logs it into `tests/flaky.md` (failure tally + run log). Bare `/test-failure` only documents (non-interrupting); `/test-failure debug` documents then investigates. Trigger when the user hits a transient/flaky failure, wants to log a test failure, or types `/test-failure`.
---

# Record a transient test failure

The Playwright suite has a known population of load-sensitive flakes (almost all webkit). `tests/flaky.md` is the durable record of them. This skill turns a one-off failure into a logged data point — and, on request, into a debugging session.

**The hazard this exists for:** `test-results/` is wiped at the *start* of every `playwright test` run, even a targeted one. So the evidence from the user's run is live *now* and will be gone the moment any test command runs. **Capture before you run anything.**

## Mode: document-only vs debug

Decide from the invocation:
- Args contain `debug` / `investigate` / `fix` → do **Capture + Log + Debug**.
- Anything else (bare `/test-failure`, `doc`, `document`) → do **Capture + Log**, then stop and mention `/test-failure debug` is available. The user often runs this mid-task and does *not* want a debugging detour — respect that; don't start investigating unless asked.

## Step 1 — Capture (always first, before any test command)

1. Read `test-results/.last-run.json` → `status` and the `failedTests` id list. If `status` isn't `failed` (or the dir is empty), there's nothing to capture; say so and stop.
2. For each `test-results/<munged-dir>/error-context.md`, extract:
   - the test **name + location** (`# Test info`),
   - the **error** (`# Error details` — expected vs received / the failing locator),
   - the **telling snapshot lines** — what actually rendered (the tool-stack rows, the `#vs-host` entries, a stray badge). For "wrong output" failures the received-vs-expected diff is the key signal (e.g. one extra entry vs. the whole fixture).
3. Note which **browser** each failure is on (the dir name ends in `-webkit` / `-chromium` / `-firefox`) and how many failed.

Do **not** run `npm test`, `npx playwright test`, or anything that wipes `test-results/` before this step is done.

## Step 2 — Log into `tests/flaky.md`

Read `tests/flaky.md` first, then update it (lines unwrapped, per `docs/style.md`):

- **Failure tally:** for each failing test, find its row by spec + title (line numbers drift, so match on the title, not the location). If present, increment `Seen`, refresh `Last seen` (today's date) and `Browsers`. If new, add a row with `Seen` = 1. Keep the table sorted by `Seen` descending. Set `Cause / status` to the matching known cause (#1/#2/#3) if the symptom fits, else `open` with a one-clause guess.
- **Run log:** append a row — date, command, result (`N passed, M failed` if you have the summary line; else `M failed`), tree state (what fixes are applied / the short commit), and the list of failing tests.
- If a failure is genuinely new or behaves differently from what a cause section describes, add a sentence to the relevant **Known causes** entry (or open a new one). Don't restate what the tally already says.

Today's date is in the environment context. Don't invent counts — only bump what this run actually showed.

## Step 3 — Debug (only in debug mode)

1. **Check the known causes first** (`tests/flaky.md` → Known causes). A new failure is most often another face of an existing cause.
2. Form a hypothesis from the captured evidence: read the failing **spec** (setup + the assertion) and the relevant **`site/index.html`** region (banner comments `// ─── … ───` locate sections). Trace the async ordering — these flakes are races (pipeline single-flight, the reactive `effect`/`cacheVersion$` render path, shared caches like `_preSearchCache` / `_mergedWordlistCache`, fire-and-forget fetches).
3. **Be honest about confidence.** Don't apply a fix on a hunch and declare victory — that already happened once (the reverted `_preSearchCache` guard). If you can't trace a concrete mechanism, say so and record the lead in the cause section instead of guessing in code.
4. If a fix is clear and low-risk:
   - Apply it. If it touches `site/index.html` JS, syntax-check: `node ~/.claude/scripts/check-syntax.js site/index.html`.
   - Verify **no regression** on chromium (fast): `npx playwright test <spec> --project=chromium`.
   - State plainly that a webkit-under-load flake **cannot be proven fixed from one green run** — the post-condition is now correct, but confidence comes from repeated `--project=webkit` runs over time. Update the tally's `Cause / status` to reflect "fixed (pending confirmation)" rather than "fixed".
5. Never `git commit` unless asked. Propose a conventional-commit message in chat.

## Output

Report: how many failures were logged and on which browser; which tally rows were bumped vs added; and — if you debugged — the hypothesis, what you changed (or why you didn't), and how it was (partially) verified.
