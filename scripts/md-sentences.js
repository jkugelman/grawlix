// One sentence per line for the repo's Markdown (docs/style.md § Markdown
// documentation).
//
//   node scripts/md-sentences.js           rewrite every tracked .md in place
//   node scripts/md-sentences.js --check   list files that need it; exit 1 if any
//   node scripts/md-sentences.js FILE...    only these files (paths from the repo root)
//
// tests/unit/md-sentences.test.js runs the check, using reflow() from here so
// the fixer and the test can't disagree about where a sentence ends.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Words whose trailing period doesn't end a sentence.
const ABBREV = new Set([
  'e.g', 'i.e', 'vs', 'etc', 'cf', 'al', 'approx', 'a.k.a', 'viz', 'resp', 'incl', 'ca',
  'Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Fig', 'Vol', 'pp', 'Ch', 'U.S', 'U.K',
]);

// Blank out spans whose periods are never sentence ends — code spans, link
// destinations, autolinks — keeping offsets so splits land in the original.
function mask(s) {
  const blank = m => ' '.repeat(m.length);
  return s
    .replace(/(`+)[^`]*?\1/g, m => m[0] + 'x'.repeat(m.length - 2) + m[m.length - 1])
    .replace(/\]\([^)\s]*\)/g, m => '](' + 'x'.repeat(m.length - 3) + ')')
    .replace(/<https?:[^>]*>/g, blank)
    .replace(/https?:\/\/\S+/g, blank);
}

export function splitSentences(text) {
  const m = mask(text);
  const out = [];
  let start = 0;
  // A sentence ends at . ! or ?, after any closing quotes, brackets, or
  // emphasis, where whitespace follows and the next sentence starts.
  const end = /[.!?]["'”’)\]*_]*(\s+)(?=["'“‘(\[*_`]*[A-Z0-9`§])/g;
  for (const e of m.matchAll(end)) {
    const punct = e.index;
    if (m[punct] === '.') {
      const word = m.slice(0, punct).match(/([\w.]+)$/)?.[1] ?? '';
      if (ABBREV.has(word) || /^[A-Z]$/.test(word)) continue;
    }
    if (m.slice(punct - 2, punct + 1) === '...') continue;
    const cut = e.index + e[0].length - e[1].length;
    out.push(text.slice(start, cut));
    start = e.index + e[0].length;
  }
  out.push(text.slice(start));
  return out.filter(s => s.length);
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST = /^(\s*)([-*+]|\d+[.)])(\s+)/;
const SETEXT = /^\s*(=+|-+)\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const HTML_BLOCK = /^\s*<(\/?(address|article|aside|blockquote|details|dialog|div|dl|figure|footer|form|h[1-6]|header|hr|li|nav|ol|p|pre|section|summary|table|tbody|td|th|thead|tr|ul)\b|!--)/i;
const isSkipLine = l => /^\s*#{1,6}\s/.test(l) || /^\s*\|/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) || /^\s*=+\s*$/.test(l);

function reflowBlock(lines) {
  const items = [];
  for (const line of lines) {
    const li = line.match(LIST);
    const prev = items[items.length - 1];
    if (li) {
      const lead = li[1] + li[2] + li[3];
      items.push({ first: lead, cont: ' '.repeat(lead.length), text: line.slice(lead.length) });
    } else if (prev && !/(\s{2}|\\)$/.test(prev.text)) {
      prev.text += ' ' + line.trim();
    } else {
      const indent = line.match(/^\s*/)[0];
      items.push({ first: indent, cont: indent, text: line.slice(indent.length) });
    }
  }
  return items.flatMap(it => {
    const sentences = [];
    for (const s of splitSentences(it.text.replace(/\s+$/, m => (/^ {2,}$/.test(m) ? m : '')))) {
      // A sentence opening with `1.` or `- ` on its own line would render as a list item.
      if (sentences.length && /^([-*+]|\d+[.)])(\s|$)/.test(s)) sentences[sentences.length - 1] += ' ' + s;
      else sentences.push(s);
    }
    return sentences.map((s, i) => (i ? it.cont : it.first) + s.replace(/^\s+/, ''));
  });
}

export function reflow(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  // YAML frontmatter: a wrapped `description:` value would stop parsing.
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close > 0) { out.push(...lines.slice(0, close + 1)); i = close + 1; }
  }
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const fence = line.match(FENCE)[1];
      const close = new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      out.push(line);
      i++;
      while (i < lines.length && !close.test(lines[i])) out.push(lines[i++]);
      if (i < lines.length) out.push(lines[i++]);
      continue;
    }
    // Indented code, a table (with or without outer pipes), or an HTML block:
    // copied through to the next blank line.
    const indentedCode = /^ {4,}\S/.test(line) && !out[out.length - 1]?.trim() && !LIST.test(line);
    if (indentedCode || HTML_BLOCK.test(line) || TABLE_RULE.test(lines[i + 1] ?? '') || SETEXT.test(lines[i + 1] ?? '') && line.trim()) {
      while (i < lines.length && lines[i].trim()) out.push(lines[i++]);
      continue;
    }
    if (!line.trim() || isSkipLine(line)) {
      out.push(line);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*> ?/, ''));
      out.push(...reflow(quote.join('\n')).split('\n').map(l => (l ? '> ' + l : '>')));
      continue;
    }
    const block = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !isSkipLine(lines[i]) && !HTML_BLOCK.test(lines[i])
      && !/^\s*>/.test(lines[i]) && !TABLE_RULE.test(lines[i + 1] ?? '') && !SETEXT.test(lines[i + 1] ?? '')) block.push(lines[i++]);
    out.push(...reflowBlock(block));
  }
  return out.join('\n');
}

export function trackedMarkdown(cwd) {
  return execFileSync('git', ['ls-files', '*.md'], { cwd, encoding: 'utf8' })
    .split('\n').filter(f => f && f !== 'TODO.md');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bad = [];
  const named = process.argv.slice(2).filter(a => !a.startsWith('--'));
  for (const f of named.length ? named : trackedMarkdown(root)) {
    const p = root + f;
    const before = readFileSync(p, 'utf8');
    const after = reflow(before);
    if (after === before) continue;
    bad.push(f);
    if (!check) writeFileSync(p, after);
  }
  if (check && bad.length) {
    console.error(`not one sentence per line:\n  ${bad.join('\n  ')}\nrun: node scripts/md-sentences.js`);
    process.exit(1);
  }
  if (!check) console.log(bad.length ? `reflowed ${bad.length} file(s)` : 'nothing to reflow');
}
