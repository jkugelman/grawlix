'use strict';

// ─── Unigram corpus & phrase segmenter ───────────────────────────────────────

export const UNIGRAM_CORPUS_URL = 'https://raw.githubusercontent.com/rspeer/wordfreq/master/wordfreq/data/large_en.msgpack.gz';
export const UNIGRAM_CORPUS_IDB_KEY = 'corpus_unigrams_decoded';
export const UNIGRAM_CORPUS_SIZE_KEY = 'corpus_unigrams_size';

export const SPACE_OUT_WINDOWS = { one: 2, few: 5, many: 10 };
export const SPACE_OUT_PART_PENALTY = 7;
export const SPACE_OUT_OOV_PER_LETTER = 1.5 * Math.LN10;
export const SPACE_OUT_MORPHEME_PENALTY = 1.0;
export const SPACE_OUT_SUFFIXES = ['s', 'es', 'ed', 'ied', 'ing', 'er', 'est', 'ly', 'ies'];

// Manual space-out overrides: a glued part's norm → its forced spacing, applied
// per segmentation part so `ofthe → of the` fires mid-entry (ageofthepyramids),
// not just as a whole entry. A value must norm back to its key or it changes the
// entry's letters, not just its spaces — a unit test pins that.
export const SPACE_OUT_OVERRIDES = {
  gota: 'got a',
  ofthe: 'of the',
};

// Injected so this engine module never imports the data layer (IDB/localStorage).
let _idbGet = null;
let _idbPut = null;

export function configureIO({ idbGet, idbPut }) {
  _idbGet = idbGet;
  _idbPut = idbPut;
}

let unigramLogFreqs = null;
let unigramMinLogFreq = -Infinity;
let unigramLoadPromise = null;

export function setUnigramCorpus(freqs, minLog) {
  const entries = Object.entries(freqs);
  unigramLogFreqs = new Map(entries);
  unigramMinLogFreq = minLog !== undefined ? minLog
    : entries.length ? Math.min(...entries.map(([, lf]) => lf)) : -Infinity;
  unigramLoadPromise = null;
}

export function invalidateUnigramCorpus() {
  unigramLogFreqs = null;
  unigramLoadPromise = null;
}

export function morphemeStemLogFreq(word) {
  if (!unigramLogFreqs) return -Infinity;
  let best = -Infinity;
  const tryStem = s => {
    const lf = unigramLogFreqs.get(s);
    if (lf !== undefined && lf > best) best = lf;
  };
  for (const suf of SPACE_OUT_SUFFIXES) {
    if (!word.endsWith(suf)) continue;
    const stemLen = word.length - suf.length;
    if (stemLen < 2) continue;
    const stem = word.slice(0, stemLen);
    tryStem(stem);
    if (suf === 'ed' || suf === 'ing' || suf === 'er' || suf === 'est') {
      tryStem(stem + 'e');  // raced, racing, racer, ...
    }
    if (suf === 'ies' || suf === 'ied') {
      tryStem(stem + 'y');  // tries, tried
    }
  }
  return best;
}

export function unigramLogFreq(word) {
  const lf = unigramLogFreqs?.get(word);
  if (lf !== undefined) return lf;
  const stemLf = morphemeStemLogFreq(word);
  if (stemLf > -Infinity) return stemLf - SPACE_OUT_MORPHEME_PENALTY;
  return unigramMinLogFreq - word.length * SPACE_OUT_OOV_PER_LETTER;
}

export function msgpackDecode(bytes) {
  const td = new TextDecoder('utf-8');
  let pos = 0;
  const u8 = () => bytes[pos++];
  const u16 = () => { const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; };
  const u32 = () => {
    const v = bytes[pos] * 0x1000000 + ((bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]);
    pos += 4;
    return v;
  };
  const str = (len) => { const s = td.decode(bytes.subarray(pos, pos + len)); pos += len; return s; };
  const arr = (n) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = readVal(); return out; };
  const map = (n) => { const out = {}; for (let i = 0; i < n; i++) { const k = readVal(); out[k] = readVal(); } return out; };
  function readVal() {
    const t = u8();
    if (t <= 0x7f) return t;
    if (t <= 0x8f) return map(t & 0x0f);
    if (t <= 0x9f) return arr(t & 0x0f);
    if (t <= 0xbf) return str(t & 0x1f);
    if (t === 0xd9) return str(u8());
    if (t === 0xda) return str(u16());
    if (t === 0xdb) return str(u32());
    if (t === 0xdc) return arr(u16());
    if (t === 0xdd) return arr(u32());
    if (t === 0xde) return map(u16());
    if (t === 0xdf) return map(u32());
    throw new Error(`msgpack: unsupported type 0x${t.toString(16)}`);
  }
  return readVal();
}

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function buildCorpusFromMsgpack(decoded) {
  const map = new Map();
  let lastNonEmpty = 1;
  for (let bucket = 1; bucket < decoded.length; bucket++) {
    const words = decoded[bucket];
    if (!words || words.length === 0) continue;
    const logFreq = -bucket * Math.LN10 / 100;
    for (const word of words) map.set(word, logFreq);
    lastNonEmpty = bucket;
  }
  return { map, minLog: -lastNonEmpty * Math.LN10 / 100 };
}

export async function loadUnigramCorpus() {
  if (unigramLogFreqs) return;
  if (unigramLoadPromise) return unigramLoadPromise;
  unigramLoadPromise = (async () => {
    const cached = await _idbGet(UNIGRAM_CORPUS_IDB_KEY);
    if (cached && cached.map) {
      unigramLogFreqs = cached.map;
      unigramMinLogFreq = cached.minLog;
      return;
    }
    const resp = await fetch(UNIGRAM_CORPUS_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const gz = await resp.arrayBuffer();
    const decompressed = await gunzipBytes(new Uint8Array(gz));
    const { map, minLog } = buildCorpusFromMsgpack(msgpackDecode(decompressed));
    unigramLogFreqs = map;
    unigramMinLogFreq = minLog;
    await _idbPut(UNIGRAM_CORPUS_IDB_KEY, { map, minLog });
    const size = resp.headers.get('content-length');
    if (size) await _idbPut(UNIGRAM_CORPUS_SIZE_KEY, size);
  })();
  try {
    await unigramLoadPromise;
  } finally {
    if (!unigramLogFreqs) unigramLoadPromise = null;
  }
}

export function hasUnigramCorpus() {
  return !!unigramLogFreqs;
}

export function rankedSplits(entry, window, wordlist) {
  if (entry.length < 1) return [];
  const isAllowedPart = p => p.length <= 2 || wordlist.byNorm.has(p);
  const isDigit = c => c >= '0' && c <= '9';
  const splitsMidDigit = (s, i) => i < s.length && isDigit(s[i - 1]) && isDigit(s[i]);

  const bestMemo = new Map();
  bestMemo.set('', 0);
  function bestFor(s) {
    const hit = bestMemo.get(s);
    if (hit !== undefined) return hit;
    let best = -Infinity;
    for (let i = 1; i <= s.length; i++) {
      if (splitsMidDigit(s, i)) continue;
      const p = s.slice(0, i);
      if (!isAllowedPart(p)) continue;
      const score = unigramLogFreq(p) - SPACE_OUT_PART_PENALTY + bestFor(s.slice(i));
      if (score > best) best = score;
    }
    bestMemo.set(s, best);
    return best;
  }
  const overallBest = bestFor(entry);
  const threshold = overallBest - window;

  const results = [];
  const acc = [];
  function enumerate(s, accScore) {
    if (s === '') {
      if (accScore >= threshold) {
        results.push({ score: accScore, parts: acc.slice() });
      }
      return;
    }
    if (accScore + bestFor(s) < threshold) return;
    for (let i = 1; i <= s.length; i++) {
      if (splitsMidDigit(s, i)) continue;
      const p = s.slice(0, i);
      if (!isAllowedPart(p)) continue;
      acc.push(p);
      enumerate(s.slice(i), accScore + unigramLogFreq(p) - SPACE_OUT_PART_PENALTY);
      acc.pop();
    }
  }
  enumerate(entry, 0);

  results.sort((a, b) => b.score - a.score);
  // Expand overridden parts after ranking, so `ofthe → of the` re-splits a glued
  // part wherever it lands mid-entry, not only when it's the whole entry. Dedup
  // because two splits can coincide once expanded.
  const seen = new Set();
  const out = [];
  for (const { parts } of results) {
    const expanded = parts.flatMap(p => SPACE_OUT_OVERRIDES[p]?.split(' ') ?? [p]);
    const key = expanded.join(' ');
    if (!seen.has(key)) { seen.add(key); out.push(expanded); }
  }
  return out;
}
