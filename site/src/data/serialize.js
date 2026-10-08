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

export const DEFAULT_TRASH_SCORE = 0;

export function getTrashScore() {
  const v = Storage.readMergedSettings().trashScore;
  return Number.isFinite(v) ? v : DEFAULT_TRASH_SCORE;
}

export function setTrashScore(score) {
  Storage.writeMergedSettings({ ...Storage.readMergedSettings(), trashScore: score });
}

export function getMergeMode() {
  const mode = Storage.readMergedSettings().mergeMode;
  return mode === 'highest' || mode === 'lowest' ? mode : 'first';
}

export function setMergeMode(mode) {
  Storage.writeMergedSettings({ ...Storage.readMergedSettings(), mergeMode: mode });
}

export function defaultScoreRange() {
  return `${getTrashScore() + 1}+`;
}
