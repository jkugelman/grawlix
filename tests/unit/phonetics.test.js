import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhymingPart, parseCmuDict, rhymingPartsOf, lastWordKey, setCmuDict } from '../../site/src/engine/phonetics.js';

test('rhymingPart returns from the last STRESSED vowel to the end', () => {
  assert.equal(rhymingPart('K AE1 T'), 'AE1 T');
  assert.equal(rhymingPart('B AH0 N AE1 N AH0'), 'AE1 N AH0');
});

test('rhymingPart honors secondary stress (2) as well as primary (1)', () => {
  assert.equal(rhymingPart('AH0 K AE2 T'), 'AE2 T');
});

test('rhymingPart with no stressed vowel falls back to the whole pronunciation', () => {
  assert.equal(rhymingPart('DH AH0'), 'DH AH0');
});

test('parseCmuDict parses entries + alternates, skips comments, strips (N)', () => {
  const map = parseCmuDict([
    ';;; a header comment',
    'cat K AE1 T',
    'read R EH1 D',
    'read(2) R IY1 D',
    'wonky W AA1 NG K IY0 # slang',
  ].join('\n'));
  assert.deepEqual(map.get('CAT'), ['K AE1 T']);
  assert.deepEqual(map.get('READ'), ['R EH1 D', 'R IY1 D']);
  assert.deepEqual(map.get('WONKY'), ['W AA1 NG K IY0']);
});

test('lastWordKey canonicalizes the last word — uppercase, letters-only', () => {
  assert.equal(lastWordKey('Aunt Agatha'), 'AGATHA');
  assert.equal(lastWordKey('agatha'), 'AGATHA');
  assert.equal(lastWordKey('scaredy-cat'), 'CAT');
});

test('rhymingPartsOf collects every pronunciation’s part and bridges the last word', () => {
  setCmuDict({ LIVES: ['L AY1 V Z', 'L IH1 V Z'], OUT: ['AW1 T'] });
  assert.deepEqual(rhymingPartsOf('lives').sort(), ['AY1 V Z', 'IH1 V Z']);
  assert.deepEqual(rhymingPartsOf('space out'), ['AW1 T']);  // last word of the phrase
  assert.deepEqual(rhymingPartsOf('x-ray'), []);             // last word RAY not in dict
});
