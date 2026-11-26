'use strict';

// [Boo___] clues STORM SURGE, read as ST OR M SURGE, because
// BOOST and BOOM both mean SURGE. An answer is X + OR + Y + Z where Z's thesaurus
// entry holds two words P+X+Q and P+Y+Q; the clue is P___Q.

import { toNorm } from '../../src/engine/norm.js';

const THESAURUS_URL = new URL('./data/thesaurus.txt', import.meta.url).href;
const SOURCES = ['moby', 'wordnet', 'roget'];
const pairKey = (i, j) => i < j ? i * 2 ** 20 + j : j * 2 ** 20 + i;

function parseThesaurus(text) {
  const ids = new Map();
  const norms = [];
  const idOf = word => {
    const norm = toNorm(word);
    if (!norm) return -1;
    let id = ids.get(norm);
    if (id === undefined) { id = norms.length; ids.set(norm, id); norms.push(norm); }
    return id;
  };
  const lists = new Map();
  const groups = { wordnet: [], roget: [] };
  const groupsOf = { wordnet: new Map(), roget: new Map() };
  const quality = new Map();
  let source = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line[0] === '@') { source = line.slice(1); continue; }
    if (source === 'moby') {
      const colon = line.indexOf(':');
      const head = idOf(line.slice(0, colon));
      const list = Int32Array.from(line.slice(colon + 1).split(','), idOf).filter(id => id >= 0 && id !== head);
      if (head >= 0) lists.set(head, list);
    } else if (source === 'quality') {
      const colon = line.indexOf(':');
      const a = idOf(line.slice(0, colon));
      for (const b of line.slice(colon + 1).split(',')) {
        const strong = b.endsWith('+');
        const id = idOf(strong ? b.slice(0, -1) : b);
        if (a >= 0 && id >= 0) quality.set(pairKey(a, id), strong ? 2 : 1);
      }
    } else {
      const members = Int32Array.from(new Set(line.split(',').map(idOf))).filter(id => id >= 0);
      const g = groups[source].push(members) - 1;
      for (const id of members) {
        const of = groupsOf[source].get(id);
        if (of) of.push(g); else groupsOf[source].set(id, [g]);
      }
    }
  }
  return { ids, norms, lists, groups, groupsOf, quality };
}

let thesaurus = null;
function loadThesaurus() {
  thesaurus ??= fetch(THESAURUS_URL)
    .then(resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    })
    .then(parseThesaurus)
    .catch(err => {
      thesaurus = null;
      throw new Error(`Couldn’t load the thesaurus (${err.message}).`);
    });
  return thesaurus;
}

function synonymsOf(t, z, sources) {
  const out = new Map();
  const add = id => { if (id !== z) out.set(t.norms[id], id); };
  if (sources.has('moby')) t.lists.get(z)?.forEach(add);
  for (const s of ['wordnet', 'roget']) {
    if (!sources.has(s)) continue;
    for (const g of t.groupsOf[s].get(z) ?? []) t.groups[s][g].forEach(add);
  }
  return out;
}

const BLANK_FITS = {
  end:    (p, q) => !q,
  start:  (p, q) => !p,
  middle: (p, q) => !!p && !!q,
  any:    () => true,
};

function clueOutput(hit) {
  const { p, x, y, a, b, z, quality } = hit;
  const atB = a.length + 3;
  return {
    entry: [`${a} / ${b} = ${z}`],
    column: quality,
    coined: true,
    inputHighlights: [
      { start: 0, end: x.length, kind: 'search:0' },
      { start: x.length + 2, end: x.length + 2 + y.length, kind: 'search:1' },
    ],
    outputHighlights: [
      { start: p.length, end: p.length + x.length, kind: 'search:0', coord: 'display' },
      { start: atB + p.length, end: atB + p.length + y.length, kind: 'search:1', coord: 'display' },
    ],
  };
}

export function findClues(entry, t, sources, fits) {
  const hits = [];
  const cache = new Map();
  for (let i = entry.indexOf('or', 1); i !== -1; i = entry.indexOf('or', i + 1)) {
    const x = entry.slice(0, i);
    const rest = entry.slice(i + 2);
    for (let j = 1; j < rest.length; j++) {
      const z = t.ids.get(rest.slice(j));
      if (z === undefined) continue;
      const y = rest.slice(0, j);
      let syns = cache.get(z);
      if (!syns) cache.set(z, syns = synonymsOf(t, z, sources));
      for (const [a, aId] of syns) {
        for (let k = a.indexOf(x); k !== -1; k = a.indexOf(x, k + 1)) {
          const p = a.slice(0, k), q = a.slice(k + x.length);
          if ((!p && !q) || !fits(p, q)) continue;
          const b = p + y + q;
          const bId = syns.get(b);
          if (bId === undefined || bId === aId) continue;
          const quality = 1 + Math.min(t.quality.get(pairKey(aId, z)) ?? 0, t.quality.get(pairKey(bId, z)) ?? 0);
          hits.push({ p, q, x, y, a, b, z: t.norms[z], quality });
        }
      }
    }
  }
  return hits;
}

export { parseThesaurus };

export default {
  name: 'Storm surge', icon: '🌊', category: 'lab',
  desc: 'X OR Y Z, where filling a clue’s blank with X or Y gives two synonyms of Z',
  example: 'storm surge → boost / boom = surge',
  params: [
    { key: 'blank', type: 'segmented', default: 'end', label: 'Blank',
      title: 'Where the blank sits in the clue',
      choices: [
        { value: 'end',    label: 'End' },
        { value: 'start',  label: 'Start' },
        { value: 'middle', label: 'Middle' },
        { value: 'any',    label: 'Any' },
      ] },
    { key: 'thesaurus', type: 'segmented', default: 'all', label: 'Thesaurus',
      title: 'Which thesaurus decides what counts as a synonym',
      choices: [
        { value: 'all',     label: 'All' },
        { value: 'moby',    label: 'Moby' },
        { value: 'wordnet', label: 'WordNet' },
        { value: 'roget',   label: 'Roget’s' },
      ] },
  ],
  column: { key: 'quality', label: 'Quality', meter: 3, defaultSort: 'desc', width: () => 3 },
  kind: 'transform', input: 'highlight', output: 'highlight',
  glyph: () => '→',
  async prepare(params) {
    const choice = params.thesaurus || 'all';
    return {
      t: await loadThesaurus(),
      sources: new Set(choice === 'all' ? SOURCES : [choice]),
      fits: BLANK_FITS[params.blank] || BLANK_FITS.end,
    };
  },
  run(entry, { t, sources, fits }) {
    return findClues(entry, t, sources, fits).map(clueOutput);
  },
};
