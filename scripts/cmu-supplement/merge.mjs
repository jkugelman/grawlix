// Applies a pass's answers to site/data/cmu-supplement.dict and excluded.tsv,
// after checking every answer file against its batch. The answer forms are in
// docs/cmu-supplement.md.
//
//   node scripts/cmu-supplement/merge.mjs DIR...

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXCLUDED, SUPPLEMENT, excluded, wordKinds, wordlistTokens } from './lib.mjs';

const PHONE = /^((AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)[012]|B|CH|D|DH|F|G|HH|JH|K|L|M|N|NG|P|R|S|SH|T|TH|V|W|Y|Z|ZH)$/;
const isPron = text => text.trim().split(/\s+/).every(p => PHONE.test(p));
const prons = text => text.split('|').map(p => p.trim().split(/\s+/).join(' '));

const entries = new Map();
for (const line of readFileSync(SUPPLEMENT, 'utf8').split('\n')) {
  if (!line) continue;
  const sp = line.indexOf(' ');
  const word = line.slice(0, sp).replace(/\(\d+\)$/, '');
  if (!entries.has(word)) entries.set(word, []);
  entries.get(word).push(line.slice(sp + 1));
}
const skip = excluded();

const problems = [];
const answers = [];
for (const dir of process.argv.slice(2)) {
  for (const name of readdirSync(dir).filter(n => /^out-\d{3}\.tsv$/.test(n)).sort()) {
    const batch = readFileSync(join(dir, `batch-${name.slice(4, 7)}`), 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
    const out = readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
    if (out.length !== batch.length) problems.push(`${dir}/${name}: ${out.length} answers for ${batch.length} lines`);
    out.forEach((answer, i) => {
      const where = `${dir}/${name}:${i + 1}`;
      if (answer[0] !== batch[i]?.[0]) return problems.push(`${where}: ${answer[0]} answers ${batch[i]?.[0]}`);
      if (answer[1] === 'PRON') answer.splice(1, 1);
      const [, kind, spaced] = answer;
      if (kind === 'PHRASE' && !spaced) problems.push(`${where}: PHRASE without its spaced words`);
      else if (!['PHRASE', 'FRAGMENT', 'OK', 'NEW', 'WORD'].includes(kind) && !prons(kind ?? '').every(isPron)) {
        problems.push(`${where}: bad phones in ${kind}`);
      }
      answers.push([answer, batch[i]]);
    });
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const counts = { entries: 0, excluded: 0, kept: 0 };
for (const [[token, kind, spaced], line] of answers) {
  if (kind === 'PHRASE' || kind === 'FRAGMENT') {
    entries.delete(token);
    skip.set(token, { kind, spaced: kind === 'PHRASE' ? spaced : undefined });
    counts.excluded++;
  } else if (kind === 'OK' && line[1] && prons(line[1]).every(isPron)) {
    entries.set(token, prons(line[1]));
    counts.entries++;
  } else if (kind === 'OK') {
    skip.set(token, { kind: 'SPLIT' });
    counts.excluded++;
  } else if (kind === 'NEW' || kind === 'WORD') {
    counts.kept++;
  } else {
    entries.set(token, prons(kind));
    skip.delete(token);
    counts.entries++;
  }
}

const LETTER_NAMES = {
  a: 'EY1', b: 'B IY1', c: 'S IY1', d: 'D IY1', e: 'IY1', f: 'EH1 F', g: 'JH IY1', h: 'EY1 CH', i: 'AY1',
  j: 'JH EY1', k: 'K EY1', l: 'EH1 L', m: 'EH1 M', n: 'EH1 N', o: 'OW1', p: 'P IY1', q: 'K Y UW1', r: 'AA1 R',
  s: 'EH1 S', t: 'T IY1', u: 'Y UW1', v: 'V IY1', w: 'D AH1 B AH0 L Y UW0', x: 'EH1 K S', y: 'W AY1', z: 'Z IY1',
};
const VOICELESS = new Set(['P', 'T', 'K', 'F', 'TH', 'S', 'SH', 'CH']);
const HISSING = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);
const spelled = (letters, plural) => {
  let pron = [...(plural ? letters.slice(0, -1) : letters)].map(c => LETTER_NAMES[c]).join(' ');
  if (plural) {
    const last = pron.slice(pron.lastIndexOf(' ') + 1).replace(/\d/, '');
    pron += HISSING.has(last) ? ' IH0 Z' : VOICELESS.has(last) ? ' S' : ' Z';
  }
  return pron;
};
const bare = p => p.replace(/\d/g, '');
let lettered = 0;
for (const { letters, written } of wordlistTokens()) {
  const list = entries.get(letters);
  if (!list || !wordKinds(written).includes('initialism')) continue;
  const plural = written.endsWith('s') && written !== written.toUpperCase();
  if (letters.length - plural > 5) continue;
  const pron = spelled(letters, plural);
  if (!list.some(p => bare(p) === bare(pron))) {
    list.push(pron);
    lettered++;
  }
}

const dict = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .flatMap(([word, list]) => list.map((p, i) => `${word}${i ? `(${i + 1})` : ''} ${p}`));
writeFileSync(SUPPLEMENT, dict.join('\n') + '\n');
writeFileSync(EXCLUDED, [...skip].sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([token, { kind, spaced }]) => (kind === 'PHRASE' ? `${token}\tPHRASE\t${spaced}` : `${token}\t${kind}`))
  .join('\n') + '\n');
console.log({ ...counts, lettered, words: entries.size });
