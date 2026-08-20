import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rhymingPart, parseCmuDict, rhymingPartsOf, lastWordKey, setCmuDict, hasPronunciation, syllabify,
} from '../../site/src/engine/phonetics.js';

test('rhymingPart returns from the last stressed vowel to the end, stress stripped', () => {
  assert.equal(rhymingPart('K AE1 T'), 'AE T');
  assert.equal(rhymingPart('B AH0 N AE1 N AH0'), 'AE N AH');
});

test('rhymingPart normalizes stress so secondary rhymes with primary', () => {
  assert.equal(rhymingPart('D AY1 N AH0 M AY2 T'), 'AY T');  // dynamite's secondary -mite
  assert.equal(rhymingPart('K AY1 T'), 'AY T');              // …rhymes with kite's primary
});

test('rhymingPart with no stressed vowel falls back to the whole pronunciation', () => {
  assert.equal(rhymingPart('DH AH0'), 'DH AH');
});

test('rhymingPart loose counts secondary stress, strict only primary', () => {
  assert.equal(rhymingPart('K AH1 M B ER0 B AE2 CH', 'loose'), 'AE CH');              // ~ match
  assert.equal(rhymingPart('K AH1 M B ER0 B AE2 CH', 'strict'), 'AH M B ER B AE CH'); // not ~ match
  assert.equal(rhymingPart('M AE1 CH', 'strict'), 'AE CH');
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
  assert.deepEqual(rhymingPartsOf('lives').sort(), ['AY V Z', 'IH V Z']);
  assert.deepEqual(rhymingPartsOf('space out'), ['AW T']);  // last word of the phrase
  assert.deepEqual(rhymingPartsOf('x-ray'), []);             // last word RAY not in dict
});

test('syllabify splits one word by Maximal Onset', () => {
  assert.deepEqual(
    syllabify('M AE1 N D AH0 L IH2 N').map(s => [s.onset.join(' '), s.nucleus, s.coda.join(' ')]),
    [['M', 'AE1', 'N'], ['D', 'AH0', ''], ['L', 'IH2', 'N']]);
  // D R is a legal onset, so Andrew is AN-drew and only the N closes the first syllable
  assert.deepEqual(syllabify('AE1 N D R UW2').map(s => s.coda.join(' ')), ['N', '']);
  assert.deepEqual(syllabify('SH SH'), []);
});

test('whole mode keys every syllable and never syllabifies across a word boundary', () => {
  setCmuDict({
    ANNE: ['AE1 N'], BOLEYN: ['B OW0 L IH1 N'], MANDOLIN: ['M AE1 N D AH0 L IH2 N'],
    MANDOLINE: ['M AE1 N D AH0 L IY2 N'],
    CODE: ['K OW1 D'], PAGE: ['P EY1 JH'], ROAD: ['R OW1 D'], RAGE: ['R EY1 JH'],
  });
  assert.deepEqual(rhymingPartsOf('anne boleyn', 'whole'), ['AE N | AX | IH N']);
  assert.deepEqual(rhymingPartsOf('mandolin', 'whole'), ['AE N | AX | IH N']);
  assert.deepEqual(rhymingPartsOf('mandoline', 'whole'), ['AE N | AX | IY N']);
  // Spanning the boundary would hand ROAD's D to RAGE and lose the OW D
  assert.deepEqual(rhymingPartsOf('road rage', 'whole'), ['OW D | EY JH']);
  assert.deepEqual(rhymingPartsOf('code page', 'whole'), ['OW D | EY JH']);
});

// English has no /ˈbɛ.rəst/: a stressed checked vowel cannot end a syllable, so the
// R closes it. Hand the R forward and it leaves the key entirely — which collapsed
// every C-EH-C-schwa-S-T word onto one key, rhyming BAREST with CHEMIST and DENTIST.
test('a stressed checked vowel keeps the next consonant as its coda', () => {
  setCmuDict({
    BAREST: ['B EH1 R AH0 S T'], FAIREST: ['F EH1 R IH0 S T'], RAREST: ['R EH1 R AH0 S T'],
    CHEMIST: ['K EH1 M IH0 S T'], WETTEST: ['W EH1 T AH0 S T'], DENTIST: ['D EH1 N IH0 S T'],
  });
  assert.deepEqual(rhymingPartsOf('barest', 'whole'), ['EH R | AX S T']);
  assert.deepEqual(rhymingPartsOf('fairest', 'whole'), ['EH R | AX S T']);
  assert.deepEqual(rhymingPartsOf('rarest', 'whole'), ['EH R | AX S T']);
  assert.deepEqual(rhymingPartsOf('chemist', 'whole'), ['EH M | AX S T']);
  assert.deepEqual(rhymingPartsOf('wettest', 'whole'), ['EH T | AX S T']);
  assert.deepEqual(rhymingPartsOf('dentist', 'whole'), ['EH N | AX S T']);
});

// The constraint is on checked vowels only — a tense one may end a syllable (SEE,
// TOO), so SCOO-by hands its B forward and still meets LU-cy.
test('a tense stressed vowel still hands its consonant to the next onset', () => {
  setCmuDict({
    SCOOBY: ['S K UW1 B IY0'], DOO: ['D UW1'], LUCY: ['L UW1 S IY0'], LIU: ['L Y UW1'],
  });
  assert.deepEqual(rhymingPartsOf('scooby doo', 'whole'), ['UW | IY | UW']);
  assert.deepEqual(rhymingPartsOf('lucy liu', 'whole'), ['UW | IY | UW']);
});

test('whole mode holds a doubled consonant once, keeping both readings', () => {
  setCmuDict({
    TIME: ['T AY1 M'], MACHINE: ['M AH0 SH IY1 N'], LIMA: ['L AY1 M AH0'], BEAN: ['B IY1 N'],
  });
  assert.deepEqual(rhymingPartsOf('time machine', 'whole'), ['AY M | AX | IY N', 'AY | AX | IY N']);
  assert.deepEqual(rhymingPartsOf('lima bean', 'whole'), ['AY | AX | IY N']);
});

test('whole mode needs every word, where the last-word modes need only the tail', () => {
  setCmuDict({ BEAN: ['B IY1 N'] });
  assert.deepEqual(rhymingPartsOf('lima bean', 'whole'), []);
  assert.deepEqual(rhymingPartsOf('lima bean', 'loose'), ['IY N']);
});

test('hasPronunciation answers membership without deriving a rhyming part', () => {
  setCmuDict({ LIVES: ['L AY1 V Z'], OUT: ['AW1 T'] });
  assert.equal(hasPronunciation('lives'), true);
  assert.equal(hasPronunciation('space out'), true);
  assert.equal(hasPronunciation('x-ray'), false);
});
