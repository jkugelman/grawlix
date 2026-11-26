import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labShellHTML } from '../../scripts/lab.js';
import { parseThesaurus, findClues } from '../../site/lab/storm-surge/storm-surge.js';

// ─── Lab shells ──────────────────────────────────────────────────────────

const INDEX = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');

test('a lab shell climbs out of lab/<name>/ for every relative URL', () => {
  const html = labShellHTML(INDEX, 'demo');
  assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/css\/app\.css">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\.\/\.\.\/icons\/apple-touch-icon\.png">/);
  assert.match(html, /<script type="module" src="main\.js"><\/script>/);
  const relative = [...html.matchAll(/ (?:href|src)="(?!#|[a-z]+:|\/|\.\.\/\.\.\/|main\.js")([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(relative, []);
});

test('a lab shell is unindexed, uninstallable, and titled with its name', () => {
  const html = labShellHTML(INDEX, 'demo');
  assert.match(html, /<title>Grawlix Lab: demo<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /manifest/);
});

test('a lab shell refuses an index.html without the main.js script tag', () => {
  assert.throws(() => labShellHTML(INDEX.replace('src/main.js', 'src/app.js'), 'demo'));
});

// ─── Storm surge ─────────────────────────────────────────────────────────

const T = parseThesaurus([
  '@moby',
  'surge:boost,boom,swell,rush',
  '@wordnet',
  'hit,show,shot',
  '@roget',
  'stop,pushback,putback',
  'dog,hag,nag',
  '@quality',
  'surge:boost+,boom+',
  'hit:show+,shot',
].join('\n'));

const ALL = new Set(['moby', 'wordnet', 'roget']);
const FITS = {
  end: (p, q) => !q,
  start: (p, q) => !p,
  middle: (p, q) => !!p && !!q,
  any: () => true,
};
const clues = (entry, fits = FITS.any, sources = ALL) =>
  findClues(entry, T, sources, fits).map(h => `[${h.p}___${h.q}] ${h.a}/${h.b}=${h.z}`);

test('STORM SURGE reads as ST OR M SURGE', () => {
  assert.deepStrictEqual(clues('stormsurge', FITS.end), ['[boo___] boost/boom=surge']);
});

test('the blank can sit at the start or in the middle', () => {
  assert.deepStrictEqual(clues('horndog', FITS.start), ['[___ag] hag/nag=dog']);
  assert.deepStrictEqual(clues('shortstop', FITS.middle), ['[pu___back] pushback/putback=stop']);
  assert.deepStrictEqual(clues('shortstop', FITS.end), []);
});

test('Moby lists count one way only', () => {
  const reverseOnly = parseThesaurus('@moby\nboost:surge\nboom:surge');
  assert.deepStrictEqual(findClues('stormsurge', reverseOnly, ALL, FITS.end), []);
});

test('a WordNet or Roget group makes every member a synonym of the rest', () => {
  assert.deepStrictEqual(clues('worthit', FITS.end), ['[sho___] show/shot=hit']);
  assert.deepStrictEqual(clues('worthit', FITS.end, new Set(['moby', 'roget'])), []);
});

test('the clue needs some letters of its own, and the two words must differ', () => {
  assert.deepStrictEqual(clues('boostorboomsurge'), []);
});

test('a clue is only as strong as its weaker pair, and unrated pairs are weak', () => {
  const rated = (entry, fits) => findClues(entry, T, ALL, fits).map(h => h.quality);
  assert.deepStrictEqual(rated('stormsurge', FITS.end), [3]);
  assert.deepStrictEqual(rated('worthit', FITS.end), [2]);
  assert.deepStrictEqual(rated('horndog', FITS.start), [1]);
});
