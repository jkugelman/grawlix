# App shape

The app shell that hosts everything: header, left rail, main pane, and the
two setup dialogs. The mining side — the tool gallery and the row-stack
that fills the main pane — is owned separately by [`plans/tools.md`](plans/tools.md);
this document describes the shell.

## Workspace and sidekick

Constructors use Grawlix on desktop in two modes that share one UI:

- **Workspace** — typical during theme generation. The user lives in
  Grawlix: plays with tools, searches and filters the wordlist, grooms
  My Edits. Sessions are longer; exploration is open-ended.
- **Sidekick** — typical while filling a grid in another tool (Crossfire,
  Ingrid, Crossword Compiler, Crosserville). The user pops over to look
  something up, rescore an entry, type a comment, and goes back to filling.

Neither mode is primary. The workspace-leaning design accommodates sidekick
mode for free as long as load is fast and chrome isn't loud — sidekick is
just "brief use, leave."

Lookup features (definitions, NYT crossword history, semantic search; see
[`plans/lookup.md`](plans/lookup.md)) are differentially valuable to constructors using grid
software without built-in lookup. Crossfire and Crossword Compiler are the
populations that benefit most; Ingrid has Google integration and Crosserville
has clue lookup, so those populations need Grawlix-side lookup less.

Mobile is a third mode — theme research on the go (subway, Discord) — and
gets its own design; see [`plans/mobile.md`](plans/mobile.md).

### Non-features

Things explicitly *not* built, so the design doesn't drift back to them:

- **No persistence of in-progress mining state** beyond what the URL encodes.
  No "save my exploration" feature, no session restore.
- **No cross-list comparison.** "Words in JK but not XWI" set-difference
  views are not a real workflow.
- **No scratchpad / working set.** My Edits is the only persistence concept.
- **No multi-pattern search.** Serial single queries are fine.
- **No recent-searches strip.** Search history is not preserved or surfaced.
- **No two-stack comparison UI.** Editing in place on the existing input
  (e.g., toggle Anagram between LINDSEY and LINDSEYS) handles it via live
  re-execution.

## The shell

**Header.** Title, settings, help — purple bar, brand chrome only. No
per-source navigation, no sync state, no source picker.

**Left rail.** Fixed-width column with two labelled sections: a **Wordlist**
section at the top (source dropdown + sync indicator — the two doors into
setup), and a **Tools** section below (the tool gallery, owned by [`plans/tools.md`](plans/tools.md)).
Labels because the two sections answer unrelated questions ("what am I
looking at" vs. "what can I do with it"); a divider alone would suggest
they're variants of the same thing. Not collapsible.

**Source dropdown.** Top of the rail. Pure picker. First entry is `All` —
the merged result of every enabled source with rescore rules applied. Below
it, every individual source in `state.sources` order (My Edits at the top
because it's prepended on first boot, then publishers, then user-imported).
Each entry is just an icon and a name — no entry counts. Footer entry
`⚙ Manage sources…` opens **Manage sources**. **Alt+L** opens the dropdown
and focuses the currently-selected entry. No drag handles, enable toggles, or
add-list affordance here — those live one click deeper in Manage sources.

**Sync indicator.** Sits below the source dropdown. Shows "Last backup: Nd
ago" with age-based color (neutral / warn / stale). Clicking opens **Sync
& backup**. Hidden until there's a backup to report — currently always
hidden because Sync & backup is a stub (see [`plans/sync.md`](plans/sync.md) for the full
design that will eventually populate it).

**Main pane.** Stats bar, then the wordlist table. The space between is
where the tool stack will land per [`plans/tools.md`](plans/tools.md); today the table sits
directly under the stats. The stats bar always renders, even for empty
lists — zero entries, dashes for min/max/etc., flat histogram baseline.
Uniformity over an "empty placeholder" treatment.

The table is **always visible**, even at idle with no search active. The
idle view and the search view are *the same view, just filtered*; live
keystroke-to-result feedback depends on continuity between idle and active.
Filling sessions also treat the table as the working surface (type a word,
edit its score, clear the search, repeat). Smart-default landings (recent
edits, top-scoring, etc.) were considered and rejected; alphabetical-by-
default is consistent with how filtering narrows during search.

**Inline editing.** Click-to-edit on score and comment cells in every
wordlist view (merged All, individual sources, future tool results). Edits
always land in My Edits regardless of where they're made.

**Default landing.** On boot — including first run — the user lands on
`All`. The four publisher lists fetch automatically in the background, so
the app has data to query right away and a new user can start doing
wordlist tricks immediately without thinking about list management.

## Sources & setup

Two dialogs cover all setup. They answer different questions and stay
distinct:

- *Manage sources* — what lists do I have, in what order, with what rules.
- *Sync & backup* — how is my data being preserved across time and devices.

### Manage sources

Opened from the source dropdown footer. Two-pane layout.

The **left rail** lists every source with drag handle (reorder = merge
priority), enable checkbox, and name. New lists are added via a
`+ Add list…` entry at the bottom.

The **right pane** is the action row, the stats bar with histogram, and a
rule editor — no name/icon header (the focused source is identified by the
highlighted card in the rail). Action buttons always justify right; the
date label sits next to the primary action.

Every list has a rule editor for parity:
- Regular sources get **rescoring** rules (their dialect → unified scale).
- My Edits gets **scoring** rules (the user's tier labels for the unified
  scale).

The action row is also unified — date slot, primary action, Download, more
menu. Only the contents differ:
- Sources: primary Update/Fetch, Download split (rescored / original),
  ⋮ Configure list / Delete list.
- My Edits: Import (primary when empty, plain when populated), Download
  (primary when populated, hidden when empty), ⋮ Clear (when populated).

**Renaming** happens on the rail card — F2 with the card focused opens an
inline editor. Configure list (in sources' ⋮ menu) is the secondary path.
No Rename in the kebab menu — the F2 affordance is enough.

**Rescoring lives entirely inside Manage sources**; it doesn't appear on
the main screen. Rules are detail config, typically set once when adding a
list and rarely revisited; they don't earn persistent real estate next to
the wordlist view.

**Scoring rules** (My Edits' tier labels) are the user's single notion of
what each score range means — there is no separate "output" tier system.
The merged All view shows them as a read/write legend above its table for
convenience, but the canonical edit surface is My Edits in Manage sources.

**Onboarding banner.** First-run users get a small notice in the Manage
sources rail, above the source list: *"Some popular wordlists have been
set up with suggested scoring rules,"* with "Sounds good" to dismiss and
"No thanks" to wipe the pre-loaded publishers. Lives only inside Manage
sources — there's no auto-popup on the main view. Users who never open
Manage sources never see it; the defaults are sensible enough that this
is fine.

### Sync & backup

Opened from the left-rail sync indicator. **Today this is a stub** — the
dialog opens with placeholder text. Full design lives in [`plans/sync.md`](plans/sync.md):
prominent "Download All" and "Download My Edits" buttons (Tier 1 manual
backup), per-cloud-provider connect/disconnect (Tier 3), disk-sync section
gated on PWA install (Tier 2), recent activity log.

### Two paths to "give me a file"

- All or My Edits → Sync & backup dialog (it's a backup, not just a save —
  clicking the download will bump the "Last backup" timestamp once Tier 1
  lands).
- Any individual source → Manage sources dialog → that source's Download
  button (it's an export of one rescored source). Rare; doesn't warrant
  header chrome.

### Open: fold "Configure list" into Manage sources

Today, sources' kebab menu's "Configure list" opens a separate
`ConfigureListDialog` for icon, name, URL, publisher, and rule application
— a second drill-down on top of a configuration page. That doesn't make
sense; Manage sources is already where you configure things. The right
pane should expose those fields directly (or in a collapsible "advanced"
block) so there's no nested dialog.

### Open: setup as routes

Considered and not currently chosen: making setup screens into full-page
routes — `#/sources` and `#/sync` — instead of modal dialogs.
Confirms/alerts/downloads stay as dialogs regardless; those really are
transient.

Arguments in favor of routes for setup: setup screens are *places* users
spend real time, URL-addressable means deep-linkable and reload-safe,
mobile and desktop converge in shape since dialogs go full-screen on phone
anyway. Currently sticking with dialogs because they match the existing
codebase idiom and the rest of the shell.

Worth revisiting if the dialog-as-workspace feel becomes a friction point —
particularly when the mobile design lands, since the modal-ness is cost
without payoff on phones. Notes for that revisit: bookmark/share-setup-
state is unlikely (so deep-linking isn't a strong driver, just reload-
safety); back button does default browser behavior (navigates back to the
wordlist); header stays a fixture with no dynamic content (no breadcrumbs).
*"Routes for everything" — including confirms — was considered and dropped
as too heavy-handed.*

## Help modal

Reachable from the header `?` button and the `?` keyboard shortcut. First-
run users get it auto-opened. Slide content describes the pre-restructure
UI and is out of date with the current shell — a redesign is planned in
[`plans/help.md`](plans/help.md), to land once [`plans/tools.md`](plans/tools.md) settles.

## URL state

The plan: the tool stack will be encoded as the query string
(`?anagram=LINDSEY&search=DOG&min=40`) using `replaceState`, so any stack
configuration can be bookmarked or shared. Dialogs (Manage sources, Sync
& backup, settings, help) are *not* URL-addressable; they're transient UI
state. The selected source from the dropdown is local-only — links don't
pretend the recipient has the same lists loaded.

This is **not yet wired** — there's no tool stack to encode. Lands with
[`plans/tools.md`](plans/tools.md). See [`plans/url-routing.md`](plans/url-routing.md) for the schema.
