'use strict';

// ─── Entry lookup sources ───────────────────────────────────────────────────
//
// Every source has a `url` link-out; some also have a `fetch` that renders
// inline. Which ones can fetch is forced, not stylistic: a server-less static
// site can only read a response whose server sends permissive CORS headers, so
// only CORS-open APIs render inline — the link-out is the universal fallback.

import { LruCache } from '../core/lru.js';

const DATAMUSE = 'https://api.datamuse.com/words';
const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const WIKTIONARY_DEF = 'https://en.wiktionary.org/api/rest_v1/page/definition/';

// Sharing one cache across every endpoint is load-bearing for the summary URL:
// the rename hint and the Wikipedia card read the same response here, and
// separate fetches would let them silently diverge. A 404 stays cached — it's a
// real answer — while a transient failure (429, 5xx, network) is evicted so the
// next access retries.
const responses = new LruCache(300, 60 * 60 * 1000);

export function fetchJSON(url) {
  const hit = responses.get(url);
  if (hit) return hit;
  const p = requestJSON(url, 1);
  p.catch(err => { if (err.status !== 404) responses.delete(url); });
  responses.set(url, p);
  return p;
}

async function requestJSON(url, retries) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  // One polite retry on rate-limiting (honoring Retry-After, capped) so a
  // transient 429 doesn't turn into a degraded, sticky lookup result.
  if (res.status === 429 && retries > 0) {
    const after = parseInt(res.headers.get('retry-after'), 10);
    await new Promise(r => setTimeout(r, Math.min(2000, (after > 0 ? after : 1) * 1000)));
    return requestJSON(url, retries - 1);
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function synonymsLookup(entry) {
  const data = await fetchJSON(`${DATAMUSE}?max=18&rel_syn=${encodeURIComponent(entry.toLowerCase())}`);
  return { kind: 'words', words: data.map(d => d.word).filter(Boolean) };
}

// Title passed verbatim — case-sensitive past the first letter, so lowercasing
// it would 404 proper nouns. A 404 is a real empty.
export async function fetchWikipediaSummary(title) {
  let data;
  try {
    data = await fetchJSON(WIKI_SUMMARY + encodeURIComponent(title));
  } catch (err) {
    if (err.status === 404) return { empty: true, extractHtml: '' };
    throw err;
  }
  return {
    empty: !data.extract,
    title: data.title,
    description: data.description || '',
    extract: data.extract || '',
    extractHtml: data.extract_html || '',
    thumbnail: data.thumbnail?.source || null,
    pageUrl: data.content_urls?.desktop?.page || null,
    disambiguation: data.type === 'disambiguation',
  };
}

async function wikipediaLookup(entry) {
  return { kind: 'prose', ...(await fetchWikipediaSummary(entry)) };
}

// Definitions from Wiktionary's structured REST endpoint — the same source the
// resolver and the link-out use, so one dictionary can't disagree with another.
// Pass the entry verbatim (the resolved spelling): the page is case-sensitive
// past the first letter, so lowercasing it 404s proper nouns.
async function wiktionaryLookup(entry) {
  let data;
  try {
    data = await fetchJSON(WIKTIONARY_DEF + encodeURIComponent(entry));
  } catch (err) {
    if (err.status === 404) return { kind: 'definitions', empty: true };
    throw err;
  }
  const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
  const strip = s => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const meanings = (data.en || []).map(sec => ({
    pos: sec.partOfSpeech || '',
    defs: (sec.definitions || []).slice(0, 2).map(d => strip(d.definition || '')).filter(Boolean),
  })).filter(m => m.defs.length);
  return { kind: 'definitions', empty: meanings.length === 0, word: entry, phonetic: '', meanings: meanings.slice(0, 5) };
}

export const LOOKUP_SOURCES = [
  { id: 'google', name: 'Google', url: entry => `https://www.google.com/search?q=${encodeURIComponent(entry)}` },
  { id: 'wikipedia', name: 'Wikipedia', fetch: wikipediaLookup, url: entry => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(entry)}` },
  { id: 'wiktionary', name: 'Wiktionary', fetch: wiktionaryLookup, url: entry => `https://en.wiktionary.org/wiki/${encodeURIComponent(entry)}` },
  { id: 'synonyms', name: 'Thesaurus', fetch: synonymsLookup, url: entry => `https://www.merriam-webster.com/thesaurus/${encodeURIComponent(entry.toLowerCase())}` },
  { id: 'onelook', name: 'OneLook', url: entry => `https://www.onelook.com/?w=${encodeURIComponent(entry)}` },
  { id: 'xwordinfo', name: 'XWord Info', url: (entry, norm) => `https://www.xwordinfo.com/Finder?word=${encodeURIComponent(norm || '')}` },
];

export function getLookupSource(id) {
  return LOOKUP_SOURCES.find(s => s.id === id) || null;
}
