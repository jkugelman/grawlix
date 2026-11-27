import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labShellHTML } from '../../scripts/lab.js';

const INDEX = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');

test('a lab shell climbs out of lab/<name>/ for every relative URL', () => {
  const html = labShellHTML(INDEX, 'demo');
  assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/css\/app\.css">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\.\/\.\.\/icons\/apple-touch-icon\.png">/);
  assert.match(html, /<script type="module" src="main\.js"><\/script>/);
  const relative = [...html.matchAll(/ (?:href|src)="(?!#|[a-z]+:|\/|\.\.\/\.\.\/|main\.js")([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(relative, []);
});

test('a lab shell is unindexed, uninstallable, and titled with its name', () => {
  const html = labShellHTML(INDEX, 'demo');
  assert.match(html, /<title>Grawlix Lab: demo<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /manifest/);
});

test('a lab shell refuses an index.html without the main.js script tag', () => {
  assert.throws(() => labShellHTML(INDEX.replace('src/main.js', 'src/app.js'), 'demo'));
});
