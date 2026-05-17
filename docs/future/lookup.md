# Lookup features

## What this is

Click a word → surface info about it from external sources (definitions, Wikipedia, NYT crossword history, semantic search). Most of the actual design is open — this doc captures *that* lookups will be built, why, and the directional choices already made. The bulk is deferred to its own design session.

---

## Why lookups matter

Lookups are the gap-filler for the populations described in the "Workspace and sidekick" framing — specifically constructors whose grid software lacks built-in lookup (Crossfire, Crossword Compiler). Ingrid has Google integration, Crosserville has clue lookup; those users already get lookup elsewhere.

Beyond the grid-software gap, lookups serve Grawlix's own mining/research workflows: while filling or theme-generating, "what is this entry?" is a real question that comes up — and the **theme-research-on-the-go scenario** (subway, Discord) probably wants definitions and Wikipedia more than letter-pattern wordplay.

---

## Settled

- **Lookups will be built as a near-term feature**, not parked indefinitely. Promoted from "parked" during the workspace-vs-sidekick discussion.
- **Target user:** constructors whose grid software lacks built-in lookup. Crossfire and Crossword Compiler users benefit most.
- **Likely v1 sources:** definitions, Wikipedia, Google search, semantic search, NYT crossword history. Google search is a low-bar add (a quick `google.com/search?q=` link or embed); even Ingrid users — who already have Google in-app — appreciate it being right next to the wordlist. OneLook/Datamuse is the leading candidate for the semantic-search slot — see *Candidate source: OneLook / Datamuse* below.

---

## Candidate source: OneLook / Datamuse (onelook.com, datamuse.com/api)

OneLook indexes an enormous dataset of words and phrases — Wikipedia, all major dictionaries, phrase dictionaries, idiom databases, proper nouns, and more. **Scale:** 16,965,772 entries across 805 dictionaries. Far broader than any single wordlist.

**The integration path is their `/api/words?` endpoint** (parameters: `sp=` for spelling pattern, `ml=` for means-like). This appears to be the Datamuse API or very closely related — Datamuse is explicitly designed for programmatic access, no key required.

Capabilities worth noting:
- **Reverse dictionary / semantic search** — find words by meaning or concept. `:widespread epidemic` → "pandemic"; `:winter sport` → skiing, skating, etc. Enormous for crossword construction.
- **Meaning-filtered pattern search** — combine a letter pattern with a meaning constraint: `p*:ireland` finds terms starting with P related to Ireland. `bl*:snow` finds blue-ish snow words.
- **Phrase search** — `**winter**` finds multi-word phrases containing "winter" as a whole word.
- **Crossword puzzle mode** — patterns automatically allow optional spaces, so run-together strings match phrases: `h?ttot?ot` → "hot to trot".
- **Letter inclusion/exclusion** — `+abcd` restricts results to only those letters; `-abcd` excludes them.

XWordInfo's arrangement with OneLook may involve something beyond the public API — unknown.

---

## Stretch goals

- **Clue lookup.** Show all past puzzle clues that have been used for a given entry — what XWord Info offers as part of its subscription, and Crosserville's primary differentiator. Heavier than the v1 source set: it requires a database of past clues keyed by answer, and the integration path / licensing are open. Worth aiming for once v1 lookups land and the data-source question can be tackled on its own.

---

## Open questions

To answer in the dedicated design session:

- **Where does the lookup result live?** Each option has a different relationship to the always-visible-table decision:
  - *Popover next to the word* — keeps the table dominant; ephemeral; closes on click-elsewhere.
  - *Side panel that persists as you click around* — takes pixels from the table but supports rapid scanning across multiple entries.
  - *New column in the table* — probably too dense.
  - *Dedicated route / page* — full-screen lookup view; loses the in-context nature.
- **Source roster for v1.** Which sources ship first?
- **Trigger interaction.** Click a word, hover, dedicated affordance per row, keyboard shortcut on selection? The interaction model needs to coexist with inline cell editing — clicking a score or comment cell is already taken.
- **Latency / offline.** Lookups are network-dependent. What does Grawlix show for offline / slow / failed lookup? Where does loading state live?

---

## Phasing

Owns its own design session, then its own implementation phase. Not a prerequisite for any current work, and current work is not a prerequisite for it.
