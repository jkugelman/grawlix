# Grawlix FAQ — candidate questions

A grab-bag of possible FAQ questions to pick from.

Markers: **[★ advertise]** = shows off a feature / nook. **[deep]** = needs a
real walkthrough, not a one-liner. **[fun]** = personality, not utility.

## The "what even is this" tier

1. **What is Grawlix, in one breath?** — *the elevator pitch: a browser
   wordlist manager that rescores everyone's lists onto one scale and merges
   them.*
2. **I already have a wordlist I like. Why would I want this?** — *the
   merge-many pitch; you don't replace your list, you combine it with others
   and keep your scores straight.* **[★]**
3. **Why is it called Grawlix?** — *a grawlix is the @#$%&! string comics use
   for swearing. Fun origin; ties to letters-and-symbols.* **[fun]**
4. **Is this a wordlist, a search tool, or what?** — *both: build a unified
   list (curate/rescore/merge/download) AND use it as a fill aid (search/tools
   while you construct). The two-activities framing.* **[★]**
5. **Do I need an account? Where does my stuff live?** — *no account, no
   server, no login; everything's in your browser on this device. Privacy
   answer.*
6. **Is it free? What's the catch?** — *free, runs in your browser, open
   source; the "catch" framing lets you be candid.*
7. **What's the absolute first thing I should try?** — *a "start here" answer —
   pick the one feature that hooks people (merge view? a tool? disk sync?).*
   **[★]**

## Rescoring & merging (the core mental model)

8. **Four wordlists all score the same word differently. Now what?** — *the
   problem Grawlix exists to solve; rescore-to-common-scale then merge.* **[★]**
9. **What's "rescoring" and why should I care?** — *the hardest idea in the
   app, worth a patient answer; map each list's arbitrary scale onto one shared
   one.* **[deep]**
10. **Do I *have* to rescore anything to use Grawlix?** — *no — raw scores pass
    through, nothing nags you; you can ignore the score column entirely.
    Important reassurance.*
11. **When I merge, why did the lower-scoring list win?** — *merge picks the
    highest-*priority* enabled list that has the word, not the highest score;
    priority = your list order. Common surprise.*
12. **What's "All Wordlists"?** — *the merged, deduped union you actually
    download and feed your software; the 95% view.*
13. **What are the score colors / tiers (great/good/fair/…)?** — *badge colors,
    hover for the tier name, customize the labels.* **[★]**
14. **The same word shows up twice — bug?** — *no: rich lists deliberately
    split spellings (theirs vs. "the IRS"); dark-corner explainer.*
15. **Can I see every list a word came from, even disabled ones?** — *the
    provenance popover: click an entry, see every wordlist's
    score/spelling/comment in priority order. A genuinely cool nook.* **[★]**

## My Edits

16. **What's "My Edits"?** — *your personal overlay list; every edit lands here,
    wins in the merge, never touches the source lists.*
17. **I rescored a word but it didn't change in the XWI view. Why?** — *edits
    live in My Edits and surface in All Wordlists, not in a single source's own
    scoped view. The "edit appears to vanish" gotcha.*
18. **I renamed a word from another list — where'd the old one go?** — *the
    downscore: Grawlix can't delete another list's copy, so it trashes the
    leftover (Trash score setting). Explains the previewed two-row change.*
19. **How do I add a word that's in none of my lists?** — *the ＋ button;
    pre-fills from your search.* **[★]**

## Disk sync (the big one)

20. **What is disk sync and why do I want it?** — *connect one list to one file
    your construction software already reads; no Grawlix folder, no
    re-pointing.* **[★][deep]**
21. **How do I set it up?** — *click the sync sign on the wordlist bar; My Edits
    = "use a file I already have"; All Wordlists = choose a file to write.*
    **[deep]**
22. **Which should I sync — My Edits or All Wordlists?** — *the two-way vs.
    one-way-out distinction; point your software at All Wordlists for the
    unified list, sync My Edits if you want your software to edit it back.*
    **[deep]**
23. **Walkthrough: wiring Grawlix into Ingrid.** — *you know the steps; Grawlix
    side + Ingrid side. The "it's a process, not just our UI" piece.* **[deep]**
24. **Walkthrough: wiring Grawlix into Crossfire.** — *same shape, Crossfire's
    wordlist-loading flow.* **[deep]**
25. **Walkthrough: wiring Grawlix into Crossword Compiler.** — *same shape.*
    **[deep]**
26. **Walkthrough: wiring Grawlix into Crosserville.** — *same shape; note the
    no-special-characters output-format gotcha for Crosserville.* **[deep]**
27. **Can Grawlix and my construction software edit the same file at once?** —
    *My Edits is two-way and merges 3-way; edits to different entries merge
    silently, true collisions prompt. Show-off the watch-and-merge.* **[★]**
28. **I edited the file in my software and Grawlix didn't react. What gives?** —
    *the ~2s poll; only My Edits is watched; mirror files are write-only.*
29. **It says "Sync conflict" — help.** — *the rare same-entry-both-sides case;
    Keep this device / Keep the file.*
30. **Why does it make me re-open my file every time I launch?** — *browser file
    permissions lapse; the reconnect splash, one click per file, "Skip" is
    safe.*
31. **Can I use the same wordlist across two computers?** — *put the synced file
    in Dropbox/iCloud/OneDrive/Drive, sync both devices to it; Grawlix ships no
    cloud code, your cloud client moves the bytes.* **[★]**
32. **Why is sync greyed out / missing on my phone / in Firefox / in Safari?** —
    *needs the File System Access API = Chromium desktop; everyone else uses
    Download. Sets expectations.*
33. **Where does Grawlix put its files? Is there a Grawlix folder?** — *no
    folder; it syncs the file *you* pick, in place. Counters the wrong mental
    model.*
34. **I don't trust browser storage — how do I not lose my work?** — *Download
    is the universal FSA-free backup; disk sync keeps a live file current.*

## Tools & chaining (the other big one)

35. **What's the deal with stacking tools?** — *the pipeline: each tool feeds
    the next, search is always the last step; live narrowing.* **[★]**
36. **Give me a genuinely useful tool-chain recipe.** — *the headline "show me
    something cool" answer; pick 2–3 concrete recipes below.* **[★][deep]**
37. **How do I anagram a pile of letters and then narrow it to fit a corner?** —
    *Anagram → search: type RETINAS into Anagram, then type the fixed crossing
    letters in the search bar to live-filter. The canonical chain.* **[★]**
38. **How do I find words that become other words when you chop off the
    front?** — *Behead (SWING → WING), optionally chain a search / score range.
    Theme-mining use case.* **[★]**
39. **How do I build a rhyme family for a theme set?** — *Rhymes in all-mode
    clusters your list into rhyme groups; add a score range so you only get good
    fill. Pronunciation-based, loose vs. strict.* **[★]**
40. **How do I find phrases hiding a word in their initials?** — *Initialisms
    all-mode: "the IRS" / "Tom Is Right" both land under TIS — and only surface
    if TIS is itself an entry (bidirectional pairs). Great theme generator.*
    **[★]**
41. **What's the ✱ / "all-mode" button do?** — *flip a tool from "filter to one
    value" to "show all clusters"; group rows. The feature people miss.* **[★]**
42. **How do I make a wordlist for a rebus puzzle?** — *the Rebus tool: squeeze
    a letter string into one symbol (BARSTOOL → BARSⓉ), download as a
    supplement.* **[★]**
43. **"Space out" — what is that?** — *guesses where the spaces go in a smushed
    entry (ABARRELOFLAUGHS → a barrel of laughs); needs the word-frequency dict;
    the Splits slider.* **[★]**
44. **Rhymes that actually rhyme?** — *matched on pronunciation not spelling
    (BLUE rhymes THROUGH; THROUGH doesn't rhyme ROUGH); multi-word rhymes on the
    last word. Show off the CMU-dict cleverness.* **[★]**
45. **Can search do find-and-replace?** — *the ▾ Replace field on Search/Regex
    turns a filter into a transform, keeping only results that are themselves
    real entries. Hidden gem.* **[★]**
46. **What's the difference between Search and Regex?** — *wildcards vs. full
    regex; both match letters-only AND as-written.*
47. **My search isn't finding "co-op" / "the IRS" / "résumé" the way I
    expect.** — *the dual-arm match: letters-only pass + as-written pass; typing
    separators narrows, omitting them is forgiving. Worth a clear answer.*

## Cool corners worth advertising

48. **Wait — the URL is shareable?** — *your whole tool stack + search ride in
    the URL; paste it in Discord and your friend sees the same pipeline on their
    lists. Underadvertised.* **[★]**
49. **Can I filter by score by dragging on the histogram?** — *click/drag across
    the histogram to set the score range; it's a control, not just a chart.*
    **[★]**
50. **Can I export just what I'm looking at?** — *the export menu: copy to
    clipboard (markdown), wordlist .txt, CSV, JSON — reflects your current
    filtered view.* **[★]**
51. **Any keyboard shortcuts?** — *Alt-T tools, Alt-S search, Alt-W whole-word,
    Alt-C score range, Alt-M dark mode. Tips-style.* **[★]**
52. **Can I control how entries get written out (spaces, accents,
    punctuation)?** — *the Output format setting; match what your software can
    read (e.g. strip specials for Crosserville).*
53. **Dark mode?** — *Auto/Light/Dark, Alt-M to cycle. Quick win.*
54. **Can I install Grawlix like an app?** — *it's a PWA; use the browser's
    install affordance. Minor but nice.*

## Philosophy / honest answers (Crosserville-style candor)

55. **Why doesn't Grawlix just come with the wordlists built in?** — *some are
    paywalled (XWI), all belong to their authors; Grawlix ships default *scores*
    and fetches what's freely available, you bring the rest. Honest answer.*
    **[★]**
56. **Who made the default wordlists? Can I thank them?** — *the Acknowledgements
    page; credit JK/XWI/STWL/Broda and Wordlisted for the tool inspiration.*
    **[fun]**
57. **Is scoring just… made up?** — *yes, it's subjective (Crosserville says the
    same); that's *why* per-list rescoring exists. Embrace it.* **[fun]**
58. **Should I use Grawlix instead of my construction software?** — *no — it's a
    companion; point your software at the merged file and keep filling where you
    fill. Willing-to-point-elsewhere honesty.*
59. **Workspace vs. sidekick — how are people actually using this?** — *two
    modes: living in Grawlix to generate themes, vs. popping over mid-fill to
    look something up. Frames the design.*
60. **Who made this / how do I report a bug or ask for a feature?** — *the
    byline + GitHub; closes the FAQ like Crosserville's does.* **[fun]**

## Maybe / lower priority

61. **Does it work offline?** — *online-only by choice (no service worker);
    short honest answer.*
62. **What file format do wordlists use?** — *ENTRY;SCORE per line; only if
    people actually ask — the manual covers it and help.md says skip a format
    page.*
63. **What browsers work?** — *runs everywhere; disk sync needs Chromium
    desktop. Overlaps the sync answer — maybe fold in.*
64. **Why do uppercase wordlists show up lowercase?** — *the per-file case
    convention; deliberate ALL-CAPS acronyms survive. Niche but a real "huh?".*
