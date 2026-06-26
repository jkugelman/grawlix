'use strict';

// Maps each entry to a "family key" so inflectional relatives (cat/cats,
// eat/ate/eaten) share a key and sort adjacent. Anchored against the wordlist's
// own vocabulary, not a fixed dictionary, so out-of-dictionary crossword fill
// still reduces to a base that actually appears in the list.

import { toNorm } from './norm.js';

// ─── Irregulars ──────────────────────────────────────────────────────────────
// base → its irregular surface forms (the regular ones are derived by rule).
const IRREGULAR_VERBS = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had'], do: ['does', 'did', 'done'], go: ['goes', 'went', 'gone'],
  say: ['said'], make: ['made'], take: ['took', 'taken'], come: ['came'],
  see: ['saw', 'seen'], know: ['knew', 'known'], get: ['got', 'gotten'],
  give: ['gave', 'given'], find: ['found'], think: ['thought'], tell: ['told'],
  become: ['became'], show: ['shown'], leave: ['left'], feel: ['felt'],
  bring: ['brought'], begin: ['began', 'begun'], keep: ['kept'], hold: ['held'],
  write: ['wrote', 'written'], stand: ['stood'], hear: ['heard'], mean: ['meant'],
  meet: ['met'], run: ['ran'], pay: ['paid'], sit: ['sat'],
  speak: ['spoke', 'spoken'], lead: ['led'], grow: ['grew', 'grown'],
  lose: ['lost'], fall: ['fell', 'fallen'], send: ['sent'], build: ['built'],
  understand: ['understood'], draw: ['drew', 'drawn'], break: ['broke', 'broken'],
  spend: ['spent'], rise: ['rose', 'risen'], drive: ['drove', 'driven'],
  buy: ['bought'], wear: ['wore', 'worn'], choose: ['chose', 'chosen'],
  seek: ['sought'], throw: ['threw', 'thrown'], catch: ['caught'], deal: ['dealt'],
  win: ['won'], forget: ['forgot', 'forgotten'], eat: ['ate', 'eaten'],
  fight: ['fought'], fly: ['flew', 'flown'], hang: ['hung'], sell: ['sold'],
  shoot: ['shot'], sing: ['sang', 'sung'], sink: ['sank', 'sunk'],
  swim: ['swam', 'swum'], teach: ['taught'], drink: ['drank', 'drunk'],
  ring: ['rang', 'rung'], swear: ['swore', 'sworn'], tear: ['tore', 'torn'],
  blow: ['blew', 'blown'], freeze: ['froze', 'frozen'], steal: ['stole', 'stolen'],
  ride: ['rode', 'ridden'], bite: ['bit', 'bitten'], hide: ['hid', 'hidden'],
  shake: ['shook', 'shaken'], wake: ['woke', 'woken'], beat: ['beaten'],
  bend: ['bent'], feed: ['fed'], flee: ['fled'], shine: ['shone'],
  shrink: ['shrank', 'shrunk'], slide: ['slid'], spin: ['spun'],
  spring: ['sprang', 'sprung'], stick: ['stuck'], sting: ['stung'],
  strike: ['struck'], sweep: ['swept'], weep: ['wept'], bleed: ['bled'],
  breed: ['bred'], cling: ['clung'], dig: ['dug'], kneel: ['knelt'],
  light: ['lit'], slay: ['slew', 'slain'], spit: ['spat'], weave: ['wove', 'woven'],
};
const IRREGULAR_NOUNS = {
  child: ['children'], man: ['men'], woman: ['women'], person: ['people'],
  foot: ['feet'], tooth: ['teeth'], goose: ['geese'], mouse: ['mice'],
  louse: ['lice'], ox: ['oxen'], die: ['dice'], penny: ['pence'],
  leaf: ['leaves'], loaf: ['loaves'], knife: ['knives'], wife: ['wives'],
  life: ['lives'], half: ['halves'], calf: ['calves'], shelf: ['shelves'],
  wolf: ['wolves'], thief: ['thieves'], cactus: ['cacti'], fungus: ['fungi'],
  nucleus: ['nuclei'], radius: ['radii'], stimulus: ['stimuli'],
  analysis: ['analyses'], basis: ['bases'], crisis: ['crises'], thesis: ['theses'],
  diagnosis: ['diagnoses'], phenomenon: ['phenomena'], criterion: ['criteria'],
  datum: ['data'], medium: ['media'], bacterium: ['bacteria'],
  curriculum: ['curricula'],
};
const IRREGULARS = new Map();
for (const table of [IRREGULAR_VERBS, IRREGULAR_NOUNS]) {
  for (const [base, forms] of Object.entries(table)) {
    for (const form of forms) IRREGULARS.set(form, base);
  }
}

const ARTICLES = new Set(['a', 'an', 'the']);

// ─── Reduction ───────────────────────────────────────────────────────────────

function undouble(s) {
  return /([bcdfghjklmnpqrstvwxz])\1$/.test(s) ? s.slice(0, -1) : s;
}

function candidates(word) {
  const set = new Set([word]);
  const add = s => { if (s && s.length >= 2) set.add(s); };
  if (word.endsWith('ies') && word.length > 4) { add(word.slice(0, -3) + 'y'); add(word.slice(0, -2)); }
  if (word.endsWith('ied') && word.length > 4) add(word.slice(0, -3) + 'y');
  if (word.endsWith('es') && word.length > 3) { add(word.slice(0, -2)); add(word.slice(0, -1)); }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) add(word.slice(0, -1));
  if (word.endsWith('ed') && word.length > 3) { add(word.slice(0, -2)); add(word.slice(0, -1)); add(undouble(word.slice(0, -2))); }
  if (word.endsWith('ing') && word.length > 4) { add(word.slice(0, -3)); add(word.slice(0, -3) + 'e'); add(undouble(word.slice(0, -3))); }
  return set;
}

// Irregulars resolve to base first; without that, men/ate have no shorter
// candidate and silently split from man/eat.
function reduceToken(word, vocab) {
  const base = IRREGULARS.get(word);
  if (base !== undefined) return base;
  let best = null;
  for (const cand of candidates(word)) {
    if (cand !== word && cand.length < word.length && vocab.has(cand)
        && (best === null || cand.length > best.length)) best = cand;
  }
  return best;
}

// ─── Family key ──────────────────────────────────────────────────────────────

function tokenize(text) {
  return text.split(/\s+/).map(toNorm).filter(Boolean);
}

export function familyTokens(text) {
  const tokens = tokenize(text);
  while (tokens.length > 1 && ARTICLES.has(tokens[0])) tokens.shift();
  return tokens;
}

export function familyKey(text, vocab) {
  const tokens = familyTokens(text);
  if (!tokens.length) return text.toLowerCase();
  return tokens.map(t => reduceToken(t, vocab) ?? t).join(' ');
}

export function collectVocab(texts) {
  const vocab = new Set();
  for (const text of texts) {
    for (const token of tokenize(text)) vocab.add(token);
  }
  return vocab;
}
