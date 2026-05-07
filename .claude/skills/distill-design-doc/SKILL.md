---
name: distill-design-doc
description: Convert a design doc into a feature record once the feature has shipped — present-tense documentation of what exists, with the whys behind it captured deliberately (since code preserves the what but not the why). Drops planning scaffolding (phases, framing, exhausted mockups). For user-facing features the result lands in `docs/manual.md`; for architectural choices it lands in `docs/design.md`. Invoke after a doc's feature is implemented and merged.
---

# Distill a design doc

A forward-looking design doc says "we will build X because Y." Once X is built, that framing is misleading: a new reader doesn't know whether the doc describes plans or reality. Your job is to convert the doc into a *record* — present-tense documentation of what exists and why it's shaped that way.

The plan doc in `docs/plans/` gets folded into the project's two living docs and then deleted. Its register shifts: speculative → descriptive, pitch → reference.

## Where the distilled content lands

There are two destinations, and most plans contribute to both:

- **[`docs/manual.md`](../../docs/manual.md)** — the user-facing surface. Approachable prose, written as the future in-app manual. Use the same names the UI uses; describe behavior the way a user experiences it. No rationale, no rejected alternatives — just the *what* from the user's vantage.
- **[`docs/design.md`](../../docs/design.md)** — the design record for contributors. The *why* behind the UI shape, architectural decisions, data invariants, cross-component contracts, what alternatives were considered and rejected, what constraints or past incidents drove the choice. These are invisible in code and easy to lose; capture them deliberately.

A single plan typically contributes to both. The user-visible behavior goes to `manual.md`; the rationale and architectural underpinnings go to `design.md`. Don't duplicate the description — `design.md` can reference `manual.md` for the *what* and focus on the *why*.

## What to keep

- **The feature itself, described.** Enough detail that someone who's never seen the code can understand the shape — what it does, how it presents, what its parts are. Don't aim for completeness; aim for orientation. User-visible behavior goes to `manual.md`; architectural shape goes to `design.md`.
- **The whys.** Why this shape and not another, what alternatives were considered and rejected, what constraints or past incidents drove the choice. These belong in `design.md`. Weave them alongside the architectural *what* — not in a separate decisions section, but as part of describing the shape.
- **Architectural context that aids understanding.** Data invariants, cross-component contracts, the load-bearing pieces that explain *how things hang together*. Keep what helps a reader form a mental model. → `design.md`.
- **Deferred ideas, open questions, brainstorming.** These haven't shipped, so they remain forward-looking. They can either stay in the plan doc (if it's a partial ship and the plan continues to live) or move to a clearly-labeled "Open questions" section in `design.md` (if the plan is fully retired). Don't blur present-tense and future-tense content.

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
- Specific over abstract: "two dialogs — Manage wordlists and Sync & backup" beats "configuration dialogs."
- Whys phrased as part of the description, not as a separate "decision" framing. *"Two dialogs because they answer different questions and shouldn't blur"* reads more naturally than *"Decision: two dialogs. Why: …"*.
- In `manual.md`, write to the user. In `design.md`, write to a contributor.

## Process

1. **Identify the doc.** If the user named one, read it. Otherwise ask which `docs/plans/*.md` doc they have in mind.
2. **Verify what actually shipped.** Read the relevant sections of `site/index.html` to confirm which parts of the doc describe live behavior, which parts didn't make it, and which parts shipped differently than planned. Don't trust the doc — it may be wrong about its own subject. Banner comments (`// ─── Section ───`) help locate the right region.
3. **Sort the content** into four buckets:
   - **User-facing surface** → fold into `docs/manual.md`.
   - **Architectural shape + whys** → fold into `docs/design.md`.
   - **Forward-looking** (deferred / open questions) → stays in the plan doc if it survives, or moves to a clearly-labeled "Open questions" section in `design.md` if the plan is fully retired.
   - **Drops out** (phasing, pitch, exhausted mockups, redundant implementation detail).
4. **Edit the destination files.** Read `docs/manual.md` and `docs/design.md` first; identify where the new content fits (existing section to extend, or new section to add). Match the existing tone and structure of each file rather than dropping in a self-contained block.
5. **Retire or trim the plan doc.** If the plan is fully shipped, `git rm docs/plans/X.md`. If partial, edit it down to just the unshipped pieces and label the split clearly.
6. **Update cross-references.** `grep -rn 'plans/X.md'` across `docs/`, `CLAUDE.md`, and `site/index.html`. Fix:
   - **`docs/README.md`** — remove the bullet from the *Plans* section if the plan is fully retired; keep it if partial.
   - **Sibling `docs/plans/*.md` files** — references to the retired plan should now point at `../design.md` (or the relevant section anchor) and/or `../manual.md`.
   - **CLAUDE.md and other top-level docs** — usually unaffected, but check.
7. **Confirm before overwriting.** Show the user (1) a short read of what the doc currently says vs. what shipped, (2) the proposed edits to `manual.md` and `design.md` in full, (3) what happens to the plan doc (delete vs. trim), (4) the cross-reference touch list. Wait for approval. Distillation removes content; reversible only via git.

## When not to distill

- **Partial ship.** The feature is half-implemented. Either wait until it's settled, or distill only the shipped pieces and leave the rest in the plan doc (label the split clearly).
- **No shipped content.** The doc is still a plan; nothing to record yet.
- **Multiple docs, one feature.** If the shipped work spans several design docs, distill them as a single pass so the surviving record is coherent rather than scattered.
