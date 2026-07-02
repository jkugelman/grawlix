# Storage migration strategy

## Policy

Grawlix is live with real users, so **stored data is migrated forward on every schema change — never wiped.** When you change the shape of anything in localStorage (the `meta` blob or a standalone key) or an IndexedDB record, bump `SCHEMA_VERSION` (in `site/src/data/migrations.js`) *and* register a `MIGRATIONS[v]` entry — an `ls` step (localStorage) and/or an `idb` step (IDB records) — that upgrades existing data in place. A bump with no migration is a bug.

This reverses the pre-beta policy, under which a bump just triggered a confirm dialog offering to wipe all local data. That was the right call when no user had data worth keeping and writing migration code cost more than a wipe. The trigger we always named for flipping it — *the first user with data they'd be upset to lose* (a custom-rescored wordlist, hand-edited entries, a personalized rule set) — has fired. Beta testers have that data now.

The reset prompt stays, but only as a last-resort *floor* — see below.

## How it works

`SCHEMA_VERSION` is compared on load against the stored version — `localStorage.schemaVersion`. There's one version-keyed table, `MIGRATIONS`, each entry holding an optional `ls` step and/or `idb` step. The table is walked in **two phases** at different boot points: the **localStorage phase** (`MIGRATIONS[v].ls`, synchronous, before `openDB`) walks localStorage forward — reshaping the settings blob, renaming standalone keys, or both — and the **IDB phase** (`MIGRATIONS[v].idb`, async, after `openDB`) rewrites IndexedDB records. The two run at different times because an `idb` step needs the open `_db`, while the `ls` step runs early enough to gate the reset prompt. A given version may register `ls`, `idb`, or both; `canMigrate(v)` is satisfied when **either** an `ls` or `idb` step exists for every version from the stored one up to current. The single version stamp lands **after both phases complete** — so a crash mid-migration re-runs the idempotent phases next boot rather than stranding half-migrated records under a freshly-stamped version. The load path:

1. Equal → proceed.
2. Stored version older, within the migration horizon → run each phase's steps from the stored version up to current (settings blob first, then IDB records once the DB is open), stamp the new version, proceed. Both venues run the same chain.
3. Migration fails, the stored version predates the horizon, or the stored version is *newer* than this code → fall back to the floor.

Migrations upgrade the stored blob *before* it's parsed, so `wordlistFromMeta` and the rest of the read path only ever see the current shape — no tolerate-then-drop branches scattered through the parser.

## Reset is the floor

Migration handles the common case — a store a step or few behind current. The floor exists for the cases it can't carry:

- **Data newer than the code.** A stale CDN cache or a second device on an older deploy can hand this Grawlix a `schemaVersion` *above* `SCHEMA_VERSION`. Migrations only run forward; you can't downgrade a shape.
- **Data older than the squash horizon.** Once old migrations are deleted (below), a store from before the oldest surviving migration can't be walked forward.
- **Migration failure or corruption.** A migration step that throws, or stored data malformed regardless of version.

When `canMigrate` returns false the load path falls to the floor: `init()` shows a reset confirm ("Grawlix's data format has changed… The site may not work correctly until reset.", **Reset** / **I'll take my chances**). **Demote the floor, never delete it** — without it the first un-migratable store has no guard at all.

## Cost of migrations

Per bump:
- Add a `MIGRATIONS[v]` entry (an `ls` and/or `idb` step), keyed by the *from* version.
- Add its before→after fixture test (see *Testing migrations*). Buggy migrations *silently corrupt* data, which is worse than losing it — the reset prompt at least announces itself.
- Keep both until squashed (below).

Amortize: batch related schema changes into a single bump rather than one bump per tweak.

## The hidden cost

The moment the first migration exists, every field in `meta` becomes load-bearing. Renaming `originalFilename` to `sourceFilename` stops being a free refactor and becomes "write a migration." That discipline is good — it forces you to think before churning storage shapes — but it does slow you down.

Be especially conservative with the *shape* of nested objects (rescore rules, icon descriptors, scoring tiers). Adding a top-level field is cheap; restructuring a nested array is expensive.

## Testing migrations

**Every migration ships with a permanent before→after test, and those tests aren't deleted casually — only when their version is squashed.** This is the one place Grawlix's otherwise-lean *[regression budget — not automatic](testing.md)* policy flips to *always test*: a migration must transform real historical data correctly *forever*, long after the code around it has moved on.

The trap a normal test misses: a `MIGRATIONS[v]` `ls` step leans on the blob shape current at the time, and often on shared helpers. When those churn later — a field renamed, a helper's behavior changed, the blob restructured — an old step can silently start producing wrong output, and nothing notices, because no current code path feeds it old data anymore. A test that builds *current* data and migrates it proves nothing about the step that runs on *v-era* data. Only a **frozen fixture** catches the regression.

So, per version:

- **Before** — a real settings blob captured at version `v`, the exact shape that version persisted, pasted in verbatim and never edited again. Capture it from an actual `localStorage.meta` at that version; don't synthesize it from current code, or it drifts with the code and stops testing anything.
- **After** — the expected blob once walked to the current schema.
- Assert `migrateLs(structuredClone(before), v)` deep-equals `after`. Clone so a re-run doesn't mutate the fixture in place.

Drive these through `window.__grawlixTest` (expose `migrateLs` / `MIGRATIONS` there the way the bridge wraps other internals). This is the rare case where asserting the data shape directly — rather than a user-visible outcome, as the suite normally insists — is correct: a migration's entire contract *is* the stored shape, and a wrong shape fails silently.

An **`idb` step** can't be a pure settings-blob fixture — it reads and writes IndexedDB. Test it in two layers: factor the per-record transform into a pure helper (e.g. v11's `splitSyncRecord`) and freeze a before→after fixture on *that* in the unit tier, then add **one round-trip oracle** in the browser tier that seeds a real old-shape record in IDB, runs `migrateIdbRecords`, and asserts the new records exist with the right contents, the old record is gone, and the live read path (`loadSyncTargets`) reads the migrated target back. The oracle is what proves the real IDB read→write→delete, which the pure fixture can't reach.

Add, separately, **one or two integration tests through the real boot** — seed an old-version `localStorage.meta`, reload, and assert the migrated state lands, persists, and stamps the new version; and that a *newer* or un-migratable version hits the floor instead. These cover the read path and the floor wiring — once, not per version.

Squashing a migration (deleting `MIGRATIONS[v]`) deletes its fixture test in the same commit — which makes the squash, and the data it strands, visible in the diff rather than silent rot.

## Squashing old migrations

Bounded growth — the universal pattern is to delete migrations older than ~6–12 months and route those users through the floor. Someone who hasn't opened the app in a year loses their data; that's a tradeoff every long-lived app makes. The horizon is what step 3 above means by "predates the horizon."

## Version history

You need to know what each version meant — both to write the right migration step and to know when a version is old enough to squash. Keep a comment block above `SCHEMA_VERSION` listing each bump with its date and what changed. Don't encode the date *in* the version number (e.g. `20260505`) — comparison gets ugly, two bumps in one day collide, and you still need the table anyway.

```js
// Schema version history:
//   ≤9: pre-migration-policy baseline; a store this old hits the reset floor.
//   v10 (YYYY-MM-DD): <first migrated bump — what changed>
const SCHEMA_VERSION = 9;
```

Versions through 9 predate this policy and have no `MIGRATIONS` steps, so a pre-v10 store hits the floor. v10 — the first schema change after this decision — is the first that must register one.

## When the config diverges but the shape doesn't (unsolved)

`SCHEMA_VERSION` answers exactly one question: *can old code read this stored data?* That's about **shape**. There's a second, unrelated way persisted data goes stale that the version counter does not address and should not: a value in `WORDLIST_PUBLISHERS` changes while the shape of `meta` stays identical. Two concrete cases:

- **Updating a publisher setting** — e.g. giving a publisher a `url` it didn't have. This is real history: Will Nediger's list went from import-only to auto-fetched purely by setting `url`. Pre-beta we bumped `SCHEMA_VERSION` for it as a shortcut, since the wipe re-ran `defaultSources()` and re-seeded the new value for free. That shortcut is gone — a bump now migrates rather than wipes, so it no longer re-seeds config, and bumping to push a setting was always an abuse of the counter anyway.
- **Adding a new publisher wordlist** to the catalog.

Neither is a shape change. `url` is a field that already exists; a new publisher is purely additive. Old code reads the new data and new code reads the old data either way. So `SCHEMA_VERSION` is the wrong tool: a migration carries shape forward, it doesn't re-seed publisher config.

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

## Remapping moved URLs

The general divergence above stays unsolved, but one specific, safe slice of it *is* handled: a hosted wordlist file **moving to a new URL** — a new path under the same host (the grawlix.wtf lists moving from the site root into `wordlists/`), or an entirely different host (Nediger's list moving to the author's own Codeberg repo, and STWL and Broda moving off our self-hosted mirror to jkugelman's `raw.githubusercontent.com` wordlist repo, after which Grawlix hosts no wordlists itself). The file's contents and the stored `meta` shape are identical; only the `url` string drifted. `URL_REMAPS` in `site/src/core/constants.js` groups each current URL with the old URLs that should resolve to it — `{ to, from: [...] }` — and `remapStoredUrls(meta)` (in `migrations.js`) rewrites any stored `wordlist.url` that *exactly* equals one of a group's `from` entries straight to that group's `to`. It runs from `init()` on **every** boot — deliberately *not* through `MIGRATIONS`, because a relocated file trips no version mismatch and so a version-gated fixup would never reach users already on the current schema — and persists only when it actually rewrote something, so an affected user pays one localStorage write the first boot after a move and nothing thereafter.

Why this is safe where the general `url` propagation above is not: a remap only touches a `url` that *already equals* the old value. A user who imported a file (clearing `url`) has nothing to match, so their choice isn't clobbered; a source already auto-fetching from the old path is simply repointed, tripping no *new* download. It sidesteps every wrinkle the propagation problem carries — which is exactly why relocation can be automated while "give a publisher a `url` it never had" and "add a new publisher" can't.

To relocate a file: move it, update the `url` on its publisher in `WORDLIST_PUBLISHERS`, and record the move in `URL_REMAPS`. If the file already has a group, push its previous URL (the group's current `to`) onto that group's `from` list and repoint `to` at the new URL; if it has never moved before, add a new `{ to, from: [...] }` group. Because every old URL maps *directly* to the current home there is no chain and no array-order dependency — groups, and the URLs within a `from` list, may appear in any order, and a user several moves behind still lands in one hop. Unlike a `SCHEMA_VERSION` step, a remap needs no version bump and no frozen fixture: it carries no shape, so it can't silently corrupt data the way a buggy migration can. A plain before→after unit test plus one boot-integration test (both in the migration suites) is enough.

## The runner

One version-keyed table, `MIGRATIONS`, lives in `site/src/data/migrations.js` near `SCHEMA_VERSION`. `MIGRATIONS[v]` maps a *from* version to an `{ ls, idb }` entry: the optional `ls` step mutates the settings blob in place and/or touches standalone localStorage keys; the optional async `idb` step rewrites IndexedDB records. The two run in separate phases — an `idb` step must run post-`openDB` (folded into the `ls` phase it'd execute against a null `_db`), and the `ls` phase runs early enough to gate the reset prompt. `canMigrate(from)` checks every version from `from` up to current has an `ls` or `idb` step; `migrateLs(blob, from)` walks the `ls` phase and `migrateIdbRecords(from)` walks the `idb` phase. The drivers:

- **`migrateLocalStorage(from)`** (`ls` phase), called from the `init()` mismatch branch before `openDB`, assembles the blob from the separate localStorage keys, runs `migrateLs`, and writes them back. On a thrown step it returns false untouched and the floor's reset confirm takes over. It no longer stamps the version — the stamp moved to `init()` so it can land after *both* phases.
- **`migrateIdbRecords(from)`** (`idb` phase), called from `init()` after `openDB`, walks each entry's `idb` step. Each step is idempotent (re-runnable after a mid-migration crash) and deletes its old record *last*, so a crash before that leaves the old record intact to re-split next boot rather than a half-migrated list with no source of truth.

The first IDB-only step is **v10→v11**: it splits each per-list disk-sync record `sync_<key> {handle, baseline}` into `sync_main_<key> {handle}` + `sync_worker_<key> {baseline}` (the baseline record written only when a baseline exists — mirror lists carry none; My Edits' `''` is a real baseline and gets one). `MIGRATIONS[10]` has no `ls` step (it's `idb`-only); `canMigrate(10)` is satisfied by the `idb` step alone.

**Folder→per-file is deliberately not migrated**: a former folder-mode user boots into IDB-mode Grawlix with stale/default state (their real data lives in their folder files, since IDB dropped out under the old model) and manually re-attaches each file; first-attach merges the content back. The orphaned folder handle left in IDB is harmless and isn't garbage-collected. This was a conscious call — folder mode reached almost nobody, and handling a one-user scenario wasn't worth the code.

Two things the runner deliberately doesn't do:

- **Wordlist text.** `MIGRATIONS` steps transform settings only. A change to the stored text format (the `ENTRY;SCORE;COMMENT` lines, or the parsed wlEntry shape) needs an async per-wordlist pass that reads, transforms, and rewrites each wordlist's text — add that machinery when a text-format change first demands it.
- **Squashing.** No cutoff is enforced yet — every version from the start of the policy is still notionally walkable because none has been deleted. Set the horizon (and route older stores to the floor) once the migration list is long enough to be worth pruning.
