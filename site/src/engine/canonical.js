'use strict';

// ─── Canonical-form resolver ─────────────────────────────────────────────────
//
// Re-spells an already-spaced crossword phrase to its real-world canonical form
// (casing, accents, stylization) via Wiktionary and Wikipedia. Every reference
// form is gated by norm-equality: a candidate is accepted only if `toNorm` maps
// it back to the entry's own norm. Drop that guard and the resolver silently
// starts substituting different words and collapsing inflections onto their
// lemmas (`has designs on` would take `have designs on`); with it, the worst
// case is an unchanged spelling.

import { toNorm, FOLD_MAP } from './norm.js';
import { fetchJSON, fetchWikipediaSummary } from './lookup.js';

const WIKTIONARY_API = 'https://en.wiktionary.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

// ─── Reference queries (network; soft-fail to empty) ─────────────────────────

// A 404 means "no such resource" — a genuine empty answer. Anything else (429,
// 5xx, network) is a failure that must propagate, so the resolver can tell "the
// source has nothing" from "the source didn't answer" and refuse to cache/finalize
// a result built on a missing fetch (§ ui/canonical.js).
function emptyOn404(err, empty) {
  if (err.status === 404) return empty;
  throw err;
}

// list=search, not opensearch: only the search index folds diacritics, so a bare
// query recovers accented titles (emigre → émigré) that prefix-matching opensearch
// never surfaces. Wiktionary titles are already true-case ($wgCapitalLinks off).
async function wiktionaryTitles(query) {
  const url = `${WIKTIONARY_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=8&format=json&origin=*`;
  try {
    const data = await fetchJSON(url);
    return (data?.query?.search || []).map(s => s.title).filter(Boolean);
  } catch (err) { return emptyOn404(err, []); }
}

async function wikipediaTitles(query) {
  const url = `${WIKIPEDIA_API}?action=opensearch&search=${encodeURIComponent(query)}&limit=8&format=json&origin=*`;
  try {
    const data = await fetchJSON(url);
    return Array.isArray(data?.[1]) ? data[1] : [];
  } catch (err) { return emptyOn404(err, []); }
}

// ─── Casing / stylization predicates (pure) ──────────────────────────────────

export function hasAccent(s) { return /[^\x00-\x7f]/.test(s); }
export function startsLowercase(s) { return /^\p{Ll}/u.test(s); }
// A capital following a lowercase with no break — the camelCase signal of a
// stylized brand (macOS, eBay); broadening it would misread space-separated Title
// Case as internal-cap and flip chooseCanonical's tie-break.
export function hasInternalCap(s) { return /\p{Ll}\p{Lu}/u.test(s); }
export function isTitleCase(s) {
  return s.split(/\s+/).slice(1).some(w => /^\p{Lu}/u.test(w));
}

// ─── Richness comparison ─────────────────────────────────────────────────────

const hasFoldChar = s => { for (const c of s) if (FOLD_MAP[c] !== undefined) return true; return false; };

// Relies on the caller excluding FOLD_MAP chars: each alnum char then contributes
// exactly one norm char, the 1:1 letter alignment isRicher walks (ß/æ norm to two
// and would desync it). Yields aligned letters + the punctuation/space gaps between.
function parseRichness(s) {
  const letters = [];
  const gaps = [{ space: false, punct: new Map() }];
  for (const ch of s.normalize('NFC')) {
    const d = ch.normalize('NFD');
    const base = d[0];
    if (base >= '0' && base <= '9' || base >= 'A' && base <= 'Z' || base >= 'a' && base <= 'z') {
      letters.push({ base: base.toLowerCase(), upper: base >= 'A' && base <= 'Z', marks: new Set(d.slice(1)) });
      gaps.push({ space: false, punct: new Map() });
    } else if (/\s/.test(ch)) {
      gaps[gaps.length - 1].space = true;
    } else {
      const p = gaps[gaps.length - 1].punct;
      p.set(ch, (p.get(ch) || 0) + 1);
    }
  }
  return { letters, gaps };
}

// The rename hint's gate on an already-rich entry: true only when `candidate` adds
// capitals, accents, or punctuation and removes none — enrich (`helen of troy →
// Helen of Troy`, `well being → well-being`) but never strip a deliberate capital
// or accent (the reported `Zoe → zoé`). Spaces are structural, not richness: they
// may be added or swapped for punctuation. Caller guarantees toNorm-equality;
// false is the safe default, so a fold char or length mismatch bails false.
export function isRicher(candidate, current) {
  if (candidate === current || hasFoldChar(candidate) || hasFoldChar(current)) return false;
  const a = parseRichness(current), b = parseRichness(candidate);
  if (a.letters.length !== b.letters.length) return false;
  let added = false;
  for (let i = 0; i < a.letters.length; i++) {
    const x = a.letters[i], y = b.letters[i];
    if (x.base !== y.base) return false;            // different letter → not the same word
    if (x.upper && !y.upper) return false;          // capital removed
    if (y.upper && !x.upper) added = true;          // capital added
    for (const m of x.marks) if (!y.marks.has(m)) return false;  // accent removed
    if (y.marks.size > x.marks.size) added = true;  // accent added
  }
  for (let i = 0; i < a.gaps.length; i++) {
    const g = a.gaps[i], h = b.gaps[i];
    if (h.space && !g.space) added = true;          // space added (removing one is fine — spaces aren't richness)
    let want = 0, have = 0;
    for (const [p, n] of g.punct) { want += n; if ((h.punct.get(p) || 0) < n) return false; }  // punct removed
    for (const n of h.punct.values()) have += n;
    if (have > want) added = true;                  // punct added
  }
  return added;
}

export function pickSameNorm(titles, norm, prefer) {
  let best = null, bestScore = -1, bestDia = -1;
  for (const t of titles) {
    if (toNorm(t) !== norm) continue;
    const score = (hasInternalCap(t) ? 4 : 0) + (startsLowercase(t) ? 2 : 0) + (hasAccent(t) ? 1 : 0);
    const dia = (t.match(/[^\x00-\x7f]/g) || []).length;
    // Rank by richness, then most-complete accenting (naïveté over naïvete). A form
    // Wikipedia also returned (`prefer`) breaks a still-exact tie toward the
    // corroborated diacritic — `Gdańsk` over an equally-scored `Gdaňsk` that merely
    // sorted first — but only as the last tiebreak, never overriding a richer form.
    const better = score > bestScore
      || (score === bestScore && dia > bestDia)
      || (score === bestScore && dia === bestDia && t === prefer && best !== prefer);
    if (better) { best = t; bestScore = score; bestDia = dia; }
  }
  return best;
}

// Strip a trailing corporate suffix or parenthetical the lead sometimes appends
// ("… Inc.", "… (company)") so the norm-guard sees just the name. `atStart` marks a
// bold opening the extract, whose leading capital is the sentence's and says nothing
// about the term — only a mid-sentence bold's is the term's own. Tag-stripped rather
// than a literal `<p><b>`, or a wrapper (`<p><i><b>Café au lait</b></i>`) reads as
// mid-sentence and re-trusts the very capital this distinguishes.
export function leadBold(html) {
  const m = /<b>([\s\S]*?)<\/b>/.exec(html);
  if (!m) return { text: null, atStart: false };
  const text = m[1].replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
  return {
    text: text.replace(/\s*(?:,?\s*(?:Inc|Ltd|LLC|Corp|Co)\.?|\([^)]*\))\s*$/, '').trim() || null,
    atStart: !/\S/.test(html.slice(0, m.index).replace(/<[^>]+>/g, '')),
  };
}

// Prefer a norm-matching bold lead: it carries true casing even against a force-capped
// title (title "MacOS" but "<b>macOS</b> is …"). With no matching bold, keep the
// force-capped title — Wiktionary already had first crack at genuinely-lowercase
// common words. How far the winner is trusted is the caller's call: only its leading
// capital is ever in doubt, and only when the bold opened the sentence.
export function decideWikipediaForm(bold, title, norm) {
  return bold && toNorm(bold) === norm ? bold : title;
}

// ─── The leading capital ─────────────────────────────────────────────────────
//
// Wikipedia force-caps every article title ($wgCapitalLinks), so a Wikipedia-derived
// form's FIRST letter is the one character carrying no information — every other
// capital in it is real.

// Each exclusion protects a form that would be corrupted, not merely mis-cased:
// a single word has no corroborating evidence (`Zeus` is as plausible as `zeus`),
// a later capital confirms the leading one (`Helen of Troy`), and an off-position
// capital means lowercasing position 0 mangles it (`DNA sequencer` → `dNA sequencer`).
export function firstLetterUncertain(form) {
  const [head, ...rest] = form.split(/\s+/);
  if (!rest.length) return false;
  if (!/^\p{Lu}/u.test(head) || /\p{Lu}/u.test(head.slice(1))) return false;
  return !isTitleCase(form);
}

// `wordlistDisplay` is displayOf() for the first word's norm, or null when no enabled
// source carries it. Absent KEEPS the capital: against corpora of hundreds of thousands
// of entries, a first word in none of them is likelier a proper noun or foreign term
// than a common one. Only the leading letter is ruled on — adopting the wordlist's
// spelling wholesale would flatten a resolved `Café au lait` through a bare `cafe` row.
export function settleFirstLetter(form, wordlistDisplay) {
  if (!wordlistDisplay || /^\p{Lu}/u.test(wordlistDisplay)) return form;
  return form[0].toLowerCase() + form.slice(1);
}

// `caseOf` (async norm → display) is worker-owned, so it arrives injected; without it
// every uncertain capital stands.
async function resolveWikipedia(query, norm, caseOf) {
  const titles = await wikipediaTitles(query);
  const title = titles.find(t => toNorm(t) === norm);
  if (!title) return null;
  const bold = leadBold((await fetchWikipediaSummary(title)).extractHtml);
  const form = decideWikipediaForm(bold.text, title, norm);
  // A sentence-initial bold still settles the spelling — accents, internal caps,
  // punctuation — but forfeits its leading capital to the ladder below.
  const trusted = bold.text && toNorm(bold.text) === norm && !bold.atStart;
  if (trusted || !firstLetterUncertain(form)) return form;
  const head = toNorm(form.split(/\s+/)[0]);
  return settleFirstLetter(form, caseOf ? await caseOf(head) : null);
}

// ─── Resolution ──────────────────────────────────────────────────────────────

// Wiktionary wins ties; Wikipedia is taken only when it alone caught a stylized
// internal cap (macOS over a flat wiktionary "macos").
export function chooseCanonical(wiktionary, wikipedia) {
  if (wiktionary && wikipedia) {
    return hasInternalCap(wikipedia) && !hasInternalCap(wiktionary) ? wikipedia : wiktionary;
  }
  return wiktionary ?? wikipedia;
}

// null (no same-norm match) vs a returned form is the signal the whole-word
// suppressor needs: a word that matched unchanged differs from one that found
// nothing. Defaulting the null to the query here would erase that distinction.
export async function resolveReference(query, norm, caseOf) {
  // Both fetches in parallel, then pick Wiktionary's form with Wikipedia's as the
  // corroboration tiebreak (§ pickSameNorm): Wikipedia's curated article title
  // resolves a diacritic ambiguity Wiktionary's cross-language search can't.
  const [wtTitles, wikipedia] = await Promise.all([
    wiktionaryTitles(query),
    resolveWikipedia(query, norm, caseOf),
  ]);
  const wiktionary = pickSameNorm(wtTitles, norm, wikipedia);
  return chooseCanonical(wiktionary, wikipedia);
}
