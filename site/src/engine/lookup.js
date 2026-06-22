'use strict';

// ─── Entry lookup sources ───────────────────────────────────────────────────
//
// Every source has a `url` link-out; some also have a `fetch` that renders
// inline. Which ones can fetch is forced, not stylistic: a server-less static
// site can only read a response whose server sends permissive CORS headers, so
// only CORS-open APIs render inline — the link-out is the universal fallback.

const DATAMUSE = 'https://api.datamuse.com/words';
const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const DICTIONARY = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
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

// Pass the entry verbatim: Wikipedia capitalizes the first letter itself but is
// case-sensitive after it, so a display spelling like "Ana de Armas" must keep
// its case — lowercasing the tail turns real articles into 404s.
async function wikipediaLookup(entry) {
  let data;
  try {
    data = await fetchJSON(WIKI_SUMMARY + encodeURIComponent(entry));
  } catch (err) {
    if (err.status === 404) return { kind: 'prose', empty: true };
    throw err;
  }
  return {
    kind: 'prose',
    empty: !data.extract,
    title: data.title,
    description: data.description || '',
    extract: data.extract || '',
    thumbnail: data.thumbnail?.source || null,
    pageUrl: data.content_urls?.desktop?.page || null,
    disambiguation: data.type === 'disambiguation',
  };
}

async function dictionaryLookup(entry) {
  let data;
  try {
    data = await fetchJSON(DICTIONARY + encodeURIComponent(entry.toLowerCase()));
  } catch (err) {
    if (err.status === 404) return { kind: 'definitions', empty: true };
    throw err;
  }
  const meanings = [];
  for (const entry of data) {
    for (const m of entry.meanings || []) {
      meanings.push({
        pos: m.partOfSpeech || '',
        defs: (m.definitions || []).slice(0, 2).map(d => d.definition).filter(Boolean),
      });
    }
  }
  const phonetic = data.find(e => e.phonetic)?.phonetic || '';
  return { kind: 'definitions', empty: meanings.length === 0, word: data[0]?.word || entry, phonetic, meanings: meanings.slice(0, 5) };
}

export const LOOKUP_SOURCES = [
  { id: 'google', name: 'Google', url: entry => `https://www.google.com/search?q=${encodeURIComponent(entry)}` },
  { id: 'wikipedia', name: 'Wikipedia', fetch: wikipediaLookup, url: entry => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(entry)}` },
  { id: 'dictionary', name: 'Dictionary', fetch: dictionaryLookup, url: entry => `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.toLowerCase())}` },
  { id: 'synonyms', name: 'Thesaurus', fetch: synonymsLookup, url: entry => `https://www.merriam-webster.com/thesaurus/${encodeURIComponent(entry.toLowerCase())}` },
  { id: 'onelook', name: 'OneLook', url: entry => `https://www.onelook.com/?w=${encodeURIComponent(entry)}` },
  { id: 'xwordinfo', name: 'XWord Info', url: (entry, norm) => `https://www.xwordinfo.com/Finder?word=${encodeURIComponent(norm || '')}` },
];

export function getLookupSource(id) {
  return LOOKUP_SOURCES.find(s => s.id === id) || null;
}
