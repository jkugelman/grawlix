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

export function rhymingPart(pron) {
  const toks = pron.split(' ');
  for (let i = toks.length - 1; i >= 0; i--) {
    const last = toks[i][toks[i].length - 1];
    // Strip stress so 1≡2: dynamite's secondary -mite (AY2) rhymes with kite (AY1).
    if (last === '1' || last === '2') return toks.slice(i).join(' ').replace(/\d/g, '');
  }
  return pron.replace(/\d/g, '');
}

export function rhymingPartsOf(text) {
  if (!cmuDict) return [];
  const prons = cmuDict.get(cmuKey(lastWord(text)));
  if (!prons) return [];
  const parts = new Set();
  for (const pron of prons) parts.add(rhymingPart(pron));
  return [...parts];
}

export function lastWordKey(text) {
  return cmuKey(lastWord(text));
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
