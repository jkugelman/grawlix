# Sync & persistence

## What this is

Grawlix users build up edits over time — corrections, scores, notes. A serious user will accumulate thousands of entries over years. Today all of that lives in IndexedDB on one device, in one browser. That is not safe, and it does not integrate with the rest of a constructor's workflow.

Two driving concerns:

1. **Data loss.** A browser crash, a "clear site data" click, or moving to a new computer should not erase years of work.
2. **Workflow integration.** Construction software like Ingrid reads wordlists from disk and writes edits back to a designated edit-list file. Grawlix should participate in that loop, not stand apart from it.

---

## What gets synced

Two files, not one.

**The merged list.** All enabled lists *except* My Edits, merged with the user's rescore rules applied. Grawlix is the sole writer; external tools read it. One direction out.

**My Edits.** Just the user's own edits, in the same `WORD;SCORE;COMMENT` format. Bidirectional: external tools can write to it (Ingrid's pencil-list convention), Grawlix re-imports the changes.

**Why the split.** Crossword best practice is "never edit a published wordlist directly" — your customizations live in a separate file so you can update the underlying lists freely without losing them. The two-file model bakes this into Grawlix's defaults. A user loading both files into Ingrid (with My Edits marked as the edit list) gets the same workflow as if they'd been editing in Ingrid all along, with Grawlix as a richer curation surface upstream.

**Single-file output remains an opt-in.** For one-off uses — sharing a wordlist, submitting to a competition — the user can still download or sync a single merged file that includes My Edits. Default is two files; power users can switch.

---

## Sync tiers

Three layered options that compose. A user can run any combination.

### Tier 1 — Backup nag (universal, always on)

A "last backup" tracker in the UI, prominent when the gap exceeds some threshold ("It's been 14 days since your last backup"). Periodic prompt offering a one-click manual download of My Edits. Optional opt-in: silent auto-download on a cadence, files timestamped so they accumulate as a history.

Universal — works in every browser, no setup, no permissions. The *floor* that keeps the data-loss panic at bay regardless of whether the user engages with the higher tiers.

### Tier 2 — Local file link (PWA-gated)

A persistent link between Grawlix and a file on the user's hard drive, via the browser's File System Access API. Bidirectional for My Edits; one-way out for the merged list. **Chromium-only**, and **gated behind installing Grawlix as a PWA** — without installation, the browser resets file permissions every session, which makes "your sync stopped" the silent default. Installed PWAs get persistent permissions and the experience just works.

A user visiting grawlix.wtf in a normal browser tab does not see disk sync as an option. To unlock it, install Grawlix. See "PWA installation" below for how that's surfaced.

### Tier 3 — Cloud sync (cross-device)

Grawlix connects to a cloud storage provider so edits follow the user across devices. One-time OAuth flow per provider, silent thereafter. No Grawlix server is involved — the auth flow is designed for static client-side apps.

Provider priorities for v1: **Dropbox first** (lowest friction to ship). **Google Drive second** (brand recognition; needs Google's app verification process for long-lived tokens). **OneDrive third**. iCloud Drive has no third-party web API and is skipped. GitHub as a power-user option is deferred.

---

## Conflict resolution

Multi-device sync needs a merge story. The user-facing behavior:

- **Different words → both apply.** Editing different entries on two devices never conflicts.
- **Same word, different fields → both apply.** Score on laptop, comment on desktop: both land. Score and comment merge independently.
- **Same word, same field → sync-order wins.** Whoever syncs last writes their value. Acceptable because true conflicts are rare for single-user, async cross-device editing.
- **Deletes** are tombstones, kept until all sync targets have seen them, then cleaned up.
- **External tools writing to My Edits** (e.g. Ingrid) look identical to a remote sync — the diff against the last-synced state is the change set.
- **Recent conflicts are reviewable.** The Sync panel shows auto-resolved same-field conflicts so the user can undo if the wrong side won. Quiet on the happy path.

No timestamps in the wordlist file format and none in IndexedDB — a last-synced snapshot does the work of detecting what changed, and sync-order is a fine tiebreaker for the rare same-field case. Keeps the file format clean and avoids clock-skew edge cases.

---

## PWA installation

Grawlix needs to be installable for Tier 2 to work. The cost is small — a `manifest.json`, an icon set, an install prompt. The benefits:

- **Persistent file-system permissions** in Chromium (the Tier 2 enabler).
- **More resilient to "clear site data"** — installed PWAs are treated more carefully by some browsers' UX, though not bulletproof.
- **Standalone window**, dock/taskbar icon, OS-level presence.

An installed PWA isn't a versioned snapshot — the browser still fetches grawlix.wtf on every launch. No app-store review, no version pinning, no rollback. Update the site and every installed user gets the new version on next launch. The visible difference from a tab is the standalone window: no URL bar, dedicated dock icon, separate Alt-Tab entry. Feels like a native app.

### Selling installation

The core principle: **don't ask until the user has a reason to say yes.** First-load install prompts get dismissed reflexively. The pitch lands when the user has felt the friction the install solves.

Trigger points in rough priority order:

1. **After first wordlist import.** They've committed to the tool. "Install Grawlix to sync edits to your hard drive and survive browser resets." Strongest signal.
2. **In the Sync & backup panel, next to Tier 2.** The panel explains "disk sync requires installing Grawlix" and offers an Install button right there. The hard gate — Tier 2 is unreachable without install.
3. **N-th session heuristic.** After enough sessions, a small dismissable banner: "Install Grawlix for a real app window and disk sync." Lower priority than contextual triggers.
4. **After pasting a long wordlist.** Power-user signal, framed around backup safety.

What the nudge should *not* be: a banner on first load, a popup that interrupts work, anything that fires before the user has invested anything.

### Teaching what installation does

The Sync & backup panel is the explanatory surface. A short FAQ near the Tier 2 install button covers:

- It's not the app store; it's still grawlix.wtf.
- You can uninstall any time, like any other app.
- It lets disk sync actually work (FSA permissions persist across launches).
- You get a real app window and dock icon as a bonus.
- It still updates automatically when grawlix.wtf updates.

Keep it short. The user asking "what does installing do?" is on the fence — a wall of text loses them.

---

## UI surfaces

Sync lives in a dedicated **Sync & backup dialog**, opened by clicking the sync indicator in the left rail — a small status dot (green / spinner / red on error) paired with a "Last backup: Nd ago" nag that turns warning-colored when the gap exceeds the threshold. The dialog contains:

- Status of each tier (last backup, file linked, cloud connected) at a glance.
- Manual backup buttons for `All` (the merged wordlist) and My Edits — the Tier 1 entry point. Clicking either bumps "Last backup" forward.
- Connect/disconnect per cloud provider.
- The disk-sync section, gated behind PWA install when not yet eligible.
- Choose what to sync: the merged list, My Edits, or both (per target).
- Recent activity log — last sync, last conflict, last error.
- Recent conflicts list, if any same-field conflicts have been auto-resolved.

The dialog is distinct from **Manage wordlists** (see `../designs/app.md`): that one answers "what lists do I have, in what order, with what rules"; this one answers "how is my data being preserved across time and devices."

---

## Failure modes

- **Token revoked.** User changed cloud password, manually disconnected, etc. Grawlix shows a reconnect prompt; local state is preserved.
- **Provider unreachable.** Transient: retry with backoff. Persistent: surface error, keep editing locally, sync when service returns.
- **External tool truncates the file.** Diff shows mass deletion. Treat as a high-confidence anomaly: prompt before applying.
- **Browser support gaps.** Firefox and Safari users see Tier 2 hidden — Tier 1 and Tier 3 still available. Mobile/iOS limited to Tier 1 and Tier 3 (no FSA, no good PWA install UX).

---

## Multi-target convergence

If a user has Tier 2 (disk) and Tier 3 (Dropbox) both syncing My Edits, the two targets need to stay in sync with each other, not just with the local copy. The likely shape is per-target last-synced snapshots with pairwise merge on every sync event — same conflict-resolution rules as the multi-device case, applied across targets instead of devices. Needs to be worked out before sync ships, since shipping a single-target version and bolting on multi-target later risks state-shape changes that break existing users.

---

## Open questions

- **Auto-download cadence default.** Off entirely (manual nag only)? Daily? Per-session-with-changes? Probably configurable, but what's the default?
- **GitHub as a Tier 3 option.** Power users would love it (free version history, diffs, PRs against your own wordlist). Defer past v1.
- **Encryption at rest.** Cloud providers see plaintext wordlists. For most users this is fine — wordlists aren't sensitive. Optional client-side encryption is a future possibility but adds significant complexity for marginal benefit.
