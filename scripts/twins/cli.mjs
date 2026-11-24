// Usage:
//   node cli.mjs                  interactive; a blank line rolls a random entry
//   node cli.mjs "brass tacks"    one or more queries
//   node cli.mjs --random 5       five random entries that have lookalikes
// Options: --max L (looseness cap, 0.45)  --limit N (25)  --min-score N (40)
//          --set knob=value,...   override scorer knobs (see DEFAULTS in lib.mjs)
import readline from 'node:readline';
import { makeScorer } from './lib.mjs';
import { loadAll } from './readings.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const MAX = +opt('--max', 0.45);
const LIMIT = +opt('--limit', 25);
const MIN_SCORE = +opt('--min-score', 40);
const RANDOM = opt('--random', null);
const overrides = Object.fromEntries((opt('--set', '') || '').split(',').filter(Boolean)
  .map((kv) => { const [k, v] = kv.split('='); return [k, isNaN(+v) ? v : +v]; }));

const { entries, asEntry } = loadAll(MIN_SCORE);
const scorer = makeScorer(overrides);
console.error(`${entries.length} entries with score ≥ ${MIN_SCORE}`);

function show(text, hits) {
  console.log(`\n${text}`);
  for (const h of hits.slice(0, LIMIT))
    console.log(`  ${h.loose.toFixed(2)}  ${String(h.e.score).padStart(2)}  ${h.e.display.padEnd(28)} ${h.diff}`);
  console.log(`  — ${hits.length} under ${MAX}`);
}

function run(text) {
  const q = asEntry(text);
  show(text, scorer.query(q, { maxLoose: MAX, corpus: entries }));
}

function roll() {
  for (let tries = 0; tries < 50; tries++) {
    const q = entries[Math.floor(Math.random() * entries.length)];
    const hits = scorer.query(q, { maxLoose: MAX, corpus: entries });
    if (hits.length) return show(`🎲 ${q.display}`, hits);
  }
  console.log('no luck in 50 rolls');
}

if (RANDOM) for (let i = 0; i < +RANDOM; i++) roll();
else if (args.length) args.forEach(run);
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'twins (blank = 🎲)> ' });
  rl.prompt();
  rl.on('line', (l) => { l.trim() ? run(l.trim()) : roll(); rl.prompt(); });
}
