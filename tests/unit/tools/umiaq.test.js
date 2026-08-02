import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './harness.js';
import { displayOf } from '../../../site/src/engine/norm.js';

const umiaq = query => [{ tool: 'umiaq', params: { query } }];
const spellings = (eta, ETA) => [{ entry: 'eta', score: eta }, { entry: 'ETA', score: ETA }];

test('a tuple picks one spelling per norm by the shared representative rule', async () => {
  // Three strategies collapsed spellings three different ways -- probe kept the
  // first in pool order, affix deduped tuples by norm, bucket never collapsed --
  // so which one survived depended on which strategy the planner chose. Score
  // decides now, as it does everywhere else one spelling stands for a norm.
  for (const [eta, ETA, want] of [[60, 40, 'eta'], [40, 60, 'ETA']]) {
    const { rows } = await run(spellings(eta, ETA), umiaq('A;A'));
    assert.deepEqual(rows.map(r => r.chains.map(c => displayOf(c.atoms[0].wlEntry)).join('+')),
      [want + '+' + want], `eta=${eta} ETA=${ETA}`);
  }
});

test('a single pattern still shows every spelling of a norm', async () => {
  const { rows } = await run(spellings(60, 40), umiaq('A'));
  assert.deepEqual(rows.map(r => displayOf(r.atoms.at(-1).wlEntry)).sort(), ['ETA', 'eta']);
});
