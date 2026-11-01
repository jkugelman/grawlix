import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname, relative } from 'node:path';
import { minify } from 'html-minifier-terser';
import * as esbuild from 'esbuild';

const SRC = 'site';
const OUT = 'dist';

const MINIFY_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true,
};

// Each outfile must keep its source's relative path so index.html's <script src>
// resolves in both dev (site/) and prod (dist/) without rewriting the HTML.
const JS_ENTRIES = [
  { entry: 'site/src/main.js', outfile: 'dist/src/main.js' },
  // Its own entry rather than esbuild's new-Worker(new URL) auto-detection:
  // that path needs outdir/splitting, but this build is one outfile per entry to
  // keep each source's relative path. With the outfile mirroring the source's,
  // the literal spawn URL resolves the same against dist/ and site/.
  { entry: 'site/src/engine/worker.js', outfile: 'dist/src/engine/worker.js' },
];

const CSS_ENTRIES = [
  { entry: 'site/css/theme.css', outfile: 'dist/css/theme.css' },
  { entry: 'site/css/app.css', outfile: 'dist/css/app.css' },
];

// The copy walk skips these so raw sources don't clobber esbuild's minified output.
const ESBUILD_OWNED = ['src', 'css'];

const kb = n => `${(n / 1024).toFixed(1)} KB`;

await rm(OUT, { recursive: true, force: true });

// The worker's column cache keys on this, so only a change to the parse code
// (sources.js and what it imports) throws users' cached columns away; hashing the
// whole site would miss on every deploy.
async function parseBuildId() {
  const { metafile } = await esbuild.build({
    entryPoints: ['site/src/engine/sources.js'], bundle: true, format: 'esm', write: false, metafile: true,
  });
  const hash = createHash('sha256');
  for (const path of Object.keys(metafile.inputs).sort()) hash.update(path).update(await readFile(path));
  return hash.digest('hex').slice(0, 16);
}
const define = { __GRAWLIX_PARSE_BUILD_ID__: JSON.stringify(await parseBuildId()) };

for (const { entry, outfile } of JS_ENTRIES) {
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    minify: true,
    sourcemap: true,
    define,
  });
  const src = await readFile(entry, 'utf8');
  const out = await readFile(outfile, 'utf8');
  console.log(`bundled  ${relative(SRC, entry)}: ${kb(src.length)} → ${kb(out.length)} (+ source map)`);
}

for (const { entry, outfile } of CSS_ENTRIES) {
  await esbuild.build({ entryPoints: [entry], outfile, minify: true });
  const src = await readFile(entry, 'utf8');
  const out = await readFile(outfile, 'utf8');
  const pct = ((1 - out.length / src.length) * 100).toFixed(1);
  console.log(`minified ${relative(SRC, entry)}: ${kb(src.length)} → ${kb(out.length)} (−${pct}%)`);
}

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    const rel = relative(SRC, from);
    if (entry.isDirectory()) {
      if (ESBUILD_OWNED.includes(rel)) continue;
      await walk(from);
      continue;
    }
    const to = join(OUT, rel);
    await mkdir(join(to, '..'), { recursive: true });
    if (extname(entry.name) === '.html') {
      const src = await readFile(from, 'utf8');
      const out = await minify(src, MINIFY_OPTS);
      await writeFile(to, out);
      const pct = ((1 - out.length / src.length) * 100).toFixed(1);
      console.log(`minified ${rel}: ${kb(src.length)} → ${kb(out.length)} (−${pct}%)`);
    } else {
      await copyFile(from, to);
      console.log(`copied   ${rel}`);
    }
  }
}

await walk(SRC);
