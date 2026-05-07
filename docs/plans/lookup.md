# Lookup features

## What this is

Click a word → surface info about it from external sources (definitions, Wikipedia, NYT crossword history, semantic search). Most of the actual design is open — this doc captures *that* lookups will be built, why, and the directional choices already made. The bulk is deferred to its own design session.

---

## Why lookups matter

**Differentially valuable for constructors using grid software without built-in lookup** — Crossfire and Crossword Compiler. Ingrid has Google integration, Crosserville has clue lookup, so those populations get lookup elsewhere. Grawlix-side lookups close the gap for the rest.

Beyond the grid-software gap, lookups serve Grawlix's own mining/research workflows: while filling or theme-generating, "what is this entry?" is a real question that comes up — and the **mobile theme-research-on-the-go scenario** (subway, Discord; see [`mobile.md`](mobile.md)) probably wants definitions and Wikipedia more than letter-pattern wordplay. Lookups may need more prominence on mobile than desktop.

---

## Settled

- **Lookups will be built as a near-term feature**, not parked indefinitely. Promoted from "parked" during the workspace-vs-sidekick discussion.
- **Target user:** constructors whose grid software lacks built-in lookup. Crossfire and Crossword Compiler users benefit most.
- **Likely v1 sources:** definitions, Wikipedia, Google search, semantic search, NYT crossword history. OneLook/Datamuse and Umiaq are already on the integration list — see [`tools.md`](tools.md) "Related tools & future integrations." Google search is a low-bar add (a quick `google.com/search?q=` link or embed); even Ingrid users — who already have Google in-app — appreciate it being right next to the wordlist.

---

## Stretch goals

- **Clue lookup.** Show all past puzzle clues that have been used for a given entry — what XWord Info offers as part of its subscription, and Crosserville's primary differentiator. Heavier than the v1 source set: it requires a database of past clues keyed by answer, and the integration path / licensing are open. Worth aiming for once v1 lookups land and the data-source question can be tackled on its own.

---

## Open questions

To answer in the dedicated design session:

- **Where does the lookup result live?** Each option has a different relationship to the always-visible-table decision in [`app.md`](app.md):
  - *Popover next to the word* — keeps the table dominant; ephemeral; closes on click-elsewhere.
  - *Side panel that persists as you click around* — takes pixels from the table but supports rapid scanning across multiple entries.
  - *New column in the table* — probably too dense.
  - *Dedicated route / page* — full-screen lookup view; loses the in-context nature.
- **Source roster for v1.** Which sources ship first?
- **Trigger interaction.** Click a word, hover, dedicated affordance per row, keyboard shortcut on selection? The interaction model needs to coexist with inline cell editing — clicking a score or comment cell is already taken.
- **Mobile.** Should mobile bias more strongly toward lookup-style features at the entry point? See [`mobile.md`](mobile.md) open questions.
- **Latency / offline.** Lookups are network-dependent. What does Grawlix show for offline / slow / failed lookup? Where does loading state live?

---

## Phasing

Owns its own design session, then its own implementation phase. Not a prerequisite for any current desktop work, and current desktop work is not a prerequisite for it. Mobile design lands first — partly because the mobile entry-point question depends on whether lookups are central or peripheral on the small screen.
