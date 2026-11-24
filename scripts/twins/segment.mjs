import fs from 'node:fs';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { msgpackDecode, buildCorpusFromMsgpack, setUnigramCorpus, configureSpaceOutBigrams } from '../../site/src/engine/segmenter.js';
import { SPACE_OUT_BIGRAMS } from '../../site/src/engine/space-out-bigrams-data.js';

export const WORDFREQ = process.env.WORDFREQ ?? `${os.homedir()}/.cache/grawlix/large_en.msgpack.gz`;

let ready = false;
export function initSegmenter() {
  if (ready) return true;
  if (!fs.existsSync(WORDFREQ)) return false;
  const { map, minLog } = buildCorpusFromMsgpack(msgpackDecode(gunzipSync(fs.readFileSync(WORDFREQ))));
  setUnigramCorpus(Object.fromEntries(map), minLog);
  configureSpaceOutBigrams(SPACE_OUT_BIGRAMS);
  return (ready = true);
}
