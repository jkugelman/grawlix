// Ground truth for candidate filters: every exact hit under 0.45 for the
// examples' queries (both sides) and a seeded sample of random entries.
//   node filter/truth.mjs [--random 100] --out truth.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { makeScorer } from '../lib.mjs';
import { loadAll } from '../readings.mjs';

const CAP = 0.45;

if (!isMainThread) {
  const C = loadAll(40);
  const scorer = makeScorer({ prefilter: false });
  parentPort.on('message', ({ id, text }) => {
    const q = C.asEntry(text);
    const t = Date.now();
    const hits = scorer.query(q, { maxLoose: CAP, corpus: C.entries });
    parentPort.postMessage({ id, ms: Date.now() - t, hits: hits.map((h) => [h.e.norm, +h.loose.toFixed(4), h.rhyme ? 'R' : h.run ? 'U' : h.swap ? 'W' : h.sound ? 'S' : h.blockSwap ? 'B' : 'L']) });
  });
  parentPort.postMessage({ ready: true });
} else {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
  const C = loadAll(40);
  const texts = new Set();
  for (const l of fs.readFileSync(path.join(HERE, '../cases.tsv'), 'utf8').split('\n')) {
    if (!l || l[0] === '#') continue;
    const [a, b] = l.split('\t');
    texts.add(a); texts.add(b);
  }
  let s = 4242;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let k = 0; k < +opt('--random', 100); k++) texts.add(C.entries[Math.floor(rnd() * C.entries.length)].display);
  const n = Math.min(10, os.cpus().length - 2), idle = [], queue = [...texts], out = {};
  let left = queue.length;
  await new Promise((done) => {
    for (let i = 0; i < n; i++) {
      const w = new Worker(fileURLToPath(import.meta.url));
      const next = () => { const text = queue.shift(); if (text) w.postMessage({ id: text, text }); };
      w.on('message', (m) => {
        if (m.ready) return next();
        out[m.id] = { ms: m.ms, hits: m.hits };
        if (--left === 0) done(); else next();
      });
    }
  });
  fs.writeFileSync(opt('--out', 'truth.json'), JSON.stringify(out));
  console.log(Object.keys(out).length, 'queries');
  process.exit(0);
}
