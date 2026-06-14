'use strict';

// ─── Serialize (output-format setting) ────────────────────────────────────────

import { AS_IS_FORMAT } from '../engine/serialize.js';
import { Storage } from './storage.js';

export function getOutputFormat() {
  return { ...AS_IS_FORMAT, ...(Storage.readMergedSettings().outputFormat || {}) };
}

export function setOutputFormat(fmt) {
  Storage.writeMergedSettings({ ...Storage.readMergedSettings(), outputFormat: fmt });
}

export const DEFAULT_JUNK_SCORE = 0;

export function getJunkScore() {
  const v = Storage.readMergedSettings().junkScore;
  return Number.isFinite(v) ? v : DEFAULT_JUNK_SCORE;
}

export function setJunkScore(score) {
  Storage.writeMergedSettings({ ...Storage.readMergedSettings(), junkScore: score });
}
