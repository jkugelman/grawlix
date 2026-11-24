// Loads the corpus (via lib.mjs, read-only) and attaches a pronunciation to
// each entry, cached on disk because reading 430k entries takes about a minute.
import fs from 'node:fs';
import os from 'node:os';
import { loadCorpus, normOf, prep, services } from './lib.mjs';
import { initReader } from './cmu.mjs';
import { prepReading } from '../../site/src/engine/twins-sound.js';
import { makeWordTable } from '../../site/src/engine/twins-swap.js';
import { configureSwapTable } from '../../site/src/engine/twins.js';

const CACHE = `${os.homedir()}/.cache/grawlix/twins-phon-reads-v5.json`;

export function loadAll(minScore = 40) {
  const corpus = loadCorpus(minScore);
  initReader();
  let cache = Object.create(null);
  if (fs.existsSync(CACHE)) Object.assign(cache, JSON.parse(fs.readFileSync(CACHE, "utf8")));
  let dirty = false;
  const reads = new Map();
  const svc = services();
  const readOf = (text, norm) => {
    const hit = cache[norm];
    if (hit !== undefined) return hit && { variants: hit.v.map((s) => { const words = s.split(' | ').map((w) => w.split(' ')); return { toks: words.flat(), words }; }), nWords: hit.n, split: !!hit.sp, spelled: !!hit.sl };
    dirty = true;
    const r = svc.read(text);
    cache[norm] = r ? { v: r.variants.map((v) => v.words.map((w) => w.join(' ')).join(' | ')), n: r.nWords, sp: +r.split, sl: +r.spelled } : 0;
    return r;
  };
  const t0 = Date.now();
  const table = makeWordTable((w) => svc.readWord(w));
  for (const e of corpus.entries) e.swap = svc.swap(e.display, table);
  configureSwapTable(table);
  if (process.env.TWINS_SWAP_STATS) console.error(`swap table: ${Date.now() - t0} ms, ${(table.bytes / 1e6).toFixed(1)} MB, ${corpus.entries.filter((e) => e.swap).length} entries`);
  for (const e of corpus.entries) {
    const r = readOf(e.display, e.norm);
    e.read = r;
    if (r) r.viaSeg = !e.ownSpaced && e.spaced !== e.display;
    e.sound = prepReading(r);
    e.rhymes = svc.rhymes(e.display);
  }
  if (dirty) fs.writeFileSync(CACHE, JSON.stringify(cache));
  const asEntry = (text) => {
    const hit = corpus.byNorm.get(normOf(text));
    if (hit) return hit;
    const e = prep({ display: text });
    e.read = svc.read(text, true);
    e.sound = prepReading(e.read);
    e.rhymes = svc.rhymes(text, true);
    e.swap = svc.swap(text, table);
    return e;
  };
  return { ...corpus, asEntry };
}
