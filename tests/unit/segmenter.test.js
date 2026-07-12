import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  msgpackDecode, buildCorpusFromMsgpack, morphemeStemLogFreq,
  unigramLogFreq, rankedSplits, setUnigramCorpus,
  SPACE_OUT_PART_PENALTY, SPACE_OUT_MORPHEME_PENALTY, SPACE_OUT_OOV_PER_LETTER,
  SPACE_OUT_OVERRIDES,
} from '../../site/src/engine/segmenter.js';
import { toNorm } from '../../site/src/engine/norm.js';

const LN10 = Math.LN10;

// The segmenter's corpus is module-level singleton state, so corpus() mutates
// it rather than returning an isolated fixture — the returned functions all read
// whatever the latest corpus() call set.
const corpus = (entries, minLog = -10) => {
  setUnigramCorpus(Object.fromEntries(entries), minLog);
  return {
    msgpackDecode, buildCorpusFromMsgpack, morphemeStemLogFreq, unigramLogFreq, rankedSplits,
    SPACE_OUT_PART_PENALTY, SPACE_OUT_MORPHEME_PENALTY, SPACE_OUT_OOV_PER_LETTER,
  };
};

const pure = corpus([]);
const decode = (...bytes) => pure.msgpackDecode(new Uint8Array(bytes));
const allowed = (...words) => ({ byNorm: new Set(words) });

test('msgpackDecode: positive fixint covers 0x00..0x7f verbatim', () => {
  assert.equal(decode(0x00), 0);
  assert.equal(decode(0x05), 5);
  assert.equal(decode(0x7f), 127);
});

test('msgpackDecode: fixstr (0xa0|len) decodes its UTF-8 bytes', () => {
  assert.equal(decode(0xa0), '');
  assert.equal(decode(0xa2, 0x68, 0x69), 'hi');
});

test('msgpackDecode: fixstr length is a BYTE count, so multi-byte UTF-8 decodes whole', () => {
  // 'é' is two UTF-8 bytes; a char-counting length (1) would truncate it.
  assert.equal(decode(0xa2, 0xc3, 0xa9), 'é');
});

test('msgpackDecode: fixarray (0x90|n) reads n following values', () => {
  assert.deepEqual(decode(0x90), []);
  assert.deepEqual(decode(0x92, 0x01, 0x02), [1, 2]);
});

test('msgpackDecode: fixmap (0x80|n) reads n key/value pairs', () => {
  assert.deepEqual(decode(0x81, 0xa1, 0x61, 0x01), { a: 1 });
});

test('msgpackDecode: str8 (0xd9) takes a 1-byte length', () => {
  assert.equal(decode(0xd9, 0x03, 0x61, 0x62, 0x63), 'abc');
});

test('msgpackDecode: str16 (0xda) takes a 2-byte big-endian length', () => {
  assert.equal(decode(0xda, 0x00, 0x02, 0x68, 0x69), 'hi');
});

test('msgpackDecode: str32 (0xdb) takes a 4-byte big-endian length', () => {
  assert.equal(decode(0xdb, 0x00, 0x00, 0x00, 0x02, 0x6f, 0x6b), 'ok');
});

test('msgpackDecode: array16 (0xdc) takes a 2-byte count', () => {
  assert.deepEqual(decode(0xdc, 0x00, 0x02, 0x01, 0x02), [1, 2]);
});

test('msgpackDecode: array32 (0xdd) takes a 4-byte count', () => {
  assert.deepEqual(decode(0xdd, 0x00, 0x00, 0x00, 0x02, 0x01, 0x02), [1, 2]);
});

test('msgpackDecode: map16 (0xde) takes a 2-byte pair count', () => {
  assert.deepEqual(decode(0xde, 0x00, 0x01, 0xa1, 0x61, 0x02), { a: 2 });
});

test('msgpackDecode: map32 (0xdf) takes a 4-byte pair count', () => {
  assert.deepEqual(decode(0xdf, 0x00, 0x00, 0x00, 0x01, 0xa1, 0x61, 0x02), { a: 2 });
});

test('msgpackDecode: the shared cursor advances through nested arrays (corpus shape)', () => {
  // The real corpus is an array-of-buckets; a cursor that fails to advance past a
  // nested length would silently misalign every later bucket.
  const bytes = [
    0x92,
    0x91, 0xa3, 0x74, 0x68, 0x65,
    0x92, 0xa3, 0x63, 0x61, 0x74, 0xa3, 0x64, 0x6f, 0x67,
  ];
  assert.deepEqual(decode(...bytes), [['the'], ['cat', 'dog']]);
});

test('msgpackDecode: the cursor advances through a map whose values are arrays', () => {
  const bytes = [
    0x82,
    0xa1, 0x78, 0x92, 0x01, 0x02,
    0xa1, 0x79, 0x91, 0x03,
  ];
  assert.deepEqual(decode(...bytes), { x: [1, 2], y: [3] });
});

test('msgpackDecode: an unsupported tag throws rather than silently mis-decoding', () => {
  assert.throws(() => decode(0xc0), /unsupported type 0xc0/);
});

test('buildCorpusFromMsgpack: bucket index N maps every word to logFreq -N*LN10/100', () => {
  // Bucket 0 is never read (the loop starts at 1) and empty buckets are skipped;
  // minLog tracks the LAST non-empty bucket, not the highest index seen.
  const decoded = [['skip0'], ['the', 'of'], [], ['cat']];
  const { map, minLog } = pure.buildCorpusFromMsgpack(decoded);
  assert.equal(map.has('skip0'), false);
  assert.equal(map.get('the'), -1 * LN10 / 100);
  assert.equal(map.get('of'), -1 * LN10 / 100);
  assert.equal(map.get('cat'), -3 * LN10 / 100);
  assert.equal(minLog, -3 * LN10 / 100);
});

test('buildCorpusFromMsgpack: an all-empty decode yields an empty map and the bucket-1 floor', () => {
  const { map, minLog } = pure.buildCorpusFromMsgpack([[], []]);
  assert.equal(map.size, 0);
  // lastNonEmpty never moves off its initial 1, so the floor is -1*LN10/100.
  assert.equal(minLog, -1 * LN10 / 100);
});

test('unigramLogFreq: a direct corpus hit returns the stored log-frequency', () => {
  const { unigramLogFreq } = corpus([['cat', -1]]);
  assert.equal(unigramLogFreq('cat'), -1);
});

test('unigramLogFreq: an out-of-vocabulary word falls to minLog - len*OOV_PER_LETTER', () => {
  const { unigramLogFreq, SPACE_OUT_OOV_PER_LETTER } = corpus([['cat', -1]], -10);
  assert.equal(unigramLogFreq('zzz'), -10 - 3 * SPACE_OUT_OOV_PER_LETTER);
});

test('morphemeStemLogFreq: an "s" suffix strips to a corpus stem', () => {
  const { morphemeStemLogFreq } = corpus([['race', -2]]);
  assert.equal(morphemeStemLogFreq('races'), -2);
});

test('morphemeStemLogFreq: "ing" restores a dropped "e" (racing -> race)', () => {
  // The bare stem 'rac' is absent; matching only happens because ed/ing/er/est
  // also probe stem+'e'.
  const { morphemeStemLogFreq } = corpus([['race', -2]]);
  assert.equal(morphemeStemLogFreq('racing'), -2);
});

test('morphemeStemLogFreq: "ied" restores a "y" (tried -> try)', () => {
  // The bare stem 'tr' is absent; ies/ied additionally probe stem+'y'.
  const { morphemeStemLogFreq } = corpus([['try', -3]]);
  assert.equal(morphemeStemLogFreq('tried'), -3);
});

test('morphemeStemLogFreq: no stemmable suffix returns -Infinity', () => {
  const { morphemeStemLogFreq } = corpus([['race', -2]]);
  assert.equal(morphemeStemLogFreq('zzz'), -Infinity);
});

test('unigramLogFreq: a stem hit pays the morpheme penalty (stem - MORPHEME_PENALTY)', () => {
  const { unigramLogFreq, SPACE_OUT_MORPHEME_PENALTY } = corpus([['race', -2]]);
  assert.equal(unigramLogFreq('racing'), -2 - SPACE_OUT_MORPHEME_PENALTY);
});

test('rankedSplits: an empty string yields no splits', () => {
  const { rankedSplits } = corpus([['space', -1]]);
  assert.deepEqual(rankedSplits('', 2, allowed('space')), []);
});

test('rankedSplits: a single in-corpus word stays whole', () => {
  const { rankedSplits } = corpus([['space', -1]]);
  assert.deepEqual(rankedSplits('space', 2, allowed('space')), [['space']]);
});

test('rankedSplits: frequency forces the two-word split when no whole word exists', () => {
  const { rankedSplits } = corpus([['space', -1], ['out', -1]]);
  assert.deepEqual(
    rankedSplits('spaceout', 10, allowed('space', 'out')),
    [['space', 'out']],
  );
});

test('rankedSplits: the part penalty makes a high-freq whole word beat the split', () => {
  // One part scores -1-7=-8 vs the split's 2*(-1-7)=-16, so the whole word ranks
  // first; the test would pass even with a broken penalty unless we also pin that
  // the split appears SECOND, which only holds if the recurrence sums correctly.
  const { rankedSplits } = corpus([['space', -1], ['out', -1], ['spaceout', -1]]);
  assert.deepEqual(
    rankedSplits('spaceout', 10, allowed('space', 'out', 'spaceout')),
    [['spaceout'], ['space', 'out']],
  );
});

test('rankedSplits: a rare whole word loses to its frequent parts (DP picks lowest cost)', () => {
  // Whole word -30-7=-37 vs split 2*(-1-7)=-16: the split wins. Paired with the
  // previous test, this proves the ranking is cost-driven, not part-count-driven.
  const { rankedSplits } = corpus([['space', -1], ['out', -1], ['spaceout', -30]]);
  assert.deepEqual(
    rankedSplits('spaceout', 10, allowed('space', 'out', 'spaceout')),
    [['space', 'out']],
  );
});

test('rankedSplits: with no known parts only short (<=2 char) pieces are allowed', () => {
  const { rankedSplits } = corpus([]);
  const out = rankedSplits('xyzqk', 2, allowed());
  assert.equal(out[0].length, 3);
  assert.ok(out.every(parts => parts.join('') === 'xyzqk'));
  assert.ok(out.every(parts => parts.every(p => p.length <= 2)));
});

test('rankedSplits: a numeric run is never cut mid-digit', () => {
  const { rankedSplits } = corpus([['cat', -1]]);
  const out = rankedSplits('cat12', 10, allowed('cat'));
  assert.ok(out.every(parts => !parts.join('|').includes('1|2')));
});

test('rankedSplits: an override re-splits a glued part in the middle of a longer entry', () => {
  // 'ofthe' is an allowed part here (a run-together entry the list carries), so the
  // scorer glues it into the top split; the override must break it into of+the even
  // though it's the middle part — the ageofthepyramids/aheadofthetimes case.
  const { rankedSplits } = corpus([['age', -1], ['pyramids', -1], ['ofthe', -5]]);
  const out = rankedSplits('ageofthepyramids', 10, allowed('age', 'ofthe', 'pyramids'));
  assert.deepEqual(out[0], ['age', 'of', 'the', 'pyramids']);
});

test('rankedSplits: an override also applies when the glued form is the whole entry', () => {
  const { rankedSplits } = corpus([['ofthe', -5]]);
  assert.deepEqual(rankedSplits('ofthe', 10, allowed('ofthe'))[0], ['of', 'the']);
});

test('SPACE_OUT_OVERRIDES: every value norms back to its key', () => {
  // The override re-spaces an entry; a value that norms to anything but its key
  // would change the entry's letters, so Space out would emit a different word.
  for (const [key, spacing] of Object.entries(SPACE_OUT_OVERRIDES)) {
    assert.equal(toNorm(spacing), key, `"${spacing}" must norm to "${key}"`);
  }
});
