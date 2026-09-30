// Before/after report for a change to engine/phone-align.js: aligns every CMU
// word under the working-tree aligner and under a git ref's, and lists the words
// whose letter–sound pairing changed.
//
//   node scripts/phone-align-diff.js [ref=HEAD] [--limit N] [--grep REGEX]
//
// The CMU dictionary is fetched once and cached in the OS temp dir.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CMU_DICT_URL, parseCmuDict, setCmuDict, soundsOf } from '../site/src/engine/phonetics.js';
import * as current from '../site/src/engine/phone-align.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const limit = +opt('--limit', 60);
const grep = opt('--grep', null);
const ref = args[0] || 'HEAD';

const cmuPath = join(tmpdir(), 'grawlix-cmudict.dict');
if (!existsSync(cmuPath)) {
  const res = await fetch(CMU_DICT_URL);
  if (!res.ok) throw new Error(`fetch ${CMU_DICT_URL}: ${res.status}`);
  writeFileSync(cmuPath, await res.text());
}
setCmuDict(parseCmuDict(readFileSync(cmuPath, 'utf8')));

// Loads standalone only while phone-align.js has no relative imports; give it one
// and this copy stops resolving.
const dir = mkdtempSync(join(tmpdir(), 'phone-align-'));
const refPath = join(dir, 'phone-align.js');
writeFileSync(refPath, execFileSync('git', ['show', `${ref}:site/src/engine/phone-align.js`], { encoding: 'utf8' }));
const before = await import(pathToFileURL(refPath).href);

const show = (word, phones, steps) => steps.map(s =>
  `${word.slice(s.from, s.to) || '∅'}:${phones.slice(s.phoneFrom, s.phoneTo).join('+') || '∅'}`).join(' ');

const words = [...new Set(readFileSync(cmuPath, 'utf8').split('\n')
  .map(line => line.split(' ')[0].replace(/\(\d+\)$/, ''))
  .filter(w => /^[a-z]+$/.test(w)))];

let pairs = 0;
const changed = [];
for (const word of words) {
  for (const { phones } of soundsOf(word) || []) {
    pairs++;
    const a = show(word, phones, before.alignWord(word, phones).steps);
    const b = show(word, phones, current.alignWord(word, phones).steps);
    if (a !== b) changed.push({ word, a, b });
  }
}

const shown = grep ? changed.filter(c => new RegExp(grep).test(c.word)) : changed;
console.log(`${changed.length} of ${pairs} word pronunciations changed vs ${ref}` + (grep ? ` (${shown.length} match /${grep}/)` : ''));
const step = Math.max(1, shown.length / limit);
for (let i = 0; i < shown.length && i / step < limit; i += step) {
  const { word, a, b } = shown[Math.floor(i)];
  console.log(`\n${word}\n  - ${a}\n  + ${b}`);
}
