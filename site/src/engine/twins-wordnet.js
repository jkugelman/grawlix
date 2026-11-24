// Meaning links for Twins, read from site/data/twins-wordnet.txt
// (scripts/gen-twins-wordnet.js has the format): two words are related
// when any lemma of one shares a key with any lemma of the other.

const SUFFIX = {
  n: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  v: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  a: [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e']],
  r: [],
};
const STOP = new Set('a an the of and or to in on at for by is it be as'.split(' '));

export function parseRelations(text) {
  const lemmas = new Map(), exc = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split(' ');
    if (f[0][0] === '=') { exc.set(f[0].slice(1), f.slice(1)); continue; }
    lemmas.set(f[0], { pos: f[1], keys: Int32Array.from(f.slice(2), (k) => parseInt(k, 36)) });
  }
  return { lemmas, exc };
}

export function makeRelations({ lemmas, exc }) {
  const lemmaCache = new Map(), relCache = new Map();
  function lemmasOf(w) {
    const hit = lemmaCache.get(w);
    if (hit) return hit;
    const u = w.toLowerCase().replace(/ /g, '_'), out = [];
    const take = (b) => { const l = lemmas.get(b); if (l && !out.includes(l)) out.push(l); };
    take(u);
    for (const b of exc.get(u) ?? []) take(b);
    for (const [p, rules] of Object.entries(SUFFIX)) {
      for (const [suf, rep] of rules) {
        if (!u.endsWith(suf) || u.length <= suf.length + 1) continue;
        const b = u.slice(0, -suf.length) + rep;
        if (suf === 'es' && !rep && !/(s|x|z|ch|sh|o)$/.test(b)) continue;
        if (lemmas.get(b)?.pos.includes(p)) take(b);
      }
    }
    if (lemmaCache.size > 500000) lemmaCache.clear();
    lemmaCache.set(w, out);
    return out;
  }
  function related(a, b) {
    const key = a + '|' + b;
    const hit = relCache.get(key);
    if (hit !== undefined) return hit;
    const la = lemmasOf(a), lb = lemmasOf(b);
    let r = false;
    for (const x of la) for (const y of lb) {
      if (x === y) { r = true; break; }
      for (const k of x.keys) if (y.keys.includes(k)) { r = true; break; }
      if (r) break;
    }
    if (relCache.size > 1000000) relCache.clear();
    relCache.set(key, r);
    return r;
  }
  const tokens = (e) => e.spaced.toLowerCase().replace(/[^a-z0-9 \-]/g, '').split(/[\s-]+/).filter((w) => w && !STOP.has(w));

  // A link between two prepped entries, over their whole phrases and every
  // pair of words they don't share, as { why } or null.
  return function entryRelation(q, e) {
    const ta = tokens(q), tb = tokens(e), sa = new Set(ta), sb = new Set(tb);
    if ((ta.length > 1 || tb.length > 1) && related(ta.join('_'), tb.join('_'))) return { why: `${ta.join('_')}~${tb.join('_')}` };
    for (const x of ta) for (const y of tb)
      if (!sb.has(x) && !sa.has(y) && x.length > 3 && y.length > 3 && related(x, y)) return { why: `${x}~${y}` };
    return null;
  };
}

// ─── Asset ───────────────────────────────────────────

export const WORDNET_IDB_KEY = 'twins_wordnet_text';
export const WORDNET_SIZE_KEY = 'twins_wordnet_size';
let io = null, relations = null, loading = null;

export function configureRelationsIO({ idbGet, idbPut, url }) { io = { idbGet, idbPut, url }; }

export const wordnetAsset = {
  get url() { return io?.url; },
  get: () => relations,
  has: () => !!relations,
  invalidate() { relations = null; loading = null; },
  async load() {
    if (relations) return;
    if (!loading) loading = (async () => {
      let text = await io.idbGet(WORDNET_IDB_KEY);
      if (typeof text !== 'string') {
        const resp = await fetch(io.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        text = await resp.text();
        await io.idbPut(WORDNET_IDB_KEY, text);
        const size = resp.headers.get('content-length');
        if (size) await io.idbPut(WORDNET_SIZE_KEY, size);
      }
      relations = makeRelations(parseRelations(text));
    })();
    try { await loading; } finally { if (!relations) loading = null; }
  },
};
