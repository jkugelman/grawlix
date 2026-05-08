# Design

The shape of Grawlix's UI and the architectural choices behind it. The *what* (user-visible behavior) lives in [`manual.md`](manual.md); this doc covers the *why* — what alternatives were rejected, what constraints shape things — plus architectural surfaces a contributor needs to orient.

This is the singular home for distilled design content. As plans ship, the `distill-design-doc` skill folds them into this file (and `manual.md` for user-facing surface).

## Workspace and sidekick

Constructors use Grawlix on desktop in two modes that share one UI:

- **Workspace** — typical during theme generation. The user lives in Grawlix: plays with tools, searches and filters the wordlist, grooms My Edits. Sessions are longer; exploration is open-ended.
- **Sidekick** — typical while filling a grid in another tool (Crossfire, Ingrid, Crossword Compiler, Crosserville). The user pops over to look something up, rescore an entry, type a comment, and goes back to filling.

Neither mode is primary. The workspace-leaning design accommodates sidekick mode for free as long as load is fast and chrome isn't loud — sidekick is just "brief use, leave."

Lookup features (definitions, NYT crossword history, semantic search; see [`plans/lookup.md`](plans/lookup.md)) are differentially valuable to constructors using grid software without built-in lookup. Crossfire and Crossword Compiler are the populations that benefit most; Ingrid has Google integration and Crosserville has clue lookup, so those populations need Grawlix-side lookup less.

Mobile is a third mode — theme research on the go (subway, Discord) — and gets its own design; see [`plans/mobile.md`](plans/mobile.md).

## The shell

**Header** is brand chrome only. No per-wordlist navigation, sync state, or wordlist picker; the rail handles those.

**Left rail** has two *labelled* sections — **Wordlist** at the top (the picker + sync indicator, the two doors into setup) and **Tools** below (owned by [`plans/tools.md`](plans/tools.md)). Labels because the two sections answer unrelated questions ("what am I looking at" vs. "what can I do with it"); a divider alone would suggest they're variants of the same thing. Not collapsible.

**Wordlist dropdown** is a *pure picker*. Each entry is icon + name only — no entry counts. No drag handles, enable toggles, or add-wordlist affordance; those live one click deeper in the Wordlists dialog. The dialog is opened by the icon-only **wordlist settings** button to the right of the dropdown — pulled out of the dropdown's footer so the manage entry point is always visible without expanding the picker.

**Sync indicator** is hidden until there's a backup to report. Today that's always — Sync & backup is a stub (see [`plans/sync.md`](plans/sync.md) for the design that will eventually populate it).

**Stats bar always renders, even for empty wordlists** — zero entries, dashes for min/max/etc., flat histogram baseline. Uniformity over an "empty placeholder" treatment.

**Table is always visible**, even at idle with no search active. The idle and search views are *the same view, just filtered*; live keystroke-to-result feedback depends on continuity. Filling sessions also treat the table as the working surface (type a word, edit its score, clear the search, repeat). Smart-default landings (recent edits, top-scoring, etc.) were considered and rejected; alphabetical-by-default is consistent with how filtering narrows during search.

**Default landing on `All`.** Including first run. The four publisher wordlists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about wordlist management.

The space between the stats bar and the table is where the tool stack will land per [`plans/tools.md`](plans/tools.md); today the table sits directly under the stats.

## Wordlists & setup

Two dialogs cover all setup. They answer different questions and stay distinct:

- **Wordlists** — what wordlists do I have, in what order, with what rules.
- **Sync & backup** — how is my data being preserved across time and devices.

### Wordlists

Two-pane layout (rail + action row + stats + rule editor).

The right pane has no name/icon header — the focused wordlist is identified by the highlighted card in the rail. Action buttons always justify right; the date label sits next to the primary action.

Every wordlist has a rule editor for parity:
- Regular wordlists get **rescoring** rules (their dialect → unified scale).
- My Edits gets **scoring** rules (the user's tier labels for the unified scale).

The action row is also unified — date slot, primary action, Download, more menu. Only the contents differ per wordlist type.

**Renaming** happens on the rail card via F2 with the card focused. Configure wordlist (in a wordlist's ⋮ menu) is the secondary path. No Rename in the kebab menu — the F2 affordance is enough.

**Rescoring lives entirely inside the Wordlists dialog**; it doesn't appear on the main screen. Rules are detail config, typically set once when adding a wordlist and rarely revisited; they don't earn persistent real estate next to the wordlist view.

**Scoring rules** (My Edits' tier labels) are the user's single notion of what each score range means — there is no separate "output" tier system. The merged All view shows them as a read/write legend above its table for convenience, but the canonical edit surface is My Edits in the Wordlists dialog.

**Onboarding banner** lives only inside the Wordlists dialog — there's no auto-popup on the main view. Users who never open the dialog never see it; the defaults are sensible enough that this is fine.

### Sync & backup

Today this is a stub. Full design lives in [`plans/sync.md`](plans/sync.md): prominent "Download All" and "Download My Edits" buttons (Tier 1 manual backup), per-cloud-provider connect/disconnect (Tier 3), disk-sync section gated on PWA install (Tier 2), recent activity log.

### Two paths to "give me a file"

- **All** or **My Edits** → Sync & backup dialog (it's a backup, not just a save — clicking the download will bump the "Last backup" timestamp once Tier 1 lands).
- **Any individual wordlist** → Wordlists dialog → that wordlist's Download button (it's an export of one rescored wordlist). Rare; doesn't warrant header chrome.

## Help modal

Reachable from the header `?` button and the `?` keyboard shortcut. First-run users get it auto-opened. Slide content describes the pre-restructure UI and is out of date with the current shell — a redesign is planned in [`plans/help.md`](plans/help.md), to land once [`plans/tools.md`](plans/tools.md) settles.

## URL state

The query string mirrors the current search pattern (`search=`), whole-word toggle (bare key `whole-word`), and score filter (`score=`). All three round-trip: pasting a Grawlix link into a chat reproduces what the sender was looking at, and refreshing the page lands you back where you were.

A small `Router` IIFE owns parse, serialize, and `history.replaceState`. Key shape choices:

- **Real query string, no hash.** Grawlix is a single-page app; paths in the URL would suggest sections that don't exist. GitHub Pages serves `index.html` regardless of query string, so any URL deep-loads without server-side routing.
- **`replaceState` only.** Stack edits never push a history entry; the back button leaves Grawlix instead of navigating within. The visible UI is the user's history — clearing the search is the explicit undo. A back button would be redundant or actively confusing ("did I lose my whole stack?").
- **URL wins over localStorage.** The score filter loads from localStorage and the URL overlays it on init. Search pattern and whole-word have no localStorage backing — they live entirely in the URL during a session.
- **Empty values drop out.** An empty search isn't `search=`; it's absent. The URL stays minimal in the 95% case (`/` for the bare app).
- **Debounced ~250ms** for typing callers (search, score). Structural toggles (whole-word, clear) replace instantly. The URL bar doesn't flicker per keystroke.

Out of scope for the URL — these are local-only:
- **Dialogs** (Welcome, help, settings, Wordlists, Sync & backup) — transient UI state. Open them how you opened them; close them when you're done.
- **Selected wordlist** from the rail dropdown. Sharing a link to "anagram of LINDSEY in STWL" implies the recipient has STWL loaded; we don't pretend otherwise. The recipient sees their own selection (default `All`).
- Scroll position, edit-in-progress state, transient popovers.

The schema extends as the tool stack lands. Pending design — tool-key registry, multi-input encoding, alias policy for renames — lives in [`plans/url-routing.md`](plans/url-routing.md).

## Open questions

### Fold "Configure wordlist" into the Wordlists dialog

Today, a wordlist's kebab menu's "Configure wordlist" opens a separate `ConfigureWordlistDialog` for icon, name, URL, publisher, and rule application — a second drill-down on top of a configuration page. That doesn't make sense; the Wordlists dialog is already where you configure things. The right pane should expose those fields directly (or in a collapsible "advanced" block) so there's no nested dialog.

### Setup as routes

Considered and not currently chosen: making setup screens into full-page routes — `#/wordlists` and `#/sync` — instead of modal dialogs. Confirms/alerts/downloads stay as dialogs regardless; those really are transient.

Arguments in favor of routes for setup: setup screens are *places* users spend real time, URL-addressable means deep-linkable and reload-safe, mobile and desktop converge in shape since dialogs go full-screen on phone anyway. Currently sticking with dialogs because they match the existing codebase idiom and the rest of the shell.

Worth revisiting if the dialog-as-workspace feel becomes a friction point — particularly when the mobile design lands, since the modal-ness is cost without payoff on phones. Notes for that revisit: bookmark/share-setup-state is unlikely (so deep-linking isn't a strong driver, just reload-safety); back button does default browser behavior (navigates back to the wordlist); header stays a fixture with no dynamic content (no breadcrumbs). *"Routes for everything" — including confirms — was considered and dropped as too heavy-handed.*

## Non-features

Things explicitly *not* built, so the design doesn't drift back to them:

- **No persistence of in-progress mining state** beyond what the URL encodes. No "save my exploration" feature, no session restore.
- **No cross-wordlist comparison.** "Words in JK but not XWI" set-difference views are not a real workflow.
- **No scratchpad / working set.** My Edits is the only persistence concept.
- **No multi-pattern search.** Serial single queries are fine.
- **No recent-searches strip.** Search history is not preserved or surfaced.
- **No two-stack comparison UI.** Editing in place on the existing input (e.g., toggle Anagram between LINDSEY and LINDSEYS) handles it via live re-execution.
