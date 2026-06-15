import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toNorm, parseWordlistLine, parseWordlist, detectCase, validateWordlistChunk, buildWlEntry,
  stripAccents, buildNormToDisplay, projectRangesToDisplay, buildUserWlEntry, synthWlEntry,
} from '../../site/src/engine/norm.js';

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

test('parseWordlist: detectCase drives per-entry display across the whole file', () => {
  const bigUpper = Array.from({ length: 1500 }, (_, i) => `WORD${i};50`).join('\n');
  assert.equal(parseWordlist(bigUpper).every(e => e.display === null), true);

  const tinyUpper = parseWordlist('BAGEL;50\nCAR;50\nDOG;50');
  assert.deepEqual(tinyUpper.map(e => e.display), ['BAGEL', 'CAR', 'DOG']);

  const lowerMix = parseWordlist('cat;50\nNEW YEAR;50\nMötley Crüe;50\nFBI;50\ncafé;50');
  assert.deepEqual(lowerMix.map(e => e.display), [null, 'NEW YEAR', 'Mötley Crüe', 'FBI', 'café']);
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

test('stripAccents: folds ligatures, decomposes accents to ASCII, preserves case and passes undecomposable chars through', () => {
  assert.equal(stripAccents('Æsop'), 'AEsop');
  assert.equal(stripAccents('straße'), 'strasse');
  assert.equal(stripAccents('Łódź'), 'Lodz');
  assert.equal(stripAccents('Café'), 'Cafe');
  assert.equal(stripAccents('naïve'), 'naive');
  assert.equal(stripAccents('Ré-do!'), 'Re-do!');
  assert.equal(stripAccents('猫'), '猫');
});

test('buildNormToDisplay: maps each norm char index back to the display index that produced it', () => {
  assert.equal(buildNormToDisplay(null), null);
  assert.deepEqual(Array.from(buildNormToDisplay('')), []);
  assert.deepEqual(Array.from(buildNormToDisplay('cat')), [0, 1, 2]);
  assert.deepEqual(Array.from(buildNormToDisplay('New York!')), [0, 1, 2, 4, 5, 6, 7]);
  assert.deepEqual(Array.from(buildNormToDisplay('Æsop')), [0, 0, 1, 2, 3]);
  assert.deepEqual(Array.from(buildNormToDisplay('straße')), [0, 1, 2, 3, 4, 4, 5]);
});

test('projectRangesToDisplay: maps norm-coordinate ranges onto the display string', () => {
  const ny = { norm: 'newyork', display: 'New York!' };
  assert.deepEqual(projectRangesToDisplay([{ start: 0, end: 3 }], ny), [{ start: 0, end: 3 }]);
  assert.deepEqual(projectRangesToDisplay([{ start: 3, end: 7 }], ny), [{ start: 4, end: 8 }]);
  assert.deepEqual(projectRangesToDisplay([{ start: 0, end: 7 }], ny), [{ start: 0, end: 8 }]);

  const aesop = { norm: 'aesop', display: 'Æsop' };
  assert.deepEqual(projectRangesToDisplay([{ start: 0, end: 2 }], aesop), [{ start: 0, end: 1 }]);
  assert.deepEqual(projectRangesToDisplay([{ start: 0, end: 1 }], aesop), [{ start: 0, end: 1 }]);
  assert.deepEqual(projectRangesToDisplay([{ start: 2, end: 5 }], aesop), [{ start: 1, end: 4 }]);

  const abc = { norm: 'abc', display: 'abc' };
  assert.deepEqual(projectRangesToDisplay([{ start: 0, end: 0 }], abc), [{ start: 0, end: 0 }]);
  assert.deepEqual(projectRangesToDisplay([{ start: 1, end: 1 }], abc), [{ start: 1, end: 1 }]);
  assert.deepEqual(projectRangesToDisplay([{ start: 2, end: 3 }], abc), [{ start: 2, end: 3 }]);
  assert.deepEqual(projectRangesToDisplay([{ start: 3, end: 5 }], abc), [{ start: 3, end: 3 }]);

  assert.deepEqual(projectRangesToDisplay([], abc), []);
  assert.equal(projectRangesToDisplay(null, abc), null);

  const ranges = [{ start: 0, end: 1 }];
  assert.equal(projectRangesToDisplay(ranges, { norm: 'cat', display: null }), ranges);

  const displayRange = { start: 1, end: 2, coord: 'display' };
  assert.deepEqual(projectRangesToDisplay([displayRange], ny), [displayRange]);
});

test('buildUserWlEntry: trims, always keeps a verbatim display, and norms the trimmed text', () => {
  assert.deepEqual(buildUserWlEntry('  CAT  ', 50, ''), { norm: 'cat', display: 'CAT', score: 50, comment: '' });
  assert.deepEqual(buildUserWlEntry('New York', 50, 'a note'), { norm: 'newyork', display: 'New York', score: 50, comment: 'a note' });
  assert.deepEqual(buildUserWlEntry('cat', 50, ''), { norm: 'cat', display: 'cat', score: 50, comment: '' });
});

test('synthWlEntry: display is null only when the text already equals its norm', () => {
  assert.deepEqual(synthWlEntry('cat', 1), { norm: 'cat', display: null, score: 1, comment: '', wordlist: null });
  assert.deepEqual(synthWlEntry('CAT', 1), { norm: 'cat', display: 'CAT', score: 1, comment: '', wordlist: null });
  assert.deepEqual(synthWlEntry('new york', 1), { norm: 'newyork', display: 'new york', score: 1, comment: '', wordlist: null });
});
