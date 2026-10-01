---
name: distill-design-doc
description: Convert a design doc into a feature record once the feature has shipped — present-tense documentation of what exists, with the whys behind it captured deliberately (since code preserves the what but not the why). Drops planning scaffolding (phases, framing, exhausted mockups). The result lands in `docs/design.md` or the subsystem doc that owns the area, user-visible behavior and whys together. Invoke after a doc's feature is implemented and merged.
---

# Distill a design doc

A forward-looking design doc says "we will build X because Y." Once X is built, that framing is misleading: a new reader doesn't know whether the doc describes plans or reality.
Your job is to convert the doc into a *record* — present-tense documentation of what exists and why it's shaped that way.

The plan doc in `docs/planned/` gets folded into the living doc that owns its area and then deleted.
Its register shifts: speculative → descriptive, pitch → reference.

## Where the distilled content lands

The docs are written for Claude agents working on the repo, and each area has one owning doc that holds both what the feature does as the user sees it and why it is built that way:

- **[`docs/design.md`](../../docs/design.md)** — the design record: the shell, the gallery and the per-tool designs, the entries table, URL state, code structure.
- **The subsystem docs** listed at the top of `design.md` (`wordlists.md`, `entry-panel.md`, `pipeline.md`, `segmenter.md`, `umiaq.md`, and others) take the content for their area.

Write the user-visible behavior (exact UI labels, defaults, edge cases, examples that pin down semantics) next to the whys, in the same section, so the two can't drift apart.
The user-facing documentation is the in-app Help dialog (`ui/dialogs/help.js`); if the feature changes something an FAQ answer explains, update that answer too, brief and non-technical.

## What to keep

- **The feature itself, described.**
  Enough detail that someone who's never seen the code can understand the shape — what it does, how it presents, what its parts are.
  Don't aim for completeness; aim for orientation.
  User-visible behavior and architectural shape both go in the owning doc.
- **The whys.**
  Why this shape and not another, what alternatives were considered and rejected, what constraints or past incidents drove the choice.
  Weave them alongside the architectural *what* — not in a separate decisions section, but as part of describing the shape.
- **Architectural context that aids understanding.**
  Data invariants, cross-component contracts, the load-bearing pieces that explain *how things hang together*.
  Keep what helps a reader form a mental model.
- **Deferred ideas, open questions, brainstorming.**
  These haven't shipped, so they remain forward-looking.
  They can either stay in the plan doc (if it's a partial ship and the plan continues to live) or move to a clearly-labeled "Open questions" section in the owning doc (if the plan is fully retired).
  Don't blur present-tense and future-tense content.

## What to drop

- **Phasing notes.**
  Order-of-operations for landing the work; exhausted once shipped.
  Git history captures the order.
- **Pitch / "what this is" framing.**
  The work exists.
  Don't justify why it was worth doing.
- **Mockups** unless they're still useful as a reference for the shipped UI shape.
- **Implementation sketches** that just narrate code structure the code already shows clearly.

## Keep vs. cut: shape over specifics

Conventional docs advice says to avoid duplicating information across docs and code because docs rot.
That concern is less acute here — keeping docs aligned with code can be part of normal feature work — so don't strip detail purely to minimize surface area.

When deciding what stays: prefer descriptions of **shape** (architecture, contracts, invariants, the why of layout) and cut descriptions of **specifics** (exact function names, parameter lists, line counts that the code lists more clearly).
Shape outlives implementation; specifics rot fastest.

## Tone

- Present tense for shipped content.
  Future-tense sections clearly labeled (e.g. *"Open questions"*, *"Future work"*).
- Direct and descriptive.
  Not a tutorial, not a sales pitch.
- Specific over abstract: "two dialogs — Manage wordlists and Sync & backup" beats "configuration dialogs."
- Whys phrased as part of the description, not as a separate "decision" framing.
  *"Two dialogs because they answer different questions and shouldn't blur"* reads more naturally than *"Decision: two dialogs.
  Why: …"*.
- Write to a contributor, not to an end user.

## Process

1. **Identify the doc.**
   If the user named one, read it.
   Otherwise ask which `docs/planned/*.md` doc they have in mind.
2. **Verify what actually shipped.**
   Read the relevant modules under `site/src/` to confirm which parts of the doc describe live behavior, which parts didn't make it, and which parts shipped differently than planned.
   Don't trust the doc — it may be wrong about its own subject.
   Banner comments (`// ─── Section ───`) help locate the right region.
3. **Sort the content** into three buckets:
   - **What shipped** (user-visible behavior, architectural shape, whys) → fold into the owning doc.
   - **Forward-looking** (deferred / open questions) → stays in the plan doc if it survives, or moves to a clearly-labeled "Open questions" section in the owning doc if the plan is fully retired.
   - **Drops out** (phasing, pitch, exhausted mockups, redundant implementation detail).
4. **Edit the destination files.**
   Read the owning doc first; identify where the new content fits (existing section to extend, or new section to add).
   Match its existing tone and structure rather than dropping in a self-contained block.
5. **Retire or trim the plan doc.**
   If the plan is fully shipped, `git rm docs/planned/X.md`.
   If partial, edit it down to just the unshipped pieces and label the split clearly.
6. **Update cross-references.**
   `grep -rn 'planned/X.md'` across `docs/`, `CLAUDE.md`, and `site/src/`.
   Fix:
   - **`CLAUDE.md`** — the doc index lives in the *Before non-trivial work* section.
     Remove the bullet if the plan is fully retired; update the one-liner if partial.
   - **Sibling `docs/planned/*.md` files** — references to the retired plan should now point at the owning doc's section (``[`design.md`](../design.md) § *Heading*``).
   - **Other top-level docs** — usually unaffected, but check.

## When not to distill

- **Partial ship.**
  The feature is half-implemented.
  Either wait until it's settled, or distill only the shipped pieces and leave the rest in the plan doc (label the split clearly).
- **No shipped content.**
  The doc is still a plan; nothing to record yet.
- **Multiple docs, one feature.**
  If the shipped work spans several design docs, distill them as a single pass so the surviving record is coherent rather than scattered.
