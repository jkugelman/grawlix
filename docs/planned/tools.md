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

## Open questions

- **Custom JS tools.** Two paths:
  - *(a) Ephemeral.* A "Custom" gallery card opens a code editor in its stack-row params; the run is the user's code. No persistence beyond URL state — closing the tab loses it.
  - *(b) Registered.* User-named custom tools show up as gallery cards alongside builtins, persisted to localStorage, optionally exportable as a JSON file. Heavier — needs naming, conflict handling, deletion, possibly versioning. Sandboxing concerns (no rogue `fetch` to `localhost`, clear "user-loaded" badging in the gallery) belong here too.

  Start with (a); it proves the API against real user code without committing to the registry surface. Move to (b) only if users surface "I keep retyping this." Real demand is unknown today.
- **Thesaurus data bundling.** WordNet (or Open English WordNet) is now the leading dataset over Roget (see *Capability families*) — static asset, CDN, or runtime fetch? (Phonetics resolved: the CMU dict is a runtime fetch from a remote URL, worker-owned — see `engine/assets.js`.)
- **Synthetic-atom downstream behavior.** What does `[phrase_parsing, behead]` mean? The synthetic "hot to trot" goes into behead, which tries to look up "ot to trot" in `wordlist.byEntry`, finds nothing, drops the row. Probably degenerates harmlessly but the chained semantic is fuzzy. Rebus (shipped) is now a synthetic emitter too — `[rebus, behead]` beheads a glyph form that exists in no wordlist, so it drops the same way. Revisit if a real workflow surfaces.
