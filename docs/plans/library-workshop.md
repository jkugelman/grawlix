# Library & Workshop nav

## What this is

Two top-level destinations exposed in the brand header: **Workshop** (tools and the merged wordlist view — what the app has shown until now) and **Library** (wordlist management — sources, rescore rules, scoring tiers, import/download). Equal prominence.

Order in the bar: Workshop first, Library second. Workshop is what most sessions are about and the default landing on every boot, so it sits in the leading position.

## Why now

Wordlist management used to live behind a small ⚙ button as the *Wordlists dialog*, on the premise that setup was occasional config you wouldn't return to often. Community feedback — including a fizzled communal rescoring app that showed serious shared interest in the topic — reset that premise. Rescoring and curating wordlists is a return-to activity, not just one-time setup. Promoting Library to a peer of Workshop matches how people actually want to use the app.

## Behavior

**Default landing = Workshop on every boot, including first run.** Publisher wordlists auto-fetch in the background, so the app is immediately useful for someone who shows up to look words up without thinking about wordlist management first. Library is *discovered* when a user wants to customize — import a personal wordlist, set up XWI, edit rescore rules, retier scores.

**Mode is in the URL.** Two sections don't strictly need URL state — sharing a `?view=library` link presumes the recipient cares about your config, which they don't — but future top-level sections (lookup, reference, etc.) will plausibly want linkability, and the URL schema should be ready before there are three of them and a migration. Persist to localStorage as a secondary write so reload preserves the last view when the URL is bare.

**Wordlist-settings ⚙ button goes away.** With Library as a top-level nav item, the dedicated entry point into wordlist management is the nav; the icon button next to the Workshop's wordlist picker is redundant. The slim top row stays on the Workshop side — wordlist picker only.

**Library content is the current Wordlists dialog, un-modalled.** Same two-pane layout (rail of wordlists on the left, focused-wordlist details on the right — action row, stats, rescore/scoring rules). Becomes a full page hosted by the Library tab rather than a modal opened over the Workshop.

## Placement

Library and Workshop sit in the **center of the brand header**, between the wordmark on the left and the settings / help icons on the right. The icons (heroicons `book-open` for Library, `wrench-screwdriver` simplified for Workshop) reinforce the "rooms you inhabit" framing — Library is where wordlists are shelved and tended; Workshop is where they're put to work.

The personal-text strip (tagline, byline, contact, GitHub) relocates from the brand bar's center to a quieter full-width subtitle row immediately below the header, on a darkened-purple band (`color-mix(in srgb, var(--hdr-bg) 70%, black)`). The strip is **non-sticky** — it scrolls away with the page so the working surface doesn't carry its weight on every screen — but it sets the homemade-with-love tone of the project on arrival. Demoting it to a subtitle keeps the tone without making it compete with nav for the eye-magnet center slot.

## "Header is brand chrome only" — amended

[`design.md`](../design.md) previously declared the brand header off-limits to controls. That rule was written to block per-wordlist state, sync indicators, and wordlist pickers from leaking into the brand bar — those would tie the header to ephemeral state. Top-level navigation is a different category: it's structural, not transient. GitHub, Linear, and Stripe all put their primary nav in the brand bar without it reading as control clutter. The amended rule is *brand chrome + top-level navigation*; per-wordlist state still stays out.

## Alternative considered

Putting the personal text in a **sticky footer** pinned to the bottom of the viewport, instead of a subtitle row in the header. The brand bar would stay a single row with just wordmark + nav + utility; the personal text would get its own dark band at the bottom of the viewport. The brand bar becomes more minimal at the cost of a permanent bottom band that the entries table has to clear on every screen.

Rejected because the in-chrome subtitle keeps the personal text continuous with the brand identity — it reads as "this is the project's voice" — without taxing the working surface with permanent footer chrome that mostly says nothing once a user has read it. Worth revisiting if the chrome ever feels too tall.

## Responsive / mobile

The desktop design ships first. Mobile owns its own session per [`mobile.md`](mobile.md); the natural translation of horizontal top-bar nav on mobile is a bottom tab bar, which keeps the same two-rooms model intact without disturbing the brand header. Whatever the mobile shell looks like, the Library/Workshop split should survive it — neither is dispensable on small screens.

## Phasing

The brand-bar chrome and inert nav buttons ship first. Making them live is follow-up work:

1. Wire the nav buttons to switch the main pane between Workshop and Library views.
2. Build the Library page as the un-modalled Wordlists dialog content.
3. Add URL state (`?view=library` / bare = Workshop) + localStorage persistence.
4. Remove the ⚙ wordlist-settings button from the Workshop's slim top row.
5. Remove the now-dead Wordlists dialog open path; the dialog component itself can stay until the Library page reuses its panes.

## Open questions

- **Future top-level destinations.** "Down the road" features that fit neither Library nor Workshop are anticipated but deliberately not designed here. The nav placement and URL schema should accommodate a third or fourth item without restructuring.
- **Library's own slim-top-row equivalent.** Workshop's slim top row holds the wordlist picker. Library may want a peer affordance (a focused-wordlist breadcrumb? an add-wordlist shortcut?) or may want nothing — to be settled when the Library page is built.
