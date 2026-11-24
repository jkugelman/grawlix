// Node side of the Twins scorer: loads the wordlist, segmenter and
// WordNet extract for site/src/engine/twins.js, which holds the scorer itself.
import os from 'node:os';
import fs from 'node:fs';
import { configureCommonWords, collectRowVocab } from '../../site/src/engine/morphology.js';
import { COMMON_WORDS, LEMMA_BASES } from '../../site/src/engine/common-words-data.js';
import { prep as prepWith, prepServices, normOf, configureRelation, configureRunModel } from '../../site/src/engine/twins.js';
import { letterModel } from '../../site/src/engine/twins-run.js';
import { initSegmenter } from './segment.mjs';
import { parseRelations, makeRelations } from '../../site/src/engine/twins-wordnet.js';

export { DEFAULTS, makeScorer, normOf, collapse, sharedAffixLen, affixed } from '../../site/src/engine/twins.js';

configureCommonWords(COMMON_WORDS, LEMMA_BASES);
configureRelation(makeRelations(parseRelations(fs.readFileSync(new URL('../../site/data/twins-wordnet.txt', import.meta.url), 'utf8'))));

export const LIST = `${os.homedir()}/wordlist/all-wordlists.txt`;

export function loadCorpus(minScore = 40, file = LIST) {
  const byNorm = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [display, sc] = line.split(';');
    const score = +sc;
    if (!display) continue;
    const norm = normOf(display);
    if (!norm) continue;
    const prev = byNorm.get(norm);
    if (!prev || score > prev.score || (score === prev.score && /\s/.test(display) && !/\s/.test(prev.display)))
      byNorm.set(norm, { norm, display, score });
  }
  const all = [...byNorm.values()];
  // Segmentation and family keys read the whole list, as the tool reads the
  // merged corpus; only the scored entries are floored.
  wordlist = { norms: new Set(byNorm.keys()), vocab: collectRowVocab(all) };
  configureRunModel(letterModel(wordlist.norms));
  segmented = initSegmenter();
  svc = prepServices(wordlist);
  if (!segmented) svc.segment = null;
  const entries = all.filter((e) => e.score >= minScore).map(prep);
  return { entries, allByNorm: byNorm, byNorm: new Map(entries.map((e) => [e.norm, e])), wordlist };
}

let wordlist = null, svc = null, segmented = false;
export const segmenterReady = () => segmented;


export const prep = (e) => prepWith(e, svc);
export const services = () => svc;
