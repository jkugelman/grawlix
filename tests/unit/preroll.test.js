import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prerollContext, withRolledEntry } from '../../site/src/engine/preroll.js';

const stack = [
  { tool: 'twins', params: { entry: 'bull market', other: 1 } },
  { tool: 'search', params: { pattern: '' } },
];

test('the context ignores the rolled entry but not the rest of the stack', () => {
  const key = s => prerollContext(s, 0, 'entry', '__merged__', '50+', null);
  assert.equal(key(stack), key(withRolledEntry(stack, 0, 'entry', 'ball marker')));
  assert.notEqual(key(stack), key(withRolledEntry(stack, 1, 'pattern', 'b*')));
  assert.notEqual(key(stack), prerollContext(stack, 0, 'entry', '__merged__', '60+', null));
});

test('filling in the rolled entry keeps the params in the order main serializes them', () => {
  const rolled = withRolledEntry(stack, 0, 'entry', 'ball marker');
  const typed = [{ tool: 'twins', params: { ...stack[0].params } }, stack[1]];
  typed[0].params.entry = 'ball marker';
  assert.equal(JSON.stringify(rolled), JSON.stringify(typed));
  assert.equal(stack[0].params.entry, 'bull market');
});
