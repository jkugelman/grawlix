// Loads the CMU dictionary and Grawlix's supplement into phonetics.js, and
// the segmenter the readers split words with.
import fs from 'node:fs';
import os from 'node:os';
import { setCmuDict, parseCmuDict } from '../../site/src/engine/phonetics.js';
import { initSegmenter } from './segment.mjs';

export const CMU = process.env.CMUDICT ?? `${os.homedir()}/.cache/grawlix/cmudict.dict`;
const CMU_URL = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';
const SUPP = new URL('../../site/data/cmu-supplement.dict', import.meta.url);

let ready = false;
export function initReader() {
  if (ready) return;
  if (!fs.existsSync(CMU)) throw new Error(`missing ${CMU}: curl -L -o ${CMU} ${CMU_URL}`);
  setCmuDict(parseCmuDict(fs.readFileSync(CMU, 'utf8')), parseCmuDict(fs.readFileSync(SUPP, 'utf8')));
  initSegmenter();
  ready = true;
}
