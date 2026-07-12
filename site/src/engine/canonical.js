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

import { toNorm } from './norm.js';
import { fetchJSON } from './lookup.js';

const WIKTIONARY_API = 'https://en.wiktionary.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

// ─── Reference queries (network; soft-fail to empty) ─────────────────────────

// Dedupes fetches within a session so re-resolving the same query is free — the
// plural short-circuit (§ ui/canonical.js) resolves the same query twice, once
// per norm. An empty/failed result is dropped so a transient miss re-fetches.
const fetchMemo = new Map();
function memo(key, fetcher) {
  const hit = fetchMemo.get(key);
  if (hit) return hit;
  const p = fetcher();
  p.then(r => { if (!r || r.length === 0) fetchMemo.delete(key); }, () => fetchMemo.delete(key));
  fetchMemo.set(key, p);
  return p;
}

// list=search, not opensearch: only the search index folds diacritics, so a bare
// query recovers accented titles (emigre → émigré) that prefix-matching opensearch
// never surfaces. Wiktionary titles are already true-case ($wgCapitalLinks off).
export function wiktionaryTitles(query) {
  return memo('wt:' + query, async () => {
    const url = `${WIKTIONARY_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=8&format=json&origin=*`;
    try {
      const data = await fetchJSON(url);
      return (data?.query?.search || []).map(s => s.title).filter(Boolean);
    } catch { return []; }
  });
}

export function wikipediaTitles(query) {
  return memo('wp:' + query, async () => {
    const url = `${WIKIPEDIA_API}?action=opensearch&search=${encodeURIComponent(query)}&limit=8&format=json&origin=*`;
    try {
      const data = await fetchJSON(url);
      return Array.isArray(data?.[1]) ? data[1] : [];
    } catch { return []; }
  });
}

export function wikipediaSummaryHTML(title) {
  return memo('ws:' + title, async () => {
    try {
      const data = await fetchJSON(WIKIPEDIA_SUMMARY + encodeURIComponent(title));
      return data?.extract_html || '';
    } catch { return ''; }
  });
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

export function pickSameNorm(titles, norm) {
  let best = null, bestScore = -1, bestDia = -1;
  for (const t of titles) {
    if (toNorm(t) !== norm) continue;
    const score = (hasInternalCap(t) ? 4 : 0) + (startsLowercase(t) ? 2 : 0) + (hasAccent(t) ? 1 : 0);
    // Tiebreak on diacritic count so the most complete accenting wins among
    // same-norm variants (naïveté over naïvete/naiveté).
    const dia = (t.match(/[^\x00-\x7f]/g) || []).length;
    if (score > bestScore || (score === bestScore && dia > bestDia)) {
      best = t; bestScore = score; bestDia = dia;
    }
  }
  return best;
}

export async function resolveWiktionary(query, norm) {
  return pickSameNorm(await wiktionaryTitles(query), norm);
}

// Strip a trailing corporate suffix or parenthetical the lead sometimes appends
// ("… Inc.", "… (company)") so the norm-guard sees just the name.
export function firstBold(html) {
  const m = /<b>([\s\S]*?)<\/b>/.exec(html);
  if (!m) return null;
  const text = m[1].replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
  return text.replace(/\s*(?:,?\s*(?:Inc|Ltd|LLC|Corp|Co)\.?|\([^)]*\))\s*$/, '').trim() || null;
}

// Trust a norm-matching bold lead verbatim: it carries true casing even against a
// force-capped title (title "MacOS" but "<b>macOS</b> is …"), because MediaWiki
// does not sentence-case the lead. With no matching bold, keep the force-capped
// title — Wiktionary already had first crack at genuinely-lowercase common words.
export function decideWikipediaForm(bold, title, norm) {
  return bold && toNorm(bold) === norm ? bold : title;
}

export async function resolveWikipedia(query, norm) {
  const titles = await wikipediaTitles(query);
  const title = titles.find(t => toNorm(t) === norm);
  if (!title) return null;
  const bold = firstBold(await wikipediaSummaryHTML(title));
  return decideWikipediaForm(bold, title, norm);
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
// nothing. Folding this into resolveCanonical's fallback would erase it.
export async function resolveReference(query, norm) {
  const [wiktionary, wikipedia] = await Promise.all([
    resolveWiktionary(query, norm),
    resolveWikipedia(query, norm),
  ]);
  return chooseCanonical(wiktionary, wikipedia);
}

export async function resolveCanonical(spaced, norm) {
  return (await resolveReference(spaced, norm)) ?? spaced;
}
