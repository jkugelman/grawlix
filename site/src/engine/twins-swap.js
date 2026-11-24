// Phonetic word swaps for Twins: two entries of two content words each whose
// words match crosswise by sound, the first of one against the second of the
// other (FRESH MEAT / MEET IN THE FLESH, BLUE CARBON / CORBIN BLEU).
import { PHONES } from './twins-sound.js';

// ─── Content words ───────────────────────────────────

const FUNCTION_WORDS = new Set(`a an the of and or nor but yet so for to too two in on at by with from into onto
upon off out up down over under about above below across after before against along among around as is it its
be been are was were am not no yes if than then that this these those there here my your his her our their me him
us them you he she we they who whom whose what which how why when where all any some each both one ones very just
do does did done has have had can could would shall should might must oh ah away back through thru like
via per vs`.split(/\s+/));
const MAX_TOKENS = 6;

// Only written word breaks count: the segmenter's splits of run-together
// entries made the swaps junk.
export function contentOf(display) {
  if (!/[\s-]/.test(display.trim())) return null;
  const toks = display.toLowerCase().normalize('NFD').replace(/[^a-z0-9' ]/g, ' ').trim().split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, '').replace(/'s$/, '')).filter(Boolean);
  if (toks.length < 2 || toks.length > MAX_TOKENS) return null;
  let w1 = -1, w2 = -1;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.length < 3 || FUNCTION_WORDS.has(t) || t.includes("'") || /^\d+$/.test(t)) continue;
    if (w1 < 0) w1 = k;
    else if (w2 < 0) w2 = k;
    else return null;
  }
  if (w2 < 0) return null;
  return [toks[w1], toks[w2]];
}

// ─── Word table ──────────────────────────────────────

const isVowel = (p) => /^[AEIOU]/.test(PHONES[p]);
const keysOf = (str, p) => {
  const skel = String.fromCharCode(...[...p].filter((x) => !isVowel(x)));
  let last = p.length - 1;
  while (last > 0 && !isVowel(p[last])) last--;
  return ['=' + str, 'K' + skel, 'P' + str.slice(0, 3), 'R' + str.slice(last)];
};

// The tool finds candidates through these keys, so the scorer only scores
// word pairs sharing one (shareKey): otherwise a pair could score that no
// query ever surfaces.
export function makeWordTable(readWord) {
  const words = new Map(), byKey = new Map();
  let bytes = 0;
  const add = (text) => {
    let w = words.get(text);
    if (w !== undefined) return w;
    const ph = readWord(text);
    w = ph && ph.p.length >= 2 ? { text, p: ph.p, s: ph.s, str: String.fromCharCode(...ph.p) } : null;
    words.set(text, w);
    bytes += 64 + 2 * text.length;
    if (!w) return w;
    w.keys = keysOf(w.str, w.p);
    w.vowels = String.fromCharCode(...[...w.p].filter(isVowel));
    bytes += 2 * w.p.length + 4 * 48;
    for (const k of w.keys) {
      let l = byKey.get(k);
      if (!l) byKey.set(k, (l = []));
      l.push(w);
    }
    return w;
  };
  return {
    add,
    has: (text) => words.has(text),
    get bytes() { return bytes; },
    alike(w, dist, max) {
      const out = new Map();
      if (!w) return out;
      for (const k of w.keys) for (const x of byKey.get(k) ?? []) {
        if (out.has(x.text)) continue;
        const d = dist(w, x);
        if (d <= max) out.set(x.text, d);
      }
      return out;
    },
  };
}

export const shareKey = (a, b) => a.keys.some((k) => b.keys.includes(k));
