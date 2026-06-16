import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCmuDict } from '../../../site/src/engine/phonetics.js';
import { visible, sameVisible, groups } from './harness.js';

const seed = () => setCmuDict({
  CAT: ['K AE1 T'], BAT: ['B AE1 T'], HAT: ['HH AE1 T'], DOG: ['D AO1 G'],
  OUT: ['AW1 T'], ABOUT: ['AH0 B AW1 T'],
  LIVES: ['L AY1 V Z', 'L IH1 V Z'], FIVES: ['F AY1 V Z'], GIVES: ['G IH1 V Z'],
});

test('filters the wordlist to entries that rhyme with the target', async () => {
  seed();
  const out = await visible(['cat', 'bat', 'hat', 'dog'],
    [{ tool: 'rhymes', params: { entry: 'cat' } }]);
  sameVisible(out, ['cat', 'bat', 'hat']);
});

test('rhymes a multi-word entry on its last word', async () => {
  seed();
  const out = await visible(['out', { entry: 'space out' }, 'dog'],
    [{ tool: 'rhymes', params: { entry: 'about' } }]);
  sameVisible(out, ['out', 'space out']);
});

test('matches across any of the target’s pronunciations', async () => {
  seed();
  sameVisible(await visible(['lives', 'fives'], [{ tool: 'rhymes', params: { entry: 'fives' } }]),
    ['lives', 'fives']);
  sameVisible(await visible(['lives', 'gives'], [{ tool: 'rhymes', params: { entry: 'gives' } }]),
    ['lives', 'gives']);
});

test('drops everything when the target has no pronunciation', async () => {
  seed();
  sameVisible(await visible(['cat', 'bat'], [{ tool: 'rhymes', params: { entry: 'xyzzy' } }]), []);
});

test('group mode buckets the wordlist into rhyme families (singletons dropped)', async () => {
  seed();
  const fams = await groups(['cat', 'bat', 'hat', 'dog'], [{ tool: 'rhymes', grouped: true }]);
  assert.equal(fams.length, 1);
  assert.equal(fams[0].key, 'AE1 T');
  sameVisible(fams[0].chains.map(c => c[0]), ['cat', 'bat', 'hat']);
});

test('a two-pronunciation word appears in both rhyme families (multi-key grouping)', async () => {
  seed();
  const fams = await groups(['lives', 'fives', 'gives'], [{ tool: 'rhymes', grouped: true }]);
  const byKey = Object.fromEntries(fams.map(f => [f.key, f.chains.map(c => c[0]).sort()]));
  assert.deepEqual(byKey['AY1 V Z'], ['fives', 'lives']);
  assert.deepEqual(byKey['IH1 V Z'], ['gives', 'lives']);
});
