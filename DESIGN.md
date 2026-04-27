# Wordlist Manager — Design Document

## Vision

A browser-based tool for crossword constructors to import, rescore, and export wordlists. Constructors often juggle multiple public lists (XWordInfo, Spread the Wordlist, Peter Broda, etc.) alongside personal lists. Because these lists use incompatible scoring scales, merging them naively produces garbage fill quality. This tool normalizes and merges them into a single coherent list.

Goal: works great out of the box for most users, with enough knobs for power users.

---

## Core Features (MVP)

1. **Import** — load wordlists from local files or auto-download from known URLs
2. **Rescore** — apply user-defined score mapping rules to normalize a list's scale
3. **Merge** — combine lists in priority order; higher-priority list wins on conflicts
4. **Export** — download the result as a standard `word;score` file

---

## Wordlist Format

All supported lists use the same format: semicolon-separated, one entry per line.

```
word;score
word;score;comment
```

- Case-insensitive (normalize to uppercase on import)
- Comment field is ignored
- Words are A–Z only (standard crossword entries)

---

## Known Public Wordlists

| List | Availability | Score range | URL / notes |
|------|-------------|-------------|-------------|
| **jkugelman** | Free, GitHub | TBD | https://raw.githubusercontent.com/jkugelman/crossword/refs/heads/main/wordlists/jkugelman-wordlist.txt |
| **XWordInfo (XWI)** | Paid subscribers | ~0–100 | Requires login; see XWI Integration below |
| **Spread the Wordlist (STWL)** | Free download | ~0–100 | `https://drive.usercontent.google.com/download?id=1Ruxn8XzRNstU6sDPOMm_K72fVookrPPr&export=download` — CORS-accessible (`Access-Control-Allow-Origin: *`) |
| **Peter Broda** | Free | ~0–100 | TBD URL |

---

## Default Configuration

The page ships pre-configured with the four lists above in this priority order, with the recommended rescoring already set up. Users can adjust or add their own lists on top.

### Priority order (higher = wins on conflict)
1. jkugelman (no rescoring — master list, scores taken as-is)
2. XWordInfo (rescored, see below)
3. Spread the Wordlist (rescored, see below)
4. Peter Broda (rescored + filtered, see below)

### Recommended rescoring rules

**XWordInfo:**
```
60+ → 60
50–59 → 50
30–49 → 30
0–29 → 20
```

**Spread the Wordlist:**
```
50+ → 50
0–49 → (exclude)
```

**Peter Broda** (also filtered: only words ≥ 7 letters):
```
80+ → 60
0–79 → (exclude)
```
*Source: Sid Sivakumar's recommendation ([video](https://www.youtube.com/live/pfC5EZVki7A?si=w7f8sgVCdwlNEZbN&t=975))*

---

## Rescoring Rules

Users define rescoring as a list of rules mapping input score ranges to output scores. Rules are evaluated top-to-bottom; first match wins. Output can be a score or **exclude** (omit the word from the list entirely).

### Rule syntax

| Input side | Output side | Meaning |
|-----------|------------|---------|
| `60+` or `60-` | `60` | Score ≥ 60 → 60 |
| `50–59` | `50` | Score in range → 50 |
| `0` | `0` | Exact value → 0 |
| `*` | (exclude) | Catch-all → exclude |

Additional per-list filter: **minimum word length** (e.g., Broda: only words ≥ 7 letters).

### UI

Each list has an editable rules table:

```
[ 60+ ] → [ 60      ]
[ 50-59 ] → [ 50    ]
[ 30-49 ] → [ 30    ]
[ 0-29  ] → [ 20    ]
           [+ Add rule]
```

Live preview shows original score → new score for sample entries.

---

## Merging

Lists are merged in priority order. For each word, the highest-priority list that contains the word (after rescoring/filtering) provides the score. Lower-priority lists contribute words not already present.

- No complex conflict resolution — priority order is the only strategy.
- The merged result is what gets exported.

---

## List Management UX

- Lists displayed as a vertical stack, draggable to reorder (priority = top to bottom)
- Each list card shows: name, entry count, score range, source type, enabled/disabled toggle
- Clicking a list expands its detail panel: rescore rules, preview table, source info
- "Add list" options:
  - Upload a file (contents stored in `localStorage`)
  - Enter a URL to fetch
  - Pick from known lists (shows the preconfigured public lists)

---

## XWordInfo Integration

XWI is behind a subscriber paywall and cannot be auto-downloaded. Subscribers must download the file from XWordInfo and upload it manually.

- XWI appears in the default config as an upload slot with instructions
- No login flow, no credential storage, no "Refresh" button
- Same upload mechanism as any other local file

---

## Data Model

```
AppState {
  lists: List[]          // ordered by priority (index 0 = highest priority)
}

List {
  id: string
  name: string
  source: "upload" | "url" | "builtin-download"
  url?: string           // for auto-download lists
  rawEntries: Entry[]    // original parsed data, never mutated
  rescoreRules: Rule[]
  minWordLength?: number // additional filter (e.g., 7 for Broda)
  enabled: boolean
  cachedAt?: Date
}

Rule {
  inputMin: number | null   // null = no lower bound
  inputMax: number | null   // null = no upper bound
  outputScore: number | "exclude"
}

Entry {
  word: string        // uppercase, A–Z only
  score: number       // original score from file
}
```

Derived data (computed on the fly, not stored):
- `rescoredEntries` — entries after applying rules and length filter
- `mergedList` — final output combining all enabled lists in priority order

---

## Architecture

**Single-page, client-side only — no server**

- Pure HTML + JavaScript (no build step, works as a local file)
- `localStorage` for persistence: list contents, rescore rules, XWI credentials
- Large lists (100k+ entries) handled with:
  - Efficient in-memory Map for dedup/merge (word → score)
  - Virtual scrolling for any display table
- CORS: auto-download lists must be fetchable cross-origin; may need a simple proxy or rely on lists that allow it

---

## UI Layout (rough sketch)

```
┌──────────────────────────────────────────────────────────────┐
│  Wordlist Manager                          [Export Merged ▼] │
├──────────────────────────────────────────────────────────────┤
│  ≡ jkugelman            87,432 entries  All      [↓ Refresh] │
│  ≡ XWordInfo            92,100 entries  All      [↑ Upload]  │
│  ≡ Spread the Wordlist  55,000 entries  50+      [↓ Refresh] │
│  ≡ Peter Broda          12,300 entries  80+      [↓ Refresh] │
│                                                              │
│  [+ Add List]                                                │
├──────────────────────────────────────────────────────────────┤
│  ▼ XWordInfo (XWI)                                           │
│    Source: manual upload (XWI subscriber download)           │
│    Rescore rules:                                            │
│      60+ → 60    50–59 → 50    30–49 → 30    0–29 → 20       │
│    Preview: CROSSWORD 75 → 60  ENNUI 28 → 20  EELER 15 → 20  │
└──────────────────────────────────────────────────────────────┘
```

---

## Build Plan

### Phase 1 — Import & Display ✓
- [x] Parse `word;score` and `word;score;comment` format
- [x] Load from file upload; store in `localStorage`
- [x] Auto-download free lists (jkugelman GitHub, STWL)
- [x] Virtual-scroll table for large lists
- [x] Stats: entry count, score distribution

### Phase 2 — Rescore
- [x] Rule editor UI (add/remove/reorder rules)
- [x] Live preview of rule effects on sample entries
- [x] Minimum word length filter
- [x] Pre-populate rules for default lists

### Phase 3 — List Management
- [ ] Drag-and-drop reorder
- [ ] Enable/disable toggle per list
- [ ] Default config: four lists pre-wired with recommended rescoring

### Phase 4 — Merge & Export
- [ ] Priority-order merge (highest priority list wins)
- [ ] Merge stats (total entries, how many from each source)
- [ ] Export as `word;score` file
- [ ] Optional score floor on export

---

## Open Questions

1. ~~**CORS for auto-downloads**~~ — Resolved. Both jkugelman (GitHub raw) and STWL (Google Drive usercontent) serve `Access-Control-Allow-Origin: *`. Use the `drive.usercontent.google.com` URL directly for STWL to skip a 303 redirect hop.
2. ~~**XWI technical details**~~ — Resolved. XWI subscribers upload the file manually.
3. **Broda list URL** — where is the canonical download location?
