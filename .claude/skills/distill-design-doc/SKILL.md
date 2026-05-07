---
name: distill-design-doc
description: Convert a design doc into a feature record once the feature has shipped — present-tense documentation of what exists, with the whys behind it captured deliberately (since code preserves the what but not the why). Drops planning scaffolding (phases, framing, exhausted mockups). For user-facing features the result is manual-adjacent reference material; for architectural choices it's living internal documentation. Invoke after a doc's feature is implemented and merged.
---

# Distill a design doc

A forward-looking design doc says "we will build X because Y." Once X is built, that framing is misleading: a new reader doesn't know whether the doc describes plans or reality. Your job is to convert the doc into a *record* — present-tense documentation of what exists and why it's shaped that way.

The doc moves from `docs/plans/` to `docs/designs/`, and its register shifts: speculative → descriptive, pitch → reference.

## What the result looks like

The distilled doc is documentation, written for whoever needs to understand the feature next — a future contributor, a future you, eventually a future user (if the feature is user-facing).

Two flavors, often mixed in one doc:

- **User-facing features** — the surface a user sees. Write approachably enough that the prose could later seed a reference-manual section. Use the same names the UI uses; describe behavior the way a user experiences it.
- **Architectural / under-the-cover** — the shape of the system: data model, contracts between components, invariants, the why of the layout. Not manual material, but the kind of thing a contributor needs to orient. More technical, still descriptive.

A single doc can cover both — the user-visible surface up top, the architectural underpinnings below.

## What to keep

- **The feature itself, described.** Enough detail that someone who's never seen the code can understand the shape — what it does, how it presents, what its parts are. Don't aim for completeness; aim for orientation.
- **The whys.** Why this shape and not another, what alternatives were considered and rejected, what constraints or past incidents drove the choice. These are invisible in code and easy to lose; capture them deliberately. Weave them alongside the *what* — not in a separate decisions section, but as part of describing the shape.
- **Architectural context that aids understanding.** Data invariants, cross-component contracts, the load-bearing pieces that explain *how things hang together*. Keep what helps a reader form a mental model.
- **Deferred ideas, open questions, brainstorming.** These haven't shipped, so they remain forward-looking. Group them under a clearly-labeled section so present-tense and future-tense content don't blur.

## What to drop

- **Phasing notes.** Order-of-operations for landing the work; exhausted once shipped. Git history captures the order.
- **Pitch / "what this is" framing.** The work exists. Don't justify why it was worth doing.
- **Mockups** unless they're still useful as a reference for the shipped UI shape.
- **Implementation sketches** that just narrate code structure the code already shows clearly.

## Keep vs. cut: shape over specifics

Conventional docs advice says to avoid duplicating information across docs and code because docs rot. That concern is less acute here — keeping docs aligned with code can be part of normal feature work — so don't strip detail purely to minimize surface area.

When deciding what stays: prefer descriptions of **shape** (architecture, contracts, invariants, the why of layout) and cut descriptions of **specifics** (exact function names, parameter lists, line counts that the code lists more clearly). Shape outlives implementation; specifics rot fastest.

## Tone

- Present tense for shipped content. Future-tense sections clearly labeled (e.g. *"Open questions"*, *"Future work"*).
- Direct and descriptive. Not a tutorial, not a sales pitch.
- Specific over abstract: "two dialogs — Manage sources and Sync & backup" beats "configuration dialogs."
- Whys phrased as part of the description, not as a separate "decision" framing. *"Two dialogs because they answer different questions and shouldn't blur"* reads more naturally than *"Decision: two dialogs. Why: …"*.

## Process

1. **Identify the doc.** If the user named one, read it. Otherwise ask which `docs/plans/*.md` doc they have in mind.
2. **Verify what actually shipped.** Read the relevant sections of `site/index.html` to confirm which parts of the doc describe live behavior, which parts didn't make it, and which parts shipped differently than planned. Don't trust the doc — it may be wrong about its own subject. Banner comments (`// ─── Section ───`) help locate the right region.
3. **Sort the content** into three buckets: becomes the new body (description + whys), stays as forward-looking (deferred / open questions), drops out (phasing, pitch, exhausted mockups, redundant implementation detail).
4. **Rewrite the doc.** Move `docs/plans/X.md` to `docs/designs/X.md` (`git mv`). If the doc's scope has narrowed enough that the filename no longer fits, propose a rename in the same step.
5. **Update cross-references.** `grep -rn 'X.md'` across `docs/`, `CLAUDE.md`, and `site/index.html`. Fix:
   - **`docs/README.md`** — move the bullet from the *Plans* section to the *Designs* section, update the link target.
   - **Sibling `docs/plans/*.md` files** — references that were `[X](X.md)` become `[X](../designs/X.md)`. References from inside the moved doc to its plan-siblings flip the other way: `[Y](Y.md)` becomes `[Y](../plans/Y.md)`.
   - **CLAUDE.md and other top-level docs** — usually unaffected, but check.
6. **Confirm before overwriting.** Show the user (1) a short read of what the doc currently says vs. what shipped, (2) the proposed rewritten doc in full, (3) the cross-reference touch list, (4) any rename. Wait for approval. Distillation removes content; reversible only via git.

## When not to distill

- **Partial ship.** The feature is half-implemented. Wait until it's settled, or distill only the shipped pieces and leave the rest forward-looking (and label the split clearly).
- **No shipped content.** The doc is still a plan; nothing to record yet.
- **Multiple docs, one feature.** If the shipped work spans several design docs, distill them as a single pass so the surviving record is coherent rather than scattered.
