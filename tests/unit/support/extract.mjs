// Evaluates marker-fenced regions of site/src/main.js so the unit tier can call
// its pure functions directly. Regions are fenced inline with
// `// #region nodetest:<name>` / `// #endregion nodetest:<name>`. Those markers
// ship verbatim in site/src/main.js and the deploy minifier strips them from
// dist/ — so don't "tidy" them out of the source; the harness slices on them.
// Reads source, never dist (the markers only exist in source). Same-named blocks
// concatenate in source order, so a region can skip a state-coupled neighbour.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'site', 'src', 'main.js');

let _text = null;
const sourceText = () => (_text ??= readFileSync(SOURCE, 'utf8'));

// Match a tag only when it isn't a prefix of a longer region name — otherwise
// `nodetest:merge` would also match every `nodetest:merge3` marker and silently
// splice in the wrong region (the tests still pass, so the bug hides). The guard
// requires the char after the tag to be a non-identifier (newline/EOF).
function findTag(text, tag, from) {
  for (let i = text.indexOf(tag, from); i !== -1; i = text.indexOf(tag, i + 1)) {
    const after = text[i + tag.length];
    if (after === undefined || !/\w/.test(after)) return i;
  }
  return -1;
}

function regionBody(text, name) {
  const startTag = `// #region nodetest:${name}`;
  const endTag = `// #endregion nodetest:${name}`;
  const blocks = [];
  let from = 0;
  for (;;) {
    const i = findTag(text, startTag, from);
    if (i === -1) break;
    const j = findTag(text, endTag, i);
    if (j === -1) throw new Error(`extract: region '${name}' has a start with no matching #endregion`);
    blocks.push(text.slice(i + startTag.length, j));
    from = j + endTag.length;
  }
  if (!blocks.length) throw new Error(`extract: region '${name}' not found in site/src/main.js`);
  return blocks.join('\n');
}

export function extract(regions, exports, globals = {}) {
  const text = sourceText();
  const names = Array.isArray(regions) ? regions : [regions];
  const body = names.map(n => regionBody(text, n)).join('\n');
  const params = Object.keys(globals);
  // Wrap in an IIFE run in THIS realm (runInThisContext), not a fresh vm context.
  // A fresh context gives returned objects a foreign Object.prototype, so
  // node:assert deepStrictEqual rejects them as "same structure but not
  // reference-equal" — don't switch to createContext. The IIFE keeps the fenced
  // declarations function-scoped (no global leak); injected globals (e.g. a
  // location stub for the export builders) arrive as IIFE params.
  const src = `(function (${params.join(', ')}) {\n'use strict';\n${body}\n;return { ${exports.join(', ')} };\n})`;
  let factory;
  try {
    factory = vm.runInThisContext(src, { filename: `nodetest:${names.join('+')}` });
  } catch (err) {
    err.message = `extract([${names.join(', ')}]) failed to compile: ${err.message}`;
    throw err;
  }
  return factory(...params.map(k => globals[k]));
}
