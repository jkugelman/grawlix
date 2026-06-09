import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
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

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(from);
      continue;
    }
    const rel = relative(SRC, from);
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
