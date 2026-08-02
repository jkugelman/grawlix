'use strict';

import { toNorm } from './norm.js';

// ─── Unigram corpus & phrase segmenter ───────────────────────────────────────

export const UNIGRAM_CORPUS_URL = 'https://raw.githubusercontent.com/rspeer/wordfreq/master/wordfreq/data/large_en.msgpack.gz';
export const UNIGRAM_CORPUS_IDB_KEY = 'corpus_unigrams_decoded';
export const UNIGRAM_CORPUS_SIZE_KEY = 'corpus_unigrams_size';

export const SPACE_OUT_WINDOWS = { few: 5, many: 10 };
export const SPACE_OUT_PART_PENALTY = 7;
export const SPACE_OUT_BIGRAM_WEIGHT = 2;
export const SPACE_OUT_OOV_PER_LETTER = 1.5 * Math.LN10;
export const SPACE_OUT_MORPHEME_PENALTY = 1.0;
export const SPACE_OUT_SUFFIXES = ['s', 'es', 'ed', 'ied', 'ing', 'er', 'est', 'ly', 'ies'];

// Manual space-out overrides: a glued part's norm → its forced spacing, applied
// per segmentation part so `ofthe → of the` fires mid-entry (ageofthepyramids),
// not just as a whole entry. Each row is written as the spacing alone, its glued key
// derived from it via toNorm, so the two can never drift apart.
//
// Rows carry real orthography (`I don't`, `on one's`, `New York`), not bare norms: the
// table ships to every user, so a rendering must not depend on whether that user's
// wordlist happens to store `I` capitalised. Dedup folds case and punctuation so a
// rich row still merges with the same spacing found by the scorer — see rankedSplits.
//
// Derived, not hand-picked: every multi-word entry of a real 750k-entry wordlist was
// segmented, each result diffed against that entry's own spacing, and the parts that
// swallow a real word boundary collected — ordered here by how many entries each one
// mis-glues. A fragment earns a row only if it mis-glues in 25+ entries and is either
// never a legitimate word in that corpus, or wrong-glued at least 10:1 against its
// real uses (capped at 5) and below a unigram-frequency floor. Those gates are what
// reject `up on` (100 glued against 258 real `upon`s) and `a long`, both of which read
// as plausibly as any row here — which is why rows belong to a re-run of the analysis
// rather than to eyeballing. Method and measured effect: docs/design.md § Space out.
const SPACE_OUT_SPACINGS = [
  'of the', 'in the', 'on the', 'out of', 'to the', 'like a', 'in a', 'for the', 'on a',
  'up to', 'and the', 'at the', 'as a', 'the world', 'to a', 'of a', 'up the', 'off the',
  'are you', 'for a', 'New York', 'do you', 'to be', 'take a', 'in on', "I don't", 'from the',
  'make a', 'made a', 'a good', 'the way', 'this is', 'took a', 'have a', 'all the', "I can't",
  'is that', "it's a", 'I am', 'back to', 'up a', 'by the', 'I have', 'I can', 'under the',
  'the last', 'it in', 'you know', 'it to', 'of it', "on one's", 'it all', 'can I', 'is a',
  'at a', 'I know', 'going to', 'the best', 'the day', 'into the', 'out the', 'am I', 'to me',
  'had a', 'ice cream', 'let me', 'of time', 'the time', 'down to', 'if you', 'got a',
  "in one's", 'not a', 'for you', 'on your', 'the road', 'what a', 'it a', 'over the',
  'the same', 'a lot', 'do it', 'of love', 'a bad', 'can you', 'if I', 'of life', 'what you',
  'get it', "of one's", 'to you', 'what I', 'with a', 'get a', 'I was', 'want to', 'has a',
  'I do', 'United States', 'the end', 'the house', 'the man', 'the sun', 'with you', 'a little',
  'end of', 'it on', 'just a', 'to know', 'New Jersey', 'I want', 'you want', 'it is', 'to it',
  'in love', 'in your', 'is the', 'look at', 'National Park', 'of God', 'to say', 'up and',
  'with me', 'a day', 'have to', 'I see', 'on it', 'do I', 'I need', 'make it', 'see you',
  "to one's", "up one's", 'of all', 'the year', 'you can', 'take it', 'the game', 'the right',
  'a few', 'a joke', 'be a', 'of my', 'you have', 'and a', 'I got', 'into a', 'the truth',
  'to see', 'all over', 'did I', 'Los Angeles', 'more than', 'with it', 'a bit', 'I could',
  'I love', "I'm a", 'in for', 'in it', 'in my', 'like it', 'up in', 'best of', 'against the',
  'by a', 'get out', 'got it', 'it was', 'you are', 'I get', 'of you', 'out with', 'the job',
  'high school', 'I think', 'the other', 'the red', 'a second', 'as I', 'at home', 'I just',
  'to an', 'about it', 'back in', 'do not', 'for me', 'I feel', 'need a', 'you think',
  'a right', 'around the', 'do the', 'of war', 'Star Trek', 'the wall', 'all in', 'a look',
  'as you', 'a time', 'away from', 'I said', 'the king', 'the whole', 'I say', 'me a',
  'state of', 'tell me', 'a la', 'a ride', 'from a', 'must be', 'my life', 'on top', 'that was',
  'to get', 'what is', 'a big', 'a cab', 'a job', 'at it', 'got to', 'is not', 'like the',
  'the top', 'your life', 'a thing', 'be the', 'for all', "I'm so", 'part of', 'put on',
  'thank you', 'the first', 'the new', 'a mile', 'and I', 'as the', 'I mean', 'in touch',
  'I will', 'my heart', 'no one', 'not to', 'we have', 'de la', 'keep it', 'North Carolina',
  'Star Wars', 'the bed', 'too much', 'we are', 'what the', 'you see',
];

// A Map, not an object literal: parts are arbitrary wordlist norms, and `constructor`
// is both a real entry and an inherited Object key, so a plain object resolves it to
// a function and throws mid-split.
export const SPACE_OUT_OVERRIDES = new Map(
  SPACE_OUT_SPACINGS.map(spacing => [toNorm(spacing), spacing]));

// Shipped word-pair table (engine/space-out-bigrams-data.js), injected by the worker.
// Null until then, so importing the segmenter alone keeps ranking on the pure-unigram
// path — nothing runs at import. Values are precomputed log(1 + count), summed and
// weighted in bigramBonus, so the parse never happens twice and the hot path only adds.
let spaceOutBigrams = null;
export function configureSpaceOutBigrams(raw) {
  if (!raw) { spaceOutBigrams = null; return; }
  const m = new Map();
  for (const line of raw.trim().split('\n')) {
    if (!line) continue;
    const at = line.lastIndexOf(' ');
    m.set(line.slice(0, at), Math.log(1 + Number(line.slice(at + 1))));
  }
  spaceOutBigrams = m.size ? m : null;
}

function bigramBonus(norms) {
  if (!spaceOutBigrams) return 0;
  let bonus = 0;
  for (let i = 0; i < norms.length - 1; i++) {
    const b = spaceOutBigrams.get(`${norms[i]} ${norms[i + 1]}`);
    if (b !== undefined) bonus += b;
  }
  return SPACE_OUT_BIGRAM_WEIGHT * bonus;
}

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
  const isAllowedPart = p => p.length <= 2 || wordlist.norms.has(p);
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

  // Expand overridden parts, then rank by the enumeration score plus the bigram bonus.
  // Expanding before the sort lets the bonus see the corrected parts (`of the`, not the
  // glued `ofthe`) and lets two splits that coincide once expanded de-dup; the override
  // itself still fires wherever a glued part lands, mid-entry as readily as whole-entry.
  // With no bigram table the bonus is 0, so the order is the pure-unigram score untouched.
  const richness = ps => ps.join(' ').replace(/[a-z0-9 ]/g, '').length;
  const scored = results.map(({ score, parts }) => {
    const expanded = parts.flatMap(p => SPACE_OUT_OVERRIDES.get(p)?.split(' ') ?? [p]);
    const norms = expanded.map(toNorm);
    return { parts: expanded, norms, score: score + bigramBonus(norms) };
  });
  scored.sort((a, b) => b.score - a.score);
  // Dedup on the norm-folded key so an override's `I don't` merges with the scorer's own
  // `i dont`; spaces stay significant, so distinct spacings stay distinct. On a collision
  // keep the richer rendering — the override's, since the scorer only emits bare norms.
  const seen = new Map();
  const out = [];
  for (const { parts, norms } of scored) {
    const key = norms.join(' ');
    const at = seen.get(key);
    if (at === undefined) { seen.set(key, out.length); out.push(parts); }
    else if (richness(parts) > richness(out[at])) out[at] = parts;
  }
  return out;
}
