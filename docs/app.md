# App shape

## What this is

The top-level UI for Grawlix: header, main pane, side panel. There is no separate "setup mode" — sources and sync each get a dedicated dialog reachable from the header.

The mining side of the app — the tool gallery and its growing catalog of search tools — is a separate concern; see `tools.md`. This document covers the app shell that hosts everything.

---

## The shape

**Header.** Title, a **source dropdown** (defaults to Master List), a **sync indicator** with a "Last backup: Nd ago" nag, theme toggle, help. Two doors into setup, one each: the dropdown's footer entry opens **Manage sources**; the sync indicator opens **Sync & backup**. Nothing else in the header is per-source.

**Source dropdown.** Pure picker. Lists every source — Master List, then the four publisher lists, then My Edits, then any user-imported lists — with a single footer entry: `⚙ Manage sources…`. Clicking a source switches the main pane to show that source. No drag handles, no enable toggles, no add-list affordance — those all live one click deeper in Manage sources.

**Main pane.** The wordlist view: stats bar, search box (with the existing wildcard syntax), virtual-scrolled table. By default this shows the Master List — the merged result of all enabled sources with rescore rules applied. Picking a different source from the dropdown swaps in that source's view; picking a tool from the gallery (see `tools.md`) swaps in that tool's results.

**Tool gallery.** Left panel, collapsible. Browsable cards of mining tools. Owned by `tools.md`; the app shell just provides the panel slot.

**Editing happens here.** Inline cell editing — the same click-to-edit-into-My-Edits flow as today — works in every wordlist view: Master List, individual sources, tool results. Edits always land in My Edits regardless of where they're made.

**Default landing.** On boot — including first run — the user lands with the Master List selected. The four publisher lists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about list management. Manage sources is discovered when the user wants to customize: import a custom wordlist into My Edits, set up XWI for subscribers, reorder priorities, etc.

---

## Sources & setup

Two dialogs cover all setup:

**Manage sources** — opened from the source dropdown footer. Two-pane layout: a left rail listing every source with drag handle (reorder = merge priority), enable checkbox, and name; a right pane showing the focused source's stats, action buttons (download, refetch, more), and rescore rule editor. New lists are added here too, via a `+ Add list…` entry at the bottom of the left rail. My Edits has no rules section (scores pass through).

**Sync & backup** — opened from the header sync indicator. See `sync.md` for the full design. Key affordances: prominent "Download Master List" and "Download My Edits" buttons (Tier 1 manual backup), per-cloud-provider connect/disconnect (Tier 3), disk-sync section gated on PWA install (Tier 2), recent activity log.

The two dialogs answer different questions and stay distinct:
- *Manage sources* — what lists do I have, in what order, with what rules.
- *Sync & backup* — how is my data being preserved across time and devices.

**Two paths to "give me a file":**
- Master List or My Edits → Sync & backup dialog (it's a backup, not just a save — clicking the download bumps the "Last backup" timestamp forward).
- Any individual source → Manage sources dialog → that source's Download button (it's an export of one rescored source). Rare; doesn't warrant header chrome.

---

## URL state

The app uses the History API to keep URLs in sync with navigation state, so any view can be bookmarked, shared, or reached via browser back/forward.

The main pane is the URL-addressable surface — search query, filter state, selected source (when not Master List), selected tool, tool inputs are all reflected in the URL. Manage sources and Sync & backup are *not* URL-addressable; they're configuration dialogs, not shareable views. See `url-routing.md` for the full schema.

---

## Phasing

The app-shell restructure is one chunk of work that lands before the tool gallery (`tools.md`) can be built on top of it. The visible result: the app looks like the new design and behaves identically to today's, with no tools in the gallery yet.

- Extract `getMergedWords()` (materializing the full merged output) and a `MiningIndex` (word-existence set, sorted-letter map, etc.). Small, additive, doesn't touch existing behavior. Land first.
- Build the **source dropdown** in the header.
- Build the **Manage sources dialog**, absorbing today's Sources sidebar + detail pane (minus the word table). Drag-to-reorder, enable toggles, per-source stats and action buttons, rescore rule editor, add-list flow.
- Build the **Sync & backup dialog** scaffolding with manual download buttons (Tier 1). Header sync indicator with backup-age nag. Tier 2/3 implementation is owned by `sync.md`.
- Promote the wordlist view (today's Master List detail) to the main app page.
- Stand up the **tool gallery panel** as a left rail — empty for now, structure only. Tools land later, per `tools.md`.
