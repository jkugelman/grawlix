// Builds site/lab/storm-surge/data/thesaurus.txt from three thesauri:
//   Moby Thesaurus II (public domain), via the `moby` npm package's words.txt
//   Open English WordNet 2025 (CC BY 4.0), via scripts/wordnet.js
//   Roget's Thesaurus (public domain), John's copy in jkugelman/crossword
// and rates each synonym pair with counter-fitted word vectors (Mrkšić et al. 2016),
// which put near-synonyms close together. Only the ratings ship, not the vectors.
//
// Output, one section per source, opened by an `@<source>` line:
//   head:a,b,c   Moby: a, b and c are listed under head (one direction only)
//   a,b,c        WordNet synset / Roget's group: every member is a synonym of every other
//   a:b+,c       @quality: a and b are a strong pair, a and c a fair one; any other
//                pair is weak. Each pair is listed once, under one of its words.
// Words keep their spaces and hyphens; the tool normalizes them at load.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fetchWordNet } from '../wordnet.js';

const OUT = 'site/lab/storm-surge/data/thesaurus.txt';
const MOBY = 'https://registry.npmjs.org/moby/-/moby-1.1.2.tgz';
const ROGET = 'https://codeload.github.com/jkugelman/crossword/tar.gz/main';
const VECTORS = 'https://raw.githubusercontent.com/nmrksic/counter-fitting/master/word_vectors/counter-fitted-vectors.txt.zip';
const STRONG = 0.3, FAIR = 0.15;

const clean = w => w.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const usable = w => /[a-z]/.test(w) && !/[,:@]/.test(w);
const uniq = ws => [...new Set(ws.map(clean).filter(usable))];

function untar(url) {
  const dir = mkdtempSync(join(tmpdir(), 'storm-surge-'));
  execFileSync('sh', ['-c', 'curl -sSfL "$0" | tar xz -C "$1"', url, dir]);
  return dir;
}

function moby() {
  const dir = untar(MOBY);
  const lines = [];
  for (const line of readFileSync(join(dir, 'package/words.txt'), 'utf8').split('\n')) {
    const [head, ...rest] = line.split(',');
    const syns = uniq(rest).filter(w => w !== clean(head));
    if (usable(clean(head)) && syns.length) lines.push(`${clean(head)}:${syns.join(',')}`);
  }
  rmSync(dir, { recursive: true });
  return lines;
}

// WNDB data.* lines: offset lex_filenum ss_type w_cnt(hex) [word lex_id]×w_cnt …
async function wordnet() {
  const files = await fetchWordNet(['data.noun', 'data.verb', 'data.adj', 'data.adv']);
  const lines = [];
  for (const text of Object.values(files)) {
    for (const line of text.split('\n')) {
      if (!line || line.startsWith(' ')) continue;
      const f = line.split(' ');
      const n = parseInt(f[3], 16);
      const words = uniq(Array.from({ length: n }, (_, i) => f[4 + 2 * i].replace(/\(.*\)$/, '')));
      if (words.length >= 2) lines.push(words.join(','));
    }
  }
  return lines;
}

function roget() {
  const dir = untar(ROGET);
  const root = join(dir, readdirSync(dir)[0], 'wordlists/roget');
  const lines = [];
  for (const file of readdirSync(root).filter(f => /^head\d+\.txt$/.test(f))) {
    const text = readFileSync(join(root, file), 'latin1');
    for (const [, sg] of text.matchAll(/<sg>([\s\S]*?)<\/sg>/g)) {
      const words = uniq(sg.replace(/<[^>]*>/g, '').replace(/&c\b[^,;]*/g, '').replace(/\[[^\]]*\]/g, '').split(/[,;]/));
      if (words.length >= 2) lines.push(words.join(','));
    }
  }
  rmSync(dir, { recursive: true });
  return lines;
}

function vectors() {
  const dir = mkdtempSync(join(tmpdir(), 'storm-surge-'));
  const zip = join(dir, 'vectors.zip');
  execFileSync('curl', ['-sSfL', '-o', zip, VECTORS]);
  const text = execFileSync('unzip', ['-p', zip], { maxBuffer: 512 << 20, encoding: 'utf8' });
  rmSync(dir, { recursive: true });
  const vecs = new Map();
  for (const line of text.split('\n')) {
    const f = line.split(' ');
    if (f.length < 2) continue;
    const v = Float32Array.from(f.slice(1), Number);
    const len = Math.hypot(...v);
    vecs.set(f[0], v.map(x => x / len));
  }
  return vecs;
}

function quality(sections) {
  const vecs = vectors();
  const rated = new Map();
  const rate = (a, b) => {
    if (a === b) return;
    if (a > b) [a, b] = [b, a];
    const key = `${a}:${b}`;
    if (rated.has(key)) return;
    const va = vecs.get(a), vb = vecs.get(b);
    let dot = 0;
    if (va && vb) for (let i = 0; i < va.length; i++) dot += va[i] * vb[i];
    rated.set(key, dot >= STRONG ? '+' : dot >= FAIR ? '' : null);
  };
  for (const line of sections.moby) {
    const colon = line.indexOf(':');
    const head = line.slice(0, colon);
    for (const w of line.slice(colon + 1).split(',')) rate(head, w);
  }
  for (const lines of [sections.wordnet, sections.roget]) {
    for (const line of lines) {
      const words = line.split(',').filter(w => vecs.has(w));
      for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) rate(words[i], words[j]);
    }
  }
  const byWord = new Map();
  for (const [key, mark] of rated) {
    if (mark === null) continue;
    const [a, b] = key.split(':');
    (byWord.get(a) ?? byWord.set(a, []).get(a)).push(b + mark);
  }
  return [...byWord].map(([a, bs]) => `${a}:${bs.join(',')}`);
}

const sections = { moby: moby(), wordnet: await wordnet(), roget: roget() };
sections.quality = quality(sections);
const out = Object.entries(sections).flatMap(([name, lines]) => [`@${name}`, ...lines]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join('\n') + '\n');
for (const [name, lines] of Object.entries(sections)) console.log(`${name}: ${lines.length} lines`);
