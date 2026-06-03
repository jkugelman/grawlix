# Storage migration strategy

## Current state

`SCHEMA_VERSION` (in `site/index.html` near `IDB_NAME`) is bumped whenever the shape of stored data in `localStorage.meta` or IndexedDB changes. On load, `init()` compares it to the value in `localStorage.schemaVersion`; mismatch triggers a confirm dialog offering to reset all local data. Decline leaves the version alone, so the prompt returns on every load until the user resets.

This is intentionally destructive. Pre-launch, no user has data worth migrating, and the cost of writing migration code is higher than the cost of a wipe.

## When to switch to migrations

Trigger: **first user with data they'd be upset to lose** — typically someone with a custom-rescored wordlist, hand-edited entries, or a personalized rule set. Not "launch" in any abstract sense; the first painful data loss event.

Until that point, keep wiping. Each schema change is free.

## The post-trigger model

Migration is layered *on top of* the existing reset prompt, not in place of it:

1. On load, compare stored version to current.
2. If equal, proceed.
3. If migrate-able (stored version is recent enough), run `migrateVN→VN+1(meta)` functions in sequence. Stamp the new version. Proceed.
4. If migration fails or the stored version is too old, fall back to the existing reset prompt.

So the schema-mismatch + reset infrastructure is permanent. Migration code is the preferred path; reset is the floor.

## Cost of migrations

Per bump:
- Write a one-time `migrateVNtoVN+1(meta)` function.
- Test it. Buggy migrations *silently corrupt* data, which is worse than losing it.
- Keep it forever (until squashed — see below).

Bounded growth — the universal pattern is to delete migrations older than ~6–12 months and route those users through the reset prompt. Users who haven't opened the app in a year lose their data; that's a tradeoff every long-lived app makes.

Amortize: batch related schema changes into a single bump rather than one bump per tweak.

## The hidden cost

The moment you write your first migration, every field in `meta` becomes load-bearing. Renaming `originalFilename` to `sourceFilename` stops being a free refactor and becomes "write a migration." That discipline is good — it forces you to think before churning storage shapes — but it does slow you down.

Be especially conservative with the *shape* of nested objects (rescore rules, icon descriptors, scoring tiers). Adding a top-level field is cheap; restructuring a nested array is expensive.

## When the config diverges but the shape doesn't (unsolved)

`SCHEMA_VERSION` answers exactly one question: *can old code read this stored data?* That's about **shape**. There's a second, unrelated way persisted data goes stale that the version counter does not address and should not: a value in `WORDLIST_PUBLISHERS` changes while the shape of `meta` stays identical. Two concrete cases:

- **Updating a publisher setting** — e.g. giving a publisher a `url` it didn't have. This is real history: Will Nediger's list went from import-only to auto-fetched purely by setting `url`. Pre-launch we bumped `SCHEMA_VERSION` for it as a shortcut, since the wipe re-runs `defaultSources()` and re-seeds the new value for free — but that's an abuse of the counter, not a shape change.
- **Adding a new publisher wordlist** to the catalog.

Neither is a shape change. `url` is a field that already exists; a new publisher is purely additive. Old code reads the new data and new code reads the old data either way. So `SCHEMA_VERSION` is the wrong tool post-launch — bumping it forces the destructive reset prompt on every user (wiping curated wordlists, My Edits, and rules) just to push one setting or surface one new list. Wildly disproportionate.

The mechanics that make this its own problem:

- `defaultSources()` runs **only** on first boot (no stored `meta`). Returning users rebuild `state.sources` from `meta` via `wordlistFromMeta` — the publisher config's `url` / `name` / `icon` never re-seed them.
- `propagateDefaults()` is the *only* thing that pushes config changes into existing users' sources on each boot, and it covers **only `rescoreRules` and `state.scoring`**, only for non-dirty sources. It does not propagate `url` (or any other field), and it does not *add* publishers that aren't already present.

So a publisher-config change reaches existing users only if we explicitly reconcile it. Two directions, neither committed:

- **Reconcile in code** — extend `propagateDefaults()` (or a layered migration per above) to bring the changed field forward / inject the new source disabled-by-default. Non-destructive; not a `SCHEMA_VERSION` bump. `propagateDefaults()`'s existing rule propagation is the working template.
- **Socialize** — ship the config so new users get it; tell existing users to re-add or re-enable. Their stored data is untouched.

Wrinkles to weigh when we pick a direction:

- `url` has no `dirty` bit the way rules do. A user may have deliberately imported a file into a publisher-backed wordlist, which clears `url` (a wordlist is auto-fetch *or* file-based, not both) — naive propagation would clobber that choice.
- Setting `url` on an unpopulated source trips the boot auto-fetch (`filter(l => l.url && !l.populated)`), so the user gets an unprompted multi-MB download.
- Adding a wordlist is the safe end of the spectrum — purely additive, can't corrupt anything — so injecting new publishers disabled-by-default is low-risk if we choose to.

No solution yet; this is documented so future-us recognizes it as distinct from a schema bump rather than reaching for the version counter again.

## When you pick this up later

Regenerate the specifics fresh. Ask for: (1) the migration runner and its position in `init()`, (2) a template for `migrateVNtoVN+1`, and (3) the squash policy (which version cutoff drops to reset).

**Start documenting versions at the same moment.** Pre-launch the version number is just a wipe trigger and history doesn't matter, but once migrations exist you need to know what each version meant — both to write the right migrate function and to know when a version is old enough to drop. Add a comment block above `SCHEMA_VERSION` listing each bump with its date and what changed. Hypothetical shape (entries are illustrative, not the real history):

```js
// Schema version history:
//   v1: initial
//   v2 (YYYY-MM-DD): icons stored as descriptor objects instead of HTML
//   v3 (YYYY-MM-DD): sync target metadata added to per-wordlist config
const SCHEMA_VERSION = 3;
```

Don't encode the date *in* the version number (e.g. `20260505`) — comparison gets ugly, two bumps in one day collide, and you still need a comment table to record what changed.
