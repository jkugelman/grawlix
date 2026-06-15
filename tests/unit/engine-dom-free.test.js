import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Do NOT add fetch/indexedDB/navigator/scheduler/self/globalThis here: workers
// have them and the engine legitimately uses some (segmenter fetches the corpus
// directly; the executor probes scheduler). Trapping them would be a false alarm
// that someone "tightening" this list could easily introduce.
const FORBIDDEN = ['document', 'window', 'localStorage'];

const here = dirname(fileURLToPath(import.meta.url));
const engineDir = join(here, '..', '..', 'site', 'src', 'engine');

function engineModules(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...engineModules(full));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

// Throwing getters on globalThis trap global ACCESS, not the identifier name —
// so a parameter or property named `window` (segmenter's rankedSplits, space_out)
// is a local binding that shadows the global and never trips the guard. A
// name-matching grep would false-positive on exactly those.
function installTraps() {
  const saved = [];
  for (const name of FORBIDDEN) {
    saved.push([name, Object.getOwnPropertyDescriptor(globalThis, name)]);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() { throw new Error(`engine touched forbidden worker global: ${name}`); },
      set() { throw new Error(`engine touched forbidden worker global: ${name}`); },
    });
  }
  return () => {
    for (const [name, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, name, desc);
      else delete globalThis[name];
    }
  };
}

test('engine layer is worker-safe: no document/window/localStorage at import time', async () => {
  const modules = engineModules(engineDir)
    .filter(p => relative(engineDir, p) !== 'worker.js');
  assert.ok(modules.length >= 30, `expected to discover the engine surface, found ${modules.length} modules`);

  const restore = installTraps();
  try {
    for (const file of modules) {
      const rel = relative(engineDir, file);
      await assert.doesNotReject(
        () => import(pathToFileURL(file).href),
        `importing engine/${rel} reached for a forbidden worker global`,
      );
    }
  } finally {
    restore();
  }
});

test('engine hot-path leaf calls are worker-safe at call time', async () => {
  const restore = installTraps();
  try {
    const { toNorm } = await import(pathToFileURL(join(engineDir, 'norm.js')).href);
    const { buildSearchPattern } = await import(pathToFileURL(join(engineDir, 'search.js')).href);
    assert.equal(toNorm('Abc'), 'abc');
    const pat = buildSearchPattern('a*c');
    assert.equal(typeof pat.test, 'function');
    assert.ok(pat.globalRe instanceof RegExp);
  } finally {
    restore();
  }
});
