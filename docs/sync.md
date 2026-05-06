# Sync & persistence

## What this is

Grawlix users build up edits over time — corrections, scores, notes. A serious user will accumulate thousands of entries over years. Today all of that lives in IndexedDB on one device, in one browser. That is not safe, and it does not integrate with the rest of a constructor's workflow.

This doc describes how Grawlix backs up and syncs that data: across devices, to disk, and into cloud services, with a layered model where each tier addresses a different concern.

The two driving concerns:

1. **Data loss.** A browser crash, a "clear site data" click, or moving to a new computer should not erase years of work.
2. **Workflow integration.** Construction software like Ingrid reads wordlists from disk and writes edits back to a designated edit-list file. Grawlix should participate in that loop, not stand apart from it.

---

## What gets synced

Two files, not one. This is a deliberate shift from the earlier "download the merged list" model.

**File A — Merged sources.** All enabled lists *except* My Edits, merged with the user's rescore rules applied. Grawlix is the sole writer; external tools read it. One direction out.

**File B — My Edits.** Just the user's own edits, in the same `WORD;SCORE;COMMENT` format. Bidirectional: external tools can write to it (Ingrid's pencil-list convention), Grawlix re-imports the changes.

**Why the split.** Crossword best practice is "never edit a published wordlist directly" — your customizations live in a separate file so you can update the underlying lists freely without losing them. The two-file model bakes this practice into Grawlix's defaults. A user loading both files into Ingrid (with File B marked as the edit list) gets the same workflow as if they'd been editing in Ingrid all along, with Grawlix as a richer curation surface upstream.

**Single-file output remains an opt-in.** For one-off uses — sharing a wordlist with someone, submitting to a competition — the user can still download or sync a single merged file that includes My Edits. Default is two files; power users can switch.

---

## Sync tiers

Three layered options. They compose — a user can run any combination.

### Tier 1 — Backup nag (universal, always on)

A "last backup" tracker in the UI, prominent when the gap exceeds some threshold ("It's been 14 days since your last backup"). Periodic prompt offering to download File B (My Edits) as a one-click manual backup.

Optional opt-in: silent auto-download to the Downloads folder on a cadence (e.g. daily, when My Edits has changed since last backup). Files are timestamped so they accumulate as a history.

Universal — works in every browser, no setup, no permissions. This is the *floor* that keeps the data-loss panic at bay regardless of whether the user engages with the higher tiers.

### Tier 2 — Local file link (PWA-gated)

Uses the File System Access API to maintain a persistent link between Grawlix's data and a file on the user's hard drive. Bidirectional for File B; one-way out for File A.

**Gated behind installing Grawlix as a PWA.** Without installation, FSA permissions reset every session — meaning the user would have to click "resume sync" on every page load. That is bad UX, and degrading silently to "your sync stopped" is worse. Installed PWAs in Chromium browsers get persistent file-system permissions, which makes the experience seamless: open the app, sync just works.

A user visiting grawlix.wtf in a normal browser tab does *not* see disk sync as an option. They see Tier 1 (backup nag) and Tier 3 (cloud). To unlock disk sync, install Grawlix.

**Nudges, not roadblocks.** When relevant — a user pasting a long wordlist, or opening Grawlix while Ingrid is also open (heuristic TBD), or simply after enough sessions — surface a friendly "Install Grawlix to sync edits to disk and Ingrid" prompt. Dismissable. Easy to find later in settings.

**Browser support.** FSA is Chromium-only (Chrome, Edge, Brave, Arc). Firefox and Safari users see the nudge replaced with "disk sync requires a Chromium browser." Tier 1 and Tier 3 are still available to them.

### Tier 3 — Cloud sync (cross-device)

Connects Grawlix to a cloud storage provider so edits follow the user across devices. Initial OAuth flow once per provider, silent thereafter.

Uses **OAuth2 with PKCE** — a flow designed for client-side apps that ship a public client ID but no client secret. Safe to embed in a static page; Grawlix has no server. The user clicks "Connect Dropbox," authorizes in a popup or redirect, and Grawlix gets tokens it can refresh silently.

**Provider priorities (v1):**

- **Dropbox first.** No app verification gate, long-lived refresh tokens, clean PKCE flow, simple file-based API. Lowest friction to ship.
- **Google Drive second.** Use the `drive.file` scope (only sees files the app creates) to keep verification requirements lighter. Brand recognition is the value here. Note: refresh tokens expire weekly while the app is in OAuth "Testing" status — Grawlix needs to go through Google's verification process for long-lived tokens, which requires a privacy policy and possibly a security review.
- **OneDrive third.** Microsoft Graph API, comparable PKCE flow to Dropbox, no review for personal accounts.
- **Skipping**: iCloud Drive (no third-party web API), GitHub (interesting power-user option, deferred).

**Tokens.** Refresh tokens stored in IndexedDB (not localStorage — IDB has stronger isolation). Access tokens kept in memory only. Reconnect flow handles revocation cleanly.

**File location.** Each provider has a sensible default path (Dropbox app folder, Drive app-data folder, OneDrive `/Apps/Grawlix/`). User can change it.

---

## Conflict resolution

Multi-device sync needs a merge story. The model is **base-snapshot three-way merge** with **per-field granularity** and **sync-order tiebreaker** for true conflicts. No timestamps in any file format, no timestamps in IndexedDB.

### How it works

For each sync target, Grawlix keeps a `lastSyncedState` snapshot in IndexedDB — a copy of what the file/cloud looked like at the last successful sync. On every sync:

1. **Diff `lastSyncedState` vs. local** → set of local changes since last sync.
2. **Diff `lastSyncedState` vs. remote** (cloud or disk) → set of remote changes since last sync.
3. **Apply non-overlapping changes automatically.** Different words: both apply. Same word, different fields (one side edited score, other edited comment): both apply.
4. **Same-field conflicts**: sync-order wins. Whoever syncs last writes their value. Acceptable because true conflicts are rare for single-user, async cross-device editing — same word, same field, edited on two devices in the gap between syncs.
5. **Push merged state, update `lastSyncedState`.**

### Per-field granularity

An entry has two independent fields: score and comment. Treating them as one atomic unit would flag "added a comment on laptop, bumped score on desktop" as a conflict. Treating them separately makes that case auto-resolve cleanly. This isn't semantic merging (no "higher score wins" judgment calls) — it's just diffing at the natural granularity of the data.

### Deletes

Tombstones. A deleted entry is kept as `{ word, deleted: true }` in the synced state until all known sync targets have seen the deletion. Same merge logic applies: tombstone vs. edit on the other side resolves by sync order. Tombstones are tiny — keeping them indefinitely is fine.

### External edits (Ingrid writing back)

When an external tool writes to File B, Grawlix has no metadata for what changed — just an updated file. The diff against `lastSyncedState` *is* the change set; that's all we need. From Grawlix's perspective an external rewrite is no different from a remote sync.

### Why no timestamps

The original sketch had per-entry `modified` timestamps. They aren't necessary — the base snapshot does the work of detecting changes. Timestamps were only ever a tiebreaker for same-field conflicts, and sync-order is a fine tiebreaker for those rare cases. Dropping them keeps the wordlist file format clean (no inline metadata, no sidecar files) and removes a whole class of clock-skew edge cases.

---

## PWA installation

Grawlix needs to be installable for Tier 2 to work. The cost is small — a `manifest.json`, an icon set, an install prompt. The benefits go beyond sync:

- **Persistent file-system permissions** in Chromium (the Tier 2 enabler).
- **More resilient to "clear site data"** — installed PWAs are treated more carefully by some browsers' UX, though not bulletproof.
- **Standalone window**, dock/taskbar icon, OS-level presence.

**No service worker in v1.** A PWA is fully installable without one — Grawlix gets the standalone window, the dock icon, persistent FSA permissions, and storage durability without it. What an SW would add is offline-on-launch (the tab stays working without network because IDB is local, but launching from the dock with no network shows an error page) and background sync. Neither is v1 scope, and the failure mode of a misconfigured SW (users stuck on a stale cached `index.html` until they clear site data) is worse than the failure mode of no SW. Revisit when offline-on-launch is actually requested or when Tier 3 background sync becomes appealing.

### What "installed" actually means

An installed PWA is not a versioned snapshot. The browser saves the manifest and icons locally, registers a launcher entry pointing at `start_url`, and on every launch fetches the page over the network like any other visit. Update grawlix.wtf and every installed user gets the new version on next launch. No app-store review, no version pinning, no rollback — the same constraint Grawlix already lives with as a website.

The visible difference is the standalone window: no URL bar, dedicated taskbar/dock icon, separate Alt-Tab entry, often a separate process. Feels like a native app.

### Selling installation

The core principle: **don't ask until the user has a reason to say yes.** First-load install prompts get dismissed reflexively. The pitch lands when the user has felt the friction the install solves.

Capture the `beforeinstallprompt` event on page load, suppress the browser's default mini-infobar, and trigger `event.prompt()` on a user gesture at a moment of our choosing. Trigger points in rough priority order:

1. **After first wordlist import.** They've committed to the tool. "Install Grawlix to sync edits to your hard drive and survive browser resets." Strongest signal.
2. **In the Sync & backup panel, next to Tier 2.** The panel explains "disk sync requires installing Grawlix" and offers an Install button right there. This is the *hard gate* — Tier 2 is unreachable without install, and the panel makes that legible.
3. **N-th session heuristic.** After ~5 sessions or ~10 minutes of total active time, a small dismissable banner: "Install Grawlix for a real app window and disk sync." Lower priority than contextual triggers.
4. **After pasting a long wordlist.** Power-user signal. Same nudge as (1), framed around backup safety.

What the nudge should *not* be: a banner on first load, a popup that interrupts work, anything that fires before the user has invested anything.

### Teaching what installation does

The Sync & backup panel is the explanatory surface. When Tier 2 says "install required," link to a short FAQ covering:

- It's not the app store; it's still grawlix.wtf.
- You can uninstall any time, like any other app.
- It lets disk sync actually work (FSA permissions persist across launches).
- You get a real app window and dock icon as a bonus.
- It still updates automatically when grawlix.wtf updates.

Keep it short. The user asking "what does installing do?" is on the fence — a wall of text loses them.

---

## UI surfaces

Sync settings live in the Library (the setup-oriented mode — see `workshop.md`). A new "Sync & backup" panel:

- Status of each tier (last backup, file linked, cloud connected) at a glance.
- Connect/disconnect per provider.
- Choose what to sync: File A, File B, or both (per target).
- Recent activity log — last sync, last conflict, last error.
- A "Recent conflicts" list, if any same-field conflicts have been auto-resolved. The user can review and undo (the loser is preserved in `lastSyncedState` history). Quiet on the happy path.

Status indication elsewhere:

- A small sync indicator in the header — green dot, spinner during sync, red on error.
- The "Last backup: 14 days ago" nag, when applicable, lives near the global state.

---

## Failure modes

- **Token revoked.** User changed cloud password, manually disconnected, etc. Grawlix shows reconnect prompt; local state is preserved. No data loss.
- **Provider unreachable.** Transient: retry with backoff. Persistent: surface error, keep editing locally, sync when service returns.
- **External tool truncates the file.** Diff against `lastSyncedState` shows mass deletion. Treat as a high-confidence anomaly: prompt before applying.
- **Schema version mismatch.** A future Grawlix syncs newer data, an older Grawlix tries to read it. The wordlist file format itself is stable; this is mostly a non-issue for the file content. Sync metadata (cloud provider state, etc.) is internal to IndexedDB and follows the project's existing `SCHEMA_VERSION` story.

---

## Phases

### Phase 1 — Tier 1 (backup nag)

The universal floor. Add a `lastBackup` tracker, the "stale backup" nag UI, and a one-click "Download My Edits backup" affordance. Optional auto-download cadence as a setting.

Ships first because it's small, universal, has no dependencies, and addresses the data-loss panic on its own. Everything after this is incremental improvement.

### Phase 2 — PWA + Tier 2 (local file link)

Add `manifest.json` and the install nudge UI. Build the FSA-based sync layer for File A (one-way out) and File B (bidirectional). External-edit detection on File B. Recent-conflicts UI for the auto-resolved cases.

This phase delivers the workflow integration story for Ingrid users.

### Phase 3 — Tier 3 (cloud sync)

Dropbox first — full PKCE flow, file API integration, refresh token handling, sync engine reuse from Phase 2 (the merge logic is provider-agnostic). Then Google Drive (`drive.file` scope). Then OneDrive. Each provider added incrementally; the merge engine doesn't change.

App verification work for Google Drive happens in parallel during this phase.

### Phase 4 — Polish

Per-target settings (file paths, sync cadence). Cross-target consistency (a Tier 2 disk file and a Tier 3 cloud target both pointing at "My Edits" need to converge — they share `lastSyncedState`? per-target snapshots that reconcile? open question).

---

## Open questions

- **Multiple sync targets pointing at the same logical file.** If the user has Tier 2 (disk) and Tier 3 (Dropbox) both syncing My Edits, they need to converge. Cleanest model is probably "each target has its own `lastSyncedState`, the merge runs pairwise on every sync event, all targets eventually converge." Worth working out before Phase 4.
- **Auto-download cadence default.** Off entirely (manual nag only)? Daily? Per-session-with-changes? Probably configurable, but what's the default?
- **Heuristic for "Ingrid is also open" install nudge.** Maybe a no-op — there's no clean signal from the browser. Just rely on the generic "you've been using Grawlix a while, want to install?" prompt.
- **GitHub as a Tier 3 option.** Power users would love it (free version history, diffs, PRs against your own wordlist). Defer past v1.
- **Encryption at rest.** Cloud providers see plaintext wordlists. For most users this is fine — wordlists aren't sensitive. Worth mentioning in user-facing copy. Optional client-side encryption is a future possibility but adds significant complexity for marginal benefit.
- **Mobile / iOS.** Safari has neither FSA nor good PWA install UX. iOS users are limited to Tier 1 and Tier 3. Acceptable for v1.
