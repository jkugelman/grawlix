# Planned: entries-table editing — beyond the shipped walk

**Phase 1 and the entry-panel walk have shipped.** Phase 1 gave the flat tier full keyboard nav, multi-select, and batch rescore/delete; the walk then made the open panel steppable — **Prev/Next** (Alt+↑/↓ / PageUp/Down) reseeds it to a neighbouring entry without closing, auto-committing as you move, bounded to a multi-selection (kept highlighted as you step) or walking the table in order. The current entry's family rides a separate *Related entries* section, not the walk itself. Both are living documentation now: the architecture and whys are in [`design.md`](../design.md) § *Keyboard navigation & multi-select* (see *Walking a set from the panel*), the user-facing behavior in [`manual.md`](../manual.md) §§ *Selecting rows* / *Editing entries*. Selection is keyed on the atom's `(norm, display)` identity throughout, precisely so the items below are **additive** — an extension of the shipped state, not a rewrite.

What remains here is forward-looking: the parked extensions (§1) and the bulk-editing stretch goal that motivates the whole effort (§2). The stretch goal has no design yet; its concrete real-world cases are captured verbatim so a future design round starts from real material.

## §1. Parked / longer term

- **Multi-atom tiers (transform, group).** The selection model already generalizes — the atom is the selectable unit, and a flat row is the one-atom case — so what's deferred is only the *rendering / ARIA / scroll* for atoms-within-rows. A chain row (`RELEARNING → ELEARNING → LEARNING → EARNING`) is four different real entries, each independently editable, so a row is the wrong granularity for an edit action: you never want one Alt+# to slam all four to a tier. Open questions when built: (a) ARIA row-vs-atom — a chain row reads as one search result but holds several editable atoms, so is the row a `role="group"` of `option`s, or the row an `option` with atom-targeting underneath? (b) sub-row scroll-into-view (bring an *atom* into view within a tall group row); (c) the group tier's `+N more` reveal — navigating into a hidden member must auto-expand it (`GroupMorePopover`). Low urgency: the editing workflow lives in the flat tier; the exploration tiers are for *finding* words, where edits are occasional.
- **Multi-entry panel editor (shared fields).** The per-member *walk* has shipped (edit each member in turn, one open); what remains is editing a selection's **shared** fields at once — one comment template, one score across the set — the deep-edit counterpart to the shallow batch shortcuts. Only worth more than batch rescore already gives once there's a comment-templating model (§2), which is where the walk's serial loop stops being enough.
- **"Select this family" affordance.** The panel already *shows* the current entry's family in its Related entries section; what's parked is promoting that family to a bounded **selection** in one gesture (click the family bracket, or a key on a member). It's the sort-proof way to walk a whole family — a selection stays a coherent set under any sort, and now stays highlighted as the walk steps it, where a table walk scatters under a Score sort. The worker already ships `familyStarts` and the scroller brackets each family run under the Entry sort ([`design.md`](../design.md) § *Family-grouping bracket*), so the pieces are in place; it only helps *already-spaced* families, so it complements, not replaces, the non-contiguous multi-select.
- **Type-ahead jump** — type a prefix to jump to the next matching entry. A classic listbox aid, handy for the family workflow, but it overlaps the search bar — probably last, if at all.

The **bulk-editing stretch goal** these all build toward — the pain that motivates the whole effort — has its own section (§2).

## §2. Stretch goal: bulk editing of related entries (no design yet)

This is the motivating pain. When curating, you routinely edit a handful of *related* entries — almost always a word family — with changes that are *parallel but not identical*. There's no design for it yet; this section captures the concrete cases (dug out of real curation history) so a future design round starts from real material instead of re-deriving it.

Two recurring shapes:
1. **Apply the same structural transform to each entry's text** — spacing, punctuation. The transform is conceptually shared but the result differs per member, so it isn't one find/replace.
2. **Attach a similar-but-agreeing comment to each** — pluralized, conjugated, or possessive to match the entry. The comment isn't a mechanical copy.

Multi-select + batch rescore (shipped) is the first primitive and handles the *easy* half: a shared score across the set writes identically to every member. The hard, unsolved half is shape 2 — a comment template that **bends to agree with each entry** (singular/plural, verb tense) is a genuine linguistic problem, deliberately left open here.

A twist that makes it awkward, and the reason **non-contiguous multi-select** shipped in phase 1 rather than being deferred: an **unspaced** family isn't detected as a family until it's spaced (the family sort clusters spelled words, not concatenations), so the very entries you most want to batch are sorted *apart* and unbracketed — a manual multi-pick is the only way to gather them.

### Space out entries

The entries arrive concatenated; each wants the same spacing, but where the spaces land differs per member:

```
hasagraspon -> has a grasp on
hadagraspon -> had a grasp on
haveagraspon -> have a grasp on
havingagraspon -> having a grasp on

breakoutintosong -> break out into song
breaksoutintosong -> breaks out into song
brokeoutintosong -> broke out into song
breakingoutintosong -> breaking out into song
brokenoutintosong -> broken out into song

notarizedstatement -> notarized statement
notarizedstatements -> notarized statements
```

### Add punctuation

Same shape — a shared punctuation change (hyphen, apostrophe), member-specific text:

```
brownbagger -> brown-bagger
brownbaggers -> brown-baggers

tryonesbest -> try one's best
triesonesbest -> tries one's best
triedonesbest -> tried one's best
tryingonesbest -> trying one's best
```

### Conjugation-matched comments

Attach a comment to each entry that agrees with its number and tense — pluralized nouns, conjugated verbs. The score is shared across the set (batch rescore covers that), but the *comment* has to bend to each entry:

```
cromlech;40;Megalithic construction made of large stone blocks
cromlechs;40;Megalithic constructions made of large stone blocks

dracaena;30;Plant with woody stems and funnel-shaped flowers
dracaenas;30;Plants with woody stems and funnel-shaped flowers

get plowed;50;Get drunk / Vulgar
gets plowed;50;Gets drunk / Vulgar
getting plowed;50;Getting drunk / Vulgar
got plowed;50;Got drunk / Vulgar

hard asset;50;Physical item with intrinsic value
hard assets;50;Physical items with intrinsic value

pet passport;60;Official document that records information about a specific animal as part of travel procedures
pet passports;60;Official documents that record information about specific animals as part of travel procedures
```

The agreement isn't a single-word swap: "construction → constructions" and "records information about a specific animal → record information about specific animals" both change more than one word, and "Get drunk → Gets drunk → Getting drunk → Got drunk" tracks the verb form across four entries.

### Name-variant comments

Full-name / first-name / last-name variants of one referent, each wanting a comment phrased for that form (the referent is shared; the phrasing shifts with which variant it labels):

```
Margrethe;40;Margrethe II, queen of Denmark from 1972 to 2024
Margrethe II;40;Queen of Denmark from 1972 to 2024
Queen Margrethe;50;Queen of Denmark from 1972 to 2024
```

### Shape of a solution (open)

No design is committed. The **panel walk** (step through a selection or the table without closing, auto-committing per entry) has shipped and is the near-term win — it already makes these serial edits materially faster. The building blocks still parked in §1 are the **multi-entry panel editor** (edit a selection's *shared* fields at once) and the **"select this family" affordance**. The genuinely unsolved piece is the conjugation-aware comment template: it could be as modest as a fill-in-the-blank template the user tweaks per row, or as ambitious as auto-conjugation from a linguistic model — that call belongs to its own design round. The walk carries the serial workflow until then; bulk is the horizon.
