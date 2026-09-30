import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCmuDict, setCmuDict } from '../../../site/src/engine/phonetics.js';
import { invalidateUnigramCorpus } from '../../../site/src/engine/segmenter.js';
import { rowAtoms } from '../../../site/src/engine/executor.js';
import { run, highlightTexts } from './harness.js';
import { CASES } from './phone_search.cases.js';

const DICT = parseCmuDict(readFileSync(new URL('../fixtures/cmu-cases.dict', import.meta.url), 'utf8'));

for (const [query, entry, marks] of CASES) {
  test(`${query} → ${entry}: ${marks.join(' + ')}`, async () => {
    invalidateUnigramCorpus();
    setCmuDict(DICT);
    const { rows } = await run([{ entry }], [{ tool: 'phone_search', params: { entry: query } }]);
    assert.equal(rows.length, 1, `${entry} doesn't match ${query}`);
    assert.deepEqual(highlightTexts(rowAtoms(rows[0]).at(-1)), marks);
  });
}
