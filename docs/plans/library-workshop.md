# Library/Workshop URL state

Most of the Library/Workshop nav has shipped — see [`design.md`](../design.md#the-shell). What remains:

## Mode is in the URL

Two sections don't strictly need URL state — sharing a `?view=library` link presumes the recipient cares about your config, which they don't — but future top-level sections (lookup, reference, etc.) will plausibly want linkability, and the URL schema should be ready before there are three of them and a migration. Persist to localStorage as a secondary write so reload preserves the last view when the URL is bare.

## Open questions

- **Future top-level destinations.** "Down the road" features that fit neither Library nor Workshop are anticipated but deliberately not designed here. The nav placement and URL schema should accommodate a third or fourth item without restructuring.
- **Library's own slim-top-row equivalent.** Workshop's slim top row holds the wordlist picker. Library may want a peer affordance (a focused-wordlist breadcrumb? an add-wordlist shortcut?) or may want nothing — to be settled when something concrete is needed.
