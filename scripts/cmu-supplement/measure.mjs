// Runs the real Phone search tool over queries.json against the JK and XWI
// wordlists (entries scored 50 and up), once with REF's supplement and once
// with the working one, and prints the hits each query gained and lost.
// REF `none` measures against CMU alone.
//
//   node scripts/cmu-supplement/measure.mjs [REF=HEAD] [SHOWN=6]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import tool from '../../site/src/engine/tools/phone_search.js';
import { SUPPLEMENT, WORDLISTS, loadDicts, loadSegmenter, supplementAt, vocabOf, wordlistRows } from './lib.mjs';

const [ref = 'HEAD', shown = 6] = process.argv.slice(2);
const queries = JSON.parse(readFileSync(new URL('./queries.json', import.meta.url), 'utf8'));
const LISTS = { jk: 'jkugelman-wordlist.txt', xwi: 'XwiJeffChenList.txt' };

await loadSegmenter();
const vocab = vocabOf(wordlistRows());
const lists = Object.entries(LISTS).map(([name, file]) => {
  const wordlist = vocabOf(wordlistRows(join(WORDLISTS, file)).filter(([, score]) => score >= 50));
  return { name, wordlist, displays: wordlist.entries.map(e => e.display ?? e.norm) };
});

async function hits(supplement) {
  await loadDicts(supplement);
  const out = {};
  for (const { name, wordlist, displays } of lists) {
    const store = new Map();
    const cache = {
      get: k => store.get(k), peek: k => store.get(k), put: (k, v) => store.set(k, v),
      take: k => { const v = store.get(k); store.delete(k); return v; },
    };
    const ctx = {
      wordlist, vocab, cache, due: () => false, yield: async () => {}, throwIfAborted() {},
      async forEach(items, fn) { let i = 0; for (const x of items) fn(x, i++); },
    };
    out[name] = {};
    for (const q of queries) {
      const prepared = await tool.prepare({ entry: q }, ctx);
      out[name][q] = new Set(displays.filter(d => tool.run(d, prepared)));
    }
  }
  return out;
}

const before = await hits(supplementAt(ref));
const after = await hits(SUPPLEMENT);
for (const { name } of lists) {
  const total = side => Object.values(side[name]).reduce((n, s) => n + s.size, 0);
  const rows = [];
  let gained = 0, lost = 0;
  for (const q of queries) {
    const a = before[name][q], b = after[name][q];
    const plus = [...b].filter(x => !a.has(x)).sort(), minus = [...a].filter(x => !b.has(x)).sort();
    gained += plus.length;
    lost += minus.length;
    if (plus.length || minus.length) rows.push({ q, plus, minus });
  }
  console.log(`== ${name}: ${total(before)} → ${total(after)} hits (+${gained} / −${lost}), ${rows.length} of ${queries.length} queries changed`);
  rows.sort((x, y) => y.plus.length + y.minus.length - x.plus.length - x.minus.length);
  for (const { q, plus, minus } of rows) {
    console.log(`  ${q}: +${plus.length} ${plus.slice(0, shown).join(', ')}${minus.length ? `  −${minus.length} ${minus.slice(0, shown).join(', ')}` : ''}`);
  }
}
