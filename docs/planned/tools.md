# Tools (gallery & mining)

## Catalog

The list of shipped and planned tools — with their cards' icon, name, description, and example — lives in [`../tools.md`](../tools.md).

## Capability families

Two families that unlock entire categories of tools, gated on bundling external data. The individual tools each family unlocks are listed in [`../tools.md`](../tools.md).

### Phonetics

The CMU Pronouncing Dictionary maps words to phoneme sequences, opening up an entire class of sound-based operations that letter-based tools can't touch. The dict is fetched from a remote URL and cached at runtime by the pipeline worker (a worker-owned data asset registered in [`../../site/src/engine/assets.js`](../../site/src/engine/assets.js), kept fresh by the hourly asset auto-update). **Rhymes** ships on it (`engine/tools/rhymes.js` + `engine/phonetics.js`); Phonetic substitution and Sound shift remain to explore.

### Thesaurus / semantics

Meaning-based searches — synonyms, antonyms, words in the same semantic category — that unlock tools Wordlisted can't do at all: semantic relationships layered on top of the letter-pattern moves. An undertapped gold mine, gated on bundling a semantic dataset.

**WordNet (preferred).** Princeton's lexical database — ~155K words in ~120K synsets, BSD-style licensed (the community-maintained [Open English WordNet](https://en-word.net/) fork is CC BY 4.0 and ships JSON). Synsets give synonyms directly, antonym pointers give antonyms, and hypernym/hyponym links give broader/narrower/category searches. Two extra draws: its derivationally-related-form links (`red`↔`redness`↔`redden`) could revive the derivational grouping a morphology layer otherwise skips, and its morphological exception lists + lemma inventory can back that same morphology layer — so one dataset serves both families.

**Roget's Thesaurus (fallback).** Also available as structured XML, covering the same synonym/antonym/category ground; less structured and more awkwardly licensed than WordNet, so it's the alternative if WordNet doesn't pan out.

---

## Bank/anagram relation grid

The four bank/anagram filters are one relation family sampled at different points. Each compares the letters of an entry **E** against the letters of the argument **A** along two independent axes:

- **Multiplicity** — whether letter *counts* matter. A **set** view collapses repeats (distinct letters only); a **multiset** view counts them.
- **Containment** — how E's letters must relate to A's: E draws only from A (E ⊆ A), E matches A exactly (E = A), or E covers at least A (E ⊇ A).

That's a 2×3 grid, and four of the six cells are already shipped tools:

| | Set (distinct letters) | Multiset (with counts) |
|---|---|---|
| **E ⊆ A** — only these letters | 🔡 Restricted alphabet | 🧱 Scrabble |
| **E = A** — exactly these letters | 🏦 Letter bank | 🔀 Anagrams |
| **E ⊇ A** — at least these letters | *(empty)* | *(empty)* |

The two empty cells are the **E ⊇ A** row — "the entry contains at least the given letters":

- **Set** → this is **❗ Required letters** (already planned in [`../tools.md`](../tools.md), *"Contains every given letter"*): every given letter appears at least once, extras and repeats allowed. It's currently filed under its own *Required* category, but the grid says it belongs to the bank family — a possible recategorization, not a decision made here.
- **Multiset** → no tool, planned or shipped: the entry contains at least the given letters *counting duplicates* (`A = ee` demands two E's). A candidate cell if the need ever surfaces.

The lens earns its keep two ways. It's a description check — it's what caught Letter bank's card claiming *"uses every letter at least once"* when the code demands set *equality* (E = A, extras rejected), now corrected to *"only the given letters, each at least once."* And it's a coverage map: the family is a tidy grid with one planned tool sitting in the wrong category and exactly one genuinely open cell.

## Open questions

- **Custom JS tools.** Two paths:
  - *(a) Ephemeral.* A "Custom" gallery card opens a code editor in its stack-row params; the run is the user's code. No persistence beyond URL state — closing the tab loses it.
  - *(b) Registered.* User-named custom tools show up as gallery cards alongside builtins, persisted to localStorage, optionally exportable as a JSON file. Heavier — needs naming, conflict handling, deletion, possibly versioning. Sandboxing concerns (no rogue `fetch` to `localhost`, clear "user-loaded" badging in the gallery) belong here too.

  Start with (a); it proves the API against real user code without committing to the registry surface. Move to (b) only if users surface "I keep retyping this." Real demand is unknown today.
- **Thesaurus data bundling.** WordNet (or Open English WordNet) is now the leading dataset over Roget (see *Capability families*) — static asset, CDN, or runtime fetch? (Phonetics resolved: the CMU dict is a runtime fetch from a remote URL, worker-owned — see `engine/assets.js`.)
- **Synthetic-atom downstream behavior.** What does `[phrase_parsing, behead]` mean? The synthetic "hot to trot" goes into behead, which tries to look up "ot to trot" in `wordlist.byEntry`, finds nothing, drops the row. Probably degenerates harmlessly but the chained semantic is fuzzy. Rebus (shipped) is now a synthetic emitter too — `[rebus, behead]` beheads a glyph form that exists in no wordlist, so it drops the same way. Revisit if a real workflow surfaces.
