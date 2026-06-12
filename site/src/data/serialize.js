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
