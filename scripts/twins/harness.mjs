// Tuning harness. See README.md.
//   node harness.mjs eval [--set k=v,...] [--holdout]
//   node harness.mjs sweep variants.json [--holdout] [--quick]   --quick skips ranks: seconds, not minutes
//   node harness.mjs pool N --out pool.tsv      results to label, from several configs
//   node harness.mjs finds N [--set ...]        random queries' best hits, for rating
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadCorpus, makeScorer, normOf } from './lib.mjs';
import { loadAll } from './readings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIN_SCORE = 40;
const CUTS = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45];

// ─── Worker ──────────────────────────────────────────
if (!isMainThread) {
  const { entries, byNorm, asEntry: asQuery } = loadAll(MIN_SCORE);
  parentPort.on('message', ({ id, job, overrides }) => {
    const scorer = makeScorer(overrides);
    let out;
    if (job.kind === 'case') {
      const q = asQuery(job.a), target = byNorm.get(normOf(job.b));
      if (!target) out = { status: 'absent' };
      else {
        const h = scorer.score(q, target, Infinity) ?? scorer.detail(q, target);
        const hits = h.loose === Infinity ? [] : scorer.query(q, { maxLoose: h.loose + 1e-9, corpus: entries });
        const idx = hits.findIndex((x) => x.e.norm === target.norm);
        out = idx < 0
          ? { status: 'filtered', loose: h.loose, diff: h.diff }
          : { status: 'ranked', rank: idx + 1, loose: h.loose, letters: h.sound ? h.letters : h.loose, diff: h.diff, best: hits[0].loose,
              top: hits.slice(0, 10).map(slim) };
      }
    } else if (job.kind === 'probe') {
      const q = entries[job.index];
      const hits = scorer.query(q, { maxLoose: 0.45, corpus: entries });
      out = { q: q.display, counts: CUTS.map((c) => hits.filter((h) => h.loose <= c).length),
              top: hits.slice(0, job.keep ?? 10).map(slim) };
    } else if (job.kind === 'pair') {
      const q = asQuery(job.a), e = asQuery(job.b);
      const h = scorer.score(q, e, 50);
      out = h ? { loose: h.loose, diff: h.diff } : { loose: Infinity, diff: 'filtered' };
    }
    parentPort.postMessage({ id, out });
  });
  parentPort.postMessage({ ready: true });
}

const slim = (h) => ({ d: h.e.display, s: h.e.score, l: +h.loose.toFixed(3), diff: h.diff });

// ─── Pool ────────────────────────────────────────────
function pool(n = Math.min(10, os.cpus().length - 2)) {
  const workers = [], idle = [], queue = [], pending = new Map();
  let ready = 0, nextId = 0, onReady;
  const readyP = new Promise((r) => (onReady = r));
  for (let i = 0; i < n; i++) {
    const w = new Worker(fileURLToPath(import.meta.url));
    w.on('message', (m) => {
      if (m.ready) { idle.push(w); if (++ready === n) onReady(); pump(); return; }
      pending.get(m.id)(m.out); pending.delete(m.id); idle.push(w); pump();
    });
    workers.push(w);
  }
  function pump() {
    while (idle.length && queue.length) {
      const { msg, resolve } = queue.shift();
      pending.set(msg.id, resolve);
      idle.pop().postMessage(msg);
    }
  }
  return {
    ready: readyP,
    run: (job, overrides) => new Promise((resolve) => { queue.push({ msg: { id: nextId++, job, overrides }, resolve }); pump(); }),
    close: () => workers.forEach((w) => w.terminate()),
  };
}

// ─── Data ────────────────────────────────────────────
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function loadCases() {
  return fs.readFileSync(path.join(HERE, 'cases.tsv'), 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => { const [a, b, cat] = l.split('\t'); return { a, b, cat, holdout: hash(a + b) % 4 === 0 }; });
}

export function loadLabels() {
  const f = process.env.LABELS ?? path.join(HERE, 'labels.tsv');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
    .map((l) => { const [a, b, label, by] = l.split('\t'); return { a, b, label, by }; });
}

// Fixed seed so noise counts compare across runs and configs.
function probeIndexes(count, total) {
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  return Array.from({ length: count }, () => Math.floor(rnd() * total));
}

// ─── Eval ────────────────────────────────────────────
async function evaluate(P, overrides, { holdout = false, total, quick = false }) {
  const cases = loadCases().filter((c) => c.holdout === holdout);
  const dirs = cases.flatMap((c) => [{ ...c }, { ...c, a: c.b, b: c.a, rev: true }]);
  const labels = loadLabels();
  const [caseRes, probeRes, labelRes] = await Promise.all([
    Promise.all(dirs.map((c) => P.run({ kind: quick ? 'pair' : 'case', a: c.a, b: c.b }, overrides)
      .then((r) => (quick ? { status: 'scored', ...r } : r)))),
    Promise.all(probeIndexes(40, total).map((index) => P.run({ kind: 'probe', index }, overrides))),
    Promise.all(labels.map((l) => P.run({ kind: 'pair', a: l.a, b: l.b }, overrides))),
  ]);
  dirs.forEach((c, i) => (c.r = caseRes[i]));
  labels.forEach((l, i) => (l.r = labelRes[i]));
  return { dirs, probes: probeRes, labels };
}

function summarize({ dirs, probes, labels }) {
  const byCat = {};
  for (const c of dirs) {
    if (c.r.status === 'absent') continue;
    const s = (byCat[c.cat] ??= { n: 0, h1: 0, h5: 0, h20: 0, rr: 0, looses: [] });
    s.n++;
    if (c.r.status === 'ranked') {
      const r = c.r.rank;
      s.h1 += r <= 1; s.h5 += r <= 5; s.h20 += r <= 20; s.rr += 1 / r;
    }
    s.looses.push(c.r.loose);
  }
  const all = Object.values(byCat).reduce((t, s) => ({ n: t.n + s.n, h1: t.h1 + s.h1, h5: t.h5 + s.h5, h20: t.h20 + s.h20, rr: t.rr + s.rr, looses: t.looses.concat(s.looses) }),
    { n: 0, h1: 0, h5: 0, h20: 0, rr: 0, looses: [] });
  const noise = CUTS.map((_, k) => probes.reduce((t, p) => t + p.counts[k], 0) / probes.length);
  const casePos = dirs.filter((c) => c.r.status !== 'absent').map((c) => c.r.loose);
  const pos = labels.filter((l) => l.label === 'good').map((l) => l.r.loose).concat(casePos);
  const neg = labels.filter((l) => l.label === 'junk').map((l) => l.r.loose);
  let auc = null;
  if (pos.length && neg.length) {
    let w = 0;
    for (const p of pos) for (const q of neg) w += p < q ? 1 : p === q ? 0.5 : 0;
    auc = w / (pos.length * neg.length);
  }
  const jRated = labels.filter((l) => l.by === 'john' && l.label === 'good').map((l) => l.r.loose);
  const jPos = jRated.concat(casePos);
  const jNeg = labels.filter((l) => l.by === 'john' && l.label === 'junk').map((l) => l.r.loose);
  let aucJ = null;
  if (jPos.length && jNeg.length) {
    let w = 0;
    for (const p of jPos) for (const q of jNeg) w += p < q ? 1 : p === q ? 0.5 : 0;
    aucJ = w / (jPos.length * jNeg.length);
  }
  const frac = (xs, c) => xs.filter((x) => x <= c).length / xs.length;
  const recall = CUTS.map((c) => frac(casePos, c)), junk = CUTS.map((c) => (neg.length ? frac(neg, c) : NaN));
  let aucR = null;
  if (jRated.length && jNeg.length) {
    let w = 0;
    for (const p of jRated) for (const q of jNeg) w += p < q ? 1 : p === q ? 0.5 : 0;
    aucR = w / (jRated.length * jNeg.length);
  }
  const jRatedUnder = CUTS.map((c) => (jRated.length ? frac(jRated, c) : NaN));
  const jGood = CUTS.map((c) => (jPos.length ? frac(jPos, c) : NaN)), jJunk = CUTS.map((c) => (jNeg.length ? frac(jNeg, c) : NaN));
  return { byCat, all, noise, auc, aucJ, aucR, jRatedUnder, jGood, jJunk, recall, junk, nPos: pos.length, nNeg: neg.length };
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (a, n) => (n ? `${Math.round((100 * a) / n)}`.padStart(3) : '  -');

function printSummary(S, label = '') {
  if (label) console.log(`\n=== ${label}`);
  console.log('category   n   @1  @5 @20   MRR  med-loose');
  const row = (name, s) => console.log(`${name.padEnd(9)} ${String(s.n).padStart(3)}  ${pct(s.h1, s.n)} ${pct(s.h5, s.n)} ${pct(s.h20, s.n)}  ${(s.rr / s.n).toFixed(2)}  ${med(s.looses).toFixed(2)}`);
  for (const [k, s] of Object.entries(S.byCat).sort()) row(k, s);
  row('ALL', S.all);
  console.log(`noise (mean hits per random query) at ${CUTS.join('/')}: ${S.noise.map((x) => x.toFixed(0)).join('/')}`);
  console.log(`examples under cutoff:  ${S.recall.map((x) => pct(x, 1)).join(' ')}`);
  console.log(`labeled junk under it:  ${S.junk.map((x) => pct(x, 1)).join(' ')}`);
  console.log(`John's good under it:   ${S.jGood.map((x) => pct(x, 1)).join(' ')}`);
  console.log(`John's junk under it:   ${S.jJunk.map((x) => pct(x, 1)).join(' ')}`);
  if (S.aucJ !== null) console.log(`John-only good-vs-junk AUC ${S.aucJ.toFixed(3)}`);
  if (S.auc !== null) console.log(`good-vs-junk AUC ${S.auc.toFixed(3)} (${S.nPos} good incl. examples, ${S.nNeg} junk)`);
}

function oneLine(S) {
  const a = S.all;
  const cats = ['respace', 'chunk', 'letter', 'frame', 'move', 'sound', 'rhyme', 'run', 'shift', 'swap', 'spoon'].map((k) => S.byCat[k] ? pct(S.byCat[k].h5, S.byCat[k].n) : '  -').join(' ');
  const ranks = S.quick ? 'ranks skipped (--quick)' : `@1 ${pct(a.h1, a.n)} @5 ${pct(a.h5, a.n)} @20 ${pct(a.h20, a.n)} MRR ${(a.rr / a.n).toFixed(3)} | @5 by cat ${cats}`;
  return `${ranks} | rec/junk@.3 ${pct(S.recall[3], 1)}/${pct(S.junk[3], 1)} | noise@.3 ${S.noise[3].toFixed(0)}${S.auc !== null ? ` | AUC ${S.auc.toFixed(3)}` : ''}${S.aucJ !== null ? ` | John AUC +ex ${S.aucJ.toFixed(3)} rated ${S.aucR?.toFixed(3)} | rated-good/junk@.25 ${pct(S.jRatedUnder[2], 1)}/${pct(S.jJunk[2], 1)}` : ''}`;
}

// ─── Main ────────────────────────────────────────────
if (isMainThread) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
  const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const parseSet = (s) => Object.fromEntries((s || '').split(',').filter(Boolean)
    .map((kv) => { const [k, v] = kv.split('='); return [k, isNaN(+v) ? v : +v]; }));
  const holdout = flag('--holdout'), quick = flag('--quick');
  const overrides = parseSet(opt('--set', ''));
  const out = opt('--out', null);
  const [cmd, arg] = args;
  const { entries } = loadCorpus(MIN_SCORE);
  const total = entries.length;
  const P = pool();
  await P.ready;

  if (cmd === 'eval') {
    const R = await evaluate(P, overrides, { holdout, total });
    printSummary(summarize(R), JSON.stringify(overrides));
    console.log('\nmisses (rank > 5):');
    for (const c of R.dirs) {
      if (c.r.status === 'absent' || (c.r.status === 'ranked' && c.r.rank <= 5)) continue;
      console.log(`  ${c.cat.padEnd(8)} ${c.a.padEnd(22)} → ${c.b.padEnd(22)} ${c.r.status === 'ranked' ? `#${c.r.rank}` : c.r.status} @ ${c.r.loose.toFixed(2)} (best ${c.r.best?.toFixed(2) ?? '-'})  ${c.r.diff}`);
    }
    const absent = [...new Set(R.dirs.filter((c) => c.r.status === 'absent').map((c) => c.b))];
    console.log(`\nabsent from the list at score ≥ ${MIN_SCORE}: ${absent.join(', ')}`);
    if (out) fs.writeFileSync(out, JSON.stringify(R, null, 1));
  } else if (cmd === 'sweep') {
    const variants = JSON.parse(fs.readFileSync(arg, 'utf8'));
    for (const [name, ov] of Object.entries(variants)) {
      const S = { ...summarize(await evaluate(P, { ...overrides, ...ov }, { holdout, total, quick })), quick };
      console.log(`${name.padEnd(28)} ${oneLine(S)}`);
    }
  } else if (cmd === 'pool' || cmd === 'finds') {
    const n = +arg || 30;
    let s = Date.now() >>> 0;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const configs = cmd === 'pool'
      ? [overrides, { ...overrides, sound: Infinity }, { ...overrides, site: 0.4, shared: 0.5 }, { ...overrides, respace: -0.3 }]
      : [overrides];
    const seen = new Set(), rows = [];
    const idxs = Array.from({ length: n }, () => Math.floor(rnd() * total));
    for (const ov of configs) {
      const res = await Promise.all(idxs.map((index) => P.run({ kind: 'probe', index, keep: cmd === 'pool' ? 5 : 3 }, ov)));
      for (const p of res) for (const h of p.top) {
        const key = `${p.q}\t${h.d}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ q: p.q, ...h });
      }
    }
    rows.sort((x, y) => x.l - y.l);
    const text = rows.map((r) => `${r.q}\t${r.d}\t${r.l.toFixed(2)}\t${r.diff}`).join('\n');
    if (out) fs.writeFileSync(out, text + '\n');
    else console.log(text);
  } else {
    console.log('commands: eval, sweep FILE, pool N, finds N');
  }
  P.close();
}
