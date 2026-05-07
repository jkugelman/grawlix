# App shape

## What this is

The top-level UI for Grawlix: header, main pane, side panel. There is no separate "setup mode" — sources and sync each get a dedicated dialog reachable from the header.

The mining side of the app — the tool gallery and its growing catalog of search tools — is a separate concern; see `tools.md`. This document covers the app shell that hosts everything.

---

## Framing — workspace and sidekick

Constructors use Grawlix on desktop in two modes that share one UI:

- **Workspace** — typical during theme generation. The user lives in Grawlix: plays with tools, searches and filters the wordlist, grooms My Edits. Sessions are longer; exploration is open-ended.
- **Sidekick** — typical while filling a grid in another tool (Crossfire, Ingrid, Crossword Compiler, Crosserville). The user pops over to look something up, rescore an entry, type a comment, and goes back to filling.

Neither mode is primary. The workspace-leaning design accommodates sidekick mode for free as long as load is fast and chrome isn't loud — sidekick is just "brief use, leave."

Lookup features (definitions, NYT crossword history, semantic search; see `tools.md` "Related tools & future integrations") are differentially valuable to constructors using grid software without built-in lookup. Crossfire and Crossword Compiler are the populations that benefit most; Ingrid has Google integration and Crosserville has clue lookup, so those populations need Grawlix-side lookup less.

Mobile is a third mode — theme research on the go (subway, Discord) — and gets its own design; see [`mobile.md`](mobile.md).

### Non-features

Things considered and explicitly *not* built, so the design doesn't drift back to them:

- **No persistence of in-progress mining state** beyond what the URL already encodes. No "save my exploration" feature, no session restore. If the user closes the tab mid-mining, the next visit lands them fresh.
- **No cross-list comparison.** "Words in JK but not XWI" set-difference views are not a real workflow.
- **No scratchpad / working set.** My Edits is the only persistence concept. Tracking multiple in-progress result sets is more complexity than the workflow needs.
- **No multi-pattern search.** Running several patterns at once is not worth the UI surface; serial single queries are fine.
- **No recent-searches strip.** Search history is not preserved or surfaced.
- **No two-stack comparison UI.** Comparing the results of two slightly different inputs is naturally handled by edit-in-place on the existing input (e.g., toggle the Anagram input between LINDSEY and LINDSEYS) — live re-execution makes this fast.

---

## The shape

**Header.** Title, settings, help. Stays as today's purple bar — no per-source navigation, no sync state, no source picker. Brand chrome only.

**Left rail.** A single fixed-width column holding everything that isn't the wordlist view, split into two labelled sections: a **Wordlist** section at the top with the source dropdown and sync indicator (the two doors into setup), and a **Tools** section below with the tool gallery. The labels are there because the two sections answer unrelated questions — "what am I looking at" vs. "what can I do with it" — and a divider alone would suggest they're variants of the same thing. Not collapsible.

**Source dropdown.** Top of the left rail. Pure picker. The first entry, `All`, is the merged result of every enabled source with rescore rules applied. Below it, every individual source in the order they appear in `state.sources`: My Edits (which floats to the top of `state.sources` because it's prepended on first boot), then the publisher lists, then any user-imported lists. Reordering in Manage sources reorders the dropdown. Each entry is just an icon and a name — no entry counts, no "N sources" meta. A single footer entry: `⚙ Manage sources…` opens **Manage sources**. Clicking a source switches the main pane to show that source. No drag handles, no enable toggles, no add-list affordance — those all live one click deeper in Manage sources. **Alt+L** opens the dropdown and focuses the currently-selected entry.

**Sync indicator.** Sits in the rail just below the source dropdown. Shows "Last backup: Nd ago" with age-based color (neutral / warn / stale). Hidden until there's a backup to report — `sync.md` covers easing the user toward a first backup. Clicking opens **Sync & backup**.

**Main pane.** Stats bar, **tool stack**, virtual-scrolled results table. The stack is owned by `tools.md` — each tool the user has added becomes a row above the table; the table shows the output of the bottom row. The stack reads from whichever source is selected in the left-rail dropdown (`All` by default — the merged result of every enabled source with rescore rules applied). The bottom row of the stack is always a Search row — permanent, no X, with a stable Alt-S keyboard shortcut — so the everyday "type and look" use case is immediate. Search is also in the gallery as an addable tool, so a user can prepend a Search row above a transform when they want to pre-filter the input.

The table is **always visible**, even at idle with no search or tool active. The justification: the idle view and the search view are *the same view, just filtered*. Live keystroke-to-result feedback on the search input depends on continuity between idle and active — any design that swaps views between idle and searching breaks the loop. Filling sessions also treat the table as the working surface (type a word, edit its score, clear the search, repeat) — it needs to be there. Smart-default landings (recent edits, top-scoring, etc.) were considered and rejected; alphabetical-by-default is consistent with how filtering narrows during search.

**Tool gallery.** Lower portion of the left rail, below the source dropdown and sync indicator. Browsable cards of mining tools. Owned by `tools.md`; the app shell just provides the slot.

**Editing happens here.** Inline cell editing — the same click-to-edit-into-My-Edits flow as today — works in every wordlist view: the merged `All` view, individual sources, tool results. Edits always land in My Edits regardless of where they're made.

**Default landing.** On boot — including first run — the user lands on `All`. The four publisher lists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about list management. Manage sources is discovered when the user wants to customize: import a custom wordlist into My Edits, set up XWI for subscribers, reorder priorities, etc.

---

## Sources & setup

Two dialogs cover all setup:

**Manage sources** — opened from the source dropdown footer. Two-pane layout: a left rail listing every source with drag handle (reorder = merge priority), enable checkbox, and name; a right pane showing the focused source's stats, action buttons (download, refetch, more), and rescore rule editor. New lists are added here too, via a `+ Add list…` entry at the bottom of the left rail. My Edits has no rules section (scores pass through).

**Sync & backup** — opened from the left-rail sync indicator. See `sync.md` for the full design. Key affordances: prominent "Download All" and "Download My Edits" buttons (Tier 1 manual backup), per-cloud-provider connect/disconnect (Tier 3), disk-sync section gated on PWA install (Tier 2), recent activity log.

The two dialogs answer different questions and stay distinct:
- *Manage sources* — what lists do I have, in what order, with what rules.
- *Sync & backup* — how is my data being preserved across time and devices.

### Held on deck: setup as routes

Considered and not currently chosen: making setup screens into full-page routes — `#/sources` and `#/sync` — instead of modal dialogs. Confirms/alerts/downloads stay as dialogs regardless; those really are transient.

Arguments in favor of routes for setup: setup screens are *places* users spend real time, URL-addressable means deep-linkable and reload-safe, mobile and desktop converge in shape since dialogs go full-screen on phone anyway. Currently sticking with dialogs because they match the existing codebase idiom and the rest of the shell.

Worth revisiting if the dialog-as-workspace feel becomes a friction point — particularly when the mobile design lands, since the modal-ness is cost without payoff on phones. Notes for that revisit: bookmark/share-setup-state is unlikely (so deep-linking isn't a strong driver, just reload-safety); back button does default browser behavior (navigates back to the wordlist); header stays a fixture with no dynamic content (no breadcrumbs). *"Routes for everything" — including confirms — was considered and dropped as too heavy-handed.*

### Two paths to "give me a file"
- All or My Edits → Sync & backup dialog (it's a backup, not just a save — clicking the download bumps the "Last backup" timestamp forward).
- Any individual source → Manage sources dialog → that source's Download button (it's an export of one rescored source). Rare; doesn't warrant header chrome.

---

## Help modal (deferred)

The help modal stays enabled and reachable from the header during this restructure, but it won't be updated to reflect changes as they land. The shape of the app, the source-management story, and the tool gallery (`tools.md`) are all in motion, so the help text will drift out of sync with the UI for a while. That's expected.

Once both this restructure and `tools.md` settle, the modal will get a pass to catch up — and likely a redesign. The existing slide demos, especially the search demos, are good candidates for reuse. See `help.md` for the eventual rework.

## URL state

The app uses the History API (`replaceState` only) to keep the URL in sync with the tool stack, so any stack configuration can be bookmarked or shared.

The tool stack is the URL-addressable surface, encoded as the query string: `?anagram=LINDSEY&search=DOG&min=40` reads as "Anagram LINDSEY, then Search DOG, with min-score 40 on results." Dialogs (Manage sources, Sync & backup, Welcome tour, reference manual, settings) are *not* URL-addressable; they're transient UI state. The selected source from the dropdown is local-only — links don't pretend the recipient has the same lists loaded. The browser back button doesn't navigate within the stack; the visible row stack is the user's history, with the X on each row as the explicit undo. See `url-routing.md` for the full schema.

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
