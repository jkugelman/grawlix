# App shape

## What this is

The top-level UI for Grawlix: header, main pane, side panel. There is no separate "setup mode" — sources and sync each get a dedicated dialog reachable from the header.

The mining side of the app — the tool gallery and its growing catalog of search tools — is a separate concern; see `tools.md`. This document covers the app shell that hosts everything.

---

## The shape

**Header.** Title, settings, help. Stays as today's purple bar — no per-source navigation, no sync state, no source picker. Brand chrome only.

**Left rail.** A single fixed-width column holding everything that isn't the wordlist view, split into two labelled sections: a **Wordlist** section at the top with the source dropdown and sync indicator (the two doors into setup), and a **Tools** section below with the tool gallery. The labels are there because the two sections answer unrelated questions — "what am I looking at" vs. "what can I do with it" — and a divider alone would suggest they're variants of the same thing. Not collapsible.

**Source dropdown.** Top of the left rail. Pure picker. The first entry, `All`, is the merged result of every enabled source with rescore rules applied. Below it, every individual source in the order they appear in `state.sources`: My Edits (which floats to the top of `state.sources` because it's prepended on first boot), then the publisher lists, then any user-imported lists. Reordering in Manage sources reorders the dropdown. Each entry is just an icon and a name — no entry counts, no "N sources" meta. A single footer entry: `⚙ Manage sources…` opens **Manage sources**. Clicking a source switches the main pane to show that source. No drag handles, no enable toggles, no add-list affordance — those all live one click deeper in Manage sources. **Alt+L** opens the dropdown and focuses the currently-selected entry.

**Sync indicator.** Sits in the rail just below the source dropdown. Shows "Last backup: Nd ago" with age-based color (neutral / warn / stale). Hidden until there's a backup to report — `sync.md` covers easing the user toward a first backup. Clicking opens **Sync & backup**.

**Main pane.** The wordlist view: stats bar, search box (with the existing wildcard syntax), virtual-scrolled table. By default this shows `All` — the merged result of every enabled source with rescore rules applied. Picking a different source from the dropdown swaps in that source's view; picking a tool from the gallery (see `tools.md`) swaps in that tool's results.

**Tool gallery.** Lower portion of the left rail, below the source dropdown and sync indicator. Browsable cards of mining tools. Owned by `tools.md`; the app shell just provides the slot.

**Editing happens here.** Inline cell editing — the same click-to-edit-into-My-Edits flow as today — works in every wordlist view: the merged `All` view, individual sources, tool results. Edits always land in My Edits regardless of where they're made.

**Default landing.** On boot — including first run — the user lands on `All`. The four publisher lists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about list management. Manage sources is discovered when the user wants to customize: import a custom wordlist into My Edits, set up XWI for subscribers, reorder priorities, etc.

---

## Sources & setup

Two dialogs cover all setup:

**Manage sources** — opened from the source dropdown footer. Two-pane layout: a left rail listing every source with drag handle (reorder = merge priority), enable checkbox, and name; a right pane showing the focused source's stats, action buttons (download, refetch, more), and rescore rule editor. New lists are added here too, via a `+ Add list…` entry at the bottom of the left rail. My Edits has no rules section (scores pass through).

**Sync & backup** — opened from the header sync indicator. See `sync.md` for the full design. Key affordances: prominent "Download All" and "Download My Edits" buttons (Tier 1 manual backup), per-cloud-provider connect/disconnect (Tier 3), disk-sync section gated on PWA install (Tier 2), recent activity log.

The two dialogs answer different questions and stay distinct:
- *Manage sources* — what lists do I have, in what order, with what rules.
- *Sync & backup* — how is my data being preserved across time and devices.

**Two paths to "give me a file":**
- All or My Edits → Sync & backup dialog (it's a backup, not just a save — clicking the download bumps the "Last backup" timestamp forward).
- Any individual source → Manage sources dialog → that source's Download button (it's an export of one rescored source). Rare; doesn't warrant header chrome.

---

## Help modal (deferred)

The existing help modal is temporarily disabled during this restructure. The code stays in place — the `HelpModal` IIFE and its slide demos are kept verbatim — but the header help button is unwired (still visible to keep the header layout stable while we visualize the new shape) and the first-run auto-open is suppressed. Re-enabling later is just rewiring the click and auto-open call sites; no flag, no scaffolding.

Don't update or extend the modal during this work. The shape of the app, the source-management story, and the tool gallery (`tools.md`) are all in motion; touching the help text now is a maintenance trap.

Once both this restructure and `tools.md` are mature, the modal will be redesigned and reactivated. The existing slide demos — especially the search demos — are likely candidates for reuse, which is why we keep the code rather than deleting it. See `help.md` for the eventual rework.

## URL state

The app uses the History API to keep URLs in sync with navigation state, so any view can be bookmarked, shared, or reached via browser back/forward.

The main pane is the URL-addressable surface — search query, filter state, selected source (when not the default `All`), selected tool, tool inputs are all reflected in the URL. Manage sources and Sync & backup are *not* URL-addressable; they're configuration dialogs, not shareable views. See `url-routing.md` for the full schema.

---

## Phasing

The app-shell restructure is one chunk of work that lands before the tool gallery (`tools.md`) can be built on top of it. The visible result: the app looks like the new design and behaves identically to today's, with no tools in the gallery yet.

- Extract `getMergedWords()` (materializing the full merged output) and a `MiningIndex` (word-existence set, sorted-letter map, etc.). Small, additive, doesn't touch existing behavior. Land first.
- **Disable the help modal** for the duration of this restructure: unwire the help button (still visible) and suppress the first-run auto-open. Code stays put.
- Build the **left rail** with the source dropdown and sync indicator stacked at the top, above the (still-empty) tool gallery slot.
- Build the **Manage sources dialog**, absorbing today's Sources sidebar + detail pane (minus the word table). Drag-to-reorder, enable toggles, per-source stats and action buttons, rescore rule editor, add-list flow.
- Build the **Sync & backup dialog** scaffolding with manual download buttons (Tier 1). Left-rail sync indicator with backup-age nag. Tier 2/3 implementation is owned by `sync.md`.
- Promote the wordlist view (today's merged-list detail) to the main app page.
- Stand up the **tool gallery panel** as a left rail — empty for now, structure only. Tools land later, per `tools.md`.
