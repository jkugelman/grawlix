import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './support/extract.mjs';

const { toNorm, parseWordlistLine, parseWordlist, detectCase, validateWordlistChunk, buildWlEntry } =
  extract('parsing', [
    'toNorm', 'parseWordlistLine', 'parseWordlist', 'detectCase', 'validateWordlistChunk', 'buildWlEntry',
  ]);

test('toNorm strips accents, case, separators, and ligatures', () => {
  assert.equal(toNorm('Café Olé!'), 'cafeole');
  assert.equal(toNorm('U.S.A.'), 'usa');
  assert.equal(toNorm('straße'), 'strasse');
  assert.equal(toNorm('Æsop'), 'aesop');
});

test('parseWordlistLine parses the ENTRY;SCORE[;COMMENT] shapes', () => {
  assert.deepEqual(parseWordlistLine('WORD;50'), { raw: 'WORD', score: 50, comment: '' });
  assert.deepEqual(parseWordlistLine('WORD;50;a note'), { raw: 'WORD', score: 50, comment: 'a note' });
  assert.deepEqual(parseWordlistLine('  SPACED ;50'), { raw: 'SPACED', score: 50, comment: '' });
  assert.deepEqual(parseWordlistLine('WORD;50;com;ment'), { raw: 'WORD', score: 50, comment: 'com;ment' });
  assert.equal(parseWordlistLine('WORD;50x').score, 50);
});

test('parseWordlistLine rejects malformed lines', () => {
  assert.equal(parseWordlistLine(''), null);
  assert.equal(parseWordlistLine('NOSEMICOLON'), null);
  assert.equal(parseWordlistLine(';50'), null);
  assert.equal(parseWordlistLine('WORD;'), null);
  assert.equal(parseWordlistLine('WORD;abc'), null);
});

test('parseWordlist drops malformed lines and keeps the valid records', () => {
  const out = parseWordlist('CAT;50\nbad line\n;99\nDOG;30;pet\n');
  assert.deepEqual(out.map(e => e.norm), ['cat', 'dog']);
  assert.equal(out[1].comment, 'pet');
});

test('detectCase: large mostly-uppercase file is upper, just-below-ratio is lower, tiny file is lower', () => {
  const mk = (n, raw) => Array.from({ length: n }, () => ({ raw }));
  assert.equal(detectCase([...mk(1600, 'ABC'), ...mk(200, 'abc')]), 'upper');
  assert.equal(detectCase([...mk(1600, 'ABC'), ...mk(500, 'abc')]), 'lower');
  assert.equal(detectCase(mk(3, 'ABC')), 'lower');
});

test('validateWordlistChunk accepts a chunk with data lines, rejects empty/dataless/malformed', () => {
  assert.equal(validateWordlistChunk('CAT;50\nDOG;40\ntruncated-tail'), true);
  assert.equal(validateWordlistChunk('# a header line\nCAT;50\nx'), true);
  assert.equal(validateWordlistChunk('no semicolons here\nstill none\nx'), false);
  assert.equal(validateWordlistChunk(''), false);
  assert.equal(validateWordlistChunk('CAT;notanumber\nDOG;40\nx'), false);
});

test('buildWlEntry: in-convention letter runs drop display, off-convention or rich text keep it', () => {
  assert.deepEqual(buildWlEntry('CAT', 50, '', 'upper'), { norm: 'cat', display: null, score: 50, comment: '' });
  assert.deepEqual(buildWlEntry('FBI', 50, '', 'lower'), { norm: 'fbi', display: 'FBI', score: 50, comment: '' });
  assert.deepEqual(buildWlEntry('New York', 50, '', 'upper'), { norm: 'newyork', display: 'New York', score: 50, comment: '' });
});
