# Mobile design

## What this is

Grawlix on phones. Most of the actual design is open — this doc captures *that* mobile support will be built, why it matters, and the few directional choices already made. The bulk of the work is deferred to its own dedicated design session.

---

## Why mobile matters

**Theme-research-on-the-go is a real workflow.** Constructors think of theme ideas in the wild — on the subway, while reading the crossword Discord, anywhere away from their main desk — and want to research them before the idea evaporates. Today, without mobile Grawlix, they hold the idea until they get home. With mobile Grawlix, they can act on it.

Secondary mobile use is opportunistic filling-adjacent lookups: phone in hand, quick wordplay or definition question, look it up.

This isn't "responsive fallback" or polite degradation — it's a primary use case that justifies designing the mobile experience to be *good*, not just tolerable.

---

## Settled

- **Mobile support will be built**, not declined.
- **Wordlisted-shape on mobile** — empty canvas at idle, hero input near the top, results scroll below. No persistent left rail (it doesn't fit on a phone), no tool stack metaphor — single tool at a time, with chaining likely cut entirely (confirm at design time).
- **Different shape from desktop is acceptable.** The desktop's always-visible-table principle does not transfer — mobile lands the user on a hero input with no results until they engage, which is conceptually different from desktop.
- **Tool picker + search are likely the two primary affordances** at the entry point, though their layout is open.
- **No separate tablet design.** Tablets are handled by a width-based responsive breakpoint (~900px or wherever the desktop rail starts feeling cramped):
  - ≥ breakpoint → desktop layout
  - < breakpoint → mobile layout
  - iPad landscape → desktop. iPad portrait → mobile. Surface and 2-in-1 laptops → desktop. Phones → mobile.
- **Touch accommodations on the desktop layout are a separate audit pass** — they apply equally to touch-screen laptops as to tablets-in-landscape, so they aren't a "tablet" problem. Hover-revealed affordances ("+" badge, edit pencils, drag-handle hover styling, tooltips) need touch fallbacks. Defer the audit until the desktop design is solid.

---

## Open questions

To answer in the dedicated mobile design session:

- **Feature scope.** Does mobile carry everything from desktop, or a stripped-down set? Possible cuts: rescore rule editing, rule-heavy curation flows, multi-list reordering. Possible essentials: search, single-tool mining, lookups, basic My Edits viewing, maybe quick add-to-My-Edits.
- **Tool gallery presentation.** With no rail, how does the user pick a tool? Top-of-page menu, bottom drawer, tap-to-open category strip, full-screen tool picker overlay, ...? The Category-picker decision on desktop doesn't transfer cleanly.
- **Entry point layout.** What does a mobile user see on first load? Tool picker plus search are probably the two main things, but their relative prominence and layout is open. Hero input with a tool-picker button next to it? Tool picker overlay first, then input?
- **Lookups on mobile.** The subway/Discord scenario probably wants definitions, Wikipedia, NYT crossword history more than letter-pattern wordplay. Should the mobile entry point bias toward lookup-style features? Or does lookup live as one tool category alongside the others?
- **My Edits / curation on mobile.** Is editing scores and comments part of the mobile use case, or strictly read-only mining? Filling-side rescoring on desktop is a sidekick gesture; on mobile, the surrounding context (filling at a desk) usually doesn't apply.
- **Source dropdown on mobile.** No rail means no obvious place for the Wordlist section's source dropdown + sync indicator. Header? In-page section? Hidden behind a settings affordance since most users won't switch sources often?
- **Manage sources / Sync & backup dialogs on mobile.** Today these are desktop modals. On mobile they'd presumably go full-screen — at which point they're effectively routes. Worth revisiting "Setup as routes" specifically for mobile — see [`app.md`](../designs/app.md) "Open: setup as routes."

---

## Anti-features

Mobile inherits the project-level non-features from [`app.md`](../designs/app.md) (no mining-state persistence, no cross-list comparison, etc.). One mobile-specific addition: **no separate tablet design** — tablets fall on one side or the other of the responsive breakpoint, per "Settled" above.

---

## Phasing

Mobile will be its own design session, then its own implementation phase. It's not a prerequisite for any current desktop work, and current desktop work is not a prerequisite for it — they can proceed in parallel once the desktop shell is far enough along to lock in the shared model (sources, rescore rules, My Edits, persistence). Touch-accommodation audit on the desktop layout happens between desktop polish and mobile build.
