// Lab pages: unlisted copies of the app at /lab/<name>/, each with its own tools.
// A lab is a directory site/lab/<name>/ holding main.js and worker.js entries; its
// index.html is generated from site/index.html, and the data its generator
// scripts/lab/<name>.js writes lands in site/lab/<name>/data/. Neither is checked in.
//
// `node scripts/lab.js` writes the shells into site/ for the dev server; with
// --data it also runs each generator whose data is missing or out of date.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LAB_DIR = 'site/lab';

const exists = path => access(path).then(() => true, () => false);

export async function labNames() {
  let names;
  try { names = await readdir(LAB_DIR); } catch { return []; }
  const labs = [];
  // By its entry, not by the directory: a removed lab leaves its ignored files behind.
  for (const name of names.sort()) {
    if (await exists(join(LAB_DIR, name, 'main.js'))) labs.push(name);
  }
  return labs;
}

// Every relative URL in the shell climbs out of lab/<name>/; the manifest is
// dropped so a lab page can't be installed as an app of its own.
export function labShellHTML(indexHTML, name) {
  const out = indexHTML
    .replace(/<link rel="manifest"[^>]*>\n?/, '')
    .replace(/<title>([^<]*)<\/title>/, `<title>$1 Lab: ${name}</title>\n<meta name="robots" content="noindex">`)
    .replace(/ (href|src)="(?!#|[a-z]+:|\/)([^"]+)"/g, ' $1="../../$2"')
    .replace(' src="../../src/main.js"', ' src="main.js"');
  if (!out.includes(' src="main.js"')) throw new Error('lab shell: index.html has no src/main.js script tag');
  return out;
}

export async function writeLabShells(root = 'site') {
  const indexHTML = await readFile('site/index.html', 'utf8');
  const names = await labNames();
  for (const name of names) await writeFile(join(root, 'lab', name, 'index.html'), labShellHTML(indexHTML, name));
  return names;
}

// ─── Data ────────────────────────────────────────────────────────────────

// A hash of the generator and the local modules it imports. Written into data/
// only after the generator succeeds, so a failed or interrupted run reruns.
async function generatorHash(generator) {
  const hash = createHash('sha256');
  const seen = new Set();
  const visit = async file => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = await readFile(file, 'utf8');
    hash.update(`${file}\0${src}\0`);
    for (const [, spec] of src.matchAll(/^import\b[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      await visit(join(dirname(file), spec));
    }
  };
  await visit(generator);
  return hash.digest('hex');
}

export async function ensureLabData(name) {
  const generator = `scripts/lab/${name}.js`;
  if (!await exists(generator)) return 'none';
  const stamp = join(LAB_DIR, name, 'data', '.stamp');
  const want = await generatorHash(generator);
  if (await readFile(stamp, 'utf8').catch(() => '') === want) return 'current';
  console.log(`generating lab data for ${name} (this downloads its sources)...`);
  execFileSync(process.execPath, [resolve(generator)], { stdio: 'inherit' });
  await writeFile(stamp, want);
  return 'generated';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = process.argv.includes('--data');
  let failed = false;
  for (const name of await writeLabShells()) {
    console.log(`wrote site/lab/${name}/index.html`);
    if (!data) continue;
    try {
      await ensureLabData(name);
    } catch (err) {
      failed = true;
      console.error(`lab ${name}: data generator failed: ${err.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}
