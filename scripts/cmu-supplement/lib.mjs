// Shared setup for the CMU supplement scripts: the two dictionaries, the
// wordlists, and the segmenter, loaded the way the pipeline worker loads them.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CMU_DICT_URL, parseCmuDict, setCmuDict, soundsOf } from '../../site/src/engine/phonetics.js';
import { lookup } from '../../site/src/engine/tools/phone_search.js';
import * as segmenter from '../../site/src/engine/segmenter.js';
import { spacingReader } from '../../site/src/engine/space-out.js';
import { tokensOf } from '../../site/src/engine/phone-reading.js';
import { wordKinds } from '../../site/src/engine/rule-query.js';
import { merged } from '../../tests/unit/tools/harness.js';

export const SUPPLEMENT = new URL('../../site/data/cmu-supplement.dict', import.meta.url).pathname;
export const EXCLUDED = new URL('./excluded.tsv', import.meta.url).pathname;
export const WORDLISTS = process.env.WORDLISTS ?? join(homedir(), 'wordlist');
export const ALL_WORDLISTS = join(WORDLISTS, 'all-wordlists.txt');

export { lookup, soundsOf, tokensOf, wordKinds, segmenter };

export async function cmuText() {
  const path = join(tmpdir(), 'grawlix-cmudict.dict');
  if (!existsSync(path)) {
    const res = await fetch(CMU_DICT_URL);
    if (!res.ok) throw new Error(`fetch ${CMU_DICT_URL}: ${res.status}`);
    writeFileSync(path, await res.text());
  }
  return readFileSync(path, 'utf8');
}

export async function loadDicts(supplement = SUPPLEMENT) {
  setCmuDict(parseCmuDict(await cmuText()), supplement ? parseCmuDict(readFileSync(supplement, 'utf8')) : {});
}

export function supplementAt(ref) {
  if (ref === 'none') return null;
  const path = join(tmpdir(), `grawlix-cmu-supplement-${ref.replace(/[^\w.-]/g, '_')}.dict`);
  writeFileSync(path, execFileSync('git', ['show', `${ref}:site/data/cmu-supplement.dict`], { maxBuffer: 1 << 27 }));
  return path;
}

export function supplementKeys(path = SUPPLEMENT) {
  return new Set(parseCmuDict(readFileSync(path, 'utf8')).keys());
}

export function wordlistRows(path = ALL_WORDLISTS) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => {
    const [entry, score] = line.split(';');
    return [entry, +score];
  });
}

export async function loadSegmenter() {
  segmenter.configureIO({ idbGet: async () => null, idbPut: async () => {} });
  await segmenter.loadUnigramCorpus();
}

export const vocabOf = rows => merged(rows.map(([entry]) => ({ entry })));

export const spacingOf = vocab => spacingReader({ cache: { get: () => undefined }, vocab });

export function* wordlistTokens(rows = wordlistRows()) {
  for (const [entry, score] of rows) {
    for (const t of tokensOf(entry)) {
      if (t.digits || !t.letters) continue;
      yield { letters: t.letters, written: t.at.map(i => entry[i]).join(''), entry, score };
    }
  }
}

export function excluded() {
  if (!existsSync(EXCLUDED)) return new Map();
  return new Map(readFileSync(EXCLUDED, 'utf8').split('\n').filter(Boolean).map(line => {
    const [token, kind, spaced] = line.split('\t');
    return [token, { kind, spaced }];
  }));
}

export function examplesByToken(rows = wordlistRows(), n = 3) {
  const by = new Map();
  for (const [entry, score] of rows) {
    for (const t of tokensOf(entry)) {
      if (t.digits || !t.letters) continue;
      let list = by.get(t.letters);
      if (!list) by.set(t.letters, list = []);
      list.push([score, entry]);
    }
  }
  const out = new Map();
  for (const [token, list] of by) {
    list.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length);
    const seen = new Set();
    const picked = [];
    for (const [, entry] of list) {
      if (seen.has(entry.toLowerCase())) continue;
      seen.add(entry.toLowerCase());
      picked.push(entry);
      if (picked.length === n) break;
    }
    out.set(token, picked);
  }
  return out;
}
