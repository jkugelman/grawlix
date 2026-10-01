import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reflow, splitSentences, trackedMarkdown } from '../../scripts/md-sentences.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('every tracked Markdown file has one sentence per line', () => {
  const files = trackedMarkdown(root);
  assert.ok(files.length > 20, `expected the repo's Markdown, found ${files.length} files`);
  const off = [];
  for (const f of files) {
    const text = readFileSync(root + f, 'utf8');
    const fixed = reflow(text);
    if (fixed === text) continue;
    const a = text.split('\n'), b = fixed.split('\n');
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    off.push(`${f}:${i + 1}: ${(a[i] ?? '').slice(0, 80)}`);
  }
  assert.deepEqual(off, [], 'run `node scripts/md-sentences.js` to put each sentence on its own line');
});

test('splitSentences keeps abbreviations, initials, and code spans whole', () => {
  assert.deepEqual(splitSentences('One. Two? Three!'), ['One.', 'Two?', 'Three!']);
  assert.deepEqual(splitSentences('Use e.g. `x` vs. Qat here. Next.'), ['Use e.g. `x` vs. Qat here.', 'Next.']);
  assert.deepEqual(splitSentences('J. R. Tolkien wrote. Done.'), ['J. R. Tolkien wrote.', 'Done.']);
  assert.deepEqual(splitSentences('A `x. Y` span. [A](b.c) Z.'), ['A `x. Y` span.', '[A](b.c) Z.']);
  assert.deepEqual(splitSentences('**Lead.** Body (§ *X*). More.'), ['**Lead.**', 'Body (§ *X*).', 'More.']);
  assert.deepEqual(splitSentences('Ends lower. then not.'), ['Ends lower. then not.']);
  assert.deepEqual(splitSentences('No. The U.S. Army came.'), ['No.', 'The U.S. Army came.']);
});

test('reflow leaves indented code, setext headings, nested fences, pipe-less tables, and HTML blocks alone', () => {
  for (const md of [
    'Para.\n\n    code one. Two\n    code two. Three',
    'Title here. Second\n=====',
    '````md\n```\nx. Y\n```\n````',
    'a | b. C\n--|--\nc. D | e',
    '<pre>\nkeep. This\n</pre>',
  ]) assert.equal(reflow(md), md);
});

test('reflow never starts a line with a list marker', () => {
  assert.equal(reflow('We ship it. 1. Is not a list.'), 'We ship it. 1.\nIs not a list.');
});

test('reflow joins wrapped lines and leaves code, tables, and frontmatter alone', () => {
  const md = [
    '---', 'description: One. Two.', '---',
    'Wrapped', 'sentence. Next one.',
    '', '- Item one. Item two.', '  continued here.',
    '', '| a. B | c |', '', '```', 'x. Y', '```', '', '> Quote. Two.',
  ].join('\n');
  assert.equal(reflow(md), [
    '---', 'description: One. Two.', '---',
    'Wrapped sentence.', 'Next one.',
    '', '- Item one.', '  Item two. continued here.',
    '', '| a. B | c |', '', '```', 'x. Y', '```', '', '> Quote.', '> Two.',
  ].join('\n'));
});
