import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { minify } from 'html-minifier-terser';

const SRC = 'site';
const OUT = 'dist';

const MINIFY_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true,
};

const kb = n => `${(n / 1024).toFixed(1)} KB`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const name of await readdir(SRC)) {
  const from = join(SRC, name);
  const to = join(OUT, name);
  if (extname(name) === '.html') {
    const src = await readFile(from, 'utf8');
    const out = await minify(src, MINIFY_OPTS);
    await writeFile(to, out);
    const pct = ((1 - out.length / src.length) * 100).toFixed(1);
    console.log(`minified ${name}: ${kb(src.length)} → ${kb(out.length)} (−${pct}%)`);
  } else {
    await copyFile(from, to);
    console.log(`copied   ${name}`);
  }
}
