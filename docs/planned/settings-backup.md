# Settings backup / restore

Manual export and import of Grawlix's settings to and from a file, from the Settings menu. Deferred — captured here so it isn't lost; design it as its own piece later.

## Why

This falls out of the disk-storage redesign (per-list file sync; see [`design.md` § Disk storage](../design.md) once distilled). That redesign drops the old habit of mirroring settings out to a `grawlix.json` in a Grawlix-owned folder — settings now live in the browser, full stop. But one user wants Grawlix's settings as a file they can **version-control**, and that's a use case worth serving.

The answer is a *manual* gesture, not live sync: export writes the settings to a file the user picks; import reads one back. Not a live directory-handle connection like disk sync — a deliberate save/load. Less magic, but enough: someone who wants their config in git can export, commit, and re-import when they want to roll back. "Export/import" and "backup/restore" are the same feature under two names.

## Open question — scope

The one thing to decide before building: **config only, or full backup?**

- **Config only** — tier labels (`state.scoring`), output format, per-wordlist rescore rules, wordlist metadata. No wordlist *content*. Small, diff-friendly, the natural fit for version control (the stated use case).
- **Full backup** — config *plus* wordlist content (My Edits, sources). Larger and not diff-friendly, but it doubles as the "move me to a new machine / undo a disaster" escape hatch that no longer exists now that there's no Grawlix folder to copy.

These aren't mutually exclusive — there could be two gestures (export settings vs. export everything). Decide when this feature gets picked up; don't force it now.

## Notes

- Lives in the Settings dialog (`docs/manual.md` § Settings), alongside the output-format controls.
- Reuses the existing serialization shapes where possible — much of "config" is what `grawlix.json` used to carry, minus anything folder/sync-specific.
- A schema-version stamp in the exported file lets import refuse or migrate an incompatible backup, the same floor the rest of storage uses.
