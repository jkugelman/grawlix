// Refreshes tests/unit/fixtures/cmu-cases.dict: the real CMU lines for every word
// in the Phone search highlight cases, so the test runs offline.
//
//   node scripts/phone-cases-dict.js
//
// The CMU dictionary is fetched once and cached in the OS temp dir.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CMU_DICT_URL } from '../site/src/engine/phonetics.js';
import { CASES } from '../tests/unit/tools/phone_search.cases.js';

const cmuPath = join(tmpdir(), 'grawlix-cmudict.dict');
if (!existsSync(cmuPath)) {
  const res = await fetch(CMU_DICT_URL);
  if (!res.ok) throw new Error(`fetch ${CMU_DICT_URL}: ${res.status}`);
  writeFileSync(cmuPath, await res.text());
}

const key = w => w.toLowerCase().replace(/[^a-z]/g, '');
const words = new Set();
for (const [query, entry] of CASES) {
  for (const w of `${query} ${entry}`.split(/[\s-]+/)) if (key(w)) words.add(key(w));
}
const lines = readFileSync(cmuPath, 'utf8').split('\n')
  .filter(line => words.has(key(line.split(' ')[0].replace(/\(\d+\)$/, ''))));
const found = new Set(lines.map(line => key(line.split(' ')[0].replace(/\(\d+\)$/, ''))));
const missing = [...words].filter(w => !found.has(w));

const out = new URL('../tests/unit/fixtures/cmu-cases.dict', import.meta.url);
writeFileSync(out, lines.join('\n') + '\n');
console.log(`${lines.length} lines for ${found.size} words → tests/unit/fixtures/cmu-cases.dict`);
if (missing.length) console.log(`not in CMU (read by letter or unreadable): ${missing.join(' ')}`);
