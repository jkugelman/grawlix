import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignWord, lettersForPhones, spellsOut } from '../../site/src/engine/phone-align.js';

const pairs = (word, pron) => {
  const phones = pron.split(' ');
  return alignWord(word, phones).steps.map(s =>
    `${word.slice(s.from, s.to)}:${phones.slice(s.phoneFrom, s.phoneTo).join('+')}`);
};

test('alignWord pairs each sound with the letters that spell it', () => {
  assert.deepEqual(pairs('knight', 'N AY T'), ['kn:N', 'igh:AY', 't:T']);
  assert.deepEqual(pairs('box', 'B AA K S'), ['b:B', 'o:AA', 'x:K+S']);
  assert.deepEqual(pairs('through', 'TH R UW'), ['th:TH', 'r:R', 'ough:UW']);
  assert.deepEqual(pairs('tv', 'T IY V IY'), ['t:T+IY', 'v:V+IY']);
});

test('lettersForPhones widens over silent letters only at the word’s edges', () => {
  const at = (word, pron, a, b) => {
    const [s, e] = lettersForPhones(alignWord(word, pron.split(' ')).steps, a, b, word.length);
    return word.slice(s, e);
  };
  assert.equal(at('phone', 'F OW N', 1, 3), 'one');       // final silent e rides along
  assert.equal(at('knight', 'N AY T', 0, 2), 'knigh');    // leading kn is one spelling
  assert.equal(at('arbiter', 'AA R B IH T ER', 2, 6), 'biter');
  assert.equal(at('abyssinian', 'AE B S IH N IY AH N', 4, 6), 'ni');   // not `nia`: -ian keeps its a
});

test('spellsOut rejects a pronunciation the letters can’t make', () => {
  assert.ok(spellsOut('co', ['K', 'OW']));
  assert.ok(!spellsOut('co', 'K AH M P AH N IY'.split(' ')));
});
