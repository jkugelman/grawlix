import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, basename } from 'node:path';

// Docs cross-reference each other as `§ *Heading*`. Sections move between
// docs as they grow, and a reference left pointing at the old file reads
// fine and silently sends the reader nowhere.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

function walk(dir, pred, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

const docFiles = [
  ...walk(join(root, 'docs'), p => p.endsWith('.md')),
  ...readdirSync(join(root, '.claude', 'skills')).map(s => join(root, '.claude', 'skills', s, 'SKILL.md')).filter(existsSync),
  join(root, 'CLAUDE.md'),
];
const codeFiles = ['site/src', 'tests', 'scripts']
  .flatMap(d => walk(join(root, d), p => /\.(js|mjs)$/.test(p)));
const byBasename = new Map();
for (const f of docFiles) byBasename.set(basename(f), [...(byBasename.get(basename(f)) || []), f]);

const fold = s => s.replace(/[`*]/g, '').replace(/[.:]+$/, '').trim().toLowerCase();

// Sections are headings and bold/italic paragraph leads. Fenced code is
// skipped, or a `# comment` in a shell block would count as a heading.
const anchorCache = new Map();
function anchors(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const heads = [], leads = [];
  let fenced = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = line.match(/^#+\s+(.*)$/);
    if (h) { heads.push(fold(h[1])); continue; }
    const l = line.match(/^\s*(?:[-*]\s+|\d+\.\s+)?(\*\*?)([^*\n]+?)\1(?!\*)/);
    if (l) leads.push(fold(l[2]));
  }
  const a = { heads, leads };
  anchorCache.set(file, a);
  return a;
}

function resolves(x, file) {
  const fx = fold(x);
  const { heads, leads } = anchors(file);
  return [...heads, ...leads].some(h => h.startsWith(fx));
}

// A Markdown link must resolve as written, relative to its file; a basename
// lookup would let a broken relative link pass. A plain `name.md` mention has
// no path to check, so it may name any doc that's unique by that name.
function linkTarget(from, href) {
  const p = resolve(dirname(from), href.replace(/#.*$/, ''));
  return existsSync(p) ? p : null;
}

function namedDoc(name) {
  if (name.includes('/')) {
    const p = resolve(root, name);
    return existsSync(p) ? p : null;
  }
  const hits = byBasename.get(name) || [];
  return hits.length === 1 ? hits[0] : null;
}

const where = (file, text, index) =>
  `${relative(root, file)}:${text.slice(0, index).split('\n').length}`;

test('every § *Heading* reference in the docs resolves', () => {
  const ref = /(?:\[`?[\w./-]+\.md`?\]\(([^)\s]+)\)\s*|`([\w./-]+\.md)`\s+)?§+\s*\*([^*\n]+)\*(?:\s+in\s+\[`?[\w./-]+\.md`?\]\(([^)\s]+)\))?/g;
  const broken = [];
  let checked = 0;
  for (const file of docFiles) {
    // A reference quoted in a code span is an example, not a reference.
    const text = readFileSync(file, 'utf8')
      .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, m => (m.includes('§') ? ' '.repeat(m.length) : m));
    let prevEnd = -1, prevTgt = null;
    for (const m of text.matchAll(ref)) {
      const [, link, plain, x, inLink] = m;
      const named = link || plain || inLink;
      // `[`a.md`](a.md) § *X*, § *Y*` — a chained reference shares the first one's file.
      const chained = !named && prevTgt && /^\s*(?:,|\/|and|or|, and)\s*$/.test(text.slice(prevEnd, m.index));
      const tgt = chained ? prevTgt : (link || inLink) ? linkTarget(file, link || inLink) : plain ? namedDoc(plain) : file;
      prevEnd = m.index + m[0].length;
      prevTgt = tgt;
      checked++;
      if (!tgt) broken.push(`${where(file, text, m.index)}: § *${x}* names a file that doesn't exist`);
      else if (!resolves(x, tgt)) broken.push(`${where(file, text, m.index)}: § *${x}* — no such section in ${relative(root, tgt)}`);
    }
  }
  assert.ok(checked > 100, `expected to find the docs' cross-references, checked ${checked}`);
  assert.deepEqual(broken, [], 'a reference points at a section that moved or was renamed — name the file the section is in now');
});

test('every `docs/x.md § Heading` pointer in code resolves', () => {
  const ref = /([\w./-]*\b[\w-]+\.md)`?\s*§\s*\*?([A-Za-z`][^*\n]*)/g;
  const broken = [];
  let checked = 0;
  for (const file of codeFiles.filter(f => f !== fileURLToPath(import.meta.url))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(ref)) {
      const [, docName, rest] = m;
      const tgt = namedDoc(docName.replace(/^\.?\//, ''));
      if (!tgt) { broken.push(`${where(file, text, m.index)}: ${docName} is not a doc (or names two)`); continue; }
      checked++;
      // A comment doesn't mark where the heading ends, so read up to the first
      // punctuation and accept a heading that starts with it, or that it starts with.
      const name = fold(rest.split(/[.,;:+()\/—─]| and /)[0]);
      const { heads, leads } = anchors(tgt);
      if (!name || ![...heads, ...leads].some(h => h.startsWith(name) || (h.length >= 6 && name.startsWith(h))))
        broken.push(`${where(file, text, m.index)}: ${docName} § ${rest.slice(0, 50)}`);
    }
  }
  assert.ok(checked > 20, `expected to find code pointers into the docs, checked ${checked}`);
  assert.deepEqual(broken, [], 'a code comment points at a doc section that moved or was renamed');
});
