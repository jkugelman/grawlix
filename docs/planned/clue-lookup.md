# Clue lookup

A **Past clues** section in the entry panel that lists how an entry has been clued in published crosswords: every appearance, with its clue, publication, date, and author.
The data comes from the xd crossword corpus, built nightly into one small JSON file per answer and served from Cloudflare R2 behind a Worker.
It is Grawlix's first server-side component, and it stays within Cloudflare's free tier.

## The data source

The **xd corpus** is Saul Pwanson's archive of published crosswords in the plain-text [`.xd` format](https://github.com/century-arcade/xdformat/blob/master/doc/xd-format.md).
Its full form is **gxd**, a private GitLab repo (`gitlab.com/rabidrat/gxd`) holding one `.xd` file per puzzle, shelved by publication and year (`nytimes/2026/nyt2026-09-08.xd`).
Each file carries the puzzle's metadata headers (`Title`, `Author`, `Editor`, `Date`), its grid, and its clues as `A1. Clue text ~ ANSWER` lines.
Access is by invitation.

As of October 2026 gxd holds 147,766 puzzles from 1913 to the present across about 70 publications, with NYT complete from 1942.
It grows daily from an automated download job, and contributors are bulk-importing back catalogs.

The public `xd-clues.zip` on [xd.saul.pw](https://xd.saul.pw/data) is not a substitute.
It reduces every clue to `pubid  year  answer  clue`, sorted, so the puzzle, the date, and the author are unrecoverable.

## What a lookup returns

One JSON file per answer, keyed by the answer's norm (`oreo.json`).
Answers in xd are uppercase letters and digits, so lowercasing one yields exactly `toNorm`'s output and the key is a direct match for a Grawlix entry.

```json
[
  ["Double Stuf cookie","comm2026-10-07","Stella Zawistowski"],
  ["Cookie whose 2026 flavors include Reese's Peanut Buttery Creme Chocolate","latmidi2026-10-06","Bart Gold"],
  ["Cookie with a 14-Down Dynasty edition","usamidi2026-10-05","Amie Walker"],
  …]
```

Each row is one appearance of the answer in a puzzle: the clue text, the puzzle's `xdid`, and its author.
The `xdid` encodes the publication and date (`nyt2026-09-08`), so the row needs no separate date or publication field.
Rows are sorted newest first, and a file holds every appearance in the corpus.
A clue that ran forty times is forty rows; grouping repeats and counting them is the client's job (§ *In Grawlix*).

Measured over all of gxd:

| | Count / size |
|---|---|
| Rows (clue uses) | 10.6M |
| Files (distinct answers) | 412,454 |
| Total | 668 MB raw, 228 MB gzipped |
| Median file | 113 bytes |
| 99th-percentile file | 34 KB |
| Largest file | 664 KB (ERA, 10,682 rows) |

The largest files belong to crosswordese: ERA, AREA (572 KB), ONE (513 KB).
If their size becomes a problem, they get split into pages, never trimmed.
Either the build writes a long answer as numbered page files (`clues/era.json` holding the first page and a page count, then `clues/era.2.json`, …), or the Worker serves one file in pages.
The build-side split is the better default: the Worker's 10 ms CPU budget is tight for parsing a 664 KB file on every request.

Lookup is exact-entry only.
Searching clue text, pattern queries, or filtering by publication or date would need a database, not files (§ *Out of scope*).

## Metadata files

Alongside the clue files, the bucket holds the corpus metadata a clue row refers to, converted from gxd's repo-level TSVs to JSON.
The first is **`meta/publications.json`**, from `publications.tsv`: one record per publication (95 today), keyed by the `xdid` prefix.

```json
{"nyt":{"name":"New York Times","publisher":"","first":"1942-02-15","last":"today"},
 "comm":{"name":"Daily Commuter","publisher":"Tribune Content Agency","first":"2016-10-03","last":"today"}, …}
```

It turns `nyt2026-09-08` into "New York Times, Sep 8, 2026".
The file carries only the display columns (`PublicationName`, `PublisherName`, `FirstIssueDate`, `LastIssueDate`), leaving out `Contact` and `Sources`.
An `xdid` splits into its prefix and date by stripping the trailing `YYYY-MM-DD` (daily series) or `-NNN` (numbered series); some prefixes start with a digit (`7xw`).

The `meta/` directory is the home for any later metadata file, under the same build and upload path.
`pubregex.tsv` and `sources.tsv` drive the xd download pipeline and have no reader in Grawlix.

## Building the files

A Python script turns a gxd clone into the JSON files, run nightly by a launchd job on the maintainer's machine:

1. `git pull` in the gxd clone.
2. Parse every `.xd` file into a SQLite table of clue uses (answer, clue, puzzle), joined to a puzzles table (xdid, date, author).
   The xd pipeline's [`26-mkdb-sqlite.py`](https://github.com/century-arcade/xd/blob/master/scripts/26-mkdb-sqlite.py) does the same parse.
3. Write one JSON file per answer, holding all its uses newest first, into a local output directory, under `clues/`.
   Convert the metadata TSVs into `meta/`.
4. Hash each file against the hashes from the last successful upload, and write the changed and removed keys to a list.
5. Upload the changed files with `rclone copy --files-from`, and delete the removed ones.
6. Save the new hashes only after the upload succeeds, so a failed night retries everything it missed.

A full rebuild takes about two minutes; uploading only the changed files is what keeps it inside the free tier (§ *Free-tier budget*).
The job can move to a GitHub Action later, cloning gxd with a read-only GitLab deploy token.

Files are uploaded with `Content-Type: application/json` stored as object metadata, so the Worker can pass it through.

## Serving

An **R2 bucket** (`grawlix-clues`) holds the files.
It stays private: R2's public `r2.dev` URL is rate-limited and documented as development-only, with no caching or WAF.

A **Cloudflare Worker** bound to the bucket answers two routes:

- `GET /clues/<norm>` validates the norm against `^[a-z0-9]{1,40}$` and reads `clues/<norm>.json` from the bucket.
  A missing object is a 404, which Grawlix shows as "No clues found."
- `GET /meta/<name>` serves a metadata file, with `<name>` checked against the files the build writes.

Both routes share the same response handling:

- They set `Access-Control-Allow-Origin: https://grawlix.wtf` and `Cache-Control: public, max-age=86400`, so the browser reuses a response for a day.
- They answer `If-None-Match` with a 304, using the object's `httpEtag`.
  R2's documented example returns 412 for every failed precondition, which is wrong for `If-None-Match`, so this branch is written by hand.
- They rate-limit each client IP through the Workers Rate Limiting binding, around 60 requests a minute.
  The binding's counters are per Cloudflare location and approximate, which is enough to slow a scraper walking a wordlist.

The rate limit matters to the people who maintain the corpus: the clue text belongs to the puzzles' publishers, and the xd community is wary of anyone harvesting the archive into a copy.

### Where the Worker lives

The Worker starts on its `workers.dev` subdomain (`grawlix-clues.<account>.workers.dev`), which needs no DNS changes.
On `workers.dev` the Cache API has no effect, so every lookup reads from R2; the read allowance covers that many times over.

Moving it to `clues.grawlix.wtf` needs grawlix.wtf's DNS on Cloudflare.
Today the nameservers are at IONOS, pointing at GitHub Pages.
Moving them to Cloudflare's free plan keeps GitHub Pages as the origin, with the existing records left unproxied, and unlocks edge caching for the clue files and the zone's free rate-limiting rule.
The same move is what dynamic Open Graph previews for shared links need, so it's worth doing once, for both.

## In Grawlix

The entry panel's lookup card gains a **Past clues** section, fetched when the panel opens an entry.

- The fetch is a new source in `engine/lookup.js`, through the shared `responses` LRU and `requestJSON`'s 429 retry.
  A 404 is a real answer and stays cached, like the card's other sources.
- The section groups identical clue text into one line per clue, newest first, with its use count and its most recent publication and date, decoded from the `xdid`.
  Expanding a line lists every appearance with its publication, date, and author.
  Publication names come from `meta/publications.json`, fetched once per session alongside the first clue lookup.
  The section shows the first ten clues, with a control to reveal the rest.
- A credit line links the xd corpus.
- The fetch obeys the panel's existing request discipline: the walk gate and the drop on close ([`entry-panel.md`](../entry-panel.md) § *Loading and clearing*).

When it ships, the behavior moves to [`entry-panel.md`](../entry-panel.md), and the Help dialog gets a line about where the clues come from.

## Free-tier budget

Cloudflare's free limits, checked October 2026:

| Resource | Free allowance | Expected use |
|---|---|---|
| R2 storage | 10 GB-month | ~0.7 GB |
| R2 Class A ops (uploads) | 1M / month | ~412k for the first upload, then ~100k / month |
| R2 Class B ops (reads) | 10M / month | one per uncached lookup |
| R2 egress | free | — |
| Worker requests | 100k / day | one per uncached lookup |
| Worker CPU | 10 ms / request | a single R2 read |

Deletes are free.
A day of new puzzles touches a few thousand answers.
A bulk import of 10,000 puzzles touches roughly 150,000, still inside the month's uploads.
Re-uploading every file nightly would be ~12M uploads a month, twelve times the allowance, which is why step 4 of the build diffs before uploading.

Enabling R2 asks for a payment method even to stay on the free tier.

## Setup

1. A Cloudflare account with R2 enabled, and a bucket named `grawlix-clues`.
2. An R2 API token with Object Read & Write, scoped to the bucket, configured as an rclone remote (`type = s3`, `provider = Cloudflare`, endpoint `https://<account-id>.r2.cloudflarestorage.com`, `no_check_bucket = true`).
   Cloudflare's [rclone guide](https://developers.cloudflare.com/r2/examples/rclone/) has the config.
3. The first full upload with rclone (`wrangler r2 object put` uploads one object at a time).
4. The Worker, deployed with Wrangler 4.36 or later, which the rate-limit binding requires.
5. The launchd job.
6. The Grawlix entry-panel section.

## Out of scope

- **Clue-text search** ("which entries were clued with *cookie*?") and filters by publication or date.
  These need a queryable database: Cloudflare D1, or SQLite in a container on Google Cloud Run.
  D1's free tier allows 100k row writes a day, so loading the 10.6M rows would take over three months; Cloud Run holds the 602 MB SQLite file baked into its image.
- **Full grids or solvable puzzles.**
  The lookup serves clue text only.

## To verify during implementation

These weren't confirmed from Cloudflare's docs when this was written:

- That the Rate Limiting binding works on the Workers free plan (no page gates it; none says so).
- That the Cache API stays inert on `workers.dev` (a community answer says so; the docs say only that it works on custom domains).
- Whether Cloudflare's newer per-Worker cache setting (`cache.enabled`) works on `workers.dev` and the free plan, which would bring edge caching without the DNS move.
