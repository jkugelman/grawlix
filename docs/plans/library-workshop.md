# Library/Workshop URL state

The Library/Workshop nav has shipped, including URL routing — see [`design.md`](../design.md#the-shell) for the shell and [`design.md § URL state`](../design.md#url-state) for the route schema.

## Open questions

- **Future top-level destinations.** "Down the road" features that fit neither Library nor Workshop are anticipated but deliberately not designed here. The nav placement and URL schema should accommodate a third or fourth item without restructuring — `MainView`'s `VIEWS` registry is the single place to extend.
- **Library's own slim-top-row equivalent.** Workshop's slim top row holds the wordlist picker. Library may want a peer affordance (a focused-wordlist breadcrumb? an add-wordlist shortcut?) or may want nothing — to be settled when something concrete is needed.
