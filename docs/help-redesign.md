# Help System Redesign

## Problem

The current help modal serves two masters: a welcome tour for new users and a reference guide for returning users. These have different needs and shouldn't share a container. The tour has also accumulated reference material (wildcard syntax) that muddled it.

## Two separate experiences

### 1. Welcome Tour

A quick, persuasive tour for first-time users. Not comprehensive — its job is to make the user understand why Grawlix exists and what they can do with it. Short and sweet throughout; each slide has one job.

**Triggered:** Automatically on first launch (existing behavior, keep as-is).  
**Re-triggered:** Via a "Take the quick tour →" link in the reference.

#### Slide structure (4 slides)

**Slide 1 — The Problem**  
Lead with the pain: popular wordlists use incompatible scoring scales. Make this concrete and visual — show the four known publishers side by side with their actual score ranges, ideally with real example entries pulled from the files themselves. The user should immediately recognize the problem if they've ever tried combining wordlists.

**Slide 2 — The Solution**  
Add lists, apply rescore rules to normalize them, merge. This absorbs what are currently two slides ("Building Your Wordlist" and "Making It Yours"). Keep it brief — the rescore and My Edits concepts don't need deep treatment here, just enough to convey the idea. Animated demo appropriate.

**Slide 3 — The Payoff**  
Download the merged list. This is the end goal of the wordlist-management use case. Dedicated slide, not mixed with search. Animated demo appropriate.

**Slide 4 — Searching**  
Search as a construction aid: filter by substring, score, patterns. Revert to the pre-wildcard version of this slide — short description plus the animated demo (the coolest demo so far). No wildcard reference table here; that belongs in the reference. This slide is a placeholder for a future cluster of slides covering more advanced wordlist manipulation (anagrams, beheadments, reversals, etc.) — keep it humble and open-ended.

#### Animated demos
Treat them as embedded video clips, not interactive components. They are high-maintenance for a human but manageable with AI assistance. Keep them in the tour; they are appropriate in the reference too if a section warrants one.

#### Use real UI components in demos
Demo markup must be built from the same builder functions and CSS classes as the live app — never hand-rolled lookalikes. A duplicated control that merely resembles the real one will quietly drift as the app evolves: a color changes, a class gets renamed, a badge gets restructured, and suddenly the demo shows something that no longer matches what the user sees. This principle is already followed in the existing demo code (e.g. `buildScoreBadgeHTML()` is called rather than inlining a hardcoded badge) and should be maintained throughout any rework.

---

### 2. Reference Guide

A manual for returning users who know the app and need to look something up. Opened by the `?` button (currently opens the tour — this changes).

**Format:** Single document or sectioned pages with sidebar navigation.  
**Tone:** Informative, not persuasive. Prose over flash.

#### Sections (figure out as we build)
At minimum: search syntax and wildcards. Other candidates: rescore rules, My Edits, priority/merge behavior, download formats.

**Includes a "Take the quick tour →" link** near the top.

---

## Future growth

A second major use case is planned: advanced wordlist manipulation and theme/idea generation (anagrams, beheadments, curtailments, word splits, reversals, regex operations — Wordlisted-style features). When this arrives, the tour will gain one or more slides after Slide 4 (Searching), and the reference will gain corresponding sections. Keeping tour slides tight now leaves room for this expansion without the whole thing feeling bloated.

No help content for these features needs to be built in advance.
