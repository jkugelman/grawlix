# Help system

Replacing the prior "first-boot welcome tour + reference manual" plan. Going with a Crosserville-style multi-page approach: several small focused pages, each free to have its own shape (Q&A, tips, deep dive, orientation), each playing a distinct role. Reference points (all Crosserville): [FAQ](https://www.crosserville.com/FAQ), [GettingStarted](https://www.crosserville.com/GettingStarted), [Tips](https://www.crosserville.com/Tips), [KeyboardShortcuts](https://www.crosserville.com/KeyboardShortcuts).

The earlier version of this doc planned an in-app help with two surfaces — a 4-slide first-boot tour, and a `?`-button reference manual. That framing is set aside. The manual-shaped half is being broken up into separate pages instead, and the welcome surface may or may not survive as its own slide-deck thing once we see what the Getting Started page wants to be.

This doc is more discussion than design — the conversation is just getting started.

## Voice and principles

- **DIY, personal, hand-written.** README-on-GitHub feel; the docs should read as written by a person, not by a marketing department. No "unique value propositions," no "powerful workflows," no "robust feature set." Crosserville's FAQ has the right flavor: first-person admissions, opinions delivered as earned wisdom, credit to contributors, willingness to point users at competing tools.
- **Not comprehensive.** No goal of documenting every feature. Spend the budget on cool stuff worth advertising and hard topics worth explaining.
- **Don't document features that already work in-app.** Every tool has a gallery blurb and examples. If the gallery falls short, fix the gallery — don't write a paragraph here as a workaround.
- **No documenting controls.** If a toggle isn't self-explanatory, the fix is the toggle's label, not a paragraph here.
- **Examples earn their keep where prose alone fails.** Not a density target. "Anagram returns every entry with the same letters" is fine bare; "Letter clusters groups entries by their distinct-letter set" is opaque without POST/STOP/SPOT/TOPS.

## Pages

1. **Welcome / Getting started.** Tiny orientation surface. May be a first-boot in-app slide deck, a static page, or both. Open question whether it stays as the slide-deck-tour shape from the earlier plan, or collapses into a single short page in Crosserville's GettingStarted style.

2. **FAQ.** Q&A format. Covers things people would actually ask: mental-model questions (*"What is rescoring?"*), dark-corner explainers (*"Why are some scores faded?"*), data questions (*"Where does my stuff live?"*), philosophy questions (*"Why doesn't Grawlix include wordlists out of the box?"*).

3. **Tips & tricks.** Discovery format. Did-you-know one-liners: *"Click a histogram bar to filter by score range," "Press F2 to rename a wordlist," "Stack URLs are shareable."* For things users wouldn't think to ask about because they don't know the feature exists.

4. **Tool explainer.** Long-form coverage of the genuinely complex tools — regex today, future Umiaq when it ships, possibly any tool whose query language can't be made intuitive in-app. Not a tour of every tool; just the ones that earn the page space.

5. **Rescoring.** Its own page. The hardest mental model in the app and a core feature. Earns dedicated treatment.

6. **Wordlists.** Importing, updating, downloading multiple wordlists. May get merged into the rescoring page (related — both live in the Library) or stay separate. Decide when we write it.

## Explicitly not doing

- **Wordlist file format page.** Not needed.
- **Keyboard shortcuts page.** Grawlix has very few shortcuts. Notable ones live as Tips entries.
- **A feature-by-feature manual.** The gallery covers per-tool docs; in-app labels and tooltips cover the rest.

## Open questions

- **In-app delivery shape.** Multi-page works as a content model, but how does it show up inside Grawlix? Modal with tabs, slide-out panel with a TOC, sidebar nav, etc. Punt until we know the content.
- **Welcome surface shape.** First-boot slide deck (with animated demos, as the earlier plan described) vs. a single static Getting Started page vs. both. Probably easier to answer after we draft one of the other pages and see what voice/format emerges.
- **Wordlists** as its own page vs. merged into Rescoring.
- **In-app text dependency.** The "fix the in-app text first" principle assumes the gallery's blurbs and the app's labels are already where they need to be. The tool gallery is on a separate redesign track ([`tools.md`](tools.md)) — its outcome shapes what the Tool-explainer page is left to cover.

## Carry-over from the earlier plan

One UX principle from the earlier design is worth keeping if/when any page includes animated demos: **demos should be built from the same builder functions and CSS classes as the live app, not hand-rolled lookalikes.** Otherwise they drift as the app evolves and start lying.

## Related

- [`tools.md`](tools.md) — tool gallery design and the parallel redesign track. The gallery's blurbs set the floor for what these docs *don't* need to cover.
- [`sync.md`](sync.md) — persistence and downloads, relevant to the FAQ and Wordlists pages.
