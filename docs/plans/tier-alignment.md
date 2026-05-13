# Rescore rules & tier alignment

## What this is

Grawlix today: each source has `rescoreRules` mapping its raw scores into a unified scale; the unified scale's tier labels live on My Edits' `scoring` field. My Edits is a special case — no rescore rules, raw scores pass through as the unified scale.

This design rethinks the lifecycle of those structures around a single principle: **the unified scale is a declared contract** (the tier labels on All), and any deviation from that contract — input scores not covered by a wordlist's rescore rules, output scores not covered by All's tier labels — surfaces uniformly as a warning the user can act on.

The pieces that change:

- Tier labels move from My Edits to All. My Edits gains rescore rules like any other wordlist; its only remaining distinction is "this is where the user's manual score/comment edits land."
- The catch-all row (already auto-populated when scores aren't covered) becomes the load-bearing misalignment signal, surfaced as a `warning`-severity bubble.
- Custom wordlists get auto-seeded inert rescore rules on first populate so the user can see the source's score scale.
- Dev-pushed updates to `defaultRules` propagate silently to pristine users via a per-wordlist `dirty` flag.
- The existing green update-dot generalizes into a reusable severity-keyed bubble primitive.
- The catch-all row in the rescore rules editor splits into an informational banner ("Unhandled scores: …") plus a plain `+ Add rule` affordance.

---

## (B) architecture: tier labels move to All

My Edits stops being special-cased for scoring. Specifically:

- Tier labels (the `scoring` field) move from My Edits onto All.
- My Edits gains a `rescoreRules` field (previously absent).
- My Edits' only remaining distinction is that the user's manual score/comment edits land there.

Why move tier labels off My Edits. Once My Edits has rescore rules, it stops being the canonical owner of "what scores are valid in the unified scale" — that concept naturally belongs to the merged output, which is All. Putting tier labels there:

- Eliminates the structural awkwardness where the merged view's scale is borrowed from one source.
- Makes the catch-all-as-misalignment-signal pattern apply symmetrically (rescore catch-all on sources, scoring catch-all on All).
- Lets a user customize their unified scale without it living on a "wordlist" data field.

This is partly a return to an earlier shape — pre-v4 Grawlix kept tier labels on the merged view before consolidating them onto My Edits (commit "v4 — drop state.outputScoring; tier labels live exclusively on My Edits' scoring"). The new wrinkle is My Edits gaining rescore rules; that wasn't part of the earlier design.

Schema bump per [migration.md](migration.md) — `SCHEMA_VERSION` increments, existing users get the reset prompt; no migration code pre-launch.

---

## Auto-seeding rescore rules on import

When a custom wordlist (no `publisherId`) is fetched or imported, and:

- Its `rescoreRules` is empty (modulo any auto-appended catch-all), and
- It contains ≤10 distinct scores,

→ auto-seed one inert row per distinct score: `{ input: String(s), length: '', output: '', note: '' }`. Visible but inert: outputs are blank so scores pass through unchanged, and the user can fill in mappings if they want.

Why. Discoverability — the user sees the source's score scale laid out as concrete rows next to All's tier scale, which is itself a visual hint that translation is on offer. Identity mappings (e.g. `60 → 60`) aren't seeded because that would assert the source uses the unified scale, which is the wrong claim for an unknown source.

Not seeded for known publishers (their `defaultRules` cover the translation correctly) or wordlists that already have user rules.

My Edits does *not* auto-seed in the same way, because it ships with default rescore rules — see next section.

---

## My Edits' default rules

My Edits ships with default rescore rules mirroring All's tier scale: one inert row per `state.scoring` tier, carrying that tier's score and note. Inert (blank output) because My Edits' scores are already in the unified scale — the rules just declare "these scores are recognized."

Why. Without default rules, the first edit to any score in My Edits produces a `_catchAll` row (since no rule covers the raw score) and an immediate warning bubble. That's hostile onboarding — the user makes one legitimate edit and gets flagged. Mirroring All's tiers means a fresh-install edit to any tier-covered score lands on an existing rule and produces no warning.

Why All's tiers and not, say, JK's: My Edits is the user's own data, and the unified scale is the user's chosen contract for what scores mean. Tying My Edits' defaults to that contract (rather than to one particular publisher's `defaultRules`) keeps the two in lockstep — if the user adds a tier on All for score `45`, My Edits' defaults gain a `45` row too, so a future `45` edit doesn't trip a warning.

The defaults are **inert**, so they don't transform anything — they just provide tier semantics for recognized values. A user importing data with foreign scores into My Edits sees those scores in the catch-all row (warning bubble), and can either rescore them into the tier scale, add tier labels on All for the foreign scores, or replace the rules entirely. Surfacing, not imposing.

Auto-seed on import doesn't fire for My Edits in practice (its rules aren't empty), but the condition is the same as for any wordlist; the catch-all warning is the appropriate signal for "you imported data outside the recognized scale."

Dirty-flag mechanics apply normally — My Edits has a `dirty` flag tracked against its defaults (current `getMyEditsDefaultRules()` output); the per-ruleset reset button appears in its rules editor when `dirty == true`.

---

## Catch-all as the misalignment signal

`updateCatchAll(wordlist)` already auto-appends a `_catchAll` row to a wordlist's `rescoreRules` whenever raw scores aren't covered by user rules; `updateScoringCatchAll(scoring, entries)` does the same for tier labels against the merged output. Under this design, **the presence of either catch-all is the misalignment signal**.

Two layers:

- Source wordlist (or My Edits) with a rescore catch-all: "there are raw scores in this data you haven't ruled on" — input-side.
- All with a scoring catch-all: "there are merged output scores you haven't labeled" — output-side. Source rules that output a score not in All's tier scale show up here, because the merged view ends up with that uncovered score.

Both layers surface the same way: a `warning`-severity bubble on the affected wordlist's card.

Alignment check is trivial: `wordlist.rescoreRules.some(r => r._catchAll)` for sources, `all.scoring.some(r => r._catchAll)` for All. No output-vs-tier simulation needed.

Pure state indicator — no acknowledgment / dismiss path. Resolution is structural:

- Rescore: fill in rules covering the uncovered scores.
- Expand the tier scale: add tier labels covering the foreign scores on All.

Either path makes the catch-all empty and the bubble clears. A user who deliberately wants raw foreign scores in the merged view (e.g. raw XWI scores) takes the second path — adds tier labels for those scores on All.

---

## Default-rule propagation

When the dev ships an update to `defaultRules` on a publisher (or to `DEFAULT_SCORING` for All), pristine users — those who haven't customized the rules — silently pick up the new defaults on next boot. Users who have customized keep their customizations untouched.

Mechanism: a **`dirty` flag** per publisher-bound wordlist (and on All).

- Persisted boolean. Initially false at seed time.
- Flips true on any rule edit.
- Flips back to false if a later edit lands the rules on the current defaults exactly (user reverts customizations, or customizations happen to match a newly-shipped default).

Boot logic:

1. Compare persisted rules to current in-code defaults.
2. Match → no-op.
3. Differ + `!dirty` → silent auto-propagation: overwrite user's rules with current defaults. `dirty` stays false; user is now on the new defaults.
4. Differ + `dirty` → leave alone.

No rules versioning needed — the diff itself is the signal, and `dirty` does the disambiguation that versioning would otherwise do.

**Propagation is silent. No toast.** Rule updates only ever *add* coverage (e.g. a publisher adds a new score tier); they never re-grade existing entries. There's no user-visible change to explain, so a toast would be noise. The cleared misalignment bubble is its own subtle confirmation.

### Reset affordance

In the rescore rules editor, when `dirty == true`, a **"Reset to current defaults"** button replaces all rules with current defaults and flips `dirty` back to false. Visible only when there are customizations to undo, only inside the editor. Pristine users never see it.

This answers the historical concern that retired the old reset button: the previous version appeared anywhere rules differed from defaults, which felt nudgy. This version is scoped to a place the user only visits intentionally, and only when there are customizations to undo.

No per-rule revert. The editor itself is the granular tool — a user wanting to revert one rule can manually retype its value.

---

## UI surfaces

### Bubble system (reusable primitive)

The existing green update-dot generalizes into a severity-keyed bubble system.

Severity levels:

- `info` (green) — currently used for "update available."
- `warning` (orange) — used for catch-all presence / misalignment.
- Future severities available as needed.

Placement matches today's green dot — on the wordlist card next to the Update/Fetch button, propagating one level up to the Library nav tab in the top header.

Priority: higher severity wins at every propagation level — `warning > info`.

API shape: the primitive takes a severity, renders the appropriate color, resolves priority. Causes (update available, catch-all presence) map to severities; the bubble primitive only knows about severity.

### Notification banner in the rules editor

The catch-all row in the rescore rules editor splits into two pieces:

1. **A `warning`-styled banner** above the rules list, listing the uncovered scores:

   > ⚠️ Unhandled scores: 25, 75

   Bare minimum copy. Purely informational — clicking it does nothing. The orange severity bubble originates here and propagates up.

2. **A separate `+ Add rule` affordance** for creating new rules from scratch.

Why split. Today's catch-all row does two jobs (telling you about unhandled scores *and* letting you author a new rule by editing the row); users find this confusing, and the row's blending-in styling is the source of the confusion. Splitting also fixes a latent issue where today's catch-all renders non-contiguous uncovered scores like `{25, 75}` as the over-broad range `25-75`, silently encouraging users to author a single over-broad rule.

No "convert these to a rule" action on the banner. For non-contiguous scores any pre-fill is over-broad; for contiguous scores (e.g. `45, 46, 47, 48, 49`) there's no single right answer (one rule covering 45-49, five individual rules, or widening an existing 50 rule to 45-50). Any pick is a guess.

The same banner appears in the scoring editor on All when All has a `_catchAll` on its scoring — "Unhandled scores" listing the merged output scores not covered by any tier label.

### Reset button placement

Already covered above — inside the rescore rules editor, when `dirty == true`. Scoped to the editor, not surfaced elsewhere.

---

## Out of scope / alternatives considered

**Per-rule revert.** Surgical revert of individual rules via an icon next to each customized rule. Rejected for simpler UI and to avoid a rule-matching algorithm. The editor itself is the granular tool — manual retype covers it.

**Toast on auto-propagation.** Considered for transparency. Rejected because rule updates never re-grade existing entries (only cover new ones), so there's nothing for the user to mentally reconcile.

**Auto-suggested rescore mapping on misaligned import.** Considered ("your 100 → my 60, your 75 → my 50, …"). Rejected: low confidence guesses would be right.

**One-shot wizard for rescoring during import.** Considered. Rejected — speed bump UX, forces users to think about rescoring before they understand it.

**Seed-fingerprint persisted snapshot instead of dirty flag.** Considered. Functionally equivalent. Dirty flag has a small per-save recompute cost; fingerprint has none. Dirty flag chosen as the simpler mental model.

**Code-side history of past `defaultRules` per publisher.** Considered. Same outcome as dirty flag but heavier (code accumulates history over time).

**Tier labels staying on My Edits.** Considered (current shape). Rejected once (B) was chosen — once My Edits gains rescore rules, it's no longer the canonical owner of the unified scale.

**Acknowledgment / dismiss path on the misalignment bubble.** Considered. Rejected in favor of pure state indicator; the right resolution path for a user with deliberate misalignment is to expand the tier scale, which clears the bubble naturally.

**A per-wordlist misalignment summary based on output-vs-tier-scale.** Considered — checking whether each wordlist's rescored outputs fit All's tier scale, and flagging the wordlist directly. Rejected in favor of the catch-all-on-All approach. The output-side concern naturally belongs at All (where it's actually decided), and the catch-all-as-signal framing produces a trivial alignment check (`some(r => r._catchAll)`).
