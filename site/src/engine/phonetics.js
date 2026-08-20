'use strict';

export const CMU_DICT_URL = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';
export const CMU_DICT_IDB_KEY = 'cmu_dict_decoded';
export const CMU_DICT_SIZE_KEY = 'cmu_dict_size';

let _idbGet = null;
let _idbPut = null;

export function configureIO({ idbGet, idbPut }) {
  _idbGet = idbGet;
  _idbPut = idbPut;
}

// Pronunciations are stored space-joined ('K AE1 T'), not as token arrays:
// structured-clone de-interns token arrays across the IDB round-trip, bloating
// them on every cache-hit load.
let cmuDict = null;
let cmuLoadPromise = null;

export function hasCmuDict() { return !!cmuDict; }

export function invalidateCmuDict() {
  cmuDict = null;
  cmuLoadPromise = null;
}

export function setCmuDict(map) {
  cmuDict = map instanceof Map ? map : new Map(Object.entries(map));
  cmuLoadPromise = null;
}

const cmuKey = word => word.toUpperCase().replace(/[^A-Z]/g, '');

function lastWord(text) {
  const tokens = text.split(/[\s-]+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i]) return tokens[i];
  }
  return '';
}

// 'loose' anchors the rhyme on the last stress of either rank, 'strict' only on the
// primary — so cumberbatch's secondary -batch rhymes with match under loose, not strict.
// Stress stripped so a secondary anchor still matches a primary under loose (dynamite ~ kite).
export function rhymingPart(pron, mode = 'loose') {
  const toks = pron.split(' ');
  let start = -1;
  for (let i = toks.length - 1; i >= 0; i--) {
    const last = toks[i][toks[i].length - 1];
    if (last === '1' || (mode !== 'strict' && last === '2')) { start = i; break; }
  }
  const tail = start >= 0 ? toks.slice(start) : toks;
  return tail.join(' ').replace(/\d/g, '');
}

export function rhymingPartsOf(text, mode = 'loose') {
  if (!cmuDict) return [];
  if (mode === 'whole') return wholeEntryParts(text);
  const prons = cmuDict.get(cmuKey(lastWord(text)));
  if (!prons) return [];
  const parts = new Set();
  for (const pron of prons) parts.add(rhymingPart(pron, mode));
  return [...parts];
}

// ─── Syllables & whole-entry rhyme ───────────────────────────────────────────

// Onsets English allows word-initially, kept to the native clusters. CMU also
// attests loanword ones (SH W, S V, K N, T S); admitting them would pull a
// consonant off a coda word-internally — ASH-ley read as A-shley — silently
// dropping a coda the whole-entry rhyme is keyed on.
const LEGAL_ONSETS = new Set([
  'P R', 'B R', 'T R', 'D R', 'K R', 'G R',
  'P L', 'B L', 'K L', 'G L',
  'T W', 'D W', 'K W', 'G W',
  'P Y', 'B Y', 'T Y', 'D Y', 'K Y', 'G Y',
  'F R', 'F L', 'TH R', 'SH R', 'TH W', 'HH W',
  'F Y', 'V Y', 'HH Y', 'M Y', 'N Y',
  'S P', 'S T', 'S K', 'S M', 'S N', 'S L', 'S W', 'S F',
  'S P R', 'S T R', 'S K R', 'S P L', 'S K W', 'S K Y', 'S P Y', 'S T Y',
]);

const isVowel = ph => 'AEIOU'.includes(ph[0]);

// The checked (lax) vowels, which English does not let end a stressed syllable:
// BAREST has no /ˈbɛ.rəst/ reading, only /ˈbɛr.əst/. Maximal Onset alone would hand
// that R to the next onset, where the key drops it — collapsing every
// C-EH-C-schwa-S-T word onto one key and rhyming BAREST with CHEMIST and DENTIST.
const CHECKED = new Set(['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'UH']);

function isCheckedStressed(nucleus) {
  const stress = nucleus[nucleus.length - 1];
  return stress > '0' && stress <= '9' && CHECKED.has(nucleus.slice(0, -1));
}

function splitCluster(cons, nucleus) {
  const least = cons.length && isCheckedStressed(nucleus) ? 1 : 0;
  for (let i = least; i <= cons.length; i++) {
    const onset = cons.slice(i);
    if (onset.length <= 1 || LEGAL_ONSETS.has(onset.join(' '))) return [cons.slice(0, i), onset];
  }
  return [cons, []];
}

// Maximal Onset over ONE word's pronunciation. Per word, never across a boundary:
// let it span one and D R is a legal onset, so ROAD RAGE reads as roa-drage and
// stops rhyming with CODE PAGE.
export function syllabify(pron) {
  const toks = pron.split(' ');
  const vowels = [];
  for (let i = 0; i < toks.length; i++) if (isVowel(toks[i])) vowels.push(i);
  if (!vowels.length) return [];
  const sylls = [];
  let onset = toks.slice(0, vowels[0]);
  for (let s = 0; s < vowels.length; s++) {
    const v = vowels[s];
    const nextV = vowels[s + 1];
    let coda, nextOnset;
    if (nextV === undefined) { coda = toks.slice(v + 1); nextOnset = []; }
    else [coda, nextOnset] = splitCluster(toks.slice(v + 1, nextV), toks[v]);
    sylls.push({ onset, nucleus: toks[v], coda });
    onset = nextOnset;
  }
  return sylls;
}

// Unstressed vowels neutralize toward schwa, which is what marries ANNE BOLEYN's
// OW0 to MANDOLIN's AH0. ER0, IY0, UW0 and the diphthongs resist reduction and
// stay distinct — collapse those too and any two entries sharing a stress shape
// match, CZECHOSLOVAKIA against ENERGY POLICY.
const REDUCIBLE = new Set(['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'OW', 'UH']);

function nucleusKey(vowel) {
  const stress = vowel[vowel.length - 1];
  if (stress < '0' || stress > '9') return vowel;
  const bare = vowel.slice(0, -1);
  return stress === '0' && REDUCIBLE.has(bare) ? 'AX' : bare;
}

const MAX_WHOLE_KEYS = 16;

// A coda repeating the next onset is held once, not twice — TIME MACHINE is said
// ti-ma-chine, which is what lets it meet LIMA BEAN. Both readings are kept: drop
// the undegeminated one and CLIMB A BEAN stops meeting TIME MACHINE.
function syllableKeys(sylls) {
  let variants = [[]];
  for (let i = 0; i < sylls.length; i++) {
    const { nucleus, coda } = sylls[i];
    const nextOnset = sylls[i + 1]?.onset || [];
    const nuc = nucleusKey(nucleus);
    const forms = [nuc + (coda.length ? ' ' + coda.join(' ') : '')];
    if (coda.length && nextOnset.length && coda[coda.length - 1] === nextOnset[0]) {
      const held = coda.slice(0, -1);
      forms.push(nuc + (held.length ? ' ' + held.join(' ') : ''));
    }
    const next = [];
    for (const v of variants) {
      for (const f of forms) if (next.length < MAX_WHOLE_KEYS) next.push(v.concat(f));
    }
    variants = next;
  }
  return variants.map(v => v.join(' | '));
}

// Every syllable of the entry rhymes with its counterpart, onsets free throughout,
// so a 3-syllable phrase can meet a 3-syllable word however their words divide up.
// One unreadable word and there is no reading at all — unlike the last-word modes,
// which only ever needed the tail.
function wholeEntryParts(text) {
  const words = text.split(/[\s-]+/).filter(Boolean);
  let combos = [[]];
  for (const word of words) {
    const prons = cmuDict.get(cmuKey(word));
    if (!prons) return [];
    const next = [];
    for (const c of combos) {
      for (const p of prons) if (next.length < MAX_WHOLE_KEYS) next.push(c.concat(p));
    }
    combos = next;
  }
  const keys = new Set();
  for (const combo of combos) {
    const sylls = [];
    for (const pron of combo) sylls.push(...syllabify(pron));
    if (sylls.length) for (const key of syllableKeys(sylls)) keys.add(key);
  }
  return [...keys];
}

export function lastWordKey(text) {
  return cmuKey(lastWord(text));
}

export function hasPronunciation(text) {
  return !!cmuDict?.has(cmuKey(lastWord(text)));
}

export function parseCmuDict(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(';;;')) continue;
    const hash = line.indexOf('#');
    const body = (hash >= 0 ? line.slice(0, hash) : line).trim();
    const sp = body.indexOf(' ');
    if (sp < 0) continue;
    const key = cmuKey(body.slice(0, sp).replace(/\(\d+\)$/, ''));
    const pron = body.slice(sp + 1).trim();
    if (!key || !pron) continue;
    let prons = map.get(key);
    if (!prons) map.set(key, prons = []);
    if (!prons.includes(pron)) prons.push(pron);
  }
  return map;
}

export async function loadCmuDict() {
  if (cmuDict) return;
  if (cmuLoadPromise) return cmuLoadPromise;
  cmuLoadPromise = (async () => {
    const cached = await _idbGet(CMU_DICT_IDB_KEY);
    if (cached && cached.cmu) {
      cmuDict = cached.cmu;
      return;
    }
    const resp = await fetch(CMU_DICT_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    cmuDict = parseCmuDict(await resp.text());
    await _idbPut(CMU_DICT_IDB_KEY, { cmu: cmuDict });
    const size = resp.headers.get('content-length');
    if (size) await _idbPut(CMU_DICT_SIZE_KEY, size);
  })();
  try {
    await cmuLoadPromise;
  } finally {
    if (!cmuDict) cmuLoadPromise = null;
  }
}
